# Targeted Firebase usage changes

Hand history now has one on-demand subscription, removed on close/room exit/auth change. A generation guard rejects late callbacks. Older history paging remains available. Active room memberships query only lobby/playing/between; completed sessions remain in existing sessions/history records. Failed presence retries use exponential backoff capped at 60 seconds; watchdog/snapshots respect the retry deadline, while online/RTDB reconnection resets the deadline immediately.

Membership projections no longer rewrite an identical summary merely because Ready/Disconnected status changed. Removed/rejoined membership, room status, name, readiness in the public room, private hands, canonical revisions, score records and receipts retain their existing behaviour. Public room writes on genuine moves are intentionally retained. No-op presence and receipt retries already avoided public rewrites, so those paths were not redesigned.

Measured in the demo Firestore emulator (not production billing):

| Scenario | Before | After |
| --- | ---: | ---: |
| History document deliveries, three closed-pane room visits/reconnects with one completed hand each | 78 | 0 |
| Active-membership startup, 100 closed + 2 active records | 102 | 2 |
| Committed writes, one 4-human completed hand including readiness | 217 | 214 |
| Committed writes, one 6-human completed hand including readiness | 251 | 246 |
| Backend point-read requests, 4-human hand | 98 | 98 |
| Backend point-read requests, 6-human hand | 110 | 110 |

Opening history still reads up to 25 recent records, and reopening incurs a fresh query. Browser fake-clock comparison of the actual old/new presence helpers: 53 to 11 failed API attempts over five simulated minutes (~79% fewer); both browser-online and RTDB reconnect retried immediately. This is not a measured production read reduction.

Validation: two emulator integration tests passed (including full-hand persistence/replay); focused browser lifecycle/backoff test passed; 24 backend unit tests passed. The four emulator-gated cases skip in a plain unit invocation; the relevant two were explicitly run with Firestore. Existing card/playback/scoring rules and production Firebase records were not changed or migrated. Existing deployment requires normal client distribution to apply browser/native subscription changes.

Risks: simulator counts exclude Firestore security-rule dependent reads, listener minimum charges, conflicts and unrelated tracker screens. Read/write limits can still be exceeded by genuine usage. No permanent quota resolution is claimed. No APK build was performed.
