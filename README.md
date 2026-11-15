# Reel Room

A personal watchlist that runs entirely in the browser. No server, no build step, no account.

- **Watchlist** with mood and energy tags, and a "what fits tonight" filter by time, mood, energy and kind
- **Watch diary** with ratings, notes and rewatch tracking
- **Recommendation ledger**: who recommended what to you (and what you recommended), with a hit rate per person
- **Rooms**: a stack of titles that two or more people swipe on. Whatever nobody rejects is a match
- **Backup**: download and restore everything as one JSON file

## Deploy on GitHub Pages

1. Create a new repository on GitHub (public, any name, for example `reel-room`).
2. Upload everything in this folder to the repository root, including `.nojekyll`.
   ```bash
   git init
   git add .
   git commit -m "Reel Room"
   git branch -M main
   git remote add origin https://github.com/<your-username>/reel-room.git
   git push -u origin main
   ```
3. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
4. After a minute the site is live at `https://<your-username>.github.io/reel-room/`.

## Set up TMDB (one time)

1. Create a free account at <https://www.themoviedb.org/> and request an API key under **Settings → API**. Choose the developer (non-commercial) option.
2. Open your deployed site, go to **Settings**, paste the key and press **Save and test key**. Either the short "API Key" or the long "API Read Access Token" works.

The key you paste is stored only in that browser. If you want search to work for anyone who opens your site without entering a key, put the key in `config.js` instead. Anything in `config.js` is public once pushed, so only do that if you are comfortable with the key being visible. You can regenerate a key in your TMDB settings at any time.

### Attribution (required by TMDB)

TMDB's terms ask for their logo and a notice. The notice is already on the Settings page. For the logo:

1. Download an official logo from <https://www.themoviedb.org/about/logos-attribution>.
2. Save it as `assets/tmdb-logo.svg`. The Settings page shows it automatically.

Keep the site non-commercial (no ads, no paid features), which is what the free TMDB key allows.

## How rooms work without a server

GitHub Pages only serves files, so two phones cannot talk to each other directly. A room is shared as a link:

1. Create a room, swipe your picks, press **Send room link**.
2. The other person opens the link, swipes, and sends their link back.
3. Open their link. Their votes merge into your room and the matches appear.

The link carries the titles and every vote so far. Or use **Pass the phone** to swipe on one device.

## Where your data lives

Everything is saved in the browser's local storage on that device. It does not sync between devices, and clearing site data deletes it. Use **Settings → Download a backup** regularly, and **Restore** to move to another device.

## Run it locally

Browsers block JavaScript modules on `file://` pages, so serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell and navigation |
| `css/app.css` | All styling, light and dark |
| `js/app.js` | Views and interactions |
| `js/store.js` | Data model and local storage |
| `js/tmdb.js` | TMDB API client |
| `js/share.js` | Room links: encode, validate, merge |
| `config.js` | Optional built-in TMDB key |

## Not in this version

New season alerts, "because you loved X", the world map, a yearly wrapped card, spoiler shield, and IMDb/Letterboxd import. The diary, ledger and room tables are what those would read from.

---

This product uses the TMDB API but is not endorsed or certified by TMDB.
