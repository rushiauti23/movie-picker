import * as S from './store.js';
import { db, MOODS, ENERGY, title } from './store.js';
import * as T from './tmdb.js';
import * as Share from './share.js';
import * as Cloud from './cloud.js';

/* ---------- small DOM helpers (all text goes through textContent, never innerHTML) ---------- */
const $ = s => document.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k]; if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v; else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(c => { if (c != null && c !== false) el.append(c); });
  return el;
}
const view = $('#view'), dlg = $('#dlg');
// Views pass null for parts they leave out; drop those instead of printing them.
{ const add = view.append.bind(view); view.append = (...nodes) => add(...nodes.flat().filter(n => n != null && n !== false)); }
let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }
function openDialog(titleText, ...body) { $('#dlg-title').textContent = titleText; const b = $('#dlg-body'); b.textContent = ''; b.append(...body.flat().filter(Boolean)); if (!dlg.open) dlg.showModal(); }
const closeDialog = () => { if (dlg.open) dlg.close(); };
$('#dlg-close').addEventListener('click', closeDialog);
dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });

const fmtMin = m => !m ? '' : (m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + 'm');
const fmtRuntime = t => !t.runtime ? '' : fmtMin(t.runtime) + (t.type === 'tv' ? ' per episode' : '');
const kind = t => t.type === 'tv' ? 'Series' : 'Film';
const stars = r => r ? '★ ' + (Number.isInteger(r) ? r : r.toFixed(1)) : 'Not rated';
const fmtDate = d => { const x = new Date(d + 'T12:00:00'); return isNaN(x) ? d : x.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
function posterEl(t, cls) {
  const url = T.poster(t.poster, cls === 'sm' ? 'w92' : 'w185');
  const fallback = () => h('div', { class: 'poster ' + (cls || ''), 'aria-hidden': 'true', text: (t.title || '?').trim().charAt(0).toUpperCase() });
  if (!url) return fallback();
  const img = h('img', { class: 'poster ' + (cls || ''), src: url, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}
const metaLine = t => [kind(t), t.year, fmtRuntime(t), t.score ? 'TMDB ' + t.score : ''].filter(Boolean).join(' · ');
function chipGroup(options, isOn, toggle) {
  return h('div', { class: 'chips' }, options.map(o => { const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(isOn(o.id)), text: o.label }); b.addEventListener('click', () => { toggle(o.id); }); return b; }));
}
async function ensureDetails(t) {
  if (!t.tmdbId || !T.hasKey() || (t.runtime && t.genres && t.genres.length)) return S.putTitle(t, true);
  try { return S.putTitle(await T.details(t.type, t.tmdbId)); } catch (e) { return S.putTitle(t, true); }
}
async function copyText(text) { try { await navigator.clipboard.writeText(text); toast('Copied.'); return true; } catch (e) { return false; } }

/* ---------- dialogs shared by several views ---------- */
function tagDialog(t, after) {
  const w = S.onList(t.id), moods = new Set(w ? w.moods : []); let energy = w ? w.energy : '';
  const moodBox = h('div'), energyBox = h('div');
  const drawMoods = () => { moodBox.replaceChildren(chipGroup(MOODS.map(m => ({ id: m, label: m })), id => moods.has(id), id => { moods.has(id) ? moods.delete(id) : moods.add(id); drawMoods(); })); };
  const drawEnergy = () => { energyBox.replaceChildren(chipGroup(ENERGY.map(e => ({ id: e.id, label: e.label + ': ' + e.hint })), id => energy === id, id => { energy = energy === id ? '' : id; drawEnergy(); })); };
  drawMoods(); drawEnergy();
  const by = h('input', { id: 'tag-by', type: 'text', maxlength: '40', list: 'people-list', placeholder: 'Leave empty if you found it yourself', autocomplete: 'off', autocapitalize: 'words' });
  const note = h('textarea', { id: 'tag-note', maxlength: '300', placeholder: 'Why you want to watch it', value: w ? w.note : '' });
  const saveBtn = h('button', { class: 'btn primary', type: 'button', text: w ? 'Save tags' : 'Add to watchlist' });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; saveBtn.textContent = 'Saving';
    const full = await ensureDetails(t);
    S.addToWatchlist(full.id, { moods: [...moods], energy, note: note.value, by: by.value });
    closeDialog(); toast(w ? 'Tags saved.' : 'Added: ' + full.title); if (after) after(); else render();
  });
  openDialog(t.title + (t.year ? ' (' + t.year + ')' : ''),
    h('div', { class: 'stack' }, h('b', { text: 'What mood is it for?' }), moodBox),
    h('div', { class: 'stack' }, h('b', { text: 'How much energy does it need?' }), energyBox),
    w ? null : h('label', { for: 'tag-by' }, 'Who recommended it?', by, h('datalist', { id: 'people-list' }, S.people().map(p => h('option', { value: p })))),
    h('label', { for: 'tag-note' }, 'Note', note),
    h('div', { class: 'row' }, saveBtn));
}
function logDialog(id, entry) {
  const t = title(id), prior = S.diaryFor(id).filter(e => !entry || e.eid !== entry.eid).length, listed = !!S.onList(id);
  const date = h('input', { id: 'log-date', type: 'date', value: entry ? entry.date : S.today(), max: S.today() });
  const out = h('b', { class: 'stars' });
  const rating = h('input', { id: 'log-rating', type: 'range', min: '0', max: '5', step: '0.5', value: String(entry ? entry.rating : 0), style: 'padding:0' });
  const show = () => { out.textContent = stars(Number(rating.value)); }; rating.addEventListener('input', show); show();
  const note = h('textarea', { id: 'log-note', maxlength: '500', placeholder: 'A line you will want to read later', value: entry ? entry.note : '' });
  const keep = h('input', { id: 'log-keep', type: 'checkbox', style: 'width:auto' });
  const btn = h('button', { class: 'btn primary', type: 'button', text: entry ? 'Save entry' : 'Log it' });
  btn.addEventListener('click', () => {
    if (entry) S.updateEntry(entry.eid, { date: date.value || S.today(), rating: Number(rating.value), note: note.value.slice(0, 500) });
    else S.logWatch(id, { date: date.value, rating: Number(rating.value), note: note.value, keepOnList: keep.checked });
    closeDialog(); toast(entry ? 'Entry saved.' : 'Logged in your diary.'); render();
  });
  openDialog((entry ? 'Edit: ' : 'Watched: ') + t.title,
    (!entry && prior) ? h('p', { class: 'banner', text: 'You have logged this ' + prior + (prior === 1 ? ' time' : ' times') + ' before, so this one counts as a rewatch.' }) : null,
    h('label', { for: 'log-date' }, 'When', date),
    h('label', { for: 'log-rating' }, h('span', { class: 'row' }, 'Your rating ', out), rating),
    h('label', { for: 'log-note' }, 'Note', note),
    (!entry && listed) ? h('label', { for: 'log-keep', style: 'flex-direction:row;align-items:center;gap:8px' }, keep, 'Keep it on my watchlist (for a series I am still watching)') : null,
    h('div', { class: 'row' }, btn));
}
function askName(then) {
  const input = h('input', { id: 'name-input', type: 'text', maxlength: '30', value: db.settings.name, autocomplete: 'given-name', autocapitalize: 'words', placeholder: 'Your first name' });
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Continue' });
  const go = () => { const n = input.value.trim(); if (!n) { input.focus(); return; } db.settings.name = n.slice(0, 30); S.save(); closeDialog(); then(db.settings.name); };
  btn.addEventListener('click', go); input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  openDialog('What should rooms call you?', h('label', { for: 'name-input' }, 'Your name, as the other person will see it', input), h('div', { class: 'row' }, btn));
}


