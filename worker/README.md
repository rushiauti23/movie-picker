# TMDB proxy (Cloudflare Worker)

Keeps the TMDB key off the site. The browser calls this Worker; the Worker adds the key and calls TMDB.

## Deploy with the command line

You need a free Cloudflare account and Node.js.

```bash
cd worker
npx wrangler login

# 1. Create the storage for your list. It prints an id.
npx wrangler kv namespace create SHELF
#    (on older versions of wrangler: npx wrangler kv:namespace create SHELF)

# 2. Edit wrangler.toml:
#    - paste that id where it says PASTE-THE-ID-HERE
#    - put your GitHub Pages address in ALLOWED_ORIGINS
#      (just the origin, e.g. https://rushi.github.io, not the /reel-room/ path)

# 3. Deploy, then set the two secrets
npx wrangler deploy
npx wrangler secret put TMDB_KEY          # paste your TMDB key
npx wrangler secret put OWNER_PASSWORD    # choose a long passphrase; only you should know it
```

`wrangler deploy` prints the Worker's address, something like
`https://reelroom-tmdb.<your-subdomain>.workers.dev`.

If you already deployed an earlier version of this Worker, run steps 1 to 3 again; you only need to add
the storage and the `OWNER_PASSWORD` secret.

## Or deploy from the Cloudflare dashboard

1. **Storage & Databases → KV → Create**, name it `reelroom-shelf`.
2. **Workers & Pages → Create → Worker**, name it `reelroom-tmdb`, deploy the starter.
3. **Edit code**, replace everything with the contents of `worker.js`, deploy.
4. **Settings → Variables and Secrets**: add secrets `TMDB_KEY` and `OWNER_PASSWORD`, and a text variable
   `ALLOWED_ORIGINS` (for example `https://rushi.github.io,http://localhost:8000`).
5. **Settings → Bindings → Add → KV namespace**: variable name `SHELF`, namespace `reelroom-shelf`.

## Point the site at it

In the site's `config.js`:

```js
window.REELROOM_CONFIG = {
  proxyUrl: "https://reelroom-tmdb.<your-subdomain>.workers.dev",
  tmdbKey: ""
};
```

Commit and push. Search now works for every visitor, and the key is nowhere in the repo or the page.

## Check it

Open your deployed site, go to **Add**, and search. If nothing loads, open the browser's developer
tools (Network tab) and look at the request to the Worker:

| What you see | Cause |
| --- | --- |
| 403 "only serves its own site" | Your site's address is not in `ALLOWED_ORIGINS` (check `https`, no trailing slash, no path) |
| 500 "no TMDB_KEY secret" | The secret has not been set |
| 401 on a search | TMDB rejected the key stored in the secret |
| 501 "no SHELF storage" | The KV namespace is not bound to the Worker under the name `SHELF` |
| "That owner passphrase is not right" | The passphrase does not match the `OWNER_PASSWORD` secret |

## What this protects, and what it does not

- The TMDB key is never visible to visitors or in the repository.
- Only someone with the owner passphrase can change the published list. Wrong guesses are slowed down, so use a long passphrase rather than a short word.
- Other websites cannot use your proxy from a browser, and it only serves five read-only TMDB endpoints plus your list.
- A person with a script can fake the `Origin` header and still read those endpoints and your published list
  through the Worker. They get public film data and the list you already chose to publish, not your key or passphrase.
- Check Cloudflare's current free-plan limits for Workers and KV; a personal site stays far below them.
