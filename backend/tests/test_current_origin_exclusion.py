"""Synthetic fixes + real seed pure planning. Isolated HTTP app, no config/DB."""
import ast
from copy import deepcopy
import json
from pathlib import Path
from typing import Literal

import pytest
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.testclient import TestClient
from app.schemas.routes import CurrentStartOptionsResponse, RouteRecommendResponse
from app.services import current_origin
from app.services.current_origin import (
    CurrentOriginError, attach_origin, nearby_starts, validate_fix, exclusion_location_graph,
)
from app.services.route_exclusion import exclude_active_segment
from app.services.route_planner import (
    recommend_routes, explain_avoided_segments, normalize_route_strategy,
    SUPPORTED_MOBILITY_TYPES, SUPPORTED_ROUTE_STRATEGIES, ROUTE_STRATEGY_METADATA,
)

POINT = [106.0005, 29]


def road(code='alternative', latitude=29, start='A', end='B', **changes):
    result = dict(segment_code=code, name=code, start_node_code=start, end_node_code=end,
                  length_m=100, width_m=3, slope_percent=1, step_count=0,
                  wheelchair_accessible=True, barrier_free_level=4,
                  geom_geojson={'type': 'LineString', 'coordinates': [[106, latitude], [106.001, latitude]]})
    result.update(changes)
    return result


def roads():
    return [road(), road('excluded', 29.001, 'X', 'Y')]


@pytest.fixture(autouse=True)
def explicit_clock(monkeypatch):
    monkeypatch.setattr(current_origin.time, 'time', lambda: 1000)


def client_for(segments, covered=True):
    # Extract actual endpoint bodies/declarations but never import the configured
    # routes module. Register real Query/Pydantic validation on an isolated app.
    tree = ast.parse((Path(__file__).parents[1] / 'app/api/routes/routes.py').read_text(encoding='utf8'))
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('recommend_route', 'current_start_options')]
    for function in functions:
        function.decorator_list = []
    def coverage(*args):
        if not covered:
            raise CurrentOriginError('outside pilot')
    namespace = dict(globals(), Session=object, RouteStrategyQuery=Literal['BALANCED', 'SAFEST', 'FLATTEST', 'COMFORT', 'SHORTEST'],
                     get_db=lambda: None, ensure_location_covered=coverage,
                     resolve_poi_node_code=lambda db, name, area: {'start': 'A', 'end': 'B'}[name],
                     load_active_segments=lambda db, area: deepcopy(segments),
                     rest_route_preview=lambda *args: pytest.fail('must not query rest'),
                     load_registered_rest_stops=lambda *args: [])  # Optional actual-route catalog; preview still forbidden.
    exec(compile(ast.Module(body=functions, type_ignores=[]), '<isolated location exclusion endpoints>', 'exec'), namespace)
    app = FastAPI()
    app.get('/start-options', response_model=CurrentStartOptionsResponse)(namespace['current_start_options'])
    app.get('/recommend', response_model=RouteRecommendResponse)(namespace['recommend_route'])
    return TestClient(app)


def options(**changes):
    return dict(longitude=POINT[0], latitude=POINT[1], accuracy=1, timestamp_ms=1000000,
                mobility_type='WHEELCHAIR', exclude_segment_code='excluded', **changes)


def params(**changes):
    result = dict(start_longitude=POINT[0], start_latitude=POINT[1], start_accuracy=1,
                  start_timestamp_ms=1000000, start_segment_code='alternative', end_name='end',
                  mobility_type='WHEELCHAIR', strategy='BALANCED', exclude_segment_code='excluded')
    result.update(changes)
    return result


def both(segments, fix=None, selected='alternative', covered=True):
    fix = fix or {}
    opt = options(); opt.update(fix)
    rec = params(start_segment_code=selected)
    for key, value in fix.items():
        rec[{'longitude': 'start_longitude', 'latitude': 'start_latitude', 'accuracy': 'start_accuracy',
             'timestamp_ms': 'start_timestamp_ms'}.get(key, key)] = value
    client = client_for(segments, covered)
    return client.get('/start-options', params=opt), client.get('/recommend', params=rec)


def assert_error(response, code, status=422):
    assert response.status_code == status, response.text
    assert response.json()['detail']['code'] == code
    assert response.json()['detail']['message']


def test_confirmed_alternative_clips_real_geometry_keeps_exclusion_and_direction():
    source = roads(); before = deepcopy(source)
    choices, result = both(source)
    assert choices.status_code == result.status_code == 200
    assert choices.json()['excluded_segment_code'] == 'excluded'
    assert [row['segment_code'] for row in choices.json()['candidates']] == ['alternative']
    payload = result.json()
    assert payload['excluded_segment_code'] == 'excluded'
    assert payload['rest_preview'] is None
    assert payload['start_context']['segment_code'] == 'alternative'
    assert payload['routes'][0]['distance_m'] == pytest.approx(50)
    assert payload['routes'][0]['segments'][0]['geometry_coordinates'][0] == pytest.approx(POINT)
    assert all('excluded' not in code for row in payload['routes'] for code in row['segment_codes'])
    assert source == before


@pytest.mark.parametrize('latitude,code', [(29.001, 'ON_EXCLUDED_SEGMENT'), (29.00104, 'ONLY_EXCLUDED_NEARBY')])
def test_on_or_only_near_excluded_cannot_jump(latitude, code):
    for response in both(roads(), {'latitude': latitude}):
        assert_error(response, code)


