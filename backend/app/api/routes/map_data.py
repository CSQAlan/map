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
            SELECT
                id,
                segment_code,
                name,
                length_m,
                slope_percent,
                surface_type,
                width_m,
                surface_level,
                safety_level,
                barrier_free_level,
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
    return [RoadSegmentResponse(**row) for row in rows]


@router.get("/geojson")
def get_map_geojson(db: Session = Depends(get_db)) -> dict:
    poi_rows = db.execute(
        text(
            """
            SELECT
                id,
                name,
                poi_type,
                is_accessible,
                ST_AsGeoJSON(geom) AS geom_geojson
            FROM poi_facility
            WHERE status = 'ACTIVE'
            ORDER BY id
            """
        )
    ).mappings()
    segment_rows = db.execute(
        text(
            """
            SELECT
                id,
                segment_code,
                name,
                slope_percent,
                wheelchair_accessible,
                step_count,
                ST_AsGeoJSON(geom) AS geom_geojson
            FROM road_segment
            WHERE status = 'ACTIVE'
            ORDER BY id
            """
        )
    ).mappings()

    features = []
    for row in poi_rows:
        features.append(
            {
                "type": "Feature",
                "geometry": _geojson_geometry(row["geom_geojson"]),
                "properties": {
                    "kind": "poi",
                    "id": row["id"],
                    "name": row["name"],
                    "poi_type": row["poi_type"],
                    "is_accessible": row["is_accessible"],
                },
            }
        )
    for row in segment_rows:
        features.append(
            {
                "type": "Feature",
                "geometry": _geojson_geometry(row["geom_geojson"]),
                "properties": {
                    "kind": "segment",
                    "id": row["id"],
                    "segment_code": row["segment_code"],
                    "name": row["name"],
                    "slope_percent": float(row["slope_percent"]),
                    "wheelchair_accessible": row["wheelchair_accessible"],
                    "step_count": row["step_count"],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _geojson_geometry(raw_geometry: str) -> dict:
    import json

    return json.loads(raw_geometry)
