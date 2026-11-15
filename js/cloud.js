// The owner's list lives in the Worker's storage so every visitor sees it.
// Visitors only read /shelf. An owner's device also writes it, and keeps a private full copy in /vault.
import { db, saveQuiet, title, MOODS } from './store.js';
import { proxyUrl } from './tmdb.js';

export const available = () => !!proxyUrl();
export const isOwner = () => available() && !!db.settings.ownerKey;

async function call(path, { method = 'GET', body, key } = {}) {
  const headers = { accept: 'application/json' };
  if (body != null) headers['content-type'] = 'application/json';
  if (key) headers['x-owner-key'] = key;
  let res;
  try { res = await fetch(proxyUrl() + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined, cache: 'no-store' }); }
  catch (e) { throw new Error('Could not reach the site\'s storage. Check your connection.'); }
  if (res.status === 401) throw new Error('That owner passphrase is not right.');
  if (res.status === 403) throw new Error('The proxy refused this site. Its ALLOWED_ORIGINS setting needs this site\'s address.');
  if (res.status === 501) throw new Error('The proxy has no storage yet. Add the SHELF storage described in worker/README.md.');
  if (!res.ok) throw new Error('The site\'s storage returned an error (' + res.status + ').');
  return res.json();
}

const ID = /^[mtx][a-z0-9]{1,20}$/, POSTER = /^\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
// The shelf is read by every visitor, so it is checked field by field before use.
function clean(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
  const items = [];
  for (const x of d.items.slice(0, 2000)) {
    if (!x || typeof x.id !== 'string' || !ID.test(x.id)) continue;
    items.push({ id: x.id, type: x.type === 'tv' ? 'tv' : 'movie', tmdbId: x.id[0] === 'x' ? null : Number(x.id.slice(1)) || null,
      title: str(x.title || 'Untitled', 140), year: Number(x.year) || null, poster: (typeof x.poster === 'string' && POSTER.test(x.poster)) ? x.poster : '',
      runtime: Number(x.runtime) > 0 ? Math.min(Number(x.runtime), 2000) : null, score: Number(x.score) > 0 ? Math.min(Number(x.score), 10) : null, overview: str(x.overview, 400),
      moods: Array.isArray(x.moods) ? x.moods.filter(m => MOODS.includes(m)) : [], energy: ['low', 'medium', 'high'].includes(x.energy) ? x.energy : '',
      note: str(x.note, 300), listed: !!x.listed, seen: !!x.seen, rating: Number(x.rating) > 0 ? Math.min(Number(x.rating), 5) : 0, seenNote: str(x.seenNote, 500), addedAt: Number(x.addedAt) || 0 });
  }
  return { name: str(d.name, 30).trim(), updatedAt: Number(d.updatedAt) || 0, items };
}

export async function getShelf() { return clean(await call('/shelf')); }
export async function checkOwner(key) { await call('/owner', { method: 'POST', key }); return true; }
export async function getVault(key) { return call('/vault', { key: key || db.settings.ownerKey }); }

// What friends see: everything on the owner's watchlist, plus what they have logged, with tags, notes and ratings.
// The ledger (who recommended what) and rooms are never published.
export function buildShelf() {
  const map = new Map();
  const base = id => { const t = title(id); return { id, type: t.type, title: t.title, year: t.year || 0, poster: t.poster || '', runtime: t.runtime || 0, score: t.score || 0, overview: (t.overview || '').slice(0, 400), moods: [], energy: '', note: '', listed: false, seen: false, rating: 0, seenNote: '', addedAt: 0 }; };
  db.watchlist.forEach(w => { const x = base(w.id); Object.assign(x, { moods: w.moods, energy: w.energy, note: w.note, listed: true, addedAt: w.addedAt }); map.set(w.id, x); });
  [...db.diary].sort((a, b) => a.date < b.date ? -1 : 1).forEach(e => { const x = map.get(e.id) || base(e.id); const tg = title(e.id).tags; if (!x.listed && tg) { x.moods = tg.moods || []; x.energy = tg.energy || ''; x.note = tg.note || ''; } x.seen = true; if (e.rating) x.rating = e.rating; if (e.note) x.seenNote = e.note; if (!x.addedAt) x.addedAt = Date.parse(e.date) || 0; map.set(e.id, x); });
  return { v: 1, name: db.settings.name || '', updatedAt: Date.now(), items: [...map.values()] };
}

// Publish the public shelf and the owner's private full copy.
export async function publish() {
  const key = db.settings.ownerKey; if (!key) throw new Error('Owner mode is off on this device.');
  const shelf = buildShelf();
  const vault = JSON.parse(JSON.stringify(db)); vault.settings.apiKey = ''; vault.settings.ownerKey = ''; vault.updatedAt = shelf.updatedAt; delete vault.sync;
  await call('/shelf', { method: 'PUT', body: shelf, key });
  await call('/vault', { method: 'PUT', body: vault, key });
  db.sync = { at: shelf.updatedAt, dirty: false }; saveQuiet();
  return shelf;
}
