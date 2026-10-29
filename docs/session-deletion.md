# Session deletion (v2.7.2)

Delete Session removes the closed session, its saved rounds and those rounds' score contributions. Both manual and online history use the same administrator-only backend workflow. Player profiles and unrelated sessions/rounds are preserved. Stop Session remains room-owner-only.

The confirmation previews the selected round count and each human player's lifetime change. Removing negative score contributions increases the remaining lifetime total. Lifetime rankings derive from the remaining rounds; no compensating score record is added. Live online session totals are not copied into lifetime a second time.

Explicit sessionId determines round ownership. Older untagged manual rounds use the original inclusive start/end timestamps, excluding online records and rounds explicitly linked elsewhere. Ambiguous overlapping legacy sessions are rejected rather than deleting unrelated history. Active sessions must be stopped first.

Deletion uses an administrator-authenticated preview hash, persisted job, private recovery archive and transactions of at most 100 records per page. A temporary server-owned lock prevents racing manual-history writes. Cloudflare Durable Object alarms resume interrupted jobs. Repeated commands do not remove points twice. Old summary-only online clients must update before deleting.

Canonical stopped-room state remains as a server-only tombstone for audit/idempotency; public room/history, private hand documents and room-list memberships are removed. Recovery archives are not accessible to clients and do not participate in score calculations. Native additionally saves its existing local recovery backup before deletion.

Destructive verification uses demo emulators only. Never run synthetic deletion tests against production user data.

Accepted Cloudflare v2 deletion status is read from SQLite without waiting for the
Firestore export/cleanup queue. Authorization checks still apply, and completion
is reported only after the existing durable cleanup confirms it. Native requests
use one command ID throughout a deletion, retry a lost transport response once
with the identical body, and distinguish uncertain confirmation from a rejected
delete. The HTTP read timeout matches the existing 25-second total call budget.

V2 cleanup now durably remembers successful tombstone setup. It reuses the
confirmed published preview only when setup leaves an existing stopped session
unchanged; the deletion transaction still recalculates and validates its hash.
Sessions materialized from pending exports retain the server-preview fallback.
Retries/restarts resume the same durable job. Temporary upstream failures back
off from 1 to 30 seconds; quota and non-transient failures retain the five-minute
cooldown. No accepted deletion is reported complete before cascade confirmation.

Local measurements (not phone/production latency): with 150 ms on each mocked
Firestore request, an empty stopped-room cascade fell from 6,796 to 5,279 ms;
point reads fell from 22 to 16 while writes stayed 14. Injected UNAVAILABLE
previously scheduled a 300-second retry and now schedules one second. Real
Firestore emulator verification also covers a four-round cascade and archives.
