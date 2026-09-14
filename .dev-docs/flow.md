# flow.md — how the system actually works

As-built code flow, traced from the source. Companion to `decision.md` (which records *why* each choice was
made); this file records *what the code does*, so a change can be reasoned about without re-tracing it.

**Legibility convention:** sections marked ✅ were traced against the running system in this repo (code plus a
live API/browser check). Sections marked ⚠️ are mapped by route/status only — the internals have not been
traced yet. Do not treat ⚠️ as authoritative; verify before relying on it.

Last traced: **2026-09-14** (release v2.5.2).

---

## 1. Runtime topology ✅

| | Dev machine | Client PC |
|---|---|---|
| API | `smtverify-api` systemd → `/usr/bin/node dist/index.mjs` on **:3000** | `smt-verification` systemd, **:4000** |
| Frontend | `smtverify-frontend` = **Vite dev** on **:5173**, proxies `/api` → :3000 | built `dist/`, served by the same service |
| DB | Postgres `smtverification` | Postgres `smtverification` |

**Dev gotcha that has cost real time:** the API runs a **prebuilt** `dist/index.mjs` and `systemctl restart`
does *not* rebuild it. Server-side source edits are invisible until
`pnpm --filter @workspace/api-server run build && systemctl restart smtverify-api`. Vite serves frontend source
live, so client edits only need a browser reload. Never conclude "the fix doesn't work" from the dev server
before rebuilding.

## 2. Auth ✅

- Login `POST /api/auth/login` `{username, password, role}` → JWT in the **`smt_token`** cookie
  (`smt_refresh` for refresh). `getAuthActorFromCookie` (`routes/auth.ts:183`) → `verifyAccessToken`
  (`lib/authTokens.ts:72`), which requires a string `userId`, non-empty `username` and `jti`, and one of
  operator/qa/supervisor/admin/storekeeper.
- **`getJwtSecret()` throws if `JWT_SECRET` < 32 chars** (`lib/authTokens.ts:25`) — a short secret makes every
  request 401. This silently breaks hand-signed test tokens.
- Every mutating request needs `X-Requested-With: XMLHttpRequest` (`middleware/csrf.ts`), else 403
  `csrf_header_missing`.
- Roles: `requireRole(...)` (`middleware/auth.ts:93`). `requireLegacySessionOwnership`
  (`routes/sessions.ts:34`) lets qa/supervisor/admin through and otherwise requires an accepted
  `changeover_operators` row — which is why tests use a QA token.
- `must_change_password` → every protected route answers **423** until rotated (exempt:
  `/auth/change-password`, `/auth/logout`).

## 3. Changeover state machine ✅

The backbone. `sessions.status`; the only legal values are listed at `routes/sessions.ts:1485`.

```
                  POST /api/sessions
                          │
                          ▼
                      ┌────────┐   all distinct BOM feeders scanned   ┌────────────┐
                      │ active │ ───────────────────────────────────▶│ pending_qa │
                      └────────┘   (auto, sessions.ts:1832)          └────────────┘
                          │           or POST /sessions/:id/submit-qa        │
                          │                                                  │ POST .../lock (QA opens it)
                          │                                                  ▼
                          │                                           ┌─────────────┐
                          │                                           │ qa_in_review│
                          │                                           └─────────────┘
                          │                                                  │ POST .../unlock (back to pending_qa)
                          │                                                  │ POST .../manual-confirm
                          │                                                  ▼
                          │                                            ┌─────────────┐
                          │                                            │ qa_confirmed│
                          │                                            └─────────────┘
                          │                                                  │  unlocks the Splicing tab
                          │                                                  │  (client: qa_confirmed || active_splicing)
                          │                                                  ▼
                          │  POST /sessions/:id/splices ─────────────▶ ┌────────────────┐
                          │  (first splice sets active_splicing)       │ active_splicing│
                          │                                            └────────────────┘
                          │                                                  │ POST /sessions/:id/submit-splicing-qa
                          │                                                  ▼
                          │                                          ┌────────────────────┐
                          │                                          │ splicing_pending_qa│
                          │                                          └────────────────────┘
                          └────────── PATCH /sessions/:id {status} ──▶ completed | cancelled | incomplete
```

Key consequences:

- **`pending_qa` is the loading→QA handoff.** The server sets it automatically once
  `count(distinct scanned feeders) >= count(distinct BOM feeders)`, both filtered to live rows
  (`sessions.ts:1810-1846`, repeated after-save at ~2140). A **failed** scan never counts; only `status='ok'`.
