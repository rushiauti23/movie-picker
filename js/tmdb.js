// Thin client for The Movie Database (TMDB) API v3.
import { db } from './store.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

const cfg = () => window.REELROOM_CONFIG || {};
// Preferred setup: a proxy (see worker/) that holds the key, so the browser never sees one.
export const proxyUrl = () => String(cfg().proxyUrl || '').trim().replace(/\/+$/, '');
// Otherwise a key from config.js, or as a last resort one typed into Settings.
export const apiKey = () => (cfg().tmdbKey || db.settings.apiKey || '').trim();
export const builtIn = () => !!(proxyUrl() || String(cfg().tmdbKey || '').trim());
export const hasKey = () => !!proxyUrl() || apiKey().length > 0;

// Poster paths come from TMDB or from a shared link, so only well-formed ones are turned into URLs.
export const poster = (path, size = 'w342') => (typeof path === 'string' && /^\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/.test(path)) ? IMG + size + path : '';

export class TmdbError extends Error {}

async function get(path, params = {}, keyOverride) {
  const proxy = keyOverride == null ? proxyUrl() : '';
  const key = proxy ? '' : (keyOverride != null ? keyOverride : apiKey()).trim();
  if (!proxy && !key) throw new TmdbError('Search is not set up on this site yet.');
  const url = new URL((proxy || API) + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const opts = { headers: { accept: 'application/json' } };
  // With a proxy no key leaves the browser. Without one, the long token (a JWT) goes in a header and the short key in the query string.
  if (key) { if (key.startsWith('eyJ')) opts.headers.Authorization = 'Bearer ' + key; else url.searchParams.set('api_key', key); }
  let res;
  try { res = await fetch(url, opts); } catch (e) { throw new TmdbError('Could not reach TMDB. Check your connection.'); }
  if (res.status === 403 && proxy) throw new TmdbError('The search proxy refused this site. Its ALLOWED_ORIGINS setting needs this site\'s address.');
  if (res.status === 401) throw new TmdbError(proxy ? 'TMDB did not accept the key stored in the search proxy.' : 'TMDB did not accept that key.');
  if (res.status >= 500 && proxy) throw new TmdbError('The search proxy is not set up correctly yet (' + res.status + ').');
  if (res.status === 429) throw new TmdbError('TMDB is asking us to slow down. Try again in a moment.');
  if (!res.ok) throw new TmdbError('TMDB returned an error (' + res.status + ').');
  return res.json();
}

const year = s => (typeof s === 'string' && s.length >= 4) ? Number(s.slice(0, 4)) : null;

// Turn a TMDB movie or TV object (search result or full details) into our title record.
export function toTitle(x, type) {
  type = type || x.media_type;
  const tv = type === 'tv';
  let runtime = null;
  if (tv) runtime = (x.episode_run_time && x.episode_run_time[0]) || (x.last_episode_to_air && x.last_episode_to_air.runtime) || null;
  else runtime = x.runtime || null;
  return {
    id: (tv ? 't' : 'm') + x.id, type: tv ? 'tv' : 'movie', tmdbId: x.id,
    title: (tv ? x.name : x.title) || 'Untitled',
    year: year(tv ? x.first_air_date : x.release_date),
    poster: x.poster_path || '', runtime,
    genres: Array.isArray(x.genres) ? x.genres.map(g => g.name) : [],
    overview: x.overview || '', score: x.vote_average ? Math.round(x.vote_average * 10) / 10 : null,
    seasons: tv ? (x.number_of_seasons || null) : null
  };
}

export async function search(query) {
  const data = await get('/search/multi', { query, include_adult: 'false', page: '1' });
  return (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').map(r => toTitle(r));
}
export async function details(type, tmdbId) {
  return toTitle(await get('/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId), type);
}
export async function trending() {
  const data = await get('/trending/all/week');
  return (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').map(r => toTitle(r));
}
export async function testKey(key) { await get('/configuration', {}, key); return true; }
