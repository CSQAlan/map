# Multi-Strategy Route Recommendations Design

## Goal

Add route recommendation strategies so the same elder profile can switch between balanced, safest, flattest, most comfortable, and shortest walking routes.

## Scope

This feature changes algorithm weights and UI controls only. It does not add database tables or persist user preferences yet.

## Supported Strategies

- `BALANCED`: current elder-friendly route score, used as the default.
- `SAFEST`: prioritizes safety level, crossing safety, lighting, barrier-free level, and low-risk surfaces.
- `FLATTEST`: prioritizes low slope, ramps, low step count, and sufficient width.
- `COMFORT`: prioritizes rest facilities, benches, shade, handrails, and smooth surfaces.
- `SHORTEST`: prioritizes route distance while still respecting elder-profile hard constraints.

## Backend Design

`GET /api/routes/recommend` accepts an optional `strategy` query parameter. Missing values default to `BALANCED`; unsupported values return `422`.

The route planner keeps elder profiles as the hard safety layer. A wheelchair profile still rejects steps without ramps, narrow roads, and low barrier-free segments no matter which strategy is selected. Strategy weights only change ranking among allowed candidate paths.

The planner exposes:

- `SUPPORTED_ROUTE_STRATEGIES`
- `ROUTE_STRATEGY_METADATA`
- `normalize_route_strategy(strategy: str | None) -> str`
- `segment_cost(segment, mobility_type, strategy="BALANCED")`
- `route_score(segments, mobility_type, strategy="BALANCED")`
- `recommend_routes(..., strategy="BALANCED")`

The API response adds:

- `strategy`
- `strategy_label`
- `strategy_description`

Route candidate shape stays backward-compatible.

## Frontend Design

The recommendation form adds a route strategy switch below elder profile selection. Users can tap strategy cards to change recommendation style before generating a route.

The request sends `strategy` with `start_name`, `end_name`, and `mobility_type`. Result cards show the selected strategy label so the demo clearly communicates why ranking changed.

## Testing

Backend tests cover:

- Default strategy remains compatible.
- Unknown strategy returns `422`.
- `SAFEST` can prefer a safer route over a shorter risky route.
- `SHORTEST` can prefer the shorter route when hard constraints allow it.
- Response includes strategy metadata.

Frontend verification uses `npm run build`.

## Non-Goals

- No custom user-defined weight editor.
- No new route strategy database table.
- No real map-provider change.
- No persistence of selected strategy across sessions.

## Self-Review

- No placeholders remain.
- Strategy layer does not weaken profile hard constraints.
- API changes are additive and keep existing route candidate fields.
- Scope is limited to one implementable feature.
