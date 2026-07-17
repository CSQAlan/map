from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.routes import RouteEndpointResponse, RouteRecommendResponse
from app.services.route_planner import (
    ROUTE_STRATEGY_METADATA,
    SUPPORTED_MOBILITY_TYPES,
    SUPPORTED_ROUTE_STRATEGIES,
    explain_avoided_segments,
    normalize_route_strategy,
    recommend_routes,
)


router = APIRouter()

RouteStrategyQuery = Literal["BALANCED", "SAFEST", "FLATTEST", "COMFORT", "SHORTEST"]


@router.get("/endpoints", response_model=list[RouteEndpointResponse])
def list_route_endpoints(
    area_code: Literal["SHIDAYUAN"] = Query("SHIDAYUAN"),
    db: Session = Depends(get_db),
) -> list[RouteEndpointResponse]:
    return [RouteEndpointResponse(**row) for row in load_route_endpoints(db, area_code)]


@router.get("/recommend", response_model=RouteRecommendResponse)
def recommend_route(
    start_name: str = Query(...),
    end_name: str = Query(...),
    mobility_type: str = Query(...),
    strategy: RouteStrategyQuery = Query(
        "BALANCED",
        description="Route ranking strategy: BALANCED, SAFEST, FLATTEST, COMFORT, or SHORTEST.",
    ),
    area_code: Literal["SHIDAYUAN"] = Query("SHIDAYUAN"),
    db: Session = Depends(get_db),
) -> RouteRecommendResponse:
    if mobility_type not in SUPPORTED_MOBILITY_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported mobility_type")
    normalized_strategy = normalize_route_strategy(strategy)
    if normalized_strategy not in SUPPORTED_ROUTE_STRATEGIES:
        raise HTTPException(status_code=422, detail="Unsupported strategy")
    if start_name == end_name:
        raise HTTPException(status_code=400, detail="Start and end cannot be the same")

    start_node_code = resolve_poi_node_code(db, start_name, area_code)
    end_node_code = resolve_poi_node_code(db, end_name, area_code)
    active_segments = load_active_segments(db, area_code)
    routes = recommend_routes(
        active_segments,
        start_node_code,
        end_node_code,
        mobility_type,
        strategy=normalized_strategy,
    )
    avoided_segments = explain_avoided_segments(active_segments, mobility_type)
    if not routes:
        raise HTTPException(
            status_code=404,
            detail={
                "message": "No reachable route found",
                "avoided_segments": avoided_segments,
            },
        )
    return RouteRecommendResponse(
        start_name=start_name,
        end_name=end_name,
        mobility_type=mobility_type,
        strategy=normalized_strategy,
        strategy_label=ROUTE_STRATEGY_METADATA[normalized_strategy]["label"],
        strategy_description=ROUTE_STRATEGY_METADATA[normalized_strategy]["description"],
        routes=routes,
        avoided_segments=avoided_segments,
    )


def resolve_poi_node_code(db: Session, name: str, area_code: str) -> str:
    endpoints = load_route_endpoints(db, area_code, name=name)
    if not endpoints:
        raise HTTPException(status_code=404, detail=f"Route endpoint not found: {name}")
    return endpoints[0]["linked_node_code"]


def load_route_endpoints(
    db: Session,
    area_code: str,
    name: str | None = None,
) -> list[dict]:
    name_filter = "AND pf.name = :name" if name is not None else ""
    params = {"area_code": area_code}
    if name is not None:
        params["name"] = name
    rows = db.execute(
        text(
            f"""
            SELECT
                pf.id,
                pf.name,
                pf.poi_type,
                pf.linked_node_code,
                pf.is_accessible
            FROM poi_facility pf
            JOIN pilot_area pa ON pa.id = pf.pilot_area_id
            JOIN road_node rn
              ON rn.pilot_area_id = pf.pilot_area_id
             AND rn.osm_node_ref = pf.linked_node_code
            WHERE pf.status = 'ACTIVE'
              AND pf.linked_node_code IS NOT NULL
              AND pa.area_code = :area_code
              AND pa.status = 'ACTIVE'
              {name_filter}
            ORDER BY pf.id
            """
        ),
        params,
    ).mappings()
    return [dict(row) for row in rows]


def load_active_segments(db: Session, area_code: str) -> list[dict]:
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
            JOIN pilot_area pa ON pa.id = rs.pilot_area_id
            WHERE rs.status = 'ACTIVE'
              AND pa.area_code = :area_code
              AND pa.status = 'ACTIVE'
            ORDER BY rs.id
            """
        ),
        {"area_code": area_code},
    ).mappings()
    return [dict(row) for row in rows]
