import pytest

from app.services.coordinates import convert_geometry, gcj02_to_wgs84, wgs84_to_gcj02


def test_wgs84_to_gcj02_is_stable_for_shidayuan() -> None:
    lon, lat = wgs84_to_gcj02(106.3086, 29.60435)
    assert lon == pytest.approx(106.3123, abs=0.001)
    assert lat == pytest.approx(29.6017, abs=0.001)


def test_wgs84_to_gcj02_keeps_outside_china_coordinates() -> None:
    assert wgs84_to_gcj02(2.3522, 48.8566) == (2.3522, 48.8566)


def test_gcj02_to_wgs84_round_trips_within_one_meter() -> None:
    original = (106.3086, 29.60435)
    converted = wgs84_to_gcj02(*original)
    restored = gcj02_to_wgs84(*converted)
    assert restored == pytest.approx(original, abs=1e-7)


def test_gcj02_to_wgs84_keeps_outside_china_coordinates() -> None:
    assert gcj02_to_wgs84(2.3522, 48.8566) == (2.3522, 48.8566)


def test_convert_geometry_recursively_converts_linestring() -> None:
    source = {"type": "LineString", "coordinates": [[106.3086, 29.60435], [106.309, 29.605]]}
    converted = convert_geometry(source, "GCJ02")
    assert converted is not source
    assert converted["coordinates"][0] != source["coordinates"][0]
    assert source["coordinates"][0] == [106.3086, 29.60435]


def test_convert_geometry_rejects_unknown_target() -> None:
    with pytest.raises(ValueError, match="Unsupported coordinate system"):
        convert_geometry({"type": "Point", "coordinates": [106.3, 29.6]}, "BD09")
