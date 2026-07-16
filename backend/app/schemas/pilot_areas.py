from typing import Literal

from pydantic import BaseModel


class LimitBoundsResponse(BaseModel):
    south_west: list[float]
    north_east: list[float]


class PilotAreaResponse(BaseModel):
    area_code: str
    name: str
    coordinate_system: Literal["WGS84", "GCJ02"]
    center: list[float]
    boundary: dict
    limit_bounds: LimitBoundsResponse
    min_zoom: int
    max_zoom: int
