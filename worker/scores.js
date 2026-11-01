// viistone.com CH 03 leaderboard: today (Helsinki time) and all time, three-letter names.
// Storage: one KV namespace bound as SCORES. Two games: CH 03 (default keys) and CH 06 Postinkantaja (keys prefixed with posti:).

const ORIGINS = ['https://viistone.com', 'https://www.viistone.com', 'http://localhost:8080', 'http://localhost:8811'];
const KEEP = 10;
const BLOCK = new Set(['ASS','FAG','FUK','FUC','GAY','JEW','KKK','NAZ','NIG','NGR','SEX','XXX','CUM','DIK','DIC','COK','KYS','PIS','PEE','POO',
  'VIT','VTU','HOR','HUO','KUS','PAS','PIL','PIM','NAI','NEK','NEG','RAP','TIT','WTF','FCK','FKU','SUK','HIT','SSS','SS ','KYK']);

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) } });
}
function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
async function list(env, key) {
  return (await env.SCORES.get(key, 'json')) || [];
}
function insert(rows, entry) {
  rows.push(entry);
  rows.sort((a, b) => b.s - a.s || a.t - b.t);
  return rows.slice(0, KEEP);
}

// CH 09 Kirilii: wins are counted per name, for the day and for all time
function top(map, me, t) {
  return Object.keys(map).map(n => ({ n, s: map[n], t: n === me ? t : 0 })).sort((a, b) => b.s - a.s || a.n.localeCompare(b.n)).slice(0, KEEP);
}
async function rateOk(req, env, day) {
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + day)))).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  const lastT = Number(await env.SCORES.get('rl:' + h)) || 0;
  if (Date.now() - lastT < 15000) return false;
  await env.SCORES.put('rl:' + h, String(Date.now()), { expirationTtl: 60 });
  return true;
}
async function kirilii(req, env, day, body) {
  const dk = 'kir:day:' + day, ak = 'kir:all';
  const [d, a] = await Promise.all([env.SCORES.get(dk, 'json'), env.SCORES.get(ak, 'json')]);
  const dm = d || {}, am = a || {};
  if (req.method === 'GET') return json(req, { day, game: 'kirilii', today: top(dm), all: top(am) });
  const n = String((body && body.n) || '').toUpperCase();
  if (!/^[A-ZÅÄÖ]{3}$/.test(n) || BLOCK.has(n)) return json(req, { error: 'name' }, 400);
  if (!(await rateOk(req, env, day))) return json(req, { error: 'slow down' }, 429);
  dm[n] = (dm[n] || 0) + 1; am[n] = (am[n] || 0) + 1;
  await Promise.all([env.SCORES.put(dk, JSON.stringify(dm), { expirationTtl: 60 * 60 * 24 * 4 }), env.SCORES.put(ak, JSON.stringify(am))]);
  const t = Date.now();
  return json(req, { day, game: 'kirilii', today: top(dm, n, t), all: top(am, n, t), t });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (url.pathname.startsWith('/api/kirilii/') && typeof kiriliiOnline === 'function') return kiriliiOnline(req, env, url);
    if (url.pathname !== '/api/scores') return json(req, { error: 'not found' }, 404);

    const day = today();
    const qg = url.searchParams.get('g') || '';
    if (qg === 'kirilii' && req.method === 'GET') return kirilii(req, env, day);
    const game = qg === 'posti' ? 'posti' : '2048';
    const pre = game === 'posti' ? 'posti:' : '';
    let dayKey = pre + 'day:' + day, allKey = pre + 'all';

    if (req.method === 'GET') {
      const [d, a] = await Promise.all([list(env, dayKey), list(env, allKey)]);
      return json(req, { day, game, today: d, all: a });
    }

    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json(req, { error: 'bad json' }, 400); }
      if (body.g === 'kirilii') return kirilii(req, env, day, body);
      const bg = body.g === 'posti' ? 'posti' : game, bpre = bg === 'posti' ? 'posti:' : '';
      dayKey = bpre + 'day:' + day; allKey = bpre + 'all';
      const n = String(body.n || '').toUpperCase();
      const s = Math.floor(Number(body.s));
      const l = Math.floor(Number(body.l));
      if (!/^[A-ZÅÄÖ]{3}$/.test(n) || BLOCK.has(n)) return json(req, { error: 'name' }, 400);
      if (!Number.isFinite(s) || s <= 0 || s > 5000000) return json(req, { error: 'score' }, 400);
      if (!Number.isFinite(l) || l < 0 || l > 9) return json(req, { error: 'level' }, 400);

      // one submission per connection every 15 s
      const ip = req.headers.get('CF-Connecting-IP') || 'x';
      const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + day)))).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
      const lastT = Number(await env.SCORES.get('rl:' + h)) || 0;
      if (Date.now() - lastT < 15000) return json(req, { error: 'slow down' }, 429);
      await env.SCORES.put('rl:' + h, String(Date.now()), { expirationTtl: 60 });

      const entry = { n, s, l, t: Date.now() };
      const [d0, a0] = await Promise.all([list(env, dayKey), list(env, allKey)]);
      const d = insert(d0, entry), a = insert(a0, entry);
      await Promise.all([
        env.SCORES.put(dayKey, JSON.stringify(d), { expirationTtl: 60 * 60 * 24 * 4 }),
        env.SCORES.put(allKey, JSON.stringify(a)),
      ]);
      return json(req, { day, game: bg, today: d, all: a, t: entry.t });
    }
    return json(req, { error: 'method' }, 405);
  },
};
