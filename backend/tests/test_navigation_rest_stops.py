"""#11: offline evidence tests, synthetic chains and public repository seed only.

No configured route module, app/database/config, DB, GPS or HTTP service loaded.
Plan: verify graph proof, optional DTO/API attachment, then real normal candidates;
the separate 444m preview is deliberately never a navigation positive fixture.
"""
import ast
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
from typing import Literal

import pytest
from fastapi import Depends, HTTPException, Query
from sqlalchemy import text
from app.schemas.routes import RouteCandidateResponse, RouteRecommendResponse
from app.services.navigation_rest_stops import navigation_rest_stops
from app.services.rest_route_preview import rest_route_preview
from app.services.route_planner import (
    recommend_routes, explain_avoided_segments, normalize_route_strategy,
    SUPPORTED_MOBILITY_TYPES, SUPPORTED_ROUTE_STRATEGIES, ROUTE_STRATEGY_METADATA,
)
from app.services.route_exclusion import exclude_active_segment
from app.services.current_origin import attach_origin, CURRENT_NODE


def edge(code, a, b, length=50, **changes):
    return dict(segment_code=code, start_node_code=a, end_node_code=b, name='合成路段',
                length_m=length, width_m=3, slope_percent=0, step_count=0,
                wheelchair_accessible=True, barrier_free_level=4, **changes)


def graph():
    return [edge('ar', 'A', 'R', 100), edge('rq', 'R', 'Q', 50), edge('qt', 'Q', 'T', 30)]


def catalog():
    return [dict(name='合成登记点', linked_node_code=node) for node in ['A', 'R', 'Q', 'T']]


def candidate(roads=None):
    return recommend_routes(roads or graph(), 'A', 'T', 'SLOW_WALKER')[0]


def evidence(route=None, roads=None, pois=None):
    return navigation_rest_stops(route or candidate(), roads or graph(), 'A', 'T', catalog() if pois is None else pois)


def test_complete_directed_evidence_preserves_start_intermediate_destination_and_real_lengths():
    r, g, p = candidate(), graph(), catalog()
    before = deepcopy((r, g, p))
    meta = evidence(r, g, p)
    assert meta['segment_codes'] == ['ar', 'rq', 'qt']
    assert meta['node_codes'] == ['A', 'R', 'Q', 'T']
    assert meta['segment_lengths_m'] == [100, 50, 30]
    assert [stop['node_index'] for stop in meta['stops']] == [0, 1, 2, 3]
    assert (r, g, p) == before
    assert RouteCandidateResponse(**r).navigation_rest is None  # older server/client compatible
    assert RouteCandidateResponse(**r, navigation_rest=meta).navigation_rest.stops[1].node_code == 'R'
    assert evidence(pois=[])['stops'] == []  # actual empty catalog != missing
    assert navigation_rest_stops(r, g, 'A', 'T', None) is None


@pytest.mark.parametrize('mutation', ['missing', 'duplicate', 'order', 'disconnected', 'reverse', 'cycle', 'inactive'])
def test_bad_graph_or_order_never_claims_no_stops(mutation):
    roads = graph()
    if mutation == 'missing': roads.pop(1)
    if mutation == 'duplicate': roads.append(deepcopy(roads[0]))
    if mutation == 'order': roads[1]['start_node_code'] = 'T'
    if mutation == 'disconnected': roads[1]['start_node_code'] = 'X'
    if mutation == 'reverse': roads[0].update(start_node_code='R', end_node_code='A')
    if mutation == 'cycle': roads[1]['end_node_code'] = 'A'
    if mutation == 'inactive': roads[0]['status'] = 'INACTIVE'
    assert evidence(roads=roads) is None


@pytest.mark.parametrize('mutation', ['missing-row', 'reorder', 'repeated-code', 'wrong-total', 'wrong-length'])
def test_candidate_must_match_entire_actual_searched_path(mutation):
    r = candidate()
    if mutation == 'missing-row': r['segments'].pop()
    if mutation == 'reorder': r['segments'].reverse()
    if mutation == 'repeated-code': r['segment_codes'][1] = 'ar'
    if mutation == 'wrong-total': r['distance_m'] += 1
    if mutation == 'wrong-length': r['segments'][0]['length_m'] += 1
    assert evidence(route=r) is None


