# Mobile Collection MVP Design

**Date:** 2026-07-15
**Project:** Elder-friendly campus map MVP
**Pilot Area:** Chongqing Normal University Gate 3 / clinic / canteen walking network

## Goal

Add the first phone-friendly field collection flow so teammates can record road-segment accessibility data from a mobile browser and submit it as pending review data.

## Scope

This slice builds:

- A backend API to list active road segments for collection.
- A backend API to submit one collection record into `segment_collect_record` with `PENDING` status.
- A backend API to list pending collection records for demo/admin visibility.
- A mobile H5 collection mode inside the existing Vue demo.

This slice does not build:

- Real login.
- Collection token or permission control.
- Photo file upload storage.
- Admin approval that overwrites `road_segment`.
- PWA install or Android APK packaging.

## Architecture

The frontend stays a Vue 3 H5 app. A new "采集模式" tab lets collectors choose a route segment, fill core accessibility fields, use browser geolocation when available, and submit the result.

The backend adds a `collect` router. It validates submitted fields with Pydantic, resolves `segment_code` to an active `road_segment`, creates or reuses a limited `COLLECTOR` user, and inserts a pending `segment_collect_record`.

## Data Flow

1. Collector opens the H5 page on a phone.
2. Collector switches to "采集模式".
3. Collector selects an existing `segment_code`.
4. Collector fills scores and optional phone location/remark.
5. Backend writes a pending collection record.
6. Pending records can be viewed through an API and later approved by an admin flow.

## Error Handling

- Unknown segment code returns `404`.
- Invalid scores/ranges return FastAPI validation errors.
- Duplicate pending submissions for the same collector, road segment, and day return the existing pending record instead of inserting again.
- Database failures rollback the transaction.
- Frontend shows a plain Chinese status message.

## Testing

Required checks:

- Segment options API returns active route segments.
- Collection submit API inserts a pending record.
- Unknown segment code is rejected.
- Pending list API returns submitted/pending records.
- Existing route/map tests still pass.
- Frontend production build still passes.

## Future Work

- Add admin approval endpoint that updates `road_segment`.
- Add login, collection token, or local demo switch before real deployment.
- Add offline draft storage for weak campus networks.
- Add image upload and local photo preview.
- Add PWA manifest/service worker.
- Wrap the H5 app with Capacitor for Android APK when the demo flow is stable.
