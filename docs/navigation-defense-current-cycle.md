# Current-cycle navigation rehearsal

From `frontend`, with the existing dependencies and local Chrome:

```powershell
node scripts/rehearse-navigation-defense.mjs --recent
```

Valid forms are no arguments, `--recent` alone, `-h` alone or `--help` alone.
Combinations, duplicates and child options are rejected with exit 2 before any
precheck or suite launch. No arguments preserves all 12 original browser groups,
followed by the original read-only seed audit (13 groups total). `--recent` runs
exactly these four independent browser groups, with no seed audit:

| Order | Child command (from `frontend`) | Local evidence |
| --- | --- | --- |
| 1 | `node scripts/check-predeparture-first-leg-photo.mjs --no-artifacts` | Real App; two 100 m synthetic legs; API and image pixels mocked. |
| 2 | `node scripts/check-navigation-manual-recovery.mjs --no-artifacts` | Real NavigationPage in the existing three-leg, 100 m-per-leg fixture; AMap SDK mock and SVG fallback. |
| 3 | `node scripts/check-navigation-undo-manual-confirm.mjs --no-artifacts` | Real App and receipt state; three 120 m synthetic legs; HTTP mocked. |
| 4 | `node scripts/check-navigation-arrival.mjs --no-artifacts` | Separate real-App fixture with three 120 m synthetic legs; API mocked. |

All four invocations are supported: photo and arrival suppress their optional
screenshots; recovery always saves nothing and accepts the extra argument; undo
saves only with its explicit `--artifacts`, which the launcher never forwards.
Each script binds an ephemeral loopback Vite server, intercepts/blocks nonlocal
browser traffic and replaces device/provider services. Elder roles are in-memory
mock identities; navigation writes are intercepted. No backend, real account,
original media, external API, upload, install or deployment is involved.

The launcher strips inherited `VITE_*` overrides, uses Chrome, runs sequentially,
keeps the existing 120-second per-child limit and owned-child-tree cleanup, and
stops on the first failure. There is no automatic retry. Exit 0 means every
selected group exited 0; invalid usage is 2, precheck failure is 1, timeout is
124, SIGINT is 130 and SIGTERM is 143; other child failures retain their nonzero
exit code. Existing screenshots and recordings are untouched.

“Verified” here means local query provenance and registration/photo matching.
Synthetic pixels do not verify a field photograph, current road conditions,
direction, entrance, user position or an actually walked route. Manual step,
distinct confirmed-segment count and personal arrival choice are independent;
the receipt is neither realtime arrival proof nor family verification. The
default seed audit checks repository registrations, not a real trip. Neither
mode certifies physical phones, GPS, audible speech or accessibility.

For a short recording, use four labelled cuts (about 12 seconds each):

1. **Photo, two-leg App fixture:** explicitly open the first-leg image and read
   the registration caveat. Identify the pixels as synthetic.
2. **Recovery, component fixture:** open “我不确定走到哪”, show the registered
   current-segment map/text choices, then close; no actual position is inferred.
3. **Undo, fresh three-leg App fixture:** confirm once (step 2, 1/3), then
   immediately undo (step 1, 0/3). Opening recovery expires the undo opportunity.
4. **Receipt, separate three-leg App fixture:** confirm one segment, end and
   explicitly choose arrived or unconfirmed; show 1/3 and the return entry.

Counts and state do not carry across scripts. `--recent` is headless, closes its
browsers and records nothing; this order is a storyboard, not a continuous demo.
Only the photo check exposes an interactive `--demo`; the other checks auto-drive
their fixtures. Manual footage for those clips needs a separately prepared local
mock fixture. See the existing [photo](predeparture-first-leg-photo-demo.md),
[recovery](navigation-manual-recovery-demo.md),
[undo](navigation-undo-manual-confirm-demo.md) and
[receipt](navigation-arrival-receipt-demo.md) notes for individual scenarios.

Local validation on 2026-11-27: help exit 0; invalid `--recent --help` exit 2
without precheck or suite launch; `--recent` exit 0 (4/4 children exit 0); default
exit 0 (13/13 groups, including the original two seed tests). No screenshots or
recordings were saved. Vite refreshed its existing
`frontend/node_modules/.vite/deps/_metadata.json` runtime cache during validation.
