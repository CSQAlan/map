# Avoided Segments Explanation Design

## Goal

Expose why the route planner avoids or warns about specific road segments for each elder mobility profile, so the demo can explain not only "which route is recommended" but also "which segments are blocked or need extra attention".

## Scope

- Add a top-level `avoided_segments` field to `GET /api/routes/recommend`.
- Keep route ranking and path enumeration unchanged.
- Keep the first version rule-based and deterministic.
- Show the explanation in the H5 recommendation page.

## Backend Design

`app.services.route_planner` will add a pure function:

```python
explain_avoided_segments(segments, mobility_type, limit=8) -> list[dict]
```

Each item contains:

- `segment_code`
- `name`
- `avoidance_level`: `BLOCKED` or `HIGH_RISK`
- `reasons`: human-readable reasons

`BLOCKED` is used when the segment fails the current profile's hard constraints, such as slope, width, barrier-free level, steps without ramp, or wheelchair accessibility.

`HIGH_RISK` is used when a segment is still passable but notably unfriendly for the selected profile, such as steps for cane users, low rest score for slow walkers, or low surface/safety score.

## Frontend Design

The H5 recommendation mode will read `payload.avoided_segments` and render a compact panel named "不可通行与需注意路段". The panel appears after route calculation when the API returns items, including 404 no-route responses that still contain diagnostic reasons.

## Testing

- Unit-test route planner explanations for wheelchair blocked segments and cane high-risk segments.
- API-test that `/api/routes/recommend` includes `avoided_segments`.
- Run the existing backend test suite and frontend production build.
