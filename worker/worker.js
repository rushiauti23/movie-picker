// Reel Room's TMDB proxy, for Cloudflare Workers.
//
// The site calls this Worker instead of TMDB. The Worker adds the TMDB key, which is stored
// as an encrypted secret here and is never sent to the browser or kept in the repository.
//
// Settings (see worker/README.md):
//   TMDB_KEY         secret   your TMDB "API Key" or "API Read Access Token"
//   ALLOWED_ORIGINS  variable comma-separated sites allowed to call this, e.g.
//                             "https://yourname.github.io,http://localhost:8000"
//   OWNER_PASSWORD   secret   a long passphrase only the site owner knows
//   SHELF            KV       a KV namespace that stores the owner's list
//
// It also keeps the owner's list so every visitor sees it:
//   GET  /shelf   anyone on the site   the published picks
//   PUT  /shelf   owner only           publish the picks
//   GET  /vault   owner only           the owner's full data, to sync their own devices
//   PUT  /vault   owner only
//   POST /owner   owner only           checks the passphrase

const TMDB = 'https://api.themoviedb.org/3';

// Only the endpoints the site uses, so this cannot be used as a general TMDB proxy.
const ROUTES = [
  /^\/search\/multi$/,
  /^\/trending\/all\/week$/,
  /^\/movie\/\d{1,9}$/,
  /^\/tv\/\d{1,9}$/,
  /^\/configuration$/
];
const PARAMS = ['query', 'page', 'include_adult', 'language'];
const CACHE_SECONDS = { search: 600, other: 3600 };

// Compare without stopping at the first different character.
function same(a, b) { a = String(a); b = String(b); let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; }

async function shelf(request, env, path, cors) {
  const noStore = Object.assign({ 'Cache-Control': 'no-store' }, cors);
  if (!env.SHELF) return json({ error: 'The proxy has no SHELF storage yet. See worker/README.md.' }, 501, noStore);
  const given = request.headers.get('X-Owner-Key') || '';
  const authed = !!env.OWNER_PASSWORD && given.length > 0 && same(given, env.OWNER_PASSWORD);
  const refuse = async () => { await new Promise(r => setTimeout(r, 400)); return json({ error: 'Wrong owner passphrase.' }, 401, noStore); };   // the pause slows down guessing
  const key = path.slice(1);
  if (path === '/owner') { if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, noStore); return authed ? json({ ok: true }, 200, noStore) : refuse(); }
  if (request.method === 'GET') {
    if (path === '/vault' && !authed) return refuse();
    const value = await env.SHELF.get(key);
    return new Response(value || 'null', { status: 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, noStore) });
  }
  if (request.method === 'PUT') {
    if (!authed) return refuse();
    const body = await request.text();
    if (body.length > 2000000) return json({ error: 'That is too much data to store.' }, 413, noStore);
    try { JSON.parse(body); } catch (e) { return json({ error: 'The data is not valid JSON.' }, 400, noStore); }
    await env.SHELF.put(key, body);
    return json({ ok: true }, 200, noStore);
  }
  return json({ error: 'Method not supported here.' }, 405, noStore);
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers) });

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'accept, content-type, x-owner-key', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };

    // Browsers always send Origin on cross-site requests, so anything else is not our site.
    if (!origin || !allowed.includes(origin)) return json({ error: 'This proxy only serves its own site.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/shelf' || path === '/vault' || path === '/owner') return shelf(request, env, path, cors);

    if (request.method !== 'GET') return json({ error: 'Only GET is supported.' }, 405, cors);
    if (!env.TMDB_KEY) return json({ error: 'The proxy has no TMDB_KEY secret yet.' }, 500, cors);
    if (!ROUTES.some(r => r.test(path))) return json({ error: 'Not an endpoint this proxy serves.' }, 404, cors);

    const upstream = new URL(TMDB + path);
    for (const name of PARAMS) { const v = url.searchParams.get(name); if (v != null && v.length <= 200) upstream.searchParams.set(name, v); }
    const headers = { accept: 'application/json' };
    const key = String(env.TMDB_KEY).trim();
    if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key; else upstream.searchParams.set('api_key', key);

    // Cache successful answers at Cloudflare's edge, keyed without the secret.
    const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
    const cacheKey = new Request('https://reelroom-cache' + path + '?' + PARAMS.map(n => n + '=' + encodeURIComponent(url.searchParams.get(n) || '')).join('&'));
    if (cache) { const hit = await cache.match(cacheKey); if (hit) { const h = new Headers(hit.headers); Object.entries(cors).forEach(([k, v]) => h.set(k, v)); return new Response(hit.body, { status: 200, headers: h }); } }

    let res;
    try { res = await fetch(upstream.toString(), { headers }); } catch (e) { return json({ error: 'Could not reach TMDB.' }, 502, cors); }
    const body = await res.text();
    const ttl = path.startsWith('/search') ? CACHE_SECONDS.search : CACHE_SECONDS.other;
    const out = { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': res.ok ? 'public, max-age=' + ttl : 'no-store' };
    if (res.ok && cache) { const put = cache.put(cacheKey, new Response(body, { status: 200, headers: out })); if (ctx && ctx.waitUntil) ctx.waitUntil(put); }
    return new Response(body, { status: res.status, headers: Object.assign({}, out, cors) });
  }
};
