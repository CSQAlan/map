# MSR Route Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first MSR route recommendation API that returns up to three real candidate walking routes for the Gate 3 / clinic / canteen pilot.

**Architecture:** Keep route planning as a focused service layer under `backend/app/services`. The service reads active POIs, nodes, and segments from the database, builds a small in-memory directed graph, enumerates simple paths, scores each path with mobility-type weights, and exposes results through a FastAPI route.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0, Pydantic 2, PostgreSQL/PostGIS, pytest

## Global Constraints

- Request input is `start_name`, `end_name`, and `mobility_type`.
- The API returns at most 3 real candidate routes.
- Search uses in-memory graph computation and simple path enumeration.
- Supported mobility types are `INDEPENDENT`, `ASSISTED`, and `FAMILY_ASSISTED`.
- The route planner consumes final `road_segment` rows from the current database.
- The first version uses explicit POI-name to node-code mapping.

---

## File Structure

- Create: `backend/app/services/__init__.py`
  - Service package marker
- Create: `backend/app/services/route_planner.py`
  - Graph loading, path enumeration, scoring, and recommendation logic
- Create: `backend/app/schemas/routes.py`
  - Route recommendation response models
- Create: `backend/app/api/routes/routes.py`
  - `GET /api/routes/recommend`
- Create: `backend/tests/test_route_planner.py`
  - Unit tests for scoring and path enumeration
- Create: `backend/tests/test_routes_api.py`
  - API tests for route recommendations
- Modify: `backend/app/api/router.py`
  - Register route recommendation router

## Task 1: Add route scoring primitives

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/route_planner.py`
- Test: `backend/tests/test_route_planner.py`

**Interfaces:**
- Produces:
  - `SUPPORTED_MOBILITY_TYPES: set[str]`
  - `segment_cost(segment: Mapping[str, Any], mobility_type: str) -> float`
  - `route_score(segments: list[Mapping[str, Any]], mobility_type: str) -> float`

- [ ] **Step 1: Write the failing test**

```python
from app.services.route_planner import route_score, segment_cost


def test_low_risk_segment_costs_less_than_high_risk_segment() -> None:
    low_risk = {
        "length_m": 60,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
    }
    high_risk = {
        "length_m": 60,
        "slope_percent": 4,
        "surface_level": 2,
        "safety_level": 2,
        "barrier_free_level": 2,
        "rest_facility_score": 2,
        "step_count": 3,
    }
    assert segment_cost(low_risk, "ASSISTED") < segment_cost(high_risk, "ASSISTED")


def test_route_score_sums_segment_costs() -> None:
    segment = {
        "length_m": 100,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
    }
    assert route_score([segment, segment], "INDEPENDENT") == segment_cost(segment, "INDEPENDENT") * 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_route_planner.py::test_low_risk_segment_costs_less_than_high_risk_segment tests/test_route_planner.py::test_route_score_sums_segment_costs -v`
Expected: `ModuleNotFoundError: No module named 'app.services'`

- [ ] **Step 3: Write minimal implementation**

`backend/app/services/__init__.py`

```python
"""业务服务层。"""
```

`backend/app/services/route_planner.py`

```python
from collections.abc import Mapping
from typing import Any


SUPPORTED_MOBILITY_TYPES = {"INDEPENDENT", "ASSISTED", "FAMILY_ASSISTED"}

MOBILITY_WEIGHTS = {
    "INDEPENDENT": {
        "distance": 1.2,
        "slope": 1.0,
        "surface": 0.8,
        "safety": 0.9,
        "barrier_free": 0.5,
        "rest": 0.4,
        "step": 0.8,
    },
    "ASSISTED": {
        "distance": 0.8,
        "slope": 1.4,
        "surface": 1.3,
        "safety": 1.3,
        "barrier_free": 1.2,
        "rest": 0.9,
        "step": 1.5,
    },
    "FAMILY_ASSISTED": {
        "distance": 0.9,
        "slope": 1.1,
        "surface": 1.0,
        "safety": 1.5,
        "barrier_free": 1.0,
        "rest": 1.1,
        "step": 1.2,
    },
}


