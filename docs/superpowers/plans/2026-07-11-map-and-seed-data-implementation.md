# Map And Seed Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chongqing Normal University Gate 3 / clinic / canteen map-data foundation so the backend can initialize the schema, load seed map data, and expose query APIs that the route-planning MVP can consume directly.

**Architecture:** Keep the current FastAPI single-service structure and add a small data-initialization slice inside `backend/app`. Store the authoritative schema in SQL, keep seed map data in versioned JSON files, and provide an idempotent Python command that applies the schema and loads the seed data into PostgreSQL/PostGIS.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0, psycopg 3, PostgreSQL 16, PostGIS, pytest

## Global Constraints

- Trial scope is limited to `三号门`, `校医院`, and `食堂`.
- Seed strategy is `dual-track hybrid`: hand-authored seed data now, OSM-compatible structure later.
- First version may use approximate coordinates.
- Seed data must be loadable by script and editable later from admin flows.
- Delivery must directly support the next MSR route-planning task.
- Route computation will consume final `road_segment` rows only.

---

## File Structure

- Create: `backend/app/db/schema.py`
  - SQL schema loader for `db/01_init_schema.sql`
- Create: `backend/app/db/seeds.py`
  - Seed loader entrypoints and idempotent insert helpers
- Create: `backend/app/db/seed_data/core_pois.json`
  - Seed POIs for Gate 3, clinic, canteen
- Create: `backend/app/db/seed_data/core_nodes.json`
  - Seed road nodes for the pilot graph
- Create: `backend/app/db/seed_data/core_segments.json`
  - Seed road segments with initial scores for the pilot graph
- Create: `backend/app/scripts/init_map_data.py`
  - Command-line runner that applies schema and seeds
- Create: `backend/app/api/routes/map_data.py`
  - Read-only APIs for POIs and segments
- Create: `backend/app/schemas/map_data.py`
  - Response models for POIs and segments
- Create: `backend/tests/test_seed_loader.py`
  - Seed initialization tests
- Create: `backend/tests/test_map_data_api.py`
  - API tests for map data queries
- Modify: `backend/app/api/router.py`
  - Register map-data routes
- Modify: `backend/app/core/database.py`
  - Add connection helper and SQL execution support
- Modify: `backend/README.md`
  - Add initialization and run instructions

## Task 1: Add schema initialization support

**Files:**
- Create: `backend/app/db/schema.py`
- Modify: `backend/app/core/database.py`
- Test: `backend/tests/test_seed_loader.py`

**Interfaces:**
- Consumes: `app.core.database.engine`
- Produces:
  - `load_schema_sql(schema_path: Path) -> str`
  - `apply_schema(schema_path: Path) -> None`

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path

from app.db.schema import load_schema_sql


def test_load_schema_sql_reads_init_schema() -> None:
    schema_path = Path("..") / "db" / "01_init_schema.sql"
    sql = load_schema_sql(schema_path.resolve())
    assert "CREATE EXTENSION IF NOT EXISTS postgis;" in sql
    assert "CREATE TABLE IF NOT EXISTS poi_facility" in sql
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_seed_loader.py::test_load_schema_sql_reads_init_schema -v`
Expected: `ModuleNotFoundError: No module named 'app.db.schema'`

- [ ] **Step 3: Write minimal implementation**

`backend/app/db/schema.py`

```python
from pathlib import Path

from sqlalchemy import text

from app.core.database import engine


def load_schema_sql(schema_path: Path) -> str:
    return schema_path.read_text(encoding="utf-8")


def apply_schema(schema_path: Path) -> None:
    sql = load_schema_sql(schema_path)
    statements = [part.strip() for part in sql.split(";") if part.strip()]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
```

`backend/app/core/database.py`

```python
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import get_settings


settings = get_settings()

engine = create_engine(
    settings.database_url,
    future=True,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    class_=Session,
    future=True,
)
Base = declarative_base()


def project_root() -> Path:
    return Path(__file__).resolve().parents[3]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_seed_loader.py::test_load_schema_sql_reads_init_schema -v`
Expected: `PASSED`

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/schema.py backend/app/core/database.py backend/tests/test_seed_loader.py
git commit -m "feat: add schema initialization support"
```

## Task 2: Add seed data files and loader

