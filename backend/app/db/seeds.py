import json
from pathlib import Path

from sqlalchemy import text

from app.core.database import engine
from app.services.photo_evidence import load_photo_manifest


SEED_DIR = Path(__file__).resolve().parent / "seed_data"

SEGMENT_DEFAULTS = {
    "surface_type": "CONCRETE",
    "width_m": 1.5,
    "has_handrail": False,
    "has_ramp": False,
    "shade_coverage_percent": 20,
    "bench_count": 0,
    "step_height_cm": 0,
    "source_provider": "manual_photo",
    "source_coord_type": "wgs84",
    "source_ref": "docs/data-collection/shidayuan_photo_segment_mapping_draft.md",
    "evidence_photo_refs": [],
    "data_confidence": 3,
    "verified_by": None,
}

POI_DEFAULTS = {
    "address_text": None,
    "linked_node_code": None,
    "source_provider": "manual_photo",
    "source_coord_type": "wgs84",
    "source_ref": "docs/data-collection/shidayuan_photo_segment_mapping_draft.md",
    "evidence_photo_refs": [],
    "data_confidence": 3,
}

NODE_DEFAULTS = {
    "source_provider": "manual_photo",
    "source_coord_type": "wgs84",
    "source_ref": "docs/data-collection/shidayuan_photo_segment_mapping_draft.md",
    "data_confidence": 3,
}

LEGACY_CAMPUS_POI_NAMES = [
    "重庆师范大学三号门",
    "重庆师范大学校医院",
    "重庆师范大学食堂",
]

LEGACY_CAMPUS_SEGMENT_CODES = [
    "S_GATE3_TO_CROSS1",
    "S_CROSS1_TO_CLINIC",
    "S_CLINIC_TO_CROSS2",
    "S_CROSS2_TO_CANTEEN",
    "S_GATE3_TO_REST",
    "S_REST_TO_CLINIC",
    "S_GATE3_TO_WIDE_PATH",
    "S_WIDE_PATH_TO_SIDE",
    "S_SIDE_TO_CANTEEN",
    "S_REST_TO_WIDE_PATH",
    "S_CROSS1_TO_WIDE_PATH",
]


def load_seed_json(filename: str) -> list[dict]:
    return json.loads((SEED_DIR / filename).read_text(encoding="utf-8"))


def normalize_evidence_photo_refs(refs: list[str]) -> list[str]:
    by_original_name = {
        evidence.original_name: photo_id
        for photo_id, evidence in load_photo_manifest().items()
    }
    return [by_original_name.get(ref, ref) for ref in refs]


def validate_map_data() -> dict[str, int]:
    areas = load_seed_json("pilot_areas.json")
    nodes = load_seed_json("core_nodes.json")
    pois = load_seed_json("core_pois.json")
    segments = load_seed_json("core_segments.json")

    area_codes = [row["area_code"] for row in areas]
    node_codes = [row["node_code"] for row in nodes]
    segment_codes = [row["segment_code"] for row in segments]
    poi_keys = [(row["name"], row["poi_type"]) for row in pois]
    for label, values in {
        "pilot area": area_codes,
        "road node": node_codes,
        "road segment": segment_codes,
        "POI": poi_keys,
    }.items():
        duplicates = sorted({value for value in values if values.count(value) > 1})
        if duplicates:
            raise ValueError(f"Duplicate {label} seed keys: {duplicates}")

    node_code_set = set(node_codes)
    invalid_poi_links = [
        row["name"]
        for row in pois
        if row.get("linked_node_code") and row["linked_node_code"] not in node_code_set
    ]
    if invalid_poi_links:
        raise ValueError(f"POIs reference missing route nodes: {invalid_poi_links}")

    invalid_segment_refs = [
        row["segment_code"]
        for row in segments
        if row["start_node_code"] not in node_code_set or row["end_node_code"] not in node_code_set
    ]
    if invalid_segment_refs:
        raise ValueError(f"Segments reference missing route nodes: {invalid_segment_refs}")

    segment_node_codes = {
        code
        for row in segments
        for code in (row["start_node_code"], row["end_node_code"])
    }
    endpoint_pois = [
        row for row in pois if row.get("linked_node_code") in node_code_set and row.get("status", "ACTIVE") == "ACTIVE"
    ]
    isolated_endpoints = [
        row["name"] for row in endpoint_pois if row["linked_node_code"] not in segment_node_codes
    ]
    if isolated_endpoints:
        raise ValueError(f"Route endpoints are not connected to any segment: {isolated_endpoints}")
    if len(endpoint_pois) < 2:
        raise ValueError("At least two linked active POIs are required for route planning")

    return {
        "areas": len(areas),
        "nodes": len(nodes),
        "pois": len(pois),
        "segments": len(segments),
        "route_endpoints": len(endpoint_pois),
    }


