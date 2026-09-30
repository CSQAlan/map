"""Import the user-provided nested survey archive into safe web image derivatives."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path, PurePosixPath
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

from app.core.database import project_root


SEED_DATA_DIR = Path(__file__).resolve().parents[1] / "db" / "seed_data"
SURVEY_MEDIA_ROOT = Path(__file__).resolve().parents[1] / "static" / "evidence" / "survey"
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic"}
MAX_ARCHIVE_ENTRIES = 1000
MAX_IMAGE_BYTES = 80 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 500 * 1024 * 1024
MAX_IMAGE_PIXELS = 100_000_000
VARIANTS = {
    "thumb": {"max_size": 480, "quality": 76},
    "display": {"max_size": 1600, "quality": 84},
}
SITE_CODES = {
    "大学城天街": "UC_TIANJIE",
    "川美": "UC_CUCA",
    "沙坪坝区大学城中路38号附83号富力城地壹站": "UC_FULICHENG_STATION",
    "熙街地区": "UC_XIJIE",
    "重庆师范大学西部与中部": "UC_CQNU",
    "金科天宸2、3街区": "UC_JINKE",
    "大学城中路富力城": "UC_FULICHENG",
}
TAG_KEYWORDS = ("台阶", "坡", "坡道", "坡路", "人行道", "破路", "占道", "昏暗", "灯光", "桥", "天桥", "电瓶车")
NOTE_PATTERN = re.compile(r"[（(](.*?)[）)]")


class SurveyArchiveError(ValueError):
    """Raised when the archive cannot be imported without losing data."""


def _decode_zip_name(name: str, flag_bits: int) -> str:
    if flag_bits & 0x800:
        return name
    try:
        return name.encode("cp437").decode("gbk")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name


def _safe_member_name(name: str) -> str:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (
        path.is_absolute()
        or normalized.startswith("//")
        or re.match(r"^[A-Za-z]:", normalized)
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise SurveyArchiveError(f"Unsafe archive path: {name!r}")
    return normalized


def _site_identity(archive_name: str) -> tuple[str, str]:
    site_name = Path(archive_name).stem
    site_code = SITE_CODES.get(site_name)
    if site_code is None:
        raise SurveyArchiveError(f"Unknown survey site archive: {site_name!r}")
    return site_code, site_name


def _dms_to_decimal(value: tuple[Any, Any, Any], reference: str) -> float:
    degrees, minutes, seconds = (float(part) for part in value)
    coordinate = degrees + minutes / 60 + seconds / 3600
    return -coordinate if reference in {"S", "W"} else coordinate


def _gps_from_image(image: Image.Image) -> tuple[float, float] | None:
    exif = image.getexif()
    gps = exif.get_ifd(34853)
    if not gps or not all(tag in gps for tag in (1, 2, 3, 4)):
        return None
    latitude = _dms_to_decimal(gps[2], str(gps[1]))
    longitude = _dms_to_decimal(gps[4], str(gps[3]))
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise SurveyArchiveError("Image contains out-of-range EXIF GPS coordinates")
    return longitude, latitude


def _media_kind(stem: str) -> str:
    return "map_reference" if any(marker in stem for marker in ("地图", "起点", "终点", "重点")) else "scene"


def _record_title_and_key(stem: str) -> tuple[str, str, str | None]:
    notes = NOTE_PATTERN.findall(stem)
    title = NOTE_PATTERN.sub("", stem).strip().rstrip(" _-")
    if not title:
        title = stem
    marker_index = title.find("地图")
    base = title[:marker_index] if marker_index >= 0 else title
    base = re.sub(r"(起点|终点|重点)$", "", base).strip().rstrip(" _-")
    base = base or title
    return base, title, "；".join(note.strip() for note in notes) or None


def _issue_tags(title: str) -> list[str]:
    return list(dict.fromkeys(keyword for keyword in TAG_KEYWORDS if keyword in title))


def _stable_id(prefix: str, value: str, length: int = 16) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:length].upper()
    return f"{prefix}_{digest}"


def _read_image(data: bytes, filename: str, pixel_limit: int) -> tuple[Image.Image, tuple[float, float] | None]:
    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.width * source.height > pixel_limit:
                raise SurveyArchiveError(f"Image exceeds pixel limit: {filename}")
            coordinate = _gps_from_image(source)
            image = ImageOps.exif_transpose(source).convert("RGB")
            return image, coordinate
    except SurveyArchiveError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise SurveyArchiveError(f"Unable to read image {filename!r}: {error}") from error


def _write_derivatives(image: Image.Image, photo_id: str, media_root: Path) -> int:
    generated = 0
    for variant, settings in VARIANTS.items():
        output_dir = media_root / variant
        output_dir.mkdir(parents=True, exist_ok=True)
        target = output_dir / f"{photo_id}.webp"
        resized = image.copy()
        resized.thumbnail((settings["max_size"], settings["max_size"]), Image.Resampling.LANCZOS)
        resized.save(target, "WEBP", quality=settings["quality"], method=6, exif=b"")
        generated += 1
    return generated


def build_archive(
    archive_path: Path,
    manifest_path: Path = SEED_DATA_DIR / "survey_records.json",
    media_root: Path = SURVEY_MEDIA_ROOT,
    *,
    pixel_limit: int = MAX_IMAGE_PIXELS,
) -> dict[str, int]:
    register_heif_opener()
    try:
        outer = zipfile.ZipFile(archive_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise SurveyArchiveError(f"Cannot open source archive {archive_path}: {error}") from error

    site_rows: dict[str, dict[str, Any]] = {}
    record_media: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    record_gps: dict[tuple[str, str], list[tuple[float, float]]] = defaultdict(list)
    record_notes: dict[tuple[str, str], set[str]] = defaultdict(set)
    file_count = 0
    total_bytes = 0
    media_counts: dict[str, int] = defaultdict(int)

    with outer:
        archives = [item for item in outer.infolist() if item.filename.lower().endswith(".zip")]
        if len(archives) != len(SITE_CODES):
            raise SurveyArchiveError(f"Expected {len(SITE_CODES)} site archives, found {len(archives)}")
        for site_archive in archives:
            decoded_archive_name = _decode_zip_name(site_archive.filename, site_archive.flag_bits)
            site_code, site_name = _site_identity(decoded_archive_name)
            if site_code in site_rows:
                raise SurveyArchiveError(f"Duplicate site archive for {site_name}")
            site_rows[site_code] = {"site_code": site_code, "site_name": site_name}
            try:
                nested = zipfile.ZipFile(io.BytesIO(outer.read(site_archive)))
            except (OSError, zipfile.BadZipFile) as error:
                raise SurveyArchiveError(f"Invalid nested archive {decoded_archive_name!r}: {error}") from error
            with nested:
                entries = [entry for entry in nested.infolist() if not entry.is_dir()]
                if len(entries) > MAX_ARCHIVE_ENTRIES:
                    raise SurveyArchiveError(f"Too many archive entries in {site_name}")
                for entry in entries:
                    member_name = _decode_zip_name(entry.filename, entry.flag_bits)
                    member_name = _safe_member_name(member_name)
                    suffix = Path(member_name).suffix.lower()
                    if suffix not in SUPPORTED_EXTENSIONS:
                        continue
                    if entry.file_size > MAX_IMAGE_BYTES:
                        raise SurveyArchiveError(f"Image exceeds size limit: {member_name}")
                    total_bytes += entry.file_size
                    if total_bytes > MAX_TOTAL_IMAGE_BYTES:
                        raise SurveyArchiveError("Uncompressed image data exceeds total size limit")
                    raw_data = nested.read(entry)
                    image, gps = _read_image(raw_data, member_name, pixel_limit)
                    relative_name = PurePosixPath(member_name).name
                    stem = Path(relative_name).stem
                    kind = _media_kind(stem)
                    base, title, note = _record_title_and_key(stem)
                    record_key = (site_code, base.casefold())
                    photo_id = _stable_id("SURVEY", f"{site_code}/{member_name}")
                    media = {
                        "photo_id": photo_id,
                        "original_name": relative_name,
                        "caption": title,
                        "kind": kind,
                        "thumbnail_url": f"/media/evidence/survey/thumb/{photo_id}.webp",
                        "display_url": f"/media/evidence/survey/display/{photo_id}.webp",
                    }
                    if media in record_media[record_key]:
                        raise SurveyArchiveError(f"Duplicate media entry: {member_name}")
                    record_media[record_key].append(media)
                    if note:
                        record_notes[record_key].add(note)
                    if gps and kind == "scene":
                        record_gps[record_key].append(gps)
                    _write_derivatives(image, photo_id, media_root)
                    image.close()
                    file_count += 1
                    media_counts[suffix[1:]] += 1

    if len(site_rows) != len(SITE_CODES):
        raise SurveyArchiveError(f"Found only {len(site_rows)} expected survey sites")

    media_by_site: dict[str, list[dict[str, Any]]] = defaultdict(list)
    records = []
    gps_count = 0
    paired_count = 0
    for (site_code, record_key), assets in sorted(record_media.items()):
        site_assets = assets
        scene_assets = [asset for asset in site_assets if asset["kind"] == "scene"]
        map_assets = [asset for asset in site_assets if asset["kind"] == "map_reference"]
        title = next((asset["caption"] for asset in scene_assets), site_assets[0]["caption"])
        original_stems = [asset["caption"] for asset in site_assets]
        tags = _issue_tags(" ".join(original_stems))
        record_code = _stable_id("SURVEY", f"{site_code}/{record_key}")
        coordinates = record_gps.get((site_code, record_key), [])
        if coordinates:
            gps_count += 1
            lon, lat = coordinates[0]
            location = {"longitude": lon, "latitude": lat}
            location_source = "EXIF"
        else:
            location = None
            location_source = "NONE"
        if scene_assets and map_assets:
            paired_count += 1
        site_name = site_rows[site_code]["site_name"]
        records.append(
            {
                "record_code": record_code,
                "site_code": site_code,
                "site_name": site_name,
                "title": title,
                "issue_tags": tags,
                "notes": sorted(record_notes.get((site_code, record_key), set())),
                "media_refs": [asset["photo_id"] for asset in site_assets],
                "media": site_assets,
                "initial_location": location,
                "initial_location_source": location_source,
                "review_status": "PENDING_REVIEW",
            }
        )
        media_by_site[site_code].extend(site_assets)

    payload = {
        "sites": list(site_rows.values()),
        "records": records,
        "media": [asset for site_code in sorted(media_by_site) for asset in media_by_site[site_code]],
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_manifest = manifest_path.with_suffix(manifest_path.suffix + ".tmp")
    temporary_manifest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_manifest.replace(manifest_path)
    return {
        "sites": len(site_rows),
        "records": len(records),
        "media": file_count,
        "paired_records": paired_count,
        "records_with_exif_gps": gps_count,
        "generated_derivatives": file_count * len(VARIANTS),
        **{f"{extension}_images": count for extension, count in sorted(media_counts.items())},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the nested university-city field-survey archive.")
    parser.add_argument("--archive", type=Path, default=project_root() / "map.zip")
    parser.add_argument("--manifest", type=Path, default=SEED_DATA_DIR / "survey_records.json")
    parser.add_argument("--media-root", type=Path, default=SURVEY_MEDIA_ROOT)
    args = parser.parse_args()
    result = build_archive(args.archive.resolve(), args.manifest.resolve(), args.media_root.resolve())
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
