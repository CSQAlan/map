# Elder H5 Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vue 3 + Vite single-page H5 demo for the elder-map MVP, with switchable recommendation mode and elder mode backed by the existing route recommendation API.

**Architecture:** The frontend is a small standalone Vite app under `frontend/`. It calls the FastAPI backend through `VITE_API_BASE_URL`, renders route candidates as cards and a simplified flow line, and keeps start-navigation/SOS as local UI state for the first demo. The backend only needs CORS enabled for local Vite development.

**Tech Stack:** Vue 3, Vite, native CSS, FastAPI, existing `/api/routes/recommend` endpoint.

## Global Constraints

- Pilot scope is Chongqing Normal University only.
- First route options are Gate 3 to School Clinic or Gate 3 to Canteen.
- First frontend version does not use a real map SDK or basemap.
- Frontend must provide two modes: recommendation mode and elder mode.
- Elder mode must use larger text, obvious buttons, and lower interaction complexity.
- Navigation and SOS are frontend-only state feedback in this version.
- Backend route API path is `GET /api/routes/recommend`.

---

## File Structure

- Create `frontend/package.json`: declares Vue/Vite scripts and dependencies.
- Create `frontend/vite.config.js`: enables Vue single-file component support.
- Create `frontend/index.html`: Vite HTML entrypoint.
- Create `frontend/src/main.js`: mounts the Vue app.
- Create `frontend/src/App.vue`: owns page state, API calls, route selection, and mode switching.
- Create `frontend/src/styles.css`: mobile-first visual system, route cards, mode-specific layouts, and responsive rules.
- Modify `backend/app/main.py`: enables CORS for local frontend development.

---

### Task 1: Enable Local Frontend Access To Backend

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Consumes: FastAPI `app` instance.
- Produces: CORS-enabled backend that accepts requests from `http://localhost:5173` and `http://127.0.0.1:5173`.

- [ ] **Step 1: Update backend CORS middleware**

Add `CORSMiddleware` after app creation and before router inclusion:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    debug=settings.app_debug,
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api")
```

- [ ] **Step 2: Run backend tests**

Run:

```powershell
F:\items\map\.conda\elder-map-py311\python.exe -m pytest backend\tests -q
```

Expected: all backend tests pass.

---

### Task 2: Scaffold Vue 3 + Vite Frontend

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.js`
- Create: `frontend/src/styles.css`

**Interfaces:**
- Consumes: no project-local frontend files.
- Produces: `npm.cmd run dev` and `npm.cmd run build` scripts under `frontend/`.

- [ ] **Step 1: Create package metadata**

Create `frontend/package.json`:

```json
{
  "name": "elder-map-h5-demo",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "vite build",
    "preview": "vite preview --host 127.0.0.1 --port 4173"
  },
  "dependencies": {
    "@vitejs/plugin-vue": "latest",
    "vite": "latest",
    "vue": "latest"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Create Vite config**

Create `frontend/vite.config.js`:

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});
```

- [ ] **Step 3: Create HTML entrypoint**

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>助老地图 H5 演示</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Create Vue mount file**

Create `frontend/src/main.js`:

```js
import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

createApp(App).mount('#app');
```

- [ ] **Step 5: Create base stylesheet**

Create `frontend/src/styles.css` with CSS variables, body reset, and responsive shell classes used by `App.vue`.

- [ ] **Step 6: Install dependencies**

Run:

```powershell
cd frontend
npm.cmd install
```

Expected: `node_modules/` and `package-lock.json` are created.

---

### Task 3: Build Recommendation Mode

**Files:**
- Create: `frontend/src/App.vue`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `GET ${apiBaseUrl}/api/routes/recommend?start_name=...&end_name=...&mobility_type=...`
- Produces: route candidate list with selected route state.

- [ ] **Step 1: Implement route state and API call**

In `frontend/src/App.vue`, define these data constants and refs:

