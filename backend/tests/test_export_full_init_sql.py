from app.scripts.export_full_init_sql import build_full_init_sql, run


def test_build_full_init_sql_contains_schema_and_seed_data() -> None:
    sql = build_full_init_sql()
    assert "CREATE TABLE IF NOT EXISTS poi_facility" in sql
    assert "ON CONFLICT (pilot_area_id, name, poi_type) DO UPDATE SET" in sql
    assert "ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET" in sql
    assert "Route endpoint validation failed" in sql
    assert "cross-area segment nodes" in sql
    assert "S_SY_GATE_TO_MAIN" in sql


def test_run_writes_full_init_sql(tmp_path) -> None:
    output_path = tmp_path / "full_init.sql"
    written_path = run(output_path)
    assert written_path == output_path
    sql = output_path.read_text(encoding="utf-8")
    assert sql.startswith("-- Full database initialization")
    assert sql.rstrip().endswith("COMMIT;")