- **Single active changeover is PER LOGIN.** `findBlockingSession(actor.id)` blocks a new session while the
  caller owns one in `active` → `active_splicing`. **The unlock point is `splicing_pending_qa`** — submitting
  splicing to QA frees that login to start the next changeover while QA reviews.
- `qa_confirmed` / `active_splicing` / `splicing_pending_qa` all count as "loading complete" for the client's
  progress, so the splicing tab never re-disables mid-work.

## 4. Session creation ✅

`NewSession.tsx` → `POST /api/sessions`. Three shapes, discriminated by `bomId` and
`bomVerificationSkipped`:

| Mode | `bomId` | Behaviour |
|---|---|---|
| BOM verification | real id | Full MPN validation against the BOM |
| **Free Scan** | `0` → stored `NULL` | No BOM; every scan captured unvalidated (`isFreeScan = !!session && !bomId`) |
| **Trial Session** | real id + `bomVerificationSkipped` | Feeder must exist in the BOM, **any MPN accepted** (`sessions.ts:1955`). Supervisor-only |

- `verificationMode` is chosen here: `AUTO` or `AUTO_LEGACY` (`sessions.ts:1013`). `MANUAL` was removed from
  the UI; the code still accepts it in places.
- Refused if the BOM is not `active` (locked/held → 409), or if the caller already owns a blocking session
  (409 with `blockingSession`).
- Server resolves and stores `users.name` as `operator_name` (does not trust the body).

## 5. Loading verification ✅

Client state machine in `feeder/pages/ActiveSession.tsx`; `scanStep` ∈ `feeder` → `spool` (MPN) → `lot`.

**`AUTO`** — operator scans the **feeder barcode**, then the MPN, then lot. Auto-submit.
Client candidates: `buildCandidates(bomItem)` — mpn1..8 + the internal part number and its tokens
(`utils/mpnUtils.ts`).

**`AUTO_LEGACY`** — the operator **never scans a feeder**. An effect (`ActiveSession.tsx:494-505`) auto-locks
the next un-verified feeder and jumps straight to the MPN step. After a successful scan the flow resets to
`scanStep="feeder"` with an empty `pendingFeeder`, and the effect re-fires for the next one.

Two things here have already caused a shipped failure — do not regress them:

1. **Serial order.** The lock order IS the order of `verificationBomEntries`, built by grouping
   `bomDetail.items`. It is sorted client-side by `compareBomOrder` (`utils/bomOrder.ts`) and comes from the
   server already ordered by `GET /api/bom/:id` (`bom.ts:320-325`): numeric `sr_no`, then a numeric-aware
   `feeder_number` fallback for unsequenced BOMs, then id.
2. **Never lock a feeder the BOM lacks.** The verification store's `bomEntries` *starts* as the bundled sample
   BOM (`store/useVerificationStore.ts:191`), and the auto-lock effect runs before the effect that replaces it
   with the real BOM. Locking a sample feeder stranded the changeover permanently. `pickNextLegacyFeeder()`
   therefore only accepts a feeder present in the loaded BOM.

Server side (`POST /api/sessions/:id/scans`, `sessions.ts:1790`):
- `verifyMPN(scanned, row)` compares against `internal_part_number` (whole value **and** whitespace/slash
  tokens) then mpn1..8, exact match after normalisation (`N/A`, `NA`, `-`, `NONE` all normalise to empty).
- **Every row sharing the feeder number is checked** when the request names no `selectedItemId`; an explicit
  `selectedItemId` (the AUTO alternate picker) restricts validation to that row. The matched row is what gets
  recorded, so an accepted alternate is not attributed to the primary row.
- Duplicate feeder scan → 400 `isDuplicate`; a unique violation is absorbed as an idempotent retry.
- Rate limited: `scanLimiter`, 60/min/IP.

**Traceability gap (known, unfixed):** AUTO_LEGACY scans are stored with `verification_mode='AUTO'` — the
client hardcodes it (`ActiveSession.tsx:1266`) and the server collapses anything non-MANUAL to `AUTO`
(`sessions.ts:1833`). Only the session row distinguishes the modes.

## 6. QA confirmation of loading ⚠️

`/feeder/qa-queue` → `routes/verification.ts`:

| Route | Effect |
|---|---|
| `GET /verification/qa-queue` | the queue (lists `pending_qa` / `qa_in_review` / `qa_confirmed`) |
| `POST /verification/qa-queue/:id/lock` | **`pending_qa` → `qa_in_review`** — QA takes the session |
| `POST /verification/qa-queue/:id/unlock` | **`qa_in_review` → `pending_qa`** — returns it (other statuses pass through unchanged) |
| `POST /verification/qa-queue/:id/manual-confirm` | → `qa_confirmed`, stamps `qaName` |
| `POST /verification/qa-queue/:id/rescan` | QA-ordered re-scan |
| `POST /verification/qa-queue/:id/complete` | → `completed` |
| `POST /verification/qa-queue/:id/discrepancy` | QA rejection path |
| `POST /verification/sessions/:id/mark-incomplete` | → `incomplete` |

