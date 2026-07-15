from pathlib import Path

from app.services import segment_collection_importer
from app.services.segment_collection_importer import import_collection_csv, load_collection_csv


HEADER = (
    "segment_code,start_node_code,end_node_code,name,collector,collect_date,lon_start,lat_start,"
    "lon_end,lat_end,length_m,slope_percent,width_m,surface_type,surface_level,safety_level,"
    "barrier_free_level,rest_facility_score,lighting_level,crossing_safety_level,"
    "wheelchair_accessible,has_handrail,has_ramp,shade_coverage_percent,bench_count,"
    "step_count,step_height_cm,photo_urls,remark"
)


def write_csv(path: Path, row: str) -> None:
    path.write_text(f"{HEADER}\n{row}\n", encoding="utf-8")


def test_load_collection_csv_accepts_valid_row(tmp_path: Path) -> None:
    csv_path = tmp_path / "collection.csv"
    write_csv(
        csv_path,
        'S_GATE3_TO_WIDE_PATH,N_GATE3,N_WIDE_PATH,三号门到宽缓步道,采集员A,2026-07-15,'
        '106.3071,29.6038,106.3084,29.6040,136,1.2,1.6,CONCRETE,4,5,5,4,5,5,'
        'true,false,true,35,1,0,0,"[]","ok"',
    )
    result = load_collection_csv(csv_path)
    assert result.is_valid
    assert result.rows[0]["segment_code"] == "S_GATE3_TO_WIDE_PATH"
    assert result.rows[0]["wheelchair_accessible"] is True
    assert result.rows[0]["surface_type"] == "CONCRETE"


def test_load_collection_csv_rejects_invalid_ranges(tmp_path: Path) -> None:
    csv_path = tmp_path / "collection.csv"
    write_csv(
        csv_path,
        'S_BAD,N_GATE3,N_BAD,坏数据,采集员A,2026-07-15,106,29,106,29,50,40,1.2,CONCRETE,'
        '6,5,5,4,5,5,true,false,true,120,0,0,0,"[]","bad"',
    )
    result = load_collection_csv(csv_path)
    assert not result.is_valid
    columns = {issue.column for issue in result.issues}
    assert {"slope_percent", "surface_level", "shade_coverage_percent"} <= columns


def test_load_collection_csv_rejects_unknown_surface_type(tmp_path: Path) -> None:
    csv_path = tmp_path / "collection.csv"
    write_csv(
        csv_path,
        'S_BAD,N_GATE3,N_BAD,坏数据,采集员A,2026-07-15,106,29,106,29,50,1,1.2,MUD,'
        '4,5,5,4,5,5,true,false,true,20,0,0,0,"[]","bad"',
    )
    result = load_collection_csv(csv_path)
    assert not result.is_valid
    assert any(issue.column == "surface_type" for issue in result.issues)


def test_load_collection_csv_rejects_non_finite_numbers(tmp_path: Path) -> None:
    csv_path = tmp_path / "collection.csv"
    write_csv(
        csv_path,
        'S_BAD,N_GATE3,N_BAD,Bad numbers,Collector A,2026-07-15,106,29,106,29,nan,1,inf,CONCRETE,'
        '4,5,5,4,5,5,true,false,true,20,0,0,0,"[]","bad"',
    )
    result = load_collection_csv(csv_path)
    assert not result.is_valid
    columns = {issue.column for issue in result.issues}
    assert {"length_m", "width_m"} <= columns


def test_load_collection_csv_requires_expected_columns(tmp_path: Path) -> None:
    csv_path = tmp_path / "collection.csv"
    csv_path.write_text("segment_code,collector\nS1,A\n", encoding="utf-8")
    result = load_collection_csv(csv_path)
    assert not result.is_valid
    assert result.issues[0].row_number == 0


def test_import_collection_csv_dry_run_does_not_insert(tmp_path: Path, monkeypatch) -> None:
    csv_path = tmp_path / "collection.csv"
    write_csv(
        csv_path,
        'S_GATE3_TO_WIDE_PATH,N_GATE3,N_WIDE_PATH,Gate 3 to path,Collector A,2026-07-15,'
        '106.3071,29.6038,106.3084,29.6040,136,1.2,1.6,CONCRETE,4,5,5,4,5,5,'
        'true,false,true,35,1,0,0,"[]","ok"',
    )
    inserted = False

    def fake_get_segment_id(db, segment_code: str) -> int:
        return 1

    def fake_execute(*args, **kwargs) -> None:
        nonlocal inserted
        inserted = True

    monkeypatch.setattr(segment_collection_importer, "get_segment_id", fake_get_segment_id)
    result = import_collection_csv(csv_path, type("FakeDb", (), {"execute": fake_execute})(), dry_run=True)

    assert result == {"valid": True, "imported": 0, "checked": 1, "issues": []}
    assert inserted is False


def test_import_collection_csv_rejects_unknown_segment_code(tmp_path: Path, monkeypatch) -> None:
    csv_path = tmp_path / "collection.csv"
    write_csv(
        csv_path,
        'S_UNKNOWN,N_GATE3,N_UNKNOWN,Unknown segment,Collector A,2026-07-15,'
        '106.3071,29.6038,106.3084,29.6040,136,1.2,1.6,CONCRETE,4,5,5,4,5,5,'
        'true,false,true,35,1,0,0,"[]","ok"',
    )

    def fake_get_segment_id(db, segment_code: str) -> None:
        return None

    monkeypatch.setattr(segment_collection_importer, "get_segment_id", fake_get_segment_id)
    result = import_collection_csv(csv_path, object(), dry_run=True)

    assert result["valid"] is False
    assert result["imported"] == 0
    assert result["issues"][0]["column"] == "segment_code"


def test_import_collection_csv_skips_duplicate_pending_record(tmp_path: Path, monkeypatch) -> None:
    csv_path = tmp_path / "collection.csv"
    write_csv(
        csv_path,
        'S_GATE3_TO_WIDE_PATH,N_GATE3,N_WIDE_PATH,Gate 3 to path,Collector A,2026-07-15,'
        '106.3071,29.6038,106.3084,29.6040,136,1.2,1.6,CONCRETE,4,5,5,4,5,5,'
        'true,false,true,35,1,0,0,"[]","ok"',
    )
    inserted = False
    committed = False

    def fake_get_segment_id(db, segment_code: str) -> int:
        return 1

    def fake_ensure_collector_user(db, collector: str) -> int:
        return 2

    def fake_has_existing_collection_record(db, segment_id: int, collector_user_id: int, collect_date) -> bool:
        return True

    class FakeDb:
        def execute(self, *args, **kwargs) -> None:
            nonlocal inserted
            inserted = True

        def commit(self) -> None:
            nonlocal committed
            committed = True

    fake_db = FakeDb()
    monkeypatch.setattr(segment_collection_importer, "get_segment_id", fake_get_segment_id)
    monkeypatch.setattr(segment_collection_importer, "ensure_collector_user", fake_ensure_collector_user)
    monkeypatch.setattr(segment_collection_importer, "has_existing_collection_record", fake_has_existing_collection_record)

    result = import_collection_csv(csv_path, fake_db)

    assert result["valid"] is True
    assert result["imported"] == 0
    assert result["skipped"] == 1
    assert inserted is False
    assert committed is True
