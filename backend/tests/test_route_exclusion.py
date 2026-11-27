"""Offline tests: pure planning plus extracted API body, no configured app/DB import."""
import ast
from copy import deepcopy
import json
from pathlib import Path
from typing import Literal

import pytest
from fastapi import Depends, HTTPException, Query
from app.schemas.routes import RouteRecommendResponse
from app.services.route_exclusion import exclude_active_segment
from app.services.route_planner import (
    recommend_routes, explain_avoided_segments, normalize_route_strategy,
    SUPPORTED_MOBILITY_TYPES, SUPPORTED_ROUTE_STRATEGIES, ROUTE_STRATEGY_METADATA,
)


def edge(code, a, b, length=10, **changes):
    return dict(segment_code=code, name=code, start_node_code=a, end_node_code=b,
                length_m=length, width_m=3, slope_percent=0, step_count=0,
                wheelchair_accessible=True, barrier_free_level=4, **changes)


def graph():
    return [edge('direct', 'A', 'B'), edge('ac', 'A', 'C', 20), edge('cb', 'C', 'B', 20), edge('reverse', 'B', 'A')]


def api(segments):
    # Compile only the endpoint function: never import routes.py/database/config.
    tree = ast.parse((Path(__file__).parents[1] / 'app/api/routes/routes.py').read_text(encoding='utf8'))
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'recommend_route')
    function.decorator_list = []
    namespace = dict(globals(), Session=object, RouteStrategyQuery=str, get_db=lambda: None,
                     resolve_poi_node_code=lambda db, name, area: {'start': 'A', 'end': 'B'}[name],
                     load_active_segments=lambda db, area: segments,
                     rest_route_preview=lambda *args: pytest.fail('must not reuse rest preview'),
                     load_registered_rest_stops=lambda *args: [])  # Optional actual-route REST_AREA catalog, not preview.
    exec(compile(ast.Module(body=[function], type_ignores=[]), '<isolated recommend>', 'exec'), namespace)
    def call(**changes):
        options = dict(start_name='start', end_name='end', mobility_type='WHEELCHAIR', strategy='BALANCED',
                       area_code='SHIDAYUAN', start_longitude=None, start_latitude=None, start_accuracy=None,
                       start_timestamp_ms=None, start_segment_code=None, db=None, prefer_rest=False, exclude_segment_code=None)
        options.update(changes)
        return namespace['recommend_route'](**options)
    return call


def test_alternative_is_full_directed_route_and_graph_unchanged():
    roads = graph()
    original = deepcopy(roads)
    filtered = exclude_active_segment(roads, 'direct')
    result = recommend_routes(filtered, 'A', 'B', 'WHEELCHAIR')
    assert result[0]['segment_codes'] == ['ac', 'cb']
    assert all('direct' not in row['segment_codes'] for row in result)
    assert any(row['segment_code'] == 'reverse' for row in filtered)
    assert roads == original


@pytest.mark.parametrize('code', ['missing', '', 'inactive'])
def test_unknown_inactive_invalid_never_fall_back(code):
    with pytest.raises(ValueError):
        exclude_active_segment(graph() + [dict(edge('inactive', 'A', 'B'), status='INACTIVE')], code)
    with pytest.raises(HTTPException) as caught:
        api(graph())(exclude_segment_code=code)
    assert caught.value.status_code == 422


def test_hard_constraints_and_true_no_path_are_not_relaxed():
    roads = [edge('direct', 'A', 'B'), dict(edge('stairs', 'A', 'C'), step_count=3, wheelchair_accessible=False), edge('cb', 'C', 'B')]
    call = api(roads)
    with pytest.raises(HTTPException) as caught:
        call(exclude_segment_code='direct')
    assert caught.value.status_code == 404
    assert caught.value.detail['code'] == 'NO_ROUTE_WITH_EXCLUSION'
    assert call(exclude_segment_code='direct', mobility_type='INDEPENDENT').routes[0].segment_codes == ['stairs', 'cb']


def test_default_unchanged_and_preview_has_explicit_echo():
    roads = graph()
    call = api(roads)
    assert call().routes[0].segment_codes == recommend_routes(roads, 'A', 'B', 'WHEELCHAIR')[0]['segment_codes']
    assert call().excluded_segment_code is None
    result = call(exclude_segment_code='direct')
    assert result.excluded_segment_code == 'direct'
    assert result.routes[0].segment_codes == ['ac', 'cb']
    assert result.rest_preview is None


@pytest.mark.parametrize('changes', [dict(start_longitude=106), dict(prefer_rest=True)])
def test_location_or_rest_combination_rejected_before_graph_read(changes):
    class Untouchable:
        def __iter__(self):
            pytest.fail('must reject before reading graph')
    with pytest.raises(HTTPException) as caught:
        api(Untouchable())(exclude_segment_code='direct', **changes)
    assert caught.value.status_code == 422


def test_real_seed_cross_route_without_db():
    roads = json.loads((Path(__file__).parents[1] / 'app/db/seed_data/core_segments.json').read_text(encoding='utf8'))
    before = deepcopy(roads)
    baseline = recommend_routes(roads, 'N_SY_GATE_WEST', 'N_SY_LOTUS_ENTRY', 'SLOW_WALKER')
    alternatives = []
    for code in baseline[0]['segment_codes']:
        rows = recommend_routes(exclude_active_segment(roads, code), 'N_SY_GATE_WEST', 'N_SY_LOTUS_ENTRY', 'SLOW_WALKER')
        assert all(code not in row['segment_codes'] for row in rows)
        alternatives += rows
    assert alternatives, 'seed contains at least one complete alternate route'
    assert roads == before
