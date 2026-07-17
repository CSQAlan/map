import json
from pathlib import Path
from typing import Any

from app.core.database import project_root
from app.db.schema import load_schema_sql
from app.db.seeds import (
    NODE_DEFAULTS,
    POI_DEFAULTS,
    SEGMENT_DEFAULTS,
    LEGACY_CAMPUS_POI_NAMES,
    LEGACY_CAMPUS_SEGMENT_CODES,
    load_seed_json,
    normalize_evidence_photo_refs,
    validate_map_data,
)


OUTPUT_PATH = project_root() / "db" / "02_full_init.sql"


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int | float):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def jsonb_literal(value: Any) -> str:
    return f"{sql_literal(json.dumps(value, ensure_ascii=False))}::jsonb"


def area_id(area_code: str) -> str:
    return f"(SELECT id FROM pilot_area WHERE area_code = {sql_literal(area_code)})"


def node_id(area_code: str, node_code: str) -> str:
    return (
        "(SELECT rn.id FROM road_node rn "
        "JOIN pilot_area pa ON pa.id = rn.pilot_area_id "
        f"WHERE pa.area_code = {sql_literal(area_code)} "
        f"AND rn.osm_node_ref = {sql_literal(node_code)})"
    )


def route_node_geom(area_code: str, node_code: str | None) -> str:
    if not node_code:
        return "NULL"
    return (
        "(SELECT rn.geom FROM road_node rn "
        "JOIN pilot_area pa ON pa.id = rn.pilot_area_id "
        f"WHERE pa.area_code = {sql_literal(area_code)} "
        f"AND rn.osm_node_ref = {sql_literal(node_code)})"
    )


def render_pilot_areas() -> list[str]:
    statements = []
    for row in load_seed_json("pilot_areas.json"):
        statements.append(
            f"""
INSERT INTO pilot_area (
    area_code, name, boundary_geom, center_geom, min_zoom, max_zoom, status
) VALUES (
    {sql_literal(row["area_code"])},
    {sql_literal(row["name"])},
    ST_SetSRID(ST_GeomFromText({sql_literal(row["boundary_wkt"])}), 4326),
    ST_SetSRID(ST_GeomFromText({sql_literal(row["center_wkt"])}), 4326),
    {sql_literal(row["min_zoom"])},
    {sql_literal(row["max_zoom"])},
    {sql_literal(row["status"])}
)
ON CONFLICT (area_code) DO UPDATE SET
    name = EXCLUDED.name,
    boundary_geom = EXCLUDED.boundary_geom,
    center_geom = EXCLUDED.center_geom,
    min_zoom = EXCLUDED.min_zoom,
    max_zoom = EXCLUDED.max_zoom,
    status = EXCLUDED.status,
    updated_at = NOW();
""".strip()
        )
    return statements


def render_nodes(area_code: str) -> list[str]:
    statements = []
    for row in load_seed_json("core_nodes.json"):
        payload = {**NODE_DEFAULTS, **row}
        statements.append(
            f"""
INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    {area_id(area_code)},
    {sql_literal(payload["node_code"])},
    {sql_literal(payload["name"])},
    ST_SetSRID(ST_MakePoint({sql_literal(payload["lon"])}, {sql_literal(payload["lat"])}), 4326),
    {sql_literal(payload["node_type"])},
    {sql_literal(payload["source_provider"])},
    {sql_literal(payload["source_coord_type"])},
    {sql_literal(payload["source_ref"])},
    {sql_literal(payload["data_confidence"])}
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;
""".strip()
        )
    return statements


def render_pois(area_code: str) -> list[str]:
    statements = []
    for row in load_seed_json("core_pois.json"):
        payload = {**POI_DEFAULTS, **row}
        evidence_refs = normalize_evidence_photo_refs(payload["evidence_photo_refs"])
        node_geom = route_node_geom(area_code, payload.get("linked_node_code"))
        fallback_geom = (
            f"ST_SetSRID(ST_MakePoint({sql_literal(payload['lon'])}, "
            f"{sql_literal(payload['lat'])}), 4326)"
        )
        statements.append(
            f"""
INSERT INTO poi_facility (
    pilot_area_id, name, poi_type, description, geom, address_text,
    linked_node_code, is_accessible, source, source_provider, source_coord_type,
    source_ref, evidence_photo_refs, data_confidence, status
) VALUES (
    {area_id(area_code)},
    {sql_literal(payload["name"])},
    {sql_literal(payload["poi_type"])},
    {sql_literal(payload["description"])},
    COALESCE({node_geom}, {fallback_geom}),
    {sql_literal(payload["address_text"])},
    {sql_literal(payload["linked_node_code"])},
    {sql_literal(payload["is_accessible"])},
    {sql_literal(payload["source"])},
    {sql_literal(payload["source_provider"])},
    {sql_literal(payload["source_coord_type"])},
    {sql_literal(payload["source_ref"])},
    {jsonb_literal(evidence_refs)},
    {sql_literal(payload["data_confidence"])},
    'ACTIVE'
)
ON CONFLICT (pilot_area_id, name, poi_type) DO UPDATE SET
    description = EXCLUDED.description,
    geom = EXCLUDED.geom,
    address_text = EXCLUDED.address_text,
    linked_node_code = EXCLUDED.linked_node_code,
    is_accessible = EXCLUDED.is_accessible,
    source = EXCLUDED.source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    status = EXCLUDED.status,
    updated_at = NOW();
""".strip()
        )
    return statements


