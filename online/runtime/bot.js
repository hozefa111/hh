(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine"));
  else root.KaliBot = factory(root.KaliRules);
})(typeof globalThis !== "undefined" ? globalThis : this, function(R) {
  "use strict";
  function low(a, b) {
    return R.points(a) - R.points(b) || R.strength(a) - R.strength(b) || R.SUITS.indexOf(R.card(a).suit) - R.SUITS.indexOf(R.card(b).suit);
  }
  function sameTeam(room, uid, other) {
    const h = room.hand;
    if (uid === other) return true;
    const known = [h.bidder, h.direct, ...h.partners || []].filter(Boolean);
    if (known.includes(uid) && known.includes(other)) return true;
    return !!h.revealed && !known.includes(uid) && !known.includes(other);
  }
  function chooseCard(room, uid, cards) {
    const h = room.hand, moves = R.legal(cards, h.trick).sort(low);
    if (moves.length === 1) return moves[0];
    const played = new Set(h.tricks.flatMap((t) => t.cards.map((p) => p.card)));
    const voids = {};
    for (const t of h.tricks) {
      const lead = t.cards[0] && R.card(t.cards[0].card).suit;
      for (const p of t.cards) if (R.card(p.card).suit !== lead) (voids[p.uid] || (voids[p.uid] = /* @__PURE__ */ new Set())).add(lead);
    }
    const selfSecret = cards.includes(h.called), known = [h.bidder, h.direct, ...h.partners || [], ...selfSecret ? [uid] : []].filter(Boolean);
    const teammate = (other) => sameTeam(room, uid, other) || known.includes(uid) && known.includes(other);
    if (!h.trick.length) {
      const remaining = R.deck(room.mode, h.config).filter((c) => !played.has(c) && !cards.includes(c));
      const masters = moves.filter((c) => !remaining.some((other) => R.card(c).suit === R.card(other).suit && R.strength(other) > R.strength(c)));
      const safe = masters.filter((c) => R.card(c).suit === h.trump || !h.seatMap.some((p) => {
        var _a;
        return p.uid !== uid && !teammate(p.uid) && ((_a = voids[p.uid]) == null ? void 0 : _a.has(R.card(c).suit));
      }));
      return safe.sort((a, b) => R.points(b) - R.points(a) || low(a, b))[0] || moves[0];
    }
    const current = R.trickWinner(h.trick, h.trump), last = h.trick.length === room.mode - 1;
    if (teammate(current)) return last ? moves.slice().sort((a, b) => R.points(b) - R.points(a) || low(a, b))[0] : moves[0];
    const winning = moves.filter((c) => R.trickWinner([...h.trick, { uid, card: c }], h.trump) === uid).sort(low), value = h.trick.reduce((n, p) => n + R.points(p.card), 0);
    return winning.length && (value >= 10 || last && value + R.points(winning[0]) >= 5) ? winning[0] : moves[0];
  }
  function decide(room, uid, cards, difficulty = "normal") {
    const h = room.hand;
    if (h.phase === "auction") {
      const suits = R.SUITS.map((s) => cards.filter((c) => R.card(c).suit === s));
      const best = Math.max(...suits.map((cs) => cs.length * 5 + cs.filter((c) => ["A", "K", "Q"].includes(R.card(c).rank)).length * 7));
      const limit = Math.min(difficulty === "easy" ? 170 : 210, 155 + 5 * Math.max(0, Math.floor((best - (difficulty === "easy" ? 30 : 18)) / 5)));
      return h.bid < limit ? { type: "bid", bid: h.bid + 5 } : { type: "bid", pass: true };
    }
    if (h.phase === "trump") {
      const suit = R.SUITS.map((s) => ({ s, value: cards.filter((c) => R.card(c).suit === s).reduce((n, c) => n + 5 + R.strength(c) + R.points(c) / 5, 0) })).sort((a, b) => b.value - a.value)[0].s;
      return { type: "trump", suit };
    }
    if (h.phase === "partners") {
      const eligible = R.deck(room.mode, h.config).filter((c) => !cards.includes(c));
      eligible.sort((a, b) => R.points(b) - R.points(a) || R.strength(b) - R.strength(a) || a.localeCompare(b));
      const seats = h.seatMap, idx = seats.findIndex((p) => p.uid === uid), direct = seats[(idx + Math.floor(seats.length / 2)) % seats.length].uid;
      return { type: "partners", called: eligible[0], ...room.mode === 6 ? { direct } : {} };
    }
    if (h.phase === "playing") return { type: "play", card: difficulty === "easy" ? R.legal(cards, h.trick).sort(low)[0] : chooseCard(room, uid, cards) };
    throw new Error("No bot action available");
  }
  function timeout(room, uid, cards) {
    return room.hand.phase === "auction" ? { type: "bid", pass: true } : { type: "play", card: chooseCard(room, uid, cards) };
  }
  return { decide, timeout, chooseCard };
});
