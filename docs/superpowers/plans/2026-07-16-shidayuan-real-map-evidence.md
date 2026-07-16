# Shidayuan Real Map and Photo Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the schematic Shidayuan map with a bounded AMap view and show optimized field photos as route evidence on desktop and mobile.

**Architecture:** FastAPI remains the source of area, road, POI, route, and evidence metadata. PostGIS stores canonical WGS84 geometry; a focused coordinate service emits GCJ-02 for AMap. Vue owns the AMap lifecycle in a dedicated component, while evidence components share `segment_code` selection with route cards and retain the existing SVG map as a failure fallback.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy, PostgreSQL 16 + PostGIS, Pillow, pytest, Vue 3.5, Vite 8, AMap JavaScript API 2.0, CSS.

## Global Constraints

- The only enabled pilot area in this phase is `SHIDAYUAN`.
- Database geometry is stored as WGS84 / EPSG:4326; AMap responses explicitly use `GCJ02`.
- Original field photos remain outside normal Git history and are never served by the API.
- Generated WebP derivatives use stable photo IDs and are lazy-loaded.
- `frontend/.env.local` remains ignored and is never committed.
- Route planning remains the project's accessibility algorithm; AMap is only the base map and overlay engine.
- AMap failure must not block route recommendation or evidence viewing.

---

## File Structure

- `db/01_init_schema.sql`: adds the pilot area table and area foreign keys.
- `backend/app/db/seed_data/pilot_areas.json`: canonical Shidayuan area seed.
- `backend/app/db/seed_data/photo_manifest.json`: stable evidence-photo metadata.
- `backend/app/db/seeds.py`: upserts areas and assigns all Shidayuan entities.
- `backend/app/services/coordinates.py`: WGS84/GCJ-02 conversion only.
- `backend/app/services/photo_evidence.py`: manifest lookup and safe derivative paths only.
- `backend/app/api/routes/pilot_areas.py`: area boundary endpoint.
- `backend/app/api/routes/map_data.py`: area-filtered enriched GeoJSON.
- `backend/app/scripts/build_photo_derivatives.py`: WebP generation from local originals.
- `backend/app/static/evidence/{thumb,display}/`: generated, web-safe derivatives.
- `frontend/src/services/amapLoader.js`: one-time AMap loader.
- `frontend/src/components/AmapRouteMap.vue`: map lifecycle and overlays.
- `frontend/src/components/FallbackRouteMap.vue`: extracted schematic fallback.
- `frontend/src/components/EvidenceGallery.vue`: route/segment evidence panel.
- `frontend/src/components/PhotoLightbox.vue`: accessible full-screen viewer.
- `frontend/src/App.vue`: orchestration and shared selected segment state.

### Task 1: Pilot Area Persistence and Seed Assignment

**Files:**
- Modify: `db/01_init_schema.sql`
- Create: `backend/app/db/seed_data/pilot_areas.json`
- Modify: `backend/app/db/seeds.py`
- Modify: `backend/app/models/poi.py`
- Modify: `backend/app/models/road.py`
- Test: `backend/tests/test_seed_loader.py`

**Interfaces:**
- Produces: database area code `SHIDAYUAN`; `pilot_area_id` on POIs, nodes, and segments.

- [ ] **Step 1: Write failing seed tests**

```python
def test_seed_assigns_every_shidayuan_entity_to_pilot_area(db_session):
    seed_core_map_data(db_session)
    assert db_session.execute(text("SELECT count(*) FROM pilot_area WHERE area_code='SHIDAYUAN' AND status='ACTIVE'")).scalar_one() == 1
    for table in ("poi_facility", "road_node", "road_segment"):
        assert db_session.execute(text(f"SELECT count(*) FROM {table} WHERE pilot_area_id IS NULL")).scalar_one() == 0
```

- [ ] **Step 2: Verify the test fails**

Run: `..\.conda\elder-map-py311\python.exe -m pytest tests/test_seed_loader.py -v` from `backend`.
Expected: FAIL because `pilot_area` or `pilot_area_id` does not exist.

- [ ] **Step 3: Add idempotent schema and seed data**

Add `pilot_area(area_code, name, boundary_geom, center_geom, min_zoom, max_zoom, status)` and nullable-then-backfilled `pilot_area_id` foreign keys. Seed this stable payload:

