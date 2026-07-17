# Multi-Route Endpoint Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every active POI linked to a valid same-area road node selectable as either route endpoint, initialize the database, and export a complete idempotent PostgreSQL/PostGIS initialization SQL file.

**Architecture:** A shared backend endpoint query defines route-endpoint eligibility and is used by both endpoint listing and POI resolution. The Vue client loads this list instead of hard-coding start and destination choices. Seed JSON remains the source of truth; a deterministic exporter combines schema DDL and generated idempotent seed DML into one checked-in SQL artifact.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy, pytest, PostgreSQL 16, PostGIS, Vue 3, Vite 8, PowerShell.

## Global Constraints

- Every `ACTIVE` POI with a valid `linked_node_code` in the same active pilot area is both a start and destination candidate.
- Do not add start/end capability flags or a route-endpoint configuration table.
- The full SQL must work on an empty PostgreSQL 16 + PostGIS database and be safe to execute repeatedly.
- Preserve the existing route recommendation request contract using `start_name`, `end_name`, and `area_code`.
- Do not include local untracked source photographs in SQL or commits.

## File Map

- Modify `db/01_init_schema.sql`: add the POI composite unique constraint needed for SQL upserts.
- Create `db/02_full_init.sql`: checked-in full schema-and-seed initialization artifact.
- Modify `backend/app/api/routes/routes.py`: shared endpoint query, endpoint listing API, and resolver reuse.
- Modify `backend/app/schemas/routes.py`: endpoint response model.
- Modify `backend/app/db/seeds.py`: align POI idempotency with the composite business key and add consistency validation.
- Modify `backend/app/scripts/init_map_data.py`: run validation and report counts.
- Create `backend/app/scripts/export_full_init_sql.py`: deterministic SQL exporter from schema plus seed JSON.
- Modify `backend/tests/test_routes_api.py`: endpoint filtering and non-gate start coverage.
- Modify `backend/tests/test_seed_loader.py`: POI business-key and seed consistency coverage.
- Create `backend/tests/test_export_full_init_sql.py`: exported SQL structure, ordering, escaping, and idempotency assertions.
- Modify `backend/tests/test_real_database_integration.py`: repeated initialization and endpoint consistency integration checks.
- Modify `frontend/src/App.vue`: dynamic shared endpoint options and same-endpoint prevention.
- Modify `README.md`: document full SQL initialization/export commands.

---

### Task 1: Establish the Route Endpoint Contract

**Files:**
- Modify: `backend/app/schemas/routes.py`
- Modify: `backend/app/api/routes/routes.py`
- Test: `backend/tests/test_routes_api.py`

**Interfaces:**
- Produces: `RouteEndpointResponse(id: int, name: str, poi_type: str, linked_node_code: str)`.
- Produces: `load_route_endpoints(db: Session, area_code: str, name: str | None = None) -> list[dict]`.
- Produces: `GET /api/routes/endpoints?area_code=SHIDAYUAN`.
- Preserves: `resolve_poi_node_code(db, name, area_code) -> str`.

- [ ] **Step 1: Write failing endpoint API tests**

Add tests whose fake database returns two valid rows and excludes rows lacking a same-area node:

```python
def test_list_route_endpoints_returns_all_valid_linked_pois() -> None:
    response = client.get("/api/routes/endpoints", params={"area_code": "SHIDAYUAN"})
    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == [GATE_NAME, LOTUS_NAME, BUILDING_A_NAME]


def test_recommend_route_api_accepts_non_gate_start() -> None:
    response = client.get("/api/routes/recommend", params={
        "start_name": LOTUS_NAME,
        "end_name": BUILDING_A_NAME,
        "mobility_type": "INDEPENDENT",
    })
    assert response.status_code == 200
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `..\.conda\elder-map-py311\python.exe -m pytest backend\tests\test_routes_api.py -q`

Expected: endpoint test fails with `404` because `/api/routes/endpoints` does not exist.

- [ ] **Step 3: Add the endpoint response model and shared query**

Implement one joined query with these mandatory predicates:

```sql
FROM poi_facility pf
JOIN pilot_area pa ON pa.id = pf.pilot_area_id
JOIN road_node rn
  ON rn.osm_node_ref = pf.linked_node_code
 AND rn.pilot_area_id = pf.pilot_area_id
WHERE pf.status = 'ACTIVE'
  AND pa.status = 'ACTIVE'
  AND pa.area_code = :area_code
