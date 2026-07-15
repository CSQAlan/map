from app.core.database import project_root
from app.db.schema import apply_schema
from app.db.seeds import seed_map_data


def run() -> dict[str, int]:
    schema_path = project_root() / "db" / "01_init_schema.sql"
    apply_schema(schema_path)
    return seed_map_data()


if __name__ == "__main__":
    print(run())