```js
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';
const startOptions = [{ label: '重庆师范大学三号门', value: '重庆师范大学三号门' }];
const endOptions = [
  { label: '校医院', value: '重庆师范大学校医院' },
  { label: '食堂', value: '重庆师范大学食堂' },
];
const profileOptions = [
  { label: '独立出行型', value: 'INDEPENDENT', hint: '可接受普通步行路线' },
  { label: '轻度辅助型', value: 'ASSISTED', hint: '优先平缓、安全、有休息点' },
  { label: '家属协同型', value: 'FAMILY_ASSISTED', hint: '兼顾陪同和安全提示' },
];
```

The `fetchRoutes()` function must set loading state, call the backend, select the first route by default, and show readable errors.

- [ ] **Step 2: Render recommendation controls**

Render profile chips, endpoint selection, and a primary button labelled `生成适老路线`.

- [ ] **Step 3: Render route candidates**

Each route card must show:

```text
推荐路线 N
score
distance_m
estimated_minutes
summary
segment_ids as a simple flow line
```

- [ ] **Step 4: Route selection behavior**

Clicking a card sets `selectedRouteIndex` and updates elder mode immediately.

---

### Task 4: Build Elder Mode

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: selected route from Task 3.
- Produces: elder-oriented mode with large actions and local navigation/SOS feedback.

- [ ] **Step 1: Add mode switch**

Add a two-option segmented control:

```text
推荐模式
老人模式
```

The active mode controls whether the page shows detailed controls or simplified elder view.

- [ ] **Step 2: Render selected route summary in elder mode**

Show destination, route summary, estimated minutes, distance, and a large next-step instruction derived from the first segment id:

```js
const nextStepText = computed(() => {
  const firstSegment = selectedRoute.value?.segments?.[0];
  if (!firstSegment) return '请先生成一条路线';
  return `先沿 ${firstSegment.segment_id} 方向前进，注意观察路面提示。`;
});
```

- [ ] **Step 3: Add local action feedback**

Buttons:

```text
开始导航
重新推荐
紧急求助
```

Expected behavior:
- `开始导航` sets status to `导航已开始，请按下一步提示慢行。`
- `重新推荐` switches back to recommendation mode and calls `fetchRoutes()`.
- `紧急求助` sets status to `已模拟发送求助信息，演示版暂不连接真实告警。`

- [ ] **Step 4: Style elder mode**

Use large type, big touch targets, high contrast, and obvious spacing.

---

### Task 5: Verify End-To-End Demo

**Files:**
- Test runtime only.

**Interfaces:**
- Consumes: backend API, PostGIS seed data, Vue frontend.
- Produces: verified local demo flow.

- [ ] **Step 1: Ensure backend database is seeded**

Run:

```powershell
F:\items\map\.conda\elder-map-py311\python.exe -m backend.app.scripts.init_map_data
```

Expected output includes:

```text
'pois': 3
'nodes': 8
'segments': 11
```

- [ ] **Step 2: Build frontend**

Run:

```powershell
cd frontend
npm.cmd run build
```

Expected: Vite build succeeds and `frontend/dist/` is created.

- [ ] **Step 3: Run backend test suite**

Run:

```powershell
F:\items\map\.conda\elder-map-py311\python.exe -m pytest backend\tests -q
```

Expected: all backend tests pass.

- [ ] **Step 4: Smoke-test route API**

Run a GET request for Gate 3 to Canteen with `ASSISTED`.

Expected:
- HTTP 200
- response contains `routes`
- response has up to 3 candidate routes

- [ ] **Step 5: Start demo servers**

Run backend:

```powershell
$env:PYTHONPATH='F:\items\map\backend'
F:\items\map\.conda\elder-map-py311\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Run frontend:

```powershell
cd frontend
npm.cmd run dev
```

Expected:
- backend available at `http://127.0.0.1:8000`
- frontend available at `http://127.0.0.1:5173`
- frontend can generate candidate routes and switch into elder mode.

---

## Self-Review

- Spec coverage: route recommendation mode, elder mode, fixed pilot points, no real map, backend API, loading/error states, and build verification are covered.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation step remains.
- Type consistency: `start_name`, `end_name`, `mobility_type`, route `segments`, `distance_m`, `estimated_minutes`, and `summary` match the current backend route API contract.
