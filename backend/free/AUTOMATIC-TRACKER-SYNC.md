# Automatic tracker sync — staged rollout

Existing records/scoring remain authoritative. No second scoreboard. The public `trackerSync/state` document carries `mode`, `enforced`, `epoch`, monotonic `revision`, `eventId` and the changed public document paths. Each immutable `trackerChanges/<eventId>` contains only `epoch`, `revision`, `paths`. Ledger mutations and both journal writes commit atomically. No private hands/live room documents are journalled.

Updated web/native writers and both server adapters journal all supported tracker mutations, including online exports and cascade deletions. Immutable online receipts/tombstones still prevent duplicate scores/resurrection. SDK transactions preserve existing record preconditions and do not queue offline writes. A successful transaction retried internally reuses its event reference.

Incremental readers bootstrap complete public collections in 150-record ID-ordered pages, reconcile intervening invalidations in 25-event pages, fetch affected records with bounded concurrency and recheck the server head. They publish/cache only a coherent complete ledger. Deletes remove rows; edits replace records, never apply additive score credits. Cache data and checkpoint commit together. Native SQLite and web IndexedDB remain disposable public caches, not backups or pending-write queues. Background detach retains checkpoints; resume checks the small head instead of restarting history. Known quota backoff is respected. Refresh uses the same delta path.

`prepare` mode uses automatic existing full-sync fallback, required while unjournalled old editors remain allowed. `incremental` mode trusts journal coverage only after rules enforce it. The independent `enforced` flag allows rollback readers to full sync before relaxing old-writer rejection. Rules retain existing admin/online-record permissions and deny clients changing mode/epoch/enforcement. Journals are retained; no paid TTL, migration or monitoring writes.

## Verification evidence

- Actual Firestore emulator SDK fixture: 1,001 rounds + player + session = 1,003 bootstrap record deliveries. Unchanged verified reopen: **1 tracker-head read, 0 ledger documents**. A historical edit: **1 event + 3 metadata/record reads**, exact score changed 155,360 → 155,700; historical deletion → 155,000. These are SDK document deliveries, excluding billed rule evaluation, auth/admin lookups and production WAN latency.
- Fair comparison: the prior version's fresh complete verification read all records after pressing Load. Its cheaper 25-round startup preview did **not** verify current lifetime totals. First bootstrap still reads the complete ledger; this change saves subsequent verification/reopen reads. Old warm-listener edit costs were not measured and are not claimed to improve by that ratio.
- Atomic journal protocol adds **2 Firestore writes per mutation batch**, plus metadata/receipt reads as applicable. Existing completed exports normally become 6 writes instead of 4. Live Cloudflare moves remain zero-Firestore; 4/6-seat outage/restart/private-state/receipt games passed after the adapter change.
- Focused emulator cases passed: exact edit/delete totals, unchanged reopen, stale confirmation, old-client write denial, guest/forged-journal rejection, interrupted cache commit, changes during bootstrap, duplicate refresh, staged rollback. Browser UI passed automatic first load, no manual Load button, historical edit/delete, IndexedDB reload and resume.
- Android SDK run 40208644591: 19 passed, 1 backend-dependent case skipped, 1 quota-screen failure. Native incremental CRUD/reopen, journal cache atomicity and voice save passed. The real quota-layout precedence bug was fixed; focused rerun 40209384925 passed. Broad passed tests were not rerun. Physical-device verification was not performed.

No claim of permanent quota safety: old clients can still perform costly reads; initial full verification consumes reads; journal delivery scales with active viewers; background traffic and rule-evaluation charges remain. An interrupted initial bootstrap can repeat some reads. Very large ledgers may require further resumable-bootstrap work. External privileged Console/Admin SDK edits must use the journal adapter or start a new verified epoch; Firebase rules cannot constrain service-account bypasses.

## Operator sequence

1. Deploy compatible Worker/Functions adapter as applicable, additive rules, updated web and signed APK. Keep `mode=prepare`, `enforced=false`. Functions remain optional/emulator-only on Spark; do not deploy Cloud Functions.
2. Have every admin/editor install the new APK and reload old web editing tabs. Do not infer device updates from account identity. Legacy clients may otherwise receive permission-denied errors after enforcement.
3. Confirm deployed rules and all editor upgrades. Run the server-only cutover tool with explicit confirmations to set enforced incremental mode and a new epoch. No historic record rewrite occurs; clients automatically bootstrap once.
4. Rollback: `rollback-readers` first (enforcement retained); only after fallback confirmation use `allow-legacy-writes`. Cloudflare gameplay is unaffected.

Example (credential file remains outside the repository; no passwords/tokens printed):

    TRACKER_SERVICE_ACCOUNT_FILE=/secure/service-account.json node backend/free/tracker-cutover.mjs --project patti-pro-a61d8 --action prepare --apply
    TRACKER_SERVICE_ACCOUNT_FILE=/secure/service-account.json node backend/free/tracker-cutover.mjs --project patti-pro-a61d8 --action activate --editors-updated --rules-verified --apply

Without `--apply`, the tool reports the proposed public metadata change only. Actual production enforcement must wait for editor-update confirmation, as required by the approved plan.
