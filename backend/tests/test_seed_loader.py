from app.core.database import project_root
from app.db.schema import load_schema_sql
from app.db.seeds import load_seed_json


def test_load_schema_sql_reads_init_schema() -> None:
    schema_path = project_root() / "db" / "01_init_schema.sql"
    sql = load_schema_sql(schema_path)
    assert "CREATE EXTENSION IF NOT EXISTS postgis;" in sql
    assert "CREATE TABLE IF NOT EXISTS poi_facility" in sql


def test_load_seed_json_reads_core_pois() -> None:
    rows = load_seed_json("core_pois.json")
    names = {row["name"] for row in rows}
    assert {"重庆师范大学三号门", "重庆师范大学校医院", "重庆师范大学食堂"} <= names


def test_seed_segments_cover_pilot_routes() -> None:
    rows = load_seed_json("core_segments.json")
    codes = {row["segment_code"] for row in rows}
    assert "S_GATE3_TO_CROSS1" in codes
    assert "S_CROSS1_TO_CLINIC" in codes
    assert "S_CLINIC_TO_CROSS2" in codes
    assert "S_CROSS2_TO_CANTEEN" in codes
    assert "S_GATE3_TO_REST" in codes
    assert "S_REST_TO_CLINIC" in codes
    assert "S_GATE3_TO_WIDE_PATH" in codes
    assert "S_WIDE_PATH_TO_SIDE" in codes
    assert "S_SIDE_TO_CANTEEN" in codes


def test_seed_graph_has_route_alternatives() -> None:
    rows = load_seed_json("core_segments.json")
    starts = {}
    for row in rows:
        starts.setdefault(row["start_node_code"], set()).add(row["end_node_code"])

    assert len(starts["N_GATE3"]) >= 3
    assert "N_CLINIC" in starts["N_CROSS_1"]
    assert "N_CLINIC" in starts["N_REST_AREA"]
    assert "N_CANTEEN" in starts["N_CROSS_2"]
    assert "N_CANTEEN" in starts["N_SIDE_PATH"]