const TIMES = [[0, 'Any length'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1h 30'], [120, '2 hours'], [150, '2h 30']];

/* ---------- picks: the owner's published list, the first thing a visitor sees ---------- */
const pf = { time: 0, moods: new Set(), energy: '', type: '', seen: '', q: '' };
const picks = { data: null, error: '', loading: false, at: 0 };
function loadPicks(force) {
  if (picks.loading || (!force && picks.data && Date.now() - picks.at < 60000)) return;
  picks.loading = true;
  Cloud.getShelf().then(d => { picks.data = d || { name: '', updatedAt: 0, items: [] }; picks.error = ''; }).catch(e => { picks.error = e.message; }).finally(() => { picks.loading = false; picks.at = Date.now(); if ((location.hash || '#picks').startsWith('#picks') || location.hash === '') render(); });
}
function viewPicks() {
  loadPicks(false);
  const d = picks.data, owner = Cloud.isOwner(), who = (d && d.name) || 'My';
  const heading = d && d.name ? d.name + '\'s picks' : 'Picks';
  if (!d) { view.append(h('div', { class: 'head' }, h('div', null, h('h1', { text: heading }), h('p', { class: 'sub', text: picks.error || 'Loading the list…' }))), picks.error ? h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => { picks.error = ''; loadPicks(true); render(); } })) : null); return; }
  const all = d.items;
  let list = all.filter(x => (!pf.time || (x.runtime && x.runtime <= pf.time)) && (!pf.moods.size || x.moods.some(m => pf.moods.has(m))) && (!pf.energy || x.energy === pf.energy) && (!pf.type || x.type === pf.type) && (!pf.seen || (pf.seen === 'seen' ? x.seen : !x.seen)) && (!pf.q || x.title.toLowerCase().includes(pf.q.toLowerCase())));
  list.sort((a, b) => (b.rating - a.rating) || (b.addedAt - a.addedAt));
  const set = (k, v) => { pf[k] = v; render(); };
  const q = h('input', { id: 'pk-q', type: 'search', placeholder: 'Find a title', value: pf.q, 'aria-label': 'Find a title in the picks', enterkeyhint: 'search' });
  q.addEventListener('input', () => { pf.q = q.value; render(); const n = $('#pk-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  const active = pf.time || pf.moods.size || pf.energy || pf.type || pf.seen || pf.q;
  const usedMoods = MOODS.filter(m => all.some(x => x.moods.includes(m)));
  view.append(h('div', { class: 'head' }, h('div', null, h('h1', { text: heading }), h('p', { class: 'sub', text: all.length ? list.length + ' of ' + all.length + ' titles' + (d.updatedAt ? ' · updated ' + new Date(d.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '') : 'Nothing has been published yet.' })), owner ? h('a', { class: 'btn', href: '#add', text: 'Add a title' }) : null),
    owner ? h('p', { class: 'banner', text: 'This is what your friends see when they open the site. It updates by itself a moment after you change your list or diary.' }) : null);
  if (!all.length) { view.append(h('div', { class: 'empty' }, h('b', { text: 'No picks yet' }), owner ? 'Add titles to your list and they appear here for everyone.' : 'Check back soon.')); return; }
  view.append(h('section', { class: 'panel filters', 'aria-label': 'Filters' },
    h('div', { class: 'fgroup' }, h('b', { text: 'I have' }), chipGroup(TIMES.map(([id, label]) => ({ id, label })), id => pf.time === id, id => set('time', id))),
    usedMoods.length ? h('div', { class: 'fgroup' }, h('b', { text: 'Mood' }), chipGroup(usedMoods.map(m => ({ id: m, label: m })), id => pf.moods.has(id), id => { pf.moods.has(id) ? pf.moods.delete(id) : pf.moods.add(id); render(); })) : null,
    h('div', { class: 'fgroup' }, h('b', { text: 'Energy' }), chipGroup(ENERGY.map(e => ({ id: e.id, label: e.label })), id => pf.energy === id, id => set('energy', pf.energy === id ? '' : id))),
    h('div', { class: 'fgroup' }, h('b', { text: 'Show' }), chipGroup([{ id: '', label: 'Everything' }, { id: 'seen', label: 'Watched and rated' }, { id: 'todo', label: 'Still to watch' }, { id: 'movie', label: 'Films' }, { id: 'tv', label: 'Series' }], id => (id === 'movie' || id === 'tv') ? pf.type === id : (pf.seen === id && (id !== '' || !pf.type)), id => { if (id === 'movie' || id === 'tv') pf.type = pf.type === id ? '' : id; else { pf.seen = id; if (id === '') pf.type = ''; } render(); })),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, q), active ? h('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: () => { Object.assign(pf, { time: 0, energy: '', type: '', seen: '', q: '' }); pf.moods.clear(); render(); } }) : null)));
  if (!list.length) { view.append(h('div', { class: 'empty' }, h('b', { text: 'Nothing fits those filters' }), 'Loosen a filter to see more.')); return; }
  view.append(h('div', { class: 'grid' }, list.map(x => {
    const en = ENERGY.find(e => e.id === x.energy), mineListed = !!S.onList(x.id), mineSeen = S.diaryFor(x.id).length;
    const addMine = () => { S.putTitle({ id: x.id, type: x.type, tmdbId: x.tmdbId, title: x.title, year: x.year, poster: x.poster, runtime: x.runtime, genres: [], overview: x.overview, score: x.score }, true); S.addToWatchlist(x.id, { moods: x.moods, energy: x.energy, note: '', by: d.name || '' }); toast('Added to your list.'); render(); };
    return h('article', { class: 'card' }, posterEl(x),
      h('div', { class: 'info' }, h('h3', { text: x.title }), h('div', { class: 'meta', text: metaLine(x) }),
        h('div', { class: 'row', style: 'gap:6px' }, x.rating ? h('span', { class: 'tag gold', text: (d.name || 'Rated') + (d.name ? ': ' : ' ') + stars(x.rating) }) : (x.seen ? h('span', { class: 'tag', text: 'Watched' }) : h('span', { class: 'tag', text: 'On ' + (d.name ? d.name + '\'s' : 'the') + ' list' })), en ? h('span', { class: 'tag e-' + en.id, text: en.label + ' energy' }) : null, x.moods.map(m => h('span', { class: 'tag', text: m }))),
        (x.seenNote || x.note) ? h('div', { class: 'note', text: '“' + (x.seenNote || x.note) + '”' }) : null,
        owner ? null : h('div', { class: 'actions' }, h('button', { class: 'btn small' + (mineListed || mineSeen ? '' : ' primary'), type: 'button', disabled: mineListed || !!mineSeen, text: mineSeen ? 'You have watched it' : (mineListed ? 'On your list' : 'Add to my list'), onclick: addMine }))));
  })));
}

/* ---------- owner sync: publish after changes, pull on another device ---------- */
let pubTimer = 0, pubState = '';
function schedulePublish() { if (!Cloud.isOwner()) return; clearTimeout(pubTimer); pubTimer = setTimeout(doPublish, 1500); }
async function doPublish() {
  if (!Cloud.isOwner()) return false;
  try { const shelf = await Cloud.publish(); picks.data = { name: shelf.name, updatedAt: shelf.updatedAt, items: shelf.items.map(x => Object.assign({ tmdbId: x.id[0] === 'x' ? null : Number(x.id.slice(1)) }, x)) }; picks.at = Date.now(); pubState = 'Published ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + '.'; const el = $('#pub-state'); if (el) el.textContent = pubState; return true; }
  catch (e) { pubState = 'Could not publish: ' + e.message; const el = $('#pub-state'); if (el) el.textContent = pubState; toast('Your list could not be published. It will retry on the next change.'); return false; }
}
S.onChange(schedulePublish);
function adoptVault(v) { const keep = { apiKey: db.settings.apiKey, ownerKey: db.settings.ownerKey }; S.replaceAll(v); Object.assign(db.settings, keep); db.sync = { at: Number(v.updatedAt) || Date.now(), dirty: false }; S.saveQuiet(); }
// On an owner's device at start-up: take the online copy if it is newer and nothing here is waiting to be published.
async function ownerPull() {
  if (!Cloud.isOwner()) return;
  try { const v = await Cloud.getVault(); if (v && Number(v.updatedAt) > db.sync.at) { if (!db.sync.dirty) { adoptVault(v); render(); toast('Loaded your latest list from your other device.'); } else doPublish(); } else if (db.sync.dirty) doPublish(); }
  catch (e) { /* offline or storage not ready: the device keeps working from its own copy */ }
}

/* ---------- watchlist ---------- */
const wf = { time: 0, moods: new Set(), energy: '', type: '', q: '', sort: 'recent', picked: null };
function viewWatchlist() {
  const all = db.watchlist.map(w => ({ w, t: title(w.id) }));
  let list = all.filter(({ w, t }) =>
    (!wf.time || (t.runtime && t.runtime <= wf.time)) &&
    (!wf.moods.size || w.moods.some(m => wf.moods.has(m))) &&
    (!wf.energy || w.energy === wf.energy) && (!wf.type || t.type === wf.type) &&
    (!wf.q || t.title.toLowerCase().includes(wf.q.toLowerCase())));
  if (wf.sort === 'short') list.sort((a, b) => (a.t.runtime || 1e9) - (b.t.runtime || 1e9));
  else if (wf.sort === 'top') list.sort((a, b) => (b.t.score || 0) - (a.t.score || 0));
  else list.sort((a, b) => b.w.addedAt - a.w.addedAt);
  const unknown = wf.time ? all.filter(x => !x.t.runtime).length : 0;
  const set = (k, v) => { wf[k] = v; wf.picked = null; render(); };
  const q = h('input', { id: 'wl-q', type: 'search', placeholder: 'Find a title on your list', value: wf.q, 'aria-label': 'Find a title on your list', enterkeyhint: 'search' });
  q.addEventListener('input', () => { wf.q = q.value; wf.picked = null; render(); const n = $('#wl-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  const sort = h('select', { id: 'wl-sort', 'aria-label': 'Sort by' }, [['recent', 'Newest first'], ['short', 'Shortest first'], ['top', 'Highest TMDB score']].map(([v, l]) => h('option', { value: v, selected: wf.sort === v, text: l })));
  sort.addEventListener('change', () => set('sort', sort.value));
  const pick = h('button', { class: 'btn primary', type: 'button', text: 'Pick one for me', disabled: !list.length });
  pick.addEventListener('click', () => { wf.picked = list[Math.floor(Math.random() * list.length)].w.id; render(); const el = document.querySelector('.card.picked'); if (el) el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
  const active = wf.time || wf.moods.size || wf.energy || wf.type || wf.q;
  view.append(
    h('div', { class: 'head' }, h('div', null, h('h1', { text: 'My list: what fits tonight?' }), h('p', { class: 'sub', text: all.length ? list.length + ' of ' + all.length + ' on your watchlist' + (active ? ' match' : '') : 'Your watchlist is empty.' })), h('div', { class: 'row' }, pick, h('a', { class: 'btn', href: '#add', text: 'Add a title' }))),
    all.length ? h('section', { class: 'panel filters', 'aria-label': 'Filters' },
      h('div', { class: 'fgroup' }, h('b', { text: 'I have' }), chipGroup(TIMES.map(([id, label]) => ({ id, label })), id => wf.time === id, id => set('time', id))),
      h('div', { class: 'fgroup' }, h('b', { text: 'Mood' }), chipGroup(MOODS.map(m => ({ id: m, label: m })), id => wf.moods.has(id), id => { wf.moods.has(id) ? wf.moods.delete(id) : wf.moods.add(id); wf.picked = null; render(); })),
      h('div', { class: 'fgroup' }, h('b', { text: 'Energy' }), chipGroup(ENERGY.map(e => ({ id: e.id, label: e.label })), id => wf.energy === id, id => set('energy', wf.energy === id ? '' : id))),
      h('div', { class: 'fgroup' }, h('b', { text: 'Kind' }), chipGroup([{ id: '', label: 'Both' }, { id: 'movie', label: 'Films' }, { id: 'tv', label: 'Series' }], id => wf.type === id, id => set('type', id))),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, q), h('div', { style: 'width:210px;max-width:100%' }, sort), active ? h('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: () => { Object.assign(wf, { time: 0, energy: '', type: '', q: '', picked: null }); wf.moods.clear(); render(); } }) : null),
      unknown ? h('p', { class: 'fine', text: unknown + (unknown === 1 ? ' title has' : ' titles have') + ' no runtime on record, so the time filter leaves ' + (unknown === 1 ? 'it' : 'them') + ' out.' }) : null) : null);
  if (!all.length) { view.append(h('div', { class: 'empty' }, h('b', { text: 'Nothing here yet' }), 'Search for a film or series, tag it with a mood and an energy level, and it will show up here.', h('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, h('a', { class: 'btn primary', href: '#add', text: 'Add your first title' })))); return; }
  if (!list.length) { view.append(h('div', { class: 'empty' }, h('b', { text: 'Nothing fits those filters' }), 'Loosen the time, mood or energy filter to see more.')); return; }
  view.append(h('div', { class: 'grid' }, list.map(({ w, t }) => {
    const by = S.recommendersOf(t.id), en = ENERGY.find(e => e.id === w.energy);
    return h('article', { class: 'card' + (wf.picked === t.id ? ' picked' : '') }, posterEl(t),
      h('div', { class: 'info' }, h('h3', { text: t.title }), h('div', { class: 'meta', text: metaLine(t) }),
        h('div', { class: 'row', style: 'gap:6px' }, wf.picked === t.id ? h('span', { class: 'tag gold', text: 'Tonight\'s pick' }) : null, en ? h('span', { class: 'tag e-' + en.id, text: en.label + ' energy' }) : null, w.moods.map(m => h('span', { class: 'tag', text: m }))),
        by.length ? h('div', { class: 'note', text: 'Recommended by ' + by.join(', ') }) : null,
        w.note ? h('div', { class: 'note', text: w.note }) : null,
        h('div', { class: 'actions' }, h('button', { class: 'btn small primary', type: 'button', text: 'Watched', onclick: () => logDialog(t.id) }), h('button', { class: 'btn small', type: 'button', text: 'Edit tags', onclick: () => tagDialog(t) }), h('button', { class: 'btn small danger', type: 'button', text: 'Remove', onclick: () => { S.removeFromWatchlist(t.id); toast('Removed from your watchlist.'); render(); } }))));
  })));
}

/* ---------- add ---------- */
const add = { q: '', results: null, error: '', loading: false, trending: null, timer: 0, seq: 0 };
function resultRow(t) {
  const listed = !!S.onList(t.id), seen = S.diaryFor(t.id).length;
  return h('div', { class: 'item' }, posterEl(t, 'sm'), h('div', { class: 'grow' }, h('b', { text: t.title }), h('div', { class: 'meta', text: [kind(t), t.year, t.score ? 'TMDB ' + t.score : '', seen ? 'watched ' + seen + (seen === 1 ? ' time' : ' times') : ''].filter(Boolean).join(' · ') })),
    h('div', { class: 'row' }, h('button', { class: 'btn small' + (listed ? '' : ' primary'), type: 'button', text: listed ? 'On your list' : 'Add', disabled: listed, onclick: () => { S.putTitle(t, true); tagDialog(t, drawResults); } }),
      h('button', { class: 'btn small', type: 'button', text: 'Log as watched', onclick: async () => { const full = await ensureDetails(t); logDialog(full.id); } })));
}
function drawResults() {
  const box = $('#add-results'); if (!box) return; box.textContent = '';
  if (add.error) { box.append(h('p', { class: 'banner', text: add.error })); return; }
  if (add.loading) { box.append(h('p', { class: 'sub', text: 'Searching TMDB…' })); return; }
  if (add.q.trim().length >= 2) {
    if (add.results && !add.results.length) box.append(h('div', { class: 'empty' }, h('b', { text: 'No results' }), 'Check the spelling, or add it by hand below.'));
    else if (add.results) box.append(h('div', { class: 'list' }, add.results.map(resultRow)));
    return;
  }
  if (add.trending && add.trending.length) box.append(h('h2', { text: 'Trending this week' }), h('div', { class: 'list' }, add.trending.slice(0, 10).map(resultRow)));
}
function runSearch() {
  clearTimeout(add.timer); const q = add.q.trim(); add.error = '';
  if (q.length < 2) { add.results = null; add.loading = false; drawResults(); return; }
  if (!T.hasKey()) { add.error = 'Search is not set up on this site yet. Add the title by hand below.'; drawResults(); return; }
  add.loading = true; drawResults(); const seq = ++add.seq;
  add.timer = setTimeout(async () => {
    try { const r = await T.search(q); if (seq !== add.seq) return; add.results = r; add.error = ''; }
    catch (e) { if (seq !== add.seq) return; add.results = null; add.error = e.message; }
    add.loading = false; drawResults();
  }, 350);
}
function viewAdd() {
  const input = h('input', { id: 'add-q', type: 'search', placeholder: 'Search films and series', value: add.q, 'aria-label': 'Search films and series', enterkeyhint: 'search', autocomplete: 'off' });
  input.addEventListener('input', () => { add.q = input.value; runSearch(); });
  const mt = h('input', { id: 'man-title', type: 'text', maxlength: '140', placeholder: 'Title' }), my = h('input', { id: 'man-year', type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'Year' }), mr = h('input', { id: 'man-run', type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'Minutes' });
  const mk = h('select', { id: 'man-kind' }, h('option', { value: 'movie', text: 'Film' }), h('option', { value: 'tv', text: 'Series' }));
  const manual = h('button', { class: 'btn', type: 'button', text: 'Add by hand' });
  manual.addEventListener('click', () => { const name = mt.value.trim(); if (!name) { mt.focus(); return; } const t = S.putTitle({ id: 'x' + S.uid(), type: mk.value, tmdbId: null, title: name.slice(0, 140), year: Number(my.value) || null, poster: '', runtime: Number(mr.value) > 0 ? Number(mr.value) : null, genres: [], overview: '', score: null }); S.save(); tagDialog(t, () => { location.hash = '#watchlist'; }); });
  view.append(h('div', { class: 'head' }, h('div', null, h('h1', { text: 'Add a title' }), h('p', { class: 'sub', text: 'Search TMDB, then tag what you add with a mood and an energy level so it can be found later.' }))),
    T.hasKey() ? null : h('div', { class: 'banner stack' }, h('b', { text: 'Search is not set up on this site yet' }), h('span', { text: 'Search and posters come from The Movie Database. The site owner connects it once in config.js and it works for everyone. Until then you can paste a key in Settings or add titles by hand.' }), h('div', { class: 'row' }, h('a', { class: 'btn primary small', href: '#settings', text: 'Open Settings' }))),
    input, h('div', { id: 'add-results', class: 'stack' }),
    h('details', { class: 'panel' }, h('summary', { text: 'Not on TMDB? Add it by hand' }), h('div', { class: 'stack', style: 'margin-top:12px' }, h('label', { for: 'man-title' }, 'Title', mt), h('div', { class: 'row' }, h('label', { for: 'man-kind', class: 'grow' }, 'Kind', mk), h('label', { for: 'man-year', class: 'grow' }, 'Year', my), h('label', { for: 'man-run', class: 'grow' }, 'Runtime', mr)), h('div', { class: 'row' }, manual))));
  drawResults();
  if (T.hasKey() && !add.trending) { add.trending = []; T.trending().then(r => { add.trending = r; drawResults(); }).catch(() => { }); }
}

/* ---------- diary ---------- */
function viewDiary() {
  const year = String(new Date().getFullYear()), entries = [...db.diary].sort((a, b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : 0));
  const thisYear = entries.filter(e => e.date.startsWith(year)), rated = entries.filter(e => e.rating);
  const minutes = thisYear.reduce((n, e) => n + (title(e.id).runtime || 0), 0);
  const counts = {}; entries.forEach(e => { counts[e.id] = (counts[e.id] || 0) + 1; });
  const rewatched = Object.entries(counts).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);
  view.append(h('div', { class: 'head' }, h('div', null, h('h1', { text: 'Watch diary' }), h('p', { class: 'sub', text: 'Everything you have logged, newest first.' })), h('a', { class: 'btn', href: '#add', text: 'Log something' })));
  if (!entries.length) { view.append(h('div', { class: 'empty' }, h('b', { text: 'No entries yet' }), 'Press Watched on a watchlist title, or use Add to log something you have already seen.')); return; }
  view.append(h('div', { class: 'stats' },
    h('div', { class: 'stat' }, h('b', { text: String(thisYear.length) }), h('span', { text: 'logged in ' + year })),
    h('div', { class: 'stat' }, h('b', { text: String(Math.round(minutes / 60)) }), h('span', { text: 'hours in ' + year + ' (a series entry counts one episode)' })),
    h('div', { class: 'stat' }, h('b', { text: rated.length ? (rated.reduce((n, e) => n + e.rating, 0) / rated.length).toFixed(1) : '0' }), h('span', { text: 'average rating out of 5' })),
    h('div', { class: 'stat' }, h('b', { text: String(entries.filter(e => e.rewatch).length) }), h('span', { text: 'rewatches' }))));
  if (rewatched.length) view.append(h('section', { class: 'panel stack' }, h('h2', { text: 'Most rewatched' }), h('div', { class: 'row' }, rewatched.map(([id, n]) => h('span', { class: 'tag', text: title(id).title + ' × ' + n })))));
  let month = '';
  const list = h('div', { class: 'list' });
  entries.forEach(e => {
    const t = title(e.id), m = e.date.slice(0, 7);
    if (m !== month) { month = m; const d = new Date(m + '-15T12:00:00'); list.append(h('div', { class: 'month', text: isNaN(d) ? m : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) })); }
    list.append(h('div', { class: 'item' }, posterEl(t, 'sm'), h('div', { class: 'grow' }, h('b', { text: t.title }), h('div', { class: 'meta', text: fmtDate(e.date) + (e.rewatch ? ' · rewatch' : '') }), e.note ? h('div', { class: 'note', text: e.note }) : null),
      h('span', { class: 'stars', text: stars(e.rating) }),
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', text: 'Edit', onclick: () => logDialog(e.id, e) }), h('button', { class: 'btn small danger', type: 'button', text: 'Delete', 'aria-label': 'Delete entry for ' + t.title, onclick: () => { S.deleteEntry(e.eid); toast('Entry deleted.'); render(); } }))));
  });
  view.append(list);
}

/* ---------- recommendation ledger ---------- */
let ledgerDir = 'in';
const HIT = 3.5;
function viewLedger() {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Direction' }, [['in', 'Recommended to me'], ['out', 'I recommended']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(ledgerDir === v), text: l, onclick: () => { ledgerDir = v; render(); } })));
  const rows = db.ledger.filter(l => l.dir === ledgerDir).sort((a, b) => a.date < b.date ? 1 : -1);
  view.append(h('div', { class: 'head' }, h('div', null, h('h1', { text: 'Recommendation ledger' }), h('p', { class: 'sub', text: ledgerDir === 'in' ? 'Who told you to watch what, and how it turned out. Fill in "Who recommended it?" when you add a title and it lands here.' : 'What you told other people to watch, and whether it landed.' })), seg));
  if (ledgerDir === 'out') view.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'Log a recommendation I made', onclick: outDialog })));
  if (!rows.length) { view.append(h('div', { class: 'empty' }, h('b', { text: 'Nothing in the ledger yet' }), ledgerDir === 'in' ? 'Add a title and name the person who recommended it.' : 'Log the next thing you tell someone to watch.')); return; }
  const by = {}; rows.forEach(l => { (by[l.person] = by[l.person] || []).push(l); });
  const table = h('table', null, h('thead', null, h('tr', null, h('th', { text: 'Person' }), h('th', { class: 'num', text: 'Recs' }), h('th', { class: 'num', text: ledgerDir === 'in' ? 'Watched' : 'Heard back' }), ledgerDir === 'in' ? h('th', { class: 'num', text: 'Avg rating' }) : null, h('th', { class: 'num', text: 'Hit rate' }))),
    h('tbody', null, Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([person, ls]) => {
      let done, hits, avg = '';
      if (ledgerDir === 'in') { const rs = ls.map(l => S.latestRating(l.id)).filter(Boolean); done = ls.filter(l => S.diaryFor(l.id).length).length; hits = rs.filter(r => r >= HIT).length; avg = rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(1) : ''; done = Math.max(done, rs.length); const base = rs.length; return h('tr', null, h('td', { text: person }), h('td', { class: 'num', text: String(ls.length) }), h('td', { class: 'num', text: String(done) }), h('td', { class: 'num', text: avg || 'n/a' }), h('td', { class: 'num', text: base ? Math.round(hits / base * 100) + '%' : 'n/a' })); }
      done = ls.filter(l => l.outcome === 'liked' || l.outcome === 'meh').length; hits = ls.filter(l => l.outcome === 'liked').length;
      return h('tr', null, h('td', { text: person }), h('td', { class: 'num', text: String(ls.length) }), h('td', { class: 'num', text: String(done) }), h('td', { class: 'num', text: done ? Math.round(hits / done * 100) + '%' : 'n/a' }));
    })));
  view.append(h('section', { class: 'panel scroll-x' }, table), ledgerDir === 'in' ? h('p', { class: 'fine', text: 'A hit is a recommendation you rated ' + HIT + ' or higher.' }) : null);
  view.append(h('div', { class: 'list' }, rows.map(l => {
    const t = title(l.id), r = S.latestRating(l.id), seen = S.diaryFor(l.id).length, listed = !!S.onList(l.id);
    let status, controls;
    if (ledgerDir === 'in') {
      status = seen ? h('span', { class: 'stars', text: stars(r) }) : h('span', { class: 'tag', text: listed ? 'On your watchlist' : 'Not watched' });
      controls = [(!seen && !listed) ? h('button', { class: 'btn small', type: 'button', text: 'Add to watchlist', onclick: () => tagDialog(t) }) : null, !seen ? h('button', { class: 'btn small', type: 'button', text: 'Watched', onclick: () => logDialog(l.id) }) : null];
    } else {
      const sel = h('select', { 'aria-label': 'How it went with ' + l.person, style: 'width:auto' }, [['', 'No word yet'], ['liked', 'They liked it'], ['meh', 'Not for them']].map(([v, x]) => h('option', { value: v, text: x, selected: l.outcome === v })));
      sel.addEventListener('change', () => { S.updateLedger(l.lid, { outcome: sel.value }); render(); });
      status = null; controls = [sel];
    }
    return h('div', { class: 'item' }, posterEl(t, 'sm'), h('div', { class: 'grow' }, h('b', { text: t.title }), h('div', { class: 'meta', text: (ledgerDir === 'in' ? 'From ' : 'To ') + l.person + ' · ' + fmtDate(l.date) }), l.note ? h('div', { class: 'note', text: l.note }) : null), status,
      h('div', { class: 'row' }, controls, h('button', { class: 'btn small danger', type: 'button', text: 'Delete', 'aria-label': 'Delete ledger entry for ' + t.title, onclick: () => { S.deleteLedger(l.lid); render(); } })));
  })));
}
function outDialog() {
  const known = Object.values(db.titles).sort((a, b) => a.title.localeCompare(b.title));
  if (!known.length) { openDialog('Log a recommendation', h('p', { text: 'Add or log at least one title first, then you can record recommending it.' }), h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#add', text: 'Add a title', onclick: closeDialog }))); return; }
  const sel = h('select', { id: 'out-title' }, known.map(t => h('option', { value: t.id, text: t.title + (t.year ? ' (' + t.year + ')' : '') })));
  const person = h('input', { id: 'out-person', type: 'text', maxlength: '40', list: 'people-list2', autocomplete: 'off', autocapitalize: 'words', placeholder: 'Their name' });
  const note = h('textarea', { id: 'out-note', maxlength: '300', placeholder: 'Why you thought of them' });
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Save' });
  btn.addEventListener('click', () => { if (!person.value.trim()) { person.focus(); return; } S.addLedger({ dir: 'out', person: person.value, id: sel.value, note: note.value }); closeDialog(); render(); });
  openDialog('Log a recommendation', h('label', { for: 'out-title' }, 'Title', sel), h('label', { for: 'out-person' }, 'Who did you recommend it to?', person, h('datalist', { id: 'people-list2' }, S.people().map(p => h('option', { value: p })))), h('label', { for: 'out-note' }, 'Note', note), h('div', { class: 'row' }, btn));
}

/* ---------- rooms ---------- */
function viewRooms() {
  view.append(h('div', { class: 'head' }, h('div', null, h('h1', { text: 'Rooms' }), h('p', { class: 'sub', text: 'A room is a stack of titles that two or more people swipe on. Whatever nobody rejects is a match. Swipe together on one phone, or send the room as a link.' })),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'New room', onclick: newRoomDialog }), h('button', { class: 'btn', type: 'button', text: 'Open a room link', onclick: joinDialog }))));
  if (!db.rooms.length) { view.append(h('div', { class: 'empty' }, h('b', { text: 'No rooms yet' }), 'Make one from your watchlist, swipe, then hand over the phone or send the link.')); return; }
  view.append(h('div', { class: 'list' }, db.rooms.map(r => {
    const members = Object.keys(r.votes), matches = S.tally(r).filter(x => x.match).length;
    return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: r.name }), h('div', { class: 'meta', text: r.deck.length + ' titles · ' + (members.length ? members.join(', ') : 'nobody has swiped yet') + ' · ' + matches + (matches === 1 ? ' match' : ' matches') })),
      h('a', { class: 'btn small primary', href: '#room/' + r.rid, text: 'Open' }));
  })));
}
function newRoomDialog() {
  const name = h('input', { id: 'room-name', type: 'text', maxlength: '60', placeholder: 'Friday night', value: '' });
  const me = h('input', { id: 'room-me', type: 'text', maxlength: '30', value: db.settings.name, autocomplete: 'given-name', autocapitalize: 'words', placeholder: 'Your first name' });
  const src = h('select', { id: 'room-src' }, h('option', { value: 'list', text: 'My watchlist (' + db.watchlist.length + ' titles)' }), h('option', { value: 'trend', text: 'Trending this week on TMDB' }));
  const size = h('select', { id: 'room-size' }, [['10', '10 titles'], ['20', '20 titles'], ['30', '30 titles'], ['999', 'All of them']].map(([v, l]) => h('option', { value: v, text: l, selected: v === '20' })));
  const err = h('p', { class: 'banner', hidden: true });
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Create room' });
  btn.addEventListener('click', async () => {
    err.hidden = true; if (!me.value.trim()) { me.focus(); return; }
    let ids = [];
    if (src.value === 'list') { ids = db.watchlist.map(w => w.id); if (!ids.length) { err.textContent = 'Your watchlist is empty. Add a few titles first, or use the trending list.'; err.hidden = false; return; } }
    else { btn.disabled = true; try { const ts = await T.trending(); ts.forEach(t => S.putTitle(t, true)); ids = ts.map(t => t.id); } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; return; } }
    ids = ids.sort(() => Math.random() - .5).slice(0, Number(size.value));
    db.settings.name = me.value.trim().slice(0, 30);
    const r = S.createRoom(name.value.trim() || 'Our room', ids); closeDialog(); location.hash = '#room/' + r.rid;
  });
  openDialog('New room', h('label', { for: 'room-name' }, 'Room name', name), h('label', { for: 'room-me' }, 'Your name', me), h('label', { for: 'room-src' }, 'Fill the stack from', src), h('label', { for: 'room-size' }, 'How many', size), err, h('div', { class: 'row' }, btn));
}
function joinDialog() {
  const ta = h('textarea', { id: 'join-code', class: 'share', placeholder: 'Paste the room link here', 'aria-label': 'Room link' });
  const err = h('p', { class: 'banner', hidden: true });
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'Open room' });
  btn.addEventListener('click', () => { try { const { room } = Share.apply(Share.unpack(ta.value)); closeDialog(); toast('Room updated: ' + room.name); if (location.hash === '#room/' + room.rid) render(); else location.hash = '#room/' + room.rid; } catch (e) { err.textContent = e.message; err.hidden = false; } });
  openDialog('Open a room link', h('p', { class: 'sub', text: 'Paste a link someone sent you. If you already have the room, their votes and titles are merged into it.' }), ta, err, h('div', { class: 'row' }, btn));
}
function shareDialog(r) {
  const link = Share.linkFor(r);
  const ta = h('textarea', { class: 'share', readonly: true, 'aria-label': 'Room link', value: link }); ta.addEventListener('focus', () => ta.select());
  const copy = h('button', { class: 'btn primary', type: 'button', text: 'Copy link', onclick: async () => { if (!(await copyText(link))) { ta.focus(); ta.select(); toast('Select the link and copy it.'); } } });
  const share = navigator.share ? h('button', { class: 'btn', type: 'button', text: 'Share…', onclick: () => { navigator.share({ title: r.name, text: 'Swipe on our watch room: ' + r.name, url: link }).catch(() => { }); } }) : null;
  openDialog('Send this room', h('p', { class: 'sub', text: 'The link holds the titles and every vote made so far. The other person opens it, swipes, and sends their link back. Open their link here to see the matches.' }), ta, h('div', { class: 'row' }, copy, share));
}
function viewRoom(rid) {
  const r = S.room(rid);
  if (!r) { view.append(h('div', { class: 'empty' }, h('b', { text: 'That room is not on this device' }), 'Open the room link again, or go back to your rooms.', h('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, h('a', { class: 'btn', href: '#rooms', text: 'All rooms' })))); return; }
  const me = db.settings.name, members = Object.keys(r.votes), tally = S.tally(r), matches = tally.filter(x => x.match), split = tally.filter(x => !x.match && x.voters >= 2);
  const mine = me ? S.pendingFor(r, me).length : r.deck.length;
  const goSwipe = member => { location.hash = '#swipe/' + r.rid + '/' + encodeURIComponent(member); };
  const pass = () => { const input = h('input', { id: 'pass-name', type: 'text', maxlength: '30', autocapitalize: 'words', autocomplete: 'off', placeholder: 'Their first name' }); const go = () => { const n = input.value.trim().slice(0, 30); if (!n) { input.focus(); return; } closeDialog(); goSwipe(n); }; input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); openDialog('Pass the phone', h('label', { for: 'pass-name' }, 'Who is swiping now?', input), h('p', { class: 'fine', text: 'They swipe on this device. No peeking at each other\'s picks until both are done.' }), h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'Start', onclick: go }))); };
  const addTitle = () => { const options = db.watchlist.filter(w => !r.deck.includes(w.id)); if (!options.length) { openDialog('Add a title to this room', h('p', { text: 'Everything on your watchlist is already in this room. Add more titles to your watchlist first.' })); return; } const sel = h('select', { id: 'room-add' }, options.map(w => h('option', { value: w.id, text: title(w.id).title }))); openDialog('Add a title to this room', h('label', { for: 'room-add' }, 'From your watchlist', sel), h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'Add to the stack', onclick: () => { S.addToRoom(r.rid, sel.value); closeDialog(); toast('Added. Share the link again so others get it.'); render(); } }))); };
  view.append(h('div', { class: 'head' }, h('div', null, h('a', { class: 'fine', href: '#rooms', text: '← All rooms' }), h('h1', { text: r.name }), h('p', { class: 'sub', text: r.deck.length + ' titles in the stack.' })),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: mine ? (me ? 'Swipe my picks (' + mine + ' left)' : 'Swipe my picks') : 'My picks are done', disabled: !mine && !!me, onclick: () => me ? goSwipe(me) : askName(goSwipe) }), h('button', { class: 'btn', type: 'button', text: 'Pass the phone', onclick: pass }), h('button', { class: 'btn', type: 'button', text: 'Send room link', onclick: () => shareDialog(r) }))));
  view.append(h('section', { class: 'panel stack' }, h('h2', { text: 'Who has swiped' }),
    members.length ? h('div', { class: 'list' }, members.map(m => { const done = r.deck.length - S.pendingFor(r, m).length; return h('div', { class: 'row' }, h('b', { text: m + (m === me ? ' (you)' : '') }), h('div', { class: 'grow progress', role: 'progressbar', 'aria-valuenow': String(done), 'aria-valuemin': '0', 'aria-valuemax': String(r.deck.length), 'aria-label': m + ' progress' }, h('i', { style: 'width:' + (r.deck.length ? done / r.deck.length * 100 : 0) + '%' })), h('span', { class: 'meta', text: done + ' of ' + r.deck.length })); })) : h('p', { class: 'sub', text: 'Nobody yet. Start with your own picks.' }),
    h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', text: 'Add a title to this room', onclick: addTitle }), h('button', { class: 'btn small', type: 'button', text: 'Open a link someone sent back', onclick: joinDialog }), h('button', { class: 'btn small danger', type: 'button', text: 'Delete room', onclick: () => { S.deleteRoom(r.rid); location.hash = '#rooms'; } }))));
  view.append(h('h2', { text: matches.length ? 'Matches (' + matches.length + ')' : 'Matches' }));
  if (!matches.length) view.append(h('div', { class: 'empty' }, h('b', { text: members.length < 2 ? 'Waiting for a second person' : 'No match yet' }), members.length < 2 ? 'A match needs at least two people. Pass the phone, or send the link and open the one they send back.' : 'Nothing has a yes from everyone so far. Add a few more titles to the stack.'));
  else view.append(h('div', { class: 'grid' }, matches.map(x => { const t = title(x.id), listed = !!S.onList(x.id); return h('article', { class: 'card' }, posterEl(t), h('div', { class: 'info' }, h('h3', { text: t.title }), h('div', { class: 'meta', text: metaLine(t) }), h('div', { class: 'row' }, h('span', { class: 'tag gold', text: 'Yes from all ' + x.voters })), h('div', { class: 'actions' }, h('button', { class: 'btn small primary', type: 'button', text: 'We watched it', onclick: () => logDialog(x.id) }), listed ? null : h('button', { class: 'btn small', type: 'button', text: 'Add to my watchlist', onclick: () => tagDialog(t) })))); })));
  if (split.length) view.append(h('section', { class: 'panel stack' }, h('h2', { text: 'Not everyone agreed' }), h('div', { class: 'scroll-x' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: 'Title' }), h('th', { class: 'num', text: 'Said yes' }))), h('tbody', null, split.sort((a, b) => b.yes - a.yes).map(x => h('tr', null, h('td', { text: title(x.id).title }), h('td', { class: 'num', text: x.yes + ' of ' + x.voters }))))))));
}

