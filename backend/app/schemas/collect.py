from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class CollectionSegmentOptionResponse(BaseModel):
    segment_code: str
    name: str | None
    length_m: float
    slope_percent: float
    width_m: float
    surface_type: str
    start_node_code: str | None
    end_node_code: str | None


class SegmentCollectionSubmitRequest(BaseModel):
    segment_code: str = Field(min_length=1, max_length=50)
    collector: str = Field(min_length=1, max_length=50)
    surface_type: Literal["ASPHALT", "CONCRETE", "BRICK", "GRAVEL", "GRASS", "WOOD", "TILE", "COBBLESTONE"] = (
        "CONCRETE"
    )
    surface_level: int = Field(ge=1, le=5)
    safety_level: int = Field(ge=1, le=5)
    barrier_free_level: int = Field(ge=1, le=5)
    rest_facility_score: int = Field(ge=1, le=5)
    lighting_level: int = Field(ge=1, le=5)
    crossing_safety_level: int = Field(ge=1, le=5)
    width_m: float = Field(ge=0.3, le=20)
    wheelchair_accessible: bool
    has_handrail: bool
    has_ramp: bool
    shade_coverage_percent: int = Field(ge=0, le=100)
    bench_count: int = Field(ge=0, le=50)
    step_count: int = Field(ge=0, le=200)
    step_height_cm: float = Field(ge=0, le=100)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lon: float | None = Field(default=None, ge=-180, le=180)
    photo_urls: list[str] = Field(default_factory=list, max_length=8)
    remark: str = Field(default="", max_length=400)

    @field_validator("segment_code", "collector", mode="before")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value

    @field_validator("photo_urls")
    @classmethod
    def limit_photo_url_length(cls, value: list[str]) -> list[str]:
        if any(len(item) > 300 for item in value):
            raise ValueError("photo URL cannot exceed 300 characters")
        return value


class SegmentCollectionSubmitResponse(BaseModel):
    id: int
    segment_code: str
    status: str
    message: str


class PendingCollectionRecordResponse(BaseModel):
    id: int
    segment_code: str
    segment_name: str | None
    collector_name: str
    surface_type: str
    width_m: float
    surface_level: int
    safety_level: int
    barrier_free_level: int
    rest_facility_score: int
    lighting_level: int
    crossing_safety_level: int
    wheelchair_accessible: bool
    has_handrail: bool
    has_ramp: bool
    shade_coverage_percent: int
    bench_count: int
    step_count: int
    step_height_cm: float
    remark: str | None
    collect_time: datetime
    status: str


class SegmentAuditRequest(BaseModel):
    audit_result: Literal["APPROVED", "REJECTED"]
    auditor: str = Field(default="系统管理员", min_length=1, max_length=50)
    audit_comment: str = Field(default="", max_length=500)

    @field_validator("auditor", mode="before")
    @classmethod
    def strip_auditor(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class SegmentAuditResponse(BaseModel):
    id: int
    collect_record_id: int
    segment_code: str
    audit_result: str
    collect_record_status: str
    message: str
