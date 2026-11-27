from pydantic import BaseModel, Field


class CurrentStartContext(BaseModel):
    segment_code: str
    name: str
    snapped_coordinates: tuple[float, float]
    distance_m: float = Field(ge=0)
    notice: str


class CurrentStartCandidate(BaseModel):
    segment_code: str
    name: str
    snapped_coordinates: tuple[float, float]
    distance_m: float = Field(ge=0)
    allowed: bool
    reasons: list[str]


class CurrentStartOptionsResponse(BaseModel):
    candidates: list[CurrentStartCandidate]
    message: str
    excluded_segment_code: str | None = None


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


class ArrivalBoundaryResponse(BaseModel):
    version: int
    node_code: str
    last_segment_code: str
    kind: str
    source: str
    connection_step_count: int | None = None
    connection_ramp_recorded: bool | None = None


class NavigationRestStopResponse(BaseModel):
    node_code: str
    node_index: int
    name: str


class NavigationRestResponse(BaseModel):
    version: int
    source: str
    segment_codes: list[str]
    node_codes: list[str]
    segment_lengths_m: list[float]
    stops: list[NavigationRestStopResponse]


class RouteCandidateResponse(BaseModel):
    rank: int
    route_score: float
    distance_m: float
    estimated_minutes: int
    segment_codes: list[str]
    segment_names: list[str | None]
    segments: list[RouteSegmentDetailResponse]
    summary: str
    arrival_boundary: ArrivalBoundaryResponse | None = None
    navigation_rest: NavigationRestResponse | None = None


class AvoidedSegmentResponse(BaseModel):
    segment_code: str
    name: str | None
    avoidance_level: str
    reasons: list[str]


class RestRoutePreviewResponse(BaseModel):
    stop_name: str
    stop_after_segment_index: int
    baseline_distance_m: float
    distance_m: float
    baseline_steps: int | None
    steps: int | None
    segment_codes: list[str]
    segment_names: list[str]
    matches_baseline: bool
    segment_lengths_m: list[float] | None = None


class RouteRecommendResponse(BaseModel):
    start_name: str
    end_name: str
    mobility_type: str
    strategy: str
    strategy_label: str
    strategy_description: str
    routes: list[RouteCandidateResponse]
    avoided_segments: list[AvoidedSegmentResponse]
    start_context: CurrentStartContext | None = None
    rest_preview: RestRoutePreviewResponse | None = None
    excluded_segment_code: str | None = None
