Manual session guard rollout
===========================

The conditional Firestore rules must be deployed before the updated web/Android
writers. With `meta/manualSession` absent, older editor devices remain compatible.
New writers still reject stale/concurrent starts through a journal-head precondition.

After every admin/editor phone has updated to v2.7.27 or later and web tabs have
refreshed, the owner can approve the server guard cutover. Never infer that all
devices have updated. With `TRACKER_SERVICE_ACCOUNT_FILE` configured, run:

    node backend/free/manual-session-cutover.mjs --project patti-pro-a61d8

This is read-only. It rejects ambiguous existing active sessions without modifying
them. Activation additionally requires `--apply --editors-updated --rules-verified`.
The single pointer is created in a serializable transaction; tracker mode, epoch,
records, scores and historical session documents are untouched. Old client writes
then fail atomically, including the first batch of old clear/restore operations.
Normal new round saves bind to the authoritative current manual session; historical
restore retains original session IDs. Online rooms and exports ignore this pointer.

Emergency compatibility rollback uses the same tool with `--apply --disable`,
removing only this pointer. It relaxes the new session guard, not Incremental Sync.
Do not deploy old rules/writers while assuming the stronger guard remains active.
