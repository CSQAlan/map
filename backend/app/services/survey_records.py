import json
from functools import lru_cache
from pathlib import Path
from typing import Any


SEED_DATA_PATH = Path(__file__).resolve().parents[1] / "db" / "seed_data" / "survey_records.json"


@lru_cache(maxsize=1)
def load_survey_manifest() -> dict[str, Any]:
    payload = json.loads(SEED_DATA_PATH.read_text(encoding="utf-8"))
    payload["media_by_id"] = {item["photo_id"]: item for item in payload.get("media", [])}
    return payload


def survey_media(photo_ids: list[str] | None) -> list[dict[str, str]]:
    media_by_id = load_survey_manifest()["media_by_id"]
    result = []
    for photo_id in photo_ids or []:
        item = media_by_id.get(photo_id)
        if item is None:
            continue
        result.append(
            {
                "photo_id": item["photo_id"],
                "caption": item["caption"],
                "kind": item["kind"],
                "thumbnail_url": item["thumbnail_url"],
                "display_url": item["display_url"],
            }
        )
    return result


