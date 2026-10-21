# Presence recovery, v2.7.3

RTDB connection registration now requires an immediate authenticated server acknowledgement. The backend reads the caller's actual RTDB connections; clients cannot assert a forged connected flag or modify another participant. A genuine disconnect still pauses an active hand and preserves cards/deadlines; reconnect does not silently resume an administrator-paused hand.

The online client retries failed ACL grants and registrations with bounded exponential backoff, keeps a real subscription to its own presence records, repairs lost registrations and rechecks its seat on foreground/network recovery. The server's slower background polling remains a recovery mechanism. Generation checks prevent callbacks from a previous room/account/socket from claiming the current seat. Cleanup cancels retry timers and listeners.

ONLINE requires local acknowledgement plus authoritative seat connectivity. Android's existing Activity invokes the same repair hook on resume. Room identity, hands, readiness rules, timers, scoring and all existing history remain authoritative and unchanged.

Destructive/network-failure verification uses demo emulators only. Production diagnosis is read-only, and no synthetic player is added to the real Players list.
