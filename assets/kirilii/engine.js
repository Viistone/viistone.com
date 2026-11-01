/* KIRILII: game engine and bots. Pure logic, plain JSON state, no DOM.
   Works in the browser (window.Kirilii) and in node (require) for the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Kirilii = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMIT = 21, HAND = 6, SEATS = 6;
  // How to settle a round in which everyone left would go over the limit.
  // 'lowest': the lowest totals survive; if all are equal the round is replayed without points.
  // 'replay': the round never counts, deal again.
  var DEFAULT_TIE_RULE = 'lowest';

  var NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: 'JOKERI', 16: 'EKSTRAJOKKA' };
  var LONG = { 2: 'kakkonen', 3: 'kolmonen', 4: 'nelonen', 5: 'vitonen', 6: 'kutonen', 7: 'seiska', 8: 'kasi', 9: 'ysi', 10: 'kymppi',
    11: 'jätkä', 12: 'akka', 13: 'kurko', 14: 'ässä', 15: 'jokeri', 16: 'Ekstrajokka' };

  // ---------- randomness that lives in the state, so a saved game continues the same way ----------
  function rand(st) {
    st.rs = (st.rs + 0x6D2B79F5) | 0;
    var t = Math.imul(st.rs ^ (st.rs >>> 15), 1 | st.rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function makeDeck() {
    var d = [], id = 0, suits = ['S', 'H', 'D', 'C'];
    for (var s = 0; s < 4; s++) for (var v = 2; v <= 14; v++) d.push({ id: id++, v: v, s: suits[s] });
    d.push({ id: id++, v: 15, s: 'J' });
    d.push({ id: id++, v: 15, s: 'J' });
    d.push({ id: id++, v: 16, s: 'X' });
    return d;
  }
  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function sortHand(h) { return h.sort(function (a, b) { return a.v - b.v || a.id - b.id; }); }
  function minV(hand) { var m = 99; for (var i = 0; i < hand.length; i++) if (hand[i].v < m) m = hand[i].v; return m; }

  // ---------- rules ----------
  function legal(hand, last) {
    if (last == null) return hand.slice();
    var m = minV(hand);
    return hand.filter(function (c) { return c.v >= last || c.v === m; });
  }
  function isLegal(hand, last, card) { return legal(hand, last).some(function (c) { return c.id === card.id; }); }
  function active(st) { return st.players.filter(function (p) { return !p.out; }); }
  function nextActive(st, pid) {
    for (var k = 1; k <= SEATS; k++) { var p = st.players[(pid + k) % SEATS]; if (!p.out) return p.id; }
    return pid;
  }

  var PERSONAS = [
    { key: 'varovainen', name: 'RAIJA', title: 'Varovainen ja laskelmoiva' },
    { key: 'hoylaaja', name: 'MAKE', title: 'Aggressiivinen höylääjä' },
    { key: 'riski', name: 'JONNE', title: 'Arvaamaton riskinottaja' },
    { key: 'taktikko', name: 'SIRPA', title: 'Kärsivällinen taktikko' },
    { key: 'kaaos', name: 'TAPSA', title: 'Vähän kaoottinen baaripelaaja' }
  ];

  function newGame(opts) {
    opts = opts || {};
    var st = {
      v: 1, rs: (opts.seed != null ? opts.seed : (Math.random() * 2147483647) | 0) | 0,
      players: [], round: 0, starter: 0, turn: null, last: null, lastBy: null, phase: 'idle',
      roundLog: [], history: [], result: null, winner: null, headsUp: false,
      settings: { difficulty: opts.difficulty || 'normal', tieRule: opts.tieRule || DEFAULT_TIE_RULE }
    };
    st.players.push({ id: 0, name: opts.humanName || 'SINÄ', human: true, persona: null, pts: 0, out: false, outRound: null, hand: [], played: [] });
    for (var i = 0; i < 5; i++) st.players.push({ id: i + 1, name: PERSONAS[i].name, human: false, persona: PERSONAS[i].key, pts: 0, out: false, outRound: null, hand: [], played: [] });
    st.starter = Math.floor(rand(st) * SEATS);
    startRound(st);
    return st;
  }

  function startRound(st) {
    st.round++;
    var deck = shuffle(makeDeck(), function () { return rand(st); });
    var act = active(st);
    st.players.forEach(function (p) { p.hand = []; p.played = []; });
    for (var r = 0; r < HAND; r++) act.forEach(function (p) { p.hand.push(deck.pop()); });
    act.forEach(function (p) { sortHand(p.hand); });
    if (st.players[st.starter].out) st.starter = nextActive(st, st.starter);
    st.turn = st.starter; st.last = null; st.lastBy = null; st.phase = 'play'; st.roundLog = []; st.result = null;
    return st;
  }

  // Play one card. Returns the event, or throws on an illegal move.
  function play(st, pid, cardId) {
    if (st.phase !== 'play') throw new Error('not playing');
    if (st.turn !== pid) throw new Error('not your turn');
    var p = st.players[pid], idx = -1;
    for (var i = 0; i < p.hand.length; i++) if (p.hand[i].id === cardId) idx = i;
    if (idx < 0) throw new Error('card not in hand');
    var card = p.hand[idx];
    if (!isLegal(p.hand, st.last, card)) throw new Error('illegal card');
    var m = minV(p.hand);
    var ev = {
      t: 'play', pid: pid, card: card, ref: st.last, refBy: st.lastBy, n: p.played.length + 1, seq: st.roundLog.length,
      wasMin: card.v === m,
      forcedMin: st.last != null && !p.hand.some(function (c) { return c.v >= st.last; })
    };
    p.hand.splice(idx, 1);
    p.played.push(card);
    st.last = card.v; st.lastBy = pid;
    st.roundLog.push(ev);
    if (active(st).every(function (q) { return q.hand.length === 1; })) { ev.endsRound = true; endRound(st); }
    else st.turn = nextActive(st, pid);
    return ev;
  }

  // Did someone plane (höylätä) a loser? The loser was forced to play their lowest card because of a big card
  // played right before them late in the round, and the card that then stayed in hand is what lost the round.
  function detectHoyla(st, loserId, finalCard) {
    var evs = st.roundLog;
    for (var i = evs.length - 1; i >= 0; i--) {
      var ev = evs[i];
      if (ev.pid !== loserId || !ev.forcedMin || ev.refBy == null || ev.refBy === loserId) continue;
      if (ev.n < 3 || ev.ref <= finalCard.v) continue;
      // the card that forced it
      var src = null;
      for (var j = i - 1; j >= 0; j--) if (evs[j].pid === ev.refBy) { src = evs[j]; break; }
      if (!src) continue;
      var mc = src.card.v === 16 && src.n >= 4;
      return { by: ev.refBy, victim: loserId, card: src.card, forced: ev.card, kept: finalCard, mcbueno: mc, byPlay: src.n };
    }
    return null;
  }

  function endRound(st) {
    var act = active(st);
    var reveal = act.map(function (p) { return { pid: p.id, card: p.hand[0] }; });
    var max = Math.max.apply(null, reveal.map(function (r) { return r.card.v; }));
    var losers = reveal.filter(function (r) { return r.card.v === max; }).map(function (r) { return r.pid; });
    var before = {}; st.players.forEach(function (p) { before[p.id] = p.pts; });
    losers.forEach(function (id) { st.players[id].pts += max; });
    var hoyla = [];
    losers.forEach(function (id) { var h = detectHoyla(st, id, st.players[id].hand[0]); if (h) hoyla.push(h); });

    var over = act.filter(function (p) { return p.pts >= LIMIT; });
    var replay = false;
    if (over.length && over.length === act.length) {
      if (st.settings.tieRule === 'lowest') {
        var low = Math.min.apply(null, act.map(function (p) { return p.pts; }));
        var keep = act.filter(function (p) { return p.pts === low; });
        if (keep.length === act.length) replay = true;
        else over = act.filter(function (p) { return p.pts !== low; });
      } else replay = true;
    }
    if (replay) { act.forEach(function (p) { p.pts = before[p.id]; }); over = []; }
    over.forEach(function (p) { p.out = true; p.outRound = st.round; });

    var left = active(st), res = {
      round: st.round, reveal: reveal, max: max, losers: replay ? [] : losers, pen: replay ? 0 : max, before: before,
      hoyla: replay ? [] : hoyla, out: over.map(function (p) { return p.id; }), replay: replay, headsUp: false, winner: null
    };
    if (left.length === 1) { st.winner = left[0].id; res.winner = left[0].id; st.phase = 'over'; }
    else {
      if (left.length === 2 && !st.headsUp) { st.headsUp = true; res.headsUp = true; }
      st.phase = 'reveal';
      st.starter = nextActive(st, st.starter);
    }
    st.turn = null;
    st.result = res;
    st.history.push({ round: st.round, losers: res.losers, pen: res.pen, hoyla: res.hoyla.map(function (h) { return { by: h.by, victim: h.victim, mcbueno: h.mcbueno }; }), out: res.out, replay: replay });
    return res;
  }

  function nextRound(st) { if (st.phase === 'reveal') startRound(st); return st; }

  // ---------- what a bot is allowed to know ----------
  function view(st, pid) {
    return {
      me: pid, hand: st.players[pid].hand.map(function (c) { return { id: c.id, v: c.v, s: c.s }; }), last: st.last, lastBy: st.lastBy,
      settings: { difficulty: st.settings.difficulty },
      players: st.players.map(function (p) {
        return { id: p.id, pts: p.pts, out: p.out, persona: p.persona, handSize: p.hand.length, played: p.played.map(function (c) { return { id: c.id, v: c.v, s: c.s }; }) };
      }),
      log: st.roundLog.map(function (e) { return { pid: e.pid, v: e.card.v, ref: e.ref, n: e.n }; })
    };
  }

  // ---------- bots ----------
  var STYLE = {
    varovainen: { selfW: 1.5, aggr: 0.05, temp: 0.04, mistake: 0.02, samples: 1.0, infer: true, riskW: 1.6 },
    hoylaaja:   { selfW: 1.0, aggr: 0.7,  temp: 0.08, mistake: 0.04, samples: 0.9, infer: true, riskW: 1.0 },
    riski:      { selfW: 0.9, aggr: 0.3,  temp: 0.55, mistake: 0.08, samples: 0.6, infer: false, riskW: 0.6 },
    taktikko:   { selfW: 1.2, aggr: 0.35, temp: 0.02, mistake: 0.0,  samples: 1.4, infer: true, riskW: 1.3 },
    kaaos:      { selfW: 1.0, aggr: 0.2,  temp: 0.35, mistake: 0.22, samples: 0.4, infer: false, riskW: 0.8 }
  };
  var DIFF = { easy: { samples: 0, mistake: 0.18 }, normal: { samples: 45, mistake: 0.0 }, hard: { samples: 300, mistake: -0.05 } };

  // a cheap policy used for everyone inside simulations
  function rolloutPick(hand, last, rnd) {
    var lg = legal(hand, last);
    if (lg.length === 1) return lg[0];
    var hi = lg[0], lo = lg[0];
    lg.forEach(function (c) { if (c.v > hi.v) hi = c; if (c.v < lo.v) lo = c; });
    if (hand.length === 2) return hi; // keep the smaller one as the last card when possible
    var r = rnd();
    if (r < 0.62) return hi;
    if (r < 0.8) return lo;
    return lg[Math.floor(rnd() * lg.length)];
  }

  function simulate(v, firstCard, deal, rnd) {
    // v: view, deal: {pid: [cards]} for everyone active including me (my hand after removing firstCard is implied)
    var hands = {}, order = [], me = v.me;
    v.players.forEach(function (p) { if (!p.out) { order.push(p.id); hands[p.id] = deal[p.id].slice(); } });
    hands[me] = hands[me].filter(function (c) { return c.id !== firstCard.id; });
    var last = firstCard.v, turn = me, n = order.length;
    function nextOf(id) { var i = order.indexOf(id); return order[(i + 1) % n]; }
    var guard = 0;
    while (!order.every(function (id) { return hands[id].length === 1; }) && guard++ < 200) {
      turn = nextOf(turn);
      var h = hands[turn], c = rolloutPick(h, last, rnd);
      hands[turn] = h.filter(function (x) { return x.id !== c.id; });
      last = c.v;
    }
    var max = 0; order.forEach(function (id) { if (hands[id][0].v > max) max = hands[id][0].v; });
    var pen = {}; order.forEach(function (id) { pen[id] = hands[id][0].v === max ? max : 0; });
    return pen;
  }

  // lowest card each opponent can still hold: after playing their lowest card below the reference, the rest are at least that
  function lowerBounds(v) {
    var lb = {};
    v.players.forEach(function (p) { lb[p.id] = 2; });
    v.log.forEach(function (e) { if (e.ref != null && e.v < e.ref) lb[e.pid] = Math.max(lb[e.pid], e.v); });
    return lb;
  }

  function unseen(v) {
    var known = {};
    v.hand.forEach(function (c) { known[c.id] = 1; });
    v.players.forEach(function (p) { p.played.forEach(function (c) { known[c.id] = 1; }); });
    return makeDeck().filter(function (c) { return !known[c.id]; });
  }

  function determinize(v, rnd, infer) {
    var pool = shuffle(unseen(v), rnd), deal = {}, lb = infer ? lowerBounds(v) : null;
    deal[v.me] = v.hand.slice();
    v.players.forEach(function (p) {
      if (p.out || p.id === v.me) return;
      var hand = [];
      for (var k = 0; k < p.handSize; k++) {
        var pick = -1;
        if (lb) for (var i = 0; i < pool.length; i++) if (pool[i].v >= lb[p.id]) { pick = i; break; }
        if (pick < 0) pick = 0;
        hand.push(pool.splice(pick, 1)[0]);
      }
      deal[p.id] = hand;
    });
    return deal;
  }

  function utility(v, pen, st) {
    var me = v.players[v.me], u = 0, mine = pen[v.me] || 0;
    u -= mine * st.selfW;
    if (mine && me.pts + mine >= LIMIT) u -= 40 * st.riskW;
    v.players.forEach(function (p) {
      if (p.out || p.id === v.me) return;
      var x = pen[p.id] || 0;
      if (!x) return;
      u += x * st.aggr;
      if (p.pts + x >= LIMIT) u += 12 * st.aggr;
    });
    return u;
  }

  function easyPick(v, lg, rnd) {
    if (lg.length === 1) return lg[0];
    var hi = lg[0]; lg.forEach(function (c) { if (c.v > hi.v) hi = c; });
    if (v.hand.length === 2) return rnd() < 0.85 ? hi : lg[Math.floor(rnd() * lg.length)];
    return rnd() < 0.5 ? hi : lg[Math.floor(rnd() * lg.length)];
  }

  function choose(v, rnd) {
    rnd = rnd || Math.random;
    var me = v.players[v.me], style = STYLE[me.persona] || STYLE.taktikko, diff = DIFF[v.settings.difficulty] || DIFF.normal;
    var lg = legal(v.hand, v.last);
    if (lg.length === 1) return lg[0].id;
    var mistake = Math.max(0, style.mistake + diff.mistake);
    if (rnd() < mistake) return lg[Math.floor(rnd() * lg.length)].id;
    var samples = Math.round(diff.samples * style.samples);
    if (!samples) return easyPick(v, lg, rnd).id;
    // the same card value is the same move; evaluate each value once
    var byV = {}, opts = [];
    lg.forEach(function (c) { if (!byV[c.v]) { byV[c.v] = c; opts.push(c); } });
    var score = opts.map(function () { return 0; });
    for (var s = 0; s < samples; s++) {
      var deal = determinize(v, rnd, style.infer && v.settings.difficulty !== 'easy');
      for (var i = 0; i < opts.length; i++) score[i] += utility(v, simulate(v, opts[i], deal, rnd), style);
    }
    for (i = 0; i < opts.length; i++) score[i] /= samples;
    // softmax with the persona's temperature (scaled to the spread of the scores)
    var best = 0; for (i = 1; i < opts.length; i++) if (score[i] > score[best]) best = i;
    if (style.temp > 0.05) {
      var mx = score[best], spread = 0; score.forEach(function (x) { spread = Math.max(spread, mx - x); });
      var T = Math.max(0.5, spread) * style.temp, w = score.map(function (x) { return Math.exp((x - mx) / T); }), sum = 0;
      w.forEach(function (x) { sum += x; });
      var r = rnd() * sum; for (i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return opts[i].id; }
    }
    return opts[best].id;
  }

  function botMove(st, rnd) {
    var v = view(st, st.turn);
    return play(st, st.turn, choose(v, rnd));
  }

  function save(st) { return JSON.stringify(st); }
  function load(json) { var st = JSON.parse(json); if (!st || st.v !== 1 || !st.players || st.players.length !== SEATS) throw new Error('bad save'); return st; }

  function label(c) { return c.v <= 10 ? String(c.v) : NAMES[c.v]; }
  function longName(c) { return LONG[c.v]; }

  return {
    LIMIT: LIMIT, HAND: HAND, SEATS: SEATS, PERSONAS: PERSONAS,
    makeDeck: makeDeck, legal: legal, isLegal: isLegal, newGame: newGame, startRound: startRound, play: play, endRound: endRound,
    nextRound: nextRound, active: active, nextActive: nextActive, detectHoyla: detectHoyla, view: view, choose: choose, botMove: botMove,
    save: save, load: load, label: label, longName: longName, minV: minV, lowerBounds: lowerBounds
  };
});