@pytest.mark.parametrize('graph,fix', [
    ([road(), road('excluded', 29.00005, 'X', 'Y')], {'accuracy': 4}),
    ([road(), road('excluded', 29, 'B', 'A')], {'accuracy': 0}),
    ([road(), road('excluded', 29, 'A', 'X', geom_geojson={'type': 'LineString', 'coordinates': [[106,29], [106,29.001]]})], {'longitude': 106, 'accuracy': 0}),
])
def test_uncertain_adjacent_reverse_and_shared_node_declined(graph, fix):
    for response in both(graph, fix):
        assert_error(response, 'AMBIGUOUS_EXCLUDED_LOCATION')


def test_explicit_excluded_unknown_or_unreachable_selection_never_auto_substitutes():
    client = client_for(roads())
    assert_error(client.get('/recommend', params=params(start_segment_code='excluded')), 'EXCLUDED_START_SELECTED')
    assert_error(client.get('/recommend', params=params(start_segment_code='unknown')), 'SELECTED_START_UNAVAILABLE')
    assert_error(client.get('/recommend', params=params(start_segment_code='excluded:partial')), 'SELECTED_START_UNAVAILABLE')


@pytest.mark.parametrize('code', ['unknown', 'inactive'])
def test_unknown_or_inactive_same_failure_both_endpoints(code):
    graph = roads() + [road('inactive', status='INACTIVE')]
    for response in both(graph, {'exclude_segment_code': code}):
        assert_error(response, 'EXCLUDED_SEGMENT_UNAVAILABLE')


@pytest.mark.parametrize('fix', [{'accuracy': 31}, {'timestamp_ms': 939999}, {'timestamp_ms': 1005001}])
def test_existing_accuracy_and_age_gates_stay_in_force(fix):
    for response in both(roads(), fix):
        assert_error(response, 'INVALID_CURRENT_ORIGIN')


def test_coverage_hard_profile_and_no_route_are_not_relaxed():
    for response in both(roads(), covered=False):
        assert_error(response, 'INVALID_CURRENT_ORIGIN')
    graph = [road(step_count=3, wheelchair_accessible=False), roads()[1]]
    for response in both(graph):
        assert_error(response, 'NO_COMPATIBLE_START')
    graph = [road(end='C'), roads()[1]]
    choices, result = both(graph)
    assert choices.status_code == 200
    assert_error(result, 'NO_ROUTE_WITH_EXCLUSION', 404)
    # Existing direction is not synthesized into a reverse edge.
    client = client_for(roads())
    assert_error(client.get('/recommend', params=params(end_name='start')), 'NO_ROUTE_WITH_EXCLUSION', 404)


def test_no_parameter_regression_and_rest_conflict():
    client = client_for(roads())
    opt = options(); del opt['exclude_segment_code']
    ordinary = params(); del ordinary['exclude_segment_code']
    assert client.get('/start-options', params=opt).status_code == 200
    result = client.get('/recommend', params=ordinary)
    assert result.status_code == 200
    assert result.json()['routes'][0]['distance_m'] == pytest.approx(50)
    assert result.json()['excluded_segment_code'] is None
    assert_error(client.get('/recommend', params=params(prefer_rest='true')), 'EXCLUSION_REST_CONFLICT')
    opt['exclude_segment_code'] = 'x' * 101
    assert client.get('/start-options', params=opt).status_code == 422


def test_missing_exclusion_geometry_is_unconfirmed_not_assumed_distant():
    graph = [road(), road('excluded', geom_geojson=None)]
    for response in both(graph):
        assert_error(response, 'EXCLUSION_GEOMETRY_UNCONFIRMED')


def test_near_excluded_but_clearly_distinct_alternative_and_strategy():
    # Both within the existing entry gate, but distance ranges do not overlap.
    graph = [road(), road('excluded', 29.0001, 'X', 'Y')]
    choices, result = both(graph)
    assert choices.status_code == result.status_code == 200
    assert [c['segment_code'] for c in choices.json()['candidates']] == ['alternative']
    result = client_for(graph).get('/recommend', params=params(strategy='FLATTEST'))
    assert result.status_code == 200
    assert result.json()['strategy'] == 'FLATTEST'
    assert result.json()['routes'][0]['segment_codes'] == ['alternative']


def test_entry_radius_not_enlarged_by_accuracy_or_exclusion():
    # Alternative >20 m from sample; exclusion is far away, not an excuse to snap.
    for response in both(roads(), {'latitude': 28.9998, 'accuracy': 1}):
        assert_error(response, 'NO_COMPATIBLE_START')


def test_real_seed_named_wheelchair_regression_without_database():
    graph = json.loads((Path(__file__).parents[1] / 'app/db/seed_data/core_segments.json').read_text(encoding='utf8'))
    before = deepcopy(graph)
    args = ('N_SY_GATE_WEST', 'N_SY_BUILDING_B', 'WHEELCHAIR')
    assert recommend_routes(graph, *args)[0]['distance_m'] == 186
    result = recommend_routes(exclude_active_segment(graph, 'S_SY_GATE_TO_MAIN'), *args)
    assert result[0]['distance_m'] == 290
    assert all('S_SY_GATE_TO_MAIN' not in row['segment_codes'] for row in result)
    assert recommend_routes(exclude_active_segment(graph, 'S_SY_MAIN_TO_BUILDING_B'), *args) == []
    assert graph == before
