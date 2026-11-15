// Rooms travel between people as a link. The link carries the room's titles and everyone's votes,
// so no server is needed. Everything read from a link is validated before it touches the app.
import { db, save, putTitle, title, room } from './store.js';

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

export function pack(r) {
  const d = r.deck.map(id => { const t = title(id); return [id, t.title, t.year || 0, t.poster || '', t.runtime || 0]; });
  const m = {};
  Object.entries(r.votes).forEach(([name, v]) => { m[name] = r.deck.map(id => id in v ? (v[id] ? '1' : '0') : '-').join(''); });
  return b64(new TextEncoder().encode(JSON.stringify({ v: 1, r: r.rid, n: r.name, d, m })));
}
export const linkFor = r => location.href.split('#')[0] + '#join=' + pack(r);

const ID = /^[mtx][a-z0-9]{1,20}$/, POSTER = /^\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/;

// Accepts a full link or just the code after "#join=". Returns a clean payload or throws.
export function unpack(input) {
  let code = String(input || '').trim();
  const at = code.indexOf('#join='); if (at >= 0) code = code.slice(at + 6);
  code = code.replace(/\s+/g, '');
  if (!code || code.length > 60000) throw new Error('That does not look like a room link.');
  let p;
  try { p = JSON.parse(new TextDecoder().decode(unb64(code))); } catch (e) { throw new Error('That room link is damaged or incomplete.'); }
  if (!p || p.v !== 1 || typeof p.r !== 'string' || !/^[a-z0-9]{6,24}$/.test(p.r) || !Array.isArray(p.d) || p.d.length > 300) throw new Error('That room link is not in a format this app understands.');
  const deck = [];
  for (const row of p.d) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || !ID.test(row[0])) continue;
    deck.push({ id: row[0], type: row[0][0] === 't' ? 'tv' : 'movie', tmdbId: row[0][0] === 'x' ? null : Number(row[0].slice(1)) || null,
      title: String(row[1] || 'Untitled').slice(0, 140), year: Number(row[2]) || null,
      poster: (typeof row[3] === 'string' && POSTER.test(row[3])) ? row[3] : '', runtime: Number(row[4]) > 0 ? Math.min(Number(row[4]), 2000) : null });
  }
  const votes = {};
  if (p.m && typeof p.m === 'object') {
    Object.entries(p.m).slice(0, 12).forEach(([name, str]) => {
      name = String(name).slice(0, 30).trim(); if (!name || typeof str !== 'string') return;
      const v = {}; p.d.forEach((row, i) => { const c = str[i]; if (Array.isArray(row) && ID.test(String(row[0])) && (c === '1' || c === '0')) v[row[0]] = c === '1' ? 1 : 0; });
      votes[name] = v;
    });
  }
  return { rid: p.r, name: String(p.n || 'Shared room').slice(0, 60), deck, votes };
}

// Merge a payload into local data: new room, or more titles and votes for a room we already have.
// Votes for the person using this browser are never overwritten by a link.
export function apply(p) {
  let r = room(p.rid), created = false;
  if (!r) { r = { rid: p.rid, name: p.name, createdAt: Date.now(), deck: [], votes: {} }; db.rooms.unshift(r); created = true; }
  p.deck.forEach(t => { putTitle(t, true); if (!r.deck.includes(t.id)) r.deck.push(t.id); });
  const me = (db.settings.name || '').trim().toLowerCase();
  Object.entries(p.votes).forEach(([name, v]) => {
    if (me && name.toLowerCase() === me && r.votes[name] && Object.keys(r.votes[name]).length) return;
    r.votes[name] = Object.assign({}, r.votes[name] || {}, v);
  });
  save();
  return { room: r, created };
}
