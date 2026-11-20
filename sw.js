/* Service worker: lets the app open with no internet (and lets Android
   install it as an app). App files are fetched fresh when online and fall
   back to the saved copy when offline; the versioned Firebase SDK and fonts
   are served from the cache. Firestore / sign-in requests are never touched
   here — Firestore keeps its own offline copy of the data. */

var CACHE = 'chittam-v17';
var APP_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png',
  'icons3d/chart.png', 'icons3d/calender.png', 'icons3d/money-bag.png', 'icons3d/notebook.png', 'icons3d/bag.png', 'icons3d/gift.png', 'icons3d/picture.png', 'icons3d/file-text.png', 'icons3d/tool.png', 'icons3d/rocket.png', 'icons3d/back.png', 'icons3d/boy.png', 'icons3d/cube.png', 'icons3d/location.png', 'icons3d/clock.png', 'icons3d/setting.png', 'icons3d/chat.png', 'icons3d/puzzle.png', 'icons3d/mobile.png', 'icons3d/star.png',
  'js/firebase-config.js', 'js/00-crypto.js', 'js/01-core.js', 'js/01b-database.js', 'js/02-nav.js', 'js/03-registry.js',
  'js/04-customers.js', 'js/05-products.js', 'js/06-duplicates.js', 'js/07-settings.js',
  'js/08-payment-updated.js', 'js/09-balance-confirmation.js', 'js/10-payment-reminder.js',
  'js/11-dispatch-confirmation.js', 'js/12-stock-update.js', 'js/13-init.js', 'js/14-service-material.js',
  'js/15-catalog.js', 'js/16-stock-return.js', 'js/18-history.js', 'js/19-orders.js',
  'js/20-service-jobs.js', 'js/21-transports.js', 'js/22-app-install.js', 'js/23-mobile.js', 'js/24-receipts.js', 'js/25-picklist.js', 'js/26-tally-balances.js', 'js/27-look.js'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(APP_FILES); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url = new URL(req.url);

  // our own files: network first so updates show at once, cache when offline
  if(url.origin === self.location.origin){
    // no-cache: always check GitHub for a newer copy instead of the phone's HTTP cache
    e.respondWith(fetch(req, {cache: 'no-cache'}).then(function(res){
      if(res.ok){ var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
      return res;
    }).catch(function(){
      return caches.match(req, {ignoreSearch: true}).then(function(hit){ return hit || caches.match('index.html'); });
    }));
    return;
  }

  // Firebase SDK (versioned URLs) and Google Fonts: cache first
  if(url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){
        if(res.ok || res.type === 'opaque'){ var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
        return res;
      });
    }));
  }
});
