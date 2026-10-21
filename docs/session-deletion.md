# Session deletion (v2.7.2)

Delete Session removes the closed session, its saved rounds and those rounds' score contributions. Both manual and online history use the same administrator-only backend workflow. Player profiles and unrelated sessions/rounds are preserved. Stop Session remains room-owner-only.

The confirmation previews the selected round count and each human player's lifetime change. Removing negative score contributions increases the remaining lifetime total. Lifetime rankings derive from the remaining rounds; no compensating score record is added. Live online session totals are not copied into lifetime a second time.

Explicit sessionId determines round ownership. Older untagged manual rounds use the original inclusive start/end timestamps, excluding online records and rounds explicitly linked elsewhere. Ambiguous overlapping legacy sessions are rejected rather than deleting unrelated history. Active sessions must be stopped first.

Deletion uses an administrator-authenticated preview hash, persisted job, private recovery archive and transactions of at most 100 records per page. A temporary server-owned lock prevents racing manual-history writes. Cloudflare Durable Object alarms resume interrupted jobs. Repeated commands do not remove points twice. Old summary-only online clients must update before deleting.

Canonical stopped-room state remains as a server-only tombstone for audit/idempotency; public room/history, private hand documents and room-list memberships are removed. Recovery archives are not accessible to clients and do not participate in score calculations. Native additionally saves its existing local recovery backup before deletion.

Destructive verification uses demo emulators only. Never run synthetic deletion tests against production user data.
