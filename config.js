// How this site reaches its Cloudflare Worker (see the worker/ folder).
//
// proxyUrl: the Worker's address. The Worker holds the TMDB key and stores your
//   published list, so no key appears here or in the browser.
//   Example: "https://reelroom-tmdb.your-subdomain.workers.dev"
//
// tmdbKey: only for running without a Worker. Search works, but the key is public
//   and there is no shared list: every visitor sees only their own.
window.REELROOM_CONFIG = {
  proxyUrl: "",
  tmdbKey: ""
};
