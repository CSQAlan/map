# Segment Collection CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated CSV import path that turns field-collected road-segment data into pending `segment_collect_record` rows.

**Architecture:** Keep the feature as a backend service plus thin CLI wrapper. The service parses and validates the CSV, checks active `road_segment` references, and inserts pending collection records without mutating final route data.

**Tech Stack:** Python 3.11, FastAPI project layout, SQLAlchemy 2.0, PostgreSQL/PostGIS, pytest, PowerShell

## Global Constraints

- CSV import must support `--dry-run` and avoid database writes in dry-run mode.
- Imported records must use `segment_collect_record.status='PENDING'`.
- The importer must validate values before insertion.
- The importer must reject unknown `segment_code` values.
- The importer must create collector users with `role='COLLECTOR'`, not `ADMIN`.
- The importer must skip duplicate pending records for the same road segment, collector, and collection date.
- This slice must not update `road_segment` directly.

---

## File Structure

- Create: `backend/app/services/segment_collection_importer.py`
  - Owns CSV parsing, value validation, database reference checks, collector user creation, and record insertion.
- Create: `backend/app/scripts/import_segment_collection_csv.py`
  - CLI entry point for dry-run and formal import.
- Create: `backend/tests/test_segment_collection_importer.py`
  - Unit tests for CSV validation behavior.
- Modify: `docs/data-collection/road_segment_collection_template.csv`
  - Use a real pilot road-segment code in the sample row.
- Modify: `docs/data-collection/road_segment_collection_guide.md`
  - Document dry-run and formal import commands.

## Task 1: Add CSV Validation Service

**Files:**
- Create: `backend/app/services/segment_collection_importer.py`
- Test: `backend/tests/test_segment_collection_importer.py`

**Interfaces:**
- Produces: `load_collection_csv(path: Path) -> CollectionCsvResult`
- Produces: `CollectionCsvResult.is_valid -> bool`
- Produces: `ValidationIssue(row_number: int, column: str, message: str)`

- [x] **Step 1: Write tests**

Write tests that create temporary CSV files and call `load_collection_csv(...)`.

Required cases:

- A valid row with `S_GATE3_TO_WIDE_PATH` is accepted.
- `slope_percent=40`, `surface_level=6`, and `shade_coverage_percent=120` are rejected.
- `surface_type=MUD` is rejected.
- A file with only `segment_code,collector` is rejected for missing required columns.

- [x] **Step 2: Run tests and confirm failure**

Run:

```powershell
.\.conda\elder-map-py311\python.exe -m pytest backend\tests\test_segment_collection_importer.py -q
```

Expected before implementation: import or assertion failures.

- [x] **Step 3: Implement parser and validators**

Implement required-column validation, node/name checks, coordinate range checks, finite-number type parsing, range checks, booleans, ISO date parsing, `surface_type` enum validation, and `photo_urls` JSON-array parsing in `backend/app/services/segment_collection_importer.py`.

- [x] **Step 4: Run tests and confirm pass**

Run:

```powershell
.\.conda\elder-map-py311\python.exe -m pytest backend\tests\test_segment_collection_importer.py -q
```

Expected: all importer validation tests pass.

## Task 2: Add Database Import Behavior

**Files:**
- Modify: `backend/app/services/segment_collection_importer.py`

**Interfaces:**
- Consumes: `load_collection_csv(path: Path) -> CollectionCsvResult`
- Produces: `import_collection_csv(path: Path, db: Session, dry_run: bool = False) -> dict[str, Any]`
- Produces: `validate_database_references(db: Session, rows: list[dict[str, Any]]) -> list[ValidationIssue]`

- [x] **Step 1: Implement active segment reference check**

Query:

```sql
SELECT id FROM road_segment WHERE segment_code = :segment_code AND status = 'ACTIVE'
```

Return a `segment_code` validation issue when no active segment is found.

- [x] **Step 2: Implement dry-run result**

When `dry_run=True`, return:

```json
{ "valid": true, "imported": 0, "checked": 1, "issues": [] }
```

Use the actual row count for `checked`.

- [x] **Step 3: Implement insert result**

For each valid row, insert into `segment_collect_record` with:

- `road_segment_id` from the matching active segment.
- `collector_user_id` from an existing or newly created collector user.
- accessibility and safety fields from the CSV.
- `photo_urls` stored as JSONB.
- `collect_time` from `collect_date`.
- `status='PENDING'`.

- [x] **Step 4: Run final backend checks**

Run:

```powershell
.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q
```

Expected: full backend tests pass.

## Task 3: Add CLI Wrapper

**Files:**
- Create: `backend/app/scripts/import_segment_collection_csv.py`

**Interfaces:**
- Consumes: `import_collection_csv(path, db, dry_run=args.dry_run)`
- Produces: module command `python -m app.scripts.import_segment_collection_csv <csv_path> [--dry-run]`

- [x] **Step 1: Implement argparse entry point**

Arguments:

- `csv_path`: required CSV path.
- `--dry-run`: validate without inserting.

- [x] **Step 2: Print JSON result**

Print `json.dumps(result, ensure_ascii=False, indent=2)`.

- [x] **Step 3: Exit non-zero on invalid input**

If `result["valid"]` is false, raise `SystemExit(1)`.

- [x] **Step 4: Verify with sample CSV**

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path backend).Path
.\.conda\elder-map-py311\python.exe -m app.scripts.import_segment_collection_csv docs\data-collection\road_segment_collection_template.csv --dry-run
```

Expected: `valid=true`.

## Task 4: Update Data Collection Docs

**Files:**
- Modify: `docs/data-collection/road_segment_collection_template.csv`
- Modify: `docs/data-collection/road_segment_collection_guide.md`
- Modify: `docs/助老地图-从0到完成总计划.md`
- Modify: `docs/助老地图-当前进度与剩余任务.md`

**Interfaces:**
- Consumes: CLI command from Task 3.
- Produces: teammate-facing instructions for dry-run and formal import.

- [x] **Step 1: Update sample row**

Use real route-segment code `S_GATE3_TO_WIDE_PATH` so dry-run can pass against current seed data.

- [x] **Step 2: Add commands to guide**

Document dry-run first, then formal import after `valid=true`.

- [x] **Step 3: Update project tracking docs**

Mark CSV import script and collection validation as completed.

- [x] **Step 4: Run final checks**

Run:

```powershell
.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q
$env:PYTHONPATH=(Resolve-Path backend).Path
.\.conda\elder-map-py311\python.exe -m app.scripts.import_segment_collection_csv docs\data-collection\road_segment_collection_template.csv --dry-run
```

Expected:

- `24 passed`
- dry-run JSON returns `valid=true`

## Self-Review

### Spec Coverage

- Dry-run validation is covered by Tasks 2 and 3.
- Pending import and duplicate-skip behavior is covered by Task 2.
- CSV template and guide updates are covered by Task 4.
- Existing route and map behavior is protected by full backend test execution.

### Placeholder Scan

- No `TODO`, `TBD`, or ambiguous implementation steps remain.

### Type Consistency

- `load_collection_csv(...)` returns normalized dictionaries consumed by `import_collection_csv(...)`.
- `segment_code` validation uses the same active `road_segment` table that route planning reads.
- CLI paths resolve relative to the project root through `project_root()`.