```json
{
  "area_code": "SHIDAYUAN",
  "name": "师大苑",
  "boundary_wkt": "POLYGON((106.3070 29.6035,106.3102 29.6035,106.3102 29.6052,106.3070 29.6052,106.3070 29.6035))",
  "center_wkt": "POINT(106.3086 29.60435)",
  "min_zoom": 16,
  "max_zoom": 20,
  "status": "ACTIVE"
}
```

Use one `INSERT ... ON CONFLICT (area_code) DO UPDATE`, then assign the returned area ID during POI/node/segment seed writes. Keep reruns idempotent and reactivate the area.

- [ ] **Step 4: Run seed tests and initialize the real database**

Run: `..\.conda\elder-map-py311\python.exe -m pytest tests/test_seed_loader.py -v` from `backend`.
Expected: PASS.

Run: `..\.conda\elder-map-py311\python.exe -m app.scripts.init_map_data` from `backend`.
Expected: output includes one area, 6 POIs, 12 nodes, and 17 segments.

- [ ] **Step 5: Commit**

```powershell
git add db/01_init_schema.sql backend/app/db backend/app/models backend/tests/test_seed_loader.py
git commit -m "feat: scope map data to Shidayuan area"
```

### Task 2: Coordinate Conversion and Pilot Area API

**Files:**
- Create: `backend/app/services/coordinates.py`
- Create: `backend/app/api/routes/pilot_areas.py`
- Modify: `backend/app/api/router.py`
- Create: `backend/app/schemas/pilot_areas.py`
- Create: `backend/tests/test_coordinates.py`
- Create: `backend/tests/test_pilot_areas_api.py`

**Interfaces:**
- Produces: `wgs84_to_gcj02(lon: float, lat: float) -> tuple[float, float]`.
- Produces: `convert_geometry(geometry: dict, target: str) -> dict`.
- Produces: `GET /api/pilot-areas/{area_code}?coordinate_system=GCJ02`.

- [ ] **Step 1: Write conversion and API tests**

```python
def test_wgs84_to_gcj02_is_stable_for_shidayuan():
    lon, lat = wgs84_to_gcj02(106.3086, 29.60435)
    assert lon == pytest.approx(106.3123, abs=0.001)
    assert lat == pytest.approx(29.6017, abs=0.001)

def test_pilot_area_rejects_unknown_coordinate_system(client):
    response = client.get("/api/pilot-areas/SHIDAYUAN?coordinate_system=BD09")
    assert response.status_code == 422
```

- [ ] **Step 2: Verify tests fail**

Run: `..\.conda\elder-map-py311\python.exe -m pytest tests/test_coordinates.py tests/test_pilot_areas_api.py -v` from `backend`.
Expected: FAIL because the service and endpoint do not exist.

- [ ] **Step 3: Implement the focused conversion service**

Implement the standard mainland-China WGS84-to-GCJ-02 transform with an out-of-China passthrough. Recursively convert Point, LineString, and Polygon coordinate arrays without mutating inputs. Accept only uppercase `WGS84` and `GCJ02` at the API boundary.

- [ ] **Step 4: Implement and register the area endpoint**

Return this stable shape:

```json
{
  "area_code": "SHIDAYUAN",
  "name": "师大苑",
  "coordinate_system": "GCJ02",
  "center": [106.0, 29.0],
  "boundary": {"type": "Polygon", "coordinates": []},
  "limit_bounds": {"south_west": [106.0, 29.0], "north_east": [107.0, 30.0]},
  "min_zoom": 16,
  "max_zoom": 20
}
```

Query only `status='ACTIVE'`; return 404 for unknown or inactive areas.

- [ ] **Step 5: Run tests and commit**

Run: `..\.conda\elder-map-py311\python.exe -m pytest tests/test_coordinates.py tests/test_pilot_areas_api.py -v` from `backend`.
Expected: PASS.

```powershell
git add backend/app/services/coordinates.py backend/app/api backend/app/schemas backend/tests
git commit -m "feat: expose Shidayuan map boundary"
```

### Task 3: Evidence Photo Derivative Pipeline