```

Order by `pf.id`. Make the endpoint handler return `list[RouteEndpointResponse]`. Refactor `resolve_poi_node_code` to call the same query with `name`, raising the existing `404` when no eligible POI exists.

- [ ] **Step 4: Run route API tests**

Run: `..\.conda\elder-map-py311\python.exe -m pytest backend\tests\test_routes_api.py -q`

Expected: all tests pass, including a non-gate POI used as the start.

- [ ] **Step 5: Commit the endpoint contract**

```powershell
git add backend/app/schemas/routes.py backend/app/api/routes/routes.py backend/tests/test_routes_api.py
git commit -m "feat: expose valid route endpoints"
```

### Task 2: Make POI Seed Identity and Validation Explicit

**Files:**
- Modify: `db/01_init_schema.sql`
- Modify: `backend/app/db/seeds.py`
- Modify: `backend/app/scripts/init_map_data.py`
- Test: `backend/tests/test_seed_loader.py`

**Interfaces:**
- Produces: unique constraint `uk_poi_facility_area_name_type` on `(pilot_area_id, name, poi_type)`.
- Produces: `validate_map_data() -> dict[str, int]`, raising `RuntimeError` for broken structural relationships.
- Consumes: existing `seed_map_data() -> dict[str, int]`.

- [ ] **Step 1: Write failing seed validation tests**

Add assertions that every core POI has a non-empty `linked_node_code`, each code exists in `core_nodes.json`, there are at least two endpoint POIs, and POI keys `(name, poi_type)` are unique within the seed file.

```python
def test_core_pois_are_valid_route_endpoints() -> None:
    pois = load_seed_json("core_pois.json")
    node_codes = {row["node_code"] for row in load_seed_json("core_nodes.json")}
    assert len(pois) >= 2
    assert all(row.get("linked_node_code") in node_codes for row in pois)
    assert len({(row["name"], row["poi_type"]) for row in pois}) == len(pois)
```

- [ ] **Step 2: Run seed tests and capture the baseline**

Run: `..\.conda\elder-map-py311\python.exe -m pytest backend\tests\test_seed_loader.py -q`

Expected: the new schema/validation expectation fails before implementation.

- [ ] **Step 3: Add the database key and align Python upserts**

Add the composite unique constraint after legacy-column migration is complete. Change POI lookup/update predicates to include `pilot_area_id`; retain seed order as area → nodes → segments → POIs.

- [ ] **Step 4: Add post-seed structural validation**

Within a transaction, query counts for invalid active POI links, cross-area segment nodes, endpoint count, and graph-isolated endpoint nodes. Raise `RuntimeError` for invalid links, cross-area nodes, or fewer than two endpoints. Return named counts for successful initialization output; do not fail solely because a mobility profile cannot traverse a route.

- [ ] **Step 5: Run seed and schema tests**

Run: `..\.conda\elder-map-py311\python.exe -m pytest backend\tests\test_seed_loader.py backend\tests\test_real_database_integration.py -q`

Expected: all available tests pass; real-database tests may skip only when PostgreSQL is unavailable.

- [ ] **Step 6: Commit seed invariants**

```powershell
git add db/01_init_schema.sql backend/app/db/seeds.py backend/app/scripts/init_map_data.py backend/tests/test_seed_loader.py backend/tests/test_real_database_integration.py
git commit -m "feat: validate route endpoint seed data"
```

### Task 3: Export the Complete Idempotent SQL

**Files:**
- Create: `backend/app/scripts/export_full_init_sql.py`
- Create: `backend/tests/test_export_full_init_sql.py`
- Create: `db/02_full_init.sql`

**Interfaces:**
- Produces: `render_full_init_sql() -> str`.
- Produces: `write_full_init_sql(output_path: Path) -> Path`.
- Consumes: `db/01_init_schema.sql` and all JSON files under `backend/app/db/seed_data` required by `seed_map_data`.

- [ ] **Step 1: Write failing exporter tests**

Test that rendered SQL starts with `BEGIN;`, includes the schema, inserts tables in dependency order, uses `ON CONFLICT`, validates endpoint links, ends with `COMMIT;`, and escapes a value containing a single quote as two quotes.

```python
def test_full_init_sql_is_transactional_and_idempotent() -> None:
    sql = render_full_init_sql()
    assert sql.startswith("BEGIN;\n")
    assert sql.index("INSERT INTO pilot_area") < sql.index("INSERT INTO road_node")
    assert sql.index("INSERT INTO road_node") < sql.index("INSERT INTO road_segment")
    assert sql.index("INSERT INTO road_segment") < sql.index("INSERT INTO poi_facility")
    assert "ON CONFLICT" in sql
    assert "RAISE EXCEPTION" in sql
    assert sql.rstrip().endswith("COMMIT;")