**Files:**
- Create: `backend/app/db/seeds.py`
- Create: `backend/app/db/seed_data/core_pois.json`
- Create: `backend/app/db/seed_data/core_nodes.json`
- Create: `backend/app/db/seed_data/core_segments.json`
- Test: `backend/tests/test_seed_loader.py`

**Interfaces:**
- Consumes:
  - `app.core.database.engine`
  - `app.db.schema.apply_schema(schema_path: Path) -> None`
- Produces:
  - `load_seed_json(seed_path: Path) -> list[dict]`
  - `seed_core_pois() -> int`
  - `seed_core_nodes() -> int`
  - `seed_core_segments() -> int`
  - `seed_map_data() -> dict[str, int]`

- [ ] **Step 1: Write the failing test**

```python
from app.db.seeds import load_seed_json


def test_load_seed_json_reads_core_pois() -> None:
    rows = load_seed_json("core_pois.json")
    names = {row["name"] for row in rows}
    assert {"重庆师范大学三号门", "重庆师范大学校医院", "重庆师范大学食堂"} <= names
```

```python
from app.db.seeds import seed_map_data


def test_seed_map_data_returns_counts() -> None:
    result = seed_map_data()
    assert set(result) == {"pois", "nodes", "segments"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_seed_loader.py::test_load_seed_json_reads_core_pois tests/test_seed_loader.py::test_seed_map_data_returns_counts -v`
Expected: `ModuleNotFoundError: No module named 'app.db.seeds'`

- [ ] **Step 3: Write minimal implementation**

`backend/app/db/seed_data/core_pois.json`

```json
[
  {
    "name": "重庆师范大学三号门",
    "poi_type": "GATE",
    "description": "比赛版试点入口",
    "lon": 106.3071,
    "lat": 29.6038,
    "is_accessible": true,
    "source": "MANUAL"
  },
  {
    "name": "重庆师范大学校医院",
    "poi_type": "CLINIC",
    "description": "比赛版试点医疗目的地",
    "lon": 106.3080,
    "lat": 29.6044,
    "is_accessible": true,
    "source": "MANUAL"
  },
  {
    "name": "重庆师范大学食堂",
    "poi_type": "CANTEEN",
    "description": "比赛版试点生活目的地",
    "lon": 106.3092,
    "lat": 29.6049,
    "is_accessible": true,
    "source": "MANUAL"
  }
]
```

`backend/app/db/seed_data/core_nodes.json`

```json
[
  {"node_code": "N_GATE3", "name": "三号门节点", "lon": 106.3071, "lat": 29.6038, "node_type": "GATE"},
  {"node_code": "N_CROSS_1", "name": "主路口A", "lon": 106.3076, "lat": 29.6041, "node_type": "CROSSING"},
  {"node_code": "N_CLINIC", "name": "校医院节点", "lon": 106.3080, "lat": 29.6044, "node_type": "POI_LINK"},
  {"node_code": "N_CROSS_2", "name": "主路口B", "lon": 106.3085, "lat": 29.6046, "node_type": "CROSSING"},
  {"node_code": "N_CANTEEN", "name": "食堂节点", "lon": 106.3092, "lat": 29.6049, "node_type": "POI_LINK"}
]
```

`backend/app/db/seed_data/core_segments.json`

