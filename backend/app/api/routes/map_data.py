from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.map_data import PoiResponse, RoadSegmentResponse


router = APIRouter()


@router.get("/pois", response_model=list[PoiResponse])
def list_pois(db: Session = Depends(get_db)) -> list[PoiResponse]:
    rows = db.execute(
        text(
            """
            SELECT id, name, poi_type, is_accessible
            FROM poi_facility
            WHERE status = 'ACTIVE'
            ORDER BY id
            """
        )
    ).mappings()
    return [PoiResponse(**row) for row in rows]


@router.get("/segments", response_model=list[RoadSegmentResponse])
def list_segments(db: Session = Depends(get_db)) -> list[RoadSegmentResponse]:
    rows = db.execute(
        text(
            """
            SELECT id, segment_code, name, length_m, slope_percent, surface_level, safety_level
            FROM road_segment
            WHERE status = 'ACTIVE'
            ORDER BY id
            """
        )
    ).mappings()
    return [RoadSegmentResponse(**row) for row in rows]
