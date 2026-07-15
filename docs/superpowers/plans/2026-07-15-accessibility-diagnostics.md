# Accessibility Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a rule-based accessibility diagnostics endpoint and H5 display panel for campus road segment improvement suggestions.

**Architecture:** Add a pure diagnostics service that consumes road segment dictionaries and returns prioritized suggestions. Add a FastAPI route under `/api/diagnostics/segments`, then render the suggestions in the existing Vue H5 recommendation page.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, pytest, Vue 3, Vite.

## Global Constraints

- Do not add new database tables.
- Do not add third-party dependencies.
- Keep rules deterministic and explainable.
- Keep this version focused on competition demo value.

---

### Task 1: Backend Diagnostics Service And API

**Files:**
- Create: `backend/app/services/accessibility_diagnostics.py`
- Create: `backend/app/schemas/diagnostics.py`
- Create: `backend/app/api/routes/diagnostics.py`
- Modify: `backend/app/api/router.py`
- Test: `backend/tests/test_accessibility_diagnostics.py`
- Test: `backend/tests/test_diagnostics_api.py`

**Interfaces:**
- Consumes: active road segment rows with existing fields such as `step_count`, `has_ramp`, `has_handrail`, `width_m`, `surface_level`, `safety_level`, `barrier_free_level`, `rest_facility_score`, `bench_count`, and `shade_coverage_percent`.
- Produces: `diagnose_segments(segments: list[Mapping[str, Any]], limit: int = 8) -> list[dict[str, Any]]`.

- [x] Write unit tests for step/ramp, narrow width, poor surface, and missing benches.
- [x] Implement the pure diagnostics service.
- [x] Add response schemas.
- [x] Add `/api/diagnostics/segments` route and router registration.
- [x] Add API test with fake DB rows.

### Task 2: Frontend Diagnostics Panel

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `GET /api/diagnostics/segments`.
- Produces: visible "适老化诊断" cards in recommendation mode.

- [x] Add diagnostics state and load it on startup.
- [x] Render top suggestions below the risk/route explanation area.
- [x] Style high/medium/low priority badges.
- [x] Preserve mobile layout.

### Task 3: Documentation, Verification, Commit

**Files:**
- Modify: `docs/助老地图-从0到完成总计划.md`
- Modify: `docs/助老地图-当前进度与剩余任务.md`

**Interfaces:**
- Consumes: completed diagnostics behavior.
- Produces: updated progress and next-task order.

- [x] Mark accessibility diagnostics as complete.
- [x] Run `.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q`.
- [x] Run `npm.cmd run build` in `frontend`.
- [x] Request code review before commit.
- [ ] Commit and push.
