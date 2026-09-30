import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.survey_records import SurveyCoordinateRequest, SurveySiteResponse
from app.services.coordinates import convert_geometry, gcj02_to_wgs84
from app.services.admin_tokens import require_admin_id
from app.services.survey_records import survey_media


router = APIRouter()


@router.get("/sites", response_model=list[SurveySiteResponse])
def list_survey_sites(db: Session = Depends(get_db)) -> list[SurveySiteResponse]:
    rows = db.execute(
        text(
            """
            SELECT ss.site_code, ss.name, COUNT(sr.record_code)::int AS record_count
            FROM survey_site ss
            LEFT JOIN survey_record sr ON sr.site_code = ss.site_code
            GROUP BY ss.site_code, ss.name, ss.sort_order
            ORDER BY ss.sort_order, ss.site_code
            """
        )
    ).mappings()
    return [SurveySiteResponse(**row) for row in rows]


@router.get("")
def list_survey_records(
    site_code: str | None = Query(default=None, max_length=50),
    coordinate_system: Literal["WGS84", "GCJ02"] = Query(default="GCJ02"),
    db: Session = Depends(get_db),
) -> dict:
    if site_code is not None:
        site = db.execute(
            text("SELECT site_code FROM survey_site WHERE site_code = :site_code"),
            {"site_code": site_code},
        ).mappings().first()
        if site is None:
            raise HTTPException(status_code=404, detail=f"Survey site not found: {site_code}")
    rows = db.execute(
        text(
            """
            SELECT sr.record_code, sr.site_code, ss.name AS site_name, sr.title,
                   sr.issue_tags, sr.notes, sr.media_refs, sr.location_source,
                   sr.review_status, ST_AsGeoJSON(sr.location) AS location_geojson
            FROM survey_record sr
            JOIN survey_site ss ON ss.site_code = sr.site_code
            WHERE (:site_code IS NULL OR sr.site_code = :site_code)
            ORDER BY ss.sort_order, sr.title, sr.record_code
            """
        ),
        {"site_code": site_code},
    ).mappings()

    features = []
    for row in rows:
        geometry = json.loads(row["location_geojson"]) if row["location_geojson"] else None
        if geometry is not None:
            geometry = convert_geometry(geometry, coordinate_system)
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "record_code": row["record_code"],
                    "site_code": row["site_code"],
                    "site_name": row["site_name"],
                    "title": row["title"],
                    "issue_tags": row["issue_tags"] or [],
                    "notes": row["notes"] or [],
                    "location_source": row["location_source"],
                    "review_status": row["review_status"],
                    "evidence_photos": survey_media(row["media_refs"]),
                },
            }
        )
    return {
        "type": "FeatureCollection",
        "area_code": "UNIVERSITY_CITY_SURVEY",
        "coordinate_system": coordinate_system,
        "features": features,
    }


@router.patch("/{record_code}/location")
def set_survey_record_location(
    record_code: str,
    payload: SurveyCoordinateRequest,
    admin_id: int = Depends(require_admin_id),
    db: Session = Depends(get_db),
) -> dict:
    del admin_id  # The dependency verifies the current account and role before mutation.
    longitude, latitude = gcj02_to_wgs84(payload.longitude, payload.latitude)
    row = db.execute(
        text(
            """
            UPDATE survey_record
            SET location = ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326),
                location_source = 'MANUAL',
                updated_at = NOW()
            WHERE record_code = :record_code
            RETURNING record_code, location_source, review_status,
                      ST_AsGeoJSON(location) AS location_geojson
            """
        ),
        {"record_code": record_code, "longitude": longitude, "latitude": latitude},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Survey record not found")
    db.commit()
    geometry = convert_geometry(json.loads(row["location_geojson"]), "GCJ02")
    return {
        "record_code": row["record_code"],
        "geometry": geometry,
        "location_source": row["location_source"],
        "review_status": row["review_status"],
    }


