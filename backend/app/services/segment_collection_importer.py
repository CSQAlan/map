import csv
import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


SURFACE_TYPES = {
    "ASPHALT",
    "CONCRETE",
    "BRICK",
    "GRAVEL",
    "GRASS",
    "WOOD",
    "TILE",
    "COBBLESTONE",
}

REQUIRED_COLUMNS = [
    "segment_code",
    "start_node_code",
    "end_node_code",
    "name",
    "collector",
    "collect_date",
    "lon_start",
    "lat_start",
    "lon_end",
    "lat_end",
    "length_m",
    "slope_percent",
    "width_m",
    "surface_type",
    "surface_level",
    "safety_level",
    "barrier_free_level",
    "rest_facility_score",
    "lighting_level",
    "crossing_safety_level",
    "wheelchair_accessible",
    "has_handrail",
    "has_ramp",
    "shade_coverage_percent",
    "bench_count",
    "step_count",
    "step_height_cm",
    "photo_urls",
]


@dataclass(frozen=True)
class ValidationIssue:
    row_number: int
    column: str
    message: str


@dataclass(frozen=True)
class CollectionCsvResult:
    rows: list[dict[str, Any]]
    issues: list[ValidationIssue]

    @property
    def is_valid(self) -> bool:
        return not self.issues


def load_collection_csv(path: Path) -> CollectionCsvResult:
    issues: list[ValidationIssue] = []
    normalized_rows: list[dict[str, Any]] = []

    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        missing_columns = [column for column in REQUIRED_COLUMNS if column not in (reader.fieldnames or [])]
        if missing_columns:
            return CollectionCsvResult(
                rows=[],
                issues=[
                    ValidationIssue(
                        row_number=0,
                        column=",".join(missing_columns),
                        message="CSV 缺少必填列",
                    )
                ],
            )

        for row_number, row in enumerate(reader, start=2):
            normalized, row_issues = validate_collection_row(row, row_number)
            issues.extend(row_issues)
            if not row_issues:
                normalized_rows.append(normalized)

    return CollectionCsvResult(rows=normalized_rows, issues=issues)


def validate_collection_row(row: dict[str, str], row_number: int) -> tuple[dict[str, Any], list[ValidationIssue]]:
    issues: list[ValidationIssue] = []
    normalized: dict[str, Any] = {}

    normalized["segment_code"] = require_text(row, "segment_code", row_number, issues)
    normalized["start_node_code"] = require_text(row, "start_node_code", row_number, issues)
    normalized["end_node_code"] = require_text(row, "end_node_code", row_number, issues)
    normalized["name"] = require_text(row, "name", row_number, issues)
    normalized["collector"] = require_text(row, "collector", row_number, issues, maximum_length=50)
    normalized["collect_date"] = parse_date(row, "collect_date", row_number, issues)
    normalized["lon_start"] = parse_float(row, "lon_start", row_number, issues, minimum=-180, maximum=180)
    normalized["lat_start"] = parse_float(row, "lat_start", row_number, issues, minimum=-90, maximum=90)
    normalized["lon_end"] = parse_float(row, "lon_end", row_number, issues, minimum=-180, maximum=180)
    normalized["lat_end"] = parse_float(row, "lat_end", row_number, issues, minimum=-90, maximum=90)
    normalized["length_m"] = parse_float(row, "length_m", row_number, issues, minimum=0)
    normalized["slope_percent"] = parse_float(row, "slope_percent", row_number, issues, minimum=0, maximum=30)
    normalized["width_m"] = parse_float(row, "width_m", row_number, issues, minimum=0)
    normalized["surface_type"] = parse_surface_type(row, row_number, issues)
    normalized["surface_level"] = parse_int(row, "surface_level", row_number, issues, minimum=1, maximum=5)
    normalized["safety_level"] = parse_int(row, "safety_level", row_number, issues, minimum=1, maximum=5)
    normalized["barrier_free_level"] = parse_int(
        row,
        "barrier_free_level",
        row_number,
        issues,
        minimum=1,
        maximum=5,
    )
    normalized["rest_facility_score"] = parse_int(
        row,
        "rest_facility_score",
        row_number,
        issues,
        minimum=1,
        maximum=5,
    )
    normalized["lighting_level"] = parse_int(row, "lighting_level", row_number, issues, minimum=1, maximum=5)
    normalized["crossing_safety_level"] = parse_int(
        row,
        "crossing_safety_level",
        row_number,
        issues,
        minimum=1,
        maximum=5,
    )
    normalized["wheelchair_accessible"] = parse_bool(row, "wheelchair_accessible", row_number, issues)
    normalized["has_handrail"] = parse_bool(row, "has_handrail", row_number, issues)
    normalized["has_ramp"] = parse_bool(row, "has_ramp", row_number, issues)
    normalized["shade_coverage_percent"] = parse_int(
        row,
        "shade_coverage_percent",
        row_number,
        issues,
        minimum=0,
        maximum=100,
    )
    normalized["bench_count"] = parse_int(row, "bench_count", row_number, issues, minimum=0)
    normalized["step_count"] = parse_int(row, "step_count", row_number, issues, minimum=0)
    normalized["step_height_cm"] = parse_float(row, "step_height_cm", row_number, issues, minimum=0)
    normalized["photo_urls"] = parse_json_list(row, "photo_urls", row_number, issues)
    normalized["remark"] = optional_text(row, "remark", row_number, issues, maximum_length=500)

    return normalized, issues