def segment_cost(segment: Mapping[str, Any], mobility_type: str) -> float:
    weights = MOBILITY_WEIGHTS[mobility_type]
    distance_cost = float(segment["length_m"]) / 100
    slope_risk = float(segment["slope_percent"])
    surface_risk = 6 - int(segment["surface_level"])
    safety_risk = 6 - int(segment["safety_level"])
    barrier_free_risk = 6 - int(segment["barrier_free_level"])
    rest_risk = 6 - int(segment["rest_facility_score"])
    step_risk = int(segment["step_count"]) * 2
    return (
        weights["distance"] * distance_cost
        + weights["slope"] * slope_risk
        + weights["surface"] * surface_risk
        + weights["safety"] * safety_risk
        + weights["barrier_free"] * barrier_free_risk
        + weights["rest"] * rest_risk
        + weights["step"] * step_risk
    )


def route_score(segments: list[Mapping[str, Any]], mobility_type: str) -> float:
    return sum(segment_cost(segment, mobility_type) for segment in segments)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_route_planner.py::test_low_risk_segment_costs_less_than_high_risk_segment tests/test_route_planner.py::test_route_score_sums_segment_costs -v`
Expected: `PASSED`

## Task 2: Add simple path enumeration

**Files:**
- Modify: `backend/app/services/route_planner.py`
- Test: `backend/tests/test_route_planner.py`

**Interfaces:**
- Consumes:
  - `route_score(segments: list[Mapping[str, Any]], mobility_type: str) -> float`
- Produces:
  - `enumerate_paths(segments: list[Mapping[str, Any]], start_node_code: str, end_node_code: str, max_depth: int = 8) -> list[list[Mapping[str, Any]]]`

- [ ] **Step 1: Write the failing test**

```python
from app.services.route_planner import enumerate_paths


def test_enumerate_paths_finds_multiple_simple_paths() -> None:
    segments = [
        {"segment_code": "A_B", "start_node_code": "A", "end_node_code": "B"},
        {"segment_code": "B_D", "start_node_code": "B", "end_node_code": "D"},
        {"segment_code": "A_C", "start_node_code": "A", "end_node_code": "C"},
        {"segment_code": "C_D", "start_node_code": "C", "end_node_code": "D"},
    ]
    paths = enumerate_paths(segments, "A", "D")
    codes = [[segment["segment_code"] for segment in path] for path in paths]
    assert ["A_B", "B_D"] in codes
    assert ["A_C", "C_D"] in codes
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_route_planner.py::test_enumerate_paths_finds_multiple_simple_paths -v`
Expected: `ImportError: cannot import name 'enumerate_paths'`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/services/route_planner.py`:

```python
def enumerate_paths(
    segments: list[Mapping[str, Any]],
    start_node_code: str,
    end_node_code: str,
    max_depth: int = 8,
) -> list[list[Mapping[str, Any]]]:
    graph: dict[str, list[Mapping[str, Any]]] = {}
    for segment in segments:
        graph.setdefault(str(segment["start_node_code"]), []).append(segment)

    paths: list[list[Mapping[str, Any]]] = []

    def dfs(current_node: str, visited: set[str], path: list[Mapping[str, Any]]) -> None:
        if len(path) > max_depth:
            return
        if current_node == end_node_code:
            paths.append(path.copy())
            return
        for segment in graph.get(current_node, []):
            next_node = str(segment["end_node_code"])
            if next_node in visited:
                continue
            path.append(segment)
            visited.add(next_node)
            dfs(next_node, visited, path)
            visited.remove(next_node)
            path.pop()

    dfs(start_node_code, {start_node_code}, [])
    return paths
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_route_planner.py::test_enumerate_paths_finds_multiple_simple_paths -v`
Expected: `PASSED`

