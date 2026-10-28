Live timer / history export isolation
====================================

The room alarm previously awaited flush(), including external Firestore IO. While
that alarm invocation remained open, another due bot turn could not run. A
healthy WebSocket could therefore keep returning pong while gameplay stalled.

The alarm now finishes after authoritative state/deadline work and starts the
existing serialized export via waitUntil. SQLite outbox records and Firestore
receipts are unchanged. In-flight work retains a durable 30-second safety wake;
actual game deadlines take priority. This avoids one-second retry alarm spinning
while an existing export is waiting on IO. Rules, cards and timers are unchanged.

Measured on real local SQLite Durable Objects: holding an export for 2.2 seconds
prevented bot advancement in both 4/6-seat baseline fixtures. After the fix bot
turn generations advanced while the request remained held. Later export/stop
completed without creating points for the voided fixtures. Quiet human turns
added only one scheduling read in the 2.2-second measurement (the stats request).
This is local fault-injection evidence, not proof of a particular production event.

Validation: 35 backend tests pass; 7 legacy/browser/emulator-dependent cases were
skipped in that run. Two real-Firestore export/journal tests pass separately;
129 rules/client tests pass. No new Android assets or APK are required.

Optional operator flag ROOM_PROGRESS_DIAGNOSTIC=ROOMCODE@EXPIRY_MILLISECONDS
emits an explicit allowlist of phase, seat number, generation, deadline, alarm
and export status only. It expires automatically and accepts at most one hour.
It never logs names, identities, hands, called cards, teams or request headers.
Default is disabled. Collect via authenticated Cloudflare tail, not a public API.