def deactivate_legacy_campus_seed_data() -> None:
    with engine.begin() as connection:
        for poi_name in LEGACY_CAMPUS_POI_NAMES:
            connection.execute(
                text("UPDATE poi_facility SET status = 'INACTIVE' WHERE name = :poi_name"),
                {"poi_name": poi_name},
            )
        for segment_code in LEGACY_CAMPUS_SEGMENT_CODES:
            connection.execute(
                text(
                    """
                    UPDATE road_segment
                    SET status = 'INACTIVE'
                    WHERE segment_code = :segment_code
                    """
                ),
                {"segment_code": segment_code},
            )


def seed_pilot_areas() -> dict[str, int]:
    rows = load_seed_json("pilot_areas.json")
    area_ids = {}
    upsert_sql = text(
        """
        INSERT INTO pilot_area (
            area_code, name, boundary_geom, center_geom, min_zoom, max_zoom, status
        )
        VALUES (
            :area_code,
            :name,
            ST_SetSRID(ST_GeomFromText(:boundary_wkt), 4326),
            ST_SetSRID(ST_GeomFromText(:center_wkt), 4326),
            :min_zoom,
            :max_zoom,
            :status
        )
        ON CONFLICT (area_code) DO UPDATE SET
            name = EXCLUDED.name,
            boundary_geom = EXCLUDED.boundary_geom,
            center_geom = EXCLUDED.center_geom,
            min_zoom = EXCLUDED.min_zoom,
            max_zoom = EXCLUDED.max_zoom,
            status = EXCLUDED.status,
            updated_at = NOW()
        RETURNING id
        """
    )
    with engine.begin() as connection:
        for row in rows:
            area_ids[row["area_code"]] = connection.execute(upsert_sql, row).scalar_one()
    return area_ids


def seed_core_pois(pilot_area_id: int) -> int:
    rows = load_seed_json("core_pois.json")
    select_sql = text(
        """
        SELECT id
        FROM poi_facility
        WHERE pilot_area_id = :pilot_area_id AND name = :name AND poi_type = :poi_type
        """
    )
    insert_sql = text(
        """
        INSERT INTO poi_facility (
            pilot_area_id,
            name,
            poi_type,
            description,
            geom,
            address_text,
            linked_node_code,
            is_accessible,
            source,
            source_provider,
            source_coord_type,
            source_ref,
            evidence_photo_refs,
            data_confidence
        )
        VALUES (
            :pilot_area_id,
            :name,
            :poi_type,
            :description,
            COALESCE(
                (
                    SELECT geom
                    FROM road_node
                    WHERE pilot_area_id = :pilot_area_id
                      AND osm_node_ref = :linked_node_code
                ),
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
            ),
            :address_text,
            :linked_node_code,
            :is_accessible,
            :source,
            :source_provider,
            :source_coord_type,
            :source_ref,
            CAST(:evidence_photo_refs AS jsonb),
            :data_confidence
        )
        """
    )
    update_sql = text(
        """
        UPDATE poi_facility
        SET
            pilot_area_id = :pilot_area_id,
            description = :description,
            geom = COALESCE(
                (
                    SELECT geom
                    FROM road_node
                    WHERE pilot_area_id = :pilot_area_id
                      AND osm_node_ref = :linked_node_code
                ),
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
            ),
            address_text = :address_text,
            linked_node_code = :linked_node_code,
            is_accessible = :is_accessible,
            status = 'ACTIVE',
            source = :source,
            source_provider = :source_provider,
            source_coord_type = :source_coord_type,
            source_ref = :source_ref,
            evidence_photo_refs = CAST(:evidence_photo_refs AS jsonb),
            data_confidence = :data_confidence
        WHERE pilot_area_id = :pilot_area_id AND name = :name AND poi_type = :poi_type
        """
    )
    with engine.begin() as connection:
        for row in rows:
            payload = {
                **POI_DEFAULTS,
                **row,
                "pilot_area_id": pilot_area_id,
                "evidence_photo_refs": json.dumps(
                    normalize_evidence_photo_refs(
                        row.get("evidence_photo_refs", POI_DEFAULTS["evidence_photo_refs"])
                    ),
                    ensure_ascii=False,
                ),
            }
            existing_id = connection.execute(select_sql, payload).scalar_one_or_none()
            if existing_id is None:
                connection.execute(insert_sql, payload)
            else:
                connection.execute(update_sql, payload)
    return len(rows)


