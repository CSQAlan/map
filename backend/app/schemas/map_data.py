from pydantic import BaseModel


class PoiResponse(BaseModel):
    id: int
    name: str
    poi_type: str
    is_accessible: bool


class RoadSegmentResponse(BaseModel):
    id: int
    segment_code: str
    name: str | None
    length_m: float
    slope_percent: float
    surface_level: int
    safety_level: int