## Task 3: Add route recommendation service

**Files:**
- Modify: `backend/app/services/route_planner.py`
- Test: `backend/tests/test_route_planner.py`

**Interfaces:**
- Consumes:
  - `enumerate_paths(...) -> list[list[Mapping[str, Any]]]`
  - `route_score(...) -> float`
- Produces:
  - `recommend_routes(segments: list[Mapping[str, Any]], start_node_code: str, end_node_code: str, mobility_type: str, limit: int = 3) -> list[dict[str, Any]]`

- [ ] **Step 1: Write the failing test**

```python
from app.services.route_planner import recommend_routes


def test_recommend_routes_returns_sorted_top_three() -> None:
    base = {
        "length_m": 50,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
    }
    segments = [
        {**base, "segment_code": "A_B", "name": "A到B", "start_node_code": "A", "end_node_code": "B"},
        {**base, "segment_code": "B_D", "name": "B到D", "start_node_code": "B", "end_node_code": "D"},
        {**base, "segment_code": "A_C", "name": "A到C", "start_node_code": "A", "end_node_code": "C", "length_m": 80},
        {**base, "segment_code": "C_D", "name": "C到D", "start_node_code": "C", "end_node_code": "D", "length_m": 80},
    ]
    routes = recommend_routes(segments, "A", "D", "INDEPENDENT")
    assert len(routes) == 2
    assert routes[0]["route_score"] <= routes[1]["route_score"]
    assert routes[0]["rank"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_route_planner.py::test_recommend_routes_returns_sorted_top_three -v`
Expected: `ImportError: cannot import name 'recommend_routes'`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/services/route_planner.py`:

```python
def build_summary(path: list[Mapping[str, Any]]) -> str:
    avg_slope = sum(float(segment["slope_percent"]) for segment in path) / len(path)
    avg_surface = sum(int(segment["surface_level"]) for segment in path) / len(path)
    avg_safety = sum(int(segment["safety_level"]) for segment in path) / len(path)
    avg_rest = sum(int(segment["rest_facility_score"]) for segment in path) / len(path)
    total_steps = sum(int(segment["step_count"]) for segment in path)

    reasons = []
    if avg_slope <= 1.5:
        reasons.append("坡度较缓")
    if avg_surface >= 4:
        reasons.append("路面较平整")
    if avg_safety >= 4:
        reasons.append("安全性较好")
    if avg_rest >= 4:
        reasons.append("沿途休息点更友好")
    if total_steps > 0:
        reasons.append("存在台阶，需要注意")
    return "，".join(reasons) if reasons else "综合成本较低"


def recommend_routes(
    segments: list[Mapping[str, Any]],
    start_node_code: str,
    end_node_code: str,
    mobility_type: str,
    limit: int = 3,
) -> list[dict[str, Any]]:
    paths = enumerate_paths(segments, start_node_code, end_node_code)
    ranked = []
    for path in paths:
        score = route_score(path, mobility_type)
        ranked.append((score, path))
    ranked.sort(key=lambda item: item[0])

    routes = []
    for index, (score, path) in enumerate(ranked[:limit], start=1):
        routes.append(
            {
                "rank": index,
                "route_score": round(score, 2),
                "distance_m": round(sum(float(segment["length_m"]) for segment in path), 2),
                "estimated_minutes": max(1, round(sum(float(segment["length_m"]) for segment in path) / 60)),
                "segment_codes": [str(segment["segment_code"]) for segment in path],
                "segment_names": [segment.get("name") for segment in path],
                "summary": build_summary(path),
            }
        )
    return routes
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_route_planner.py::test_recommend_routes_returns_sorted_top_three -v`
Expected: `PASSED`

## Task 4: Add route recommendation API

**Files:**
- Create: `backend/app/schemas/routes.py`
- Create: `backend/app/api/routes/routes.py`
- Modify: `backend/app/api/router.py`
- Test: `backend/tests/test_routes_api.py`

**Interfaces:**
- Consumes:
  - `recommend_routes(...) -> list[dict[str, Any]]`
  - `get_db()`
- Produces:
  - `GET /api/routes/recommend`

- [ ] **Step 1: Write the failing test**

```python
from typing import Any

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


