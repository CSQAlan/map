"""Offline endpoint checks; no configuration, database or coordinates consumed."""
import copy
import json
from pathlib import Path

from app.services.arrival_boundary import arrival_boundary
from app.services.route_planner import recommend_routes
from app.services.route_exclusion import exclude_active_segment
from app.schemas.routes import RouteCandidateResponse


def seed(name):
    return json.loads((Path(__file__).resolve().parents[1] / 'app/db/seed_data' / f'{name}.json').read_text(encoding='utf-8'))


def test_real_seed_resolved_anchor_and_unchanged_route():
    pois, nodes, edges = seed('core_pois'), seed('core_nodes'), seed('core_segments')
    target = next(p for p in pois if p['linked_node_code'] == 'N_SY_LOTUS_ENTRY')
    assert target['poi_type'] == 'REST_AREA'
    assert any(n['node_code'] == 'N_SY_LOTUS_ENTRY' for n in nodes)
    assert any(n['node_code'] == 'N_SY_LOTUS_PLATFORM' for n in nodes)
    original = copy.deepcopy(edges)
    routes = recommend_routes(edges, 'N_SY_GATE_WEST', target['linked_node_code'], 'WHEELCHAIR', strategy='BALANCED')
    route = routes[0]
    before = copy.deepcopy(route)
    boundary = arrival_boundary('SHIDAYUAN', target['linked_node_code'], route, edges)
    assert boundary['kind'] == 'LOTUS_ENTRY'
    assert boundary['connection_step_count'] == 1
    # Core seed omits ramp; loader default False is not evidence of a real ramp.
    connector = next(e for e in edges if e['segment_code'] == 'S_SY_LOTUS_ENTRY_TO_PLATFORM')
    assert connector.get('has_ramp') is None
    assert boundary['connection_ramp_recorded'] is None
    assert route['distance_m'] == 246
    assert route['segment_codes'][-1] == 'S_SY_MAIN_TO_LOTUS'
    assert 'S_SY_LOTUS_ENTRY_TO_PLATFORM' not in route['segment_codes']
    assert RouteCandidateResponse(**route, arrival_boundary=boundary).arrival_boundary.node_code == 'N_SY_LOTUS_ENTRY'
    assert route == before and edges == original


def test_detour_same_endpoint_and_other_facilities_only_network_node():
    edges = seed('core_segments')
    graph = exclude_active_segment(edges, 'S_SY_GATE_TO_MAIN')
    detours = recommend_routes(graph, 'N_SY_GATE_WEST', 'N_SY_LOTUS_ENTRY', 'WHEELCHAIR', strategy='BALANCED')
    assert detours
    for route in detours:
        assert arrival_boundary('SHIDAYUAN', 'N_SY_LOTUS_ENTRY', route, edges)['kind'] == 'LOTUS_ENTRY'
    for route in recommend_routes(edges, 'N_SY_GATE_WEST', 'N_SY_BUILDING_B', 'WHEELCHAIR', strategy='BALANCED'):
        assert arrival_boundary('SHIDAYUAN', 'N_SY_BUILDING_B', route, edges)['kind'] == 'NETWORK_NODE'


def test_missing_wrong_or_duplicate_evidence_is_conservative():
    edge = dict(segment_code='edge', end_node_code='N_SY_LOTUS_ENTRY')
    route = dict(segment_codes=['edge'])
    for bad_route, bad_edges in [(None, [edge]), ({}, [edge]), (route, None), (route, [None]),
                                  (route, []), (route, [edge, edge]), (route, [{**edge, 'end_node_code':'other'}])]:
        assert arrival_boundary('SHIDAYUAN', 'N_SY_LOTUS_ENTRY', bad_route, bad_edges) is None
    assert arrival_boundary('OTHER', 'N_SY_LOTUS_ENTRY', route, [edge])['kind'] == 'NETWORK_NODE'
    assert arrival_boundary('SHIDAYUAN', 'N_SY_LOTUS_ENTRY', route, [edge])['connection_step_count'] is None
