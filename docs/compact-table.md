# Single-screen gameplay (v2.7.4)

Live bidding, Hukum selection, partner selection and trick play use a viewport-sized layout in the existing app. Every local card is visible in a non-overlapping two-row grid (or one row when the hand becomes small); horizontal hand scrolling is removed. Short landscape screens place the table beside the hand/controls. Room lobby and completed results keep their normal scrolling layout.

The room name/invitation/Stop Session, Hukum/contract/called card, revealed partner, table, last-trick result, turn countdown, complete hand and actions remain on the gameplay screen. Scores, full bidding/hand history and management open in closable drawers with internal scrolling. Existing controls, card highlighting, winner collection, reconnection and administrator permissions remain intact.

Human auction turns retain the existing authoritative 30-second deadline and automatic permanent PASS. This is explicitly labelled beside the raise/PASS controls. Trump/partner selection remains untimed under the confirmed rules; card-playing timeouts retain automatic legal card play. No scoring formula or game rule changed.

Regression checks cover both player modes, all gameplay phases, partial tricks and selected-card confirmation at 320x568, 360x640, 390x844, 412x915, 740x360 and 1280x800. They inspect actual card/control bounds, no document overflow, no hand swipe and working score/history drawers. The dedicated service test verifies exact auction deadline, automatic timeout reason, permanent PASS and duplicate/late action rejection.
