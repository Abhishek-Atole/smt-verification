# Decision Log

A running log of decisions taken on this system, each with its *why* — the reasoning,
the approach chosen, and which alternatives were rejected and why. Append, don't overwrite.
Dev-only; excluded from client deployments.

---

## 2026-08-26 — Trial (skip-BOM) sessions: supervisor-only, no QA approval, separate view

**Context:** "Skip-BOM" changeovers exist for **data collection** — the user calls them
*trial sessions*. Previously starting one required a QA/skip-approver sub-form (role + name +
remarks) and the resulting session was visible to everyone, including operators who then hit a
403 when trying to open one they didn't own. Two intertwined concerns were addressed together:
**(B1)** the legacy Active-Sessions list was unscoped, and **(B2)** the trial-session model
itself (who starts them, who sees them, how they're presented).

**Decisions & why:**

1. **`bomVerificationSkipped = true` *is* the trial marker — no new table, no migration.**
   The boolean column already exists (`lib/db/src/schema/sessions.ts:56`, NOT NULL default
   false), so `= true` cleanly means "trial" and `= false` means "production". *Rejected:* a
   dedicated `sessionType` enum or a separate trials table — both are migrations for a
   distinction an existing column already encodes.

2. **Trial creation is supervisor-only, with NO QA approval step.** Verbatim requirement:
   trials are for data collection, *"only the supervisor can start this type of changeover"* and
   *"no QA approval is required."* Dropped the entire skip-approver sub-form + its server-side
   approver validation; replaced it with a supervisor-only 403 gate at `POST /sessions`
   (`sessions.ts`). For provenance the creating supervisor is still recorded in the existing
   `bomSkipApproverRole/Name/At` columns at insert (`role: "supervisor"`, name = creator), and
   the audit action string stays `bom_skip_approved` (description reworded) so existing audit
   consumers don't break. *Rejected:* keeping the approver workflow (explicitly unwanted);
   inventing a new audit action (would silently drop from any consumer filtering on the old one).

3. **Visibility — operators never see trials; supervisor + qa (+ admin superuser) do.**
   `GET /verification/sessions/active` now excludes `bomVerificationSkipped = true` rows for
   operators and returns the flag on every row so the client can bucket. *Rejected:* filtering
   client-side only (operators would still receive trial data over the wire).

4. **(B1) Operator Active-Sessions list scoped to own sessions.** The legacy list query was
   unscoped, so operators saw sessions they couldn't open — the list contradicted the
   `requireLegacySessionOwnership` IDOR guard (`sessions.ts:32-76`). The list SQL now **mirrors
   that guard exactly**: an operator sees a session only if `operatorName === actor.name` OR they
   are co-owned via `changeoverOperatorsTable` for `actor.id`. qa/supervisor/admin still see all.
   *Why mirror, not re-invent:* "listed" must equal "openable," or we just move the 403 around.

5. **Display — a separate "Trial / Data Collection" section on the same Active Sessions page.**
   The supervisor/qa view splits `filtered` into `productionSessions` / `trialSessions`; the
   trial section (amber heading) renders only when non-empty. Shared `renderSessionList(rows)`
   helper so both sections use identical table/card markup. *Rejected:* a separate page (user
   chose same page); a mere badge (user wanted the two kept visually separate).

**Touches:** `artifacts/api-server/src/routes/sessions.ts` (supervisor gate + insert provenance
+ audit wording), `artifacts/api-server/src/routes/verification.ts` (operator scoping + trial
exclusion + `bomVerificationSkipped` on each row), `artifacts/feeder-scanner/src/feeder/pages/NewSession.tsx`
(supervisor-only "Trial Session" checkbox, approver sub-form removed), `artifacts/feeder-scanner/src/feeder/pages/ActiveSessions.tsx`
(interface field + Production/Trial section split). No schema or migration. API bundle rebuilt
clean (`node build.mjs`, exit 0); frontend rebuild is the user's responsibility.

**Quiz gate:** passed — Q1 only a supervisor may start a trial; Q2 operators see their own
production sessions only; Q3 trials in a separate section on the Active Sessions page.

---

## 2026-08-22 — Final report cleanup (logo, de-clutter, splice-when-empty)

**Context:** The "final report" was congested, its logo was missing, and it still showed a
splice section when a changeover had no splices. Two separate surfaces are involved: the
on-screen report page (`artifacts/feeder-scanner/src/pages/session-report.tsx`) and the
server-generated PDF (`artifacts/api-server/src/routes/sessions.ts`, route
`GET /sessions/:id/report/pdf`). The page's PDF button opens the server PDF; the in-file
client `exportPDF()` is dead code. Scope confirmed with the user: **both surfaces**; and
"remove that column" means **remove the whole splice section when empty**.

**Decisions & why:**

1. **PDF logo path — resolve from `__dirname`, not `process.cwd()`.**
   `getLogoPath()` fell back to `path.resolve(process.cwd(), "artifacts/api-server/...")`.
   The dev script runs the server from `artifacts/api-server/` (`DOTENV_CONFIG_PATH=../../.env`),
   so those cwd-relative paths double-nested (`artifacts/api-server/artifacts/api-server/...`)
   and never existed → `getLogoPath()` returned null → PDF drew the `CO_SHORT` text box.
   `COMPANY_LOGO_PATH` is empty and `VITE_LOGO_URL` unset, so no env override saved it.
   Fixed by resolving the two bundled defaults from `__dirname` (the esbuild bundle defines
   `globalThis.__dirname` via its banner; `app.ts:219` already relies on this), making the
   lookup cwd-independent: `dist/index.mjs` → `../assets/ucal-logo.png` (exists).
   *Rejected:* hardcoding an absolute path (not portable); requiring an env var (silent
   failure if unset, which is the current bug).

2. **Info-grid de-clutter — hide cards with empty/placeholder values.**
   Both grids padded themselves with `—`/`N/A` cards (PDF: 20 cards incl. often-empty
   PCB/Engineer/QA-Method/Machine/Line; page: 14 cards). Chose a principled, non-destructive
   rule: filter out any card whose value is empty, `—`, or `N/A` before rendering, and reflow
   the grid (PDF rows now computed from the filtered count instead of a hardcoded 4).
   UI-only — no DB or API-contract change; the underlying data is untouched.
   *Rejected:* subjectively deleting specific "unimportant" fields (I'd be guessing which
   matter); deleting empty values from the DB (destructive, wrong layer).

3. **Splice section — render only when there are splices.**
   PDF already early-returned when `spliceRows.length === 0` (correct, kept as-is), and its
   "Splices — N recorded" info card is now dropped when the count is 0. The on-screen section
   was gated only on the `showSplices` customize toggle and rendered a "No splicing records
   found." row when empty; changed the gate to `showSplices && splices.length > 0` and removed
   the now-dead empty-state branch. The customize toggle still works when splices exist.
   *Rejected:* a collapsed/expandable placeholder (user chose full removal).

**Touches:** `artifacts/api-server/src/routes/sessions.ts` (logo path + info grid),
`artifacts/feeder-scanner/src/pages/session-report.tsx` (info grid + splice section).
No schema, API contract, or dependency changes. Typecheck clean on both packages.

**Quiz gate:** passed — Q1 section fully removed, Q2 broken cwd-relative path, Q3 UI-only
empty cards hidden.

---

## 2026-08-22 — Report PDF: remove footer to kill 2 trailing blank pages

**Context:** The generated PDF report (`GET /sessions/:id/report/pdf`) came out as 3 pages
for session 17 — the first with content, the next two blank. A / landscape, margins 20.

**Root cause:** `drawFooter()` positioned its two `doc.text()` lines at `pageH - 24` and
`+12` below that. In pdfkit, when a `doc.text()` baseline exceeds `page.height -
margins.bottom`, the library auto-creates a new page to hold the "overflowing" text. The
footer sat inside the 20 pt bottom margin, so each footer line tripped that rule and pdfkit
appended a fresh page — the trailing pages were blank because nothing else drew on them.

**Decision & why — remove the footer entirely (not a margin tweak).**
Deleted `drawFooter` (its definition + the single call in the render sequence) and the
now-orphaned `SYS_TITLE` const (it was referenced only inside the footer). Verified the
footer's content was redundant: the **generation timestamp** ("Generated …") and **page
number** ("PAGE 1 OF 1") already live in the header band, and **operator** is already a card
in the info grid — so nothing informational was lost. `_pageNum` is kept (still used by the
header and the content-pagination `addPage` blocks).
*Rejected:* the margin-zero workaround (temporarily set `doc.page.margins.bottom = 0` around
the footer draw, keeping the footer). It would have preserved a footer whose every field is
already shown elsewhere — added state juggling for duplicate data. User chose full removal.

**Touches:** `artifacts/api-server/src/routes/sessions.ts` only (footer fn + call + orphaned
const). No schema, API contract, or dependency changes. Typecheck clean; rebuilt bundle and
regenerated the session-17 PDF → **pdfinfo reports 1 page**, logo and all content intact.

**Quiz gate:** passed — cause = footer text past the bottom margin (pdfkit auto-pagination);
fix = remove the footer.

---

## 2026-08-22 — Free Scan Mode: report showed zero scan records (UI + PDF)

**Context:** After completing a Free Scan Mode session, neither the on-screen report page nor
the PDF showed any scan records — the table was empty on both surfaces.

**Root cause (verified against live DB + running API, not just code reading):** the scans are
persisted correctly — `scan_records` had 8 rows for free-scan session 21, 5 for session 18.
The failure was purely in report-*building*. Both surfaces are fed by one shared server
function, `buildSessionReportPayload` (`sessions.ts`), consumed by `GET /sessions/:id/report`
(UI) and `GET /sessions/:id/report/pdf`. Its legacy path fetches all scans, then builds
`reportRows` by mapping over **BOM items** (`bomItems.map(...)`) and *finding* a scan for each.
Free Scan Mode has **no BOM** (`bom_id` is NULL → `bomItems = []`), so `reportRows` came out
`[]` even though `scannedCount` correctly reported 8. Both readers render `reportRows`, so both
showed nothing. Proven: `/report` JSON returned `reportRows=0, scannedCount=8` for free-scan
21/18, vs `reportRows=3` for BOM control 17.

**Decision & why — build rows from the scans when there is no BOM.**
In the legacy branch of `buildSessionReportPayload`, `reportRows` is now `bomItems.length === 0
? scans.map(scan => …) : bomItems.map(item => …)`. The free-scan branch turns each scan record
into a row directly (`scannedValue` = spoolBarcode ?? internalIdScanned ?? scannedMpn; status,
lotCode, scannedAt, verificationMode from the scan), leaving BOM-derived columns (ref-des,
expected MPN, package, internal P/N, mpn/make 1–8) blank — there is no BOM to compare against,
so `matchedAs` is "—". The existing BOM `map` body is the untouched `else` branch. Also changed
`totalBomItems` to fall back to `scans.length` when there are no BOM items, so the header's
Feeders card and completion % reflect the scans instead of being stuck at 0.
*Rejected:* iterating scans via synthesized pseudo-BOM-items so the old `.map + .find` path
runs unchanged — `.find` returns the first scan per feeder, so duplicate-feeder scans (the
"duplicate-accept guard" makes these possible in free scan) would render the same scan twice.
Direct `scans.map` yields one correct row per scan. *Rejected:* attaching a dummy BOM (pollutes
data) and hiding the free-scan table (that's the bug, not a fix).

**Touches:** `artifacts/api-server/src/routes/sessions.ts` only (two edits in
`buildSessionReportPayload`). No schema, API contract, client, or dependency changes — one
server fix corrects both surfaces. Typecheck clean; rebuilt + restarted :3000. Verified:
free-scan 21 → `reportRows=8`, 18 → 5, 16 → 2, 15 → 3; BOM control 17 unchanged at 3. Rendered
the session-21 PDF → 1 page, all 8 feeders listed with scanned value / lot / PASS / time, logo
intact.

**Quiz gate:** passed on re-ask — Q1 first answered "scans aren't saved" (contradicted by the
DB: 8 rows present); corrected with evidence, re-asked, user then chose "No BOM → zero rows
built". Q2 shared builder, Q3 build rows from scans — both correct first time.

---

## 2026-08-23 — GitHub release v2.1.1 (private repo, token download, direct updates)

**Context:** User asked to cut a GitHub release so the code can be pulled with `wget` and
updated directly. Repo `Abhishek-Atole/smt-verification` is private. User decisions (via
AskUserQuestion): stay **private** + token-authenticated downloads; ship a **full source
tarball** (secrets excluded); **commit all 22** uncommitted files as one release commit;
**merge to main, then tag** (explicit one-time override of the standing "don't push to main").

**Decisions & why:**

1. **Tag = `v2.1.1`.** `scripts/deploy-client.sh` hardcodes `RELEASE_TAG="v2.1.1"`, so tagging
   v2.1.1 lets the existing deploy script work unmodified. (package.json versions are still
   0.0.0/1.0.0 — not reconciled; deploy script is the source of truth for the release name.)
2. **One release commit of all 22 files**, then `git checkout main && merge --ff-only` (main
   was 0 behind / 7 ahead → clean fast-forward), push main, annotated tag, push tag.
3. **Tarball built with `git archive` from the tag, excluding `.dev-docs`.** `git archive`
   inherently omits `.env` and every untracked file. `.dev-docs` IS committed now (part of the
   22) but is dev-only per the client-deploy-hygiene rule, so it is excluded from the deployable
   asset via `:(exclude).dev-docs` pathspec — committed to the private repo, kept out of what
   ships. Verified: tarball has 0 `.env`, 0 `.dev-docs`, `.env.example` present.
   *Rejected:* a tracked `.gitattributes export-ignore` (would be a 23rd file beyond the
   authorized 22); shipping a prebuilt dist (user chose full source).
4. **Release assets:** source tarball + `.sha256` (so `wget` downloads are verifiable) +
   `update.sh` (fetch-latest → verify checksum → extract; uses `gh` else `GH_TOKEN`; never
   touches `.env`/DB). Update mechanism also documented in the release body so it's visible
   without downloading.

**Verification:** both packages typecheck clean; secret-scan of staged diff clean; release is
live (not draft); Option A (`gh release download` + `sha256sum -c`) → OK; Option B (`wget`
API tarball with token) → valid gzip, 0 `.env`. This decision.md entry is dev-only and left
uncommitted (excluded from the release by design).

---

## 2026-08-23 — Module 10: system security, device/IP restriction & access segregation

**Context:** Implement the full Module 10 spec (10.1–10.5): device categories + records
(10.1), per-request IP enforcement + no-code-deploy admin IP management (10.2), admin-
configurable security settings — device/IP mgmt, per-device-type session timeout, active-
sessions view + force logout, maintenance/lockdown toggle (10.3), separate login windows per
role that reject wrong-device/role credentials (10.4), general hardening — log attempts with
device_id/IP, configurable lockout, audit admin changes, optional TLS in transit (10.5).

**Architecture decisions (user, via AskUserQuestion — these ARE the quiz-gate answers):**

1. **Sequencing = all-at-once, one big change.** *Rejected:* incremental per-subsection PRs —
   user wanted the whole module landed together.
2. **IP enforcement = strict per-request (spec-literal).** Every request from an unlisted /
   blocked / pending device is rejected *before* auth by `deviceGuard`. *Rejected:* enforce
   only at login (weaker; a device that changes IP mid-session would keep access).
3. **Store login = separate window like admin** — own `/store` route + shell, still one SPA.
   *Rejected:* a role option on the shared login (spec wants an isolated entry point).
4. **DB-password rotation (10.3) = deferred entirely, not modelled.** Out of scope by explicit
   user choice; no schema or key-management surface added for it.

**Key implementation decisions & why:**

1. **Bootstrap allow-all when `devices` is empty.** `deviceGuard` lets every request through
   until the first device is registered, so enabling the feature on a fresh DB can't lock the
   admin out before they can add their own device. Verified live: `devices` count = 0 → normal
   requests pass. *Rejected:* deny-by-default from the first boot (guarantees lockout — no way
   to reach the admin UI to add the first device).
2. **Loopback is always trusted** → `deviceType = "server"`, allowed unconditionally. Same-box
   API calls and health checks must never be gated. Consequence, documented: the 403 block path
   can't be exercised from localhost — it's validated by unit-level IP matching + code review,
   not the local smoke test.
3. **Maintenance mode blocks non-`admin_device` traffic** (spec 10.3 lockdown). Admins retain
   access to lift it; everyone else is held out.
4. **Role↔device binding is hardcoded, enforced at login.** Admin portal login requires
   `admin_device`/`server`; a mismatch → 403 `device_role_mismatch`, audited
   `SECURITY_LOGIN_DEVICE_MISMATCH` + a failure `recordLoginEvent`. *Rejected:* a
   configurable role→device-type map (10.1 defines fixed categories; config adds surface with
   no requirement behind it — simplicity-first).
5. **Session timeout is per device type**, read from `security_settings`
   (end/store/admin columns, 60–86400 s), applied at token issue.
6. **`security_settings` is a single-row table** (`id = true` boolean PK, upserted via
   `onConflictDoUpdate`). One global config row; no accidental duplicates.
7. **IP validation via `isValidIpOrCidr`** (IPv4/IPv6 + CIDR bit-range checks) on every device
   create/update, so a malformed allow-list entry can't silently disable matching.
8. **Every device / settings mutation invalidates its in-memory cache**
   (`invalidateDeviceCache` / `invalidateSecuritySettingsCache`) and writes an audit event
   (`DEVICE_CREATED/UPDATED/DELETED`, `SECURITY_SETTINGS_UPDATED`, `SESSION_REVOKED`) — 10.2's
   "no code deploy" requires changes to take effect immediately, and 10.5 requires admin
   changes to be audited.
9. **`AUDIT_HMAC_SECRET` added to the deploy** (`deploy-client.sh` generates it + writes it to
   `.env`). The audit chain's `computeChainHash` throws without it, so the hardening audit trail
   (10.5) would silently not persist on a fresh install otherwise.
10. **TLS is optional and env-gated** (`TLS_CERT_PATH` + `TLS_KEY_PATH` → `https.createServer`,
    else plain HTTP). Correct default for a direct-LAN deploy; deploy script ships commented
    scaffolding + a note to set `COOKIE_SECURE=true` when TLS is on. *Rejected:* mandatory TLS
    (no cert exists on a fresh LAN box; would block first boot).

**Migration:** `lib/db/drizzle/0018_module10_devices_security.sql` — idempotent raw SQL for
existing DBs (enums `device_type`/`device_status`, `devices` + `security_settings` tables +
indexes, seeds the settings row). Fresh installs get the tables from `drizzle-kit push` in the
deploy (push auto-creates from schema); both paths converge.

**Touches:** schema (`lib/db` devices/security_settings + rebuilt `dist/*.d.ts`); api-server
(`ipMatch.ts` `isValidIpOrCidr`, `deviceGuard` middleware, `admin.ts` device/settings/session
routes + login role-binding, per-device session TTL, `index.ts` optional TLS); feeder-scanner
(admin `AccessControl` page + `api.ts` methods, `AdminNav`/`AdminGate` wiring, `storekeeper`
role in auth-context, `/store` gate/login/dashboard, `App.tsx` route prefix); infra
(`deploy-client.sh` AUDIT_HMAC_SECRET + TLS scaffolding). AUTO/auto-approve flows untouched.

**Verification:** both packages typecheck clean; api-server bundles (`dist/index.mjs` 5.1 mb);
migration 0018 applied to the live local DB (`DO DO CREATE TABLE CREATE INDEX CREATE INDEX
CREATE TABLE INSERT 0 1`), verified idempotent — enums/tables/settings-row present,
`devices` = 0 (bootstrap allow-all, no lockout risk). Live boot smoke test on :4123: health
200 (db ok), bad login **401** (deviceGuard passed loopback → handler ran), `/api/admin/ping`
200, startup logged `tls: false`. Block-path (403 from a non-matching device) not exercisable
from localhost by design (loopback trust) — covered by IP-match logic + review.

**Quiz gate:** satisfied by the four AskUserQuestion architecture decisions above, taken before
implementation; Module 10 was pre-approved as a unit, so no separate mid-build quiz.

---

## 2026-08-23 — Release v2.2.0: ship Module 10 to a fresh client + deploy-script fixes

**Context:** Client's old system was deleted; user wants a fresh install of the *latest* code
(with Module 10). That means committing Module 10 and pointing the deploy at a new tag. Pre-flight
of the fresh-install path surfaced two real deploy-script bugs, fixed here.

**Decisions & why:**

1. **New tag `v2.2.0`** (minor bump — additive feature). `v2.1.1` is pinned to `35df894` and
   contains no Module 10; the deploy checks out a tag, so a fresh Module-10 install needs its own
   tag. `deploy-client.sh:RELEASE_TAG` bumped `v2.1.1 → v2.2.0`.
2. **Fixed frontend build filter.** `deploy-client.sh` filtered `@workspace/feeder-scanner`, but
   the package is actually named **`infizent-technology-suite`**. pnpm exits 0 on "No projects
   matched", so under `set -e` the deploy would **silently skip the SPA build** — `STATIC_ROOT`
   empty, only the late "SPA served" smoke check failing after everything else deployed. Changed
   to `--filter infizent-technology-suite`. (This bug predates Module 10; it would have bitten a
   v2.1.1 deploy too — but the client was previously deployed from a build machine where dist
   already existed, so it went unnoticed.)
3. **Exclude dev-only docs from rsync.** rsync excluded only `node_modules/.git/dist`; `.dev-docs`,
   `docs`, and `.github` are tracked and would ship to the client, violating client-deploy-hygiene
   (`.dev-docs/decision.md` holds internal reasoning). Added `--exclude .dev-docs --exclude docs
   --exclude .github`. `.claude`/`CLAUDE.md` are untracked, so the tag worktree never contains
   them — no exclude needed. The rest of the tree (src, tsconfig, lockfile) must ship: the client
   builds in place.

**Verification (fresh-install path):** frontend `vite build` clean → `dist/public/index.html`
present (STATIC_ROOT target); `seed:users` creates `storekeeper1` from `SEED_STORE_PASSWORD`;
`pnpm push` creates the Module 10 tables on a fresh DB; empty `devices` → bootstrap allow-all (no
lockout); empty `security_settings` → `DEFAULT_SETTINGS` until first save. api-server typecheck +
build + 158 tests already green.

**Post-deploy operational note (must tell the client):** IP enforcement is OFF until the first
device is registered. Register the admin machine **first**, as an `admin_device` with its LAN IP,
status `active` — ideally from the server console (loopback is always trusted) so a mistake can't
lock anyone out. Recovery if locked out: work from the server box, or `DELETE FROM devices;`.

**Git:** committed on branch `release/v2.2.0` (main left at v2.1.1); local tag `v2.2.0`. Not pushed
— deploy reads the tag from the local repo worktree, so no push is required to deploy.

---

## 2026-08-25 — Fix: QA-approved splices render FAILED / "-" in the session report

**Context:** Two splices in session `SMT_20260825_000036` (feeder YSM-001, new spool
`C0603C472K5RACAUTO`) showed `STATUS=FAILED`, `MATCHED AS=-` in the SPLICE LOG even though they
matched MPN 1 and passed QA. Reported as "passed but shows failed."

**Root cause (read-path display bug — the data was always correct):** `splice_records` has no
`status`/`matchedAs` column; the report reconstructs those on read in `GET /sessions/:id/splices`
(sessions.ts) from a `feeder_splice` audit log via `buildSpliceResponse` / `parseSpliceAuditPayload`.
Three actions write to the **same** audit key (`entityType="feeder_splice"`,
`entityId="splice_<id>"`): `splice_recorded` (sessions.ts:2463 — carries `status`/`matchedAs`), and
the QA `splice_approved` / `splice_rejected` (verification.ts:2520/2582 — payload is only
`{qaResult,...}`, no `status`/`matchedAs`). The read loaded **all** of them into a `Map` keyed by
`entityId` with **no action filter and no ordering** (sessions.ts:2112), so the newer QA log
clobbered the good snapshot; `parseSpliceAuditPayload` then coerced the missing `status` → `"failed"`
and `matchedAs` → `""`. Hit **every** approved/rejected splice; a not-yet-QA'd splice displayed fine.

**Fix & why (one line, sessions.ts read query):** added `eq(auditLogsTable.action,
"splice_recorded")` to the audit-fetch `and(...)`. Only that action carries the match snapshot, so
QA logs can no longer overwrite it. Chosen over touching the write path or schema because it's the
single read site that reconstructs status (grep-confirmed), needs **no data backfill** (the good
`splice_recorded` logs still exist), and leaves QA semantics / `qaResult` untouched.

**Verification (read-only DB; API not yet restarted):** for the two splice ids —
`new_spool_matched_field=mpn1`, `qa_result=pass`; the audit table holds both a `splice_recorded`
(`status=verified`, `matchedAs="MPN 1 (KEMET)"`) and a `splice_approved` (empty) row per splice; the
fixed query (`action='splice_recorded'`) returns exactly one good row per splice. api-server
re-bundles clean (`node build.mjs`, exit 0). Effect after API restart: both rows render `VERIFIED` /
`MPN 1 (KEMET)`.

**Git:** uncommitted (commit-only-when-asked). Needs API rebuild + restart to take effect; not yet
deployed to client.

---

## 2026-08-26 — Live splicing → QA → report workflow (explicit `active_splicing` status)

**Context:** The splicing checkpoint was batch-oriented: the operator recorded all splices then
clicked one **SUBMIT TO QA** button; QA saw the session as a single row and had to click **Refresh**
manually; QA could not verify a splice until after submit; the operator could keep adding splices
after submitting (no status lock, backend accepted inserts regardless); and the loading→splicing /
splicing→report auto-redirects were unreliable. User's 6 requirements: (1) each completed splice
auto-submits to the QA queue one-by-one, visible live (~5s poll, no refresh); (2) after the operator
finishes, splicing input closes to a "waiting for confirmation" state; (3) after QA verifies
splicing, auto-redirect operator to the report; (4) after QA verifies loading, redirect operator to
splicing; (5) the waiting UI shows for **operator logins only**; (6) both `qa` and `supervisor` can
close/accept. Two surfaces: the operator session/splicing pages and the QA queue/detail pages
(`feeder-scanner`), plus the legacy sessions + verification routes (`api-server`).

**Decisions & why:**

1. **Add an explicit `active_splicing` session status (Option A), chosen over keeping `qa_confirmed`
   throughout (Option B).** Presented both to the user via AskUserQuestion; the user picked Option A
   twice for unambiguous queue/DB semantics — "being spliced right now" becomes its own status,
   distinct from a loading-confirmed session that hasn't started splicing. Lifecycle: first recorded
   splice flips `qa_confirmed → active_splicing` (in `POST /splices`); **Finish Splicing** flips
   `active_splicing → splicing_pending_qa`; QA close flips `→ completed`. Legacy
   `sessionsTable.status` is free-text `text` (schema line 45), so **no DB migration** — the cost is
   purely that every consumer listing `qa_confirmed` had to gain `active_splicing`. The
   must-not-miss site is the **session-context validator** (`context/session-context.tsx` union
   line 11 + `normalizeActiveSession` 52-61): miss it and the operator is bounced off the splicing
   page mid-work (normalize returns null → redirect to `/sessions`). Both options deliver the
   identical live-QA experience; A was chosen for clarity, not behavior.
   *Rejected:* Option B (no new status) — indistinguishable live experience but the queue could not
   tell "confirmed, not yet splicing" from "actively splicing," which the user wanted visible.

2. **Reliable redirects = `refetchIntervalInBackground: true` on the operator's session poll, not a
   new mechanism.** Root cause of the "broken redirect" bug was react-query pausing `refetchInterval`
   when the operator's tab is backgrounded, so QA's confirmation was never observed until refocus.
   The redirect effects themselves (`ActiveSession.tsx`) were already correct; the one-line query-
   option change makes the 5s poll survive backgrounding, so the redirect fires within ~5s of QA's
   action regardless of focus. Blast radius: one query. Also gated both redirect effects on
   `user?.role === "operator"` so a QA/supervisor viewing the same session isn't yanked away (req #5).
   *Rejected:* websockets (user explicitly said "without refresh" = polling is fine; ws is a much
   larger change for no additional benefit here).

3. **Complete-button gate uses `session.status !== "active_splicing"`, NOT `=== "splicing_pending_qa"`
   as the plan prose literally said — deliberate deviation.** The plan text said gate BOTH the
   **Complete QA Review** and **Approve All & Complete** buttons to `=== "splicing_pending_qa"`.
   Reading `handleComplete` (`QAVerificationDetail.tsx`) against the backend `/complete`
   (`verification.ts:2185`) showed the **Complete QA Review** button is shared by *two* flows: loading
   QA (scan-mode, `qa_in_review → qa_confirmed`) and splicing QA (`splicing_pending_qa → completed`).
   Gating it to `=== "splicing_pending_qa"` would have **hidden the Complete button for loading-QA
   scan-mode sessions** — a regression. Fix: gate the Complete button with
   `&& session.status !== "active_splicing"` — this blocks only the dangerous live-splice window
   (where `/complete` would fall into the non-splicing branch and wrongly revert `active_splicing →
   qa_confirmed`) while preserving both loading-QA (`qa_in_review`) and splicing-QA
   (`splicing_pending_qa`) completion. The **Approve All & Complete** button kept
   `=== "splicing_pending_qa"` because it only renders when `pendingSplices.length > 0`, which is a
   splicing-only condition anyway. The two `splicing_pending_qa` completion paths are mutually
   exclusive (Complete needs `pendingSplices === 0`; Approve-All needs `> 0`).
   *Why safe if ever hit directly via API:* the `active_splicing → qa_confirmed` revert is
   self-healing — the operator's next splice re-flips it to `active_splicing` and splice records
   persist; no backend `/complete` guard was added (kept within the plan boundary), since frontend
   button gating prevents QA reaching it through the UI.

4. **Finish Splicing reuses the existing submit-splicing-qa chain (relabel, not rebuild).** The
   `qa_confirmed|active_splicing → splicing_pending_qa` transition already existed as
   `handleSubmitSplicingQa` → `POST /submit-splicing-qa`; it just gained `active_splicing` as a valid
   pre-Finish status and was relabeled **SUBMIT TO QA → FINISH SPLICING** (button shows "END SESSION"
   when zero splices). Operator lockout is enforced on **both** layers: backend `POST /splices` 409
   guard (blacklist `splicing_pending_qa|completed|cancelled`, so `active|qa_confirmed|active_splicing`
   keep accepting inserts) and a frontend `splicingClosed` gate in `Splicing.tsx`.
   *Rejected:* auto-close on the last approval (no explicit Complete click) — would add an audit write
   inside `/approve` concurrent with the approval's own row (HMAC-chain risk) and leaves session-level
   `qaVerifiedById` attribution ambiguous when multiple QA users approved different splices. Kept QA's
   explicit Complete as the closure gesture.

**Ripple (status consumers that gained `active_splicing`):** `sessions.ts` (`ALLOWED_STATUSES`,
submit-splicing-qa guard/transition, `POST /splices` first-splice transition + 409 finish-lock);
`verification.ts` (`legacyQaStatuses`, `statusRank` rank 0, `pendingQa` special-case);
`session-context.tsx` (union + validator); `ActiveSession.tsx` (`isSpliceEligible`,
`verificationProgress.qaConfirmed`, background poll, role gates, relabel); `Splicing.tsx`
(`splicingClosed` lock + waiting panel); `QAVerificationQueue.tsx` (`StatusBadge` + Pending bucket +
silent 5s poll); `QAVerificationDetail.tsx` (complete-gating + 5s poll, skip while mutation in
flight); `ActiveSessions.tsx` (status badge). The changeover-enum `active_splicing`
(`verification.ts:2870`) is an **unrelated** handover state — deliberately left untouched.

**Verification:** all 8 edited source files type-clean via IDE diagnostics (empty results each). API
rebuild (`node build.mjs`) + restart with `.env` loaded, then two-browser (operator + QA) manual
verification is required to confirm live behavior. **Git:** uncommitted (commit-only-when-asked).

---

## 2026-08-29 — Splicing scan indication: distinct success signal on every step + strikes keyed by scanned value

**Trigger:** asked to verify the buzzers actually work in Splicing. The plumbing was already wired
and correct (every reject path routes through `recordFailure` → `registerScanResult(…, false)`;
`stopAlarm()`/`resetStrikes()` at save/`resetWorkflow`/`handleOverride`; `IndicationLight` mounted in
the authed shell at `App.tsx:152` so the blocking overlay covers both `/feeder/splicing` and
`/splicing`). Two real gaps surfaced. Scope was held to `Splicing.tsx` — `indication.ts`,
`RETRY_LIMIT = 5`, ActiveSession and Verification untouched.

1. **The four intermediate accept steps never signalled success — added `registerScanResult(key, true)`
   at all five accept sites.** Feeder accepted (`:648`), old spool (`:682`), new spool BOM-bypassed
   (`:723`), new spool matched (`:734`), lot code captured (`:760`) called only `showSuccessAlert`,
   which routes `use-notification.ts:98` → `playFeedback("success")` → `audio.ts:57` — the quiet
   660/880 sine at gain 0.08. The distinct arpeggio (C5→E5→G5→C6, gain 0.28) and the green LED fired
   only on the *final* save. Two consequences for the operator: accepts were far quieter than the
   rejects they were meant to contrast with, and — worse — after any failed step the LED pill stayed
   **red** through every subsequent success until the splice saved. Splicing was the only page with
   this asymmetry; ActiveSession already routes its local `playBuzzer("success")` into
   `signalSuccess()` (`ActiveSession.tsx:137`).
   *Why `registerScanResult(key, true)` and not a bare `signalSuccess()`:* the `ok:true` path also
   clears that key's strike counter, which is what makes gap 2's per-value semantics behave (a barcode
   that fails twice then passes needs three fresh strikes to escalate).

2. **Strikes now key off the SCANNED VALUE, not the feeder — `recordFailure` gained a required
   `scanKey` parameter.** It previously keyed `feederNumber || "splice"`, and since `recordFailure`
   runs *before* `setFeederNumber`, a `FEEDER_NOT_IN_BOM` reject keyed the literal string `"splice"`
   — so three bad scans of three *different* feeders piled onto one counter and tripped the alarm.
   Downstream it was per-feeder, so a feeder failing twice at oldSpool, passing, then failing once at
   newSpool alarmed on that first newSpool reject (strikes only cleared at save/reset/override, never
   on an intermediate accept). The approved plan specified "same scanned value"; this restores it.
   Keys per call site: `NO_BOM_LOADED` → raw `value`; `FEEDER_NOT_IN_BOM` → `normalizedFeeder`;
   `OLD_SPOOL_BOM_MISMATCH` / `NEW_SPOOL_MISMATCH` → raw `value`; API `MISSING_LOT_CODE` /
   `WRONG_FEEDER_ALLOCATION` / `OLD_SPOOL_BOM_MISMATCH` → `newSpool?.raw ?? ""`.
   The hand-built `Feeder … rejected N times` alarm message was dropped so `indication.ts` supplies
   its own default naming the rejected value — the feeder number is no longer the identity being
   counted, so quoting it in the alarm would have misdescribed the trigger.
   *Why `newSpool?.raw` for the API-failure path:* at that point the local `value` is the accept token
   or empty, while `raw` is the same barcode the newSpool step keys on — so a server rejection of a
   barcode accumulates with local rejections of that same barcode instead of starting a separate
   counter. On the `""` fallback `registerScanResult` skips strike tracking entirely and only buzzes,
   so no false alarm.
   *Why `scanKey` is required, not optional:* the compiler then catches any future `recordFailure`
   call site that forgets it. Cost is the reformatted parameter list; silent mis-keying is the failure
   mode being designed out.
   *Rejected:* keeping per-feeder keys and only fixing the empty-key case at the feeder step — smaller
   diff, but leaves rejects from different steps of one feeder accumulating together, which is not
   what the plan specified and produces alarms the operator cannot attribute to a specific barcode.

**Test coverage added:** `src/utils/__tests__/indication.test.ts` — 9 tests over the shared layer
(LED transitions, `ALARM_STRIKES` escalation boundary at exactly 3, per-key isolation, trim/uppercase
key normalization, `stopAlarm` returning to idle, `resetStrikes(key)`, and the `smt-indicator`
hardware-bridge event firing on every LED change) against a mocked `AudioContext`.

**Verification:** `pnpm run typecheck` clean; `pnpm run test` 25/25 across 2 files (16 pre-existing
NotificationSystem + 9 new); `pnpm run build:renderer` succeeded. **Limits of that evidence:** jsdom
with a mocked `AudioContext` proves the right functions fire with the right state transitions and that
oscillators start — it does **not** prove audio is audible at the station, which needs a browser check.
Also note the deployed client build is ~31 days old and predates this entire indication layer, so none
of it exists there until a deploy. **Git:** uncommitted (commit-only-when-asked).


---

## 2026-08-29 — Device guard fails CLOSED on an unreadable allow-list (Module 10.2 hardening)

**Context:** `deviceGuard` (mounted before auth on every `/api` request) decides whether a
request IP is a registered device. It reads the list via `deviceStore.getDevices()`, which used
to catch **every** error and return `[]`. The guard treats `[]` as "no devices registered yet →
bootstrap allow-all". So a dropped Postgres connection during a shift silently disabled IP
restriction: after the 10s cache TTL lapsed, every request re-queried, caught, returned `[]`, and
**every device on the network was admitted** — the only trace a `logger.warn` at most once per 60s.
Confirmed empirically with fake timers (see `device-store.test.ts`): stale cache serves for ~10s,
then it's allow-all. `matchesIp`/`isValidIpOrCidr`/`deviceGuard`'s 403 path also had **zero** test
coverage — the one function standing between operators and a locked-out line.

**Decision:** an unreadable allow-list is **not** an empty allow-list.
- `getDevices()` now distinguishes three cases:
  1. **Table missing** (Postgres `42P01`) → still fail **OPEN** (`[]` → bootstrap allow-all). A
     fresh install before the Module 10 migration has no list to read; failing closed here would
     403 the admin portal before any device could be registered, bricking first boot.
  2. **Any other error, with a recent good copy** → serve the **stale cache** for up to
     `STALE_GRACE_MS = 5min` (a Postgres restart / brief blip must not halt a running line). The
     cache is now genuinely *retained* on failure — previously `at` was only written on success, so
     it was never actually reused past the TTL. A 1s failure-backoff avoids hammering a down DB.
  3. **Any other error, no usable cache** → throw `DeviceLookupUnavailableError`.
- `deviceGuard` catches that error and returns **503 `device_check_unavailable`**, not 403.
  Loopback is checked *before* the lookup, so the server can still administer itself during an
  outage. Audited as new event `SECURITY_DEVICE_LOOKUP_UNAVAILABLE`.

*Why 503 not 403 (user's call, quiz-confirmed after correction):* 403 `device_not_allowed` tells an
operator their device was de-registered — they'd call an admin about a change that never happened.
503 says "temporarily unavailable, retry" — truthful about a DB fault, and semantically retryable.

*Why retain the stale cache first:* the failure mode we actually expect is a Postgres restart or a
few-second network blip, not a permanent outage. Serving the last-good list through that window
keeps a **registered** line running; only a sustained (>5min) outage with a cold cache escalates to
denial. `invalidateDeviceCache()` drops the stale copy too, so an admin de-registering a device
during a blip takes effect immediately rather than lingering for the grace window.

*Correcting the quiz record:* two of the user's first-round answers didn't match the code and were
verified against it before implementing — (a) the last-good list protects for ~10s, not "not at
all" and not "indefinitely"; the cache wasn't retained on error at all pre-change. (b) The `/24`
subnet rule cannot regress under fail-closed — `matchesIp` is pure arithmetic and never touches the
DB; the scenario that regresses is the **un-migrated fresh install**, which the `42P01` carve-out
protects. The second-round answers (table-missing vs connection-failed; ~10s-then-allow-all) were
correct and are the design.

*Rejected:* (a) fail closed on *all* errors — bricks fresh installs (case 1). (b) 503 immediately
with no stale-cache window — a 2-second DB blip would halt every registered line needlessly.
(c) Leaving it fail-open and only documenting — the whole point was to close the silent
restriction-disable, not annotate it.

**Test coverage added (three new files, all mutation-checked):**
- `ip-match.test.ts` — 25 tests over `matchesIp`/`isValidIpOrCidr`/`normalizeIp`/`isLoopback`:
  exact vs prefix, the `/24` dual-homed-client case, non-octet prefixes, `/0` and `/32` bounds,
  IPv4-mapped IPv6, IPv6 CIDR, cross-family and malformed → fail closed. **Surfaced a real defect,
  pinned as `KNOWN GAP`:** a trailing slash (`192.168.1.0/`) or trailing garbage (`…/24/8`, `…/ 24`)
  is accepted by `isValidIpOrCidr` and — for the bare trailing slash — `matchesIp` reads it as `/0`,
  i.e. **allow every address of that family**. `Number("")===0`, `Number.isInteger(0)` passes, and
  `matchesIp` short-circuits `bits===0` to true. One stray keystroke in the admin UI turns a subnet
  rule into allow-all, with a normal-looking device row. Pinned, not yet fixed (see below).
- `device-guard.test.ts` — 15 tests at the middleware level (the 403 path had never been
  exercised): loopback trust without DB hit, bootstrap allow-all, `/24` admitting `.108`/`.114`/
  mapped-IPv6, OPTIONS bypass, unregistered → 403 + `unregistered_device` audit, blocked/pending →
  403 + `device_<status>` audit, 403 body leaks no allow-list detail, maintenance 503 for non-admin
  + admin exemption, and the new fail-closed 503 (+ not-403, + audited, + loopback still in, +
  empty-table still bootstrap, + unexpected error still propagates). Mutation-tested: disabling the
  403 branch fails exactly the 3 block tests.
- `device-store.test.ts` — 11 tests over the store's own decision logic (mocked out of the guard
  tests): `42P01` → `[]`; empty table → `[]`; connection-failure/no-code/no-cache → throws; cause
  retained; stale-cache grace serves then abandons past 5min; recovery re-reads; invalidate drops
  the stale copy. Mutation-tested three ways (revert-to-fail-open, treat-all-errors-as-missing-table,
  break invalidate) — each fails the expected subset.

**Verification:** `pnpm exec tsc --noEmit` clean; `pnpm run test` **209 passed / 12 skipped, 20
files** (was 183/12 across 18 before this work; +36 new tests, +2 files, and the pre-existing
`security-hardening` verify-override tests updated). Those 4 tests had relied on the *old* fail-open
behaviour by accident — they route through the guard with a non-loopback `X-Forwarded-For` and the
shared db mock's `select` has no `.from`, so the lookup threw and was silently swallowed to
allow-all. They now stub `deviceStore` into explicit bootstrap mode, since they test verify-override,
not the guard. **Git:** uncommitted (commit-only-when-asked).

**Still open (reported, not changed here):**
- The `isValidIpOrCidr` trailing-slash / trailing-garbage leniency above — a stricter validator
  (reject empty or non-canonical prefix, reject >2 `/`-segments) is the fix; deferred as its own
  decision since it changes admin-input acceptance.
- CORS is a **separate** layer from the device guard and this change does **not** fix the
  blank-page-on-IP-drift issue: the browser still sends `Origin: http://<stale-ip>:4000`, which
  isn't in `ALLOWED_ORIGINS`, so `app.ts` still throws → `/assets/*` 500. That needs origin
  derivation from the server's own interfaces (or admin-config), tracked separately.

---

## 2026-08-30 — Strict CIDR validation: close the trailing-slash allow-all path (Module 10.2)

**Context:** the `KNOWN GAP` pinned in the 2026-08-29 entry above, now fixed. `isValidIpOrCidr`
split on `/` and ran the prefix through `Number()`. `Number("")` is `0`, `Number(" 24")` is `24`,
and `split("/")` silently discarded anything after the second segment. Three malformed forms were
therefore accepted and stored:

| Stored entry | Was read as | Effect |
|---|---|---|
| `192.168.1.0/` | `/0` | **matched every IPv4 address** — restriction silently off |
| `192.168.1.0/24/8` | `/24` | narrower than intended, not what the admin typed |
| `192.168.1.0/ 24` | `/24` | same |

The first is the serious one: a single stray keystroke in the admin Access Control form converted a
subnet restriction into allow-all, and the device row rendered normally, so nothing on screen or in
the logs indicated the network was unrestricted. Verified against the live code before changing
anything — a scratch probe confirmed `isValidIpOrCidr("192.168.1.0/") === true` and
`matchesIp("8.8.8.8", "192.168.1.0/") === true`. Also checked the live DB: `select count(*) from
devices` is **0**, so no production row ever exploited this (the guard is in bootstrap allow-all
mode on this install regardless).

**Decision:** one strict parser, `parseEntry()`, is now the single gate both `matchesIp` and
`isValidIpOrCidr` go through.
- At most one `/` in the entry; more is rejected outright rather than truncated.
- With a `/`, both sides must be non-empty, and the prefix must match `/^(?:0|[1-9]\d*)$/` —
  digits only, so empty string, whitespace, `+24`, `-1`, `024`, `0x18`, `1e1`, and `24.5` are all
  rejected instead of coerced.
- Any whitespace anywhere in the entry is rejected, including leading/trailing. The stored string
  must be exactly what `matchesIp` will later compare, and stray whitespace is a typo the admin
  should be shown rather than have silently absorbed.
- Range check unchanged (0–32 v4, 0–128 v6) but now applied after strict prefix parsing.
- `matchesIp` routes its own entry parsing through the same function, so validation and matching
  cannot drift apart — previously they were two separate implementations of the same rules.

*Why keep `/0` working:* `0.0.0.0/0` and `::/0` typed deliberately are a legitimate admin choice
(a site that wants no IP restriction while still using device rows for typing/roles). The fix
removes the **accidental** path to allow-all, not the capability. The test names encode this
distinction explicitly so a future reader doesn't "tidy up" the `/0` case away.

*Why a bare address is parsed as an implicit /32 (or /128):* it makes the single-address and CIDR
paths one code path instead of two, which is what removes the drift risk. Behaviour is unchanged —
a /32 mask comparison is exact equality.

**Startup audit (`lib/deviceIpAudit.ts`, new):** the validator now rejects malformed input at save
time, but rows written *before* this fix are still in the table. `auditStoredDeviceIps()` runs once
at boot (fire-and-forget from `index.ts`, after `listen`) and logs every stored `allowed_ip` that
fails strict validation, at `error` level, naming the device. Entries that were previously being
read as allow-all get a distinct message calling that out, because only those rows mean the network
was genuinely unrestricted for that period — a `…/24/8` row was merely wrong, not open.

*Why it reports and never repairs:* a stored entry is the admin's stated intent. Rewriting
`192.168.1.0/` to `192.168.1.0/24` guesses at that intent; deleting it locks the line out. Both
substitute our judgment for theirs without asking. Logging leaves the correction an explicit admin
action, which then passes through the strict validator. A failed audit is a `warn` and returns
`[]` — it must not stop boot, and it covers the un-migrated (`42P01`) case for free.

**Rejected:** (a) fixing only the trailing-slash case with a `bitsRaw !== ""` guard — smallest
diff, but leaves the `…/24/8` and `…/ 24` coercions and leaves two separate implementations of the
prefix rules to drift. (b) Keeping `Number()` and adding `Number.isSafeInteger` — still accepts
`" 24"` and `"+24"`, since the coercion is the defect, not the range check. (c) Trimming
whitespace instead of rejecting it — hides a typo and lets the stored string differ from what was
typed. (d) Auto-correcting or auto-deleting malformed rows at boot, per above. (e) A migration to
rewrite existing rows — same objection, and it would run unattended with no admin reviewing it.

**Touches:** `lib/ipMatch.ts` (rewrite of `matchesIp` + `isValidIpOrCidr` around new private
`parseEntry`), `lib/deviceIpAudit.ts` (new), `index.ts` (one `void auditStoredDeviceIps()` call).
No schema change, no migration, no API-contract change — `POST/PATCH /api/admin/devices` already
returned `400 invalid_allowed_ip`; it now does so for three more input forms.

**Verification:** `pnpm exec tsc --noEmit` clean. `pnpm run test` **221 passed / 12 skipped, 21
files** (was 209/12 across 20). `ip-match.test.ts` extended from 25 → 28 tests: the two `KNOWN GAP`
tests inverted to `KNOWN GAP CLOSED`, plus one assertion per rejected form (trailing slash, double
slash, whitespace inside/leading/trailing, negative, signed, out-of-range v4 and v6, non-numeric,
non-integer, hex, leading zero, missing address, exponent), a surrounding-whitespace test, and a
test asserting deliberate `/0` still works. `device-ip-audit.test.ts` (new, 9 tests) covers the
classification and that the audit never calls `db.update`/`db.delete`. Existing `device-guard.test.ts`
and `device-store.test.ts` pass **unmodified**. Mutation-checked three ways: restoring `Number()`
parsing fails 3 tests, allowing multiple slashes fails 1, allowing whitespace fails 1. **Git:**
uncommitted (commit-only-when-asked).

---

## 2026-08-30 — Admin device list flags stored `allowed_ip` values the validator rejects (Module 10.2)

**Context:** the strict validator above stops *new* malformed entries at save time, and the boot
audit logs *existing* ones. But the boot log is only visible to whoever reads the server journal.
An admin looking at Access Control → Devices & IP Allow-list sees `192.168.1.0/` rendered as
ordinary text, indistinguishable from a working rule, with no hint that the row now matches nothing.
That row is the one most likely to be mistaken for working protection, so it is the one that needs
to be visible in the place an admin actually looks.

**Decision:** `GET /api/admin/devices` returns an additive per-row boolean `allowedIpValid`,
computed server-side by the same `isValidIpOrCidr` the POST/PATCH handlers use. The admin page
renders a red `⚠ Invalid IP entry — review and correct` badge next to the address when — and only
when — that field is literally `false`.

*Why the flag is computed server-side:* the frontend has no access to the server's validator.
`lib/shared/` holds a single `stageOrder.ts` with no `package.json`, and feeder-scanner's only
workspace dependency is `@workspace/api-client-react`. So the badge either asks the server or
reimplements the rules. Asking the server keeps exactly one implementation of the prefix rules,
which is the whole point of the Issue-1 rewrite — validation and matching diverging is *how* the
trailing-slash hole existed.

*Why the check is `d.allowedIpValid === false` and not `!d.allowedIpValid`:* the field is optional
on the client type, because an admin SPA served from a cached older bundle (or pointed at an older
server) will get rows without it. `undefined` means "not reported" and must render no badge;
`!undefined` would paint every row red and teach admins to ignore the badge.

*Why display-only:* same reasoning as the boot audit — the stored value is returned byte-for-byte
as stored and nothing rewrites or hides it. Correcting it stays an explicit admin edit, which then
goes through the strict validator. A read path that repairs rows would mean the fix happens
whenever someone happens to open a page, with no record of what the value used to be.

**Rejected:** (a) porting `isValidIpOrCidr` into the frontend — no server round-trip needed, but it
recreates the two-implementations-of-one-rule structure that Issue 1 just removed, and the copy
would drift silently because nothing fails when it does. (b) Extracting the validator into a new
shared workspace package — correct in principle, but it means a new package, build wiring, and a
bundling path for a single 40-line pure function used by one page; the server already answers this
question on a request the page is making anyway. (c) Surfacing the boot-audit results through an
admin endpoint instead — the audit is a point-in-time boot snapshot, so it would go stale the
moment a device is edited, and it would report rows the current list no longer contains. (d) Auto-
correcting the value on read, or hiding invalid rows from the list — hiding is worse than showing:
an admin would conclude the rule was deleted.

**Touches:** `artifacts/api-server/src/routes/admin.ts` (GET `/devices` maps rows through
`isValidIpOrCidr`), `artifacts/feeder-scanner/src/admin/api.ts` (`Device.allowedIpValid?: boolean`,
documented so `undefined` is not invalid), `artifacts/feeder-scanner/src/admin/pages/AccessControl.tsx`
(badge). No schema change, no migration; the field is additive so an older client ignoring it is
unaffected.

**Verification:** api-server `pnpm exec tsc --noEmit` exit 0; feeder-scanner `pnpm run typecheck`
exit 0. Full api-server suite **227 passed / 12 skipped, 22 files** (was 221/12 across 21). New
`admin-devices-ip-flag.test.ts` (6 tests): a stored `192.168.1.0/` reports `allowedIpValid: false`
with `allowedIp` returned unchanged and no `db.update` call; `192.168.10.0/24` and `192.168.10.108`
report `true`; a mixed list is classified per row rather than all-or-nothing; a deliberate
`0.0.0.0/0` reports `true` (the badge must not flag a real admin choice); re-saving the same
malformed value is still rejected `400 invalid_allowed_ip`, so the badge cannot be cleared by a
no-op re-save; saving a valid replacement succeeds and the row then reports `true`. Mutation-checked:
dropping the `allowedIpValid` mapping from the route fails 5 of the 6. **Git:** uncommitted
(commit-only-when-asked).

---

## 2026-08-30 — CORS: same-origin + boot-derived origins, and a 403 instead of a bare 500 (Module 10.5)

**Context:** `ALLOWED_ORIGINS` was the *only* source of accepted origins. It is a static list of
`scheme://host:port` strings in `.env`, so when the appliance's LAN IP changed, the browser began
sending `Origin: http://<new-ip>:4000`, which matched nothing, and the CORS callback **threw**. The
error handler turned that into `500 {"error":"Internal Server Error"}` — including on `/assets/*`,
which blanks the SPA. Vite tags built assets `crossorigin`, so the browser sends `Origin` even
same-origin, which is why *asset* requests were affected at all. The failure was repeatedly
misdiagnosed as a broken build; see the ALLOWED_ORIGINS-IP-drift note. Reproduced before changing
anything: with `ALLOWED_ORIGINS=http://192.168.1.108:4000` and `NODE_ENV=production`, a request with
`Host: 192.168.3.189:4000` / `Origin: http://192.168.3.189:4000` returned **500** — identical to a
genuinely foreign origin, so neither the admin nor the console could tell them apart.

**Decision (chosen by the user over two alternatives):** a new `lib/allowedOrigins.ts` holds one
decision function, and `app.ts` calls it. Three additive allow paths on top of the existing list:

1. **Same-origin** — allow when the Origin's `host:port` authority equals the request's own `Host`
   header. This is same-origin *by definition*: a page can only carry `Origin: X` if it was served
   from X, so `Origin == Host` cannot have come from an attacker's page. This is the path that
   self-heals an IP change, with no restart and no admin action.
2. **Boot-derived interface origins** — the server's own non-virtual addresses read once from
   `os.networkInterfaces()`, paired with its own `PORT` and scheme. Covers a caller that reaches the
   box by an address the `Host` header no longer reflects (proxy rewrote it).
3. `ALLOWED_ORIGINS` unchanged, still the way to add anything else (dev's `localhost:5173`).

Rejection is now **`403 {error:"cors_origin_rejected", origin, message}`**, a `warn` log with the
origin/host/path, and a `SECURITY_ORIGIN_REJECTED` audit event. Echoing the origin back leaks
nothing — the caller sent it.

*Why this does not weaken security:* the host match adds no origin that a cross-site attacker can
produce. Deliberately still rejected, and tested: a foreign site; the server's own address on a
**different port** (`:5173` → `:4000` is genuinely cross-origin and stays on the explicit list); a
lookalike host, since the comparison is exact equality on the parsed authority, not a substring or
suffix test; and any `Origin` that is not a bare `http(s)://host[:port]`. That last guard matters
concretely: `http://user:pw@192.168.3.189:4000` parses to host `192.168.3.189:4000`, so without
rejecting userinfo/query/fragment a crafted value would satisfy the host match. Virtual interfaces
(`docker*`, `br-*`, `veth*`, `virbr*`, `vmnet*`, `tun*`, `tap*`) are excluded from derivation — this
box has `docker0` at `172.17.0.1` and a bridge at `172.18.0.1`, which are not its LAN identity.
IPv6 link-local (`fe80::`) is skipped because a browser cannot send it without a zone index.

*Why 403 and not 500:* a 500 says "the server is broken" and, on an asset request, produces a blank
page with nothing actionable. A 403 naming the origin is what lets an admin fix it from the browser
console alone. The status also correctly describes what happened — the request was understood and
refused.

**Rejected:** (a) an admin-editable allow-list column on `security_settings` (the Module 10.5 audit
pattern) — needs a schema addition, migration, and UI, and critically it does **not** self-heal: an
admin would have to log in to fix it, using the very SPA that the failure blanks. (b) Boot interface
derivation only, with no host match — smaller, but it only heals after a restart, and it does
nothing for an address the box acquires later. (c) Reflecting whatever `Origin` arrives (`origin:
true`) — that is what actually removes the protection, and would make the credentialed-cookie
surface world-writable. (d) Widening the list with a wildcard/regex such as `http://192.168.*` — a
whole-subnet grant, and it still breaks when the site renumbers to a different subnet. (e) Keeping
the throw and special-casing it in the error handler — same behaviour, but the reason for the 403
would live one middleware away from the decision that caused it.

**Touches:** `lib/allowedOrigins.ts` (new — `originAuthority`, `deriveLocalOrigins`, `decideOrigin`,
all pure and unit-testable), `app.ts` (CORS middleware now decides then either answers 403 or hands
to `cors()`; removed the two now-dead `localhost*Pattern` constants that nothing referenced),
`lib/auditLogger.ts` (`SECURITY_ORIGIN_REJECTED` added to the event union). No schema change, no
`.env` change required — an existing `ALLOWED_ORIGINS` keeps working exactly as before.

**Verification:** `pnpm exec tsc --noEmit` exit 0. Full suite **256 passed / 12 skipped, 24 files**
(was 227/12 across 22). `allowed-origins.test.ts` (new, 20 tests) covers the decision function
directly: the drift case allowed as `same-origin`; IPv6 and hostname same-origin; different port and
different scheme rejected; `no-origin`, `configured`, `local-interface`, `development` reasons; and
the rejection set above. `cors-origin.test.ts` (new, 9 tests) drives real HTTP through the app with a
deliberately stale `ALLOWED_ORIGINS` and `NODE_ENV=production`: the drifted same-origin request is
**200** where it used to be 500; a foreign origin is **403** with the code, the echoed origin, and no
`Access-Control-Allow-Origin` header; the rejection is audited; it applies to a non-`/api`
`/assets/*` path and to a preflight; and an allowed cross-origin caller still receives working
`Allow-Origin`/`Allow-Credentials`/`Allow-Methods`/`Allow-Headers`. Mutation-checked four ways:
removing the host match fails 3 tests (the drift regression returns), relaxing the host comparison to
`includes` fails 1, removing the userinfo/query/fragment guard fails 1, removing the virtual-interface
filter fails 1. Each restored and re-verified green. **Not verified:** live browser behaviour after
an actual IP change on the appliance — that needs a restart on the box and is the user's to confirm.
**Git:** uncommitted (commit-only-when-asked).

---

## 2026-08-30 — DB-password rotation stays deferred; the actual manual process, on the record (Module 10.3)

**Context:** Module 10.3 (security settings / lockdown) was landed on 2026-08-23, but its
DB-password-rotation sub-item was explicitly deferred at that time ("DB-password rotation (10.3) =
deferred entirely, not modelled" — see 2026-08-23 Module 10 entry, decision #4). This entry is
**docs only, no code**, per the instruction to *not* implement rotation now. Its purpose is to
record three things the deferral has so far left implicit: what the current process actually is,
what the blocking design question is, and where the marker should live.

**Decision:** rotation remains out of scope. No schema, no key-management surface, no endpoint, no
UI. What changes here is only that the deferral is now documented against the real mechanism rather
than as an abstract "later".

*The actual current process (verified in the deploy tooling, not assumed):*
- At deploy, `scripts/deploy-client.sh` generates the DB password **once** — `DB_PASS=$(openssl
  rand -hex 24)` (`:54`) — sets it on the Postgres role with `ALTER ROLE "$DB_USER" PASSWORD
  '$DB_PASS'` (`:102`), and writes it **in plaintext** into `DATABASE_URL` inside `.env`, created
  under `umask 077` and never echoed (`:108–109`).
- Updates never touch it: `update-client-v2.4.0.sh` reads the existing `.env` (`set -a; . .env`),
  re-`chmod 600`s it (`:104`), and preserves every secret. Nothing re-rolls the password.
- So there is **no rotation mechanism at all**. To rotate today an operator must, by hand and with
  the API stopped: `ALTER ROLE smtverify PASSWORD '<new>'` in psql, edit `DATABASE_URL` in
  `$APP_DIR/.env`, then restart the service. The password that `openssl rand` produced at first
  deploy otherwise lives unchanged for the life of the install.

*The blocking open question (flagged, deliberately NOT answered here):* any automated rotation that
also wanted to store the credential **encrypted** rather than as today's plaintext `DATABASE_URL`
needs an encryption key, and **that key cannot live in the database it protects, nor in the same
`.env` that already holds the plaintext URL** — either placement means anything that can read the
ciphertext can also read the key, so the encryption buys nothing. Resolving where the key lives
(OS keyring, a TPM/secure element, an operator-entered passphrase at service start, or an external
secrets manager) is the actual design decision this deferral is parked on. It is out of scope until
someone chooses one; recording the constraint is what stops a future implementation from quietly
putting the key next to the data.

**Spec marker — could not be applied as written:** the brief asked to mark Module 10.3 "Deferred —
see decision.md 2026-08-23" in `changeover-handover-implementation-spec.md`. **That file does not
exist** anywhere in the repo, the working tree, or the sibling backup — the only spec-shaped
document tracked is this decision log (a `MASTER_IMPLEMENTATION_PLAN_V2.md` exists only under the
`SMTVerification-backup-20260601/` snapshot, not in this repo). Rather than fabricate a spec file to
carry a one-line marker, the deferral is recorded here, cross-linked to the 2026-08-23 entry that
first made the call. If the intended spec lives outside this repo, the marker belongs there and this
entry is the text to point it at.

**Update (2026-08-30, same day):** the spec was supplied and now lives in the repo at
`.dev-docs/changeover-handover-implementation-spec.md` (dev-only, alongside this log). It carries the
marker this entry could not previously place: Module 10.3 is struck through and annotated
`DEFERRED, see status note below` with the full deferral rationale inline, and a new §10.6 "As-Built
Notes" records the Tier-1 fixes (Issues 1–4). The "That file does not exist" statement above was true
when written; it no longer is. The document was saved verbatim as provided — not authored here — so
it is not a fabricated spec, and the decision log remains the primary record for the *reasoning*.

**Rejected:** (a) implementing rotation now — explicitly out of scope, and it cannot be done
responsibly before the key-location question is answered. (b) Creating
`changeover-handover-implementation-spec.md` just to hold the marker — that invents a document that
was never part of the project; a decision log entry is the honest place for a decision. (c) Moving
the DB password out of plaintext `.env` as a "small" hardening step now — that is the very change
that trips the key-location question, so doing it without answering that question would either
re-encode the same exposure or hide the key somewhere worse.

**Touches:** `.dev-docs/decision.md` and (per the same-day update) the newly-saved
`.dev-docs/changeover-handover-implementation-spec.md`. No code, no schema, no scripts, no tests.

**Verification:** none applicable — documentation change. Claims about the current process were
checked against `scripts/deploy-client.sh` (`:54`, `:102`, `:108–109`) and `update-client-v2.4.0.sh`
(`:78–104`) rather than recalled. The saved spec was confirmed to be a verbatim byte-for-byte copy of
the text provided (609 lines) and to contain the §10.3 deferred marker and §10.6 As-Built Notes.
**Git:** uncommitted (commit-only-when-asked).

---

## 2026-08-30 — `failedAttemptThreshold` now actually governs login lockout (Module 10.5, Item 1)

**Context:** The Access Control dashboard let an admin set `failedAttemptThreshold`, and it
persisted to `security_settings` (`lib/db/src/schema/devices.ts:46`, PATCH at
`routes/admin.ts:558-561`). But enforcement lived in `lib/lockoutStore.ts`, whose per-bucket
`CONFIG` hard-coded `maxAttempts` (`user-login: 5`, `admin-login: 3`). The persisted value was read
nowhere in the lockout/auth path — so changing it in the UI saved successfully and silently did
nothing. Verified before changing: grep for `failedAttemptThreshold` showed it referenced only in
the schema default, `DEFAULT_SETTINGS` (`deviceStore.ts:102`), and the admin PATCH — never in
`lockoutStore.ts` or `auth.ts`.

**Decision & why:**
1. **Inject the threshold as an optional argument to `recordFailure(bucket, key, maxAttemptsOverride?)`
   rather than making the store read settings itself.** `lockoutStore.ts` stays synchronous and free
   of a dependency on `deviceStore` (which would be a new module cycle and would force *every* caller
   — admin-login, password-change — to become async). The login handler already had cheap access to
   the cached settings, so it passes the value in. This directly answers the brief's point 4 (no
   surprise async cascade): the two lockout functions keep their existing sync signatures; only
   `recordFailure` gained a trailing optional param, so no existing caller breaks.
2. **Read the value from the existing cached `getSecuritySettings()`** (`deviceStore.ts:110`,
   `CACHE_TTL_MS`-cached, invalidated by `invalidateSecuritySettingsCache()` on admin save). One
   `await getSecuritySettings()` added to the `/auth/login` handler (`routes/auth.ts`), reusing the
   same cache the device guard and session-TTL logic already hit — no new per-attempt DB round-trip.
3. **Scope the setting to the `user-login` bucket only.** The single UI/schema field maps cleanly to
   operator/QA/supervisor login. `admin-login` (3 attempts / 30-min) and `password-change` (3/hour)
   keep their stricter, deliberate PRD defaults — the one generic dashboard field should not silently
   *weaken* the admin-portal lockout from 3 to whatever an operator threshold is set to. At the
   default (5) behaviour is byte-identical to before. **This is a judgment call the brief left open;
   flagged for the user — trivial to extend to `admin-login` if that is wanted.**
4. **Fallback = the bucket default (5).** An absent or invalid override (`0`, negative, non-integer)
   falls back to `cfg.maxAttempts`, and `getSecuritySettings()` itself returns `DEFAULT_SETTINGS`
   (threshold 5) when no row exists — so a fresh install before first save locks out at 5 exactly as
   today. A threshold of 0 can therefore never disable lockout entirely.

**Rejected alternatives:** (a) Making `lockoutStore` import `getSecuritySettings` and turn async —
introduces a `lockoutStore → deviceStore` dependency and makes all three buckets' `recordFailure`
async, rippling into `admin.ts` and the password-change path for no benefit. (b) Applying the setting
to `admin-login` too — silently relaxes the admin portal's stricter lockout via a generically-labelled
field; rejected as a security regression by default. (c) Adding separate admin/duration settings
columns — a schema migration for scope the single existing field already covers; out of scope for a
"wire up the dead setting" fix. (d) Reading settings inside `checkLockout` — unnecessary; only
`recordFailure` uses the threshold (the trip comparison), `checkLockout` only reads `lockedUntil`.

**Touches:** `artifacts/api-server/src/lib/lockoutStore.ts` (optional `maxAttemptsOverride` param +
guarded use), `artifacts/api-server/src/routes/auth.ts` (fetch cached settings, pass threshold at both
`recordFailure("user-login", …)` sites), `artifacts/api-server/src/lib/__tests__/lockoutStore.test.ts`
(+4 unit tests), `artifacts/api-server/src/__tests__/threshold-lockout.test.ts` (new HTTP e2e). No
schema change. `admin.ts` / password-change path untouched.

**Verification:** `pnpm exec tsc --noEmit` clean. New unit tests prove a threshold of 3 trips at
exactly 3 (not 5), a threshold of 8 does not trip at 5, and invalid/absent overrides fall back to 5.
New HTTP test drives `/api/auth/login` with `getSecuritySettings` mocked to 3 → the 4th attempt is
`429 rate_limit_login`; mocked to 8 → the 6th attempt is still `401`, proving the old hard-coded 5 no
longer applies. Full suite: **262 passed / 12 skipped (25 files)**, up from 256/24. **Git:**
uncommitted (commit-only-when-asked).

---

## 2026-08-30 — Backup hardening: retention floor + off-disk enforcement + audit trail (Module 12, Item 2)

**Context:** `services/backup-service.ts` had two latent data-loss risks and a compliance gap, all
verified against the live code before changing:
- **Bug A (retention floor):** `pruneOldBackups()` deleted *every* `backup-*.sql` older than
  `BACKUP_RETENTION_DAYS` by mtime with no floor. Set retention low (or let a backup age out) and the
  prune could delete the only restorable snapshot — directly violating spec §12.2 ("Purge logic never
  deletes the single most recent successful backup").
- **Bug B (same-disk default):** `backupDir()` fell back to `path.resolve(process.cwd(), "backups")`
  when `BACKUP_DIR` was unset — i.e. `./backups`, on the *same physical disk* as the live DB. Spec
  §12.1 requires backups to live off-disk; a silent same-disk default protects against corruption but
  not disk failure, which is the whole point of a backup.
- **Gap (§12.3):** backup runs were recorded only in `backup_runs`; nothing fed the HMAC-chained
  security audit log, unlike every other admin-significant action.

**Decision & why:**
1. **Retention floor sourced from the DB, not the filesystem.** `pruneOldBackups()` now queries
   `backup_runs` for the most-recent `status='success'` row (`ORDER BY finished_at DESC LIMIT 1`) and
   never unlinks that `file_path`, regardless of age or retention math. The authoritative "newest good
   backup" is the DB record, not "newest file by mtime" (a half-written or failed dump file could be
   newer on disk). If that query *fails*, prune aborts entirely rather than risk deleting the last
   snapshot — fail-safe toward keeping data.
2. **No implicit backup directory.** `backupDir()` now throws when `BACKUP_DIR` is unset/blank. The
   `./backups` fallback is gone.
3. **Startup off-disk guard, fail-soft on the scheduler.** New `verifyBackupStorage()` resolves the
   Postgres data directory via `SHOW data_directory` and compares `st_dev` of `BACKUP_DIR` vs the data
   dir. Same device → refuse to schedule backups (loud `error` log). `admin-background-jobs.ts` gates
   `scheduleNextBackup()` on this check: a misconfig disables *only* the backup job — metrics, db-size
   sampling, and the whole API keep running. Chosen fail-**soft** (skip scheduling) over fail-**hard**
   (`process.exit`) deliberately: bricking a running production MES because backups are misconfigured
   is a worse outcome than backups being off with a screaming log. When the DB is remote or
   `data_directory` is unreadable (privilege), the disk is treated as different (safe) with an info log.
4. **`BACKUP_ALLOW_SAME_DISK=true` escape hatch.** Single-disk clients (the common on-prem case) can
   set this to run backups on the same disk; it downgrades the block to a `warn`, never silent.
5. **Audit trail (§12.3).** Added `BACKUP_STARTED` / `BACKUP_SUCCEEDED` / `BACKUP_FAILED` /
   `BACKUP_PRUNED` to the `AuditEvent` union and wired `auditLog()` into `runBackupNow` (start +
   terminal state, `operatorId = triggeredBy` so manual vs scheduled is distinguishable) and into each
   prune deletion. Reused the existing chained `auditLog()` (not `AuditService.recordAuditLog`, which
   inserts un-chained rows) so backup events join the tamper-evident chain.
6. **deploy-client.sh.** Left `BACKUP_DIR=/var/backups/$DB_NAME` (single-disk clients) but added
   `BACKUP_ALLOW_SAME_DISK=true` with an inline comment + handover note instructing the operator to
   mount a second disk / NAS, repoint `BACKUP_DIR`, and delete the override. Without this the new guard
   would silently disable the client's nightly backup on first deploy.

**Rejected alternatives:** (a) "Newest file by mtime" as the protected snapshot — a failed/partial
dump can have the newest mtime; the DB success record is authoritative. (b) `process.exit` on
misconfig — unacceptable blast radius for a production line tool; fail-soft + loud log instead.
(c) `AuditService.recordAuditLog` for backup events — writes rows with no `chain_hash`, which the
verifier skips; using chained `auditLog()` keeps backups inside the integrity chain. (d) Adding the
full §12.1/§12.2 admin-configurable schedule/retention schema (frequency enums, weekly/monthly tiers,
encryption flag) — out of scope for "fix the two data-loss bugs + audit gap"; deferred. (e) A hard
same-disk block with no override — would break every legitimate single-disk on-prem client on deploy.

**Touches:** `artifacts/api-server/src/services/backup-service.ts` (fail-loud `backupDir`, new
`verifyBackupStorage`, `dbDataDirectory`, prune floor + per-deletion audit, run start/terminal audit,
`pruneOldBackups` exported for tests), `artifacts/api-server/src/services/admin-background-jobs.ts`
(gate scheduler on `verifyBackupStorage`), `artifacts/api-server/src/lib/auditLogger.ts` (+4 backup
`AuditEvent`s), `scripts/deploy-client.sh` (off-disk comment + `BACKUP_ALLOW_SAME_DISK=true` + handover
note), `artifacts/api-server/src/services/__tests__/backup-service.test.ts` (new, 10 tests). No schema
change (`backup_runs` already had every column used).

**Verification:** `pnpm exec tsc --noEmit` clean. 10 new tests: prune keeps the protected newest
success while deleting stale files, audit-logs each deletion, no-ops on `retentionDays<=0`, aborts on
DB-read failure; `verifyBackupStorage` returns `ok:false` for unset `BACKUP_DIR` and for same-disk
without override, `ok:true` for same-disk *with* override (warns), for a remote/unreadable data dir,
and for a non-visible data dir. Full suite: **272 passed / 12 skipped (26 files)**, up from 262/12.
**Git:** uncommitted (commit-only-when-asked).


---

## 2026-08-30 — Handover converged onto the live session model + explicit Accept/Reject

**Context:** Operator handover was split across two disjoint session models and therefore
never actually worked end-to-end. The sender's modal (`HandoverModal.tsx`) posts to
`POST /api/sessions/:sessionId/handover`, which writes a co-owner row into
`changeover_operators` keyed on the **legacy integer** `sessionsTable`. The recipient's
dashboard banner polls `GET /api/verification/handover/pending`, which read
`session_handovers` keyed on the **text-id** `changeover_sessions` (`SMT_YYYYMMDD_NNNNNN`).
Verified against the live DB before touching anything: `sessions` = 36 rows,
`changeover_operators` = 38 rows (the live model); `changeover_sessions` = 0 rows,
`session_handovers` = 0 rows (dead). Two concrete defects followed:
**(D1)** a handover produced no banner for the recipient — the pending query could never
match, because nothing writes `session_handovers`; and **(D2)** there was no accept step at
all: the recipient silently gained full session access the instant the sender submitted,
since the inserted `changeover_operators` row is exactly what every ownership filter reads.
So the "Accept / Reject" buttons in the UI were decoration over endpoints operating on an
empty table.

The two judgment calls here were not specified by the brief, so they went through the
mandatory quiz-gate. Answers: **merge target = converge on the live model** (not the reverse,
and not a sync layer), and **accept step = explicit Accept/Reject** (recipient must act before
gaining access).

**Decisions & why:**

1. **`changeover_operators` is the single handover record; `session_handovers` is dead.**
   It is already the access-control backbone — read by `assertOwnership`, `GET /sessions`,
   `GET /sessions/latest`, `GET /sessions/:id`, the handover-initiate authz check, and the
   verification listing subquery. Making the *banner* read the same table it already writes
   removes the split-brain entirely rather than bridging it. No new table, no migration of
   live rows.

2. **A `status` column on `changeover_operators` (`accepted | pending | rejected`) is what
   gates access — not the presence of a row.** Additive columns only:
   `status text NOT NULL DEFAULT 'accepted'`, `from_operator_id uuid`, `notes text`,
   `accepted_at timestamp`. Defaulting to `'accepted'` means all 38 existing rows keep the
   access they already had — the change is a no-op for current sessions. Applied to the dev
   DB with an idempotent `ADD COLUMN IF NOT EXISTS` block in
   `lib/db/src/create-changeover-operators-table.ts` so a later `drizzle-kit push` sees no
   diff (push needs an interactive TTY against the drifted dev DB).

3. **Every ownership read now requires `status = 'accepted'`.** Six sites: `assertOwnership`
   (`sessions.ts`), `GET /sessions`, `GET /sessions/latest`, `GET /sessions/:id` membership,
   the handover-initiate authz check, and the `verification.ts` listing subquery. This is
   what makes "pending" mean something — a handed-over-but-unaccepted operator sees the
   session in their banner and *nowhere else*. Gating the initiate check too means a pending
   recipient cannot re-hand a session they have not yet taken responsibility for.

4. **Handover writes the recipient as `pending` with provenance; a supervisor recipient is
   written `accepted`.** The operator row carries `fromOperatorId` + `notes`, which is what
   the banner renders ("From: X · when · why") — so the incoming-handover list reads from the
   live session model instead of the unused `session_handovers`. `onConflictDoUpdate` on
   `(session_id, operator_id)` re-arms a fresh pending handover when the same operator was
   previously handed the session and rejected it; without it the unique index would silently
   swallow the retry. Supervisors are privileged and bypass the ownership filters anyway, so
   an Accept step for them would be a no-op prompt.

5. **`pending` / `accept` / `reject` were repointed in place — same URLs, same response
   shape.** `GET /verification/handover/pending` now joins `changeover_operators` →
   `sessions` → `users` (on `from_operator_id`) filtered to `operatorId = actor`,
   `status='pending'`, `role='handover'`, excluding soft-deleted sessions, and still returns
   `{ handovers, total }` with `initiatedAt` mapped from `added_at`. Accept flips the caller's
   row to `accepted` + stamps `accepted_at`; Reject flips it to `rejected`. Both are keyed on
   `(sessionId, actor.id)`, so the lookup *is* the authorization check — a non-recipient has
   no pending row and gets 404 rather than a separate 403 branch.

6. **Accept no longer mutates session status.** The old accept handler set
   `changeover_sessions.status = 'active_splicing'` and stamped `splicing_operator_id`. On the
   live model, session lifecycle (`active → pending_qa → qa_confirmed → …`) is orthogonal to
   co-ownership; forcing a session into a splicing state as a side effect of accepting custody
   would corrupt the QA flow. Reject likewise reverts nothing: the sender keeps their own
   `accepted` row, so the session simply stays with them.

7. **The orphan `POST /verification/handover/:sessionId` initiate endpoint was left in place,
   marked DEPRECATED.** It writes the dead model and has no callers (the UI uses
   `POST /api/sessions/:sessionId/handover`). Left as a 404-on-missing-session no-op rather
   than deleted, so any out-of-tree client fails cleanly instead of crashing; the comment says
   not to build on it.

8. **Frontend: types only.** `dashboard.tsx` had `id`/`sessionId` typed `string` (dead-model
   text ids); they are now `number`, `encodeURIComponent` was dropped from the accept/reject
   URLs, and the banner shows `Changeover #N` instead of `sessionId.slice(0, 8)…` (which
   would throw on a number). Accept also invalidates the sessions query, since gaining access
   changes the scoped list.

**Rejected alternatives:** (a) Converge the other way — move ownership onto
`changeover_sessions` / `session_handovers`. Rejected: it would migrate 36 live sessions +
38 co-owner rows onto a 0-row model and rewrite six working ownership filters, all to adopt
the model nothing writes. (b) A sync layer keeping both tables in step. Rejected: doubles the
write path and preserves the split-brain as permanent complexity. (c) Auto-accept (row appears,
access granted, banner is informational). Rejected at the quiz-gate — the user chose explicit
Accept/Reject; on an MES the point of a shift handover is a recorded transfer of
responsibility, and silent access is exactly defect D2. (d) A separate `handover_status` table
instead of a column. Rejected: one nullable column set on a row that already exists beats a
join. (e) Deleting `session_handovers` / the orphan initiate route. Rejected as out of scope
for this item — flagged, not removed. (f) Deriving pending state from `role='handover' AND
accepted_at IS NULL`. Rejected: it cannot represent `rejected`, so a rejected handover would
be indistinguishable from a fresh one.

**Touches:** `lib/db/src/schema/sessions.ts` (+4 columns on `changeoverOperatorsTable`),
`lib/db/src/create-changeover-operators-table.ts` (idempotent `ADD COLUMN IF NOT EXISTS`
block), `artifacts/api-server/src/routes/sessions.ts` (pending+provenance insert with
`onConflictDoUpdate`, supervisor inserted accepted; `status='accepted'` added to four
ownership reads + the initiate authz check), `artifacts/api-server/src/routes/verification.ts`
(listing subquery gated; `pending`/`accept`/`reject` rewritten onto the live model; orphan
initiate marked deprecated), `artifacts/feeder-scanner/src/pages/dashboard.tsx` (numeric ids,
banner label, query invalidation), `artifacts/api-server/src/__tests__/integration/handover-accept.test.ts`
(new, 7 tests).

**Verification:** `pnpm run typecheck` clean across all 5 workspaces (the schema change
surfaced 21 type errors at the six call sites first — a useful check that no ownership read
was missed). New integration test asserts the full chain: B has no access → A hands over → B
sees it pending with `fromOperatorName`/`notes` → B still 403 and the session is absent from
B's scoped list → B accepts → B has access and the pending list empties → double-accept 404s
→ reject leaves B without access → a rejected handover can be re-armed → a non-recipient
cannot accept. Ran against a real schema in a scratch DB (`smtverification_test`, created
locally and `drizzle-kit push`ed; the dev DB was not used): **288 passed / 4 skipped** with
`DATABASE_URL_TEST` set. Default suite (integration gated off): **273 passed / 19 skipped
(27 files)**, plus feeder-scanner **25 passed**.
**Git:** uncommitted (commit-only-when-asked).

---

## 2026-08-30 — Spec reconciled with as-built: Module 1.3 superseded, Module 4 amended

**Context:** The implementation spec (`.dev-docs/changeover-handover-implementation-spec.md`) is
written to be handed to a developer or pasted into an AI assistant *as instructions*. Two of its
sections describe behaviour that was deliberately never built, so anyone (human or model) picking
it up would re-implement removed features and contradict the shipped system:

- **Module 1.3 "Skip-BOM Approval Gate"** still specifies a QA-or-Supervisor approver record
  (`approver_role`/`approver_id`/`approval_remarks`) that must **block changeover progression**.
  That entire workflow was removed on 2026-08-26 in favour of the supervisor-only *Trial Session*
  model (verified in code: `sessions.ts` returns
  `403 "Only a supervisor can start a trial (skip-BOM) changeover"`, and the approver columns are
  written with `role: 'supervisor'`, name = creator, remarks `NULL` — provenance, not approval).
  Module 1.2 also still asserted the blocking rule, and two other sections cross-referenced
  "Module 1.3 rules" as if the gate existed.
- **Module 4.3/4.4/4.5** specifies immediate ownership transfer plus a login popup and a
  supervisor+QA "Continue Changeover" gate. As of the Item 3 fix earlier today, transfer is
  two-phase (pending → Accept) and the popup/continuation gate do not exist — there is a dashboard
  banner with Accept/Reject.

**Decisions & why:**

1. **Mark 1.3 SUPERSEDED and keep the original text collapsed, rather than deleting it.** A
   status blockquote at the top states it was not built and points at the 2026-08-26 decision
   entry; the authoritative as-built behaviour (supervisor-only 403, no approval, provenance
   columns, operator-invisible, `bom_verification_skipped` as the trial marker) is written out
   above the original, which is folded into a `<details>` block labelled "not implemented". *Why
   keep it:* the spec is the requirements record — deleting a requirement erases the fact that it
   was considered and consciously dropped, which is what makes it get re-proposed. *Why collapse
   it:* leaving it inline as normal prose is what caused the problem, since the document reads as
   instructions.

2. **Fixed 1.2 and the two stale cross-references.** 1.2's "MUST require an approval before the
   changeover can proceed" now states the trial/supervisor-only rule with the superseded original
   noted parenthetically. Module 6.1's "Approval details (if BOM was skipped — Module 1.3)" became
   trial-session provenance; Module 11.5's "escalate per Module 1.3 rules" became "escalate to
   QA/Supervisor" (1.3 never contained escalation rules — it was a mis-reference).

3. **Module 4 gets an amendment subsection (4.8), not a rewrite.** Mirrors the existing
   `10.6 Amendment — As-Built Notes` convention already in this spec, so all as-built deltas read
   the same way: keep the original requirement text, append a dated amendment that names which
   sub-sections it refines and links the decision entry. 4.8 records the two-phase Accept model,
   that 4.4/4.5 (popup + supervisor/QA continuation gate) are not built, that dual visibility
   applies only post-Accept, and that the `changeover_sessions`/`session_handovers` pair and the
   deprecated initiate route must not be built on.

**Rejected alternatives:** (a) Delete Module 1.3 outright — loses the record that the approval gate
was requested and rejected, inviting its return. (b) Rewrite 1.3 in place as if the trial model had
always been the requirement — falsifies the requirements history and hides a deliberate scope
change from the client. (c) Put the as-built notes only in `decision.md` — the spec is what gets
pasted into an AI assistant; a correction nobody reads is not a correction. (d) A single global
"see decision.md for deviations" header — too coarse to prevent re-implementing a specific
blocking gate. (e) A new amendment section for Module 1 mirroring 10.6 — 1.3 is not a *refinement*
of the original, it is a replacement, so an inline status marker is the honest framing.

**Touches:** `.dev-docs/changeover-handover-implementation-spec.md` only — Module 1.2 (rule
restated), Module 1.3 (SUPERSEDED marker + as-built behaviour + original collapsed), Module 4.8
(new amendment subsection), Module 6.1 and Module 11.5 (stale 1.3 cross-references). **No code,
schema, or behaviour change** — documentation only, by design.

**Verification:** as-built claims checked against live code before writing (the supervisor-only
403 and the provenance-column insert in `sessions.ts`; the pending/accept/reject handlers in
`verification.ts`; the dashboard banner in `dashboard.tsx`). `grep` confirms no remaining
"Module 1.3" reference implies a live approval gate. No test or typecheck impact — docs are not
compiled; the suite is unchanged from the Item 3 entry above (273 passed / 19 skipped, 288/4 with
`DATABASE_URL_TEST`).
**Git:** uncommitted (commit-only-when-asked).

## 2026-08-31 — Module 13: session expiry → automatic redirect to the role-correct login

**Context:** When an access session expires (or is revoked), the client had no coherent story.
Only one of the three request wrappers handled 401 at all — `src/lib/api.ts` did
`window.location.assign("/login")` — and the app has three genuinely separate login surfaces
(Module 10.4): the shop-floor `/login` role picker, the store window at `STORE_ROUTE`, and the admin
portal at `ADMIN_ROUTE` (own `smt_admin_token`, rendered inline by `AdminGate`). So an expired
storekeeper or admin was thrown out of their own portal onto the operator login. The other ~113 raw
`fetch()` calls and the two background pollers (notifications 15 s, dashboard handover 30 s) had no
handling — an expired poll would 401 in a loop or throw into the console. There was also no
*proactive* path: `/auth/me` didn't expose the token expiry and `verifyAccessToken` discards `exp`,
and `POST /auth/refresh` — fully built (rotation + reuse/fingerprint detection) — was never called by
any client. Spec Module 13 requires this be "implemented once as a shared client-side
interceptor/guard, not re-implemented per dashboard."

**Decisions & why:**

1. **One reactive guard on the `window.fetch` patch in `main.tsx`, delegating to a framework-free
   `src/lib/session-guard.ts`.** The repo already patches `window.fetch` there to inject
   `X-Requested-With` for exactly this "no caller can forget" reason, so 401 handling rides the same
   seam and covers all three wrappers, every raw fetch, and both pollers at once. The patch only
   *observes* status and passes the response through untouched, so each caller still runs its own
   error handling. Quiz-gate answer #1.

2. **Route the redirect by pathname prefix, not a hardcoded `/login`.** `loginSurfaceForPath()` maps
   `STORE_ROUTE*→STORE_ROUTE`, `ADMIN_ROUTE*→ADMIN_ROUTE`, else `/login`. A full
   `window.location.assign` (not SPA nav) so every stale poller/timer/cached query is torn down —
   directly satisfies "should not silently retry forever." A module-level latch collapses a burst of
   simultaneously-failing requests into exactly one navigation.

3. **Exempt the credential-check and probe endpoints from the reactive redirect.** `login`,
   `verify-password`, `verify-override`, `change-password` all 401 on a *wrong password* — redirecting
   would bounce the user off the form. `auth/me` and `admin/auth/me` 401 normally when logged out (the
   React layer renders login inline) — redirecting would reload-loop. `auth/refresh` is owned by the
   proactive timer. Everything else `/api/*` → expired session → redirect.

4. **Proactive expiry via `expiresAt` from the server + silent refresh.** Added
   `accessTokenExpirySec()` (a separate read since `verifyAccessToken` drops `exp`), and `/auth/login`,
   `/auth/refresh`, `/auth/me` now return `expiresAt` in epoch **ms**. `AuthProvider` schedules a timer
   `REFRESH_LEAD_MS` (60 s) before expiry that calls `POST /auth/refresh`; success reschedules against
   the new deadline, failure runs the same redirect. The functional `setExpiresAt` only accepts an
   expiry that moved *forward* (guards against a same/earlier deadline giving `delay=0` and spinning);
   otherwise it falls back to `null` and lets the reactive guard be the net. Quiz-gate answer #2.

5. **The "Session expired — please log in again." notice survives the reload via
   `sessionStorage`.** The guard sets a one-shot flag; all three login screens read-and-clear it on
   mount (lazy `useState` initialiser, consumed once even under StrictMode) and show an amber banner.
   Spec (c): re-entering data after re-login is acceptable, a *silent* jump is not.

6. **`/auth/refresh` now re-applies the per-device TTL (Module 10.3).** Pre-existing latent bug:
   refresh re-signed with the default 30-min TTL, harmless only because no client ever called it. Now
   that the timer refreshes automatically, that would let a store/admin device silently escalate its
   session timeout past `security_settings` on every refresh. Reads `sessionTtlForDevice` the same way
   login does. In-scope because Module 13 is what first exercises the route.

**Rejected alternatives:** (a) Add 401 handling to each of the three wrappers — the exact
"fixed in one place, still broken in another" bug the spec names; leaves the 113 raw fetches and the
pollers uncovered. (b) A React error-boundary / interceptor inside the component tree — can't see
raw `fetch()` calls or background polls, and the admin sub-app has its own tree. (c) Clear the token
client-side on the timer instead of calling refresh — throws away the fully-built rotation plumbing
and forces a re-login every 30 min even for an active user. (d) Read the error *code* from the 401
body to decide expiry-vs-wrong-password — requires cloning every 401 response body; a static path
exemption list is synchronous and sufficient since the credential endpoints are a known small set.
(e) SPA navigation instead of full reload — leaves stale pollers and React-Query caches alive, which
is what "retry forever" warns against.

**Touches:** server — `lib/authTokens.ts` (`accessTokenExpirySec`), `routes/auth.ts` (`expiresAt` on
login/refresh/me, per-device TTL on refresh). client — new `lib/session-guard.ts`; `main.tsx`
(fetch-patch 401 hook); `lib/api.ts` (removed the hardcoded `/login` redirect — the guard owns it);
`context/auth-context.tsx` (capture `expiresAt`, silent-refresh timer, shared hint key);
`pages/login.tsx`, `store/StoreLogin.tsx`, `admin/pages/AdminLogin.tsx` (expiry notice). tests — new
`lib/__tests__/session-guard.test.ts` (15 tests: surface routing, exemptions, latch, notice) and 6
new cases in `auth-gates-l0.test.ts` (`accessTokenExpirySec` + `/auth/me` `expiresAt`).

**Verification:** `pnpm run typecheck` clean. api-server **277 passed / 19 skipped** (was 273/19 —
+6 Module 13 cases, and the L0 file's admin-me cases). feeder-scanner **40 passed** (was 25 — +15
session-guard). The two `DATABASE_URL_TEST`-gated integration files (`loginChangeoverFlow`,
`feederFlow`) fail on teardown with a pre-existing `login_events_user_id_fkey` violation
(`delete from users` while a `login_events` row references it) — confirmed present on stock `main`
with my changes stashed, so **not caused by this work**; flagged, not fixed. `handover-accept`
integration (7 tests) unaffected.
**Git:** uncommitted (commit-only-when-asked).

---

## 2026-08-31 — Module 14: notification bell scoped to the actor + per-user seen

**Context:** The header bell was fed by every local toast (both toast entry points called
`useNotificationBellStore.record()`), so scan results and other transient per-screen toasts polluted
a surface operators read as a durable, cross-device inbox. There was no server-side history, no
per-user unread state, and no way for one role's message to reach only that role. `GET
/api/notifications` existed but returned an unscoped global list with no seen flag.

**Decision & why:**
1. Server is the source of truth. The bell now reads `GET /api/notifications` (react-query, 15s
poll) and no longer records local toasts. Removed both `record()` writers (`use-notification.ts`,
`NotificationSystem.tsx`) and deleted the orphaned `useNotificationBellStore`. Scan toasts never
called `pushNotification`, so this alone stops them reaching the bell.
2. Per-user seen via a join table `notification_seen(notification_id, user_id, seen_at)` with a
unique `(notification_id, user_id)` index — NOT a single `seen_at` column on the row. A role-/global-
targeted row is seen by many users independently; one column cannot represent that. `GET` left-joins
the table for the caller and returns `seen: seenAt !== null`.
3. Visibility filter: a row is visible when un-targeted (global) OR `target_role = caller.role` OR
`target_user_id = caller.id`; supervisor and admin see everything (oversight → no WHERE fragment).
Implemented as `visibilityFilter()` returning a drizzle `SQL | undefined`.
4. `POST /notifications/seen { ids }` records seen rows for the caller, but first re-filters the ids
through the same visibility filter, so a client cannot mark another user's targeted row seen. Insert
is `onConflictDoNothing` (idempotent); history is never mutated or deleted. The bell marks the
currently-shown unread ids on open ("auto-clear on view").
5. Targeting is set at each `pushNotification` site via new optional `NotificationInput` fields
(`eventClass, targetRole, targetUserId, relatedEntityType, relatedEntityId, createdByUserId`), all
nullable. BOM events → `target_role: "qa"` (supervisor/admin covered by oversight); QA requests →
`qa`; QA results → `target_role: "operator"`; handover → `target_user_id` = recipient.
6. Admin broadcast: `POST /api/admin/notifications/broadcast` (admin-cookie + IP-guarded) writes one
`event_class: "broadcast"` row, either global (`targetRole: "all"` → un-targeted) or a single
validated role; audited as `NOTIFICATION_BROADCAST`.

**Rejected alternatives:**
(a) Single `seen_at` column on the notification row — cannot express per-user seen for shared
(role/global) rows; whoever opened the bell first would clear it for everyone.
(b) Keep the client bell store and just filter which toasts get recorded — leaves unread state
device-local and lost on reload, and still gives no cross-device/server history.
(c) Name→id lookup to target QA results at the one operator — legacy sessions store `operatorName`,
not a reliable userId; a fragile join. Chose `target_role: "operator"` (every operator on the line
sees it; supervisor/admin oversee). Tradeoff: not narrowed to a single operator, accepted for
reliability.
(d) A separate `target_roles` array for BOM (needs qa AND supervisor) — unnecessary: the
supervisor/admin oversight rule already covers supervisor, so a single `target_role` column suffices.

**Touches:** db — `schema/notifications.ts` (6 nullable cols + 2 indexes on `notifications`; new
`notification_seen` table + unique/user indexes); new idempotent migration
`add-notification-targeting.ts`. server — `lib/notify.ts` (extend `NotificationInput` + insert);
`routes/notifications.ts` (rewrite: `visibilityFilter`, scoped GET with per-user seen join, `POST
/seen`); `routes/{bom,sessions,verification}.ts` (retarget/classify existing `pushNotification`
calls); `routes/admin.ts` (broadcast route); `lib/auditLogger.ts` (`NOTIFICATION_BROADCAST` event).
client — `components/NotificationBell.tsx` (server-backed, mark-seen-on-open, no clear-all);
`components/NotificationSystem.tsx` + `hooks/use-notification.ts` (drop bell-store `record()`);
deleted `store/useNotificationBellStore.ts`. tests — new `admin-notification-broadcast.test.ts` (6)
and `integration/notification-scope.test.ts` (7, `DATABASE_URL_TEST`-gated).

**Verification:** `pnpm run typecheck` clean. api-server default suite (integration off) **283 passed
/ 19 skipped** (was 277 — +6 broadcast cases). feeder-scanner **40 passed** (bell rewrite + store
deletion broke no tests; nothing referenced the deleted store). With `DATABASE_URL_TEST` set against
a fresh `smtverification_test` (schema `drizzle-kit push`ed) the new `notification-scope` integration
passed **7/7** (operator/qa/supervisor visibility matrix; per-user seen isolation A vs B;
cannot-mark-invisible → `marked: 0`; idempotent re-mark). Full DB-backed run: **304 passed / 1 failed
/ 4 skipped** — the single failure is `feederFlow` returning 401 mid-scan on a bare scratch DB (no
seed/security_settings); confirmed pre-existing by stashing the scan-path changes and re-running
(identical 401), so **not caused by this work**. Scratch DB dropped after the run.
**Git:** uncommitted (commit-only-when-asked).

## 2026-08-31 — Module 15: session final-report PDF archived to a fixed filesystem root

**Context:** Every session final report is generated on demand and streamed straight to the operator
(`doc.pipe(res)` in `routes/sessions.ts` `/sessions/:id/report/pdf`) — nothing was ever persisted, so
there was no server-side record of what was delivered and no way to re-obtain a past report without
re-rendering (and a re-render is not guaranteed byte-identical as upstream data drifts). Module 12
already established the "fixed off-disk storage root + fail-loud env var + same-disk check + DB record
row" pattern for backups; Module 15 applies the same shape to reports, but softer (reports are not DR
snapshots).

**Decision & why:**
1. **Tee the exact stream, don't re-render.** The archive is the *same* PDFKit output the operator
downloaded: `doc.pipe(res)` **and** `doc.pipe(archive.stream)`. Byte-identical by construction, no
second generator to drift, and the sha256 we record is the checksum of precisely what was served.
2. **One canonical archive per session, deduped.** Recorded per `(report_type, related_entity_id)`
with a unique index; `beginReportArchive` short-circuits to `null` if the entity is already archived,
so re-downloads never pile up duplicate files or rows. A lost dedup race (concurrent re-download →
`onConflictDoNothing` returns 0 rows) unlinks the now-redundant file so the archive stays exactly
one-per-entity.
3. **Session PDF only** — the inline-streamed report. `ExportService` file-writing reports
(analytics/BOM in `routes/reports.ts`) are out of scope: they already land on disk, and the module is
about capturing the *streamed* artifact that otherwise vanishes.
4. **Fail-loud when unset; same-disk is a warning, not a block.** `REPORT_ARCHIVE_ROOT` unset/blank →
archival DISABLED with a loud `logger.error`, but report *delivery* is unaffected (the download still
works). If the archive root shares a physical disk with the Postgres data dir we `logger.warn`
(compared via `st_dev` vs `SHOW data_directory`); `REPORT_ARCHIVE_ALLOW_SAME_DISK=true` acknowledges
and downgrades to `info`. Unlike backups (Module 12, which *refuses* to schedule on same-disk),
reports are not DR backups, so same-disk never blocks.
5. **Archival must never break report delivery.** All archive work is wrapped: setup failures return
`null`, the write stream has an isolated `error` handler (a full disk logs + skips the DB row instead
of crashing the response pipe), and `finalize()` swallows+logs every error. The HTTP response path is
never coupled to archive success.

**Rejected alternatives:**
(a) Re-render the report server-side for the archive — a second code path that can silently diverge
from what the operator received; the tee guarantees identity with zero duplication.
(b) One row/file per download (audit-style history) — reports are deterministic per session; N copies
of the same artifact waste disk and obscure the canonical one. Chose dedup + race-loss cleanup.
(c) A hard block / refuse-to-serve on same-disk (mirroring backups exactly) — too aggressive: a
missing/misconfigured archive must never stop an operator downloading their report. Downgraded to a
warning with an explicit ack env var.
(d) Store the PDF as a DB blob — bloats the DB and the backup set; the filesystem root (path + size +
sha256 recorded in `report_archive_record`) matches the existing backup-file pattern.

**Touches:** db — `schema/admin.ts` (`reportArchiveRecordTable` + `ReportArchiveRecord` type; unique
`report_archive_type_entity_idx` on `(report_type, related_entity_id)` + `report_archive_type_idx`);
new idempotent migration `add-report-archive-record.ts`. server — new
`services/report-archive-service.ts` (`beginReportArchive` → tee sink: dir
`{root}/{year}/{month}/{report_type}/{entity}_{ts}.pdf`, streaming sha256, dedup + race-loss unlink,
same-disk warn); `routes/sessions.ts` (`/report/pdf`: open sink after `doc.pipe(res)`, `doc.pipe(
archive.stream)`, `await archive.finalize()` after `doc.end()`). tests — new
`services/__tests__/report-archive-service.test.ts` (5). config — `REPORT_ARCHIVE_ROOT` (+ optional
`REPORT_ARCHIVE_ALLOW_SAME_DISK`).

**Verification:** `pnpm run typecheck` clean. `report-archive-service.test.ts` **5/5** (unset root →
`null` + error logged; already-archived → `null`, no file created; happy path → file tee'd under
`{root}/.../session/42_…​.pdf`, row records `file_size_bytes` = on-disk size and a 64-hex sha256; lost
race `insert []` → file unlinked; same-disk with ack → `info` not `warn`). Full api-server default
suite (integration off) **288 passed / 26 skipped (30 files)** (was 283/19 — +5 archive unit tests,
+7 skipped from the still-gated notification-scope integration file). feeder-scanner **40 passed (3
files)** (server-only change; unaffected). Migration validated against a fresh scratch DB
(`smtverification_m15test`): ran twice → idempotent (`IF NOT EXISTS` no-op on rerun); resulting table
columns + both indexes match `schema/admin.ts` exactly; scratch DB dropped. `add-report-archive-
record.ts` **not yet run against the dev DB** — run it (or `drizzle-kit push`) before enabling the
feature there.
**Git:** uncommitted (commit-only-when-asked).

## 2026-08-31 — Security audit Item 1: deleted stale insecure `src/app.js` / `src/index.js`

**Context:** `artifacts/api-server/src/app.js` (+ `src/index.js`) sat next to the real `.ts` sources,
both git-tracked, dated Aug 7. `app.js:27` was `app.use(cors())` — wide open, no origin restriction —
versus `app.ts`'s strict `ALLOWED_ORIGINS` gate. Production was safe only by an implicit resolution
property (esbuild tries `.ts` before `.js`, and the deployed process runs the bundled `dist/index.mjs`
built from `src/index.ts`). Any alternate run path (`node src/index.js`, a dev launcher, a JS-first
resolver) could silently execute the insecure CORS config with no warning.

**Decision & why:** Delete both files. First proved they are dead code, not just unused-by-luck:
(1) `build.mjs:18` entry is `src/index.ts`; (2) the systemd launcher `/usr/local/bin/start-smtverify-
api.sh` runs `dist/index.mjs`; (3) no `.sh`/deploy/CI step invokes `node src/index.js` / `src/app.js`
(grep clean); (4) CI only greps `src/app.ts`; (5) every test imports `"../app"` extensionless, and the
`cors-origin` test loads that import and asserts a 403 for `evil.example.com` — it passes, empirically
proving vitest resolves the import to the strict `app.ts`, not `app.js`. So deletion changes no runtime
or test behavior; it removes a latent foot-gun.

**Rejected alternatives:**
(a) Leave them and add `.js` to `.gitignore` / a lint rule — the files would still exist on disk and
be executable by an alternate entry point; deletion is the only real fix.
(b) Rewrite `app.js` to mirror `app.ts`'s strict CORS — pointless duplication of a file that should not
exist; it would drift again.
(c) `git rm` (stage the deletion) — used plain `rm` to keep the change unstaged (commit-only-when-
asked); the tracked-file deletion still shows in `git status`.

**Touches:** deleted `artifacts/api-server/src/app.js`, `artifacts/api-server/src/index.js`. No source,
build, test, or deploy file edited.

**Verification:** `node build.mjs` succeeds → `dist/index.mjs` (5.1 MB) produced. `pnpm run typecheck`
clean. api-server suite **288 passed / 26 skipped (30 files)**; feeder-scanner **40 passed (3 files)** —
unchanged from before deletion, confirming nothing imported the `.js` files. Booted `dist/index.mjs`
(`DOTENV_CONFIG_PATH=../../.env`, PORT 4055): logged `Server listening on http://0.0.0.0:4055`, and
`GET /api/health` → **HTTP 200** `{"status":"ok","db":{"ok":true,...}}`. Process stopped after the
check. (Pre-existing `BACKUP_DIR unset` error at boot is unrelated to this item.)
**Git:** uncommitted (commit-only-when-asked).

## 2026-08-31 — Security audit Item 2: boot guard refuses TRUST_PROXY-active + COOKIE_SECURE=false

**Context:** `TRUST_PROXY` (`app.ts:33-35`) makes Express trust `X-Forwarded-For` for `req.ip`, which
`deviceGuard` uses for the entire Module 10 IP allow-list. Enabled without a real reverse proxy in
front (one that overwrites the header), any client can spoof `X-Forwarded-For` to an allow-listed IP
and bypass device restriction. `COOKIE_SECURE=false` (`routes/auth.ts:68`) is an intentional escape
hatch for LAN-over-HTTP installs (plaintext session cookies). The two TOGETHER — proxy trust without a
proxy, on a plaintext-cookie install — is the realistic `.env`-copied-from-wrong-env misconfiguration
that defeats the security model with no visible symptom until exploited.

**Decision & why:** Add a startup gate in `lib/validateEnv.ts` (where required-env validation already
lives, run at `app.ts:22` before anything binds). New pure helper `checkProxyCookieSafety(env)` returns
an error string when the dangerous combo is present, else null; `validateEnv()` calls it and
`process.exit(1)` with that message. **Hard failure, not a warning** — the audit found warning-only
guards (bootstrap allow-all) get left in place unnoticed, so this blocks startup outright. "Proxy trust
active" matches app.ts's own set-condition exactly: `TRUST_PROXY` set, not `"false"`, and not `"0"` (0
hops = don't trust XFF) — so it fires for `"true"`, a positive hop count, and an IP/subnet/`loopback`
spec. `COOKIE_SECURE=false` is the exact string check `routes/auth.ts` uses. The error names the risk
(IP-spoof bypass + plaintext cookies) and the two fixes (real proxy + `COOKIE_SECURE=true`, OR unset
`TRUST_PROXY` for direct LAN).

**Rejected alternatives:**
(a) Warn-only log — explicitly rejected by the finding; unnoticed warnings are how this class of
misconfig survives to production.
(b) Restrict the trigger to literally `"true"` / hop-count>0 (per the finding's parenthetical) — an
IP/subnet trust value equally enables XFF trust, so limiting to those two would leave a real hole.
Broadened to app.ts's "is trust proxy on" definition; `"0"` and unset stay safe. Documented the exact
trigger set so it reads as intentional.
(c) Put the check in `app.ts` inline next to `app.set("trust proxy", …)` — less testable; a pure helper
in `validateEnv.ts` unit-tests without spawning a process, and keeps all config gating in one place.

**Touches:** `artifacts/api-server/src/lib/validateEnv.ts` (new `checkProxyCookieSafety` + call in
`validateEnv`); new `src/lib/__tests__/validateEnv.test.ts` (8 tests); `.env.example` (documented
`TRUST_PROXY` + the startup gate next to `COOKIE_SECURE`, so it reads as an intentional gate).

**Verification:** `pnpm run typecheck` clean. New guard test **8/8** (dangerous: true/hop-count/subnet ×
`COOKIE_SECURE=false` → message; safe: both unset, proxy-only, secure cookies, `COOKIE_SECURE=false`
alone, `false`/`0` proxy, whitespace-only → null). Full api-server suite **296 passed / 26 skipped (31
files)** (was 288/26 — +8). End-to-end against a fresh `node build.mjs` bundle: dangerous combo
(`TRUST_PROXY=true COOKIE_SECURE=false`) → process **exits 1** and logs the `Refusing to start:` message;
safe combo (`TRUST_PROXY=true COOKIE_SECURE=true`) → `Server listening on http://0.0.0.0:4057`. No
existing config-validation test affected (no test sets these env vars).
**Git:** uncommitted (commit-only-when-asked).


## 2026-08-31 — Security audit Item 3: verified real `.env` / backup / archive permissions (supersedes "sudo-only folder")

**Context:** The earlier "put `.env` in a sudo-only folder" request was never actually verified against
the live filesystem — and the standing memory (`env-secrets-layout`) claimed this deploy dir is an
`ntfs-3g` mount showing a "misleading 777" that can't honor Unix bits, and that root `.env` is a symlink
into the workspace. Item 3 was to establish the *real* enforced permissions and fs semantics before
declaring any lockdown "done", and to apply a straightforward `chmod` only if this is a native-behaving
fs (else stop and ask before any relocation/mount change).

**Findings (measured, not assumed):**
- **Filesystem is `ntfs3` (in-kernel driver) mounted with `acl`**, `uid=1000,gid=1000` — a single-user
  mount. `chmod` **is honored and persists** here (proven empirically 600→644→640). This **overturns the
  memory's `ntfs-3g` "misleading 777" assumption** — that note was stale; Unix mode bits are real on this
  mount.
- Root `.env` is a **regular file at `600`**, not a symlink (memory's symlink layout is also stale).
  `artifacts/api-server/.env`, all `.env.bak-*`, `.env.dev`, and `artifacts/feeder-scanner/.env` were
  already `600`. Good.
- **`feeder-verification/.env` was `764` (`-rwxrw-r--`) — world-readable — and contains real secrets**
  (`DATABASE_URL`, `JWT_SECRET`, `NEXTAUTH_SECRET`, `CRON_SECRET`). A genuine local-read exposure.
- `backups/` (empty, `.gitkeep` only) and `artifacts/api-server/backups/` (14 real DB dumps, up to
  ~121 MB) were dirs at `775`; the `.sql` dumps were `644`/`664` — **world-readable full-database dumps**
  (credentials-at-rest, session data, audit rows).
- `BACKUP_DIR` and `REPORT_ARCHIVE_ROOT` are **both UNSET** in root `.env`, so scheduled backups and the
  M15.3 report archive are disabled at runtime (confirmed by the boot log: "BACKUP_DIR unset"); no report
  archive dir exists to lock down. The 14 dumps are historical/manual, not from an active job.
- **No secrets are in git**: both the `.sql` dumps and `feeder-verification/.env` are gitignored
  (`git check-ignore` = ignored, `git ls-files` empty). The exposure is on-disk-local only.

**Decision & why:** This is exactly the finding's "straightforward `chmod` on a native fs that simply
wasn't applied" case, so I applied it (no confirmation gate needed; no relocation): `chmod 600
feeder-verification/.env`; `chmod 700 backups artifacts/api-server/backups`; `chmod 600
artifacts/api-server/backups/*.sql`. `600`/`700` (owner-only) matches the mode the other `.env` files
already use and the single-user `uid=1000` mount. The earlier "sudo-only folder" goal is met by
owner-only bits on this mount — the folder is already owned solely by uid 1000; a root-owned/sudo dir
would add nothing a local single-user box doesn't already have, and would need explicit sign-off.

**Rejected alternatives:**
(a) Relocate `.env`/backups off the NTFS mount or into a root-owned sudo-only directory (the original
phrasing). Rejected: the mount honors Unix perms and is already single-user `uid=1000`; `600`/`700`
achieves owner-only at-rest, so a relocation/mount-level change is unwarranted — and per protocol it
would require explicit confirmation, which owner-only bits make unnecessary.
(b) `chmod 400` the `.env` files (read-only). Rejected: editors/tooling rewrite these; `600` matches the
existing convention for every other `.env` here.
(c) Leave the DB dumps at `664` because they're gitignored. Rejected: gitignore keeps them out of the
repo, not off the local disk — a full DB dump readable by any local account leaks credentials, session
data, and audit content. Owner-only is the correct at-rest posture.

**Touches:** No source/code changes. On-disk mode fixes only: `feeder-verification/.env` `764→600`;
`backups/` & `artifacts/api-server/backups/` `775→700`; 14 `*.sql` dumps `644|664→600`. Memory
`env-secrets-layout` / `device-guard-security-model` to be corrected (fs is `ntfs3+acl` honoring chmod;
root `.env` is a plain `600` file, not a symlink).

**Verification:** `stat -c '%a'` before → after: `feeder-verification/.env` `764→600`; both backup dirs
`775→700`; `.sql` dumps `{644,664}` → **all 14 = `600`** (`stat | sort | uniq -c` = `14 600`). Re-checked
with `stat -L` (symlink-resolving) to confirm the enforced mode, not a link's mode. `chmod` persistence
independently proven on this mount (600→644→640 round-trip). No typecheck/test run — no code changed.
**Git:** uncommitted (commit-only-when-asked).


## 2026-08-31 — Security audit Item 4: release tarballs audited — CLEAN, no secret leak; added packaging secret-scan

**Context:** Verify the 5 shipped release tarballs (`smt-verification-v2.{2.1,2.2,2.3,3.0,4.0}.tar.gz`)
don't bundle real secrets, and confirm packaging still builds from a git tag (not a raw working-dir tar).
Read-only investigation first; only report a leak — and add automation — after establishing the facts.

**Findings — NO SECRET LEAK. No rotation required.** (Investigated read-only before any change.)
- **Packaging is correct:** `scripts/package-release.sh:32` builds via `git archive --format=tar <TAG>`
  into a staging dir, prunes dev-only paths (`.dev-docs`, `.github`, `docs/reports`, `docs/internal`,
  `README.md`), then re-tars. Since the tree comes from a *committed tag* and `.env` (plus DB dumps,
  `feeder-verification/.env`) are gitignored, secrets cannot enter the archive.
- **All 5 tarballs scanned** three ways — by filename (`.env`/`*.pem`/`*.key`/`credential`), by content
  (secret-key assignments with a non-placeholder value; `postgres://user:pass@host`), and by value
  *signature* (length + hex-ness). **Every hit was a placeholder or a localhost/test value:**
  - Secret keys appear only in `.env.example` (template `change-me…`/`replace_with…`) and in planning
    docs (`MASTER_IMPLEMENTATION_PLAN_V2.md`, old `docs/internal/DEPLOYMENT_RUNBOOK.md`,
    `feeder-verification/public/*.md`) as **hyphenated/word-like samples** — signature analysis found
    **zero** 64-hex `openssl rand`-style values. A real generated secret would be 64 contiguous hex chars;
    none exist in any tarball.
  - Every `postgres://…` URL is `@localhost` (test DSNs `test:test@localhost`, seed/bootstrap in
    `setup.sh`/`reseed.cjs`/`deploy-client.sh`) or the literal placeholder `…@DBHOST:5432/DBNAME` (a doc
    example in the pre-prune runbook). No real remote host, no real credential.
  - `.npmrc` ships in every tarball but contains only pnpm flags (`auto-install-peers=false`,
    `strict-peer-dependencies=false`) — **no `_authToken`/`_password`**.
  - No `*.pem`/`*.key`/keystore/`id_rsa` files; no shipped `CREDENTIALS.txt` (it's generated on the
    client by `setup.sh`).
- **Process note (not a leak):** git tags present are `v2.1.1, v2.2.0, v2.3.0, v2.4.0`, but tarballs
  `v2.2.1/2.2.2/2.2.3` exist with **no matching tag** — those three patch bundles were packaged ad-hoc,
  not from a tag. They audit clean, but it shows the tag-only discipline wasn't always followed. The
  current script enforces tag-only (`git rev-parse "$TAG"` aborts if the tag is absent), and the new scan
  below is the backstop.

**Decision & why:** Clean audit ⇒ per the finding, add an automated secret scan to
`scripts/package-release.sh`. It runs on the staged, pruned tree *before* `tar -czf`, so a leak aborts
(exit 1) **before** any artifact is produced. It flags only unambiguous real artifacts — a non-example
`.env`, key/cert/keystore/ssh files, a shipped `CREDENTIALS.txt`, an `.npmrc` auth token, or a 40+‑hex
secret assignment — and deliberately ignores `.env.example` and the hyphenated/`change-me` doc
placeholders (proven not to false-positive on the current clean tree).

**Rejected alternatives:**
(a) Scan the finished `$OUT` tarball instead of the staged tree. Rejected — scanning `$ROOT` pre-pack
aborts before writing a leaky artifact and needs no re-extract; content is identical to the tarball.
(b) Add a `postgres://…@<remote>` heuristic to the scan. Rejected as brittle — the only non-localhost hit
anywhere was the `DBHOST` placeholder, a real remote credential would live in a real `.env` (already
caught), and a naive check would false-positive on legitimate doc examples and break every future build.
(c) Regenerate/rebuild the older ad-hoc tarballs from tags. Rejected — not asked, and they audit clean;
noted the tag gap instead.

**Touches:** `scripts/package-release.sh` (added the secret-scan guard block between the prune step and
`tar -czf`). No application code. The `v2.4.0` tarball was regenerated by the clean-run test (it is
gitignored/untracked and byte-reproducible from the tag); the other four tarballs were left untouched.

**Verification:** `bash -n` clean. Real run `./scripts/package-release.sh v2.4.0` → "Secret scan: clean."
+ tarball produced, **exit 0**. Poison test (tree seeded with a real `.env`, a `.pem`, `CREDENTIALS.txt`,
an `.npmrc` `_authToken`, and a 64-hex `AUDIT_HMAC_SECRET`) → guard collected **all 5** violations and
would **exit 1**, while correctly ignoring the sibling `.env.example` and a `localhost` DSN. No
typecheck/test suite run — the change is a bash packaging script, not app code.
**Git:** uncommitted (commit-only-when-asked).

---

## Changeover — remove MANUAL verification mode (keep AUTO + AUTO_LEGACY only)

**Context:** The New Changeover screen offered three modes: AUTO, MANUAL, AUTO_LEGACY. In the live
scan path (`POST /sessions/:id/scans`, `sessions.ts`) the MANUAL and AUTO branches run **identical**
accept/reject logic (match→ok; no-match+expected-MPN→reject; no-match+no-expected→accept) and both hit
the same BOM check — verified in code (branches at ~1913/1928, gate `mode === "AUTO" || mode === "MANUAL"`).
MANUAL therefore added a user-facing option that behaved exactly like AUTO. AUTO_LEGACY is genuinely
distinct (pre-loads feeders in BOM order; different operator scan flow) and stays.

**Decision & why:** Drop MANUAL as a **selectable** mode only — remove it from the creation UI and from
the three server-side write-whitelists that admit a mode on create/PATCH. New sessions can now only be
AUTO or AUTO_LEGACY. Confirmed with the user (three explicit answers):
- **Scan behavior is identical to now** — MANUAL≡AUTO already, so removing the option changes nothing
  operationally; BOM verification is unaffected.
- **Supervisor password-override survives unchanged** — it was never gated on MANUAL in the live
  splicing flow. `handleOverride` (`Splicing.tsx`) fires from the failure/retry workflow-lock and is
  validated by `/api/auth/verify-override` (password + role), independent of verification mode. It keeps
  working under AUTO and AUTO_LEGACY. (The only MANUAL-gated override was in `verification.ts`'s
  `POST /verification/scan`, which the frontend never calls — left untouched.)
- **Legacy NULL-mode rows keep showing MANUAL** — the read-side `?? "manual"` / `COALESCE(…, 'manual')`
  fallbacks are deliberately **kept**, so historical sessions render exactly as before. All MANUAL
  *read/parse/display* support (report `modeText`, ActiveSession badge, scan-path recognition of a stored
  MANUAL) is preserved; only the ability to *choose* MANUAL for a new session is gone.

**Rejected alternatives:**
(a) Flip the read-fallbacks from `'manual'` to `'auto'` so no report ever shows MANUAL. Rejected — user
chose to leave history as MANUAL; re-labelling old NULL rows would rewrite how past changeovers read.
(b) Rip out the whole override/`manual_pass`/`requiresOverride` machinery with MANUAL. Rejected — user
chose to keep the override, decoupled from MANUAL; it is a live supervisor safety valve.
(c) Also delete MANUAL from `session.schema.ts` / `scan.schema.ts` enums. Not done — those Zod schemas
are **not imported** by any live route (dead code); per surgical-change policy, flagged not deleted.
(d) Collapse AUTO_LEGACY too. Rejected — it drives a real, different scan flow.

**Touches:**
- `artifacts/feeder-scanner/src/feeder/pages/NewSession.tsx` — removed the MANUAL `<SelectItem>`, narrowed
  the `verificationMode` state union to `"AUTO" | "AUTO_LEGACY"`, updated the mode comment.
- `artifacts/api-server/src/routes/sessions.ts` — dropped `MANUAL` from the three write-whitelists (create
  `finalVerificationMode`, `PATCH /sessions/:id`, `PATCH /sessions/:id/mode`) and their error strings. All
  read-side `'manual'` fallbacks and the scan-path MANUAL branch left intact (historical support).
- No change to override wiring, `verification.ts`, the schemas, ActiveSession/Splicing read paths, or DB data.

**Verification:** api-server `tsc --noEmit` → **0 errors**; feeder-scanner `tsc -b` + `--noEmit` →
**0 errors**. api-server `vitest run` → **295 passed, 26 skipped**; the lone failure
(`admin-audit-events.test.ts > POST /users`) was a 5 s bcrypt-cost-12 timeout under full-suite load,
**unrelated to this change** and green in isolation (6/6). feeder-scanner `vitest run` → **40 passed**.
**Git:** uncommitted (commit-only-when-asked).

---

## Trial Session (skip-BOM) — verify feeder number only, accept any MPN (changeover + splicing)

**Context:** A "Trial Session — skip BOM (data collection · supervisor only)" is created with
`bomVerificationSkipped=true` **but still selects a real BOM** (bomId is set). Free Scan Mode is a
separate axis (`bomId === null`). Bug reported by the user: in the **changeover feeder-verification**
scan path (`POST /sessions/:id/scans`, `sessions.ts` STEP 3), the skip flag was **never consulted** — it
only bypassed validation when `bomId === null` (Free Scan). So a Trial session with a BOM still ran
strict MPN validation and rejected mismatches. Meanwhile the **splicing** path (`POST /sessions/:id/splices`)
had a `bypassBom` that went the *other* way — it accepted **unknown feeders** too. Neither matched the
intended Trial semantics.

**Decision & why:** Make both paths enforce the same Trial rule, confirmed by the user: **the feeder
number must exist in the BOM (reject if not found), but ANY MPN/part-number is accepted (no match
required).** Duplicate-feeder blocking is retained in Trial mode (user-confirmed).
- **Changeover path** (`sessions.ts` STEP 3): added `const bomVerificationSkipped = session.bomVerificationSkipped === true;`
  and, in the branch where the feeder *is* found in the BOM, short-circuit to `scanStatus = "ok"` with a
  "Trial Session — MPN not validated" message before the AUTO/MANUAL MPN matching. The pre-existing
  feeder-not-found reject (`!selectedItem`) and the duplicate-scan guard are untouched, so feeder-exists
  and duplicate rules still apply.
- **Splicing path** (`sessions.ts`): changed the feeder-lookup guard from `if (!bomItem && !bypassBom)`
  to `if (!bomItem)` so an unknown feeder is **always** rejected — including Trial. `bypassBom` now only
  skips the old/new-spool **MPN** gates (already the case at those two sites), matching "any MPN." Updated
  the `bypassBom` comment to state the new semantics.

**Rejected alternatives:**
(a) Accept everything in Trial (no feeder check) — the old splicing behavior. Rejected — user explicitly
wants the feeder number verified in both paths.
(b) Also skip the duplicate-feeder guard in Trial. Rejected — user chose to keep it.
(c) Route Trial through Free-Scan (`bomId === null`). Rejected — Trial deliberately keeps the BOM linked
(for the feeder-exists check and reporting); it is a distinct axis from Free Scan.

**Touches:** `artifacts/api-server/src/routes/sessions.ts` — (1) new `bomVerificationSkipped` const +
accept-any-MPN branch in the changeover feeder scan handler; (2) splicing feeder guard tightened to always
require the feeder in BOM + updated `bypassBom` comment. `artifacts/feeder-scanner/src/feeder/pages/ActiveSession.tsx`
— the **Loading tab** did client-side MPN matching (`if (!match)` reject at the spool/MPN step) that fired
before the server was ever consulted, so a Trial scan was rejected client-side; added a `bomVerificationSkipped`
derived flag (read off the GET /sessions/:id payload, cast like Splicing does) and a Trial fast-path in the
MPN step that accepts any scanned value and advances to the lot step. Feeder-exists + duplicate checks in the
feeder step are untouched. No schema or DB change (the Trial checkbox already sends `bomVerificationSkipped`).
Downstream `bomItem?.` optional-chaining in the splicing path is now technically redundant but left as-is (surgical).

**Verification:** api-server `tsc --noEmit` → **0 errors**, `vitest run` → **296 passed, 26 skipped**.
feeder-scanner `tsc -b` + `--noEmit` → **0 errors**, `vitest run` → **40 passed**. Note: the api-server
change requires a server rebuild/restart to take effect on a running install; the client change requires a
feeder-scanner rebuild.
**Git:** uncommitted (commit-only-when-asked).

## Notifications — apply the Module 14 targeting migration + add a feed tone

**Context:** User reported that the bell notification section showed nothing — "the qa que verificationa dn all
the notitfication are not arrived" — and specifically that submitting a session to QA produced no notification.
They also asked for a notification tone, and that the bell carry **only QA/update events, not** per-scan MPN
pass/fail verdicts.

**Root cause (not missing wiring — schema drift).** The Module 14 migration had never been applied to the live
`smtverification` DB. `lib/db/src/schema/notifications.ts` declares 13 columns plus a `notification_seen`
table; the live DB had **7 columns and no `notification_seen`** (`event_class`, `target_role`, `target_user_id`,
`related_entity_type`, `related_entity_id`, `created_by_user_id` all absent). `lib/notify.ts` `pushNotification`
inserts all 13, so every insert threw — and it is deliberately best-effort (`catch { logger.warn(...) }`,
mirroring `auditLog`'s discipline), so the request still returned 200 and the failure was invisible. Newest
surviving row was `id 63` (2026-08-30 22:40), i.e. nothing written since. `GET /api/notifications` would also
have failed, since it selects `target_role` and left-joins `notification_seen` — so the bell had no source.

**Decision & why:**
- **Ran the existing migration** `lib/db/src/add-notification-targeting.ts` (via `lib/db`'s local `tsx`)
  against `smtverification`. It was already written, idempotent, and additive (`ADD COLUMN IF NOT EXISTS` ×6,
  `CREATE TABLE IF NOT EXISTS notification_seen`, 4 × `CREATE INDEX IF NOT EXISTS`) — authoring a new script
  would have duplicated it. All new columns nullable, so the 63 pre-existing rows stay valid and read as
  un-targeted/global (no backfill — user did not ask, and global visibility is the correct reading for
  pre-Module-14 rows).
- **Tone:** added `playSuccessBeep()` from the existing `utils/audio.ts` to `NotificationFeedListener`, gated
  on `fresh.length > 0` — i.e. **once per poll batch, not per row**, so a backlog of N rows chimes once rather
  than N times. Placed after the existing `primedRef` baseline guard, so signing in does not chime for history.
  Chosen over `NotificationSystem`'s `playBuzzer` (200 Hz sawtooth, reserved for errors) and over adding a new
  sound asset.
- **MPN pass/fail exclusion — verified already true, no code change.** Audited all 12 `pushNotification` call
  sites: `qa_request` (`sessions.ts:1659` submit-qa, `:1710` submit-splicing-qa), `qa_result`
  (`verification.ts:1845/1943/2252`), `handover` (`sessions.ts:1198`), `bom` (`bom.ts` ×6), `broadcast`
  (`admin.ts:682`). Scan verdicts never reach the server feed — they only hit the local toast/indication path.
  The bell reads solely from `GET /api/notifications` (`NotificationBell.tsx:62`) and the old local
  `store/useNotificationBellStore.ts` that used to let scan toasts leak in is already deleted.

**Rejected alternatives:**
(a) Write a new migration script. Rejected — `add-notification-targeting.ts` already does exactly this.
(b) `drizzle-kit push`. Rejected — it reconciles the whole schema and could touch other drifted tables
(`changeover_sessions`/`feeder_scans` are empty and `feeder_scans.session_id` is `text` vs `integer` elsewhere);
the raw-SQL script is surgical.
(c) Make `pushNotification` throw instead of warn, so drift surfaces loudly. Rejected as out of scope — a feed
insert must never break the request path. Worth revisiting separately.
(d) Chime per notification row. Rejected — a 10-row backlog would machine-gun the operator.
(e) Add filtering to exclude scan verdicts from the bell. Rejected — they were never in it; the fix would have
been a no-op guarding against a path that does not exist.

**Touches:** DB `smtverification` — 6 nullable columns on `notifications`, new `notification_seen` table,
4 indexes (data-preserving; 63 rows before and after). `artifacts/feeder-scanner/src/components/NotificationFeedListener.tsx`
— `playSuccessBeep` import + 3-line batch-level chime with comment. No server code changed. **`.env.dev`'s
`smtverification_dev` does not exist on this host** (`pg_database` lists `smtverification`, `smtverify`,
`feeder_verification_dev`, `infizent_db`, `smt_test_l3`, `mydb`, `test_db`), so the requested dev-DB migration
was a no-op — not run, no database created.

**Verification:** pre/post `information_schema.columns` (7 → 13), `to_regclass('notification_seen')`
(MISSING → present), `pg_indexes` (2 → 7), `count(*)` 63 → 63. Live smoke test: full 13-column insert matching
`pushNotification` succeeded (`id 64`, `event_class=qa_request`, `target_role=qa`), read back through the shape
`GET /notifications` selects, then deleted. api-server `tsc --noEmit` → **0 errors**, `vitest run` → **296
passed, 26 skipped**. feeder-scanner typecheck → **0 errors**, `vitest run` → **40 passed**. Not yet verified
end-to-end in the browser: the running api-server is still the stale 11:25 `dist` build and the frontend needs
a rebuild to pick up the tone.
**Git:** uncommitted (commit-only-when-asked).

---

## Store dashboard — build Module 11.4 Reel/Lot Master + 11.7 issue-to-line

**Context:** The storekeeper dashboard rendered only a "coming soon" placeholder
(`store/StoreDashboard.tsx`, 29 lines, unchanged since Module 10). Not a bug — the store
module was never built. The `/store` window, `storekeeper` role, and store-device session
binding (Module 10.4) all work; only the material-inward layer behind them was missing. User
chose (via AskUserQuestion) the **full §11.4 + §11.7**: receive a physical reel into store, then
issue it to a line — the issue event §11.7 says a future loading-check (§11.5) will validate
against.

**Decisions & why:**

1. **`reels.part_number` is TEXT, not an FK to `components`.** Spec §11.4 models
   `reel.component_id → Component Master`, but the live `components` table holds **5 seeded rows**
   and only **3 of 46 `bom_items`** carry a `component_id`. An FK would let store receive reels for
   only those 5 parts. Text matches how every existing match in this system works — `verifyMPN`
   (`sessions.ts:145`) is text-on-text against `bom_items.mpn_1..8`/`internal_id`. Stored
   uppercase-normalized so a later §11.5 lookup is case-stable.
2. **`current_line_name` is TEXT validated against the `approvers` 'line' roster, no `lines`
   table.** There is no lines entity: lines live as free text on `sessions.line_name` (already
   inconsistent — "Line- 01", "LINE - 02", "Line - 01") and as `approvers` rows with
   `category='line'` — the same list `NewSession.tsx:385` offers. `POST /reels/:id/issue` rejects a
   line not in that roster (`400 unknown line`), so store can't invent a line no changeover runs on.
   See [[machine-roster-source]] (lines follow the same approvers-category pattern as machines).
3. **Status is TEXT with route-level validation, not a pg enum.** `in_stock | issued | in_use |
   consumed | expired`. Mirrors `sessions.status` / `component_alternates.approval_status` (both
   text); avoids a new enum type on a DB with known migration drift.
4. **No path back to `in_stock`.** Issue is one-way (`in_stock → issued`); `PATCH /status` only
   advances to `in_use|consumed|expired`. Un-issuing would rewrite the §11.7 traceability event.
   Re-issuing an already-issued reel → `409`.
5. **NOT wired into the changeover scan (§11.5 deferred).** The `reels` table starts empty;
   gating scans on it would reject every operator on day one. `sessions.ts` scan logic is
   untouched — zero risk to current production scanning. §11.5 enforcement is a separate, explicit
   change once reels actually populate. (User quiz confirmed: "Nothing changes" on ship day.)
6. **Bin/batch/lot/DC are traceability only — never a mismatch.** §11.4 is explicit; nothing here
   is unique-constrained, and two reels of the same `part_number` with different bin/lot insert
   cleanly (smoke-verified). No bin-change alert (§11.6) built — that belongs with §11.5.
7. **RBAC: storekeeper/admin write; storekeeper/supervisor/admin read.** Supervisor gets read so
   they can see stock without a store login; receive/issue/status stay store-side. Uses the
   existing `requireRole` (`middleware/auth.ts:93`); `storekeeper` was already a valid role.
8. **Audit via direct `db.insert(auditLogsTable)`** (`reel_received`/`reel_issued`/
   `reel_status_changed`), matching `qa-rejections.ts:285`. These rows write `chain_hash=NULL`,
   which `verifyAuditChain` skips without advancing `prev` (`auditLogger.ts:196`) — so they can't
   break the HMAC chain. See [[audit-chain-integrity]].

**Rejected alternatives:**
(a) FK to `components` (spec-literal) — 5 rows, 3 linked BOM items; unusable today. (b) New `lines`
table + `current_line_id` FK — would force migrating 3 inconsistent free-text values and changing
how `NewSession` picks a line; out of proportion. (c) Wire §11.5 enforcement now — rejected, empty
table would reject every scan. (d) pg enum for status — new type on a drift-prone DB for no gain.
(e) `drizzle-kit push` for the table — reconciles the whole schema; used a surgical idempotent
script like every other table bootstrap here.

**Touches:** `lib/db/src/schema/reels.ts` (new), `lib/db/src/schema/index.ts` (export),
`lib/db/src/create-reels-table.ts` (new idempotent migration), rebuilt `lib/db/dist/*.d.ts`.
`artifacts/api-server/src/routes/reels.ts` (new — GET list/summary, POST receive, POST issue, PATCH
status), `routes/index.ts` (import + mount). `artifacts/feeder-scanner/src/store/StoreDashboard.tsx`
(placeholder → receive form + stock table with issue/status actions).
`artifacts/api-server/src/__tests__/rbac-matrix-l1.test.ts` (+2 tiers for GET/POST `/reels`).
`sessions.ts` scan path deliberately **untouched**.

**Verification:** `reels` table created on `smtverification` (19 cols, 5 indexes, 2 user FKs),
verified idempotent (re-run = no-op). Both packages `tsc --noEmit` → **0 errors**. api-server
`vitest run` → **306 passed, 26 skipped** (was 296; +10 from the 2 new RBAC tiers × 5 roles). Live
smoke test on :4123 with a minted storekeeper token: GET empty `{reels:[],total:0}`; summary
zero-filled; receive `201` (part upper-cased, `received_date` defaulted, `received_by_name` set);
issue to bogus line `400`, to real line `200` (status→issued, line recorded), re-issue `409`; second
reel same part different bin/lot `201`; status→in_use `200`, →in_stock `400`, bad date `400`;
**operator GET `/reels` `403`**. Audit rows written unchained (4 rows, all `chain_hash IS NULL`).
All 6 smoke rows + audit rows then deleted, `reels_id_seq` reset — table left empty. Vite serves the
new `StoreDashboard.tsx` (`200`, "REEL / LOT MASTER", 4 `api/reels` refs) — HMR, no rebuild needed.
**Not yet done:** api-server `dist` rebuilt (`reel_received` present, 5.37 mb) but the **running
service is still the stale build** — needs `sudo systemctl restart smtverify-api.service` before the
routes are live in the real app.
**Git:** uncommitted (commit-only-when-asked).


## Module 15b — admin-configured report output folder (client picker + server archive)

**Context:** Reports left the system in two unrelated ways and neither was configurable. The server
renders the session report and streamed it as a download; the three client reports (session, BOM,
splicing) are built in the browser with jsPDF and went straight to the browser's Downloads folder.
Operators were expected to file them by hand, so in practice reports scattered across per-PC
Downloads directories with no archive anywhere. The ask was a folder configured *from the admin
dashboard* that both paths obey, applied to every client PC.

**Decision & why:** Two settings, not one, because the two paths cannot share a value. A browser
cannot be handed a filesystem path — the File System Access API returns an opaque, non-serializable
`FileSystemDirectoryHandle` and never a path string — so the DB stores *policy* for clients
(`clientFolderEnabled`, `folderLabel`, `organizeSubfolders`) and each PC keeps its own handle in
IndexedDB, picked once via `showDirectoryPicker()` on the admin page. The server side stores a real
absolute path (`archiveEnabled`, `archiveRoot`) that the API service writes to directly. `folderLabel`
is a display string only; it is never used to construct a path, which is what makes the split safe.
`archiveRoot` must be absolute — a relative root resolves against the API's cwd, which is
`$APP_DIR/artifacts/api-server` under systemd but the repo root in a dev shell, so the same stored
setting would mean two different folders. Precedence in `getEffectiveArchiveRoot()` is: enabled with a
root → that root; a root configured but `archiveEnabled=false` → `null`, so the checkbox is a real off
switch that also overrides `REPORT_ARCHIVE_ROOT`; nothing ever configured → the env var still works, so
existing installs do not change behaviour on upgrade. The operator-facing `GET
/api/report-output-settings` deliberately omits `archiveRoot`: every logged-in operator would otherwise
learn a piece of the host's directory layout for no functional gain. Single-row table with
`id boolean primary key default true` + a live `CHECK (id = true)`, copying `security_settings`, and the
same 10 s cache/`invalidate*Cache()` shape as `deviceStore`.

**Rejected alternatives:** (a) Package Electron so the app could write a configured path directly —
the user explicitly ruled it out; it also means shipping and updating a desktop binary per PC. (b) One
setting for both paths — impossible, per the handle-vs-path constraint above; it would have meant
either typing a path the browser cannot use or storing a handle the server cannot read. (c) A new
upload endpoint so clients without folder access POST their PDFs for the server to file — the user
chose "local folder or Downloads only"; it would also add an authenticated binary-upload surface and
duplicate every report on disk. (d) Deriving the client folder from `folderLabel` as a path — browsers
cannot resolve it, and it invites the illusion that changing the label moves files. (e) Env-var-only
config (`REPORT_ARCHIVE_ROOT`) — the ask was specifically an admin-dashboard field, and editing `.env`
means sudo plus a service restart on the client PC. (f) Widening the schema/db mocks in
`report-archive-service.test.ts` to cover the new store dependency — the db mock's
`select().from().where()` chain returns only `{limit}`, so the store's `const [row] = await …where(…)`
would still throw on a non-iterable; mocking the store down to the env var keeps every existing test's
semantics intact and puts precedence coverage where it belongs.

**Touches:** `lib/db/src/schema/report_output.ts` (new), `schema/index.ts` (export),
`lib/db/src/create-report-output-settings-table.ts` (new idempotent bootstrap),
`lib/db/src/add-report-archive-record.ts` (new). `artifacts/api-server/src/lib/reportOutputStore.ts`
(new — cached read + `getEffectiveArchiveRoot`), `services/report-archive-service.ts` (new sink),
`routes/report-output.ts` (new operator GET), `routes/admin.ts` (admin GET + PATCH),
`routes/index.ts` (mount). `artifacts/feeder-scanner/src/lib/reportFolder.ts` (new — picker, IndexedDB
handle, `unsupportedReason()`), `src/admin/pages/ReportOutput.tsx` (new — client-folder card + server
archive card), `admin/AdminNav.tsx` + `admin/AdminGate.tsx` (nav entry + route),
`pages/session-report.tsx`, `pages/bom-report.tsx` (write through the folder when granted).
Tests: `lib/__tests__/reportOutputStore.test.ts` (new, 9), `__tests__/report-output-settings.test.ts`
(new, 14), `services/__tests__/report-archive-service.test.ts` (store stubbed to the env var).

**Verification:** Both packages `tsc --noEmit` → **0 errors**. api-server `vitest run` → **329 passed,
26 skipped** (33 files); feeder-scanner `vitest run` → **40 passed** (3 files). Endpoints verified by
supertest against the real `app` rather than curl, because several routers call
`router.use(attachActor)` with no path prefix and are mounted with `router.use(xRouter)`, so *every*
unmatched `/api/*` path returns 401 — an unauthenticated curl probe cannot distinguish "route mounted"
from "route absent". The 14 tests cover admin GET/PATCH (auth, absolute-path rejection, blank→null,
label length, no-valid-field 400, CSRF 403, audit event) and the operator GET (policy-only shape, an
explicit assertion that the response body does not contain the archive path, DB-failure degradation).
esbuild bundle rebuilt — `dist/index.mjs` contains 3× `report-output-settings` and 1×
`REPORT_OUTPUT_SETTINGS_UPDATED`.
**Browser-support limit (must be told to the client):** `showDirectoryPicker` is **Chromium-only**
(Chrome/Edge/Brave/Opera — not Firefox, not Safari) and additionally requires a **secure context**, so
a plain-HTTP LAN origin like `http://192.168.x.x:4000` does **not** qualify even in Chrome. Where it is
unavailable the client reports fall back to Downloads and get **no server copy** (no upload endpoint,
by choice). `reportFolder.ts`'s `unsupportedReason()` surfaces which of the two reasons applies on the
admin page. Chromium also drops write permission between sessions, hence the
`queryPermission`/`requestPermission` re-grant path.
**Not yet done:** the running service predates this bundle — needs
`sudo systemctl restart smt-verification.service` (dev box: `smtverify-api.service`) before the routes
are live in the real app.
**Git:** uncommitted (commit-only-when-asked).

## Client deploy hygiene — prune the release payload to what setup.sh actually reads

**Context:** `scripts/package-release.sh` pruned only five paths (`.dev-docs`, `.github`,
`docs/reports`, `docs/internal`, `README.md`). Everything else in the tagged tree shipped to the
shop-floor PC: two dev-only workspaces, the load-test harness with its recorded result JSONs, Prisma
leftovers, editor configs, and every vitest suite — files that name internal routes, mocked secrets and
fixtures. One of them, `feeder-verification/public/SMTVerification-main.zip`, is a tracked 1.7 MB zip of
the whole repo sitting in a Next.js `public/` dir, i.e. it would be served over HTTP if that app ever
ran. Audited: it contains only `.env.example`, so nothing leaked, but it must not travel to a client.

**Decision & why:** One rule, applied mechanically — a path stays only if `setup.sh`, the systemd unit,
or one of the two builds actually reads it. Pruned: `artifacts/mockup-sandbox` (design sandbox),
`feeder-verification` (abandoned Next.js/Prisma prototype, and the repo zip with it), `prisma/` +
`prisma.config.ts` (nothing in the runtime imports Prisma — `build.mjs` only names `@prisma/client` in
its esbuild `external` list), `testing/`, the dev-only halves of `scripts/`
(`acceptance bench ci reports src`, plus `package-release.sh`, `seed-stress-test.ts`,
`test-full-system.sh`, `test-sprint-09.sh`, `migrate-users-to-uuid.sh`, `post-merge.sh`),
`opencode.json`, `.markdownlintrc.json`, `docs/VERIFICATION_16_FIELD_IMPLEMENTATION.sh`, and every
`__tests__` dir / `*.test.*` / `*.spec.*` file. Removing whole workspace packages is safe because
`pnpm-workspace.yaml` uses globs — an unmatched glob is skipped and `pnpm install --frozen-lockfile`
still succeeds; verified before writing the prune (10 projects → 8, exit 0), with a control `left-pad`
injection proving the frozen-lockfile check is genuinely enforced (`ERR_PNPM_OUTDATED_LOCKFILE`).
Paired the prune with a **completeness guard**: a 21-path list of everything setup.sh, the unit, or a
build reads, checked after pruning. A too-broad prune line now fails at packaging time on the dev
machine instead of at 2 a.m. on the client PC — the prune list is the kind of thing that rots silently,
and a `rm -rf` has no natural failure mode.

**Rejected alternatives:** (a) An allow-list tarball (`git archive` only listed paths) — inverts the
default so every new runtime file is missing until someone remembers to add it; the failure mode is a
broken install, whereas a stale deny-list only ships junk. (b) Pruning `artifacts/feeder-scanner/electron`
— the desktop build scripts (`build:electron`, `dist`) read it and `electron` stays a devDependency
either way, so the client's `pnpm install` still downloads it; removing the source without touching the
manifest buys nothing and breaks a build path. (c) Removing `electron` from the manifest to save the
client that download — changes `package.json`, which breaks `--frozen-lockfile`, which is the one thing
that must keep working. (d) Pruning `scripts/install-local.sh` / `deploy-client.sh` as "competing
installers" — they are alternate install paths, not dev-only, and I have not verified they are dead;
mentioned rather than deleted. (e) Pruning `infizent-start-server.bat` / `infizent-stop-server.bat` —
unreferenced and useless on Ubuntu, but they are a Windows *production* launcher and 2 KB; if a client
runs Windows, removing them breaks their start-up. Kept, flagged.

**Touches:** `scripts/package-release.sh` (prune list + completeness guard). No runtime code.

**Verification:** Ran the modified packager against the existing `v2.4.0` tag: guard passed
("Release contents: complete"), secret scan clean, tarball **3.5M → 1.2M**. Side effect worth
recording: that run overwrote the local `smt-verification-v2.4.0.tar.gz`, and `tar -czf` is not
byte-reproducible (re-pack ordering differs), so the original bytes could not be restored — the
tarball was rebuilt with the unmodified HEAD script (a valid v2.4.0 payload) and
`smt-verification-v2.4.0.tar.gz.sha256` re-pinned to it. Both files are untracked and the tarball is
gitignored, so git history is unaffected; any copy already on a client is unaffected.
**Git:** committed as part of the v2.5.0 release (user asked for the push).

## Lock the client install directory — root-owned, sudo-only to modify

**Context:** `setup.sh` ended an install with the whole tree owned by the person who ran it
(`chown -R "$ORIG_USER"` in Phase 4, never undone), its own comment stating the intent: "Source, dist,
and node_modules stay owned by the install user so they can be rebuilt without sudo." On a shop-floor
PC that means the operator sitting at the machine can edit `dist/index.mjs` — or a `.ts` file and
rebuild — and change verification logic, the audit chain, or the license check. `CREDENTIALS.txt`
(DB password + license activation string) was `chmod 600` but owned by that same user, so readable
without sudo. The systemd unit also listed `ReadWritePaths=$APP_DIR`, granting the service write access
to its own code.

**Decision & why:** A new `scripts/lock-app-dir.sh` with `lock` / `unlock` / `status`, called by
`setup.sh` at the end of Phase 6. Locked state is `root:smt-app` with `chmod -R u=rwX,g=rX,o=` → dirs
750, files 640: root writes, the service account reads via the group, nobody else sees it. Read access
was never the threat; write access is. The capital `X` matters — it sets `+x` only where it is already
set or the target is a directory, so `setup.sh` and the ~hundreds of `node_modules/.bin` binaries keep
their executable bit while plain source files lose it (root cannot exec a file with no `x` bit set for
anyone, so a blanket `g-x,o-x,a-x` would have bricked the rebuild path). Four directories are carved
back to `smt-app` after the recursive pass: `logs`, `exports`, `/var/backups/$DB_NAME`, and
`artifacts/api-server/exports` — the last one because `ExportService.EXPORT_DIR` is
`resolve(process.cwd(), "exports", "reports")` and the unit's `WorkingDirectory` is
`artifacts/api-server`, so CSV/XLSX exports land there and **not** in `$APP_DIR/exports`, which setup.sh
was the only thing creating. That path mismatch was latent and harmless while the tree was
world-writable; locking would have turned it into a hard failure on the first export, so it is fixed
here rather than left as a surprise. `.env` becomes `root:smt-app 640` (service reads, only root
writes — strictly tighter than the previous `smt-app:smt-app 600`, which let the service rewrite its
own secrets) and `CREDENTIALS.txt` becomes `root:root 600`, so reading it now needs `sudo cat`, which
the closing message says. `ReadWritePaths` was narrowed from `$APP_DIR` to just the four runtime dirs:
defense in depth, so a compromised process cannot rewrite the bundle even if file modes were loosened
by hand later. `unlock`/`lock` exist as one shared helper precisely because an in-place upgrade must
`unlock → rebuild → lock`; without it the next update would silently leave the tree unlocked.

**Rejected alternatives:** (a) `chattr +i` (immutable) — survives root, cannot be applied to a whole
tree usefully, and forgetting to clear it makes every future upgrade fail in a way nobody diagnoses.
(b) An ACL-based scheme (`setfacl`) — needs a filesystem mounted with ACL support and is far harder to
inspect than `ls -l`; plain ownership is auditable at a glance by whoever inherits this. (c) Leaving
`ReadWritePaths=$APP_DIR` and relying only on file modes — the unit is the layer that survives someone
running a well-meaning `chmod -R 777`. (d) `chown -R root:root` with no group — the service could not
read its own bundle. (e) Locking inside Phase 4 before the build — the build must write `dist/` and
`node_modules/`, so the lock has to be the last step. (f) Making `logs/`/`exports/` world-writable
instead of `smt-app`-owned — pointless widening; the service is the only writer.
**Also added:** Phase 5 now runs this release's three idempotent bootstraps (`create-reels-table`,
`add-report-archive-record`, `create-report-output-settings-table`) after the ops migrations.
`drizzle-kit push` creates the tables from the schema but does not generate the single-row
`CHECK (id = true)` on `report_output_settings` or its seed row, so a fresh install otherwise differs
from the dev DB and the settings endpoints return `null` until something writes.

**Touches:** `scripts/lock-app-dir.sh` (new), `setup.sh` (Phase 1 creates
`artifacts/api-server/exports`; Phase 5 runs the three bootstraps; Phase 6 replaces the partial
`chown`/ancestor-walk block with `lock-app-dir.sh lock`, narrows `ReadWritePaths`, adds an optional
`-/srv/smt-reports` for the Module 15b archive; closing message documents `sudo cat CREDENTIALS.txt`
and `lock-app-dir.sh status`). `scripts/package-release.sh` guard list extended so a future prune
cannot drop the lock helper or the three bootstraps.

**Verification:** `bash -n` clean on all three scripts. `status` exercised on this repo (correctly
reports UNLOCKED, `abhishek-atole 775`); the argument guards reject a missing mode and a directory with
no `package.json`. The `chmod -R u=rwX,g=rX,o=` pattern was tested on a scratch tree mirroring the real
shapes: dirs 700/775 → 750, a 755 `setup.sh` → 750 (**still executable**), a 755
`node_modules/.bin/vite` → 750 (**still executable**), a 664 `.ts` → 640 (**not** executable),
symlinks untouched. The three bootstraps were run through the exact invocation setup.sh now uses
(`cd lib/db && npx --no-install tsx src/<name>.ts`) against the dev DB — all three exit 0 as no-ops.
**Not verified — needs a real install:** the privileged `lock`/`unlock` paths never executed here,
because this machine has no passwordless sudo and no `smt-app` user. `chown -R root:smt-app`, the
carve-outs, the `.env`/`CREDENTIALS.txt` re-modes and the ancestor walk are reasoned-and-syntax-checked
only. First run must be watched on the client, or on a throwaway VM, with
`sudo ./scripts/lock-app-dir.sh status` afterwards.
**Known gap:** the Module 15b archive root is admin-configurable but `ProtectSystem=strict` makes every
path outside `ReadWritePaths` read-only, so an archive root other than `/srv/smt-reports` silently
fails to write until someone adds it to the unit and reloads. Flagged in the unit's own comments; a
real fix means either a fixed archive location or a `systemctl edit` step in the admin instructions.
**Also not done:** no `update-client-v2.5.0.sh`. An in-place upgrade of an existing install must now be
`unlock → overlay → rebuild → run the three bootstraps → lock`, and the v2.4.0 update script does
`chown -R "$BUILD_USER"` with no re-lock, so it would leave the tree unlocked. Fresh installs via
`setup.sh` are complete; the update script was not requested and is not written.
**Git:** committed as part of the v2.5.0 release (user asked for the push).

## v2.5.0 release — one commit, public tag, downloadable GitHub Release

**Context:** The working tree had accumulated 96 files of uncommitted work across several sessions
(Module 15b report output, Module 11.4/11.7 reels, notification targeting, device/IP audit, splice
status fix) plus this session's deploy hardening. The user asked to push it as the latest version so a
client can download and run it from the public repo. This was the first commit authorisation in a repo
that had been commit-only-when-asked.

**Decision & why:** One release commit rather than a per-feature split. The features share
schema/route/UI files written in different sessions — a split would have produced intermediate commits
where a route references a table whose schema is not yet committed, i.e. non-building history, which is
worse than one large commit with a thorough body. The body enumerates each feature so history stays
readable. Committed straight to `main` because a branch cannot serve the download path the user asked
for without a merge, and every prior release on this repo went to `main` directly. Tag `v2.5.0`
(annotated) carries the two client-facing behaviour changes in its message — the folder is now
sudo-only and `CREDENTIALS.txt` needs `sudo cat` — so they are visible from `git show v2.5.0` and not
only in the release page. Published a GitHub Release with the tarball **and** its `.sha256` so the
client verifies before executing; the notes lead with the four download/verify/extract/install commands
and state the Chromium-only + secure-context limit plainly, since that is the one place this feature
will look broken to a user who did nothing wrong.
Two untracked-but-unignored files were resolved rather than committed: `*.tar.gz.sha256` and
`update-client-v*.sh` are now gitignored. Checksums belong with the Release, and a per-version updater
inside the next version's tarball only confuses whoever runs the install — no previous updater was ever
tracked, so this codifies existing practice.

**Rejected alternatives:** (a) A feature-split series of commits — non-building intermediates, per
above. (b) A release branch + PR — no second reviewer on this repo, and it delays the download path the
request was about. (c) Committing the `.sha256`/updater files — see above. (d) Leaving `test.txt` (a
stray tracked file, already deleted in the working tree) for a separate cleanup commit — it was already
staged as a deletion and splitting it out adds a commit for nothing.

**Touches:** `.gitignore` (release artifacts + updater scripts), `.env.example` (documents
`REPORT_ARCHIVE_ROOT` as a fallback-only setting and warns that `ProtectSystem=strict` makes any path
outside `ReadWritePaths` read-only). Commit `dce307f`, tag `v2.5.0`.

**Verification:** Pre-push gate all green — api-server `tsc --noEmit` 0 errors and **329 passed / 26
skipped** (33 files); feeder-scanner `tsc` 0 errors and **40 passed** (3 files). Secret scan over
exactly the staged content (not the working tree): the packager's own high-entropy regex, any 32+ hex
run outside the lockfile, JWT-shaped literals, and any staged `.env`/`CREDENTIALS`/key file — all
clean; the `.env.example` diff is comment-only. Pushed `660bcb6..dce307f` to `origin/main` with 0
commits behind. Packaged from the tag: guard passed, secret scan clean, **1.2M / 481 files** (was ~3.5M
/ ~1100). Extracted the actual published tarball and asserted all 16 pruned paths absent, 0 test files
remaining, all 10 required paths present, `setup.sh` and `lock-app-dir.sh` still executable — then ran
**`pnpm install --frozen-lockfile`** in it: **exit 0, "Scope: all 8 workspace projects"**. That last
check also confirms the fix for a real breakage: `artifacts/feeder-scanner/package.json` at the previous
HEAD said `electron: ^42.4.0` while `pnpm-lock.yaml` recorded `^42.10.1` (commit 660bcb6 landed the
lockfile without the manifest bump), so **any client installing from the previous HEAD would have hit
`ERR_PNPM_OUTDATED_LOCKFILE` on setup.sh's first step**. Release verified public and non-draft, both
assets attached, and an anonymous `curl` of the checksum asset returns HTTP 200 with content identical
to the local file.
**Git:** committed and pushed — `dce307f`, tag `v2.5.0`,
https://github.com/Abhishek-Atole/smt-verification/releases/tag/v2.5.0
