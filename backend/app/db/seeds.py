import json
from pathlib import Path

from sqlalchemy import text

from app.core.database import engine


SEED_DIR = Path(__file__).resolve().parent / "seed_data"


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
    with engine.begin() as connection:
        for row in rows:
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
                        surface_level,
                        safety_level,
                        barrier_free_level,
                        rest_facility_score,
                        lighting_level,
                        crossing_safety_level,
                        wheelchair_accessible,
                        step_count,
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
                        :surface_level,
                        :safety_level,
                        :barrier_free_level,
                        :rest_facility_score,
                        :lighting_level,
                        :crossing_safety_level,
                        :wheelchair_accessible,
                        :step_count,
                        'MANUAL'
                    )
                    """
                ),
                {
                    **row,
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
