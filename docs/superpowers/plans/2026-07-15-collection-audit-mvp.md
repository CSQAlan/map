# Collection Audit MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal audit flow that approves or rejects pending collection records and updates official route-segment data on approval.

**Architecture:** Extend the existing collect router and schemas. Keep audit logic transactional in the backend and add simple H5 approve/reject controls to the existing collection mode.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0, PostgreSQL/PostGIS, Vue 3, Vite, pytest

## Global Constraints

- Only `PENDING` collection records can be audited.
- Approval updates `road_segment`; rejection does not.
- Every audit writes `segment_audit_record`.
- This remains a local/demo flow without real admin login.

---

## Tasks

- [x] Add audit request/response schemas.
- [x] Add backend audit endpoint under `/api/collect/segments/{record_id}/audit`.
- [x] Insert audit snapshots into `segment_audit_record`.
- [x] Update pending-list response with enough fields for review.
- [x] Add backend tests for approve, reject, and non-pending records.
- [x] Add approve/reject buttons in the H5 collection mode.
- [x] Run backend tests and frontend build.