client = TestClient(app)


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        return self._rows

    def scalar_one_or_none(self) -> str | None:
        return self._rows[0]["osm_node_ref"] if self._rows else None


class FakeSession:
    def execute(self, query: Any, params: dict[str, Any] | None = None) -> FakeResult:
        sql = str(query)
        if "FROM poi_facility" in sql:
            name = params["name"]
            mapping = {
                "重庆师范大学三号门": "N_GATE3",
                "重庆师范大学食堂": "N_CANTEEN",
            }
            return FakeResult([{"osm_node_ref": mapping[name]}] if name in mapping else [])
        return FakeResult(
            [
                {
                    "segment_code": "S_GATE3_TO_WIDE_PATH",
                    "name": "三号门到宽缓步道",
                    "start_node_code": "N_GATE3",
                    "end_node_code": "N_WIDE_PATH",
                    "length_m": 136,
                    "slope_percent": 1.2,
                    "surface_level": 4,
                    "safety_level": 5,
                    "barrier_free_level": 5,
                    "rest_facility_score": 4,
                    "step_count": 0,
                },
                {
                    "segment_code": "S_WIDE_PATH_TO_SIDE",
                    "name": "宽缓步道到食堂侧路",
                    "start_node_code": "N_WIDE_PATH",
                    "end_node_code": "N_SIDE_PATH",
                    "length_m": 72,
                    "slope_percent": 1.6,
                    "surface_level": 4,
                    "safety_level": 5,
                    "barrier_free_level": 5,
                    "rest_facility_score": 4,
                    "step_count": 0,
                },
                {
                    "segment_code": "S_SIDE_TO_CANTEEN",
                    "name": "食堂侧路到食堂",
                    "start_node_code": "N_SIDE_PATH",
                    "end_node_code": "N_CANTEEN",
                    "length_m": 54,
                    "slope_percent": 1.4,
                    "surface_level": 4,
                    "safety_level": 4,
                    "barrier_free_level": 4,
                    "rest_facility_score": 4,
                    "step_count": 0,
                },
            ]
        )


def override_get_db() -> Any:
    yield FakeSession()


app.dependency_overrides[get_db] = override_get_db


