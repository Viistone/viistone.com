// CH 09 Kirilii online. One room per table, the whole state lives in D1 (binding KDB).
// The server runs the same engine as the browser, deals, checks every move and plays the bots.
// Players can only send a card number, one of six fixed shouts (each once per lap), bang the table (a rhythm of knocks, no limit), or throw a beer bottle at someone (once per lap). Anyone may join a running table to watch.
// There is no chat and no free text: names are three letters.
// A player never receives anyone else's hidden cards or the shuffle seed.

const KO = {
  CODE: 'BCDFGHJKLMNPRSTVXZ', BOT_MS: 1600, LAP_MS: 900, TURN_MS: 35000, AWAY_MS: 25000, AWAY_PLAY_MS: 2500,
  SEEN_WRITE_MS: 10000, KEEP_MS: 2 * 24 * 3600e3, SHOUT_MS: 9000
};
function koLapKey(st) { return st.round + ':' + (st.phase === 'play' ? st.lap : 'r'); }

async function koDb(env) {
  if (!env.KDB) throw new Error('no db');
  if (!koDb.ready) {
    await env.KDB.prepare('CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, v INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL)').run();
    koDb.ready = true;
  }
  return env.KDB;
}
async function koLoad(db, code) {
  const r = await db.prepare('SELECT v, data FROM rooms WHERE code = ?').bind(code).first();
  return r ? { v: r.v, room: JSON.parse(r.data) } : null;
}
async function koInsert(db, room) {
  const r = await db.prepare('INSERT OR IGNORE INTO rooms (code, v, data, updated) VALUES (?, 1, ?, ?)').bind(room.code, JSON.stringify(room), Date.now()).run();
  return r.meta.changes === 1;
}
async function koUpdate(db, room, v) {
  const r = await db.prepare('UPDATE rooms SET v = v + 1, data = ?, updated = ? WHERE code = ? AND v = ?').bind(JSON.stringify(room), Date.now(), room.code, v).run();
  return r.meta.changes === 1;
}

function koToken() { return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join(''); }
function koCode() { const a = crypto.getRandomValues(new Uint8Array(4)); let s = ''; for (const b of a) s += KO.CODE[b % KO.CODE.length]; return s; }
function koName(n) { n = String(n || '').toUpperCase(); return /^[A-ZÅÄÖ]{3}$/.test(n) && !BLOCK.has(n) ? n : null; }
function koWatcher(room, t) { if (typeof t !== 'string' || !/^[0-9a-f]{32}$/.test(t)) return false; return (room.watch || []).some(w => w.token === t); }
function koSeat(room, t) { if (typeof t !== 'string' || !/^[0-9a-f]{32}$/.test(t)) return -1; return room.seats.findIndex(s => s.token === t); }

function koRevealMs(res) {
  if (!res) return 6000;
  let ms = 7500;
  (res.hoyla || []).forEach(h => { ms += h.mcbueno ? 4500 : 2600; });
  if (res.out && res.out.length) ms += 2700;
  if (res.headsUp) ms += 2800;
  if (res.replay) ms += 2400;
  return ms;
}

// advance the table by at most one step: a bot plays, an absent human is played for, or the next deal starts
function koTick(room, now, F) {
  F = F || 1;
  if (room.phase !== 'game') return false;
  const st = room.st;
  if (st.phase === 'play') {
    const p = st.players[st.turn], extra = st.lapPos === 0 && st.roundLog.length ? KO.LAP_MS : 0;
    let due;
    if (!p.human) due = KO.BOT_MS + extra;
    else { const seen = room.seen[st.turn] || 0; due = now - seen > KO.AWAY_MS ? KO.AWAY_PLAY_MS + extra : KO.TURN_MS; }
    due *= F;
    if (now - room.at < due) return false;
    Kirilii.botMove(st, Math.random);
    room.at = now;
    return true;
  }
  if (st.phase === 'reveal' && now - room.at >= koRevealMs(st.result) * F) { Kirilii.nextRound(st); room.at = now; return true; }
  return false;
}

