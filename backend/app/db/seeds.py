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
}


def load_seed_json(filename: str) -> list[dict]:
    return json.loads((SEED_DIR / filename).read_text(encoding="utf-8"))


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
        INSERT INTO poi_facility (name, poi_type, description, geom, is_accessible, source)
        VALUES (
            :name,
            :poi_type,
            :description,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
            :is_accessible,
            :source
        )
        """
    )
    with engine.begin() as connection:
        for row in rows:
            existing_id = connection.execute(select_sql, row).scalar_one_or_none()
            if existing_id is None:
                connection.execute(insert_sql, row)
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
        INSERT INTO road_node (osm_node_ref, name, geom, node_type)
        VALUES (
            :node_code,
            :name,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
            :node_type
        )
        """
    )
    with engine.begin() as connection:
        for row in rows:
            existing_id = connection.execute(select_sql, row).scalar_one_or_none()
            if existing_id is None:
                connection.execute(insert_sql, row)
    return len(rows)


def seed_core_segments() -> int:
    rows = load_seed_json("core_segments.json")
    update_sql = text(
        """
        UPDATE road_segment
        SET
            name = :name,
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
            data_source = 'MANUAL'
        WHERE segment_code = :segment_code
        """
    )
    with engine.begin() as connection:
        for row in rows:
            payload = {**SEGMENT_DEFAULTS, **row}
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
                        data_source
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
                        'MANUAL'
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
    return {
        "pois": seed_core_pois(),
        "nodes": seed_core_nodes(),
        "segments": seed_core_segments(),
    }
