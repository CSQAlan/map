from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SurveySiteResponse(BaseModel):
    site_code: str
    name: str
    record_count: int


class SurveyCoordinateRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    longitude: float = Field(ge=-180, le=180)
    latitude: float = Field(ge=-90, le=90)
    coordinate_system: Literal["GCJ02"] = "GCJ02"