def import_collection_csv(path: Path, db: Session, dry_run: bool = False) -> dict[str, Any]:
    result = load_collection_csv(path)
    if result.issues:
        return {"valid": False, "imported": 0, "issues": [issue.__dict__ for issue in result.issues]}

    issues = validate_database_references(db, result.rows)
    if issues:
        return {"valid": False, "imported": 0, "issues": [issue.__dict__ for issue in issues]}

    if dry_run:
        return {"valid": True, "imported": 0, "checked": len(result.rows), "issues": []}

    imported = 0
    skipped = 0
    try:
        for row in result.rows:
            segment_id = get_segment_id(db, row["segment_code"])
            collector_user_id = ensure_collector_user(db, row["collector"])
            collect_time = datetime.combine(row["collect_date"], datetime.min.time())
            if has_existing_collection_record(db, segment_id, collector_user_id, row["collect_date"]):
                skipped += 1
                continue
            db.execute(
                text(
                    """
                    INSERT INTO segment_collect_record (
                        road_segment_id,
                        collector_user_id,
                        surface_level,
                        surface_type,
                        width_m,
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
                        remark,
                        photo_urls,
                        collect_time,
                        status
                    )
                    VALUES (
                        :road_segment_id,
                        :collector_user_id,
                        :surface_level,
                        :surface_type,
                        :width_m,
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
                        :remark,
                        CAST(:photo_urls AS jsonb),
                        :collect_time,
                        'PENDING'
                    )
                    """
                ),
                {
                    **row,
                    "road_segment_id": segment_id,
                    "collector_user_id": collector_user_id,
                    "photo_urls": json.dumps(row["photo_urls"], ensure_ascii=False),
                    "collect_time": collect_time,
                },
            )
            imported += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"valid": True, "imported": imported, "skipped": skipped, "checked": len(result.rows), "issues": []}


def validate_database_references(db: Session, rows: list[dict[str, Any]]) -> list[ValidationIssue]:
    issues = []
    for index, row in enumerate(rows, start=2):
        if get_segment_id(db, row["segment_code"]) is None:
            issues.append(
                ValidationIssue(
                    row_number=index,
                    column="segment_code",
                    message=f"路段不存在：{row['segment_code']}",
                )
            )
    return issues


def get_segment_id(db: Session, segment_code: str) -> int | None:
    return db.execute(
        text("SELECT id FROM road_segment WHERE segment_code = :segment_code AND status = 'ACTIVE'"),
        {"segment_code": segment_code},
    ).scalar_one_or_none()


def ensure_collector_user(db: Session, collector: str) -> int:
    username = collector_username(collector)
    existing_id = db.execute(
        text("SELECT id FROM app_user WHERE username = :username"),
        {"username": username},
    ).scalar_one_or_none()
    if existing_id is not None:
        return int(existing_id)

    return int(
        db.execute(
            text(
                """
                INSERT INTO app_user (username, password_hash, role, display_name)
                VALUES (:username, 'collection-importer', 'COLLECTOR', :display_name)
                RETURNING id
                """
            ),
            {"username": username, "display_name": collector.strip()},
        ).scalar_one()
    )


def collector_username(collector: str) -> str:
    name = collector.strip()
    slug = re.sub(r"[^a-z0-9_]+", "_", name.lower()).strip("_")[:24] or "user"
    suffix = hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]
    return f"collector_{slug}_{suffix}"