def seed_core_nodes(pilot_area_id: int) -> int:
    rows = load_seed_json("core_nodes.json")
    select_sql = text(
        """
        SELECT id
        FROM road_node
        WHERE pilot_area_id = :pilot_area_id AND osm_node_ref = :node_code
        """
    )
    insert_sql = text(
        """
        INSERT INTO road_node (
            pilot_area_id,
            osm_node_ref,
            name,
            geom,
            node_type,
            source_provider,
            source_coord_type,
            source_ref,
            data_confidence
        )
        VALUES (
            :pilot_area_id,
            :node_code,
            :name,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
            :node_type,
            :source_provider,
            :source_coord_type,
            :source_ref,
            :data_confidence
        )
        """
    )
    update_sql = text(
        """
        UPDATE road_node
        SET
            pilot_area_id = :pilot_area_id,
            name = :name,
            geom = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
            node_type = :node_type,
            source_provider = :source_provider,
            source_coord_type = :source_coord_type,
            source_ref = :source_ref,
            data_confidence = :data_confidence
        WHERE pilot_area_id = :pilot_area_id AND osm_node_ref = :node_code
        """
    )
    with engine.begin() as connection:
        for row in rows:
            payload = {**NODE_DEFAULTS, **row, "pilot_area_id": pilot_area_id}
            existing_id = connection.execute(select_sql, payload).scalar_one_or_none()
            if existing_id is None:
                connection.execute(insert_sql, payload)
            else:
                connection.execute(update_sql, payload)
    return len(rows)


def seed_core_segments(pilot_area_id: int) -> int:
    rows = load_seed_json("core_segments.json")
    update_sql = text(
        """
        UPDATE road_segment
        SET
            pilot_area_id = :pilot_area_id,
            start_node_id = (
                SELECT id
                FROM road_node
                WHERE pilot_area_id = :pilot_area_id AND osm_node_ref = :start_node_code
            ),
            end_node_id = (
                SELECT id
                FROM road_node
                WHERE pilot_area_id = :pilot_area_id AND osm_node_ref = :end_node_code
            ),
            name = :name,
            geom = (
                SELECT ST_MakeLine(start_node.geom, end_node.geom)
                FROM road_node start_node, road_node end_node
                WHERE start_node.osm_node_ref = :start_node_code
                  AND end_node.osm_node_ref = :end_node_code
                  AND start_node.pilot_area_id = :pilot_area_id
                  AND end_node.pilot_area_id = :pilot_area_id
            ),
            length_m = :length_m,
            slope_percent = :slope_percent,
            surface_type = :surface_type,
            width_m = :width_m,
            surface_level = :surface_level,
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
            source_provider = :source_provider,
            source_coord_type = :source_coord_type,
            source_ref = :source_ref,
            evidence_photo_refs = CAST(:evidence_photo_refs AS jsonb),
            data_confidence = :data_confidence,
            verified_by = :verified_by,
            status = 'ACTIVE'
        WHERE segment_code = :segment_code
        """
    )
    with engine.begin() as connection:
        for row in rows:
            payload = {**SEGMENT_DEFAULTS, **row, "pilot_area_id": pilot_area_id}
            payload["evidence_photo_refs"] = json.dumps(
                normalize_evidence_photo_refs(payload["evidence_photo_refs"]),
                ensure_ascii=False,
            )
            existing_id = connection.execute(
                text(
                    """
                    SELECT id
                    FROM road_segment
                    WHERE segment_code = :segment_code
                    """
                ),
                {"segment_code": row["segment_code"]},
            ).scalar_one_or_none()
            if existing_id is not None:
                connection.execute(update_sql, payload)
                continue

            start_node_id = connection.execute(
                text(
                    """
                    SELECT id
                    FROM road_node
                    WHERE pilot_area_id = :pilot_area_id AND osm_node_ref = :code
                    """
                ),
                {"pilot_area_id": pilot_area_id, "code": row["start_node_code"]},
            ).scalar_one()
            end_node_id = connection.execute(
                text(
                    """
                    SELECT id
                    FROM road_node
                    WHERE pilot_area_id = :pilot_area_id AND osm_node_ref = :code
                    """
                ),
                {"pilot_area_id": pilot_area_id, "code": row["end_node_code"]},
            ).scalar_one()
            connection.execute(
                text(
                    """
                    INSERT INTO road_segment (
                        pilot_area_id,
                        segment_code,
                        start_node_id,
                        end_node_id,
                        name,
                        geom,
                        length_m,
                        slope_percent,
                        surface_type,
                        width_m,
                        surface_level,
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
                        data_source,
                        source_provider,
                        source_coord_type,
                        source_ref,
                        evidence_photo_refs,
                        data_confidence,
                        verified_by
                    )
                    VALUES (
                        :pilot_area_id,
                        :segment_code,
                        :start_node_id,
                        :end_node_id,
                        :name,
                        ST_MakeLine(
                            (SELECT geom FROM road_node WHERE id = :start_node_id),
                            (SELECT geom FROM road_node WHERE id = :end_node_id)
                        ),
                        :length_m,
                        :slope_percent,
                        :surface_type,
                        :width_m,
                        :surface_level,
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
                        'MANUAL',
                        :source_provider,
                        :source_coord_type,
                        :source_ref,
                        CAST(:evidence_photo_refs AS jsonb),
                        :data_confidence,
                        :verified_by
                    )
                    """
                ),
                {
                    **payload,
                    "start_node_id": start_node_id,
                    "end_node_id": end_node_id,
                },
            )
    return len(rows)


