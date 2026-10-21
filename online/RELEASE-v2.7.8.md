# Online controls and recovery — v2.7.8

The online screen now retains its table, hand, bid selector and scroll containers during real-time updates. Unchanged markup does not rebuild the DOM. Changed content is reconciled in place, including stable hand-history identities. Mobile paint work is reduced by removing backdrop/card filters and animating transforms and opacity.

Stop Session uses an accessible in-app dialog with Finish hand & stop, Void hand & stop, and Keep playing. Other online confirmations use the same component. Explicit positioning fallbacks keep dialogs and drawers on-screen in older Android WebViews. A stale stop dialog cannot stop a newer hand.

A bid touch remembers the displayed turn and amount. A concurrent auction change rejects that stale touch rather than submitting a different amount. Accepted or rejected requests release busy controls, and slow requests display a waiting notice. Scores remain server-authoritative.

The free backend batches room/receipt reads, avoids unrelated global-role reads on ordinary room moves, and persists retry backoff after transient failures. Shared roster profiles are scoped to room participation rather than permanently locked to the first device identity. Existing active seat/private-card ownership is still protected; another identity cannot take it over.

## Actual verification

Tested web source: `cd80d316acd425247c54eb84f769e69b8ecbfb0b`.

[GitHub Actions run 39624743341](https://github.com/hozefa111/hh/actions/runs/39624743341) passed:

- 72 rules/service tests.
- 7 Firebase emulator security tests.
- 85 browser checks across multiplayer, network, presence, native origin, session deletion, compact layouts, feedback, retained controls and dialogs.
- 18 free-backend tests, including actual Miniflare/Firestore-emulator integration, with zero skips in the integration step.

The preliminary adapter-only step skips its two emulator-dependent cases; both run in the subsequent integration step. Destructive test fixtures use emulators, not production data.

Synthetic Chromium tests under 4x CPU throttling preserve focus, selected bid and nodes through 80 unchanged snapshots with zero structural mutations. These measurements do not establish physical-phone FPS or internet latency. Physical-device performance has not been measured.

The Android APK release remains gated by its own final Android 11/15 instrumentation and signed Release build. See the APK repository's release report for those results and the final checksum.
