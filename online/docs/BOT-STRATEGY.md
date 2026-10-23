# Normal bot intelligence upgrade

## Scope and root causes

`online/shared/bot.js` is the authority source. `online/build.cjs` generates the WebView-compatible runtime and Functions copy; `npm run sync:android` also updates the same Android app and its emulator backend fixture. The free Worker imports `functions/online/service.js`, which calls the generated policy with `publicState(room)` plus only the acting player's cards. That execution boundary is unchanged.

The old policy already knew that a bot holding the called card was a partner and could legally play a winning King. The reported behaviour was not a universal inability to recognise the King. Its strategic limitations were:

- Any possible unseen beating card was treated as a certain threat, without ownership probability, hand size or reliable follow-suit constraints.
- Follow-up play took an available win without balancing contract urgency, points or future trump value.
- Before reveal, it could identify the bidder/direct partner/own called role, but had no graded inference for other identities.
- Auction strength was mostly suit length and a count of A/K/Q; partner selection preferred the 30-point 3♠ over stronger trick controls.

No rule, scoring, timer, admission, permission, Firebase schema or network code is changed.

## Decision policy

Easy retains its simple low-card play and conservative auction. Normal uses deterministic, bounded candidate scoring; no model, API, database read, dependency or full-tree search is added.

1. Build a fresh observation from own cards, public tricks (including the current trick), revealed teams, captured points and public remaining card counts. Off-suit plays establish suit shortages.
2. Determine certain teammates from bidder/direct partner, own called-card ownership, or public reveal. Unknown membership is an explicit approximate probability, not a leaked secret. The direct/called duplicate is not counted as another certain teammate. A holder knows all bidding-team identities from its own cards and the public direct partner.
3. For each legal candidate, estimate whether later opponents can beat it. Sampling-without-replacement probabilities use only remaining possible cards, player counts and known voids. A ruff is possible only when the player can be void in the led suit.
4. Score expected team capture, likely points from remaining seats, next-lead value, own-card donation value, future master/trump preservation and the remaining contract target. Own donation value is discounted because saved points can also be captured later. The opposition's target is strictly more than `250 - bid`.
5. Retain the proven master-card opening lead policy: cash a suitable outstanding master, avoid known opposing ruff threats, otherwise lead cheaply. The initial replacement lead heuristic regressed in a development comparison and was discarded.
6. Choose the highest-scoring legal card with stable point/rank/suit tie-breaking. Called cards receive no automatic-play requirement or arbitrary reveal reward: reveal follows a worthwhile legal play, and preserving the card is valid. A called King wins a valuable trick when that is better than alternatives, but can be retained behind a secure teammate Ace, discarded only when justified, or disabled by follow-suit.

Auction/trump evaluation considers top sequences, trump length/control, outside Aces and supported Kings, short suits and potential ruffs. The partner contribution is discounted and does not assume six-player partners are distinct. Normal's estimated limit is conservatively capped at 230; game rules still permit humans to bid directly up to 250. Called-card selection prefers missing high controls, especially trump, rather than points alone. Direct partner selection remains the opposite logical seat because no partner's private cards are available.

## Verification and measurements

`npm run test:bots` covers called King capture/conservation/legality, secret-holder cooperation, direct and duplicate partners, four/six-player teams, opponent teamwork after reveal, cheap trump captures, valuable tricks, quiet-trick preservation, urgency, public voids, exhausted high cards, bidding/trump/partner choice and throwing getters for forbidden private fields. Existing engine/service tests verify scoring, reveal timing, exact 250 captured points, idempotence and deadlines.

`npm run test:bot-comparison` compares the frozen pre-upgrade policy in `online/test/fixtures/bot-v2710.cjs` against the new policy. Within each seed the deal, bid, bidder, trump and partner choices are identical and selected using the old policy. Only card play varies. The harness uses canonical teams to choose which policy runs, but `decide()` only receives public state and that participant's cards.

A development sample used seeds 1–128. After choosing the final policy, a separate holdout used seeds 129–384, **256 per mode, four matched variants = 2,048 completed hands**. No policy adjustment followed the holdout. All hands captured exactly 250, score deltas matched the original engine, and **illegal moves = 0**.

| Holdout comparison | 4 players | 6 players |
|---|---:|---:|
| Old bidding-team win rate, all old bots | 48.05% | 49.22% |
| New bidding team versus old opposition | 51.17% | 54.69% |
| Old opposition win rate, all old bots | 51.95% | 50.78% |
| New opposition versus old bidding team | 52.73% | 54.30% |
| Bidder-team win rate when all bots are new | 49.61% | 50.39% |

These observed gains are not proof of optimal play or statistical significance. The development sample had a small six-player bidding-team win-rate decrease (55.47% to 54.69%), despite higher average captures; results vary by deals. An all-new bidder win rate is not a standalone measure of bot quality because both teams improve.

The holdout measured 41,984 new-policy decisions in local Node 24: median **0.031 ms**, p95 **0.215 ms**, p99 **0.569 ms**, maximum **22.14 ms**. The maximum includes process/GC scheduling; these are local synchronous CPU observations, not Worker production CPU guarantees, phone FPS or network latency. Raw results are checked in under `online/test/results`.

Reproduce the holdout:

```sh
KALI_BOT_SIM_SEEDS=256 KALI_BOT_SIM_START=129 npm run test:bot-comparison
```

## Limits and deployment

Threat estimates assume a distribution of unseen cards and approximate independence between players. They do not solve the full deal, learn bidding conventions, infer deliberate signals, or plan every future trick. Trump/partner selection is heuristic. Human playtests remain valuable; bots can still make mistakes.

A rebuilt APK alone does not upgrade hosted bots: the free Worker bundle must also be deployed after validation. No Firebase data migration, rule/index deployment, paid plan or production QA records are needed. Keep source, generated server copy, bundled runtime and Android fixture synchronized with the existing scripts. See the implementation verification report for actual deployment/build status; this document describes the policy, not a deployment assertion.
