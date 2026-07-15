# Avoided Segments Explanation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add route recommendation explanations for road segments that are blocked or high-risk for the selected elder profile.

**Architecture:** Keep the logic inside the existing route planner service as pure functions. The API loads active road segments once, uses the same list for route recommendation and explanation, then the Vue page renders the new field as a read-only explanation panel.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, pytest, Vue 3, Vite.

## Global Constraints

- Do not change the route ranking algorithm in this task.
- Do not add new third-party dependencies.
- Keep explanations deterministic and easy to show in a competition demo.

---

### Task 1: Backend Explanation Model

**Files:**
- Modify: `backend/app/services/route_planner.py`
- Modify: `backend/app/schemas/routes.py`
- Modify: `backend/app/api/routes/routes.py`
- Test: `backend/tests/test_route_planner.py`
- Test: `backend/tests/test_routes_api.py`

**Interfaces:**
- Consumes: existing `MOBILITY_PROFILES`, `is_segment_allowed`, and segment dictionaries loaded from DB.
- Produces: `explain_avoided_segments(segments, mobility_type, limit=8) -> list[dict[str, Any]]` and response field `avoided_segments`.

- [x] Write unit tests for blocked wheelchair segments and cane high-risk segments.
- [x] Implement `segment_avoidance_reasons` and `explain_avoided_segments`.
- [x] Add Pydantic response model `AvoidedSegmentResponse`.
- [x] Return `avoided_segments` from `/api/routes/recommend`.
- [x] Run `.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q`.

### Task 2: Frontend Explanation Panel

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `payload.avoided_segments`.
- Produces: visible "系统避开的风险路段" panel in recommendation mode.

- [x] Add `avoidedSegments` state and update it in `fetchRoutes`.
- [x] Render blocked/high-risk segment cards below the map and above route cards.
- [x] Add responsive styles.
- [x] Run `npm.cmd run build` in `frontend`.

### Task 3: Progress Documentation

**Files:**
- Modify: `docs/助老地图-从0到完成总计划.md`
- Modify: `docs/助老地图-当前进度与剩余任务.md`

**Interfaces:**
- Consumes: completed feature behavior.
- Produces: updated project status and next-step order.

- [x] Mark unavailable/avoided segment explanations as complete.
- [x] Keep Dijkstra, multi-strategy routes, diagnosis suggestions, and SOS as future work.
- [ ] Commit and push the completed slice.
