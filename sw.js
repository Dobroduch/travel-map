const CACHE_VERSION = "v69";
const APP_CACHE = `travel-map-app-${CACHE_VERSION}`;
const TILE_CACHE = `travel-map-tiles-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/map.js",
  "./js/dialog.js",
  "./js/data.js",
  "./js/editor.js",
  "./js/storage.js",
  "./js/icons.js",
  "./js/util.js",
  "./js/geocode.js",
  "./js/flightstats.js",
  "./js/aircraftlookup.js",
  "./js/sync.js",
  "./js/sharecard.js",
  "./data/countries.geojson",
  "./data/cities.json",
  "./data/country-codes.json",
  "./data/airports.json",
  "./data/airlines.json",
  "./vendor/maplibre-gl.js",
  "./vendor/maplibre-gl.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) =>
        Promise.all(
          // bypass the browser's HTTP cache so a version bump can't get a stale
          // file baked into the new cache (cache.addAll alone doesn't guarantee this)
          APP_SHELL.map((url) => fetch(url, { cache: "reload" }).then((response) => cache.put(url, response)))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_CACHE && key !== TILE_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isTileRequest(url) {
  return /arcgisonline\.com/.test(url);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = request.url;

  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  if (url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return (
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(APP_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
        );
      })
    );
  }
});
