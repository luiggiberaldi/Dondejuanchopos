# 🔧 FASE 2 — Handoff for implementation: `replace_sales_history`

> **Audience:** WorkBuddy (or any agent continuing `docs/PLAN-MAESTRO-FIX-SYNC-VENTAS.md`).
> **Scope:** Rebuild the production PC's local sales history (`bodega_sales_v1` in IndexedDB)
> from the consolidated cloud Doc 60, so its sale numbering and pushes become legitimate.
> **Status of the rest of the plan:** FASE 1 (merge-on-push) is implemented, deployed and
> pending activation — see §5 for the exact activation ordering FASE 2 must respect.

---

## 1. Why this exists (incident context)

- The POS is **push-only** for sales; it never pulls `bodega_sales_v1` from the cloud.
- After the 11-09 incident, the PC's local history was truncated: **2 closes vs 42 in cloud**.
  Its local numbering (`max(local)+1`) produced #787–#808, colliding with cloud numbering.
- The anti-overwrite breaker (≥39 closes) blocked every sales push → new sales were trapped
  in the PC's IndexedDB (rescued manually on 12-09, renumbered #804–#817 in cloud).
- FASE 1 (already live in production) makes the push a **union merge**, so no more sales are
  lost — but the PC's *local* history is still truncated and still mis-numbered. FASE 2
  rebuilds it once, during closed hours, so numbering aligns permanently.
- The PC and a **ghost instance** (same `device_id` `PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`,
  stale Aug-19 dataset in a different browser) both consume supervisor commands. Design for
  multiple writers.

---

## 2. What to build

### 2.1 New command action: `replace_sales_history` (two-phase)

Ride the existing envelope — the live DB check constraint on
`supervisor_commands.command_type` only accepts the original 7 types, so use:

```json
{ "command_type": "inventory_update", "payload": { "action": "replace_sales_history", "phase": "prepare" } }
{ "command_type": "inventory_update", "payload": { "action": "replace_sales_history", "phase": "apply", "confirmToken": "<cierreCount>:<maxSaleNumber>:<recordCount>" } }
```

**Routing (in `src/hooks/useSupervisorCommands.js`):** extend the discriminator pattern you
already fixed for `enable_feature` — the generic inventory branch currently excludes
`action !== 'enable_feature'`; it must also exclude `action === 'replace_sales_history'`,
which gets its own branch. Old PC code will fail unknown actions with "Acción inválida"
(harmless) until the Service Worker activates — the retry loop handles this (§5).

### 2.2 Phase `prepare` — validate + backup only (no mutations of sales)

All gates must pass; on any failure, `updateCommandStatus(id, 'failed', reason)` and stop.

1. **Production device only:** `activeDeviceId === 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F'`.
2. **No active shift:** scan local sales; find the latest `APERTURA_CAJA`; if no
   `REGISTRO_CIERRE` exists after it (timestamp + `cierreId` chain), the box is open → fail
   with "turno activo — reintentar en horario cerrado".
3. **Cloud reference is sane:** fetch cloud Doc 60 via
   `fetchCloudSalesReference(activeDeviceId)` (`src/utils/salesPushMerge.js`). **Bypass the
   15s TTL cache — this decision needs a fresh read** (add a `{ fresh: true }` option or
   clear the cache before calling). Require: is an array, contains ≥1 `REGISTRO_CIERRE`,
   and its max `saleNumber` ≥ local max `saleNumber`.
4. **Mandatory pre-backup:** trigger the same full local backup the existing
   `request_full_backup` handler runs (reuse its code path, do not duplicate it), and
   **verify it uploaded** (check via the `read_paired_cloud_backup` RPC or the insert's
   return). If the backup can't be verified → fail. This backup is the rollback for apply.
5. On success: mark `applied` with a result message containing the computed
   `confirmToken = `${cierreCount}:${maxSaleNumber}:${recordCount}`` of the cloud reference
   used (put it in whatever result/status-message column the commands table has — check
   schema; note the table has no `result` column, earlier `select('result')` failed; use the
   status message field or logEvent). Do NOT modify `bodega_sales_v1` in this phase.

### 2.3 Phase `apply` — the rebuild

Gate everything with `withLock('pos_write_lock', ...)` (same pattern as the customer
handlers). Order inside the lock:

1. Re-run gates 1, 2 from prepare (device, no active shift) — state may have changed.
2. Re-fetch the cloud reference **fresh** and recompute
   `${cierreCount}:${maxSaleNumber}:${recordCount}`; require exact match with
   `payload.confirmToken`. This is the confirmation: it proves the enqueuer verified the
   *same* cloud state without needing a result round-trip, and that the cloud hasn't moved
   since (e.g., no sales between prepare and apply — box is closed, so this should hold).
3. Overwrite local `bodega_sales_v1` with the cloud array via
   `storageService.setItem('bodega_sales_v1', cloudReference)`.
   - **Only** `bodega_sales_v1` is touched. Never customers, products, or any other key.
   - Never touch the localStorage feature flags (`dj_sales_push_merge_v1` must remain as-is).
4. **Post-apply invariants** (report, don't auto-rollback): local cierre count ==
   cloud cierre count; local max saleNumber == cloud max; active-shift state consistent
   (none open). Append an audit record via `logEvent` (auditService) describing the
   restoration: date, source (Doc 60), counts, command id.
5. Trigger **one** immediate `pushCloudSyncNow('bodega_sales_v1', ...)` — with FASE 1
   active this is a no-op union (local == cloud) and confirms the pipeline end-to-end.
   If FASE 1's flag is NOT active, skip this push (don't push a fresh full history through
   the legacy breaker path — it would be blocked anyway; harmless but noisy).
