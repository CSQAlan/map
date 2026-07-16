from app.core.database import project_root
from app.db.schema import load_schema_sql
from app.db.seeds import load_seed_json, normalize_evidence_photo_refs


def test_load_schema_sql_reads_init_schema() -> None:
    schema_path = project_root() / "db" / "01_init_schema.sql"
    sql = load_schema_sql(schema_path)
    assert "CREATE EXTENSION IF NOT EXISTS postgis;" in sql
    assert "CREATE TABLE IF NOT EXISTS poi_facility" in sql


def test_schema_creates_pilot_area_before_map_entities() -> None:
    schema_path = project_root() / "db" / "01_init_schema.sql"
    sql = load_schema_sql(schema_path)
    assert sql.index("CREATE TABLE IF NOT EXISTS pilot_area") < sql.index(
        "CREATE TABLE IF NOT EXISTS poi_facility"
    )
    assert sql.count("pilot_area_id BIGINT") >= 3


def test_load_seed_json_reads_shidayuan_pilot_area() -> None:
    rows = load_seed_json("pilot_areas.json")
    assert rows == [
        {
            "area_code": "SHIDAYUAN",
            "name": "师大苑",
            "boundary_wkt": (
                "POLYGON((106.2868 29.6132,106.2909 29.6132,"
                "106.2909 29.6167,106.2868 29.6167,106.2868 29.6132))"
            ),
            "center_wkt": "POINT(106.28885 29.61495)",
            "min_zoom": 16,
            "max_zoom": 20,
            "status": "ACTIVE",
        }
    ]


def test_load_seed_json_reads_core_pois() -> None:
    rows = load_seed_json("core_pois.json")
    names = {row["name"] for row in rows}
    assert {
        "师大苑大学城西路入口",
        "师大苑荷塘水景休息区",
        "师大苑外部商业街人行道",
    } <= names
    assert all("linked_node_code" in row for row in rows)


def test_core_nodes_use_photo_gps_coordinates() -> None:
    rows = {row["node_code"]: row for row in load_seed_json("core_nodes.json")}
    assert rows["N_SY_GATE_WEST"]["lon"] == 106.288375
    assert rows["N_SY_GATE_WEST"]["lat"] == 29.6136694
    assert rows["N_SY_MAIN_CENTER"]["source_ref"] == "IMG_9540.JPG"
    assert all(row["data_confidence"] == 5 for row in rows.values())


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


def test_seed_normalizes_original_photo_names_to_stable_ids() -> None:
    assert normalize_evidence_photo_refs(["IMG_9499.JPG", "IMG_9510.PNG"]) == [
        "SY_IMG_9499",
        "SY_IMG_9510",
    ]


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
