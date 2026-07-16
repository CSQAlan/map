from pathlib import Path

import pytest

from app.services.photo_evidence import (
    PhotoEvidenceNotFound,
    get_photo_path,
    load_photo_manifest,
)


def test_manifest_has_stable_ids_and_known_photo() -> None:
    manifest = load_photo_manifest()
    assert "SY_IMG_9499" in manifest
    assert manifest["SY_IMG_9499"].original_name == "IMG_9499.JPG"
    assert all(photo_id.startswith("SY_IMG_") for photo_id in manifest)


@pytest.mark.parametrize("photo_id", ["../IMG_9499", "a/b", "unknown"])
def test_get_photo_path_rejects_unregistered_ids(photo_id: str) -> None:
    with pytest.raises(PhotoEvidenceNotFound):
        get_photo_path(photo_id, "thumb")


def test_get_photo_path_returns_controlled_webp_path(tmp_path: Path) -> None:
    path = get_photo_path("SY_IMG_9499", "display", root=tmp_path)
    assert path == tmp_path / "display" / "SY_IMG_9499.webp"


def test_get_photo_path_rejects_unknown_variant() -> None:
    with pytest.raises(ValueError, match="Unsupported photo variant"):
        get_photo_path("SY_IMG_9499", "original")
