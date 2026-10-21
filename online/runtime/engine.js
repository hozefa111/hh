(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KaliRules = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";
  const SUITS = ["S", "H", "C", "D"], SYMBOLS = { S: "\u2660", H: "\u2665", C: "\u2663", D: "\u2666" }, NAMES = { S: "Kali", H: "Laal", C: "Ful", D: "Chatai" };
  const RANKS = ["3", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  function assert(ok, message) {
    if (!ok) throw new Error(message);
  }
  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }
  function card(id) {
    assert(typeof id === "string" && /^(3|5|6|7|8|9|10|J|Q|K|A)[SHCD]$/.test(id), "Invalid card");
    return { id, rank: id.slice(0, -1), suit: id.slice(-1) };
  }
  function points(id) {
    const c = card(id);
    return id === "3S" ? 30 : c.rank === "5" ? 5 : ["A", "K", "Q", "J", "10"].includes(c.rank) ? 10 : 0;
  }
  function strength(id) {
    return RANKS.indexOf(card(id).rank);
  }
  function deck(mode, config = {}) {
    assert(mode === 4 || mode === 6, "Mode must be 4 or 6");
    const sixSuits = config.sixSuits || ["C", "D"], extraThree = config.extraThree || "H";
    assert(SUITS.includes(extraThree) && extraThree !== "S", "Additional 3 must not be Spades");
    if (mode === 4) assert(Array.isArray(sixSuits) && sixSuits.length === 2 && new Set(sixSuits).size === 2 && sixSuits.every((s) => SUITS.includes(s)), "Choose two different six suits");
    const ranks = ["A", "K", "Q", "J", "10", "9", "8", "7", "5"];
    if (mode === 6) ranks.push("6");
    const d = SUITS.flatMap((s) => ranks.map((r) => r + s));
    if (mode === 4) d.push(...sixSuits.map((s) => "6" + s));
    d.push("3S", "3" + extraThree);
    assert(new Set(d).size === d.length && d.reduce((n, c) => n + points(c), 0) === 250, "Invalid deck");
    return d;
  }
  function shuffle(cards, random) {
    const out = cards.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = random(i + 1);
      assert(Number.isInteger(j) && j >= 0 && j <= i, "Invalid random source");
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  function score(playerIds, bid, bidder, partners, result) {
    assert(Number.isInteger(bid) && bid >= 155 && bid <= 250 && bid % 5 === 0, "Invalid contract");
    const ids = [...new Set(playerIds)], ps = [...new Set(partners)];
    assert(ids.includes(bidder) && ps.length > 0 && ps.every((p) => ids.includes(p) && p !== bidder), "Invalid partners");
    assert(result === "win" || result === "loss", "Invalid result");
    const changes = {};
    for (const id of ids) changes[id] = id === bidder ? result === "win" ? 2 * bid : -bid : ps.includes(id) ? result === "win" ? bid : -Math.round(bid / 2) : result === "win" ? 0 : bid;
    return changes;
  }
  function legal(hand, trick) {
    if (!trick.length) return hand.slice();
    const suit = card(trick[0].card).suit, followed = hand.filter((c) => card(c).suit === suit);
    return followed.length ? followed : hand.slice();
  }
  function trickWinner(trick, trump) {
    assert(trick.length > 0, "Empty trick");
    const lead = card(trick[0].card).suit;
    return trick.reduce((best, p) => {
      const a = card(p.card), b = card(best.card);
      if (a.suit === b.suit) return strength(p.card) > strength(best.card) ? p : best;
      if (a.suit === trump) return p;
      if (b.suit === trump) return best;
      return a.suit === lead ? p : best;
    }).uid;
  }
  function ordered(room) {
    return Object.values(room.members).filter((p) => p.seat !== null && p.status !== "Removed").sort((a, b) => a.seat - b.seat);
  }
  function active(room) {
    return room.hand && !["complete", "void"].includes(room.hand.phase);
  }
  function owner(room, uid) {
    assert(room.admin === uid, "Only room admin can manage this session");
  }
  function member(room, uid) {
    const p = room.members[uid];
    assert(p && p.status !== "Removed", "Not a room participant");
    return p;
  }
  function connected(p) {
    return p.kind === "bot" || p.connected;
  }
  function resetReady(room) {
    for (const p of ordered(room)) {
      p.ready = p.kind === "bot";
      p.status = !connected(p) ? "Disconnected" : p.ready ? "Ready" : "Seated";
    }
  }
  function create({ id, code, uid, name, playerId, mode = 4, config = {}, difficulty = "normal" }, now) {
    deck(mode, config);
    assert(id && uid && playerId, "Missing identity");
    assert(typeof name === "string" && name.trim().length > 0 && name.length <= 60, "Invalid name");
    return { id, code, admin: uid, mode, config: { sixSuits: config.sixSuits || ["C", "D"], extraThree: config.extraThree || "H" }, difficulty, revision: 0, status: "lobby", createdAt: now, startedAt: null, endedAt: null, handNumber: 0, completed: 0, defaultSeat: 1, paused: false, pauseReason: null, stopAfterHand: false, members: { [uid]: { uid, playerId, name: name.trim(), kind: "human", seat: 1, status: "Seated", approved: true, ready: false, connected: true, joinedAt: now } }, totals: { [playerId]: 0 }, scoreNames: { [playerId]: name.trim() }, hand: null, lastResult: null, events: [] };
  }
  function event(room, type, data, now) {
    room.events.push({ id: room.revision + ":" + room.events.length, type, at: now, ...data });
    if (room.events.length > 150) room.events = room.events.slice(-150);
  }
  function startHand(room, now, random) {
    const ps = ordered(room);
    assert(ps.length === room.mode && ps.every((p) => p.ready && connected(p) && p.approved), "All seats must be connected and Ready");
    assert(ps.some((p) => p.uid === room.admin), "Admin must occupy a seat");
    const cards = shuffle(deck(room.mode, room.config), random), hands = {};
    ps.forEach((p, i) => {
      hands[p.uid] = cards.filter((_, j) => j % room.mode === i);
      p.ready = false;
      p.status = "Playing";
    });
    const def = ps.find((p) => p.seat === room.defaultSeat) || ps.find((p) => p.seat > room.defaultSeat) || ps[0];
    room.defaultSeat = def.seat;
    room.handNumber++;
    room.status = "playing";
    room.startedAt = room.startedAt || now;
    room.paused = false;
    room.pauseReason = null;
    const ids = ps.map((p) => p.uid), next = ids[(ids.indexOf(def.uid) + 1) % ids.length];
    room.hand = { id: room.id + "-" + room.handNumber, number: room.handNumber, phase: "auction", config: clone(room.config), mode: room.mode, seatMap: ps.map((p) => ({ uid: p.uid, seat: p.seat, playerId: p.playerId, name: p.name, kind: p.kind })), deck: cards, hands, bid: 155, bidder: def.uid, defaultBidder: def.uid, passed: [], opportunities: [def.uid], auction: [{ uid: def.uid, bid: 155, automatic: true, reason: "default-opening", at: now }], trump: null, direct: null, called: null, secret: null, partners: [], revealed: false, trick: [], tricks: [], captured: Object.fromEntries(ids.map((id) => [id, 0])), turn: next, turnGeneration: 0, deadline: null, remaining: null };
    arm(room, now);
    event(room, "deal", { handId: room.hand.id, defaultSeat: def.seat }, now);
  }
  function arm(room, now) {
    const h = room.hand;
    if (!h) return;
    h.turnGeneration++;
    h.deadline = null;
    h.remaining = null;
    if (room.paused || !active(room)) return;
    const p = room.members[h.turn];
    if (p.kind === "bot") h.deadline = now + 900;
    else if (h.phase === "auction" || h.phase === "playing") h.deadline = now + 3e4;
  }
  function turnIds(h) {
    return h.seatMap.map((p) => p.uid);
  }
  function nextAuction(room, now) {
    const h = room.hand, ids = turnIds(h);
    let next = null;
    for (let k = 1; k <= ids.length; k++) {
      const id = ids[(ids.indexOf(h.turn) + k) % ids.length];
      if (id !== h.bidder && !h.passed.includes(id)) {
        next = id;
        break;
      }
    }
    if (!next) {
      h.phase = "trump";
      h.turn = h.bidder;
    } else h.turn = next;
    arm(room, now);
  }
  function allReadyExceptAdmin(room) {
    return ordered(room).length === room.mode && ordered(room).every((p) => connected(p) && p.approved && (p.uid === room.admin || p.ready));
  }
  function finish(room, now) {
    var _a, _b;
    const h = room.hand;
    assert(Object.values(h.captured).reduce((a, b) => a + b, 0) === 250, "Captured points must total 250");
    const team = [h.bidder, ...h.partners], captured = team.reduce((n, id) => n + h.captured[id], 0), result = captured >= h.bid ? "win" : "loss";
    const uidChanges = score(turnIds(h), h.bid, h.bidder, h.partners, result), scoreChanges = {};
    for (const p of h.seatMap) {
      assert(Number.isSafeInteger(room.totals[p.playerId] + uidChanges[p.uid]), "Score exceeds safe integer range");
      scoreChanges[p.playerId] = uidChanges[p.uid];
      room.totals[p.playerId] += uidChanges[p.uid];
      const stats = room.stats || (room.stats = {}), s = stats[p.playerId] || (stats[p.playerId] = { roundsPlayed: 0, asHukum: 0, hukumWins: 0, asPartner: 0, partnerWins: 0, wins: 0, currentStreak: 0, bestStreak: 0, captured: 0 });
      s.roundsPlayed++;
      s.captured += h.captured[p.uid];
      const won = team.includes(p.uid) ? result === "win" : result === "loss";
      if (won) s.wins++;
      s.currentStreak = won ? (s.currentStreak || 0) + 1 : 0;
      s.bestStreak = Math.max(s.bestStreak || 0, s.currentStreak);
      if (!won) s.losses = (s.losses || 0) + 1;
      if (uidChanges[p.uid] > 0) s.positiveCurrent = (s.positiveCurrent || 0) + 1;
      else if (uidChanges[p.uid] < 0) s.positiveCurrent = 0;
      s.positiveBest = Math.max(s.positiveBest || 0, s.positiveCurrent || 0);
      if (p.uid === h.bidder) {
        s.asHukum++;
        if (result === "win") s.hukumWins++;
      } else if (h.partners.includes(p.uid)) {
        s.asPartner++;
        if (result === "win") s.partnerWins++;
      }
      if (uidChanges[p.uid] > (((_a = room.biggestWin) == null ? void 0 : _a.score) || 0)) room.biggestWin = { name: p.name, score: uidChanges[p.uid] };
      if (uidChanges[p.uid] < (((_b = room.biggestLoss) == null ? void 0 : _b.score) || 0)) room.biggestLoss = { name: p.name, score: uidChanges[p.uid] };
    }
    const bidderProfile = h.seatMap.find((p) => p.uid === h.bidder).playerId;
    if (h.bid > (room.maxBid || 0)) {
      room.maxBid = h.bid;
      room.riskTakers = [bidderProfile];
    } else if (h.bid === room.maxBid && !room.riskTakers.includes(bidderProfile)) room.riskTakers.push(bidderProfile);
    h.phase = "complete";
    h.deadline = null;
    h.turnGeneration++;
    h.revealed = true;
    h.result = result;
    h.teamPoints = captured;
    h.scoreChanges = scoreChanges;
    h.completedAt = now;
    room.completed++;
    const def = h.seatMap.find((p) => p.uid === h.defaultBidder).seat;
    room.defaultSeat = def % room.mode + 1;
    room.lastResult = { handId: h.id, bid: h.bid, bidder: h.bidder, partners: h.partners, trump: h.trump, called: h.called, captured: h.captured, teamPoints: captured, result, scoreChanges, seatMap: h.seatMap, completedAt: now };
    room.status = room.stopAfterHand ? "stopped" : "between";
    if (room.stopAfterHand) room.endedAt = now;
    resetReady(room);
    event(room, "hand-complete", { handId: h.id, result }, now);
  }
  function pause(room, reason, now) {
    assert(active(room), "No active hand");
    if (!room.paused) {
      room.hand.remaining = room.hand.deadline === null ? null : Math.max(0, room.hand.deadline - now);
      room.hand.deadline = null;
      room.hand.turnGeneration++;
    }
    room.paused = true;
    room.pauseReason = reason;
  }
  function command(input, uid, action, now, random) {
    const room = clone(input);
    assert(room.status !== "stopped", "Session has ended");
    const type = action.type, p = room.members[uid];
    if (type === "join") {
      assert(typeof action.name === "string" && action.name.trim().length > 0 && action.name.length <= 60, "Invalid name");
      if (p && p.status !== "Removed") {
        p.connected = true;
        p.status = active(room) && p.seat !== null ? "Playing" : p.seat !== null ? p.ready ? "Ready" : "Seated" : p.sittingOut ? "Sitting Out" : p.approved ? "Waiting" : "Invited";
        room.revision++;
        return room;
      }
      if (p && p.status === "Removed") {
        p.status = "Invited";
        p.sittingOut = false;
        p.approved = false;
        p.ready = false;
        p.connected = true;
        p.seat = null;
        room.revision++;
        return room;
      }
      room.members[uid] = { uid, playerId: null, name: action.name.trim(), kind: "human", seat: null, status: "Invited", approved: false, ready: false, connected: true, joinedAt: now };
      event(room, "join", { uid }, now);
    } else if (type === "presence") {
      member(room, uid);
      assert(typeof action.connected === "boolean", "Invalid presence");
      p.connected = action.connected;
      if (!p.connected) {
        p.ready = false;
        p.status = "Disconnected";
        if (active(room) && room.hand.seatMap.some((x) => x.uid === uid)) pause(room, "disconnected", now);
      } else p.status = active(room) && p.seat !== null ? "Playing" : p.seat !== null ? p.ready ? "Ready" : "Seated" : p.sittingOut ? "Sitting Out" : p.approved ? "Waiting" : "Invited";
    } else if (["approve", "seat", "swap", "unseat", "remove", "bot", "config", "sitout", "reserve"].includes(type)) {
      owner(room, uid);
      assert(!active(room), "Seat order is locked during a hand");
      if (type === "bot") {
        assert(Number.isInteger(action.seat) && action.seat >= 1 && action.seat <= room.mode && !ordered(room).some((x) => x.seat === action.seat), "Seat occupied");
        assert(action.botId && action.botId.startsWith("bot_") && !room.members[action.botId], "Invalid bot identity");
        const id = action.botId;
        room.members[id] = { uid: id, playerId: id, name: "Computer " + action.seat, kind: "bot", difficulty: action.difficulty === "easy" ? "easy" : "normal", seat: action.seat, status: "Ready", approved: true, ready: true, connected: true, joinedAt: now };
        room.totals[id] = 0;
        room.scoreNames[id] = room.members[id].name;
      } else if (type === "config") {
        deck(room.mode, action.config);
        room.config = clone(action.config);
      } else if (type === "reserve") {
        assert(action.reservationId && action.playerId && action.name, "Missing reservation");
        assert(!Object.values(room.members).some((x) => x.playerId === action.playerId && x.status !== "Removed"), "Player already in room");
        room.members[action.reservationId] = { uid: action.reservationId, playerId: action.playerId, name: action.name, kind: "human", seat: null, status: "Invited", approved: false, ready: false, connected: false, reservation: true, joinedAt: now };
      } else {
        const target = member(room, action.target);
        assert(target.uid !== room.admin || ["seat", "swap"].includes(type), "Admin must remain a seated player");
        if (type === "approve") {
          assert(target.kind === "human" && !target.reservation && action.playerId, "A connected human needs a profile");
          assert(!Object.values(room.members).some((x) => x.uid !== target.uid && x.playerId === action.playerId && x.status !== "Removed" && !x.reservation), "Profile already linked");
          const reservation = Object.values(room.members).find((x) => x.reservation && x.status !== "Removed" && x.playerId === action.playerId);
          if (reservation) {
            target.seat = reservation.seat;
            reservation.seat = null;
            reservation.status = "Removed";
          }
          target.playerId = action.playerId;
          if (action.name) target.name = action.name;
          room.scoreNames[action.playerId] = target.name;
          target.approved = true;
          target.sittingOut = false;
          target.status = target.seat === null ? "Waiting" : "Seated";
          if (room.totals[action.playerId] === void 0) room.totals[action.playerId] = 0;
        } else if (type === "seat") {
          assert((target.approved || target.reservation) && Number.isInteger(action.seat) && action.seat >= 1 && action.seat <= room.mode, "Invalid seat");
          assert(!ordered(room).some((x) => x.uid !== target.uid && x.seat === action.seat), "Seat occupied");
          target.seat = action.seat;
          target.sittingOut = false;
          target.status = "Seated";
        } else if (type === "swap") {
          const other = member(room, action.other);
          assert(target.seat !== null && other.seat !== null, "Both players must be seated");
          [target.seat, other.seat] = [other.seat, target.seat];
        } else {
          target.seat = null;
          target.ready = false;
          target.sittingOut = type === "sitout";
          target.status = type === "remove" ? "Removed" : type === "sitout" ? "Sitting Out" : "Waiting";
        }
      }
      resetReady(room);
      event(room, "seating", { action: type }, now);
    } else if (type === "leave") {
      member(room, uid);
      assert(uid !== room.admin, "Admin must stop session before leaving");
      if (active(room) && p.seat !== null) {
        p.connected = false;
        p.ready = false;
        p.status = "Disconnected";
        pause(room, "disconnected", now);
      } else {
        p.seat = null;
        p.ready = false;
        p.status = "Removed";
        resetReady(room);
      }
    } else if (type === "ready") {
      member(room, uid);
      assert(!active(room) && p.seat !== null && p.approved && connected(p), "Cannot Ready now");
      if (uid === room.admin) {
        assert(allReadyExceptAdmin(room), "Other players must be Ready first");
        p.ready = true;
        startHand(room, now, random);
      } else {
        p.ready = true;
        p.status = "Ready";
      }
    } else if (type === "pause") {
      owner(room, uid);
      pause(room, "admin", now);
    } else if (type === "resume") {
      owner(room, uid);
      assert(active(room) && room.paused, "Not paused");
      assert(room.hand.seatMap.every((x) => connected(room.members[x.uid])), "A player is disconnected");
      room.paused = false;
      room.pauseReason = null;
      const h = room.hand, remaining = h.remaining;
      arm(room, now);
      if (remaining !== null) h.deadline = now + remaining;
    } else if (type === "void") {
      owner(room, uid);
      assert(active(room), "No unfinished hand");
      room.hand.phase = "void";
      room.hand.deadline = null;
      room.hand.turnGeneration++;
      room.status = "between";
      room.paused = false;
      resetReady(room);
      event(room, "void", { handId: room.hand.id }, now);
    } else if (type === "stop") {
      owner(room, uid);
      if (active(room) && action.finish) {
        room.stopAfterHand = true;
      } else {
        assert(!active(room) || action.void === true, "Choose finish or void unfinished hand");
        if (active(room)) {
          room.hand.phase = "void";
          room.hand.deadline = null;
          room.hand.turnGeneration++;
          event(room, "void", { handId: room.hand.id }, now);
        }
        room.status = "stopped";
        room.endedAt = now;
        room.paused = false;
        resetReady(room);
      }
    } else {
      member(room, uid);
      const h = room.hand;
      assert(active(room) && !room.paused, "Game is not active");
      assert(h.turn === uid, "Not your turn");
      assert(connected(p), "Player is disconnected");
      assert(action.automatic || h.deadline === null || now < h.deadline, "Turn deadline expired");
      if (type === "bid") {
        assert(h.phase === "auction" && !h.passed.includes(uid) && uid !== h.bidder, "Not eligible to bid");
        if (action.pass) {
          h.passed.push(uid);
        } else {
          assert(Number.isInteger(action.bid) && action.bid % 5 === 0 && action.bid > h.bid && action.bid <= 250, "Invalid raise");
          h.bid = action.bid;
          h.bidder = uid;
        }
        if (!h.opportunities.includes(uid)) h.opportunities.push(uid);
        h.auction.push({ uid, pass: !!action.pass, bid: action.pass ? null : action.bid, automatic: !!action.automatic, reason: action.automatic ? action.reason || "automatic" : null, at: now });
        nextAuction(room, now);
      } else if (type === "trump") {
        assert(h.phase === "trump" && SUITS.includes(action.suit), "Invalid trump");
        h.trump = action.suit;
        h.phase = "partners";
        arm(room, now);
      } else if (type === "partners") {
        assert(h.phase === "partners" && h.deck.includes(action.called) && !h.hands[uid].includes(action.called), "Call a card outside your hand");
        if (room.mode === 6) assert(turnIds(h).includes(action.direct) && action.direct !== uid, "Choose a direct partner");
        h.called = action.called;
        h.direct = room.mode === 6 ? action.direct : null;
        h.secret = turnIds(h).find((id) => h.hands[id].includes(h.called));
        h.partners = [...new Set([h.direct, h.secret].filter(Boolean))];
        h.phase = "playing";
        arm(room, now);
      } else if (type === "play") {
        assert(h.phase === "playing" && legal(h.hands[uid], h.trick).includes(action.card), "Illegal card");
        h.hands[uid].splice(h.hands[uid].indexOf(action.card), 1);
        h.trick.push({ uid, card: action.card, automatic: !!action.automatic, reason: action.automatic ? action.reason || "automatic" : null });
        if (action.card === h.called) h.revealed = true;
        event(room, "card", { uid, card: action.card, automatic: !!action.automatic, reason: action.automatic ? action.reason || "automatic" : null, handId: h.id }, now);
        const ids = turnIds(h);
        if (h.trick.length === room.mode) {
          const winner = trickWinner(h.trick, h.trump), captured = h.trick.reduce((n, p2) => n + points(p2.card), 0);
          h.captured[winner] += captured;
          h.tricks.push({ number: h.tricks.length + 1, cards: clone(h.trick), winner, points: captured });
          h.trick = [];
          h.turn = winner;
          event(room, "trick", { winner, points: captured, number: h.tricks.length }, now);
          if (h.tricks.length === h.deck.length / room.mode) finish(room, now);
          else arm(room, now);
        } else {
          h.turn = ids[(ids.indexOf(uid) + 1) % ids.length];
          arm(room, now);
        }
      } else throw new Error("Unknown command");
    }
    room.revision++;
    return room;
  }
  function publicState(room) {
    const r = clone(room);
    delete r.hand;
    delete r.events;
    r.members = Object.fromEntries(Object.entries(r.members).map(([id, p]) => {
      const v = { ...p };
      return [id, v];
    }));
    if (room.hand) {
      const h = room.hand;
      r.hand = { id: h.id, number: h.number, phase: h.phase, mode: h.mode, config: h.config, seatMap: h.seatMap, bid: h.bid, bidder: h.bidder, defaultBidder: h.defaultBidder, passed: h.passed, opportunities: h.opportunities, auction: h.auction, trump: h.trump, direct: h.direct, called: h.called, revealed: h.revealed, secret: h.revealed ? h.secret : null, partners: h.revealed ? h.partners : null, trick: h.trick, tricks: h.tricks, captured: h.captured, turn: h.turn, turnGeneration: h.turnGeneration, deadline: h.deadline, remaining: h.remaining, counts: Object.fromEntries(Object.entries(h.hands).map(([id, c]) => [id, c.length])) };
    }
    return r;
  }
  function privateState(room, uid) {
    const p = room.members[uid], h = room.hand, owns = !!(p && p.seat !== null && p.status !== "Removed" && h && Object.prototype.hasOwnProperty.call(h.hands, uid));
    return { handId: owns ? h.id : null, revision: room.revision, cards: owns ? h.hands[uid].slice() : [] };
  }
  function roundRecord(room) {
    const h = room.hand;
    assert(h && h.phase === "complete", "No completed hand");
    const profile = (uid) => h.seatMap.find((p) => p.uid === uid).playerId, name = (uid) => h.seatMap.find((p) => p.uid === uid).name, ids = turnIds(h), opponents = ids.filter((id) => id !== h.bidder && !h.partners.includes(id));
    return { type: "hukum", source: "online", sessionId: room.id, roomId: room.id, handId: h.id, bid: h.bid, hukumId: profile(h.bidder), hukumName: name(h.bidder), partnerIds: h.partners.map(profile), partnerNames: h.partners.map(name), nonPartnerIds: opponents.map(profile), nonPartnerNames: opponents.map(name), playerIds: h.seatMap.filter((p) => p.kind === "human").map((p) => p.playerId), participantIds: h.seatMap.map((p) => p.playerId), participants: h.seatMap.map((p) => ({ ...p })), result: h.result, scoreChanges: clone(h.scoreChanges), captured: clone(h.captured), teamPoints: h.teamPoints, trump: h.trump, called: h.called, deckConfig: clone(h.config), completedAt: h.completedAt };
  }
  function standings(room, playedOnly = false) {
    return Object.entries(room.totals).filter(([id]) => {
      var _a, _b;
      return !playedOnly || (((_b = (_a = room.stats) == null ? void 0 : _a[id]) == null ? void 0 : _b.roundsPlayed) || 0) > 0;
    }).map(([id, score2]) => {
      var _a, _b;
      return { id, name: ((_a = room.scoreNames) == null ? void 0 : _a[id]) || ((_b = Object.values(room.members).find((p) => p.playerId === id)) == null ? void 0 : _b.name) || id, score: score2 };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map((p, i, all) => ({ ...p, rank: 1 + all.filter((x) => x.score > p.score).length }));
  }
  return { SUITS, SYMBOLS, NAMES, RANKS, card, points, strength, deck, shuffle, score, legal, trickWinner, ordered, active, create, command, publicState, privateState, roundRecord, standings, allReadyExceptAdmin };
});