def test_recommend_route_api_returns_candidates() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": "重庆师范大学三号门",
            "end_name": "重庆师范大学食堂",
            "mobility_type": "ASSISTED",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["routes"]) == 1
    assert data["routes"][0]["rank"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_routes_api.py::test_recommend_route_api_returns_candidates -v`
Expected: `404 Not Found`

- [ ] **Step 3: Write minimal implementation**

`backend/app/schemas/routes.py`

```python
from pydantic import BaseModel


class RouteCandidateResponse(BaseModel):
    rank: int
    route_score: float
    distance_m: float
    estimated_minutes: int
    segment_codes: list[str]
    segment_names: list[str | None]
    summary: str


class RouteRecommendResponse(BaseModel):
    start_name: str
    end_name: str
    mobility_type: str
    routes: list[RouteCandidateResponse]
```

`backend/app/api/routes/routes.py`

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.routes import RouteRecommendResponse
from app.services.route_planner import SUPPORTED_MOBILITY_TYPES, recommend_routes


router = APIRouter()


POI_NODE_CODES = {
    "重庆师范大学三号门": "N_GATE3",
    "重庆师范大学校医院": "N_CLINIC",
    "重庆师范大学食堂": "N_CANTEEN",
}


@router.get("/recommend", response_model=RouteRecommendResponse)
def recommend_route(
    start_name: str = Query(...),
    end_name: str = Query(...),
    mobility_type: str = Query(...),
    db: Session = Depends(get_db),
) -> RouteRecommendResponse:
    if mobility_type not in SUPPORTED_MOBILITY_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported mobility_type")
    if start_name == end_name:
        raise HTTPException(status_code=400, detail="Start and end cannot be the same")
    start_node_code = resolve_poi_node_code(db, start_name)
    end_node_code = resolve_poi_node_code(db, end_name)
    segments = load_active_segments(db)
    routes = recommend_routes(segments, start_node_code, end_node_code, mobility_type)
    if not routes:
        raise HTTPException(status_code=404, detail="No reachable route found")
    return RouteRecommendResponse(
        start_name=start_name,
        end_name=end_name,
        mobility_type=mobility_type,
        routes=routes,
    )


def resolve_poi_node_code(db: Session, name: str) -> str:
    node_code = POI_NODE_CODES.get(name)
    if node_code is None:
        raise HTTPException(status_code=404, detail=f"POI not found: {name}")
    exists = db.execute(
        text("SELECT id FROM poi_facility WHERE name = :name AND status = 'ACTIVE'"),
        {"name": name},
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=404, detail=f"POI not found: {name}")
    return node_code


def load_active_segments(db: Session) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT
                rs.segment_code,
                rs.name,
                rn_start.osm_node_ref AS start_node_code,
                rn_end.osm_node_ref AS end_node_code,
                rs.length_m,
                rs.slope_percent,
                rs.surface_level,
                rs.safety_level,
                rs.barrier_free_level,
                rs.rest_facility_score,
                rs.step_count
            FROM road_segment rs
            JOIN road_node rn_start ON rn_start.id = rs.start_node_id
            JOIN road_node rn_end ON rn_end.id = rs.end_node_id
            WHERE rs.status = 'ACTIVE'
            ORDER BY rs.id
            """
        )
    ).mappings()
    return [dict(row) for row in rows]
```

`backend/app/api/router.py`

```python
from fastapi import APIRouter

from app.api.routes.health import router as health_router
from app.api.routes.map_data import router as map_data_router
from app.api.routes.routes import router as routes_router


api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(map_data_router, prefix="/map-data", tags=["map-data"])
api_router.include_router(routes_router, prefix="/routes", tags=["routes"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_routes_api.py::test_recommend_route_api_returns_candidates -v`
Expected: `PASSED`

## Task 5: Verify full route-planning slice

**Files:**
- Modify: `backend/tests/test_routes_api.py`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes:
  - `GET /api/routes/recommend`
- Produces:
  - Documented route recommendation usage

- [ ] **Step 1: Write the failing test**

```python
def test_recommend_route_api_rejects_unknown_poi() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": "不存在的门",
            "end_name": "重庆师范大学食堂",
            "mobility_type": "ASSISTED",
        },
    )
    assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_routes_api.py::test_recommend_route_api_rejects_unknown_poi -v`
Expected: fail until the API error path is implemented

- [ ] **Step 3: Write minimal implementation**

The error path is already covered in Task 4 by `resolve_poi_node_code()`. Add README usage:

`backend/README.md`

```md
## 路线推荐接口

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/routes/recommend?start_name=重庆师范大学三号门&end_name=重庆师范大学食堂&mobility_type=ASSISTED"
```
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests -q`
Expected: all tests pass

## Self-Review

### 1. Spec coverage

- POI-name request input is covered by Task 4.
- Up to 3 real routes is covered by Task 3.
- In-memory graph and simple path enumeration are covered by Task 2.
- Three mobility types and MSR weights are covered by Task 1.
- API error handling is covered by Tasks 4 and 5.

### 2. Placeholder scan

- No `TODO`, `TBD`, or unspecified implementation steps remain.

### 3. Type consistency

- `recommend_routes(...) -> list[dict[str, Any]]` feeds directly into `RouteRecommendResponse.routes`.
- `segment_cost` and `route_score` use the same segment field names loaded by the API SQL.
- Router path `/api/routes/recommend` matches the tests.

