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
    surface_type: str
    width_m: float
    surface_level: int
    safety_level: int
    barrier_free_level: int
    wheelchair_accessible: bool
    has_handrail: bool
    has_ramp: bool
    shade_coverage_percent: int
    bench_count: int
    step_count: int
