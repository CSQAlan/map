from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class SosEventCreateRequest(BaseModel):
    elder_name: str = Field(default="演示老人", min_length=1, max_length=50)
    mobility_type: str | None = Field(default=None, max_length=30)
    route_summary: str | None = Field(default=None, max_length=200)
    current_step: str | None = Field(default=None, max_length=200)
    destination_name: str | None = Field(default=None, max_length=100)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lon: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_location_pair(self) -> "SosEventCreateRequest":
        if (self.location_lat is None) != (self.location_lon is None):
            raise ValueError("location_lat and location_lon must be provided together")
        return self


class SosEventResponse(BaseModel):
    id: int
    event_type: str
    event_status: str
    message: str
    notified_contacts: list[dict]
    created_at: datetime | None = None


class EmergencyEventListItemResponse(BaseModel):
    id: int
    event_type: str
    event_status: str
    elder_name: str | None
    description: str | None
    notified_contacts: list[dict]
    location_lon: float | None = None
    location_lat: float | None = None
    created_at: datetime | None = None
