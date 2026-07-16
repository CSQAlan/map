# Multi-Strategy Route Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable route recommendation strategies for balanced, safest, flattest, comfortable, and shortest walking routes.

**Architecture:** Keep elder profiles as hard constraints and base preferences. Add a route strategy layer that merges strategy-specific weight overrides into the existing cost function and returns strategy metadata through the route API.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, pytest, Vue 3, Vite.

## Global Constraints

- Do not add new database tables for this feature.
- Keep `BALANCED` as the default strategy.
- Strategy ranking must not bypass elder-profile hard constraints.
- Route candidate response fields must remain backward-compatible.
- Verify with backend pytest and frontend build.

---

### Task 1: Backend Strategy Model

**Files:**
- Modify: `backend/app/services/route_planner.py`
- Test: `backend/tests/test_route_planner.py`

**Interfaces:**
- Consumes: existing `MOBILITY_PROFILES`, `segment_cost`, `route_score`, `dijkstra_path`, `top_k_dijkstra_paths`, and `recommend_routes`.
- Produces: `SUPPORTED_ROUTE_STRATEGIES`, `ROUTE_STRATEGY_METADATA`, `normalize_route_strategy`, strategy-aware cost and ranking functions.

- [ ] **Step 1: Write tests for strategy ranking**

Add tests that call `recommend_routes(..., strategy="SAFEST")` and `recommend_routes(..., strategy="SHORTEST")` against the same graph and assert different first route segment codes.

- [ ] **Step 2: Implement strategy metadata and normalization**

Add supported strategy constants, Chinese labels/descriptions, and `normalize_route_strategy(strategy: str | None) -> str`.

- [ ] **Step 3: Merge strategy weights into segment cost**

Add `strategy_weights_for(mobility_type: str, strategy: str) -> dict[str, float]` and pass strategy into `segment_cost`.

- [ ] **Step 4: Thread strategy through route search**

Update `route_score`, `dijkstra_path`, `top_k_dijkstra_paths`, and `recommend_routes` to accept `strategy="BALANCED"`.

- [ ] **Step 5: Run focused tests**

Run: `.\.conda\elder-map-py311\python.exe -m pytest backend\tests\test_route_planner.py -q`

Expected: all route planner tests pass.

### Task 2: Route API Contract

**Files:**
- Modify: `backend/app/schemas/routes.py`
- Modify: `backend/app/api/routes/routes.py`
- Test: `backend/tests/test_routes_api.py`

**Interfaces:**
- Consumes: `SUPPORTED_ROUTE_STRATEGIES`, `ROUTE_STRATEGY_METADATA`, `recommend_routes`.
- Produces: optional `strategy` query parameter and response fields `strategy`, `strategy_label`, `strategy_description`.

- [ ] **Step 1: Add failing API tests**

Add tests for `strategy=SAFEST` response metadata and `strategy=UNKNOWN` returning `422`.

- [ ] **Step 2: Extend Pydantic response schema**

Add strategy metadata fields to `RouteRecommendResponse`.

- [ ] **Step 3: Validate and pass strategy in route API**

Read `strategy` query param, validate against supported strategies, pass it to planner, and include metadata in the response.

- [ ] **Step 4: Run focused API tests**

Run: `.\.conda\elder-map-py311\python.exe -m pytest backend\tests\test_routes_api.py -q`

Expected: all route API tests pass.

### Task 3: Frontend Strategy Switch

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: route API `strategy` query parameter and response metadata.
- Produces: user-selectable strategy chips in recommendation mode.

- [ ] **Step 1: Add strategy state**

Add `strategyOptions`, `routeStrategy`, and `selectedStrategy` to `App.vue`.

- [ ] **Step 2: Send strategy with route requests**

Include `strategy: routeStrategy.value` in `fetchRoutes()` request params and adjust status copy to mention strategy.

- [ ] **Step 3: Render strategy chips**

Add a strategy switch section under profile selection and show the strategy hint.

- [ ] **Step 4: Add responsive styles**

Add `.strategy-grid`, `.strategy-chip`, and `.strategy-note` styles that match the existing earthy visual system.

- [ ] **Step 5: Build frontend**

Run: `npm.cmd run build` from `frontend`.

Expected: Vite build succeeds.

### Task 4: Docs, Full Verification, Review, Commit

**Files:**
- Modify: `docs/助老地图-当前进度与剩余任务.md`
- Modify: `docs/助老地图-从0到完成总计划.md`

**Interfaces:**
- Consumes: completed backend and frontend changes.
- Produces: updated project status and pushed GitHub commit.

- [ ] **Step 1: Update progress docs**

Mark multi-strategy recommendation complete and update route algorithm completion estimate.

- [ ] **Step 2: Run full backend tests**

Run: `.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q`

Expected: full backend test suite passes.

- [ ] **Step 3: Run frontend build**

Run: `npm.cmd run build` from `frontend`.

Expected: Vite build succeeds.

- [ ] **Step 4: Request code review**

Use the requesting-code-review skill on the final diff and fix important findings.

- [ ] **Step 5: Commit and push**

Run:

```powershell
git add backend frontend docs
git commit -m "feat: add multi-strategy route recommendations"
git push
```

Expected: commit appears on `origin/main`.

## Self-Review

- The plan covers backend strategy scoring, API response, frontend switching, docs, verification, and push.
- No placeholders or deferred implementation items remain.
- Function names and response fields match the design spec.
