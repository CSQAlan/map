from pydantic import BaseModel


class RouteSegmentDetailResponse(BaseModel):
    segment_code: str
    name: str | None
    geometry_coordinates: list[list[float]]
    length_m: float
    slope_percent: float
    width_m: float
    step_count: int
    has_ramp: bool
    has_handrail: bool
    wheelchair_accessible: bool
    risk_tags: list[str]
    benefit_tags: list[str]
    explanation: str


class RouteCandidateResponse(BaseModel):
    rank: int
    route_score: float
    distance_m: float
    estimated_minutes: int
    segment_codes: list[str]
    segment_names: list[str | None]
    segments: list[RouteSegmentDetailResponse]
    summary: str


class AvoidedSegmentResponse(BaseModel):
    segment_code: str
    name: str | None
    avoidance_level: str
    reasons: list[str]


class RouteRecommendResponse(BaseModel):
    start_name: str
    end_name: str
    mobility_type: str
    routes: list[RouteCandidateResponse]
    avoided_segments: list[AvoidedSegmentResponse]
