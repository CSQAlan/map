from pydantic import BaseModel


class SegmentDiagnosticSuggestionResponse(BaseModel):
    segment_code: str
    segment_name: str | None
    issue_type: str
    priority: str
    affected_profiles: list[str]
    problem: str
    suggestion: str
    evidence: list[str]


class SegmentDiagnosticsResponse(BaseModel):
    total_segments: int
    suggestions: list[SegmentDiagnosticSuggestionResponse]
