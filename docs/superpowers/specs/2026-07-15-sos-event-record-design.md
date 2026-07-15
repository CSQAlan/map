# SOS Event Record Design

## Goal

Upgrade the elder-mode SOS button from a frontend-only simulation to a backend-recorded emergency event that can be demonstrated and queried.

## Scope

- Add `POST /api/emergency/sos`.
- Add `GET /api/emergency/events`.
- Reuse the existing `emergency_event` table.
- Auto-create a demo elder user because the MVP has no login system yet.
- Do not send real SMS, phone calls, police alerts, or push notifications.

## Backend Design

`POST /api/emergency/sos` accepts optional demo context:

- `elder_name`
- `mobility_type`
- `route_summary`
- `current_step`
- `location_lat`
- `location_lon`

The API stores:

- `event_type = SOS`
- `event_status = OPEN`
- `user_id = demo_elder`
- optional `trigger_point`
- a concise text `description`
- simulated `notified_contacts`

`GET /api/emergency/events` returns recent events for demo verification.

## Frontend Design

The elder mode `紧急求助` button will call the backend. On success, it shows a message containing the event id and simulated notified contact count.

If the backend is unavailable, the UI keeps a clear failure message and does not pretend the SOS was sent.

## Testing

- API-test successful SOS insert.
- API-test optional location handling.
- API-test recent event listing.
- Run full backend tests and frontend build.