So **`qa_in_review` is not a dead status**: it is the "QA has this session open" lock (`verification.ts:1661`,
`:1704`; reverted at `:1753`, `:1775`). It matters for the operator's client, which polls on
`qa_in_review` too.

The client **polls** `GET /sessions/:id` every 5s while `pending_qa` / `qa_in_review` / `splicing_pending_qa`
(incl. background tabs), which is how the operator's screen reacts to QA without a reload.

## 7. Splicing and splicing QA ⚠️

Unlocked at `qa_confirmed`. `POST /sessions/:id/splices` records a splice and flips `active_splicing` on the
first one. New-spool lot code is optional (skipping records `NEW_SPOOL_LOT_CODE_MISSING` as a warning).
200% QA: `POST /verification/splices/:spliceId/approve` · `/reject`,
`GET /verification/sessions/:id/pending-splices`. `POST /sessions/:id/submit-splicing-qa` →
`splicing_pending_qa` + `splicing_submitted_at`, which starts the 2h display-only countdown.

## 8. Closure ⚠️

Operator closes with production quantity + cycle time (client closure dialog). `PATCH /sessions/:id` accepts
`status` (validated against the lifecycle list), `totalProductionQuantity`, `currentCycleTime`; the server
derives `total_output_units = qty × bom.cavity_count`.

## 9. Handover ⚠️

Operator-to-operator shift handover, not a QA step. The outgoing operator nominates an incoming one, creating a
`changeover_operators` row with `status='pending'` and `fromOperatorId`. The incoming operator accepts/rejects:

- `GET /verification/handover/operators` · `/pending` · `/verification/handover/:id`
- `POST /verification/handover/:id/accept` → row `accepted` + `accepted_at`, audited `handover_accepted`.
  The `(sessionId, actor)` lookup on a pending row **is** the authorization check.
- `POST /verification/handover/:id/reject`

## 10. Cross-cutting ⚠️

- **Audit chain.** `audit_logs` is an append-only HMAC chain keyed by `AUDIT_HMAC_SECRET`. **Never delete
  rows** — that breaks chain verification (`GET /audit/integrity`). Rotating the secret has the same effect.
- **Notifications.** Server `pushNotification` swallows insert errors, so silent loss is usually schema drift,
  not wiring — check `information_schema` first.
- **Reports.** `GET /sessions/:id/report` (+ `/pdf`, `/xlsx`), `/summary`, `/splice-state`. Report
  STATUS/MATCHED AS are synthesised on read from audit rows, not stored columns.
- **License.** Browser-localStorage HMAC, keyed by `VITE_LICENSE_HMAC_KEY` baked into the frontend bundle.
  Rotating that key invalidates an activated license — this is why `setup.sh` must never be re-run on a live
  client (it rewrites `.env`), and why the in-place update scripts preserve it.

## 11. Where each flow lives

| Flow | Client | Server |
|---|---|---|
| Session create / lifecycle | `feeder/pages/NewSession.tsx`, `ActiveSession.tsx` | `routes/sessions.ts` |
| Loading scan (AUTO/LEGACY) | `ActiveSession.tsx`, `utils/mpnUtils.ts`, `utils/bomOrder.ts` | `routes/sessions.ts:1790+` |
| Legacy standalone verification page | `feeder/pages/Verification.tsx` | `routes/verification.ts:472+`, `services/scan-validation-pipeline.ts` |
| QA queue / confirmation | `feeder/pages/QaQueue*.tsx` | `routes/verification.ts:1091+` |
| Splicing | `feeder/pages/Splicing.tsx` | `routes/sessions.ts:2178+`, `:2386+` |
| BOM CRUD / revisions | `pages/Bom*.tsx` | `routes/bom.ts`, `routes/bom-comprehensive.ts` |
| Reports | `pages/Reports*.tsx` | `routes/reports.ts`, `services/report-service.ts` |

## 12. Not yet traced (extend this file, don't guess)

- QA-queue internals: rescan, discrepancy, complete-time checks.
- Splicing QA approval/rejection logic and the live per-splice state.
- Handover rejection and the operator-nomination flow.
- Closure edge cases.
- Reports, dashboards, analytics, admin portal, document control, trash/soft-delete.
- Offline/connection-loss behaviour in the scanner client.
