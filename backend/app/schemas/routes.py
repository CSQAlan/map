from pydantic import BaseModel


class RouteCandidateResponse(BaseModel):
    rank: int
    route_score: float
    distance_m: float
    estimated_minutes: int
    segment_codes: list[str]
    segment_names: list[str | None]
    summary: str


class RouteRecommendResponse(BaseModel):
    start_name: str
    end_name: str
    mobility_type: str
    routes: list[RouteCandidateResponse]
