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
    assert {
        "师大苑大学城西路入口",
        "师大苑荷塘水景休息区",
        "师大苑外部商业街人行道",
    } <= names
    assert all("linked_node_code" in row for row in rows)


def test_seed_segments_cover_pilot_routes() -> None:
    rows = load_seed_json("core_segments.json")
    codes = {row["segment_code"] for row in rows}
    assert "S_SY_GATE_TO_MAIN" in codes
    assert "S_SY_MAIN_TO_LOTUS" in codes
    assert "S_SY_MAIN_TO_BUILDING_A" in codes
    assert "S_SY_GATE_TO_COMMERCIAL" in codes
    assert "S_SY_STAIR_SHORTCUT" in codes
    assert "S_SY_CRACKED_PAVEMENT" in codes
    assert all("evidence_photo_refs" in row for row in rows)


def test_seed_graph_has_route_alternatives() -> None:
    rows = load_seed_json("core_segments.json")
    starts = {}
    for row in rows:
        starts.setdefault(row["start_node_code"], set()).add(row["end_node_code"])

    assert len(starts["N_SY_GATE_WEST"]) >= 4
    assert "N_SY_MAIN_CENTER" in starts["N_SY_GATE_WEST"]
    assert "N_SY_COMMERCIAL_SIDEWALK" in starts["N_SY_GATE_WEST"]
    assert "N_SY_LOTUS_ENTRY" in starts["N_SY_MAIN_CENTER"]
    assert "N_SY_LOTUS_ENTRY" in starts["N_SY_BUILDING_A"]
    assert "N_SY_LOTUS_ENTRY" in starts["N_SY_BUILDING_B"]
