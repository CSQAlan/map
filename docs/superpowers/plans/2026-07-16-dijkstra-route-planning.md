# Dijkstra Route Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade route recommendation from DFS enumeration to Dijkstra-based least-cost route search while keeping API/frontend compatibility.

**Architecture:** Add Dijkstra helpers inside `backend/app/services/route_planner.py` using existing `segment_cost` and `is_segment_allowed`. `recommend_routes` will call the new Top-K Dijkstra function and then reuse the existing response-building logic.

**Tech Stack:** Python 3.11, FastAPI service code, pytest.

## Global Constraints

- Do not change database schema.
- Do not change `/api/routes/recommend` response shape.
- Do not add third-party dependencies.
- Keep Top-K generation deterministic for demo repeatability.

---

### Task 1: Dijkstra Core

**Files:**
- Modify: `backend/app/services/route_planner.py`
- Test: `backend/tests/test_route_planner.py`

**Interfaces:**
- Consumes: `segment_cost(segment, mobility_type)` and `is_segment_allowed(segment, mobility_type)`.
- Produces: `dijkstra_path(segments, start_node_code, end_node_code, mobility_type, blocked_edges=None, blocked_nodes=None) -> list[Mapping[str, Any]]`.

- [x] Add tests for selecting lower-cost route and for blocked-edge alternative route.
- [x] Implement graph builder and `dijkstra_path` using `heapq`.
- [x] Preserve deterministic ordering by sorting edges by segment code.

### Task 2: Top-K Candidate Generation

**Files:**
- Modify: `backend/app/services/route_planner.py`
- Test: `backend/tests/test_route_planner.py`

**Interfaces:**
- Consumes: `dijkstra_path`.
- Produces: `top_k_dijkstra_paths(segments, start_node_code, end_node_code, mobility_type, limit=3) -> list[list[Mapping[str, Any]]]`.

- [x] Add tests that multiple candidate paths are returned and sorted by score.
- [x] Implement Yen-style spur path generation.
- [x] Deduplicate candidates by tuple of segment codes.
- [x] Keep DFS `enumerate_paths` for existing unit coverage but stop using it in `recommend_routes`.

### Task 3: Documentation, Verification, Review, Commit

**Files:**
- Modify: `docs/助老地图-从0到完成总计划.md`
- Modify: `docs/助老地图-当前进度与剩余任务.md`
- Modify: `docs/superpowers/plans/2026-07-16-dijkstra-route-planning.md`

**Interfaces:**
- Consumes: completed Dijkstra behavior.
- Produces: updated progress and next-task order.

- [x] Mark Dijkstra replacement as complete.
- [x] Run `.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q`.
- [x] Run `npm.cmd run build` in `frontend`.
- [x] Request code review before commit.
- [ ] Commit and push.