```json
[
  {
    "segment_code": "S_GATE3_TO_CROSS1",
    "start_node_code": "N_GATE3",
    "end_node_code": "N_CROSS_1",
    "name": "三号门到主路口A",
    "wkt": "LINESTRING(106.3071 29.6038, 106.3076 29.6041)",
    "length_m": 65.0,
    "slope_percent": 1.5,
    "surface_level": 5,
    "safety_level": 4,
    "barrier_free_level": 5,
    "rest_facility_score": 3,
    "lighting_level": 4,
    "crossing_safety_level": 4,
    "wheelchair_accessible": true,
    "step_count": 0
  },
  {
    "segment_code": "S_CROSS1_TO_CLINIC",
    "start_node_code": "N_CROSS_1",
    "end_node_code": "N_CLINIC",
    "name": "主路口A到校医院",
    "wkt": "LINESTRING(106.3076 29.6041, 106.3080 29.6044)",
    "length_m": 58.0,
    "slope_percent": 2.2,
    "surface_level": 4,
    "safety_level": 4,
    "barrier_free_level": 4,
    "rest_facility_score": 4,
    "lighting_level": 4,
    "crossing_safety_level": 5,
    "wheelchair_accessible": true,
    "step_count": 0
  },
  {
    "segment_code": "S_CLINIC_TO_CROSS2",
    "start_node_code": "N_CLINIC",
    "end_node_code": "N_CROSS_2",
    "name": "校医院到主路口B",
    "wkt": "LINESTRING(106.3080 29.6044, 106.3085 29.6046)",
    "length_m": 55.0,
    "slope_percent": 1.8,
    "surface_level": 4,
    "safety_level": 5,
    "barrier_free_level": 4,
    "rest_facility_score": 3,
    "lighting_level": 4,
    "crossing_safety_level": 4,
    "wheelchair_accessible": true,
    "step_count": 0
  },
  {
    "segment_code": "S_CROSS2_TO_CANTEEN",
    "start_node_code": "N_CROSS_2",
    "end_node_code": "N_CANTEEN",
    "name": "主路口B到食堂",
    "wkt": "LINESTRING(106.3085 29.6046, 106.3092 29.6049)",
    "length_m": 82.0,
    "slope_percent": 2.8,
    "surface_level": 3,
    "safety_level": 4,
    "barrier_free_level": 3,
    "rest_facility_score": 4,
    "lighting_level": 3,
    "crossing_safety_level": 4,
    "wheelchair_accessible": false,
    "step_count": 2
  }
]
```

`backend/app/db/seeds.py`

```python
import json
from pathlib import Path

from sqlalchemy import text

from app.core.database import engine, project_root


SEED_DIR = Path(__file__).resolve().parent / "seed_data"


def load_seed_json(filename: str) -> list[dict]:
    return json.loads((SEED_DIR / filename).read_text(encoding="utf-8"))


def seed_core_pois() -> int:
    rows = load_seed_json("core_pois.json")
    sql = text(
        """
        INSERT INTO poi_facility (name, poi_type, description, geom, is_accessible, source)
        VALUES (:name, :poi_type, :description, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :is_accessible, :source)
        ON CONFLICT DO NOTHING
        """
    )
    with engine.begin() as connection:
        for row in rows:
            connection.execute(sql, row)
    return len(rows)


def seed_core_nodes() -> int:
    rows = load_seed_json("core_nodes.json")
    sql = text(
        """
        INSERT INTO road_node (osm_node_ref, name, geom, node_type)
        VALUES (:node_code, :name, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :node_type)
        ON CONFLICT DO NOTHING
        """
    )
    with engine.begin() as connection:
        for row in rows:
            connection.execute(sql, row)
    return len(rows)


def seed_core_segments() -> int:
    rows = load_seed_json("core_segments.json")
    with engine.begin() as connection:
        for row in rows:
            start_node_id = connection.execute(
                text("SELECT id FROM road_node WHERE osm_node_ref = :code"),
                {"code": row["start_node_code"]},
            ).scalar_one()
            end_node_id = connection.execute(
                text("SELECT id FROM road_node WHERE osm_node_ref = :code"),
                {"code": row["end_node_code"]},
            ).scalar_one()
            connection.execute(
                text(
                    """
                    INSERT INTO road_segment (
                        segment_code, start_node_id, end_node_id, name, geom, length_m,
                        slope_percent, surface_level, safety_level, barrier_free_level,
                        rest_facility_score, lighting_level, crossing_safety_level,
                        wheelchair_accessible, step_count, data_source
                    )
                    VALUES (
                        :segment_code, :start_node_id, :end_node_id, :name,
                        ST_SetSRID(ST_GeomFromText(:wkt), 4326), :length_m,
                        :slope_percent, :surface_level, :safety_level, :barrier_free_level,
                        :rest_facility_score, :lighting_level, :crossing_safety_level,
                        :wheelchair_accessible, :step_count, 'MANUAL'
                    )
                    ON CONFLICT (segment_code) DO NOTHING
                    """
                ),
                {
                    **row,
                    "start_node_id": start_node_id,
                    "end_node_id": end_node_id,
                },
            )
    return len(rows)


def seed_map_data() -> dict[str, int]:
    return {
        "pois": seed_core_pois(),
        "nodes": seed_core_nodes(),
        "segments": seed_core_segments(),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_seed_loader.py::test_load_seed_json_reads_core_pois tests/test_seed_loader.py::test_seed_map_data_returns_counts -v`