/* ---------- swipe ---------- */
let swipeKeys = null;
function viewSwipe(rid, member) {
  const r = S.room(rid); if (!r || !member) { location.hash = '#rooms'; return; }
  const history = [], isMe = member === db.settings.name;
  const wrap = h('div', { class: 'stack' }); view.append(wrap);
  const draw = () => {
    const pending = S.pendingFor(r, member), done = r.deck.length - pending.length;
    wrap.textContent = '';
    wrap.append(h('div', { class: 'head' }, h('div', null, h('a', { class: 'fine', href: '#room/' + r.rid, text: '← ' + r.name }), h('h1', { text: member + '\'s picks' }), h('p', { class: 'sub', text: pending.length ? done + ' of ' + r.deck.length + ' done. Right for yes, left for no.' : 'All ' + r.deck.length + ' done.' }))),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(done), 'aria-valuemin': '0', 'aria-valuemax': String(r.deck.length), 'aria-label': 'Swipe progress' }, h('i', { style: 'width:' + (r.deck.length ? done / r.deck.length * 100 : 0) + '%' })));
    if (!pending.length) {
      const m = S.tally(r).filter(x => x.match).length;
      wrap.append(h('div', { class: 'empty' }, h('b', { text: 'That is the whole stack' }), isMe ? 'Send the room link so the other person can swipe, or pass them the phone.' : 'Hand the phone back.', h('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, isMe ? h('button', { class: 'btn primary', type: 'button', text: 'Send room link', onclick: () => shareDialog(r) }) : null, h('a', { class: 'btn' + (isMe ? '' : ' primary'), href: '#room/' + r.rid, text: 'See matches (' + m + ')' }))));
      return;
    }
    const t = title(pending[0]), next = pending[1] ? title(pending[1]) : null;
    const art = t0 => { const url = T.poster(t0.poster, 'w500'); if (!url) return h('div', { class: 'art', text: t0.title.charAt(0).toUpperCase() }); const img = h('img', { class: 'art', src: url, alt: 'Poster for ' + t0.title, draggable: 'false' }); img.addEventListener('error', () => img.replaceWith(h('div', { class: 'art', text: t0.title.charAt(0).toUpperCase() }))); return img; };
    const make = (t0, top) => h('div', { class: 'swipe-card' + (top ? '' : ' under'), style: top ? '' : 'transform:scale(.95) translateY(10px);opacity:.7' }, art(t0), top ? h('span', { class: 'stamp yes', text: 'YES' }) : null, top ? h('span', { class: 'stamp no', text: 'NO' }) : null, h('div', { class: 'cap' }, h('h3', { text: t0.title }), h('div', { class: 'meta', text: metaLine(t0) })));
    const card = make(t, true), deck = h('div', { class: 'deck' }, next ? make(next, false) : null, card);
    const decide = yes => { card.classList.add('settle'); card.style.transform = 'translate(' + (yes ? 520 : -520) + 'px,40px) rotate(' + (yes ? 24 : -24) + 'deg)'; card.style.opacity = '0'; S.vote(r.rid, member, t.id, yes); history.push(t.id); setTimeout(draw, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 230); };
    let sx = 0, sy = 0, dx = 0, id = null;
    card.addEventListener('pointerdown', e => { if (id !== null) return; id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; card.classList.remove('settle'); card.classList.add('dragging'); try { card.setPointerCapture(id); } catch (_) { } });
    card.addEventListener('pointermove', e => { if (e.pointerId !== id) return; dx = e.clientX - sx; const dy = (e.clientY - sy) * .25; card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + dx * .06 + 'deg)'; card.querySelector('.stamp.yes').style.opacity = String(Math.max(0, Math.min(1, dx / 90))); card.querySelector('.stamp.no').style.opacity = String(Math.max(0, Math.min(1, -dx / 90))); });
    const end = e => { if (e.pointerId !== id) return; id = null; card.classList.remove('dragging'); if (Math.abs(dx) > 96 && e.type === 'pointerup') { decide(dx > 0); return; } card.classList.add('settle'); card.style.transform = ''; card.querySelectorAll('.stamp').forEach(s => { s.style.opacity = '0'; }); };
    card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
    const undo = () => { const last = history.pop(); if (last) { S.unvote(r.rid, member, last); r.deck.splice(r.deck.indexOf(last), 1); r.deck.unshift(last); S.save(); draw(); } };
    swipeKeys = e => { if (dlg.open) return; if (e.key === 'ArrowRight') decide(true); else if (e.key === 'ArrowLeft') decide(false); else if (e.key === 'Backspace' || e.key === 'z') undo(); };
    wrap.append(deck, h('div', { class: 'swipe-actions' }, h('button', { class: 'round no', type: 'button', 'aria-label': 'No to ' + t.title, text: '✕', onclick: () => decide(false) }), h('button', { class: 'round undo', type: 'button', 'aria-label': 'Undo last swipe', text: '↺', disabled: !history.length, onclick: undo }), h('button', { class: 'round yes', type: 'button', 'aria-label': 'Yes to ' + t.title, text: '♥', onclick: () => decide(true) })),
      t.overview ? h('p', { class: 'sub', style: 'margin:6px auto 0;text-align:center', text: t.overview.length > 220 ? t.overview.slice(0, 217) + '…' : t.overview }) : null);
  };
  draw();
}
window.addEventListener('keydown', e => { if (swipeKeys && location.hash.startsWith('#swipe/') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) swipeKeys(e); });

/* ---------- settings ---------- */
function ownerSection() {
  if (!Cloud.available()) return null;
  if (Cloud.isOwner()) {
    return h('section', { class: 'panel stack' }, h('h2', { text: 'Owner mode is on' }), h('p', { class: 'sub', text: 'This device publishes your list. Friends see your list, tags, notes and ratings on the Picks page. Your ledger and rooms stay private.' }),
      h('p', { class: 'fine', id: 'pub-state', role: 'status', text: pubState || (db.sync.at ? 'Last published ' + new Date(db.sync.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : 'Not published yet.') }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'Publish now', onclick: async () => { if (await doPublish()) toast('Published.'); } }), h('button', { class: 'btn', type: 'button', text: 'Turn off on this device', onclick: () => { db.settings.ownerKey = ''; S.saveQuiet(); render(); } })));
  }
  const pw = h('input', { id: 'own-key', type: 'password', autocomplete: 'current-password', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: 'Owner passphrase' });
  const msg = h('p', { class: 'fine', role: 'status' });
  const btn = h('button', { class: 'btn', type: 'button', text: 'Unlock owner mode' });
  const unlock = async () => {
    const key = pw.value; if (!key) { pw.focus(); return; } btn.disabled = true; msg.textContent = 'Checking…';
    try {
      await Cloud.checkOwner(key); const v = await Cloud.getVault(key); const local = db.watchlist.length + db.diary.length;
      const finish = () => { closeDialog(); toast('Owner mode is on.'); render(); };
      if (v && local) {
        btn.disabled = false; msg.textContent = '';
        openDialog('Which list should win?', h('p', { text: 'There is already a list saved online, and this device has its own. Choose which one to keep. The other is replaced.' }),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'Use the list saved online', onclick: () => { db.settings.ownerKey = key; adoptVault(v); finish(); } }), h('button', { class: 'btn', type: 'button', text: 'Publish this device\'s list', onclick: async () => { db.settings.ownerKey = key; S.saveQuiet(); await doPublish(); finish(); } })));
        return;
      }
      db.settings.ownerKey = key; S.saveQuiet();
      if (v) adoptVault(v); else await doPublish();
      finish();
    } catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
  btn.addEventListener('click', unlock); pw.addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
  return h('details', { class: 'panel' }, h('summary', { text: 'Site owner' }), h('div', { class: 'stack', style: 'margin-top:12px' }, h('p', { class: 'sub', text: 'If this is your site, enter your owner passphrase. This device can then change the list everyone sees.' }), h('label', { for: 'own-key' }, 'Owner passphrase', pw), h('div', { class: 'row' }, btn), msg));
}
function viewSettings() {
  const built = T.builtIn();
  const name = h('input', { id: 'set-name', type: 'text', maxlength: '30', value: db.settings.name, autocomplete: 'given-name', autocapitalize: 'words', placeholder: 'Your first name' });
  name.addEventListener('change', () => { db.settings.name = name.value.trim().slice(0, 30); S.save(); toast('Name saved.'); });
  const key = h('input', { id: 'set-key', type: 'password', value: db.settings.apiKey, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: built ? 'A key is already built into this site' : 'Paste your TMDB API key or read access token' });
  const status = h('p', { class: 'fine', role: 'status', text: db.settings.apiKey ? 'A key is saved in this browser.' : (built ? 'This site was deployed with a key, so search already works. A key you paste here is used instead.' : 'No key yet.') });
  const saveKey = h('button', { class: 'btn primary', type: 'button', text: 'Save and test key' });
  saveKey.addEventListener('click', async () => {
    const v = key.value.trim(); saveKey.disabled = true; status.textContent = 'Checking with TMDB…';
    try { if (v) await T.testKey(v); db.settings.apiKey = v; S.save(); add.trending = null; add.error = ''; status.textContent = v ? 'TMDB accepted the key. It is saved in this browser only.' : (built ? 'Using the key built into this site.' : 'Key removed.'); }
    catch (e) { status.textContent = e.message + ' The key was not saved.'; }
    saveKey.disabled = false;
  });
  const file = h('input', { id: 'set-file', type: 'file', accept: 'application/json,.json', 'aria-label': 'Backup file to restore' });
  file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (!d || !Array.isArray(d.watchlist) || !Array.isArray(d.diary)) throw new Error('bad'); const keep = { apiKey: db.settings.apiKey, ownerKey: db.settings.ownerKey }; S.replaceAll(d); Object.assign(db.settings, keep); S.save(); toast('Backup restored.'); render(); } catch (e) { toast('That file is not a Reel Room backup.'); } file.value = ''; });
  const exportBtn = h('button', { class: 'btn', type: 'button', text: 'Download a backup', onclick: () => { const copy = JSON.parse(JSON.stringify(db)); copy.settings.apiKey = ''; copy.settings.ownerKey = ''; delete copy.sync; const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(copy, null, 1)], { type: 'application/json' })), download: 'reel-room-backup-' + S.today() + '.json' }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); } });
  const erase = h('button', { class: 'btn danger', type: 'button', text: 'Erase everything', onclick: () => { openDialog('Erase everything?', h('p', { text: 'This removes your watchlist, diary, ledger, rooms and saved key from this browser. It cannot be undone. Download a backup first if you might want it back.' }), h('div', { class: 'row' }, h('button', { class: 'btn danger', type: 'button', text: 'Yes, erase it all', onclick: () => { S.eraseAll(); closeDialog(); toast('Everything erased.'); render(); } }), h('button', { class: 'btn', type: 'button', text: 'Keep my data', onclick: closeDialog }))); } });
  const logo = h('img', { class: 'tmdb-logo', src: 'assets/tmdb-logo.svg', alt: 'TMDB logo' }); logo.addEventListener('error', () => logo.remove());
  view.append(h('div', { class: 'head' }, h('div', null, h('h1', { text: 'Settings' }))),
    S.storageOk ? null : h('p', { class: 'banner', text: 'This browser is blocking storage, so nothing you add will be kept after you close the tab. Private browsing mode often causes this.' }),
    h('section', { class: 'panel stack' }, h('h2', { text: 'You' }), h('label', { for: 'set-name' }, 'Your name in rooms', name)),
    // When the site ships with a key in config.js, visitors never see a key field.
    built ? null : h('section', { class: 'panel stack' }, h('h2', { text: 'TMDB key' }), h('p', { class: 'sub' }, 'Search, posters and runtimes come from The Movie Database. This copy of the site has no key yet. The owner can connect the search proxy in config.js so nobody has to enter a key; until then you can paste your own here. ', h('a', { href: 'https://www.themoviedb.org/settings/api', target: '_blank', rel: 'noopener', text: 'Get a key at themoviedb.org' })), h('label', { for: 'set-key' }, 'API key or read access token', key), h('div', { class: 'row' }, saveKey), status),
    ownerSection(),
    h('section', { class: 'panel stack' }, h('h2', { text: 'Your data' }), h('p', { class: 'sub', text: 'Everything is stored in this browser on this device, not on a server. Clearing site data deletes it, so download a backup now and then. A backup also moves your data to another device.' }), h('div', { class: 'row' }, exportBtn, erase), h('label', { for: 'set-file' }, 'Restore from a backup file (replaces what is here)', file)),
    h('section', { class: 'panel stack' }, h('h2', { text: 'About' }), h('div', { class: 'row' }, logo, h('p', { class: 'grow', text: 'This product uses the TMDB API but is not endorsed or certified by TMDB.' })), h('p', { class: 'fine' }, 'Film and series data and images are provided by ', h('a', { href: 'https://www.themoviedb.org/', target: '_blank', rel: 'noopener', text: 'The Movie Database (TMDB)' }), '. Reel Room is a personal, non-commercial project.')));
}