def render_segments(area_code: str) -> list[str]:
    statements = []
    for row in load_seed_json("core_segments.json"):
        payload = {**SEGMENT_DEFAULTS, **row}
        evidence_refs = normalize_evidence_photo_refs(payload["evidence_photo_refs"])
        statements.append(
            f"""
INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    {area_id(area_code)},
    {sql_literal(payload["segment_code"])},
    {node_id(area_code, payload["start_node_code"])},
    {node_id(area_code, payload["end_node_code"])},
    {sql_literal(payload["name"])},
    ST_MakeLine(
        {route_node_geom(area_code, payload["start_node_code"])},
        {route_node_geom(area_code, payload["end_node_code"])}
    ),
    {sql_literal(payload["length_m"])},
    {sql_literal(payload["slope_percent"])},
    {sql_literal(payload["surface_type"])},
    {sql_literal(payload["width_m"])},
    {sql_literal(payload["surface_level"])},
    {sql_literal(payload["safety_level"])},
    {sql_literal(payload["barrier_free_level"])},
    {sql_literal(payload["rest_facility_score"])},
    {sql_literal(payload["lighting_level"])},
    {sql_literal(payload["crossing_safety_level"])},
    {sql_literal(payload["wheelchair_accessible"])},
    {sql_literal(payload["has_handrail"])},
    {sql_literal(payload["has_ramp"])},
    {sql_literal(payload["shade_coverage_percent"])},
    {sql_literal(payload["bench_count"])},
    {sql_literal(payload["step_count"])},
    {sql_literal(payload["step_height_cm"])},
    'MANUAL',
    {sql_literal(payload["source_provider"])},
    {sql_literal(payload["source_coord_type"])},
    {sql_literal(payload["source_ref"])},
    {jsonb_literal(evidence_refs)},
    {sql_literal(payload["data_confidence"])},
    {sql_literal(payload["verified_by"])},
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();
""".strip()
        )
    return statements


def render_legacy_deactivation() -> list[str]:
    statements = []
    for poi_name in LEGACY_CAMPUS_POI_NAMES:
        statements.append(
            f"UPDATE poi_facility SET status = 'INACTIVE' WHERE name = {sql_literal(poi_name)};"
        )
    for segment_code in LEGACY_CAMPUS_SEGMENT_CODES:
        statements.append(
            "UPDATE road_segment "
            f"SET status = 'INACTIVE' WHERE segment_code = {sql_literal(segment_code)};"
        )
    return statements


def render_validation(area_code: str, expected_endpoint_count: int) -> str:
    return f"""
DO $$
DECLARE
    endpoint_count INTEGER;
    invalid_link_count INTEGER;
    cross_area_segment_node_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_link_count
    FROM poi_facility pf
    JOIN pilot_area pa ON pa.id = pf.pilot_area_id
    LEFT JOIN road_node rn
      ON rn.pilot_area_id = pf.pilot_area_id
     AND rn.osm_node_ref = pf.linked_node_code
    WHERE pa.area_code = {sql_literal(area_code)}
      AND pf.status = 'ACTIVE'
      AND pf.linked_node_code IS NOT NULL
      AND rn.id IS NULL;

    IF invalid_link_count > 0 THEN
        RAISE EXCEPTION 'Route endpoint validation failed: % invalid linked nodes', invalid_link_count;
    END IF;

    SELECT COUNT(*) INTO cross_area_segment_node_count
    FROM road_segment rs
    JOIN pilot_area pa ON pa.id = rs.pilot_area_id
    JOIN road_node start_node ON start_node.id = rs.start_node_id
    JOIN road_node end_node ON end_node.id = rs.end_node_id
    WHERE pa.area_code = {sql_literal(area_code)}
      AND rs.status = 'ACTIVE'
      AND (
          start_node.pilot_area_id <> rs.pilot_area_id
          OR end_node.pilot_area_id <> rs.pilot_area_id
      );

    IF cross_area_segment_node_count > 0 THEN
        RAISE EXCEPTION 'Route endpoint validation failed: % cross-area segment nodes',
            cross_area_segment_node_count;
    END IF;

    SELECT COUNT(*) INTO endpoint_count
    FROM poi_facility pf
    JOIN pilot_area pa ON pa.id = pf.pilot_area_id
    JOIN road_node rn
      ON rn.pilot_area_id = pf.pilot_area_id
     AND rn.osm_node_ref = pf.linked_node_code
    WHERE pa.area_code = {sql_literal(area_code)}
      AND pa.status = 'ACTIVE'
      AND pf.status = 'ACTIVE';

    IF endpoint_count < {expected_endpoint_count} THEN
        RAISE EXCEPTION 'Route endpoint validation failed: expected at least %, got %',
            {expected_endpoint_count}, endpoint_count;
    END IF;
END $$;
""".strip()


def build_full_init_sql() -> str:
    summary = validate_map_data()
    schema_sql = load_schema_sql(project_root() / "db" / "01_init_schema.sql").strip()
    area_code = load_seed_json("pilot_areas.json")[0]["area_code"]
    seed_statements = [
        *render_legacy_deactivation(),
        *render_pilot_areas(),
        *render_nodes(area_code),
        *render_segments(area_code),
        *render_pois(area_code),
        render_validation(area_code, summary["route_endpoints"]),
    ]
    return "\n\n".join(
        [
            "-- Full database initialization for the elder map MVP.",
            "-- Generated from db/01_init_schema.sql and backend/app/db/seed_data/*.json.",
            "SET client_encoding = 'UTF8';",
            schema_sql,
            "BEGIN;",
            *seed_statements,
            "COMMIT;",
            "",
        ]
    )


def run(output_path: Path = OUTPUT_PATH) -> Path:
    output_path.write_text(build_full_init_sql(), encoding="utf-8")
    return output_path


if __name__ == "__main__":
    print(run())