Expected: `PASSED`

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/seeds.py backend/app/db/seed_data backend/tests/test_seed_loader.py
git commit -m "feat: add pilot map seed data loader"
```

## Task 3: Add initialization command

**Files:**
- Create: `backend/app/scripts/init_map_data.py`
- Modify: `backend/README.md`
- Test: `backend/tests/test_seed_loader.py`

**Interfaces:**
- Consumes:
  - `app.db.schema.apply_schema(schema_path: Path) -> None`
  - `app.db.seeds.seed_map_data() -> dict[str, int]`
- Produces:
  - `run() -> dict[str, int]`

- [ ] **Step 1: Write the failing test**

```python
from app.scripts.init_map_data import run


def test_run_returns_seed_counts() -> None:
    result = run()
    assert set(result) == {"pois", "nodes", "segments"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_seed_loader.py::test_run_returns_seed_counts -v`
Expected: `ModuleNotFoundError: No module named 'app.scripts.init_map_data'`

- [ ] **Step 3: Write minimal implementation**

`backend/app/scripts/init_map_data.py`

```python
from pathlib import Path

from app.core.database import project_root
from app.db.schema import apply_schema
from app.db.seeds import seed_map_data


def run() -> dict[str, int]:
    schema_path = project_root() / "db" / "01_init_schema.sql"
    apply_schema(schema_path)
    return seed_map_data()


if __name__ == "__main__":
    print(run())
```

`backend/README.md`

```md
## 初始化地图与种子数据

```powershell
cd F:\items\map\backend
$env:PYTHONPATH = "F:\items\map\backend"
python -m app.scripts.init_map_data
```

预期输出类似：

```text
{'pois': 3, 'nodes': 5, 'segments': 4}
```
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_seed_loader.py::test_run_returns_seed_counts -v`
Expected: `PASSED`

- [ ] **Step 5: Commit**

```bash
git add backend/app/scripts/init_map_data.py backend/README.md backend/tests/test_seed_loader.py
git commit -m "feat: add map data initialization command"
```

## Task 4: Expose read-only map-data APIs

**Files:**
- Create: `backend/app/api/routes/map_data.py`
- Create: `backend/app/schemas/map_data.py`
- Modify: `backend/app/api/router.py`
- Test: `backend/tests/test_map_data_api.py`

**Interfaces:**
- Consumes:
  - `app.core.database.get_db() -> Generator[Session, None, None]`
  - Seeded `poi_facility` and `road_segment` rows
- Produces:
  - `GET /api/map-data/pois -> list[PoiResponse]`
  - `GET /api/map-data/segments -> list[RoadSegmentResponse]`

- [ ] **Step 1: Write the failing test**

```python
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_get_map_pois() -> None:
    response = client.get("/api/map-data/pois")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_get_map_segments() -> None:
    response = client.get("/api/map-data/segments")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_map_data_api.py -v`
Expected: `404 Not Found` for both routes

- [ ] **Step 3: Write minimal implementation**

`backend/app/schemas/map_data.py`

```python
from pydantic import BaseModel


class PoiResponse(BaseModel):
    id: int
    name: str
    poi_type: str
    is_accessible: bool


class RoadSegmentResponse(BaseModel):
    id: int
    segment_code: str
    name: str | None
    length_m: float
    slope_percent: float
    surface_level: int
    safety_level: int
```

`backend/app/api/routes/map_data.py`

```python
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.map_data import PoiResponse, RoadSegmentResponse


router = APIRouter()


@router.get("/pois", response_model=list[PoiResponse])
def list_pois(db: Session = Depends(get_db)) -> list[PoiResponse]:
    rows = db.execute(
        text(
            """
            SELECT id, name, poi_type, is_accessible
            FROM poi_facility
            WHERE status = 'ACTIVE'
            ORDER BY id
            """
        )
    ).mappings()
    return [PoiResponse(**row) for row in rows]


@router.get("/segments", response_model=list[RoadSegmentResponse])
def list_segments(db: Session = Depends(get_db)) -> list[RoadSegmentResponse]:
    rows = db.execute(
        text(
            """
            SELECT id, segment_code, name, length_m, slope_percent, surface_level, safety_level
            FROM road_segment
            WHERE status = 'ACTIVE'
            ORDER BY id
            """
        )
    ).mappings()
    return [RoadSegmentResponse(**row) for row in rows]
```

`backend/app/api/router.py`

```python
from fastapi import APIRouter

from app.api.routes.health import router as health_router
from app.api.routes.map_data import router as map_data_router


api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(map_data_router, prefix="/map-data", tags=["map-data"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_map_data_api.py -v`
Expected: `PASSED`

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routes/map_data.py backend/app/schemas/map_data.py backend/app/api/router.py backend/tests/test_map_data_api.py
git commit -m "feat: add read-only map data APIs"
```

## Task 5: Add end-to-end verification for seeded pilot data

**Files:**
- Modify: `backend/tests/test_seed_loader.py`
- Modify: `backend/tests/test_map_data_api.py`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes:
  - `run() -> dict[str, int]`
  - `GET /api/map-data/pois`
  - `GET /api/map-data/segments`
- Produces:
  - Verified seed initialization flow for the pilot dataset

- [ ] **Step 1: Write the failing test**

```python
from app.db.seeds import load_seed_json


def test_seed_segments_cover_pilot_routes() -> None:
    rows = load_seed_json("core_segments.json")
    codes = {row["segment_code"] for row in rows}
    assert "S_GATE3_TO_CROSS1" in codes
    assert "S_CROSS1_TO_CLINIC" in codes
    assert "S_CROSS2_TO_CANTEEN" in codes
```

```python
def test_map_api_returns_seeded_names() -> None:
    response = client.get("/api/map-data/pois")
    names = {row["name"] for row in response.json()}
    assert "重庆师范大学三号门" in names
    assert "重庆师范大学校医院" in names
    assert "重庆师范大学食堂" in names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_seed_loader.py::test_seed_segments_cover_pilot_routes tests/test_map_data_api.py::test_map_api_returns_seeded_names -v`
Expected: fail because current seed set or API setup is incomplete

- [ ] **Step 3: Write minimal implementation**

`backend/tests/test_seed_loader.py`

```python
from app.db.seeds import load_seed_json
from app.scripts.init_map_data import run


def test_seed_segments_cover_pilot_routes() -> None:
    rows = load_seed_json("core_segments.json")
    codes = {row["segment_code"] for row in rows}
    assert "S_GATE3_TO_CROSS1" in codes
    assert "S_CROSS1_TO_CLINIC" in codes
    assert "S_CLINIC_TO_CROSS2" in codes
    assert "S_CROSS2_TO_CANTEEN" in codes


def test_run_returns_seed_counts() -> None:
    result = run()
    assert result["pois"] == 3
    assert result["nodes"] == 5
    assert result["segments"] == 4
```

`backend/tests/test_map_data_api.py`

```python
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_map_api_returns_seeded_names() -> None:
    response = client.get("/api/map-data/pois")
    assert response.status_code == 200
    names = {row["name"] for row in response.json()}
    assert "重庆师范大学三号门" in names
    assert "重庆师范大学校医院" in names
    assert "重庆师范大学食堂" in names
```

`backend/README.md`

```md
## 验证

```powershell
cd F:\items\map\backend
$env:PYTHONPATH = "F:\items\map\backend"
python -m pytest tests -q
```

预期输出：

```text
.......
```
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests -q`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_seed_loader.py backend/tests/test_map_data_api.py backend/README.md
git commit -m "test: verify pilot map seed flow end to end"
```

## Self-Review

### 1. Spec coverage

- Pilot scope (`三号门 / 校医院 / 食堂`) is covered by Task 2 seed JSON files and Task 5 validation.
- Script initialization path is covered by Task 3.
- Backend query support for route-planning inputs is covered by Task 4.
- OSM-compatible future structure is preserved by using `road_node` and `road_segment` directly rather than hard-coding route outputs.

### 2. Placeholder scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Every task contains exact file paths, code snippets, test commands, and expected results.

### 3. Type consistency

- `run() -> dict[str, int]` is used consistently across Tasks 3 and 5.
- `load_seed_json(filename: str) -> list[dict]` is used consistently across Tasks 2 and 5.
- `/api/map-data/pois` and `/api/map-data/segments` paths match the router registration in Task 4.

