from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.routes import CurrentStartOptionsResponse, RouteRecommendResponse
from app.services.current_origin import CurrentOriginError, attach_origin, nearby_starts, validate_fix
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


def ensure_location_covered(db, longitude, latitude, area_code):
    covered = db.execute(text('''
        SELECT ST_Covers(boundary_geom, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326))
        FROM pilot_area WHERE area_code = :area_code AND status = 'ACTIVE'
    '''), {'longitude': longitude, 'latitude': latitude, 'area_code': area_code}).scalar_one_or_none()
    if not covered:
        raise CurrentOriginError('当前位置尚无适老路网覆盖，请手动选择已知起点；到达该起点前的道路暂不提供适老导航。')


@router.get('/start-options', response_model=CurrentStartOptionsResponse)
def current_start_options(
    longitude: float = Query(..., ge=-180, le=180),
    latitude: float = Query(..., ge=-90, le=90),
    accuracy: float = Query(..., ge=0),
    timestamp_ms: float = Query(..., ge=0),
    mobility_type: str = Query(...),
    area_code: Literal['SHIDAYUAN'] = Query('SHIDAYUAN'),
    db: Session = Depends(get_db),
):
    if mobility_type not in SUPPORTED_MOBILITY_TYPES:
        raise HTTPException(status_code=422, detail='请选择有效的出行方式。')
    try:
        validate_fix(longitude, latitude, accuracy, timestamp_ms)
        ensure_location_covered(db, longitude, latitude, area_code)
        candidates = nearby_starts(load_active_segments(db, area_code), [longitude, latitude], mobility_type)
        return {'candidates': candidates, 'message': '' if candidates else '当前位置附近没有已收录道路，请手动选择起点。这一段暂不提供适老导航。'}
    except CurrentOriginError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

@router.get("/recommend", response_model=RouteRecommendResponse)
def recommend_route(
    start_name: str | None = Query(None),
    end_name: str = Query(...),
    mobility_type: str = Query(...),
    strategy: RouteStrategyQuery = Query(
        "BALANCED",
        description="Route ranking strategy: BALANCED, SAFEST, FLATTEST, COMFORT, or SHORTEST.",
    ),
    area_code: Literal["SHIDAYUAN"] = Query("SHIDAYUAN"),
    start_longitude: float | None = Query(None, ge=-180, le=180),
    start_latitude: float | None = Query(None, ge=-90, le=90),
    start_accuracy: float | None = Query(None, ge=0),
    start_timestamp_ms: float | None = Query(None, ge=0),
    start_segment_code: str | None = Query(None, max_length=100),
    db: Session = Depends(get_db),
) -> RouteRecommendResponse:
    if mobility_type not in SUPPORTED_MOBILITY_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported mobility_type")
    normalized_strategy = normalize_route_strategy(strategy)
    if normalized_strategy not in SUPPORTED_ROUTE_STRATEGIES:
        raise HTTPException(status_code=422, detail="Unsupported strategy")
    fields = [start_longitude, start_latitude, start_accuracy, start_timestamp_ms, start_segment_code]
    has_location = any(field is not None for field in fields)
    if has_location and (start_name is not None or any(field is None for field in fields)):
        raise HTTPException(status_code=422, detail='请选择地名起点或完整的定位起点，不能同时使用。')
    if not has_location and not start_name:
        raise HTTPException(status_code=422, detail='请先选择出发地点或使用当前位置。')
    if not has_location and start_name == end_name:
        raise HTTPException(status_code=400, detail="Start and end cannot be the same")

    end_node_code = resolve_poi_node_code(db, end_name, area_code)
    active_segments = load_active_segments(db, area_code)
    start_context = None
    if has_location:
        try:
            validate_fix(start_longitude, start_latitude, start_accuracy, start_timestamp_ms)
            ensure_location_covered(db, start_longitude, start_latitude, area_code)
            active_segments, start_node_code, start_context = attach_origin(
                active_segments, [start_longitude, start_latitude], start_segment_code, mobility_type)
            start_name = f'当前位置附近 · {start_context["name"]}'
        except CurrentOriginError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
    else:
        start_node_code = resolve_poi_node_code(db, start_name, area_code)
    if start_node_code == end_node_code:
        raise HTTPException(status_code=400, detail='您已在目的地对应的路网节点附近，请核对现场位置，无需重复规划。')
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
                "message": "现有路网中没有符合当前出行条件的可达路线。请核对起点和目的地，或选择其他已知起点。",
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
        start_context=start_context,
    )


def resolve_poi_node_code(db: Session, name: str, area_code: str) -> str:
    row = db.execute(
        text(
            """
            SELECT linked_node_code
            FROM poi_facility pf
            JOIN pilot_area pa ON pa.id = pf.pilot_area_id
            WHERE pf.name = :name
              AND pf.status = 'ACTIVE'
              AND pa.area_code = :area_code
              AND pa.status = 'ACTIVE'
            """
        ),
        {"name": name, "area_code": area_code},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"POI not found: {name}")
    node_code = row["linked_node_code"]
    if not node_code:
        raise HTTPException(status_code=422, detail=f"POI has no linked route node: {name}")

    exists = db.execute(
        text(
            """
            SELECT rn.id
            FROM road_node rn
            JOIN pilot_area pa ON pa.id = rn.pilot_area_id
            WHERE rn.osm_node_ref = :node_code
              AND pa.area_code = :area_code
              AND pa.status = 'ACTIVE'
            """
        ),
        {"node_code": node_code, "area_code": area_code},
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=422, detail=f"Linked route node not found: {node_code}")
    return str(node_code)


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
