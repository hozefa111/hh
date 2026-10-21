# Presence recovery, v2.7.3

RTDB connection registration now requires an immediate authenticated server acknowledgement. The backend reads the caller's actual RTDB connections; clients cannot assert a forged connected flag or modify another participant. A genuine disconnect still pauses an active hand and preserves cards/deadlines; reconnect does not silently resume an administrator-paused hand.

The online client retries failed ACL grants and registrations with bounded exponential backoff, keeps a real subscription to its own presence records, repairs lost registrations and rechecks its seat on foreground/network recovery. The server's slower background polling remains a recovery mechanism. Generation checks prevent callbacks from a previous room/account/socket from claiming the current seat. Cleanup cancels retry timers and listeners.

ONLINE requires local acknowledgement plus authoritative seat connectivity. Android's existing Activity invokes the same repair hook on resume. Room identity, hands, readiness rules, timers, scoring and all existing history remain authoritative and unchanged.

Destructive/network-failure verification uses demo emulators only. Production diagnosis is read-only, and no synthetic player is added to the real Players list.

## v2.7.4 recovery and lifecycle

Manual Reconnect resets the RTDB transport and restores the same identity, seat and private hand. Old connection removals are nonblocking. Each presence registration attempt has a 15-second cancellation bound; socket loss invalidates and cancels unresolved old registration work so it cannot leave the retry loop permanently busy. The header requires both local acknowledgement and a consistent authoritative connected status. Backend acknowledgement/alarm reconciliation also repairs stale Disconnected labels.

Admin Pause/Resume is visible outside management, including before/between hands. Paused lobbies cannot start via Ready. Active pauses retain existing deadline handling. Reconnect restores presence; it does not silently resume a paused session. Deleted/missing/revoked rooms clear cached tables, private cards and saved room IDs with a readable message; they cannot be resumed or resurrected.

The screenshot room Q6GXJ5GB was not found by a read-only production lookup during diagnosis. This is separate from the reproduced pending-registration/socket-loss regression and does not justify changing production session data.
