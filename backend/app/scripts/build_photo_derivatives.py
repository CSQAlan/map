import argparse
from pathlib import Path

from PIL import Image, ImageOps

from app.services.photo_evidence import EVIDENCE_ROOT, load_photo_manifest


VARIANTS = {
    "thumb": {"max_size": 480, "quality": 76},
    "display": {"max_size": 1600, "quality": 84},
}


def build_derivatives(source: Path, output: Path = EVIDENCE_ROOT) -> tuple[int, int]:
    generated = 0
    skipped = 0
    for evidence in load_photo_manifest().values():
        source_path = source / evidence.original_name
        if not source_path.is_file():
            skipped += 1
            continue
        with Image.open(source_path) as raw_image:
            image = ImageOps.exif_transpose(raw_image).convert("RGB")
            for variant, options in VARIANTS.items():
                target_dir = output / variant
                target_dir.mkdir(parents=True, exist_ok=True)
                target = target_dir / f"{evidence.photo_id}.webp"
                resized = image.copy()
                resized.thumbnail((options["max_size"], options["max_size"]), Image.Resampling.LANCZOS)
                resized.save(target, "WEBP", quality=options["quality"], method=6)
                generated += 1
    return generated, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Build web-safe Shidayuan evidence photos.")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=EVIDENCE_ROOT)
    args = parser.parse_args()
    generated, skipped = build_derivatives(args.source.resolve(), args.output.resolve())
    print({"generated": generated, "skipped_sources": skipped})


if __name__ == "__main__":
    main()
