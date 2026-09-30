from app.core.database import project_root
from app.db.schema import load_schema_sql
from app.db.seeds import load_seed_json, normalize_evidence_photo_refs
from app.db import seeds
from app.services.survey_records import load_survey_manifest


def test_load_schema_sql_reads_init_schema() -> None:
    schema_path = project_root() / "db" / "01_init_schema.sql"
    sql = load_schema_sql(schema_path)
    assert "CREATE EXTENSION IF NOT EXISTS postgis;" in sql
    assert "CREATE TABLE IF NOT EXISTS poi_facility" in sql
    assert "CREATE TABLE IF NOT EXISTS survey_record" in sql
    assert "REFERENCES pilot_area" not in sql.split("CREATE TABLE IF NOT EXISTS survey_record", 1)[1].split("-- =========================", 1)[0]


def test_survey_manifest_contains_all_archive_media_and_independent_sites() -> None:
    manifest = load_survey_manifest()
    assert len(manifest["sites"]) == 7
    assert len(manifest["records"]) == 67
    assert len(manifest["media"]) == 122
    assert all(record["review_status"] == "PENDING_REVIEW" for record in manifest["records"])


def test_survey_seed_is_idempotent_and_never_overwrites_manual_locations(monkeypatch) -> None:
    executions = []

    class FakeConnection:
        def execute(self, statement, params=None):
            executions.append((str(statement), params))

    class FakeBegin:
        def __enter__(self):
            return FakeConnection()

        def __exit__(self, *_args):
            return False

    class FakeEngine:
        def begin(self):
            return FakeBegin()

    monkeypatch.setattr(seeds, "engine", FakeEngine())
    counts = seeds.seed_survey_records()

    assert counts == {"survey_sites": 7, "survey_records": 67}
    record_statements = [sql for sql, _ in executions if "INSERT INTO survey_record" in sql]
    assert len(record_statements) == 67
    assert all("COALESCE(survey_record.location, EXCLUDED.location)" in sql for sql in record_statements)
    assert all("review_status = EXCLUDED.review_status" not in sql for sql in record_statements)


def test_schema_creates_pilot_area_before_map_entities() -> None:
    schema_path = project_root() / "db" / "01_init_schema.sql"
    sql = load_schema_sql(schema_path)
    assert sql.index("CREATE TABLE IF NOT EXISTS pilot_area") < sql.index(
        "CREATE TABLE IF NOT EXISTS poi_facility"
    )
    assert sql.count("pilot_area_id BIGINT") >= 3
    assert sql.index("ALTER TABLE poi_facility ADD COLUMN IF NOT EXISTS pilot_area_id") < sql.index(
        "CREATE INDEX IF NOT EXISTS idx_poi_facility_pilot_area_id"
    )


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
