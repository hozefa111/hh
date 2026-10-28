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
# Authenticated heartbeat recovery

An automatic `ping`/`pong` response proves transport reachability, not execution
of an overdue turn. A locally suppressed alarm reproduced a healthy pong with a
stuck bot in both seat modes. During an active timed hand, existing pings now
reach the room actor; a heartbeat checks the server deadline and dispatches only
an already-due generation through `GameService.due` and the existing state queue.
The normal alarm remains primary. Repeated pings cannot duplicate a move, shorten
a deadline, resume a paused game, change teams, or bypass legal-move validation.

Lobby, paused, untimed and between-hand sockets retain automatic responses and
hibernation. Presence uses the newer of automatic-response and manual-heartbeat
timestamps so switching modes cannot falsely disconnect a connected player.

Equivalent local SQLite/workerd tests: both old-mode cases remained stuck despite
pongs; both new-mode cases advanced after the recovery ping and resumed normal
alarms. Five healthy active-game pings cost five SQLite row reads, zero writes
and zero Firebase calls in a warm actor. Cold activation can add a room read;
completed-hand exports retain their existing separate cost. These are local
measurements, not production free-tier or latency guarantees.

An optional `/kaliRoomHealth` observation requires a random 256-bit operator key,
its configured SHA-256 hash, an exact room code and a bounded expiry (maximum one
hour). It returns only the existing card/identity-free progress allowlist. It
does not arm alarms, change presence, broadcast or flush. Both the outer route
and room actor validate the key; the normal player route cannot invoke this
operation. It is disabled without the expiring `ROOM_HEALTH_PROBE` setting.

The reported production freeze had already been resumed before observation.
Its original upstream cause is unproven; the recovery guard addresses the
reproduced missing-progress failure without attributing it to the user's ISP.
