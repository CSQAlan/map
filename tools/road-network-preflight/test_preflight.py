"""All candidate lines below are SYNTHETIC; never application/DB data."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from shapely.geometry import Polygon
from preflight import load_baseline, preflight, read_json, ROOT

SOURCE = {'method': 'measured_survey', 'ref': 'SYNTHETIC TEST ONLY', 'observed_on': '2026-11-24'}
POINTS = {'A': [10.001, 20.001], 'B': [10.009, 20.001], 'C': [10.003, 20.003], 'D': [10.005, 20.004]}


def baseline():
    return dict(nodes={k: POINTS[k] for k in ('A', 'B')},
                segments=[{'segment_code':'existing', 'start_node_code':'A', 'end_node_code':'B'}],
                reserved_nodes={'A', 'B', 'inactive-node'}, reserved_segments={'existing', 'inactive-edge'},
                boundary=Polygon([(10,20),(10.01,20),(10.01,20.01),(10,20.01),(10,20)]))


def node(code):
    return dict(node_code=code, lon=POINTS[code][0], lat=POINTS[code][1], source=deepcopy(SOURCE))


def edge(code='new', start='A', end='C'):
    return dict(segment_code=code, start_node_code=start, end_node_code=end, source=deepcopy(SOURCE),
                geometry={'type':'LineString', 'coordinates':[POINTS[start], POINTS[end]]},
                width_m=1.5, slope_percent=1.0, step_count=0, surface_type='CONCRETE', has_ramp=False, has_handrail=False)


def batch(edges=None):
    return dict(format_version=1, area_code='SHIDAYUAN', crs='EPSG:4326', nodes=[node('C'), node('D')], segments=[edge()] if edges is None else edges)


class PreflightTests(unittest.TestCase):
    def test_batch_chain_connects_in_any_order_and_input_unchanged(self):
        candidate = batch([edge('second','C','D'), edge('first','A','C')])
        before = deepcopy(candidate)
        result = preflight(candidate, baseline())
        self.assertEqual(len(result['reviewable']), 2)
        self.assertEqual(candidate, before)

    def test_disconnected_component(self):
        self.assertEqual(len(preflight(batch([edge('isolated','C','D')]), baseline())['disconnected']), 1)

    def test_valid_connected_and_disconnected_components_separate(self):
        candidate = batch([edge()])
        candidate['nodes'] += [dict(node_code='E',lon=10.007,lat=20.007,source=SOURCE),dict(node_code='F',lon=10.008,lat=20.008,source=SOURCE)]
        disconnected = edge('other')
        disconnected.update(start_node_code='E',end_node_code='F',geometry={'type':'LineString','coordinates':[[10.007,20.007],[10.008,20.008]]})
        candidate['segments'].append(disconnected)
        result = preflight(candidate,baseline())
        self.assertEqual(len(result['reviewable']),1)
        self.assertEqual(len(result['disconnected']),1)

    def test_missing_accessibility_is_not_zero_or_accessible(self):
        candidate = batch()
        for field in ('width_m','slope_percent','step_count','has_ramp','has_handrail','surface_type'):
            del candidate['segments'][0][field]
        result = preflight(candidate, baseline())
        self.assertEqual(len(result['missing_fields']),1)
        self.assertEqual(len(result['missing_fields'][0]['missing_fields']),6)
        self.assertFalse(result['reviewable'])
        self.assertNotIn('wheelchair_accessible', result['missing_fields'][0]['candidate'])

    def test_steps_require_measured_step_height(self):
        candidate = batch()
        candidate['segments'][0]['step_count'] = 2
        result = preflight(candidate,baseline())
        self.assertEqual(result['missing_fields'][0]['missing_fields'], ['step_height_cm'])

    def test_duplicate_ids_all_rejected(self):
        for code in ('existing','inactive-edge','new'):
            with self.subTest(code=code):
                edges = [edge(code),edge(code)] if code == 'new' else [edge(code)]
                self.assertEqual(len(preflight(batch(edges),baseline())['invalid']),len(edges))

    def test_duplicate_new_nodes_and_override_are_not_anchors(self):
        for duplicate in (node('C'),dict(node('C'), node_code='A')):
            candidate = batch()
            candidate['nodes'].append(duplicate)
            result = preflight(candidate,baseline())
            self.assertTrue(result['invalid'])
            if duplicate['node_code'] == 'C': self.assertFalse(result['reviewable'])

    def test_existing_or_reverse_edge_is_not_new(self):
        for start,end in (('A','B'),('B','A')):
            result = preflight(batch([edge('different-id',start,end)]),baseline())
            self.assertIn('反向边', str(result['invalid']))

    def test_reversed_geometry_requires_swapping_endpoints(self):
        candidate = batch()
        candidate['segments'][0]['geometry']['coordinates'] = list(reversed(candidate['segments'][0]['geometry']['coordinates']))
        self.assertTrue(preflight(candidate,baseline())['invalid'])
        candidate['segments'][0].update(start_node_code='C',end_node_code='A')
        self.assertEqual(len(preflight(candidate,baseline())['reviewable']),1)

    def test_duplicate_reverse_batch_edges_rejected(self):
        result = preflight(batch([edge('one'),edge('two','C','A')]),baseline())
        self.assertEqual(len(result['invalid']),2)

    def test_wrong_coordinates_and_endpoints(self):
        for coords in ([[20.001,10.001],POINTS['C']], [[181,20],POINTS['C']], [[True,20],POINTS['C']], [POINTS['B'],POINTS['C']], [POINTS['A'],POINTS['A']]):
            candidate = batch()
            candidate['segments'][0]['geometry']['coordinates'] = coords
            self.assertTrue(preflight(candidate,baseline())['invalid'])
        candidate = batch()
        candidate['segments'][0]['end_node_code'] = 'inactive-node'
        self.assertTrue(preflight(candidate,baseline())['invalid'])

    def test_self_crossing_line_invalid(self):
        candidate = batch()
        candidate['segments'][0]['geometry']['coordinates'] = [POINTS['A'], [10.004,20.004], [10.001,20.004], [10.004,20.001], POINTS['C']]
        self.assertTrue(preflight(candidate,baseline())['invalid'])

    def test_outside_boundary_is_preserved_and_not_a_connection_bridge(self):
        candidate = batch([edge(),edge('second','C','D')])
        candidate['segments'][0]['geometry']['coordinates'] = [POINTS['A'],[10.012,20.002],POINTS['C']]
        original = deepcopy(candidate)
        result = preflight(candidate,baseline())
        self.assertEqual(len(result['outside_boundary']),1)
        self.assertEqual(len(result['disconnected']),1)
        self.assertFalse(result['reviewable'])
        self.assertEqual(candidate,original)

    def test_nearby_outside_node_requires_expansion_not_invalid_coordinates(self):
        candidate = batch()
        candidate['nodes'][0]['lon'] = 10.012
        candidate['segments'][0]['geometry']['coordinates'] = [POINTS['A'],[10.012,20.003]]
        result = preflight(candidate,baseline())
        self.assertFalse(result['invalid'])
        self.assertEqual(len(result['outside_boundary']),1)

    def test_outside_node_cannot_hide_within_endpoint_tolerance(self):
        candidate = batch([edge(), edge('descendant', 'C', 'D')])
        candidate['nodes'][0].update(lon=10.01002, lat=20.003)
        candidate['segments'][0]['geometry']['coordinates'] = [POINTS['A'], [10.00999, 20.003]]
        candidate['segments'][1]['geometry']['coordinates'] = [[10.00999, 20.003], POINTS['D']]
        result = preflight(candidate, baseline())
        self.assertFalse(result['invalid'])
        self.assertEqual(len(result['outside_boundary']), 2)
        self.assertFalse(result['reviewable'])
        self.assertFalse(result['outside_boundary'][1]['connected_to_active_graph'])

    def test_geometry_crossing_does_not_connect_without_shared_node_id(self):
        candidate = batch([edge('isolated','C','D')])
        # New node sits exactly on A; an ID is not automatically snapped to it.
        candidate['nodes'][0].update(lon=POINTS['A'][0],lat=POINTS['A'][1])
        candidate['segments'][0]['geometry']['coordinates'] = [POINTS['A'],POINTS['D']]
        self.assertEqual(len(preflight(candidate,baseline())['disconnected']),1)

    def test_invalid_or_outside_bridge_does_not_help_descendants(self):
        candidate = batch([edge(),edge('descendant','C','D')])
        del candidate['segments'][0]['source']
        result = preflight(candidate,baseline())
        self.assertEqual(len(result['invalid']),1)
        self.assertEqual(len(result['disconnected']),1)

    def test_source_crs_and_numeric_metric_fail_closed(self):
        for source in (None, {'method':'photo_points','ref':'photos','observed_on':'2026-11-24'},dict(SOURCE,ref=''),dict(SOURCE,observed_on='bad')):
            candidate = batch()
            candidate['segments'][0]['source'] = source
            self.assertTrue(preflight(candidate,baseline())['invalid'])
        for crs in ('GCJ02',None,'EPSG:3857'):
            candidate = batch()
            candidate['crs'] = crs
            self.assertTrue(preflight(candidate,baseline())['batch_errors'])
        for field,value in (('width_m',True),('width_m',0),('slope_percent',-1),('step_count',False),('has_ramp','false')):
            candidate = batch()
            candidate['segments'][0][field] = value
            self.assertTrue(preflight(candidate,baseline())['invalid'])

    def test_malformed_objects_are_reported(self):
        for candidate in (None,{},batch([None]),dict(batch(),nodes=[None]),dict(batch(),segments=[dict(edge(),segment_code=[])])):
            result = preflight(candidate,baseline())
            self.assertTrue(result['batch_errors'] or result['invalid'])

    def test_json_duplicate_and_nonfinite_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'synthetic.json'
            for raw in ('{"crs":"EPSG:4326","crs":"GCJ02"}','{"value":NaN}'):
                path.write_text(raw,encoding='utf-8')
                with self.assertRaises(ValueError): read_json(path)

    def test_real_baseline_read_only_counts_no_app_imports(self):
        actual = load_baseline()
        summary = actual['summary']
        self.assertEqual((summary['nodes'],summary['segments'],summary['pois']),(12,17,6))
        self.assertEqual((summary['survey_sites'],summary['survey_records'],summary['photo_records_with_points'],summary['photo_records_without_points']),(7,67,21,46))
        self.assertEqual(summary['pending_photos'],67)
        self.assertEqual(summary['additional_measured_segments'],0)
        self.assertFalse({'app.core.database','app.core.config','app.db.seeds'} & set(sys.modules))

    def test_baseline_cli_has_no_database_or_file_writes(self):
        paths = list((ROOT/'backend/app/db/seed_data').glob('*.json'))
        before = {path:path.read_bytes() for path in paths}
        process = subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('preflight.py'))],capture_output=True,encoding='utf-8')
        self.assertEqual(process.returncode,0,process.stderr)
        self.assertEqual(json.loads(process.stdout)['baseline']['segments'],17)
        self.assertEqual(before,{path:path.read_bytes() for path in paths})


if __name__ == '__main__':
    unittest.main()
