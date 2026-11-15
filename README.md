# Reel Room

A personal watchlist that runs entirely in the browser. No server, no build step, no account.

- **Picks**: the first thing visitors see. Your list, with your mood and energy tags, notes and ratings, filterable by time, mood and energy
- **My list** for each visitor: their own watchlist, with one tap to add any of your picks
- **Watch diary** with ratings, notes and rewatch tracking
- **Recommendation ledger**: who recommended what, with a hit rate per person
- **Rooms**: a stack of titles that two or more people swipe on. Whatever nobody rejects is a match

## How the shared list works

The site has one owner (you) and any number of visitors.

- **You** unlock owner mode once per device: **Settings → Site owner**, enter your owner passphrase. From then on, anything you add, tag, log or rate is published automatically a moment later, and your other devices pick it up the next time they open the site.
- **Visitors** open the site and land on your Picks. They cannot change your list. Anything they add goes to their own list in their own browser.
- **Published**: your list, tags, notes, ratings and diary notes. **Never published**: your ledger (the names of people) and your rooms.

If you edit on two devices at the same moment, the most recent change wins.

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

## Set up the Worker (one time)

The site talks to a small Cloudflare Worker. It holds your TMDB key as a secret and stores your published list, so neither is in this repository.

1. Create a free account at <https://www.themoviedb.org/> and request an API key under **Settings → API**. Choose the developer (non-commercial) option.
2. Deploy the Worker in `worker/`, with its storage, your TMDB key and an owner passphrase. Step-by-step instructions are in [`worker/README.md`](worker/README.md).
3. Put the Worker's address in `config.js`:
   ```js
   window.REELROOM_CONFIG = {
     proxyUrl: "https://reelroom-tmdb.your-subdomain.workers.dev",
     tmdbKey: ""
   };
   ```
4. Commit and push.
5. Open the site, go to **Settings → Site owner**, and enter your passphrase. If you already added titles on that device, they are published at that moment.

GitHub Pages serves the `worker/` folder as plain text along with the rest of the site. That is harmless: it contains no key or passphrase.

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

## Where data lives

- **Your list (owner)**: in the Worker's storage, and in the browser of each device where owner mode is on.
- **A visitor's own list, diary, ledger and rooms**: only in that visitor's browser. Clearing site data deletes it. **Settings → Download a backup** saves it to a file.

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
| `js/cloud.js` | Reading and publishing the shared list |
| `config.js` | The Worker's address |
| `worker/` | The Cloudflare Worker: TMDB key and list storage |

## Not in this version

New season alerts, "because you loved X", the world map, a yearly wrapped card, spoiler shield, and IMDb/Letterboxd import. The diary, ledger and room tables are what those would read from.

---

This product uses the TMDB API but is not endorsed or certified by TMDB.
