import json

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.collect import (
    CollectionSegmentOptionResponse,
    PendingCollectionRecordResponse,
    SegmentCollectionSubmitRequest,
    SegmentCollectionSubmitResponse,
)
from app.services.segment_collection_importer import ensure_collector_user


router = APIRouter()


@router.get("/segments", response_model=list[CollectionSegmentOptionResponse])
def list_collection_segments(db: Session = Depends(get_db)) -> list[CollectionSegmentOptionResponse]:
    rows = db.execute(
        text(
            """
            SELECT
                rs.segment_code,
                rs.name,
                rs.length_m,
                rs.slope_percent,
                rs.width_m,
                rs.surface_type,
                rn_start.osm_node_ref AS start_node_code,
                rn_end.osm_node_ref AS end_node_code
            FROM road_segment rs
            JOIN road_node rn_start ON rn_start.id = rs.start_node_id
            JOIN road_node rn_end ON rn_end.id = rs.end_node_id
            WHERE rs.status = 'ACTIVE'
            ORDER BY rs.id
            """
        )
    ).mappings()
    return [CollectionSegmentOptionResponse(**row) for row in rows]


@router.post("/segments", response_model=SegmentCollectionSubmitResponse, status_code=201)
def submit_collection_record(
    payload: SegmentCollectionSubmitRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> SegmentCollectionSubmitResponse:
    segment_id = get_active_segment_id(db, payload.segment_code)
    if segment_id is None:
        raise HTTPException(status_code=404, detail=f"Road segment not found: {payload.segment_code}")

    remark = build_collection_remark(payload)
    try:
        collector_user_id = ensure_collector_user(db, payload.collector)
        existing_record_id = get_existing_pending_collection_id(db, segment_id, collector_user_id)
        if existing_record_id is not None:
            response.status_code = 200
            return SegmentCollectionSubmitResponse(
                id=existing_record_id,
                segment_code=payload.segment_code,
                status="PENDING",
                message="今天已提交过该路段采集记录，已保留原待审核记录。",
            )

        record_id = db.execute(
            text(
                """
                INSERT INTO segment_collect_record (
                    road_segment_id,
                    collector_user_id,
                    surface_level,
                    surface_type,
                    width_m,
                    safety_level,
                    barrier_free_level,
                    rest_facility_score,
                    lighting_level,
                    crossing_safety_level,
                    wheelchair_accessible,
                    has_handrail,
                    has_ramp,
                    shade_coverage_percent,
                    bench_count,
                    step_count,
                    step_height_cm,
                    remark,
                    photo_urls,
                    collect_time,
                    status
                )
                VALUES (
                    :road_segment_id,
                    :collector_user_id,
                    :surface_level,
                    :surface_type,
                    :width_m,
                    :safety_level,
                    :barrier_free_level,
                    :rest_facility_score,
                    :lighting_level,
                    :crossing_safety_level,
                    :wheelchair_accessible,
                    :has_handrail,
                    :has_ramp,
                    :shade_coverage_percent,
                    :bench_count,
                    :step_count,
                    :step_height_cm,
                    :remark,
                    CAST(:photo_urls AS jsonb),
                    NOW(),
                    'PENDING'
                )
                RETURNING id
                """
            ),
            {
                "road_segment_id": segment_id,
                "collector_user_id": collector_user_id,
                "surface_level": payload.surface_level,
                "surface_type": payload.surface_type,
                "width_m": payload.width_m,
                "safety_level": payload.safety_level,
                "barrier_free_level": payload.barrier_free_level,
                "rest_facility_score": payload.rest_facility_score,
                "lighting_level": payload.lighting_level,
                "crossing_safety_level": payload.crossing_safety_level,
                "wheelchair_accessible": payload.wheelchair_accessible,
                "has_handrail": payload.has_handrail,
                "has_ramp": payload.has_ramp,
                "shade_coverage_percent": payload.shade_coverage_percent,
                "bench_count": payload.bench_count,
                "step_count": payload.step_count,
                "step_height_cm": payload.step_height_cm,
                "remark": remark,
                "photo_urls": json.dumps(payload.photo_urls, ensure_ascii=False),
            },
        ).scalar_one()
        db.commit()
    except Exception:
        db.rollback()
        raise

    return SegmentCollectionSubmitResponse(
        id=int(record_id),
        segment_code=payload.segment_code,
        status="PENDING",
        message="采集记录已提交，等待管理员审核。",
    )


@router.get("/pending", response_model=list[PendingCollectionRecordResponse])
def list_pending_collection_records(db: Session = Depends(get_db)) -> list[PendingCollectionRecordResponse]:
    rows = db.execute(
        text(
            """
            SELECT
                scr.id,
                rs.segment_code,
                rs.name AS segment_name,
                au.display_name AS collector_name,
                scr.surface_level,
                scr.safety_level,
                scr.barrier_free_level,
                scr.wheelchair_accessible,
                scr.step_count,
                scr.remark,
                scr.collect_time,
                scr.status
            FROM segment_collect_record scr
            JOIN road_segment rs ON rs.id = scr.road_segment_id
            JOIN app_user au ON au.id = scr.collector_user_id
            WHERE scr.status = 'PENDING'
            ORDER BY scr.collect_time DESC, scr.id DESC
            LIMIT 50
            """
        )
    ).mappings()
    return [PendingCollectionRecordResponse(**row) for row in rows]


def get_active_segment_id(db: Session, segment_code: str) -> int | None:
    return db.execute(
        text("SELECT id FROM road_segment WHERE segment_code = :segment_code AND status = 'ACTIVE'"),
        {"segment_code": segment_code},
    ).scalar_one_or_none()


def get_existing_pending_collection_id(db: Session, segment_id: int, collector_user_id: int) -> int | None:
    return db.execute(
        text(
            """
            SELECT id
            FROM segment_collect_record
            WHERE road_segment_id = :road_segment_id
              AND collector_user_id = :collector_user_id
              AND collect_time::date = CURRENT_DATE
              AND status = 'PENDING'
            LIMIT 1
            """
        ),
        {
            "road_segment_id": segment_id,
            "collector_user_id": collector_user_id,
        },
    ).scalar_one_or_none()


def build_collection_remark(payload: SegmentCollectionSubmitRequest) -> str:
    parts = []
    if payload.remark.strip():
        parts.append(payload.remark.strip())
    if payload.location_lat is not None and payload.location_lon is not None:
        parts.append(f"采集位置：{payload.location_lon:.6f},{payload.location_lat:.6f}")
    return "；".join(parts)
