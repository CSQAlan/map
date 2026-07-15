# Segment Collection CSV Import Design

**Date:** 2026-07-15
**Project:** Elder-friendly campus map MVP
**Pilot Area:** Chongqing Normal University Gate 3 / clinic / canteen walking network

## 1. Goal

Build a small, reliable CSV import path for road-segment field collection data.

The feature lets teammates collect route-quality data in a spreadsheet, validate it locally, and import it into `segment_collect_record` as pending review records. It does not directly overwrite final `road_segment` values, because collected data should still pass an admin review step before affecting route recommendations.

## 2. Scope

In scope:

- Validate the road-segment collection CSV template.
- Normalize field types used by the database.
- Verify that each `segment_code` exists in active `road_segment`.
- Support dry-run validation before any database write.
- Insert valid rows into `segment_collect_record` with `status='PENDING'`.
- Auto-create a limited `COLLECTOR` user when the collector name is new.
- Skip duplicate pending records for the same road segment, collector, and collection date.

Out of scope for this slice:

- Admin approval UI.
- Automatic update from `segment_collect_record` to `road_segment`.
- Photo upload storage.
- Creating brand-new road segments from CSV geometry.

## 3. Design

The importer is split into two units:

- `backend/app/services/segment_collection_importer.py` owns parsing, validation, normalization, database reference checks, and insertion.
- `backend/app/scripts/import_segment_collection_csv.py` is a thin CLI wrapper that opens a database session and prints a JSON result.

The CSV parser uses `utf-8-sig` so files exported from spreadsheet tools with a BOM still work. The first validation pass checks required columns, node/name text fields, coordinate ranges, finite numeric ranges, booleans, dates, surface type enum values, and `photo_urls` JSON array format. The second pass checks database references, especially whether `segment_code` points to an active `road_segment`.

## 4. Data Flow

1. Collector fills `docs/data-collection/road_segment_collection_template.csv`.
2. Developer or teammate runs the importer with `--dry-run`.
3. The importer returns `{ "valid": true, "checked": N, "imported": 0 }` when the file can be imported.
4. The teammate reruns without `--dry-run`.
5. Each row is inserted into `segment_collect_record` with `PENDING` status.
6. Existing pending records for the same segment, collector, and collection date are skipped.
7. Later admin-review work decides whether pending records update `road_segment`.

## 5. Error Handling

Validation returns structured issues:

- `row_number`: CSV row number, with `0` used for header-level problems.
- `column`: the failing column name.
- `message`: human-readable reason.

The CLI exits with status code `1` when `valid=false`, which makes it suitable for local checks or CI later.

## 6. Testing

Required tests:

- Valid row is accepted and normalized.
- Invalid score/range fields are rejected.
- Unknown `surface_type` is rejected.
- Missing required columns are rejected.
- Non-finite numeric values such as `NaN` and `Infinity` are rejected.
- Duplicate pending imports are skipped instead of inserted again.
- Existing route-planning and map-data tests still pass.

## 7. Future Extensions

The next natural slice is an admin-review flow:

- List pending collection records.
- Approve or reject a record.
- On approval, update selected `road_segment` accessibility fields.
- Store an audit snapshot in `segment_audit_record`.
