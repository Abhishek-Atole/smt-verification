# Implementation Specification: Changeover, Handover, BOM & QA Reporting Module

## Purpose
This document is written to be handed directly to a developer or pasted into an AI coding assistant to implement. Each module includes: business rule, data fields, validation logic, and acceptance criteria.

---

## MODULE 1: Changeover Initiation

### 1.1 Line Number Selection
**Requirement:** Operator must select a Line Number when starting a changeover.
- Field: `line_number` (dropdown, required, sourced from Master Line List)
- Validation: Cannot start changeover without a valid line number.

### 1.2 BOM Verification — Skip Option
**Requirement:** Add a toggle "Skip BOM Verification" during changeover start.
- Field: `bom_verification_skipped` (boolean, default `false`)
- **Rule:** If `bom_verification_skipped = true`, the changeover is a **Trial (data-collection)
  changeover** and only a Supervisor may start it. *(Originally: "MUST require an approval before
  the changeover can proceed" — superseded, see 1.3.)*

### 1.3 Skip-BOM Approval Gate — **SUPERSEDED (2026-08-26)**
> **Status: superseded by the as-built "Trial Session" model.** The approval gate below was
> **not built** and was deliberately removed. Skip-BOM changeovers are *trial sessions* used for
> data collection; the requirement was restated as *"only the supervisor can start this type of
> changeover"* and *"no QA approval is required."* Full reasoning, alternatives rejected, and the
> quiz-gate record: see `decision.md` → **2026-08-26 — Trial (skip-BOM) sessions: supervisor-only,
> no QA approval, separate view**. The original text is kept below for provenance — do not
> implement it.

**As-built behaviour (authoritative):**
- **Who may start one:** Supervisor only. `POST /sessions` returns
  `403 "Only a supervisor can start a trial (skip-BOM) changeover"` for any other role
  (`artifacts/api-server/src/routes/sessions.ts`). The UI shows the "Trial Session" checkbox to
  supervisors only.
- **Approval:** none. There is no approver sub-form, no second party, and nothing blocks
  progression. The starting supervisor *is* the authority.
- **Provenance:** recorded into the pre-existing approver columns at insert —
  `bom_skip_approver_role = 'supervisor'`, `bom_skip_approver_name` = the creating supervisor,
  `bom_skip_approval_at` = creation time, `bom_skip_approval_remarks` = `NULL`. The audit action
  string remains `bom_skip_approved` (description reworded) so existing audit consumers keep
  working.
- **Visibility:** operators never see trial sessions; supervisor/QA/admin do, in a separate
  "Trial / Data Collection" section of the Active Sessions page.
- **Marker:** `bom_verification_skipped = true` *is* the trial marker — no `session_type` enum and
  no separate table were introduced.

<details>
<summary>Original (not implemented) — Skip-BOM Approval Gate</summary>

**Requirement:** When BOM verification is skipped, either QA **or** Supervisor (not both — one is sufficient) must approve.
- Fields:
  - `approver_role` (enum: `QA` | `Supervisor`)
  - `approver_name` (string, from logged-in user list filtered by role)
  - `approver_id` (foreign key to user)
  - `approval_timestamp` (datetime, auto-captured)
  - `approval_remarks` (optional string)
- **Validation Logic:**
  ```
  IF bom_verification_skipped == true:
      REQUIRE approver_role IN [QA, Supervisor]
      REQUIRE approver_id IS NOT NULL
      BLOCK changeover progression until approval is recorded
  ```
- **Acceptance Criteria:** Changeover record cannot move past "Setup" status without either a completed BOM check OR a valid single approval record.

</details>

---

## MODULE 2: Changeover Concurrency & Ownership Rules

### 2.1 Max Concurrent Changeovers per Line
**Requirement:** A single line can have at most **2 active changeovers** running simultaneously.
- **Validation Logic:**
  ```
  ON new changeover creation for line X:
      active_count = COUNT(changeovers WHERE line_id = X AND status = 'active')
      IF active_count >= 2:
          BLOCK creation
          SHOW message: "Please close the previous changeover on this line before starting a new one."
  ```

### 2.2 Operator-Level Access Restriction
**Requirement:** A changeover is visible/actionable only to the operator who owns it (except during/after a valid handover — see Module 4).
- Field: `owner_operator_id` (initially = creator; can expand to include handover recipient)
- **Rule:** Query changeover list screen filters by `owner_operator_id IN (current_logged_in_operator_id)`.
- **Acceptance Criteria:** Operator A cannot see or act on Operator B's changeover unless a handover has explicitly added Operator A as a co-owner.

---

## MODULE 3: Changeover Closure Data Capture

### 3.1 End-of-Changeover Prompts
**Requirement:** At changeover closure, system must prompt for:
- Field: `total_production_quantity` (integer, required)
- Field: `current_cycle_time` (decimal, seconds, required)

### 3.2 Total Production Calculation
**Requirement:** Total actual output = production quantity entered × number of cavities (from BOM, see Module 5).
- **Formula:**
  ```
  total_output_units = total_production_quantity * bom.cavity_count
  ```
- This value feeds into OEE and final reporting calculations (Module 6).

---

## MODULE 4: Shift Handover Flow

### 4.1 Handover Trigger
**Requirement:** Add a "Handover to Operator" action, available any time after Loading Check and/or QA Verification (or at any intermediate step — not restricted to a fixed step).
- Button: `Handover to Operator` (visible on active changeover screen)

### 4.2 Handover Form
**Requirement:** On triggering handover, a mandatory form must be filled:
- Fields:
  - `from_operator_id` (auto-filled, current user)
  - `to_operator_id` (dropdown, required — select receiving operator)
  - `handover_timestamp` (auto-captured)
  - `handover_notes` (optional text — status of current step, pending items)
  - `handover_step_status` (snapshot of which sub-steps are complete at time of handover)

### 4.3 Ownership Transfer
**Requirement:** After handover form submission:
- `owner_operator_id` list expands to include `to_operator_id` (both operators retain access — do not remove `from_operator_id`)
- Changeover status remains `active`, tagged `handed_over = true`

### 4.4 New Shift — Notification Popup
**Requirement:** When the receiving operator logs in, if a handed-over changeover is pending under their name, show a popup notification immediately on login.
- Popup content: Line number, changeover ID, previous operator name, current step status.

### 4.5 Continue-Changeover Gate
**Requirement:** Before the receiving operator can continue the changeover, the popup must require:
- Field: `supervisor_name` (dropdown, required, filtered by Supervisor role)
- Field: `qa_name` (dropdown, required, filtered by QA role)
- Button: "Continue Changeover" (disabled until both fields are selected)

### 4.6 Dual Visibility
**Requirement:** Post-handover, the changeover record must be visible to **both** operators' logins (Module 2.2 access rule extended to a list, not single owner).

### 4.7 Report Reflection
**Requirement:** Final report must show:
- Both operator names (`from_operator_id`, `to_operator_id`)
- Timestamp of handover
- Timestamp of continuation
- Supervisor and QA names selected at continuation

### 4.8 Amendment — As-Built Notes (2026-08-30)
Refines 4.3/4.4/4.6 based on the handover reconciliation fix. Full reasoning: `decision.md` →
**2026-08-30 — Handover converged onto the live session model + explicit Accept/Reject**.

- **4.3 ownership transfer is now two-phase, not immediate.** The recipient gets a
  `changeover_operators` row with `status = 'pending'` and gains **no** access until they
  Accept (`status → 'accepted'`); Reject sets `'rejected'`. Every ownership read requires
  `status = 'accepted'`, so "handed over" and "has access" are distinct states. Pre-existing
  rows default to `'accepted'`, so nothing regressed. `handed_over = true` was not added — the
  co-owner row's `role`/`status` already carry it.
- **4.4/4.5 the login popup + supervisor/QA continuation gate are NOT built.** What exists is a
  persistent pending-handover banner on the dashboard (polled every 30s) with Accept / Reject
  buttons. No supervisor/QA re-selection is required to continue.
- **4.6 dual visibility holds, but only after Accept.** Both operators retain access once
  accepted; the sender's row is never removed.
- **Model note.** Handover lives entirely on the legacy integer `sessions` +
  `changeover_operators` pair. The `changeover_sessions` / `session_handovers` tables (text
  `SMT_…` ids) are unused (0 rows) and the
  `POST /api/verification/handover/:sessionId` initiate route that writes them is deprecated —
  do not build on either.

---

## MODULE 5: BOM Import Enhancement

### 5.1 Cavity Count Field
**Requirement:** At BOM import, add a new required field:
- Field: `cavity_count` (integer, required, min = 1)
- Stored against the BOM record, reused in all downstream calculations (Module 3.2, OEE, final report).
- **Validation:** BOM cannot be imported/saved without this field populated.

---

## MODULE 6: Final Report Requirements

### 6.1 Required Fields in Every Report
- `customer_name`
- `bom_name`
- `line_number`
- `start_time`
- `end_time`
- `total_duration` (auto-calculated: `end_time - start_time`)
- `total_production_quantity`
- `cavity_count`
- `total_output_units` (calculated per Module 3.2)
- `current_cycle_time`
- Operator name(s) — single or handover pair
- Supervisor name, QA name
- Trial-session provenance (if BOM was skipped — the starting supervisor, per as-built 1.3; there is no separate approver)
- All relevant timestamps (start, handover, continuation, end, approval)

### 6.2 Report Source
**Requirement:** Report must be generated by combining data from **both** the QA dashboard and Supervisor dashboard (single unified report, not two separate ones).

### 6.3 Report Format & Frequency
- Export format: **Excel (.xlsx)**
- Frequency/grouping: **Shift-wise** (Shift A / Shift B / Shift C or as configured)

---

## MODULE 7: QA Dashboard — Inhouse Rejection Page

### 7.1 New Page
**Requirement:** Create a dedicated "Inhouse Rejection Data" page inside the QA dashboard (separate from the general dashboard).

### 7.2 Data Entry
- QA manually adds rejection entries.
- Fields: `date`, `line_number`, `bom_name`, `defect_type`, `rejection_quantity`, `stage` (e.g., AOI/SPI/Final), `remarks`, `entered_by`

### 7.3 Data Retrieval
- Data must be fetchable **datewise** (date filter/range picker).

### 7.4 Analytics — Auto-Generated on This Page
Reference layout: existing `SMT_INHOUSE_NC_SHEET` Excel dashboard ("Summary Report for Daily Inspection Activity"). Replicate this same 4-block layout in the new system page/report.

**Header block (top of page):**
- Title: "Summary Report for Daily Inspection Activity (For the Month of [MMM-YYYY])"
- Document control strip: `Document No.` (e.g. QF-OP-03), `Rev No.`, `Rev Date`, `Page No.` — pull from a configurable document-control settings table, not hardcoded

**Block 1 — Summary for Daily Inspection Status** (bar chart, left)
- 3 bars: `Total Qty Checked`, `First Shot Qty`, `OK Qty`
- Callout number beside/below bars: `Not OK Qty.` (total rejected count for the period)

**Block 2 — Pareto Analysis** (combo chart: bar + cumulative % line, center)
- X-axis: defect types, sorted descending by count (e.g. Less Solder, Missing, Bridging, Shift, Upside Down, Tombstone, Excess Solder, Wrong Polarity, Billboard, Dry Solder, Wrong Component)
- Primary Y-axis (left): defect count, data labels on top of each bar
- Secondary Y-axis (right): cumulative % (0–100%), red line overlay
- Title: "Pareto Analysis in totality of defects (Rework & Rejection) — considering all parts together"
- Defect type list should be a configurable master list (add/remove defect types without code change)

**Block 3 — Rejection PPM** (single-bar callout, right)
- Formula: `PPM = (Not_OK_Qty / Total_Qty_Checked) * 1,000,000`
- Title: "PPM — considering all parts together"
- Large numeric data label on the bar

**Block 4 — Datewise Total Rejection Details** (full-width line chart, bottom)
- X-axis: every date in the selected month (1 to last day), even if value = 0
- Y-axis: total rejection quantity for that date
- Data label on every point
- This is the same chart referenced in Module 6/9 shift-wise reporting — pull from the same underlying rejection log, just aggregated differently

**Additional required tab structure (mirroring reference file):**
- `Daily Inspe. Report (All Parts)` — raw daily entries, all parts
- `Partwise Inspection Summary` — same data broken down per part number
- `Summary Graph` — the 4-block dashboard described above
- `Ref.Sheet` — master lists (defect types, part numbers, document control values)
- `Defect Details` — full rejection log (date, part, defect type, qty, stage, entered_by)

**Underlying data model driving all 4 blocks:**
- `daily_inspection_log`: `date`, `part_number`, `total_qty_checked`, `first_shot_qty`, `ok_qty`, `not_ok_qty`, `shift`
- `rejection_entries`: `date`, `part_number`, `defect_type`, `stage` (AOI/SPI/Final), `rejection_qty`, `entered_by`, `line_number`
- Pareto and PPM blocks are both derived aggregates of `rejection_entries` — do not store them separately; compute on read or via a scheduled aggregation job if performance requires it.

### 7.5 Defect Details — Entry Form (replaces flat log tab)
**Requirement:** The `Defect Details` tab becomes a structured entry form + log, not just a raw dump. Each entry is tied back to a specific changeover.

| Field | Type | Source | Notes |
|---|---|---|---|
| `changeover_id` / Model | Dropdown (searchable) | Fetched from Changeover records (Module 1–4) | Selecting this auto-populates `line_number`, `date`, `bom_name`, `customer_name` from the changeover record — these become read-only once selected |
| `component` | Dropdown/text | Component master list | Which component the defect relates to |
| `location` | Text | Manual entry | Board/panel reference — e.g. reference designator or panel coordinates |
| `defect_type` | Dropdown | Defect master list (same list used in Pareto, 7.4 Block 2) | e.g. Less Solder, Missing, Bridging, Shift, Upside Down, Tombstone, Excess Solder, Wrong Polarity, Billboard, Dry Solder, Wrong Component |
| `quantity` | Integer | Manual entry | Defect quantity for this record |
| `machine` | Dropdown | Machine master list | Machine/station where the defect occurred |
| `date` | Date | Auto-filled from `changeover_id`, editable | Defaults to changeover date |
| `line_number` | Auto-filled, read-only | From `changeover_id` | Prevents mismatched line/data entry |
| `shift` | Auto-filled/dropdown | From changeover or manual override | Drives shift-wise reporting (Module 6.3) |
| `entered_by` | Auto-filled, read-only | Logged-in QA user | For audit trail (Module 9.2) |

**Validation:** `changeover_id` must be selected first. All changeover-derived fields lock immediately after selection — operator/QA cannot hand-type a line number or date that doesn't match the selected changeover.

### 7.6 Detailed Analysis Report — Daily / Monthly / Yearly
**Requirement:** All Module 7.4 charts (Summary Status, Pareto, PPM, Datewise Rejection) and the Module 7.5 defect log must be viewable at three aggregation levels, selectable via a single toggle:

- **Daily** — one day, all shifts combined (with shift breakdown available)
- **Monthly** — full month rollup (mirrors sample sheet's "For the Month of AUG-2026" header)
- **Yearly** — full year rollup, shown as month-over-month trend

```
report_view_level = Daily | Monthly | Yearly
ON level change:
    RE-AGGREGATE Block 1–4 charts (7.4) using the selected date bucket
    RE-FILTER Defect Details log (7.5) to the matching date range
    PRESERVE active filters (line_number, customer, changeover/model) across level changes
```
- Drill-down: selecting a month in the Yearly view should jump to that month's Monthly view; selecting a day in Monthly view should jump to Daily.
- Keep the same document-control header block (Document No., Rev No., Rev Date, Page No.) across all three levels for consistency with the existing QF-OP-03 format.

---

## MODULE 8: Bypass Quantity Tracking

### 8.1 AOI Bypass Graph
- Track and graph quantity of units bypassed at AOI stage, datewise/shiftwise.

### 8.2 SPI Bypass Graph
- Track and graph quantity of units bypassed at SPI stage, datewise/shiftwise.

- Both should be filterable by date range and line number, displayed as trend charts on the QA dashboard.

---

## MODULE 9: Monitoring & Admin Dashboard

### 9.1 Detailed Analysis Dashboard
**Requirement:** Build a monitoring dashboard that consolidates:
- Changeover data (Module 1–4)
- Production & OEE data (Module 3, 5)
- Rejection & PPM data (Module 7)
- Bypass data (Module 8)
- Handover audit trail (Module 4)

### 9.2 Admin Audit Log
**Requirement:** Every action across the system must be logged and visible in the Admin Dashboard.
- Log fields: `event_type`, `actor_id`, `actor_role`, `timestamp`, `entity_type`, `entity_id`, `before_value`, `after_value`
- Events to log (minimum): changeover create/close, BOM skip + approval, handover trigger, handover continuation, rejection entry add/edit, report export, BOM import.

---

## MODULE 10: System Security, Device/IP Restriction & Access Segregation

### 10.1 Device Categories
**Requirement:** The system must recognize distinct device roles, each with its own access profile:
- `end_device` — shop-floor terminals (operator login: changeover, handover, loading check)
- `admin_device` — admin/management terminals (full config access)
- `store_device` — store/warehouse terminal (separate login window, separate scope — material issue, BOM stock, etc.)
- `server` — the host running the DB/backend itself (not a login client, but has its own access-control entry)

Each device record:
| Field | Type | Notes |
|---|---|---|
| `device_id` | Auto/UUID | Internal identifier |
| `device_type` | Enum: `end_device` \| `admin_device` \| `store_device` \| `server` | Determines which login UI and permission set applies |
| `device_name` | String | Friendly label (e.g. "Line 3 - SMT Terminal") |
| `allowed_ip` / `ip_range` | String / CIDR | The IP or subnet this device is permitted to connect from |
| `mac_address` | String (optional) | Extra binding layer if required |
| `status` | Enum: `active` \| `blocked` \| `pending` | Admin can disable a device instantly |
| `created_by`, `created_at`, `last_modified_by`, `last_modified_at` | Audit fields | Ties into Module 9.2 audit log |

### 10.2 IP Restriction Enforcement
**Requirement:** Every login/API request is checked against the allowed IP list for that device type before authentication proceeds.
```
ON login/API request:
    incoming_ip = request.source_ip
    matched_device = LOOKUP device WHERE allowed_ip/ip_range MATCHES incoming_ip
    IF matched_device IS NULL OR matched_device.status != 'active':
        REJECT request (log as security event, Module 9.2)
    ELSE:
        PROCEED to credential check, scoped to matched_device.device_type permissions
```
- Admin dashboard must provide a UI to add/edit/remove/block IP entries per device type — no code deployment needed to change an allowed IP.
- Separate IP allow-lists per category: `end_device_ip_list`, `admin_device_ip_list`, `store_device_ip_list`, `server_ip_list` (or a single table filterable by `device_type` — schema choice, but the allow-lists must be independently manageable).

### 10.3 Admin-Configurable Security Settings
**Requirement:** All of the following must be configurable from the Admin Dashboard (no direct DB/config-file edits required for routine changes):
- Add/edit/remove/block device IP entries (10.1–10.2)
- ~~Rotate/update the **database password**~~ — **DEFERRED, see status note below**
- Manage session timeout duration per device type
- View currently active sessions per device type, with a "force logout" action
- Toggle maintenance/lockdown mode (blocks all non-admin devices temporarily)

> **Status: DEFERRED.** DB password rotation was explicitly descoped during the Module 10 build
> (decision.md, 2026-08-23 — architecture decisions, item 4) and remains deferred as of the
> 2026-08-30 Tier-1 fix pass (decision.md, Issue 4 entry), which documented the actual current
> manual rotation process (see `deploy-client.sh` / `update-client-v2.4.0.sh`) in place of this
> requirement. **No schema or key-management surface exists for it.** If picked up later, the
> blocking question below must be answered first — do not implement without resolving it.

**Security rule for DB password field specifically (not yet implemented — spec retained for when this is picked up):**
```
ON db_password update:
    ENCRYPT new value before storage (never store plaintext)
    REQUIRE admin re-authentication (password/OTP) before allowing this specific change
    LOG the change event (actor, timestamp) WITHOUT logging the password value itself
    DO NOT return the stored password value in any API response, ever — write-only field
```
**Blocking question, unresolved:** where does the encryption key for the rotated password live?
It cannot safely live in the same database it protects (e.g. OS-level secrets manager / vault
needed) — confirm with infra before implementation.

### 10.4 Separate Login Windows Per Role
**Requirement:** Distinct, isolated login UI entry points — not one shared login screen with role selection after the fact:
- **Operator/End-device login** — shop floor UI, scoped to changeover/handover/loading-check functions (Modules 1–4)
- **Admin login** — separate URL/window, scoped to system configuration, IP/device management, DB password, audit logs, reporting (Modules 6, 9, 10)
- **Store login** — separate URL/window, scoped to store/material functions only, no visibility into changeover, QA, or admin data
- **QA/Supervisor login** — as already defined in Modules 6–7, kept distinct from the above three

**Rule:** Each login window authenticates only against its corresponding `device_type` (10.1) and role — an admin credential entered on the operator login screen (or vice versa) must be rejected, even if the credential itself is valid, unless the device+role combination matches.

### 10.5 General Hardening Requirements
- All credentials (operator, QA, supervisor, admin, store) stored as salted hashes — never plaintext.
- All login attempts (success and failure) logged with device_id, IP, timestamp, username, result (ties into Module 9.2).
- Lock account / device after N consecutive failed attempts (configurable threshold from Admin Dashboard).
- All admin-dashboard security changes (10.1–10.4) themselves generate audit log entries — no silent changes.
- Data in transit between end devices, store devices, and server must use HTTPS/TLS — no plaintext network calls.

### 10.6 Amendment — As-Built Notes (post-implementation, 2026-08-30 Tier-1 fix pass)
These refine the above based on issues found and fixed after initial build. See project
`decision.md` for full root-cause detail and test coverage per item.

- **10.2 IP validation hardened.** The original CIDR parser accepted malformed input (e.g. a
  trailing slash) and silently resolved it to "allow every address of that family." Fixed with a
  strict validator (reject multi-`/`, empty/whitespace/non-numeric prefixes, out-of-range
  prefixes) plus a startup audit pass that *reports* (never auto-repairs) any pre-existing
  malformed device rows, so an admin reviews and corrects them manually.
- **10.2/10.3 malformed-entry visibility.** Frontend has no direct access to the server's
  validator (no shared package), so validity is **server-computed**: `GET /admin/devices`
  returns an `allowedIpValid: boolean` per row (additive field, no breaking change), and the
  admin device list badges only rows where this is `=== false`. One validator implementation,
  zero drift risk between server enforcement and UI display.
- **CORS hardened against IP drift.** A device whose IP changed (DHCP drift, NIC change) used to
  get a bare 500 (blank SPA) because its `Origin` header no longer matched the static allow-list.
  Now accepts same-origin requests and boot-derived server-interface origins in addition to the
  static list, and rejects with a diagnosable `403 cors_origin_rejected` (audited as
  `SECURITY_ORIGIN_REJECTED`) instead of an opaque 500.
- **10.3 DB password rotation status** — see the deferred-status note under 10.3 above.

---

## MODULE 11: Component/Reel Master, MPN Cross-Reference & Bin Traceability

### 11.1 Problem Being Solved
Component labels (OSRAM/manufacturer, Rutronik/distributor, Uno Minda/internal) each stamp their own part number on the same physical reel, and the manufacturer additionally splits the same MPN across multiple **Bins** (luminous/color grouping) with their own Batch and Lot numbers. Today this causes confusion at BOM verification and loading check: is a scanned reel "correct" or "wrong component"? The system must resolve any of these identifiers to a single canonical BOM line, while still tracking Bin/Batch/Lot for traceability — without treating a Bin/Batch/Lot mismatch as a component mismatch.

### 11.2 Component Master Table
**Requirement:** One master record per canonical component, keyed by the internal part number used in the BOM.

| Field | Type | Notes |
|---|---|---|
| `component_id` | Auto/UUID | Internal PK |
| `internal_part_no` | String, unique | e.g. `48354-01` (Uno Minda) — this is the BOM key |
| `description` | String | e.g. "LED LAG6SP-CBEA24-1-Z DB-3-3B Minda" |
| `manufacturer_part_no` (MPN) | String | e.g. `Q65113A8528` — from OSRAM label "(1P) Supplier Part No" |
| `distributor_part_no` | String | e.g. `LEDATV3985` (Rutronik "Rut Part-No") |
| `manufacturer_name` | String | e.g. OSRAM |
| `distributor_name` | String | e.g. Rutronik Worldwide |
| `customer_order_no` | String | e.g. `022604249` — from label, if relevant to traceability |
| `vendor_code` | String | e.g. `028085544` |
| `cavity_count` | Integer | Reused from Module 5 if this component maps to a BOM/panel |
| `status` | Enum: `active` \| `obsolete` | |

### 11.3 Part Number Alias Table (Cross-Reference)
**Requirement:** Every identifier that can appear on any label must resolve back to one `component_id`.

| Field | Type | Notes |
|---|---|---|
| `alias_id` | Auto/UUID | PK |
| `component_id` | FK → Component Master | Links to canonical record |
| `alias_type` | Enum: `internal` \| `distributor` \| `manufacturer` \| `other` | Which party issued this number |
| `alias_value` | String, indexed | The actual part number string, e.g. `48354-01`, `LEDATV3985`, `Q65113A8528` |

**Rule:** Scan/lookup logic always searches this alias table first, then resolves to `component_id` → single BOM line. Any of the three (or more) numbers on a label must independently resolve to the same component.

### 11.4 Reel/Lot Master (Traceability Layer — not used for pass/fail matching)
**Requirement:** Each physical reel received is logged as its own record, subordinate to a `component_id`.

| Field | Type | Notes |
|---|---|---|
| `reel_id` | Auto/UUID | PK |
| `component_id` | FK → Component Master | |
| `bin_no` | String | e.g. `LA G6SP.02-8E-2-K3` — luminosity/color bin, NOT a different part |
| `batch_no` | String | e.g. `1017574781` |
| `lot_no` | String | e.g. `TBJ180WL79` |
| `dc_code` (Date Code) | String | e.g. `2618` |
| `mfg_date` | Date | From pink Minda label |
| `exp_date` | Date | From pink Minda label |
| `qty_received` | Integer | Reel quantity, typically 1000/reel or 40000/carton |
| `received_date` | Date | Store intake date |
| `status` | Enum: `in_stock` \| `issued` \| `in_use` \| `consumed` \| `expired` | |
| `current_line_id` | FK → Line (nullable) | Populated once issued to a line |

**Validation:** `bin_no`, `batch_no`, `lot_no`, `dc_code` differing between two reels of the **same `component_id`** is expected and normal — the system must never flag this as a component mismatch.

### 11.5 Scan-to-Verify Logic (Loading Check / BOM Verification)
**Requirement:** At changeover loading check (Module 1) or store issue, operator/store scans the reel label (any of its printed part numbers or its data-matrix code).

```
ON scan(scanned_value):
    matched_alias = LOOKUP alias_value = scanned_value IN Part Number Alias Table (11.3)
    IF matched_alias IS NULL:
        REJECT — "Unrecognized component, not in master data"
    ELSE:
        resolved_component_id = matched_alias.component_id
        expected_component_id = BOM line's component_id for this changeover
        IF resolved_component_id == expected_component_id:
            ACCEPT — proceed to loading check pass
            LOG reel_id (bin/batch/lot/dc) against this changeover for traceability
        ELSE:
            REJECT — "Wrong component for this BOM line" (true mismatch, escalate to QA/Supervisor)
```

### 11.6 Bin Change Alert (Informational, Not Blocking)
**Requirement:** When a new reel is issued to a line and its `bin_no` differs from the last reel of the same `component_id` used on that line, raise a non-blocking notification for QA/Supervisor visibility.
- Alert fields: `component_id`, `line_number`, `previous_bin_no`, `new_bin_no`, `timestamp`
- Purpose: enables tracing a later brightness/color complaint back to the specific bin transition, without stopping production.

### 11.7 Store Login Integration
**Requirement:** Store login (Module 10.4) is where reels are received and logged into the Reel/Lot Master (11.4). Material issue from store to line updates `status = issued` and `current_line_id`, and this issue event is what the changeover's loading-check scan (11.5) validates against.

---

## MODULE 12: Database Backup & Recovery

### 12.0 How This Actually Works (plain explanation before the spec)
Since this is asked as "how does backup work / what's the process" — here's the mental model
before the field-by-field spec below:

1. **Automatic, scheduled snapshots.** The server takes a full copy of the database at set
   intervals (e.g. every night at 2 AM, plus optionally every few hours during production) —
   nobody has to remember to click a button.
2. **Each snapshot is a self-contained file**, timestamped and stored somewhere *other than* the
   same disk as the live database (a second drive, a network share, or cloud storage) — the whole
   point of a backup is that it survives the primary disk/server dying.
3. **Old snapshots are automatically deleted on a retention schedule** (e.g. keep every day for 30
   days, every week for 6 months, every month for 2 years) — otherwise backups fill the disk
   forever.
4. **Restoring** means taking one of these snapshot files and loading it back into a database to
   bring the system back to the state it was in at that snapshot's timestamp — this is the "undo"
   button for data loss, corruption, or a bad deployment.
5. **The admin never edits the live database directly to "fix" a backup problem** — they trigger a
   restore from a known-good snapshot, or (for smaller issues) restore a snapshot into a *separate*
   database to pull out just the missing/corrupted records, without touching production.
6. **Someone (or something automated) must periodically verify a backup actually restores
   successfully** — a backup file that was never test-restored is not a proven backup, it's just a
   file that might be corrupt or incomplete and nobody would know until the day it's needed.

### 12.1 Backup Schedule & Storage
| Setting | Field | Notes |
|---|---|---|
| `backup_frequency` | Enum: `hourly` \| `daily` \| `weekly` \| custom cron | Admin-configurable from dashboard |
| `backup_time` | Time | For daily/weekly — e.g. 02:00, chosen for a low-production-activity window |
| `backup_storage_location` | Enum: `local_secondary_disk` \| `network_share` \| `cloud_bucket` | Must NOT be the same physical disk as the live DB |
| `backup_storage_path` | String | Configured path/bucket, admin-editable |
| `encryption_enabled` | Boolean | Backup files encrypted at rest (recommended default: true) |

**Rule:** Backups must never be stored only on the same server/disk as the production database —
that protects against corruption but not against disk failure, theft, or server loss.

### 12.2 Retention Policy
| Field | Type | Notes |
|---|---|---|
| `retention_daily_days` | Integer | e.g. keep daily snapshots for 30 days |
| `retention_weekly_weeks` | Integer | e.g. keep one weekly snapshot for 26 weeks |
| `retention_monthly_months` | Integer | e.g. keep one monthly snapshot for 24 months |
| `auto_purge_enabled` | Boolean | Automatically deletes snapshots outside retention window |

**Rule:** Purge logic never deletes the single most recent successful backup, even if retention
math would otherwise remove it — there must always be at least one restorable snapshot.

### 12.3 Backup Record & Audit Trail
Every backup run (success or failure) is logged — ties into Module 9.2 admin audit log.

| Field | Type | Notes |
|---|---|---|
| `backup_id` | Auto/UUID | PK |
| `triggered_by` | Enum: `scheduled` \| `manual_admin` | Who/what initiated it |
| `triggered_by_user_id` | FK (nullable) | Populated only for manual triggers |
| `started_at`, `completed_at` | Datetime | |
| `status` | Enum: `success` \| `failed` \| `in_progress` | |
| `file_size_bytes` | Integer | Sanity-check signal — a sudden drop to near-zero flags a broken backup |
| `storage_path` | String | Where this specific snapshot landed |
| `checksum` | String | Hash of the backup file, used to detect corruption before a restore is attempted |
| `error_message` | String (nullable) | Populated on failure |

### 12.4 Manual Backup Trigger (Admin Dashboard)
**Requirement:** Admin can trigger an on-demand backup outside the schedule (e.g. before a risky
change, a deployment, or a device/security config change).
- Button: "Backup Now" on Admin Dashboard
- Shows live progress and a success/failure result
- Manual backups are logged the same as scheduled ones (12.3) and count toward retention (12.2)

### 12.5 Restore Process
**Requirement:** Restore is a deliberate, admin-only, heavily-confirmed action — never automatic.

```
ON restore request:
    REQUIRE admin re-authentication (password/OTP) — same pattern as DB password change (10.3)
    SHOW explicit warning: "This will overwrite current data with the snapshot from
        <backup timestamp>. This cannot be undone. Type CONFIRM to proceed."
    VERIFY backup file checksum (12.3) before attempting restore — abort if mismatch, do not
        attempt a restore from a file that may be corrupted
    OPTION: restore into a NEW, separate database instance first (for inspection/partial
        recovery) rather than overwriting production directly — recommended default path
    IF direct overwrite is chosen:
        PUT SYSTEM INTO MAINTENANCE MODE (Module 10.3 lockdown) before restore begins
        PERFORM restore
        RUN post-restore integrity check (12.6)
        LOG the restore event (actor, source backup_id, timestamp, target) — audited, high-severity
        LIFT maintenance mode only after integrity check passes
```

**Rule:** Restore access is restricted to `admin_device` type (Module 10.1) — never available from
end-device, store-device, or QA/supervisor logins, regardless of role permissions, since this is
the single most destructive action in the system.

### 12.6 Backup Verification (Test Restores)
**Requirement:** A backup that has never been tested is not a trusted backup.
- Schedule a periodic automated **test restore** (e.g. weekly) into a throwaway/sandbox database
  instance, not production.
- After the test restore, run a basic integrity check: row counts on key tables (sessions, BOM,
  changeovers, rejection entries) roughly match expectations, and no fatal errors during restore.
- Record the result (`last_verified_at`, `verification_status`) against the backup record (12.3).
- If a scheduled test-restore fails, this must generate a high-priority alert to the admin — a
  silently broken backup process is worse than no backup process, because it creates false
  confidence.

### 12.7 What Gets Backed Up
**Requirement:** Full logical backup of the production database — all tables covered by this
system: sessions/changeovers, BOM + cavity counts, Component Master + Alias table (Module 11),
Reel/Lot Master, rejection entries, audit logs, device/security settings (Module 10), user
accounts (credentials remain hashed within the backup — never decrypted for backup purposes).
- Uploaded files/attachments (if any exist outside the DB, e.g. exported reports) are a separate
  concern — confirm whether these need a parallel file-backup process or are considered
  regenerable from DB data and out of scope.

### 12.8 Admin Dashboard — Backup & Recovery Panel
**Requirement:** Single page showing:
- Backup schedule + retention settings (12.1–12.2), editable
- History table of past backups (12.3): timestamp, trigger source, status, size, last-verified date
- "Backup Now" button (12.4)
- "Restore" action per historical backup row (12.5), gated by the confirmation flow above
- Storage usage summary (total space used by retained backups, against configured limits if any)

---

## MODULE 13: Session Expiry → Automatic Redirect to the Role-Correct Login

*As built (2026-08-31). Follows the Module 10.4 separate-login-window model.*

**Requirement:** When an authenticated session expires (access token lapses, or the server returns
`401`/`403` mid-use), the operator must not be stranded on a dead screen or bounced to a generic
landing page. They are redirected automatically to the login window **for their own role** — an
operator lands back on the operator login, a QA user on the QA login, etc. — so re-authentication is
one step, on the right door.

### 13.1 Trigger
- Any API call returning `401` (expired/absent token) or `403` (session no longer valid) from a
  screen that was previously authenticated.
- The client does not wait for the user to click something — the redirect fires on the failed call.

### 13.2 Role-Correct Target
- The role the user last authenticated as determines the login window they are sent to (each role has
  its own login route under the Module 10.4 separation).
- The pre-expiry destination is preserved where practical so that, after re-login, the user returns to
  where they were rather than a default home.

**Rule:** A session expiry must never silently drop the user onto another role's login or a blank
page — the redirect target is always the login that can actually re-establish *that* user's session.

## MODULE 14: Notification Bell — Server-Backed, Scoped to the Actor, Per-User Seen

*As built (2026-08-31). Replaces the earlier client-only toast-fed bell.*

**Requirement:** The header notification bell is a durable, cross-device inbox — not a mirror of
transient per-screen toasts. Each user sees only the notifications meant for them, unread state is
tracked per user, and an admin can broadcast a message to everyone or to a single role.

### 14.1 Server Is the Source of Truth
- The bell reads `GET /api/notifications` (polled) rather than recording local toasts. Transient scan
  results / per-screen toasts no longer reach the bell.
- Notification rows are written server-side at the event source (`pushNotification`), so history
  survives reload and is consistent across devices.

### 14.2 Scoping (who sees a notification)
A notification is visible to a caller when it is **global** (un-targeted) **OR** `target_role` = the
caller's role **OR** `target_user_id` = the caller's id. Supervisor and admin see everything
(oversight). Event targeting: BOM events → QA; QA requests → QA; QA results → operators; handover →
the recipient user.

### 14.3 Per-User Seen ("auto-clear on view")
- Seen state lives in a `notification_seen(notification_id, user_id, seen_at)` join table with a
  unique `(notification_id, user_id)` index — **not** a single column on the row, because one
  role-/global-targeted row is read independently by many users.
- Opening the bell marks the currently-shown unread ids seen for that caller only
  (`POST /api/notifications/seen`, idempotent). History is never mutated or deleted.
- The seen endpoint re-applies the visibility filter, so a client cannot mark another user's row seen.

### 14.4 Admin Broadcast
- `POST /api/admin/notifications/broadcast` (admin-only, IP-guarded) writes one broadcast row, either
  global or to a single validated role, and is audited as `NOTIFICATION_BROADCAST` (Module 9.2).

**Rule:** Unread state is per user and server-held; no user's action on a shared notification clears
it for anyone else.

## MODULE 15: Session Final-Report PDF Archived to a Fixed Filesystem Root

*As built (2026-08-31). Mirrors the Module 12.1 fixed-storage-root pattern, but softer — reports are
not disaster-recovery snapshots.*

**Requirement:** Every session final-report PDF that is generated and streamed to an operator is also
persisted, byte-identical, to a fixed archive root on disk, with a database record of its path, size,
and checksum — so there is a permanent server-side copy of exactly what was delivered, without a
re-render.

### 15.1 Tee, Don't Re-Render
- The report PDF is streamed to the operator **and** simultaneously piped to an archive file (a "tee")
  — the archived bytes are identical to the download by construction; no second generator to drift.

### 15.2 Storage Layout & Record
- Files land under `REPORT_ARCHIVE_ROOT/{year}/{month}/{report_type}/{entity_id}_{timestamp}.pdf`.
- One row per report in `report_archive_record`: `report_type`, `related_entity_id`, `file_path`,
  `file_size_bytes`, `checksum` (sha256 hex), `generated_at`.
- Deduped on a unique `(report_type, related_entity_id)` index — a session's canonical archive is
  written once no matter how many times the report is re-downloaded; a lost dedup race deletes the
  redundant file. Retention is indefinite (nothing prunes this archive).

### 15.3 Storage Policy (softer than backups)
| Setting | Field | Notes |
|---|---|---|
| `REPORT_ARCHIVE_ROOT` | Env var (path) | Unset/blank → archival **disabled** with a loud error log; the download still works |
| `REPORT_ARCHIVE_ALLOW_SAME_DISK` | Env var (`true`) | Acknowledges same-disk-as-DB; downgrades the same-disk **warning** to info |

- Same physical disk as the Postgres data directory → a **warning only** (never a block, unlike
  Module 12 backups which refuse to schedule) — reports are regenerable-adjacent, not DR snapshots.

**Rule:** Archival must never break report delivery — a missing/misconfigured/failed archive logs and
is skipped; the operator's download is never coupled to archive success.

---

## Dependency Notes (flag before implementation)
1. **Cavity count (Module 5) must exist before OEE/total-output calculations (Module 3.2) can run correctly** — sequence BOM import changes first.
2. **Ownership model (Module 2.2 / 4.3)** needs to move from single `owner_operator_id` to a list/array or a join table (`changeover_operators`) — this is a schema decision, confirm before building UI.
3. **Report unification (Module 6.2)** requires both QA and Supervisor dashboards to write to a shared data model, not separate silos — confirm current architecture supports this.
4. **PPM formula (Module 7.4)** needs a defined "total inspected quantity" source — confirm whether this comes from production quantity or a separate inspection count field.
5. **IP restriction (Module 10.2) must be built before or alongside login separation (10.4)** — a separate login window with no IP enforcement behind it gives a false sense of security.
6. **DB password rotation (10.3) needs a decision on where the encryption key itself is stored** (e.g. OS-level secrets manager / vault) — confirm with infra before implementation, since this can't safely live in the same DB it protects. **Status: deferred — see 10.3 note.**
7. **Component Master (11.2) and BOM (Module 5) must share the same `component_id` key** — BOM's existing "component" reference needs to point at this new master table rather than a free-text part number, or scan-to-verify (11.5) can't resolve correctly.
8. **Reel Master (11.4) depends on Store login (10.4) being built first** — reels must be logged at intake before they can be scanned/verified at loading check.
9. **Backup storage location (12.1) must be decided before scheduling goes live** — local-secondary-disk is the fastest to implement but weakest protection (survives disk corruption, not server loss/theft); confirm with infra what's actually available (NAS, cloud, offsite).
10. **Restore (12.5) must be built after Module 10 maintenance-mode lockdown exists** — a restore performed while the system is live and being written to risks inconsistent results.

---

## Suggested Build Order
1. BOM import — cavity count field (Module 5)
2. Component Master + Part Number Alias Table (Module 11.2–11.3) — build before BOM linking so BOM can reference canonical component_id
3. Changeover start — line number + BOM skip/approval (Module 1)
4. Concurrency + ownership rules (Module 2)
5. Changeover closure data capture + calculation (Module 3)
6. Handover flow end-to-end (Module 4)
7. Final report — fields + Excel export (Module 6)
8. QA Inhouse Rejection page + charts (Module 7)
9. Bypass tracking graphs (Module 8)
10. Admin audit log + monitoring dashboard (Module 9)
11. Device/IP restriction, separate login windows, DB password security (Module 10) — recommend building this early/in parallel, since it gates access to everything else
12. Reel/Lot Master, scan-to-verify, bin change alerts (Module 11.4–11.6) — after Store login (10.4) and Component Master (11.2–11.3) are in place
13. **Automated scheduled backup + manual trigger (Module 12.1–12.4)** — build early/in parallel with Module 10, since every module above is generating data worth protecting from day one; don't wait until the end of the build to start backing up
14. Restore process + verification/test-restore automation (Module 12.5–12.6) — after maintenance-mode (Module 10.3) exists
