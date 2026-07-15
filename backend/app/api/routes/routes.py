from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.routes import RouteRecommendResponse
from app.services.route_planner import SUPPORTED_MOBILITY_TYPES, recommend_routes


router = APIRouter()

GATE_3_NAME = "\u91cd\u5e86\u5e08\u8303\u5927\u5b66\u4e09\u53f7\u95e8"
CLINIC_NAME = "\u91cd\u5e86\u5e08\u8303\u5927\u5b66\u6821\u533b\u9662"
CANTEEN_NAME = "\u91cd\u5e86\u5e08\u8303\u5927\u5b66\u98df\u5802"

POI_NODE_CODES = {
    GATE_3_NAME: "N_GATE3",
    CLINIC_NAME: "N_CLINIC",
    CANTEEN_NAME: "N_CANTEEN",
}


@router.get("/recommend", response_model=RouteRecommendResponse)
def recommend_route(
    start_name: str = Query(...),
    end_name: str = Query(...),
    mobility_type: str = Query(...),
    db: Session = Depends(get_db),
) -> RouteRecommendResponse:
    if mobility_type not in SUPPORTED_MOBILITY_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported mobility_type")
    if start_name == end_name:
        raise HTTPException(status_code=400, detail="Start and end cannot be the same")

    start_node_code = resolve_poi_node_code(db, start_name)
    end_node_code = resolve_poi_node_code(db, end_name)
    routes = recommend_routes(
        load_active_segments(db),
        start_node_code,
        end_node_code,
        mobility_type,
    )
    if not routes:
        raise HTTPException(status_code=404, detail="No reachable route found")
    return RouteRecommendResponse(
        start_name=start_name,
        end_name=end_name,
        mobility_type=mobility_type,
        routes=routes,
    )


def resolve_poi_node_code(db: Session, name: str) -> str:
    node_code = POI_NODE_CODES.get(name)
    if node_code is None:
        raise HTTPException(status_code=404, detail=f"POI not found: {name}")
    exists = db.execute(
        text("SELECT id FROM poi_facility WHERE name = :name AND status = 'ACTIVE'"),
        {"name": name},
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=404, detail=f"POI not found: {name}")
    return node_code


def load_active_segments(db: Session) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT
                rs.segment_code,
                rs.name,
                ST_AsGeoJSON(rs.geom) AS geom_geojson,
                rn_start.osm_node_ref AS start_node_code,
                rn_end.osm_node_ref AS end_node_code,
                rs.length_m,
                rs.slope_percent,
                rs.surface_type,
                rs.width_m,
                rs.surface_level,
                rs.safety_level,
                rs.barrier_free_level,
                rs.rest_facility_score,
                rs.lighting_level,
                rs.crossing_safety_level,
                rs.wheelchair_accessible,
                rs.has_handrail,
                rs.has_ramp,
                rs.shade_coverage_percent,
                rs.bench_count,
                rs.step_height_cm,
                rs.step_count
            FROM road_segment rs
            JOIN road_node rn_start ON rn_start.id = rs.start_node_id
            JOIN road_node rn_end ON rn_end.id = rs.end_node_id
            WHERE rs.status = 'ACTIVE'
            ORDER BY rs.id
            """
        )
    ).mappings()
    return [dict(row) for row in rows]
