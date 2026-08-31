/**
 * Service worker: makes the directory open without a network.
 *
 * The point is the power cut. The plumber's number and the emergency list are
 * needed exactly when the connection is not there, so everything the page is
 * built from — itself, SheetJS, data.xlsx, the fonts — is kept on the device.
 *
 * Bump VERSION to retire every old cache on the next visit.
 */
var VERSION = "v1";
var SHELL = "shell-" + VERSION;      // the page and the code that renders it
var DATA = "data-" + VERSION;        // data.xlsx, kept as the last good copy
var RUNTIME = "runtime-" + VERSION;  // documents and anything else fetched later

var SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

/* Relative, because the site lives at /People-Information/ on GitHub Pages and
   at / on Cloudflare, and the same file has to work in both. */
var SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  SHEETJS
];

/* The gate's own endpoints. Signing in must always reach the network, and a
   401 login page must never be mistaken for the site. */
function isGate(url) {
  return /\/__(login|otp|email|status|logout)\b/.test(url.pathname);
}
function isData(url) {
  return /\/data\.xlsx$/i.test(url.pathname);
}
function isDoc(url) {
  return /\/materials\//i.test(url.pathname);
}
function isFont(url) {
  return url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com";
}
/** Only a plain, complete 200 is worth keeping. */
function keepable(res) {
  return res && res.status === 200 && res.type !== "error";
}

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      // One at a time: a font or CDN hiccup must not abort the whole install
      // and leave the site with no offline copy at all.
      return Promise.all(SHELL_FILES.map(function (u) {
        return c.add(new Request(u, { cache: "reload" }))["catch"](function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL && k !== DATA && k !== RUNTIME) return caches["delete"](k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("message", function (e) {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (isGate(url)) return;                       // always live

  /* data.xlsx — always try the network so an edit shows up, but keep the last
     good copy. The page adds ?v=<time> to defeat CDN caching, so the cache is
     matched on the path alone or it would never hit. */
  if (isData(url)) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (keepable(res)) {
          var copy = res.clone();
          caches.open(DATA).then(function (c) { c.put("data.xlsx", copy); });
        }
        return res;
      })["catch"](function () {
        return caches.open(DATA).then(function (c) { return c.match("data.xlsx"); })
          .then(function (hit) {
            if (!hit) return new Response("", { status: 504, statusText: "offline" });
            // Tell the page this is the saved copy, and when it was saved, so
            // the footer can say so instead of stamping it with today.
            var h = new Headers(hit.headers);
            h.set("X-Offline-Copy", hit.headers.get("date") || "");
            return hit.blob().then(function (b) {
              return new Response(b, { status: 200, headers: h });
            });
          });
      })
    );
    return;
  }

  /* The page itself — network first, so a deploy is picked up, with the saved
     copy behind it. A gate 401 is returned untouched and never stored. */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        if (keepable(res)) {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) { c.put("./index.html", copy); });
        }
        return res;
      })["catch"](function () {
        return caches.match("./index.html", { ignoreSearch: true })
          .then(function (hit) {
            return hit || new Response(
              "<h1>Offline</h1><p>Open this page once with a connection and it " +
              "will work without one afterwards.</p>",
              { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
          });
      })
    );
    return;
  }

  /* Everything else — SheetJS, fonts, icons, documents. Serve what is saved
     and refresh it quietly in the background. */
  var sameSite = url.origin === self.location.origin;
  if (!sameSite && !isFont(url) && url.href !== SHEETJS) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: isDoc(url) }).then(function (hit) {
      var live = fetch(req).then(function (res) {
        if (keepable(res)) {
          var copy = res.clone();
          var box = (url.href === SHEETJS || isFont(url)) ? SHELL : RUNTIME;
          caches.open(box).then(function (c) { c.put(req, copy); });
        }
        return res;
      })["catch"](function () { return hit; });
      return hit || live;
    })
  );
});
