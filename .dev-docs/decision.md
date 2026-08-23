# Decision Log

A running log of decisions taken on this system, each with its *why* — the reasoning,
the approach chosen, and which alternatives were rejected and why. Append, don't overwrite.
Dev-only; excluded from client deployments.

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
