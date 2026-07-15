import argparse
import json
from pathlib import Path

from app.core.database import SessionLocal, project_root
from app.services.segment_collection_importer import import_collection_csv


def main() -> None:
    parser = argparse.ArgumentParser(description="Import road segment collection CSV.")
    parser.add_argument("csv_path", help="Path to collection CSV file.")
    parser.add_argument("--dry-run", action="store_true", help="Validate only, do not insert records.")
    args = parser.parse_args()

    csv_path = Path(args.csv_path)
    if not csv_path.is_absolute():
        csv_path = project_root() / csv_path

    db = SessionLocal()
    try:
        result = import_collection_csv(csv_path, db, dry_run=args.dry_run)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if not result["valid"]:
            raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
