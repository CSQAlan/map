import json

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.collect import (
    CollectionSegmentOptionResponse,
    PendingCollectionRecordResponse,
    SegmentAuditRequest,
    SegmentAuditResponse,
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
                scr.surface_type,
                scr.width_m,
                scr.surface_level,
                scr.safety_level,
                scr.barrier_free_level,
                scr.rest_facility_score,
                scr.lighting_level,
                scr.crossing_safety_level,
                scr.wheelchair_accessible,
                scr.has_handrail,
                scr.has_ramp,
                scr.shade_coverage_percent,
                scr.bench_count,
                scr.step_count,
                scr.step_height_cm,
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


@router.post("/segments/{record_id}/audit", response_model=SegmentAuditResponse)
def audit_collection_record(
    record_id: int,
    payload: SegmentAuditRequest,
    db: Session = Depends(get_db),
) -> SegmentAuditResponse:
    record = get_collection_record_for_audit(db, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Collection record not found: {record_id}")
    if record["collect_status"] != "PENDING":
        raise HTTPException(status_code=409, detail="Only pending collection records can be audited")

    before_snapshot = build_road_segment_snapshot(record)
    after_snapshot = before_snapshot

    try:
        auditor_user_id = ensure_auditor_user(db, payload.auditor)
        if payload.audit_result == "APPROVED":
            apply_collection_to_road_segment(db, record)
            after_snapshot = get_road_segment_snapshot(db, record["road_segment_id"])
        db.execute(
            text(
                """
                UPDATE segment_collect_record
                SET status = :status
                WHERE id = :record_id
                """
            ),
            {"record_id": record_id, "status": payload.audit_result},
        )
        audit_id = db.execute(
            text(
                """
                INSERT INTO segment_audit_record (
                    road_segment_id,
                    collect_record_id,
                    auditor_user_id,
                    audit_result,
                    audit_comment,
                    before_snapshot,
                    after_snapshot
                )
                VALUES (
                    :road_segment_id,
                    :collect_record_id,
                    :auditor_user_id,
                    :audit_result,
                    :audit_comment,
                    CAST(:before_snapshot AS jsonb),
                    CAST(:after_snapshot AS jsonb)
                )
                RETURNING id
                """
            ),
            {
                "road_segment_id": record["road_segment_id"],
                "collect_record_id": record_id,
                "auditor_user_id": auditor_user_id,
                "audit_result": payload.audit_result,
                "audit_comment": payload.audit_comment.strip(),
                "before_snapshot": json.dumps(before_snapshot, ensure_ascii=False),
                "after_snapshot": json.dumps(after_snapshot, ensure_ascii=False),
            },
        ).scalar_one()
        db.commit()
    except Exception:
        db.rollback()
        raise

    return SegmentAuditResponse(
        id=int(audit_id),
        collect_record_id=record_id,
        segment_code=record["segment_code"],
        audit_result=payload.audit_result,
        collect_record_status=payload.audit_result,
        message="审核已通过，正式路段数据已更新。" if payload.audit_result == "APPROVED" else "采集记录已驳回，正式路段数据未改变。",
    )


def get_active_segment_id(db: Session, segment_code: str) -> int | None:
    return db.execute(
        text("SELECT id FROM road_segment WHERE segment_code = :segment_code AND status = 'ACTIVE'"),
        {"segment_code": segment_code},
    ).scalar_one_or_none()


def get_collection_record_for_audit(db: Session, record_id: int) -> dict | None:
    row = db.execute(
        text(
            """
            SELECT
                scr.id AS collect_record_id,
                scr.road_segment_id,
                rs.segment_code,
                rs.name AS segment_name,
                scr.status AS collect_status,
                scr.surface_level AS collected_surface_level,
                scr.surface_type AS collected_surface_type,
                scr.width_m AS collected_width_m,
                scr.safety_level AS collected_safety_level,
                scr.barrier_free_level AS collected_barrier_free_level,
                scr.rest_facility_score AS collected_rest_facility_score,
                scr.lighting_level AS collected_lighting_level,
                scr.crossing_safety_level AS collected_crossing_safety_level,
                scr.wheelchair_accessible AS collected_wheelchair_accessible,
                scr.has_handrail AS collected_has_handrail,
                scr.has_ramp AS collected_has_ramp,
                scr.shade_coverage_percent AS collected_shade_coverage_percent,
                scr.bench_count AS collected_bench_count,
                scr.step_count AS collected_step_count,
                scr.step_height_cm AS collected_step_height_cm,
                rs.surface_level AS road_surface_level,
                rs.surface_type AS road_surface_type,
                rs.width_m AS road_width_m,
                rs.safety_level AS road_safety_level,
                rs.barrier_free_level AS road_barrier_free_level,
                rs.rest_facility_score AS road_rest_facility_score,
                rs.lighting_level AS road_lighting_level,
                rs.crossing_safety_level AS road_crossing_safety_level,
                rs.wheelchair_accessible AS road_wheelchair_accessible,
                rs.has_handrail AS road_has_handrail,
                rs.has_ramp AS road_has_ramp,
                rs.shade_coverage_percent AS road_shade_coverage_percent,
                rs.bench_count AS road_bench_count,
                rs.step_count AS road_step_count,
                rs.step_height_cm AS road_step_height_cm
            FROM segment_collect_record scr
            JOIN road_segment rs ON rs.id = scr.road_segment_id
            WHERE scr.id = :record_id
            FOR UPDATE OF scr
            """
        ),
        {"record_id": record_id},
    ).mappings()
    rows = list(row)
    return dict(rows[0]) if rows else None


def apply_collection_to_road_segment(db: Session, record: dict) -> None:
    db.execute(
        text(
            """
            UPDATE road_segment
            SET
                surface_level = :surface_level,
                surface_type = :surface_type,
                width_m = :width_m,
                safety_level = :safety_level,
                barrier_free_level = :barrier_free_level,
                rest_facility_score = :rest_facility_score,
                lighting_level = :lighting_level,
                crossing_safety_level = :crossing_safety_level,
                wheelchair_accessible = :wheelchair_accessible,
                has_handrail = :has_handrail,
                has_ramp = :has_ramp,
                shade_coverage_percent = :shade_coverage_percent,
                bench_count = :bench_count,
                step_count = :step_count,
                step_height_cm = :step_height_cm,
                data_source = 'MANUAL',
                updated_at = NOW()
            WHERE id = :road_segment_id
            """
        ),
        {
            "road_segment_id": record["road_segment_id"],
            "surface_level": record["collected_surface_level"],
            "surface_type": record["collected_surface_type"],
            "width_m": record["collected_width_m"],
            "safety_level": record["collected_safety_level"],
            "barrier_free_level": record["collected_barrier_free_level"],
            "rest_facility_score": record["collected_rest_facility_score"],
            "lighting_level": record["collected_lighting_level"],
            "crossing_safety_level": record["collected_crossing_safety_level"],
            "wheelchair_accessible": record["collected_wheelchair_accessible"],
            "has_handrail": record["collected_has_handrail"],
            "has_ramp": record["collected_has_ramp"],
            "shade_coverage_percent": record["collected_shade_coverage_percent"],
            "bench_count": record["collected_bench_count"],
            "step_count": record["collected_step_count"],
            "step_height_cm": record["collected_step_height_cm"],
        },
    )


def get_road_segment_snapshot(db: Session, road_segment_id: int) -> dict:
    row = db.execute(
        text(
            """
            SELECT
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
                step_height_cm
            FROM road_segment
            WHERE id = :road_segment_id
            """
        ),
        {"road_segment_id": road_segment_id},
    ).mappings()
    rows = list(row)
    if not rows:
        raise HTTPException(status_code=404, detail=f"Road segment not found: {road_segment_id}")
    return {
        "surface_level": rows[0]["surface_level"],
        "surface_type": rows[0]["surface_type"],
        "width_m": float(rows[0]["width_m"]),
        "safety_level": rows[0]["safety_level"],
        "barrier_free_level": rows[0]["barrier_free_level"],
        "rest_facility_score": rows[0]["rest_facility_score"],
        "lighting_level": rows[0]["lighting_level"],
        "crossing_safety_level": rows[0]["crossing_safety_level"],
        "wheelchair_accessible": rows[0]["wheelchair_accessible"],
        "has_handrail": rows[0]["has_handrail"],
        "has_ramp": rows[0]["has_ramp"],
        "shade_coverage_percent": rows[0]["shade_coverage_percent"],
        "bench_count": rows[0]["bench_count"],
        "step_count": rows[0]["step_count"],
        "step_height_cm": float(rows[0]["step_height_cm"]),
    }


def ensure_auditor_user(db: Session, auditor: str) -> int:
    username = "audit_admin"
    existing_id = db.execute(
        text("SELECT id FROM app_user WHERE username = :username"),
        {"username": username},
    ).scalar_one_or_none()
    if existing_id is not None:
        return int(existing_id)
    return int(
        db.execute(
            text(
                """
                INSERT INTO app_user (username, password_hash, role, display_name)
                VALUES (:username, 'audit-system-user', 'ADMIN', :display_name)
                RETURNING id
                """
            ),
            {"username": username, "display_name": auditor.strip()},
        ).scalar_one()
    )


def build_road_segment_snapshot(record: dict) -> dict:
    return build_segment_snapshot(record, "road")


def build_segment_snapshot(record: dict, prefix: str) -> dict:
    return {
        "surface_level": record[f"{prefix}_surface_level"],
        "surface_type": record[f"{prefix}_surface_type"],
        "width_m": float(record[f"{prefix}_width_m"]),
        "safety_level": record[f"{prefix}_safety_level"],
        "barrier_free_level": record[f"{prefix}_barrier_free_level"],
        "rest_facility_score": record[f"{prefix}_rest_facility_score"],
        "lighting_level": record[f"{prefix}_lighting_level"],
        "crossing_safety_level": record[f"{prefix}_crossing_safety_level"],
        "wheelchair_accessible": record[f"{prefix}_wheelchair_accessible"],
        "has_handrail": record[f"{prefix}_has_handrail"],
        "has_ramp": record[f"{prefix}_has_ramp"],
        "shade_coverage_percent": record[f"{prefix}_shade_coverage_percent"],
        "bench_count": record[f"{prefix}_bench_count"],
        "step_count": record[f"{prefix}_step_count"],
        "step_height_cm": float(record[f"{prefix}_step_height_cm"]),
    }


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