@pytest.mark.parametrize('value', [None, 0, -1, False, '100', float('nan'), float('inf'), Decimal('sNaN'), 10 ** 1000])
def test_bad_real_length_not_planner_default_or_zero(value):
    roads = graph(); roads[0]['length_m'] = value
    assert evidence(roads=roads) is None


@pytest.mark.parametrize('pois', [
    [{}], [None], [{'linked_node_code': 'R', 'name': ''}],
    [{'linked_node_code': None, 'name': 'missing stable link'}],
    [{'linked_node_code': 'R', 'name': 'one'}, {'linked_node_code': 'R', 'name': 'two'}],
    [{'linked_node_code': 'R', 'name': 'one', 'registered_node_code': None}],
    [{'linked_node_code': 'R', 'name': 'one', 'poi_type': 'SERVICE_ACCESS'}],
    [{'linked_node_code': 'R', 'name': 'one', 'status': 'INACTIVE'}],
])
def test_missing_catalog_links_duplicate_same_node_or_non_rest_are_unknown(pois):
    assert evidence(pois=pois) is None


def test_gps_clipped_directed_leg_uses_real_remaining_registered_length_not_old_origin():
    roads = graph()
    roads[0].update(length_m=Decimal('100'), geom_geojson={
        'type': 'LineString', 'coordinates': [[106, 29], [106.001, 29]]})  # synthetic GPS only
    clipped, start, _ = attach_origin(roads, [106.0005, 29], 'ar', 'SLOW_WALKER')
    r = recommend_routes(clipped, start, 'T', 'SLOW_WALKER')[0]
    meta = navigation_rest_stops(r, clipped, start, 'T', catalog())
    assert start == CURRENT_NODE and meta['node_codes'] == [CURRENT_NODE, 'R', 'Q', 'T']
    assert meta['segment_lengths_m'] == [50, 50, 30]
    assert meta['stops'][0]['node_code'] == 'R'
    assert navigation_rest_stops(r, roads, 'A', 'T', catalog()) is None


def isolated_api(roads, loader):
    source = Path(__file__).parents[1] / 'app/api/routes/routes.py'
    f = next(n for n in ast.parse(source.read_text(encoding='utf8')).body
             if isinstance(n, ast.FunctionDef) and n.name == 'recommend_route')
    f.decorator_list = []
    namespace = dict(globals(), Session=object, RouteStrategyQuery=str, get_db=lambda: None,
                     resolve_poi_node_code=lambda db, name, area: {'start':'A', 'end':'T'}[name],
                     load_active_segments=lambda *args: roads, load_registered_rest_stops=loader)
    exec(compile(ast.Module(body=[f], type_ignores=[]), '<offline actual endpoint>', 'exec'), namespace)
    return lambda **changes: namespace['recommend_route'](**dict(dict(
        start_name='start', end_name='end', mobility_type='SLOW_WALKER', strategy='BALANCED',
        area_code='SHIDAYUAN', start_longitude=None, start_latitude=None, start_accuracy=None,
        start_timestamp_ms=None, start_segment_code=None, db=None, prefer_rest=False, exclude_segment_code=None), **changes))


def test_endpoint_attaches_each_actual_candidate_once_without_changing_route_or_exclusion():
    roads = [edge('direct', 'A', 'T', 70), *graph()]
    calls = []
    api = isolated_api(roads, lambda *args: calls.append(args) or catalog())
    ordinary = api()
    assert len(calls) == 1
    expected = recommend_routes(roads, 'A', 'T', 'SLOW_WALKER')
    assert [r.segment_codes for r in ordinary.routes] == [r['segment_codes'] for r in expected]
    assert ordinary.routes[0].navigation_rest.stops[-1].node_code == 'T'
    excluded = api(exclude_segment_code='direct')
    assert len(calls) == 2 and excluded.excluded_segment_code == 'direct'
    assert excluded.routes[0].navigation_rest.segment_codes == ['ar', 'rq', 'qt']
    assert excluded.routes[0].navigation_rest.node_codes == ['A', 'R', 'Q', 'T']
    assert excluded.rest_preview is None


def test_catalog_failure_and_corruption_remain_optional_unknown_not_route_failure():
    def unavailable(*args): raise RuntimeError('synthetic catalog unavailable')
    for loader in [unavailable, lambda *args: [{}], lambda *args: None]:
        result = isolated_api(graph(), loader)()
        assert result.routes[0].distance_m == 180
        assert result.routes[0].navigation_rest is None


