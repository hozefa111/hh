# Public score viewing

`publicScoreboardRooms` and `publicScoreboardTicket` intentionally allow signed-out
tracker viewers to read session standings, just like the existing public saved
rankings. Neither operation verifies or creates a Firebase Auth identity. The
router supplies a fixed internal score scope and discards caller actions/UIDs.

The catalog is indexed and cursor-paged at 25 rooms. Tickets are single-use,
expire after 30 seconds, and are permanently scoped to score-only sockets.
Public ticket issuance is bounded to 30 per room per minute. Connections renew
through the existing five-minute socket lifetime. Score views never join seats,
change player presence or carry gameplay commands. Projection fields exclude
private hands, tricks, bids, room membership UIDs and secret partner identities.
Normal game, history and administrator requests still require existing Auth.

Deleted-room intent rejects public reads, sends an explicit removal frame and closes score sockets; delayed
exports cannot restore deleted scoreboards. Existing v2 rooms work when new-room
creation is disabled and when Firestore is unavailable. Public score reads use
SQLite and zero Firebase/Auth requests.

Android reads these endpoints without requiring login. It does not sign viewers
in anonymously. Legacy Firebase online sessions use their existing atomically
saved public rounds through normal tracker synchronization, avoiding a second,
member-only room listener. Firebase rules and scoring remain unchanged.