/* ---------- router ---------- */
const ROUTES = { picks: viewPicks, watchlist: viewWatchlist, add: viewAdd, diary: viewDiary, ledger: viewLedger, rooms: viewRooms, settings: viewSettings };
function render() {
  // Visitors land on the owner's picks. The owner lands on their own list.
  const home = (Cloud.available() && !Cloud.isOwner()) ? '#picks' : '#watchlist';
  const hash = (location.hash && location.hash !== '#') ? location.hash : home;
  const picksTab = document.querySelector('.tabs a[data-tab="picks"]'); if (picksTab) picksTab.hidden = !Cloud.available();
  if (hash.startsWith('#join=')) {
    try { const { room, created } = Share.apply(Share.unpack(hash)); history.replaceState(null, '', '#room/' + room.rid); toast(created ? 'Room added: ' + room.name : 'Room updated with new votes.'); }
    catch (e) { history.replaceState(null, '', '#rooms'); toast(e.message); }
    return render();
  }
  const [route, a, b] = hash.slice(1).split('/');
  swipeKeys = null; view.textContent = '';
  let tab = route;
  if (route === 'room') { viewRoom(a); tab = 'rooms'; }
  else if (route === 'swipe') { let m = ''; try { m = decodeURIComponent(b || ''); } catch (e) { } viewSwipe(a, m.slice(0, 30)); tab = 'rooms'; }
  else { if (!ROUTES[route] || (route === 'picks' && !Cloud.available())) tab = home.slice(1); ROUTES[tab](); }
  document.querySelectorAll('.tabs a').forEach(el => { if (el.dataset.tab === tab) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  document.title = ({ picks: 'Picks', watchlist: 'My list', add: 'Add', diary: 'Diary', ledger: 'Ledger', rooms: 'Rooms', settings: 'Settings' })[tab] + ' · Reel Room';
}
window.addEventListener('hashchange', () => { closeDialog(); render(); window.scrollTo(0, 0); });
render();
ownerPull();