**Files:**
- Modify: `environment.yml`
- Create: `backend/app/db/seed_data/photo_manifest.json`
- Create: `backend/app/services/photo_evidence.py`
- Create: `backend/app/scripts/build_photo_derivatives.py`
- Create: `backend/tests/test_photo_evidence.py`
- Modify: `README.md`

**Interfaces:**
- Produces: `load_photo_manifest() -> dict[str, PhotoEvidence]`.
- Produces: `get_photo_path(photo_id: str, variant: Literal['thumb','display']) -> Path`.
- Produces: WebP files at `backend/app/static/evidence/{thumb,display}/{photo_id}.webp`.

- [ ] **Step 1: Write manifest safety tests**

```python
@pytest.mark.parametrize("photo_id", ["../IMG_9499", "a/b", "unknown"])
def test_get_photo_path_rejects_unregistered_ids(photo_id):
    with pytest.raises(PhotoEvidenceNotFound):
        get_photo_path(photo_id, "thumb")
```

- [ ] **Step 2: Verify the test fails**

Run: `..\.conda\elder-map-py311\python.exe -m pytest tests/test_photo_evidence.py -v` from `backend`.
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Declare and install the image dependency**

Add `pillow==12.3.0` under the `pip` dependencies in `environment.yml`, then run:

```powershell
conda env update -p .\.conda\elder-map-py311 -f environment.yml --prune
```

Expected: `..\.conda\elder-map-py311\python.exe -c "from PIL import Image; print(Image.__version__)"` prints `12.3.0`.

- [ ] **Step 4: Add manifest entries and derivative builder**

Use IDs such as `SY_IMG_9499`, retain `original_name`, and record `caption`, `risk_tags`, and linked segment/POI codes. Build thumbnails at maximum 480 px and display images at maximum 1600 px, preserving aspect ratio and EXIF orientation, with WebP quality 76 and 84 respectively.

The script accepts the source directory explicitly:

```powershell
..\.conda\elder-map-py311\python.exe -m app.scripts.build_photo_derivatives --source "..\IMG_9536等56项文件"
```

Expected: prints generated/skipped counts and writes no original image.

- [ ] **Step 5: Generate derivatives and verify size budget**

Run the builder, then verify every manifest item has both variants and the generated directory remains below 25 MB. If larger, lower only display quality to 80 and rerun.

- [ ] **Step 6: Run tests and commit only derivatives and metadata**

Run: `..\.conda\elder-map-py311\python.exe -m pytest tests/test_photo_evidence.py -v` from `backend`.
Expected: PASS.

```powershell
git add environment.yml backend/app/db/seed_data/photo_manifest.json backend/app/services/photo_evidence.py backend/app/scripts/build_photo_derivatives.py backend/app/static/evidence backend/tests/test_photo_evidence.py README.md
git commit -m "feat: add optimized field photo evidence"
```

### Task 4: Area-Filtered and Evidence-Enriched Map API

**Files:**
- Modify: `backend/app/api/routes/map_data.py`
- Modify: `backend/app/schemas/map_data.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_map_data_api.py`

**Interfaces:**
- Consumes: `convert_geometry`, `load_photo_manifest`, and `pilot_area_id`.
- Produces: enriched `GET /api/map-data/geojson?area_code=SHIDAYUAN&coordinate_system=GCJ02`.
- Produces: registered static route `/media/evidence` containing derivatives only.

- [ ] **Step 1: Add failing API assertions**

```python
def test_geojson_is_scoped_and_enriched(client):
    response = client.get("/api/map-data/geojson?area_code=SHIDAYUAN&coordinate_system=GCJ02")
    assert response.status_code == 200
    payload = response.json()
    assert payload["area_code"] == "SHIDAYUAN"
    assert payload["coordinate_system"] == "GCJ02"
    segment = next(f for f in payload["features"] if f["properties"]["kind"] == "segment")
    assert "evidence_photos" in segment["properties"]
    assert "risk_summary" in segment["properties"]
```

- [ ] **Step 2: Verify failure, then implement filtering and enrichment**

Run: `..\.conda\elder-map-py311\python.exe -m pytest tests/test_map_data_api.py -v` from `backend`.
Expected: FAIL on missing metadata.

Join every query through `pilot_area`, filter by `area_code` and active statuses, parse evidence IDs through the manifest, and include `thumbnail_url` and `display_url`. Build `risk_summary` deterministically from step count, wheelchair accessibility, slope, surface level, and safety level.

