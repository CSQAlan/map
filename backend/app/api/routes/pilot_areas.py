import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.pilot_areas import PilotAreaResponse
from app.services.coordinates import convert_geometry


router = APIRouter()


@router.get("/{area_code}", response_model=PilotAreaResponse)
def get_pilot_area(
    area_code: str,
    coordinate_system: Literal["WGS84", "GCJ02"] = Query("GCJ02"),
    db: Session = Depends(get_db),
) -> PilotAreaResponse:
    row = db.execute(
        text(
            """
            SELECT
                area_code,
                name,
                ST_AsGeoJSON(boundary_geom) AS boundary_geojson,
                ST_AsGeoJSON(center_geom) AS center_geojson,
                min_zoom,
                max_zoom
            FROM pilot_area
            WHERE area_code = :area_code AND status = 'ACTIVE'
            """
        ),
        {"area_code": area_code},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Pilot area not found: {area_code}")

    boundary = convert_geometry(json.loads(row["boundary_geojson"]), coordinate_system)
    center = convert_geometry(json.loads(row["center_geojson"]), coordinate_system)
    points = boundary["coordinates"][0]
    lons = [point[0] for point in points]
    lats = [point[1] for point in points]
    return PilotAreaResponse(
        area_code=row["area_code"],
        name=row["name"],
        coordinate_system=coordinate_system,
        center=center["coordinates"],
        boundary=boundary,
        limit_bounds={
            "south_west": [min(lons), min(lats)],
            "north_east": [max(lons), max(lats)],
        },
        min_zoom=row["min_zoom"],
        max_zoom=row["max_zoom"],
    )
