import json
import time

import pytest

from app.services.current_origin import CurrentOriginError, attach_origin, nearby_starts, project_to_line, validate_fix
from app.services.route_planner import recommend_routes


def road(**changes):
    return dict(segment_code='road', name='入口步道', start_node_code='A', end_node_code='B',
                length_m=100, geom_geojson=json.dumps({'type': 'LineString', 'coordinates': [[106, 29], [106.001, 29]]}),
                step_count=0, slope_percent=1, width_m=3, wheelchair_accessible=True,
                surface_level=4, safety_level=4, barrier_free_level=4, **changes)


def test_midway_origin_trims_geometry_and_length_without_creating_reverse_edges():
    roads, start, context = attach_origin([road()], [106.0005, 29], 'road', 'WHEELCHAIR')
    routes = recommend_routes(roads, start, 'B', 'WHEELCHAIR')
    assert routes[0]['distance_m'] == pytest.approx(50)
    assert routes[0]['segments'][0]['geometry_coordinates'][0] == pytest.approx([106.0005, 29])
    assert not recommend_routes(roads, start, 'A', 'WHEELCHAIR')
    assert context['segment_code'] == 'road'


def test_endpoint_uses_existing_node_and_projection_follows_bent_line():
    _, start, _ = attach_origin([road()], [106, 29], 'road', 'WHEELCHAIR')
    assert start == 'A'
    projection = project_to_line([106.001, 29.0005], [[106, 29], [106.001, 29], [106.001, 29.001]])
    assert projection['index'] == 1
    assert projection['distance_m'] == pytest.approx(0)


def test_unknown_gap_is_not_turned_into_a_navigation_connector():
    assert nearby_starts([road()], [106.01, 29.01], 'WHEELCHAIR') == []
    with pytest.raises(CurrentOriginError, match='不在已收录道路附近'):
        attach_origin([road()], [106.01, 29.01], 'road', 'WHEELCHAIR')


def test_nearest_blocked_road_is_reported_not_silently_skipped():
    stairs = road()
    stairs.update(step_count=5, wheelchair_accessible=False)
    candidates = nearby_starts([stairs], [106.0005, 29], 'WHEELCHAIR')
    assert candidates[0]['allowed'] is False
    assert candidates[0]['reasons']
    with pytest.raises(CurrentOriginError, match='不符合当前出行条件'):
        attach_origin([stairs], [106.0005, 29], 'road', 'WHEELCHAIR')


def test_partial_segment_does_not_guess_the_location_of_steps():
    stairs = road()
    stairs.update(step_count=3, has_ramp=True)
    roads, _, _ = attach_origin([stairs], [106.0005, 29], 'road', 'INDEPENDENT')
    assert roads[-1]['step_count'] == 3
    assert roads[-1]['length_m'] == pytest.approx(50)


@pytest.mark.parametrize('accuracy,age', [(100, 0), (-1, 0), (10, 61000), (10, -6000)])
def test_invalid_or_stale_fixes_are_rejected(accuracy, age):
    with pytest.raises(CurrentOriginError):
        validate_fix(106, 29, accuracy, time.time() * 1000 - age)
