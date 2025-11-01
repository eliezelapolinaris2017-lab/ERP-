/* Service Worker vanilla con precache + runtime + actualización controlada */
const CACHE_VERSION = 'v1.0.0';
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME = `runtime-${CACHE_VERSION}`;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase.js',
  './assets/logo.png',
  './offline.html',
  './manifest.webmanifest'
];

// Orígenes a cache-first en runtime (CDNs)
const CDN_HOSTS = [
  'www.gstatic.com', // Firebase
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(PRECACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())
  );
});
self.addEventListener('activate', (event)=>{
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>![PRECACHE,RUNTIME].includes(k)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event)=>{
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Estrategias: cache-first para assets/CDNs; network-first para navegación
self.addEventListener('fetch', (event)=>{
  const req = event.request;
  const url = new URL(req.url);

  // Navegación de páginas -> network-first con fallback
  if (req.mode === 'navigate') {
    event.respondWith((async()=>{
      try{
        const net = await fetch(req);
        const cache = await caches.open(RUNTIME);
        cache.put('./index.html', net.clone());
        return net;
      }catch{
        const cache = await caches.open(PRECACHE);
        return (await cache.match('./index.html')) || (await cache.match('./offline.html'));
      }
    })());
    return;
  }

  // CDNs y assets estáticos -> cache-first
  if (CDN_HOSTS.includes(url.hostname) || url.pathname.startsWith('/assets/')) {
    event.respondWith((async()=>{
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Otros -> fallback a red con respaldo en caché si existe
  event.respondWith((async()=>{
    try{
      return await fetch(req);
    }catch{
      const cache = await caches.open(RUNTIME);
      return (await cache.match(req)) || (await caches.match('./offline.html'));
    }
  })());
});