- [ ] **Step 3: Mount only the derivative directory**

```python
app.mount(
    "/media/evidence",
    StaticFiles(directory=EVIDENCE_ROOT, check_dir=False),
    name="evidence",
)
```

Do not mount the source photo directory. Add a test that `/media/evidence/../seed_data/core_nodes.json` does not return 200.

- [ ] **Step 4: Run API tests and commit**

Run: `..\.conda\elder-map-py311\python.exe -m pytest tests/test_map_data_api.py tests/test_photo_evidence.py -v` from `backend`.
Expected: PASS.

```powershell
git add backend/app/api/routes/map_data.py backend/app/schemas/map_data.py backend/app/main.py backend/tests
git commit -m "feat: enrich map data with photo evidence"
```

### Task 5: AMap Loader and Bounded Route Map

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/services/amapLoader.js`
- Create: `frontend/src/components/AmapRouteMap.vue`
- Create: `frontend/.env.example`

**Interfaces:**
- Produces: `loadAmap() -> Promise<AMap>` using `VITE_AMAP_KEY` and `VITE_AMAP_SECURITY_CODE`.
- Produces component props `area`, `features`, `routeSegmentCodes`, `selectedSegmentCode`.
- Emits: `select-segment(segmentCode)` and `map-error(message)`.

- [ ] **Step 1: Install the official loader**

Run: `npm.cmd install @amap/amap-jsapi-loader@1.0.1 --save-exact` from `frontend`.
Expected: package and lockfile contain the exact version.

- [ ] **Step 2: Implement one-time loading with explicit configuration errors**

```javascript
let amapPromise;
export function loadAmap() {
  if (!import.meta.env.VITE_AMAP_KEY || !import.meta.env.VITE_AMAP_SECURITY_CODE) {
    return Promise.reject(new Error('高德地图密钥未配置'));
  }
  window._AMapSecurityConfig = { securityJsCode: import.meta.env.VITE_AMAP_SECURITY_CODE };
  amapPromise ??= AMapLoader.load({ key: import.meta.env.VITE_AMAP_KEY, version: '2.0' });
  return amapPromise;
}
```

- [ ] **Step 3: Implement map lifecycle and overlays**

Initialize with the area center and zoom range, call `setLimitBounds`, render the boundary polygon, POI markers, and road polylines. Store `segment_code` in each polyline's `extData`; clicking emits the code. Watch feature and route props to update styles without recreating the map. Destroy the map in `onBeforeUnmount`.

- [ ] **Step 4: Verify production build and commit**

Run: `npm.cmd run build` from `frontend`.
Expected: Vite build succeeds and `.env.local` is absent from `dist` text search.

```powershell
git add frontend/package.json frontend/package-lock.json frontend/src/services frontend/src/components/AmapRouteMap.vue frontend/.env.example
git commit -m "feat: add bounded AMap route view"
```

### Task 6: Evidence Gallery, Lightbox, and Shared Selection

**Files:**
- Create: `frontend/src/components/EvidenceGallery.vue`
- Create: `frontend/src/components/PhotoLightbox.vue`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: map feature `properties.evidence_photos` and `segment_code`.
- Produces: `selectedSegmentCode` as the single shared selection state.
- Emits: gallery `focus-segment(segmentCode)` and lightbox `close`.

- [ ] **Step 1: Add shared state and derived evidence**

```javascript
const selectedSegmentCode = ref(null);
const selectedEvidenceFeature = computed(() =>
  roadFeatures.value.find(
    (feature) => feature.properties.segment_code === selectedSegmentCode.value
  ) ?? null
);
```

Select the first route segment after recommendation, preserve selection when switching route only if still present, and use the same setter for map clicks and route-card clicks.

- [ ] **Step 2: Build the gallery**

Render one representative thumbnail per route segment. The expanded panel shows all thumbnails, risk summary, accessibility fields, confidence as `1-5`, and source label. Add `loading="lazy"`, explicit dimensions, and an image-error placeholder.

- [ ] **Step 3: Build the accessible lightbox**

Use a dialog with a close button, previous/next buttons, Escape handling, body scroll lock, and touch-friendly controls. Load only the selected `display_url`; do not preload every display image.

- [ ] **Step 4: Verify build and commit**

Run: `npm.cmd run build` from `frontend`.
Expected: PASS.

```powershell
git add frontend/src/components/EvidenceGallery.vue frontend/src/components/PhotoLightbox.vue frontend/src/App.vue frontend/src/styles.css
git commit -m "feat: link route segments to photo evidence"
```

### Task 7: Fallback Map and Mobile Resilience

**Files:**
- Create: `frontend/src/components/FallbackRouteMap.vue`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes the same map props and emits the same `select-segment` event as `AmapRouteMap`.
- Produces automatic AMap-to-SVG fallback without changing route or evidence state.

- [ ] **Step 1: Extract the existing SVG map**

Move current projection/path helpers and SVG template into `FallbackRouteMap.vue`. Keep its public props/events compatible with `AmapRouteMap`, so fallback is a component switch rather than a second workflow.

- [ ] **Step 2: Add explicit fallback state**

```vue
<AmapRouteMap v-if="!mapFailure" v-bind="mapProps" @map-error="mapFailure = $event" />
<FallbackRouteMap v-else v-bind="mapProps" />
<p v-if="mapFailure" role="status">真实底图暂不可用，已切换到师大苑离线路网。</p>
```

- [ ] **Step 3: Complete responsive behavior**

At widths below 760 px, stack map and evidence, keep the map at least 360 px high, make controls at least 44 px, and keep the lightbox close button inside safe-area insets. Ensure the evidence panel remains usable with AMap offline.

- [ ] **Step 4: Verify both modes and commit**

Run normal build with `.env.local`, then temporarily rename it to `.env.local.disabled`, run the build again, and restore it immediately. Both builds must pass; the second runtime must show fallback.

```powershell
git add frontend/src/components/FallbackRouteMap.vue frontend/src/App.vue frontend/src/styles.css
git commit -m "feat: preserve map experience when AMap fails"
```

### Task 8: Calibration, Full Verification, and Operator Documentation

**Files:**
- Modify: `backend/app/db/seed_data/pilot_areas.json`
- Modify: `backend/app/db/seed_data/core_nodes.json`
- Modify: `backend/app/db/seed_data/core_segments.json`
- Modify: `README.md`
- Create: `docs/data-collection/shidayuan_map_calibration.md`

**Interfaces:**
- Produces calibrated WGS84 seed geometry and repeatable startup instructions.

- [ ] **Step 1: Calibrate key points against AMap**

Start the project, compare the gate, lotus area, building groups, and major intersections against the base map, and edit canonical WGS84 seed coordinates only. Record each changed node, evidence photo, confidence, and date in the calibration document. Rebuild connected segment LineStrings from their calibrated endpoints.

- [ ] **Step 2: Run complete backend verification**

Run: `..\.conda\elder-map-py311\python.exe -m pytest` from `backend`.
Expected: all tests pass; only the known FastAPI TestClient deprecation warning may remain.

- [ ] **Step 3: Run frontend and integration verification**

Run: `npm.cmd run build` from `frontend`.
Expected: PASS.

Start PostgreSQL, initialize seed data, start FastAPI on port 8000, and Vite on port 5173. Verify:

- `/api/pilot-areas/SHIDAYUAN` returns GCJ-02 bounds.
- `/api/map-data/geojson?area_code=SHIDAYUAN&coordinate_system=GCJ02` returns 17 segments and 6 POIs.
- Wheelchair route gate-to-lotus returns three candidates.
- Desktop and same-Wi-Fi phone can select a segment from map and route card.
- Browser network panel does not fetch all display images at first load.
- Removing the local AMap variables triggers the SVG fallback.

- [ ] **Step 4: Update operator instructions**

Document Python 3.11 environment activation, Docker database startup, seed initialization, backend/frontend start commands, local secret creation, LAN phone URL, photo derivative regeneration, and the rule that originals and `.env.local` must not be committed.

- [ ] **Step 5: Request code review, fix findings, and commit**

Use the `requesting-code-review` skill against the design and this plan. Resolve correctness, security, and mobile regressions, rerun full verification, then commit:

```powershell
git add backend/app/db/seed_data README.md docs/data-collection/shidayuan_map_calibration.md
git commit -m "docs: finalize Shidayuan map calibration"
```
