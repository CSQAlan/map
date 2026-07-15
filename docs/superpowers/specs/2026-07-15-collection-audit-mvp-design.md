# Collection Audit MVP Design

**Date:** 2026-07-15
**Project:** Elder-friendly campus map MVP

## Goal

Close the field-data loop: pending collection records can be approved or rejected, and approved records update the official `road_segment` fields used by route recommendations.

## Scope

This slice builds:

- A backend audit endpoint for pending collection records.
- Approval behavior that copies collected accessibility fields into `road_segment`.
- Rejection behavior that keeps `road_segment` unchanged.
- Audit snapshots in `segment_audit_record`.
- H5 buttons in collection mode for approve/reject demo actions.

This slice does not build:

- Real administrator login.
- Detailed audit dashboard.
- Partial-field approval.
- Photo review workflow.

## Data Flow

1. Collector submits a record with `PENDING` status.
2. Reviewer sees it in the collection mode pending list.
3. Reviewer approves or rejects it.
4. Approval updates the matching `road_segment`, changes collection status to `APPROVED`, and writes before/after snapshots.
5. Rejection changes collection status to `REJECTED` and writes an audit record without changing `road_segment`.

## Safety Rules

- Only `PENDING` records can be audited.
- Approval and rejection both happen inside one database transaction.
- `road_segment` is updated only on approval.
- A lightweight system auditor account is created with `ADMIN` role for MVP audit records.

## Future Work

- Add real login and admin-only authorization.
- Add detailed before/after diff UI.
- Add batch approval for trusted collection data.