6. Mark `applied` with a result summary (counts before → after).

### 2.4 Optional pure helper (recommended for testability)

Extract `validateReplacePreconditions(localSales, cloudReference, confirmToken)` into a
pure function (e.g. `src/utils/salesHistoryRestore.js`) returning
`{ ok, reason, confirmToken }` — unit-testable without storage/network, matching the repo's
test style (see `tests/salesPushMerge.test.js` and the source-invariant pattern in
`tests/shiftHistoricalCierresGuard.test.js`).

---

## 3. Safety analysis (why the gates are what they are)

| Risk | Mitigation |
|---|---|
| Replace destroys the PC's unsynced 12:30am close / final sales | **Ordering (§5):** FASE 1 is activated first, so the PC's own push union-merges those records into Doc 60 *before* apply. The fresh cloud read in `apply` then *contains* them. The pre-backup in `prepare` is a second net. |
| Ghost instance (same device_id) applies the command | Accepted and safe by design: if the ghost applies `replace_sales_history`, its stale local store becomes a copy of cloud Doc 60 — harmless (its pushes were already breaker-blocked; post-replace its pushes would be cloud-identical). The token gate prevents applying against a *moved* cloud. Do not add a fingerprint check as a blocker — it's unproven; document it as FASE 3A follow-up. |
| Cloud changes between prepare and apply | `confirmToken` must match a fresh recompute; mismatch → fail, re-run prepare. |
| Operator reopens the box between prepare and apply | Gate 2 re-checked inside apply's lock → fail cleanly. |
| Old Service Worker consumes the command as "Acción inválida" | Known pattern: retry loop (§5). Every failed attempt is status `failed`, no side effects. |
| Rollback | The `prepare` backup in `cloud_backups` + existing `backups/` snapshots. Restoration = re-run `request_full_backup` to confirm, then re-apply replace from cloud (idempotent). |

---

## 4. Tests to add

1. Pure-function tests for `validateReplacePreconditions`: open shift → reject; cloud
   missing closes → reject; max saleNumber regression → reject; token mismatch → reject;
   happy path → ok with correct token.
2. Source-invariant tests asserting in `useSupervisorCommands.js`: the generic inventory
   branch excludes `replace_sales_history`; the handler gates check device id, active shift,
   fresh cloud read, and backup-before-apply; only `bodega_sales_v1` is written.
3. Keep the repo's stable-runner invocation in mind:
   `--pool=vmThreads --maxWorkers=2` (default pool was failing in this environment; see
   `outputs/supervisor-tests-final-1209.log`).

---

## 5. Deployment & activation sequence (exact order — this matters)

The PC has been offline since 04:30 UTC 12-09 (closed at ~00:30 local). Three commands are
already pending for it: `enable_feature` ×2 (04:46, 06:10 — idempotent duplicates, do NOT
enqueue a third) and `request_full_backup` (04:52). When the PC reconnects:

1. **Deploy the FASE 2 code to production** (`npm run build && npx vercel --prod --yes`,
   project `dondejuanchopos`) any time before the PC reconnects — old code fails the
   envelope harmlessly, so early deploy is safe.
2. PC reconnects → pending `enable_feature` applies → FASE 1 active on the production
   device. Verify `logs/wait-merge.log` / the wait loop (`scripts/wait-and-activate-merge.mjs`)
   reported success; if the loop died during the session restart, re-run it once the PC is
   back rather than re-enqueuing manually.
3. **Wait for the PC's own merged push:** poll Doc 60 until the 12:30am close and any
   post-02:43 sales appear (they arrive via FASE 1's union merge — no manual surgery).
   Sanity-check the close totals against the close record.
4. Wait for pending `request_full_backup` (04:52) to apply; verify the backup landed.
5. Enqueue `replace_sales_history` phase `prepare`. Retry every ~3.5 min on failure
   (reuse the `scripts/wait-and-activate-merge.mjs` loop pattern).
6. On prepare success, enqueue phase `apply` with the token from the cloud state the
   enqueuer verified (must equal what prepare computed).
7. Verify apply → enqueue one final `request_full_backup` → confirm the PC's local history
   now mirrors Doc 60 (42+ closes, canonical numbering). FASE 2 complete.

**Fallback:** if step 3 shows the PC's push did NOT arrive within ~15 min of activation
(rare: flag applied but push cadence delayed), do NOT proceed to replace — first rescue the
missing records into Doc 60 manually using the fresh backup as source
(`scripts/rescue-14-sales-and-fix-abono-11092026.mjs` pattern: snapshot → insert → verify),
then continue from step 5.

---

## 6. Docs to update when done

- `docs/PLAN-MAESTRO-FIX-SYNC-VENTAS.md` — FASE 2 status + decisions taken.
- `docs/BITACORA-SESION-1009-1209-2026.md` — session log entry.
- `.agents/AGENTS.md` §9 — mark "Reconstruir el historial del PC" as done.

## 7. Explicitly out of scope (later phases)

- FASE 3A ghost-instance identity separation; FASE 3B central sale numbering at invoice
  time; FASE 4 divergence alerting in the Monitor. Do not bundle them here.
- Do not commit scratch/, backups/, outputs/ artifacts. Do not push to git (no commit was
  requested by the user yet).
