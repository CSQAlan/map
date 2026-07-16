import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal


SEED_DATA_DIR = Path(__file__).resolve().parents[1] / "db" / "seed_data"
EVIDENCE_ROOT = Path(__file__).resolve().parents[1] / "static" / "evidence"


class PhotoEvidenceNotFound(LookupError):
    pass


@dataclass(frozen=True)
class PhotoEvidence:
    photo_id: str
    original_name: str
    caption: str
    risk_tags: tuple[str, ...]


@lru_cache(maxsize=1)
def load_photo_manifest() -> dict[str, PhotoEvidence]:
    rows = json.loads((SEED_DATA_DIR / "photo_manifest.json").read_text(encoding="utf-8"))
    return {
        row["photo_id"]: PhotoEvidence(
            photo_id=row["photo_id"],
            original_name=row["original_name"],
            caption=row["caption"],
            risk_tags=tuple(row.get("risk_tags", [])),
        )
        for row in rows
    }


def get_photo_path(
    photo_id: str,
    variant: Literal["thumb", "display"],
    *,
    root: Path = EVIDENCE_ROOT,
) -> Path:
    if variant not in {"thumb", "display"}:
        raise ValueError(f"Unsupported photo variant: {variant}")
    if photo_id not in load_photo_manifest():
        raise PhotoEvidenceNotFound(photo_id)
    return root / variant / f"{photo_id}.webp"
