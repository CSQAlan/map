import io
import json
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from app.scripts.import_survey_archive import (
    SurveyArchiveError,
    _dms_to_decimal,
    _gps_from_image,
    build_archive,
)


SITE_NAMES = [
    "大学城天街",
    "川美",
    "沙坪坝区大学城中路38号附83号富力城地壹站",
    "熙街地区",
    "重庆师范大学西部与中部",
    "金科天宸2、3街区",
    "大学城中路富力城",
]


def _jpeg_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (16, 24), (70, 120, 90)).save(output, "JPEG")
    return output.getvalue()


def _archive(path: Path, *, unsafe: bool = False, corrupt: bool = False) -> None:
    with zipfile.ZipFile(path, "w") as outer:
        for index, site_name in enumerate(SITE_NAMES):
            nested_bytes = io.BytesIO()
            with zipfile.ZipFile(nested_bytes, "w") as nested:
                if corrupt and index == 0:
                    nested.writestr("现场.jpg", b"not an image")
                else:
                    nested.writestr("现场.jpg", _jpeg_bytes())
                if unsafe and index == 0:
                    nested.writestr("../越界.jpg", _jpeg_bytes())
                elif index == 0:
                    nested.writestr("现场地图.jpg", _jpeg_bytes())
            outer.writestr(f"{site_name}.zip", nested_bytes.getvalue())


def test_import_builds_stable_records_and_strips_image_metadata(tmp_path: Path) -> None:
    archive_path = tmp_path / "fixture.zip"
    _archive(archive_path)
    manifest_path = tmp_path / "seed" / "survey_records.json"
    media_root = tmp_path / "media"

    first = build_archive(archive_path, manifest_path, media_root)
    first_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    second = build_archive(archive_path, manifest_path, media_root)
    second_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert first["sites"] == 7
    assert first["media"] == 8
    assert first["paired_records"] == 1
    assert first["generated_derivatives"] == 16
    assert second["media"] == 8
    assert [row["record_code"] for row in first_manifest["records"]] == [
        row["record_code"] for row in second_manifest["records"]
    ]
    assert len(first_manifest["media"]) == 8
    assert all(len(row["media_refs"]) >= 1 for row in first_manifest["records"])
    assert any(row["initial_location_source"] == "NONE" for row in first_manifest["records"])
    for variant in ("thumb", "display"):
        for photo in first_manifest["media"]:
            output = media_root / variant / f"{photo['photo_id']}.webp"
            with Image.open(output) as image:
                assert image.format == "WEBP"
                assert not image.getexif()


def test_import_rejects_path_traversal_and_bad_images(tmp_path: Path) -> None:
    unsafe_archive = tmp_path / "unsafe.zip"
    _archive(unsafe_archive, unsafe=True)
    with pytest.raises(SurveyArchiveError, match="Unsafe archive path"):
        build_archive(unsafe_archive, tmp_path / "unsafe.json", tmp_path / "unsafe-media")

    bad_archive = tmp_path / "bad.zip"
    _archive(bad_archive, corrupt=True)
    with pytest.raises(SurveyArchiveError, match="Unable to read image"):
        build_archive(bad_archive, tmp_path / "bad.json", tmp_path / "bad-media")


def test_gps_decimal_conversion_handles_southern_and_western_hemispheres() -> None:
    assert _dms_to_decimal((29, 30, 0), "N") == pytest.approx(29.5)
    assert _dms_to_decimal((106, 15, 0), "W") == pytest.approx(-106.25)


def test_gps_is_missing_when_exif_has_no_gps_ifd() -> None:
    with Image.new("RGB", (8, 8)) as image:
        assert _gps_from_image(image) is None
