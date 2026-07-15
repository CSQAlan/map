# SOS Event Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record elder-mode SOS actions into the existing `emergency_event` table and show the recorded event id in the H5 demo.

**Architecture:** Add Pydantic schemas and a FastAPI emergency route. The route auto-ensures a `demo_elder` user, inserts an `SOS` event, and returns a compact response. The Vue elder mode calls this API from the existing SOS button.

**Tech Stack:** Python 3.11, FastAPI, PostgreSQL/PostGIS, Pydantic, pytest, Vue 3, Vite.

## Global Constraints

- Do not send real emergency notifications.
- Do not add login or account management in this task.
- Do not add new database tables.
- Keep the feature demo-safe and clearly labeled as simulated notification.

---

### Task 1: Backend SOS API

**Files:**
- Create: `backend/app/schemas/emergency.py`
- Create: `backend/app/api/routes/emergency.py`
- Modify: `backend/app/api/router.py`
- Test: `backend/tests/test_emergency_api.py`

**Interfaces:**
- Consumes: existing `emergency_event` and `app_user` tables.
- Produces: `POST /api/emergency/sos` and `GET /api/emergency/events`.

- [x] Add `SosEventCreateRequest`, `SosEventResponse`, and `EmergencyEventListItemResponse`.
- [x] Add helper `ensure_demo_elder_user(db) -> int`.
- [x] Add helper `build_sos_description(payload) -> str`.
- [x] Insert SOS events with optional PostGIS point when longitude and latitude are provided.
- [x] Add recent event list query with `limit` bounded to `1..50`.
- [x] Add API tests for create, create with location, list, and invalid location.

### Task 2: Frontend SOS Integration

**Files:**
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `POST /api/emergency/sos`.
- Produces: user-facing event id/status after clicking `紧急求助`.

- [x] Add `sosSubmitting` state.
- [x] Convert `sendSos` to async POST.
- [x] Send elder profile, route summary, next step, and destination context.
- [x] Disable the SOS button while submitting.
- [x] Show backend failure honestly if the request fails.

### Task 3: Documentation, Verification, Commit

**Files:**
- Modify: `docs/助老地图-从0到完成总计划.md`
- Modify: `docs/助老地图-当前进度与剩余任务.md`

**Interfaces:**
- Consumes: completed SOS behavior.
- Produces: updated project progress and next task order.

- [x] Mark SOS backend record as complete.
- [x] Run `.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q`.
- [x] Run `npm.cmd run build` in `frontend`.
- [x] Request code review before commit.
- [ ] Commit and push.
