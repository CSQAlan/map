# Accessibility Diagnostics Design

## Goal

Add a competition-friendly diagnostics feature that turns road segment data into campus accessibility improvement suggestions.

The system should answer: "除了推荐路线，我们还能告诉学校哪些地方应该改造。"

## Scope

- Add `GET /api/diagnostics/segments`.
- Reuse existing `road_segment` fields only.
- Return deterministic rule-based suggestions.
- Show the top suggestions in the H5 demo.
- Do not add database tables, login, admin workflow, or AI-generated text in this version.

## Backend Design

Create a focused service:

```python
diagnose_segments(segments: list[Mapping[str, Any]], limit: int = 8) -> list[dict[str, Any]]
```

Each suggestion contains:

- `segment_code`
- `segment_name`
- `issue_type`
- `priority`: `HIGH`, `MEDIUM`, or `LOW`
- `affected_profiles`
- `problem`
- `suggestion`
- `evidence`

Initial rule set:

- Steps without ramp: recommend adding ramp.
- Steps without handrail: recommend adding handrail.
- Width below 1.2 m: recommend widening or marking assisted passage.
- Surface level below 4: recommend repairing uneven or slippery surface.
- Safety level below 4: recommend lighting/signage/flow separation.
- Rest score below 3 with no benches: recommend adding rest seats.
- Shade below 20%: recommend adding shade or rest point.
- Barrier-free level below 4: recommend barrier-free renovation.

Suggestions are sorted by priority first, then by number of affected profiles.

## API Design

`GET /api/diagnostics/segments` returns:

```json
{
  "total_segments": 11,
  "suggestions": []
}
```

If there are no suggestions, return `suggestions: []` instead of an error.

## Frontend Design

The H5 demo adds a compact "适老化诊断" panel in recommendation mode. It loads once on startup and can render even before users generate a route.

## Testing

- Unit-test each high-value diagnosis category.
- API-test that the endpoint returns deterministic suggestions.
- Run backend tests and frontend build.
