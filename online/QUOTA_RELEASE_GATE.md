# v2.7.14 release gate — blocked

Live Firestore one-record admin/player reads returned HTTP 429 RESOURCE_EXHAUSTED, "Quota exceeded." This is independent of the Android UI or Cloudflare network status.

Backend now preserves quota errors as retryable HTTP 429 with Retry-After, shares a five-minute database circuit breaker across request adapters, and defers room alarms during the cooldown. Infrastructure failures use 503 and expired tokens use 401. No database migration, security-rule change, scoring change or room deletion.

Client retains uncertain commands and their original IDs, honours Retry-After, and displays DATABASE LIMIT after a confirmed database-quota response. Previously verified card playback/double-tap implementations are retained.

Validation: 23 backend tests passed; three emulator integration cases skipped. Focused browser recovery/token-refresh/lost-response/quota-backoff checks passed. Existing visibility/double-tap suites were not repeated. Live Create/Stop cannot be certified while Firestore rejects database operations. No production test rooms were created or existing sessions stopped.

Deployed Worker version: 91f7a7c3-6cf6-4506-a140-b0397f41cc4f.

Release must remain unpublished until live quota recovers and authorized non-destructive live verification can complete. A new APK does not increase Firebase quota. Free-plan quota must recover; no paid-plan change was made.
