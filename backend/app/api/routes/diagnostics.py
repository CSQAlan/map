from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.diagnostics import SegmentDiagnosticsResponse
from app.services.accessibility_diagnostics import diagnose_segments


router = APIRouter()


@router.get("/segments", response_model=SegmentDiagnosticsResponse)
def list_segment_diagnostics(
    db: Session = Depends(get_db),
    limit: int = Query(8, ge=1, le=50),
) -> SegmentDiagnosticsResponse:
    segments = load_active_segments_for_diagnostics(db)
    return SegmentDiagnosticsResponse(
        total_segments=len(segments),
        suggestions=diagnose_segments(segments, limit=limit),
    )


def load_active_segments_for_diagnostics(db: Session) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT
                segment_code,
                name,
                slope_percent,
                surface_type,
                width_m,
                surface_level,
                safety_level,
                barrier_free_level,
                rest_facility_score,
                wheelchair_accessible,
                has_handrail,
                has_ramp,
                shade_coverage_percent,
                bench_count,
                step_count
            FROM road_segment
            WHERE status = 'ACTIVE'
            ORDER BY id
            """
        )
    ).mappings()
    return [dict(row) for row in rows]
