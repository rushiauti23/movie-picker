// Thin client for The Movie Database (TMDB) API v3.
import { db } from './store.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

export const apiKey = () => (db.settings.apiKey || (window.REELROOM_CONFIG && window.REELROOM_CONFIG.tmdbKey) || '').trim();
export const hasKey = () => apiKey().length > 0;

// Poster paths come from TMDB or from a shared link, so only well-formed ones are turned into URLs.
export const poster = (path, size = 'w342') => (typeof path === 'string' && /^\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/.test(path)) ? IMG + size + path : '';

export class TmdbError extends Error {}

async function get(path, params = {}, keyOverride) {
  const key = (keyOverride != null ? keyOverride : apiKey()).trim();
  if (!key) throw new TmdbError('No TMDB key yet. Add one in Settings.');
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const opts = { headers: { accept: 'application/json' } };
  // The long token (a JWT) goes in a header; the short key goes in the query string.
  if (key.startsWith('eyJ')) opts.headers.Authorization = 'Bearer ' + key; else url.searchParams.set('api_key', key);
  let res;
  try { res = await fetch(url, opts); } catch (e) { throw new TmdbError('Could not reach TMDB. Check your connection.'); }
  if (res.status === 401) throw new TmdbError('TMDB did not accept that key. Check it in Settings.');
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
