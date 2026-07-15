from pathlib import Path

from app.core.database import engine


def load_schema_sql(schema_path: Path) -> str:
    return schema_path.read_text(encoding="utf-8")


def apply_schema(schema_path: Path) -> None:
    sql = load_schema_sql(schema_path)
    raw_connection = engine.raw_connection()
    try:
        with raw_connection.cursor() as cursor:
            cursor.execute(sql)
        raw_connection.commit()
    except Exception:
        raw_connection.rollback()
        raise
    finally:
        raw_connection.close()
