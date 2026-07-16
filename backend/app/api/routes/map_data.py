from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.map_data import PoiResponse, RoadSegmentResponse
from app.services.coordinates import convert_geometry
from app.services.photo_evidence import load_photo_manifest


router = APIRouter()


@router.get("/pois", response_model=list[PoiResponse])
def list_pois(
    area_code: str = Query("SHIDAYUAN"),
    db: Session = Depends(get_db),
) -> list[PoiResponse]:
    rows = db.execute(
        text(
            """
            SELECT pf.id, pf.name, pf.poi_type, pf.is_accessible
            FROM poi_facility pf
            JOIN pilot_area pa ON pa.id = pf.pilot_area_id
            WHERE pf.status = 'ACTIVE' AND pa.status = 'ACTIVE' AND pa.area_code = :area_code
            ORDER BY pf.id
            """
        ),
        {"area_code": area_code},
    ).mappings()
    return [PoiResponse(**row) for row in rows]


@router.get("/segments", response_model=list[RoadSegmentResponse])
def list_segments(
    area_code: str = Query("SHIDAYUAN"),
    db: Session = Depends(get_db),
) -> list[RoadSegmentResponse]:
    rows = db.execute(
        text(
            """
            SELECT
                rs.id,
                rs.segment_code,
                rs.name,
                rs.length_m,
                rs.slope_percent,
                rs.surface_type,
                rs.width_m,
                rs.surface_level,
                rs.safety_level,
                rs.barrier_free_level,
                rs.wheelchair_accessible,
                rs.has_handrail,
                rs.has_ramp,
                rs.shade_coverage_percent,
                rs.bench_count,
                rs.step_count
            FROM road_segment rs
            JOIN pilot_area pa ON pa.id = rs.pilot_area_id
            WHERE rs.status = 'ACTIVE' AND pa.status = 'ACTIVE' AND pa.area_code = :area_code
            ORDER BY rs.id
            """
        ),
        {"area_code": area_code},
    ).mappings()
    return [RoadSegmentResponse(**row) for row in rows]


@router.get("/geojson")
def get_map_geojson(
    area_code: str = Query("SHIDAYUAN"),
    coordinate_system: Literal["WGS84", "GCJ02"] = Query("GCJ02"),
    db: Session = Depends(get_db),
) -> dict:
    poi_rows = db.execute(
        text(
            """
            SELECT
                pf.id,
                pf.name,
                pf.poi_type,
                pf.is_accessible,
                pf.source_provider,
                pf.data_confidence,
                pf.evidence_photo_refs,
                ST_AsGeoJSON(pf.geom) AS geom_geojson
            FROM poi_facility pf
            JOIN pilot_area pa ON pa.id = pf.pilot_area_id
            WHERE pf.status = 'ACTIVE' AND pa.status = 'ACTIVE' AND pa.area_code = :area_code
            ORDER BY pf.id
            """
        ),
        {"area_code": area_code},
    ).mappings()
    segment_rows = db.execute(
        text(
            """
            SELECT
                rs.id,
                rs.segment_code,
                rs.name,
                rs.slope_percent,
                rs.wheelchair_accessible,
                rs.step_count,
                rs.surface_level,
                rs.safety_level,
                rs.barrier_free_level,
                rs.source_provider,
                rs.data_confidence,
                rs.evidence_photo_refs,
                ST_AsGeoJSON(rs.geom) AS geom_geojson
            FROM road_segment rs
            JOIN pilot_area pa ON pa.id = rs.pilot_area_id
            WHERE rs.status = 'ACTIVE' AND pa.status = 'ACTIVE' AND pa.area_code = :area_code
            ORDER BY rs.id
            """
        ),
        {"area_code": area_code},
    ).mappings()

    features = []
    for row in poi_rows:
        features.append(
            {
                "type": "Feature",
                "geometry": convert_geometry(
                    _geojson_geometry(row["geom_geojson"]), coordinate_system
                ),
                "properties": {
                    "kind": "poi",
                    "id": row["id"],
                    "name": row["name"],
                    "poi_type": row["poi_type"],
                    "is_accessible": row["is_accessible"],
                    "source_provider": row["source_provider"],
                    "data_confidence": row["data_confidence"],
                    "evidence_photos": _evidence_photos(row["evidence_photo_refs"]),
                },
            }
        )
    for row in segment_rows:
        features.append(
            {
                "type": "Feature",
                "geometry": convert_geometry(
                    _geojson_geometry(row["geom_geojson"]), coordinate_system
                ),
                "properties": {
                    "kind": "segment",
                    "id": row["id"],
                    "segment_code": row["segment_code"],
                    "name": row["name"],
                    "slope_percent": float(row["slope_percent"]),
                    "wheelchair_accessible": row["wheelchair_accessible"],
                    "step_count": row["step_count"],
                    "surface_level": row["surface_level"],
                    "safety_level": row["safety_level"],
                    "barrier_free_level": row["barrier_free_level"],
                    "source_provider": row["source_provider"],
                    "data_confidence": row["data_confidence"],
                    "evidence_photos": _evidence_photos(row["evidence_photo_refs"]),
                    "risk_summary": _risk_summary(row),
                },
            }
        )
    return {
        "type": "FeatureCollection",
        "area_code": area_code,
        "coordinate_system": coordinate_system,
        "features": features,
    }


def _geojson_geometry(raw_geometry: str) -> dict:
    import json

    return json.loads(raw_geometry)


def _evidence_photos(photo_refs: list[str] | None) -> list[dict]:
    manifest = load_photo_manifest()
    photos = []
    for photo_id in photo_refs or []:
        evidence = manifest.get(photo_id)
        if evidence is None:
            continue
        photos.append(
            {
                "photo_id": evidence.photo_id,
                "caption": evidence.caption,
                "risk_tags": list(evidence.risk_tags),
                "thumbnail_url": f"/media/evidence/thumb/{evidence.photo_id}.webp",
                "display_url": f"/media/evidence/display/{evidence.photo_id}.webp",
            }
        )
    return photos


def _risk_summary(row: dict) -> str:
    if row["step_count"] > 0:
        return f"存在 {row['step_count']} 级台阶"
    if not row["wheelchair_accessible"]:
        return "轮椅通行受限"
    if row["safety_level"] <= 2:
        return "安全条件较弱"
    if row["surface_level"] <= 2:
        return "路面平整度较低"
    return "适合轮椅通行"