def test_existing_predeparture_preview_reuses_catalog_but_is_not_candidate_evidence():
    roads = [edge('direct', 'A', 'T', 70), *graph()]
    calls = []
    result = isolated_api(roads, lambda *args: calls.append(args) or catalog())(prefer_rest=True)
    assert len(calls) == 1
    assert result.rest_preview.distance_m == 180
    assert result.routes[0].distance_m == 70
    assert result.routes[0].navigation_rest.node_codes == ['A', 'T']
    assert all(stop.node_index in (0, 1) for stop in result.routes[0].navigation_rest.stops)


def test_existing_catalog_query_is_active_area_rest_only_and_preserves_missing_link_evidence():
    # Inspect/execute only the loader with a synthetic SQL receiver, never a DB.
    source = Path(__file__).parents[1] / 'app/api/routes/routes.py'
    f = next(n for n in ast.parse(source.read_text(encoding='utf8')).body
             if isinstance(n, ast.FunctionDef) and n.name == 'load_registered_rest_stops')
    namespace = dict(Session=object, text=text)
    exec(compile(ast.Module(body=[f], type_ignores=[]), '<offline catalog>', 'exec'), namespace)
    class Receiver:
        def execute(self, sql, params):
            self.sql, self.params = str(sql), params
            return self
        def mappings(self): return [dict(name='synthetic missing link', linked_node_code=None, registered_node_code=None)]
    db = Receiver()
    records = namespace['load_registered_rest_stops'](db, 'SHIDAYUAN')
    assert "pf.poi_type = 'REST_AREA'" in db.sql and "pf.status = 'ACTIVE'" in db.sql
    assert "pa.status = 'ACTIVE'" in db.sql and db.params == {'area_code': 'SHIDAYUAN'}
    assert 'LEFT JOIN road_node' in db.sql and 'IS NOT NULL' not in db.sql
    assert evidence(pois=records) is None


def seed(name):
    return json.loads((Path(__file__).parents[1] / 'app/db/seed_data' / f'{name}.json').read_text(encoding='utf8'))


def test_real_normal_seed_endpoints_no_middle_rest_and_no_wheelchair_relaxation():
    roads, pois = seed('core_segments'), seed('core_pois')
    before = deepcopy((roads, pois))
    stops = [p for p in pois if p['poi_type'] == 'REST_AREA']
    for target, profile, distance in [('N_SY_GARDEN_REST', 'SLOW_WALKER', 270),
                                      ('N_SY_LOTUS_ENTRY', 'WHEELCHAIR', 246)]:
        routes = recommend_routes(roads, 'N_SY_GATE_WEST', target, profile)
        assert routes[0]['distance_m'] == distance
        meta = navigation_rest_stops(routes[0], roads, 'N_SY_GATE_WEST', target, stops)
        assert meta is not None
        assert [s['node_index'] for s in meta['stops']] == [len(routes[0]['segment_codes'])]
        assert meta['node_codes'][-1] == target
        assert 'S_SY_LOTUS_ENTRY_TO_PLATFORM' not in routes[0]['segment_codes']
    assert recommend_routes(roads, 'N_SY_GATE_WEST', 'N_SY_GARDEN_REST', 'WHEELCHAIR') == []
    b = recommend_routes(roads, 'N_SY_GATE_WEST', 'N_SY_BUILDING_B', 'WHEELCHAIR')[0]
    assert navigation_rest_stops(b, roads, 'N_SY_GATE_WEST', 'N_SY_BUILDING_B', stops)['stops'] == []
    # All actual normal top-3 options, both profiles/all five strategies, named POI pairs.
    # Unlike the separate bounded preview, these are the planner's launchable candidates.
    positives = []
    for start in pois:
        for end in pois:
            if start['linked_node_code'] == end['linked_node_code']: continue
            for profile in ['SLOW_WALKER', 'WHEELCHAIR']:
                for strategy in sorted(SUPPORTED_ROUTE_STRATEGIES):
                    for r in recommend_routes(roads, start['linked_node_code'], end['linked_node_code'], profile, strategy=strategy):
                        meta = navigation_rest_stops(r, roads, start['linked_node_code'], end['linked_node_code'], stops)
                        assert meta is not None
                        if any(0 < s['node_index'] < len(r['segment_codes']) for s in meta['stops']):
                            positives.append((profile, strategy, r['segment_codes']))
    assert positives == [], 'Reassess real positive fixtures if the formal seed changes'
    assert (roads, pois) == before
