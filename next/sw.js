/* Service worker for the new app: lets it open with no internet and be
   installed. Pages are fetched fresh when online (so updates show at once)
   and fall back to the saved copy when offline. Built files have a content
   hash in their name, so once saved they never change — served from the
   saved copy. Firestore / sign-in requests are never touched here:
   Firestore keeps its own offline copy of the data. */

var CACHE = 'chittam-next-v1';
var CORE = ['./', 'index.html', 'manifest.webmanifest', 'favicon.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // only our own old caches; the current app's caches belong to it
    return Promise.all(keys.filter(function (k) { return k.indexOf('chittam-next-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function save(req, res) {
  if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.searchParams.has('check')) return; // version checks always go to the network

  if (url.origin === self.location.origin) {
    // hashed build files and icons: saved copy first
    if (/\/assets\/|\/icons3d\/|\/icons\//.test(url.pathname)) {
      e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { return save(req, res); }); }));
      return;
    }
    // the page and everything else: network first
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(function (res) { return save(req, res); }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
    }));
    return;
  }

  // Google Fonts: saved copy first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok || res.type === 'opaque') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    }));
  }
});
