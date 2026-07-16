import math
from copy import deepcopy
from typing import Any


_A = 6378245.0
_EE = 0.006693421622965943


def wgs84_to_gcj02(lon: float, lat: float) -> tuple[float, float]:
    if _outside_china(lon, lat):
        return lon, lat

    delta_lat = _transform_lat(lon - 105.0, lat - 35.0)
    delta_lon = _transform_lon(lon - 105.0, lat - 35.0)
    rad_lat = lat / 180.0 * math.pi
    magic = math.sin(rad_lat)
    magic = 1 - _EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    delta_lat = (delta_lat * 180.0) / (
        (_A * (1 - _EE)) / (magic * sqrt_magic) * math.pi
    )
    delta_lon = (delta_lon * 180.0) / (_A / sqrt_magic * math.cos(rad_lat) * math.pi)
    return lon + delta_lon, lat + delta_lat


def convert_geometry(geometry: dict[str, Any], target: str) -> dict[str, Any]:
    if target not in {"WGS84", "GCJ02"}:
        raise ValueError(f"Unsupported coordinate system: {target}")
    converted = deepcopy(geometry)
    if target == "GCJ02":
        converted["coordinates"] = _convert_coordinates(converted.get("coordinates"))
    return converted


def _convert_coordinates(coordinates: Any) -> Any:
    if not isinstance(coordinates, list):
        return coordinates
    if len(coordinates) >= 2 and all(isinstance(value, (int, float)) for value in coordinates[:2]):
        lon, lat = wgs84_to_gcj02(float(coordinates[0]), float(coordinates[1]))
        return [lon, lat, *coordinates[2:]]
    return [_convert_coordinates(item) for item in coordinates]


def _outside_china(lon: float, lat: float) -> bool:
    return lon < 72.004 or lon > 137.8347 or lat < 0.8293 or lat > 55.8271


def _transform_lat(x: float, y: float) -> float:
    result = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
    result += 0.2 * math.sqrt(abs(x))
    result += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    result += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    result += (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return result


def _transform_lon(x: float, y: float) -> float:
    result = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y
    result += 0.1 * math.sqrt(abs(x))
    result += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    result += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    result += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    return result