def validate_database_map_data(area_code: str = "SHIDAYUAN") -> dict[str, int]:
    validation_sql = text(
        """
        WITH active_area AS (
            SELECT id
            FROM pilot_area
            WHERE area_code = :area_code AND status = 'ACTIVE'
        ),
        route_endpoints AS (
            SELECT pf.id, pf.name, pf.linked_node_code, rn.id AS node_id
            FROM poi_facility pf
            JOIN active_area pa ON pa.id = pf.pilot_area_id
            LEFT JOIN road_node rn
              ON rn.pilot_area_id = pf.pilot_area_id
             AND rn.osm_node_ref = pf.linked_node_code
            WHERE pf.status = 'ACTIVE'
              AND pf.linked_node_code IS NOT NULL
        ),
        segment_nodes AS (
            SELECT rs.start_node_id AS node_id
            FROM road_segment rs
            JOIN active_area pa ON pa.id = rs.pilot_area_id
            WHERE rs.status = 'ACTIVE'
            UNION
            SELECT rs.end_node_id AS node_id
            FROM road_segment rs
            JOIN active_area pa ON pa.id = rs.pilot_area_id
            WHERE rs.status = 'ACTIVE'
        ),
        cross_area_segments AS (
            SELECT rs.id
            FROM road_segment rs
            JOIN active_area pa ON pa.id = rs.pilot_area_id
            JOIN road_node start_node ON start_node.id = rs.start_node_id
            JOIN road_node end_node ON end_node.id = rs.end_node_id
            WHERE rs.status = 'ACTIVE'
              AND (
                  start_node.pilot_area_id <> rs.pilot_area_id
                  OR end_node.pilot_area_id <> rs.pilot_area_id
              )
        )
        SELECT
            (SELECT COUNT(*) FROM active_area) AS active_area_count,
            (SELECT COUNT(*) FROM route_endpoints WHERE node_id IS NOT NULL) AS route_endpoint_count,
            (SELECT COUNT(*) FROM route_endpoints WHERE node_id IS NULL) AS invalid_link_count,
            (SELECT COUNT(*) FROM cross_area_segments) AS cross_area_segment_node_count,
            (
                SELECT COUNT(*)
                FROM route_endpoints re
                WHERE re.node_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM segment_nodes sn WHERE sn.node_id = re.node_id
                  )
            ) AS isolated_endpoint_count
        """
    )
    with engine.begin() as connection:
        row = connection.execute(validation_sql, {"area_code": area_code}).mappings().one()

    summary = {key: int(row[key]) for key in row.keys()}
    if summary["active_area_count"] != 1:
        raise ValueError(f"Expected one active pilot area for {area_code}, got {summary['active_area_count']}")
    if summary["invalid_link_count"]:
        raise ValueError(f"Database has {summary['invalid_link_count']} active POIs with invalid linked nodes")
    if summary["cross_area_segment_node_count"]:
        raise ValueError(
            f"Database has {summary['cross_area_segment_node_count']} active segments with cross-area nodes"
        )
    if summary["isolated_endpoint_count"]:
        raise ValueError(
            f"Database has {summary['isolated_endpoint_count']} route endpoints disconnected from active segments"
        )
    if summary["route_endpoint_count"] < 2:
        raise ValueError("Database requires at least two active linked route endpoints")
    return summary


def seed_map_data() -> dict[str, int]:
    validate_map_data()
    deactivate_legacy_campus_seed_data()
    area_ids = seed_pilot_areas()
    shidayuan_area_id = area_ids["SHIDAYUAN"]
    seed_summary = {
        "areas": len(area_ids),
        "nodes": seed_core_nodes(shidayuan_area_id),
        "pois": seed_core_pois(shidayuan_area_id),
        "segments": seed_core_segments(shidayuan_area_id),
    }
    db_summary = validate_database_map_data("SHIDAYUAN")
    return {
        **seed_summary,
        "route_endpoints": db_summary["route_endpoint_count"],
        "invalid_link_count": db_summary["invalid_link_count"],
        "isolated_endpoint_count": db_summary["isolated_endpoint_count"],
        "cross_area_segment_node_count": db_summary["cross_area_segment_node_count"],
    }
