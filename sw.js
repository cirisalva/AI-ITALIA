const CACHE = 'ai-italia-v1';

const A = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();

  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(A))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(x => x !== CACHE)
            .map(x => caches.delete(x))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();

          caches.open(CACHE)
            .then(c => c.put('./index.html', copy));

          return r;
        })
        .catch(() => caches.match('./index.html'))
    );

    return;
  }

  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request))
  );
});