function koView(room, seat) {
  const now = Date.now();
  const base = {
    game: 'kirilii', room: room.code, phase: room.phase, me: seat, host: seat === 0, now,
    seats: room.seats.map((s, i) => ({ name: s.name, away: now - (room.seen[i] || 0) > KO.AWAY_MS }))
  };
  if (room.phase !== 'game') return base;
  const st = room.st, open = st.phase !== 'play';
  const players = st.players.map(p => ({
    id: p.id, name: p.name, human: p.human, persona: p.persona, pts: p.pts, out: p.out, outRound: p.outRound, played: p.played,
    hand: p.id === seat ? p.hand : (open && p.hand.length === 1 ? p.hand : p.hand.map(() => null))
  }));
  const res = st.result ? {
    round: st.result.round, reveal: st.result.reveal, max: st.result.max, losers: st.result.losers, pen: st.result.pen, out: st.result.out,
    replay: st.result.replay, headsUp: st.result.headsUp, winner: st.result.winner,
    hoyla: (st.result.hoyla || []).map(h => ({ by: h.by, victim: h.victim, mcbueno: h.mcbueno }))
  } : null;
  base.at = room.at;
  base.shouts = (room.shouts || []).filter(x => now - x.at < KO.SHOUT_MS).map(x => ({ id: x.id, seat: x.seat, k: x.k }));
  const lk = koLapKey(room.st), used = (room.shouts || []).filter(x => x.seat === seat && x.lap === lk).map(x => x.k);
  base.canShout = seat >= 0 ? [0, 1, 2, 3, 4, 5].map(k => used.indexOf(k) < 0) : [false, false, false, false, false, false];
  base.watchers = (room.watch || []).length;
  base.bangs = (room.bangs || []).filter(x => now - x.at < 6000).map(x => ({ id: x.id, seat: x.seat, p: x.p }));
  base.throws = (room.throws || []).filter(x => now - x.at < 6000).map(x => ({ id: x.id, from: x.from, to: x.to }));
  base.canThrow = seat >= 0 && !(room.throws || []).some(x => x.from === seat && x.lap === lk);
  base.st = {
    v: 1, players, round: st.round, starter: st.starter, turn: st.turn, last: st.last, lastBy: st.lastBy, lastId: st.lastId,
    lapN: st.lapN, lapPos: st.lapPos, lap: st.lap, phase: st.phase, headsUp: st.headsUp, winner: st.winner, settings: st.settings,
    roundLog: st.roundLog.map(e => ({ pid: e.pid, card: e.card, n: e.n })), history: st.history, result: res
  };
  return base;
}

async function koBody(req) {
  const txt = await req.text();
  if (txt.length > 300) return null;
  try { const b = JSON.parse(txt); return b && typeof b === 'object' ? b : null; } catch (e) { return null; }
}

