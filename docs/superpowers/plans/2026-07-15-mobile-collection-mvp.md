# Mobile Collection MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-friendly collection flow that lets field teammates submit road-segment accessibility data from the H5 app.

**Architecture:** Add a focused backend `collect` router and schemas, reuse the existing `segment_collect_record` table and collector-user helper, then add a third Vue tab for mobile collection. Keep approval and APP packaging out of this slice.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0, PostgreSQL/PostGIS, Vue 3, Vite, native CSS, pytest

## Global Constraints

- Submitted collection data must be stored as `PENDING`.
- Collectors must use `COLLECTOR` role, not `ADMIN`.
- The frontend must remain usable as H5 in a mobile browser.
- This slice must not update `road_segment` directly.
- Photo upload and APP packaging are documented as future work, not implemented here.

---

## Tasks

- [x] Create `backend/app/schemas/collect.py` with request and response models.
- [x] Create `backend/app/api/routes/collect.py` with segment option, submit, and pending-list endpoints.
- [x] Register the collect router in `backend/app/api/router.py`.
- [x] Add backend tests in `backend/tests/test_collect_api.py`.
- [x] Add mobile collection state, methods, and template to `frontend/src/App.vue`.
- [x] Add responsive collection styles to `frontend/src/styles.css`.
- [x] Update project roadmap/progress docs.
- [x] Run backend tests and frontend build.

## Validation Commands

```powershell
.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q
cd frontend
npm.cmd run build
```

## Self-Review

- The feature has a clear API boundary.
- The mobile collection page reuses the existing H5 app instead of introducing a new frontend stack.
- Approval, real photo upload, PWA install, and APP packaging remain future slices.
