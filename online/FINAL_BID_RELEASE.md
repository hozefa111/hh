# Final bidding chance — v2.7.15

The last surviving highest bidder gets one final choice: keep the current bid, or increase in steps of five up to 250, then choose Hukum. This includes the default 155 bidder. No extra initial default-bidder turn or reopened auction. A bid of 250 finalizes immediately. Human final-choice timeout keeps the bid; bots use the existing own-hand strength limit. Server turn generations and existing command receipts protect retries and races.

Validation performed:
- 60 engine/final-bid tests passed, including full hands, both modes, normal bidding, permanent PASS, scoring parity, final Keep/Increase, invalid/duplicate commands, maximum and timeout.
- 22 service tests passed, including same-ID concurrent retries and duplicate timeout tasks at the final choice.
- 24 free-backend tests passed; 4 emulator-gated tests not run in the plain invocation.
- 8 browser touch scenarios passed: both modes, default 155 / raised 180, Keep and direct increase to 250 through controls.
- 14 existing card-playback browser regression checks passed.

No database migration, historic data edits, security changes, billing changes, or scoring changes. Existing rooms are preserved. Existing clients need updating to show the new final controls; on old clients a human final-choice deadline still keeps the current bid server-side.