def has_existing_collection_record(
    db: Session,
    segment_id: int,
    collector_user_id: int,
    collect_date: date,
) -> bool:
    existing_id = db.execute(
        text(
            """
            SELECT id
            FROM segment_collect_record
            WHERE road_segment_id = :road_segment_id
              AND collector_user_id = :collector_user_id
              AND collect_time::date = :collect_date
              AND status = 'PENDING'
            LIMIT 1
            """
        ),
        {
            "road_segment_id": segment_id,
            "collector_user_id": collector_user_id,
            "collect_date": collect_date,
        },
    ).scalar_one_or_none()
    return existing_id is not None


def require_text(
    row: dict[str, str],
    column: str,
    row_number: int,
    issues: list[ValidationIssue],
    maximum_length: int | None = None,
) -> str:
    value = (row.get(column) or "").strip()
    if not value:
        issues.append(ValidationIssue(row_number, column, "不能为空"))
    if maximum_length is not None and len(value) > maximum_length:
        issues.append(ValidationIssue(row_number, column, f"不能超过 {maximum_length} 个字符"))
    return value


def optional_text(
    row: dict[str, str],
    column: str,
    row_number: int,
    issues: list[ValidationIssue],
    maximum_length: int,
) -> str:
    value = (row.get(column) or "").strip()
    if len(value) > maximum_length:
        issues.append(ValidationIssue(row_number, column, f"不能超过 {maximum_length} 个字符"))
    return value


def parse_date(
    row: dict[str, str],
    column: str,
    row_number: int,
    issues: list[ValidationIssue],
) -> date:
    value = require_text(row, column, row_number, issues)
    try:
        return date.fromisoformat(value)
    except ValueError:
        issues.append(ValidationIssue(row_number, column, "日期格式必须是 YYYY-MM-DD"))
        return date.today()


def parse_float(
    row: dict[str, str],
    column: str,
    row_number: int,
    issues: list[ValidationIssue],
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    raw_value = require_text(row, column, row_number, issues)
    try:
        value = float(raw_value)
    except ValueError:
        issues.append(ValidationIssue(row_number, column, "必须是数字"))
        return 0
    if not math.isfinite(value):
        issues.append(ValidationIssue(row_number, column, "必须是有限数字"))
        return 0
    if minimum is not None and value < minimum:
        issues.append(ValidationIssue(row_number, column, f"不能小于 {minimum}"))
    if maximum is not None and value > maximum:
        issues.append(ValidationIssue(row_number, column, f"不能大于 {maximum}"))
    return value


def parse_int(
    row: dict[str, str],
    column: str,
    row_number: int,
    issues: list[ValidationIssue],
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    raw_value = require_text(row, column, row_number, issues)
    try:
        value = int(raw_value)
    except ValueError:
        issues.append(ValidationIssue(row_number, column, "必须是整数"))
        return 0
    if minimum is not None and value < minimum:
        issues.append(ValidationIssue(row_number, column, f"不能小于 {minimum}"))
    if maximum is not None and value > maximum:
        issues.append(ValidationIssue(row_number, column, f"不能大于 {maximum}"))
    return value


def parse_bool(
    row: dict[str, str],
    column: str,
    row_number: int,
    issues: list[ValidationIssue],
) -> bool:
    value = require_text(row, column, row_number, issues).lower()
    if value in {"true", "1", "yes", "y"}:
        return True
    if value in {"false", "0", "no", "n"}:
        return False
    issues.append(ValidationIssue(row_number, column, "必须是 true/false"))
    return False


def parse_surface_type(row: dict[str, str], row_number: int, issues: list[ValidationIssue]) -> str:
    value = require_text(row, "surface_type", row_number, issues).upper()
    if value not in SURFACE_TYPES:
        issues.append(
            ValidationIssue(
                row_number,
                "surface_type",
                f"必须是以下之一：{', '.join(sorted(SURFACE_TYPES))}",
            )
        )
    return value


def parse_json_list(
    row: dict[str, str],
    column: str,
    row_number: int,
    issues: list[ValidationIssue],
) -> list[str]:
    raw_value = require_text(row, column, row_number, issues)
    try:
        value = json.loads(raw_value)
    except json.JSONDecodeError:
        issues.append(ValidationIssue(row_number, column, "必须是 JSON 数组"))
        return []
    if not isinstance(value, list):
        issues.append(ValidationIssue(row_number, column, "必须是 JSON 数组"))
        return []
    return [str(item) for item in value]