async function kiriliiOnline(req, env, url) {
  const op = url.pathname.slice('/api/kirilii/'.length);
  let db;
  try { db = await koDb(env); } catch (e) { return json(req, { error: 'offline' }, 503); }
  const now = Date.now();

  if (req.method === 'GET' && op === 'state') {
    const code = String(url.searchParams.get('room') || '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) return json(req, { error: 'room' }, 400);
    for (let tries = 0; tries < 3; tries++) {
      const got = await koLoad(db, code);
      if (!got) return json(req, { error: 'room' }, 404);
      const room = got.room, seat = koSeat(room, url.searchParams.get('t'));
      if (seat < 0 && !koWatcher(room, url.searchParams.get('t'))) return json(req, { error: 'seat' }, 403);
      if (seat < 0) {
        if (koTick(room, now, env.KO_FAST ? (Number(env.KO_FAST) || 0.01) : 1) && !(await koUpdate(db, room, got.v))) continue;
        return json(req, koView(room, -1));
      }
      const stale = now - (room.seen[seat] || 0) > KO.SEEN_WRITE_MS;
      room.seen[seat] = now;
      const changed = koTick(room, now, env.KO_FAST ? (Number(env.KO_FAST) || 0.01) : 1);
      if (changed || stale) { if (!(await koUpdate(db, room, got.v))) continue; }
      return json(req, koView(room, seat));
    }
    return json(req, { error: 'busy' }, 409);
  }

  if (req.method !== 'POST') return json(req, { error: 'method' }, 405);
  const b = await koBody(req);
  if (!b) return json(req, { error: 'bad' }, 400);

  if (op === 'new') {
    const n = koName(b.n); if (!n) return json(req, { error: 'name' }, 400);
    if (Math.random() < 0.05) await db.prepare('DELETE FROM rooms WHERE updated < ?').bind(now - KO.KEEP_MS).run();
    for (let i = 0; i < 6; i++) {
      const token = koToken(), room = { code: koCode(), phase: 'lobby', created: now, at: now, seats: [{ name: n, token }], seen: { 0: now }, st: null };
      if (await koInsert(db, room)) return json(req, Object.assign(koView(room, 0), { token, seat: 0 }));
    }
    return json(req, { error: 'busy' }, 409);
  }

  const code = String(b.room || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) return json(req, { error: 'room' }, 400);

  for (let tries = 0; tries < 4; tries++) {
    const got = await koLoad(db, code);
    if (!got) return json(req, { error: 'room' }, 404);
    const room = got.room;

    if (op === 'join') {
      const n = koName(b.n); if (!n) return json(req, { error: 'name' }, 400);
      if (room.seats.some(s => s.name === n) || (room.watch || []).some(w => w.name === n)) return json(req, { error: 'taken' }, 409);
      if (room.phase !== 'lobby' || room.seats.length >= 6) {
        // the table is running or full: come and watch
        room.watch = room.watch || [];
        if (room.watch.length >= 12) return json(req, { error: 'full' }, 409);
        const wt = koToken(); room.watch.push({ name: n, token: wt });
        if (await koUpdate(db, room, got.v)) return json(req, Object.assign(koView(room, -1), { token: wt, seat: -1, watch: true }));
        continue;
      }
      const token = koToken(); room.seats.push({ name: n, token }); const seat = room.seats.length - 1; room.seen[seat] = now; room.at = now;
      if (await koUpdate(db, room, got.v)) return json(req, Object.assign(koView(room, seat), { token, seat }));
      continue;
    }

    const seat = koSeat(room, b.t);
    if (seat < 0) return json(req, { error: 'seat' }, 403);
    room.seen[seat] = now;

    if (op === 'start') {
      if (seat !== 0) return json(req, { error: 'host' }, 403);
      if (room.phase !== 'lobby') return json(req, koView(room, seat));
      const seats = [];
      for (let i = 0; i < 6; i++) seats.push(room.seats[i] ? { name: room.seats[i].name, human: true } : { human: false });
      room.st = Kirilii.newGame({ seats, difficulty: 'normal' });
      room.phase = 'game'; room.at = now;
      if (await koUpdate(db, room, got.v)) return json(req, koView(room, seat));
      continue;
    }

    if (op === 'play') {
      const c = b.c;
      if (!Number.isInteger(c) || c < 0 || c > 54) return json(req, { error: 'card' }, 400);
      if (room.phase !== 'game' || room.st.phase !== 'play' || room.st.turn !== seat) return json(req, Object.assign(koView(room, seat), { error: 'turn' }), 409);
      try { Kirilii.play(room.st, seat, c); } catch (e) { return json(req, Object.assign(koView(room, seat), { error: 'illegal' }), 400); }
      room.at = now;
      if (await koUpdate(db, room, got.v)) return json(req, koView(room, seat));
      continue;
    }

    if (op === 'shout') {
      const k = b.k;
      if (!Number.isInteger(k) || k < 0 || k > 5) return json(req, { error: 'shout' }, 400);
      if (room.phase !== 'game' || room.st.phase === 'over') return json(req, { error: 'shout' }, 409);
      const key = koLapKey(room.st);
      room.shouts = (room.shouts || []).filter(x => now - x.at < 60000);
      if (room.shouts.some(x => x.seat === seat && x.lap === key && x.k === k)) return json(req, Object.assign(koView(room, seat), { error: 'used' }), 409);
      room.shoutN = (room.shoutN || 0) + 1;
      room.shouts.push({ id: room.shoutN, seat, k, lap: key, at: now });
      if (await koUpdate(db, room, got.v)) return json(req, koView(room, seat));
      continue;
    }

    if (op === 'throw') {
      const to = b.to;
      if (!Number.isInteger(to) || to < 0 || to > 5 || to === seat) return json(req, { error: 'throw' }, 400);
      if (room.phase !== 'game' || room.st.phase === 'over') return json(req, { error: 'throw' }, 409);
      const key = koLapKey(room.st);
      room.throws = (room.throws || []).filter(x => now - x.at < 60000);
      if (room.throws.some(x => x.from === seat && x.lap === key)) return json(req, Object.assign(koView(room, seat), { error: 'used' }), 409);
      room.throwN = (room.throwN || 0) + 1;
      room.throws.push({ id: room.throwN, from: seat, to, lap: key, at: now });
      if (await koUpdate(db, room, got.v)) return json(req, koView(room, seat));
      continue;
    }

    if (op === 'bang') {
      const pat = b.p;
      if (!Array.isArray(pat) || pat.length < 1 || pat.length > 16 || pat.some((x, i) => !Number.isInteger(x) || x < 0 || x > 2500 || (i && x < pat[i - 1]))) return json(req, { error: 'bang' }, 400);
      if (room.phase !== 'game') return json(req, { error: 'bang' }, 409);
      room.bangs = (room.bangs || []).filter(x => now - x.at < 8000);
      if (room.bangs.some(x => x.seat === seat && now - x.at < 400)) return json(req, { error: 'slow' }, 429);
      room.bangN = (room.bangN || 0) + 1;
      room.bangs.push({ id: room.bangN, seat, at: now, p: pat });
      if (await koUpdate(db, room, got.v)) return json(req, { ok: true, id: room.bangN });
      continue;
    }

    return json(req, { error: 'op' }, 404);
  }
  return json(req, { error: 'busy' }, 409);
}