```

- [ ] **Step 2: Run exporter tests and verify failure**

Run: `..\.conda\elder-map-py311\python.exe -m pytest backend\tests\test_export_full_init_sql.py -q`

Expected: collection fails because `export_full_init_sql` does not exist.

- [ ] **Step 3: Implement deterministic SQL rendering**

Implement explicit SQL literal helpers for `None`, booleans, numbers, strings, JSONB, and WKT geometry. Generate one upsert per business row, resolve foreign IDs using stable keys, and append a PostgreSQL `DO $$ ... $$` validation block. Never serialize local photo bytes or environment secrets.

- [ ] **Step 4: Generate the checked-in artifact**

Run from the repository root:

```powershell
$env:PYTHONPATH=(Resolve-Path backend).Path
.\.conda\elder-map-py311\python.exe -m app.scripts.export_full_init_sql
```

Expected: `db/02_full_init.sql` is created with UTF-8 text and deterministic content.

- [ ] **Step 5: Run exporter tests twice and compare output**

Run the exporter twice, record `(Get-FileHash db\02_full_init.sql).Hash` after each run, and assert the hashes are identical. Then run `pytest backend\tests\test_export_full_init_sql.py -q` and expect all tests to pass.

- [ ] **Step 6: Commit exporter and SQL**

```powershell
git add backend/app/scripts/export_full_init_sql.py backend/tests/test_export_full_init_sql.py db/02_full_init.sql
git commit -m "feat: export complete database initialization sql"
```

### Task 4: Load Shared Endpoints in the Vue Client

**Files:**
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `GET /api/routes/endpoints?area_code=SHIDAYUAN` returning endpoint objects.
- Produces: reactive `endpointOptions`, `availableStartOptions`, and `availableEndOptions`.

- [ ] **Step 1: Replace hard-coded constants with reactive state**

Use `const endpointOptions = ref([])`, initialize `startName` and `endName` as empty strings, and create computed filters that exclude the opposite selected value.

- [ ] **Step 2: Fetch and select safe defaults**

Add `fetchRouteEndpoints()` to `onMounted()`. After a successful response, prefer `师大苑大学城西路入口` as the start when present and choose the first different endpoint as the destination. If fewer than two endpoints are returned, show an actionable error and keep route submission disabled.

- [ ] **Step 3: Add client-side submission validation**

At the start of `fetchRoutes`, reject empty values and equal values before issuing a request. Bind each selector to its filtered computed options and disable the submit button while loading or while fewer than two endpoints exist.

- [ ] **Step 4: Build the frontend**

Run: `cd frontend; npm.cmd run build`

Expected: Vite exits `0` and writes the production bundle to `frontend/dist`.

- [ ] **Step 5: Commit the dynamic endpoint UI**

```powershell
git add frontend/src/App.vue
git commit -m "feat: select any valid poi as route start"
```

### Task 5: Initialize, Verify, and Document Delivery

**Files:**
- Modify: `backend/tests/test_real_database_integration.py`
- Modify: `README.md`
- Regenerate: `db/02_full_init.sql`

**Interfaces:**
- Consumes: local `DATABASE_URL` from `backend/.env` and PostgreSQL/PostGIS.
- Produces: initialized local database and documented reusable SQL workflow.

- [ ] **Step 1: Add real-database repeatability coverage**

Execute schema plus seed twice and assert stable counts for active areas, nodes, segments, POIs, and eligible endpoints. Assert that every active seeded POI resolves through the same-area node join.

- [ ] **Step 2: Start PostGIS if required**

Run: `docker compose -f docker-compose.postgis.yml up -d`

Expected: the PostGIS container is running and accepts connections configured in `backend/.env`.

- [ ] **Step 3: Initialize the current database**

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path backend).Path
.\.conda\elder-map-py311\python.exe -m app.scripts.init_map_data
```

Expected: output reports seed and validation counts with zero invalid endpoint links.

- [ ] **Step 4: Execute the exported SQL against a disposable empty database**

Create a disposable database dedicated to verification, run `psql -v ON_ERROR_STOP=1 -f db/02_full_init.sql` twice, compare business-key counts after both runs, and then drop only that explicitly named disposable database. Do not run destructive operations against the configured development database.

- [ ] **Step 5: Run the complete verification suite**

Run:

```powershell
.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q
Set-Location frontend
npm.cmd run build
```

Expected: all backend tests pass and the frontend build exits `0`.

- [ ] **Step 6: Document commands and artifact location**

Document Python initialization, SQL export, and direct `psql` initialization using `db/02_full_init.sql`. State that the SQL is idempotent and targets PostgreSQL 16 + PostGIS.

- [ ] **Step 7: Commit verification and documentation**

```powershell
git add backend/tests/test_real_database_integration.py README.md db/02_full_init.sql
git commit -m "docs: document complete database initialization"
```

- [ ] **Step 8: Final repository review**

Run `git status --short`, `git diff --check HEAD~5..HEAD`, and inspect that the user's untracked photo directory remains untouched. Report the initialized endpoint count, test totals, SQL path, and any environment-dependent skipped integration checks.

