// All data lives in this browser's localStorage. One JSON document, saved after every change.
const KEY = 'reelroom.v1';

export const MOODS = ['Cozy', 'Funny', 'Feel-good', 'Romantic', 'Thoughtful', 'Tense', 'Mind-bending', 'Epic', 'Sad', 'Scary'];
export const ENERGY = [
  { id: 'low', label: 'Low', hint: 'easy watch, can half-follow' },
  { id: 'medium', label: 'Medium', hint: 'normal attention' },
  { id: 'high', label: 'High', hint: 'needs full attention' }
];

const blank = () => ({ v: 1, settings: { apiKey: '', name: '', ownerKey: '' }, sync: { at: 0, dirty: false }, titles: {}, watchlist: [], diary: [], ledger: [], rooms: [] });

function normalise(d) {
  const b = blank();
  if (!d || typeof d !== 'object') return b;
  return {
    v: 1,
    settings: Object.assign(b.settings, d.settings || {}),
    sync: Object.assign(b.sync, d.sync || {}),
    titles: d.titles && typeof d.titles === 'object' ? d.titles : {},
    watchlist: Array.isArray(d.watchlist) ? d.watchlist : [],
    diary: Array.isArray(d.diary) ? d.diary : [],
    ledger: Array.isArray(d.ledger) ? d.ledger : [],
    rooms: Array.isArray(d.rooms) ? d.rooms : []
  };
}
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return normalise(JSON.parse(raw)); } catch (e) { /* storage blocked or corrupt */ }
  return blank();
}

export let db = load();
export let storageOk = true;
const listeners = [];
export const onChange = fn => listeners.push(fn);
// saveQuiet writes to storage; save also marks the data as changed so an owner's device republishes it.
export function saveQuiet() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); storageOk = true; } catch (e) { storageOk = false; }
  return storageOk;
}
export function save() {
  db.sync.dirty = true; saveQuiet(); listeners.forEach(fn => { try { fn(); } catch (e) { /* a listener must not break saving */ } });
  return storageOk;
}
export function replaceAll(d) { db = normalise(d); return save(); }
export function eraseAll() { db = blank(); return save(); }

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

// ---- titles (a small cache of what we know about each film or series) ----
export function putTitle(t, keepRicher) {
  const old = db.titles[t.id];
  if (old && keepRicher) { db.titles[t.id] = Object.assign({}, t, Object.fromEntries(Object.entries(old).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)))); }
  else db.titles[t.id] = Object.assign({}, old || {}, t);
  return db.titles[t.id];
}
export const title = id => db.titles[id] || { id, title: 'Unknown title', type: 'movie' };

// ---- watchlist ----
export const onList = id => db.watchlist.find(w => w.id === id);
export function addToWatchlist(id, { moods = [], energy = '', note = '', by = '' } = {}) {
  let w = onList(id);
  if (!w) { w = { id, addedAt: Date.now(), moods: [], energy: '', note: '' }; db.watchlist.unshift(w); }
  w.moods = moods.filter(m => MOODS.includes(m)); w.energy = energy; w.note = clip(note, 300);
  if (by.trim()) addLedger({ dir: 'in', person: by, id, note: '' });
  save(); return w;
}
export function removeFromWatchlist(id) { db.watchlist = db.watchlist.filter(w => w.id !== id); save(); }

// ---- diary ----
export const diaryFor = id => db.diary.filter(e => e.id === id);
export function logWatch(id, { date, rating, note = '', keepOnList = false }) {
  const entry = { eid: uid(), id, date: date || today(), rating: rating ? Number(rating) : 0, note: clip(note, 500), rewatch: diaryFor(id).length > 0 };
  db.diary.push(entry);
  // Keep the mood and energy tags with the title, so they survive once it leaves the watchlist.
  const w = onList(id); if (w && db.titles[id]) db.titles[id].tags = { moods: w.moods, energy: w.energy, note: w.note };
  if (!keepOnList) db.watchlist = db.watchlist.filter(w => w.id !== id);
  save(); return entry;
}
export function updateEntry(eid, patch) { const e = db.diary.find(x => x.eid === eid); if (e) { Object.assign(e, patch); save(); } }
export function deleteEntry(eid) { db.diary = db.diary.filter(e => e.eid !== eid); save(); }
export const latestRating = id => { const es = diaryFor(id).filter(e => e.rating).sort((a, b) => a.date < b.date ? 1 : -1); return es.length ? es[0].rating : 0; };

// ---- recommendation ledger ----
export function addLedger({ dir, person, id, note = '' }) {
  person = clip(person, 40).trim(); if (!person) return null;
  const dup = db.ledger.find(l => l.dir === dir && l.id === id && l.person.toLowerCase() === person.toLowerCase());
  if (dup) { if (note) dup.note = clip(note, 300); save(); return dup; }
  const l = { lid: uid(), dir, person, id, note: clip(note, 300), date: today(), outcome: '' };
  db.ledger.push(l); save(); return l;
}
export function updateLedger(lid, patch) { const l = db.ledger.find(x => x.lid === lid); if (l) { Object.assign(l, patch); save(); } }
export function deleteLedger(lid) { db.ledger = db.ledger.filter(l => l.lid !== lid); save(); }
export const people = () => [...new Set(db.ledger.map(l => l.person))].sort((a, b) => a.localeCompare(b));
export const recommendersOf = id => db.ledger.filter(l => l.dir === 'in' && l.id === id).map(l => l.person);

// ---- rooms ----
export const room = rid => db.rooms.find(r => r.rid === rid);
export function createRoom(name, deck) {
  const r = { rid: uid(), name: clip(name, 60) || 'Our room', createdAt: Date.now(), deck: [...new Set(deck)], votes: {} };
  db.rooms.unshift(r); save(); return r;
}
export function deleteRoom(rid) { db.rooms = db.rooms.filter(r => r.rid !== rid); save(); }
export function vote(rid, member, id, yes) { const r = room(rid); if (!r) return; (r.votes[member] = r.votes[member] || {})[id] = yes ? 1 : 0; save(); }
export function unvote(rid, member, id) { const r = room(rid); if (r && r.votes[member]) { delete r.votes[member][id]; save(); } }
export function addToRoom(rid, id) { const r = room(rid); if (r && !r.deck.includes(id)) { r.deck.push(id); save(); } }
export const pendingFor = (r, member) => r.deck.filter(id => !(r.votes[member] && id in r.votes[member]));
// A match is a title at least two people have voted on and nobody said no to.
export function tally(r) {
  const members = Object.keys(r.votes);
  return r.deck.map(id => {
    const voters = members.filter(m => id in r.votes[m]);
    const yes = voters.filter(m => r.votes[m][id] === 1);
    return { id, voters: voters.length, yes: yes.length, match: voters.length >= 2 && yes.length === voters.length };
  });
}
