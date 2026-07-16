import json
from pathlib import Path

from sqlalchemy import text

from app.core.database import engine


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


def seed_core_pois() -> int:
    rows = load_seed_json("core_pois.json")
    select_sql = text(
        """
        SELECT id
        FROM poi_facility
        WHERE name = :name AND poi_type = :poi_type
        """
    )
    insert_sql = text(
        """
        INSERT INTO poi_facility (
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
            :name,
            :poi_type,
            :description,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
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
            description = :description,
            geom = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
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
        WHERE name = :name AND poi_type = :poi_type
        """
    )
    with engine.begin() as connection:
        for row in rows:
            payload = {
                **POI_DEFAULTS,
                **row,
                "evidence_photo_refs": json.dumps(
                    row.get("evidence_photo_refs", POI_DEFAULTS["evidence_photo_refs"]),
                    ensure_ascii=False,
                ),
            }
            existing_id = connection.execute(select_sql, payload).scalar_one_or_none()
            if existing_id is None:
                connection.execute(insert_sql, payload)
            else:
                connection.execute(update_sql, payload)
    return len(rows)


def seed_core_nodes() -> int:
    rows = load_seed_json("core_nodes.json")
    select_sql = text(
        """
        SELECT id
        FROM road_node
        WHERE osm_node_ref = :node_code
        """
    )
    insert_sql = text(
        """
        INSERT INTO road_node (
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
            name = :name,
            geom = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
            node_type = :node_type,
            source_provider = :source_provider,
            source_coord_type = :source_coord_type,
            source_ref = :source_ref,
            data_confidence = :data_confidence
        WHERE osm_node_ref = :node_code
        """
    )
    with engine.begin() as connection:
        for row in rows:
            payload = {**NODE_DEFAULTS, **row}
            existing_id = connection.execute(select_sql, payload).scalar_one_or_none()
            if existing_id is None:
                connection.execute(insert_sql, payload)
            else:
                connection.execute(update_sql, payload)
    return len(rows)


def seed_core_segments() -> int:
    rows = load_seed_json("core_segments.json")
    update_sql = text(
        """
        UPDATE road_segment
        SET
            start_node_id = (
                SELECT id FROM road_node WHERE osm_node_ref = :start_node_code
            ),
            end_node_id = (
                SELECT id FROM road_node WHERE osm_node_ref = :end_node_code
            ),
            name = :name,
            geom = ST_SetSRID(ST_GeomFromText(:wkt), 4326),
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
            payload = {**SEGMENT_DEFAULTS, **row}
            payload["evidence_photo_refs"] = json.dumps(
                payload["evidence_photo_refs"],
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
                    WHERE osm_node_ref = :code
                    """
                ),
                {"code": row["start_node_code"]},
            ).scalar_one()
            end_node_id = connection.execute(
                text(
                    """
                    SELECT id
                    FROM road_node
                    WHERE osm_node_ref = :code
                    """
                ),
                {"code": row["end_node_code"]},
            ).scalar_one()
            connection.execute(
                text(
                    """
                    INSERT INTO road_segment (
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
                        :segment_code,
                        :start_node_id,
                        :end_node_id,
                        :name,
                        ST_SetSRID(ST_GeomFromText(:wkt), 4326),
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


def seed_map_data() -> dict[str, int]:
    deactivate_legacy_campus_seed_data()
    return {
        "pois": seed_core_pois(),
        "nodes": seed_core_nodes(),
        "segments": seed_core_segments(),
    }
