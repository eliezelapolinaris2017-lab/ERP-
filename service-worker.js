/* service-worker.js – SW vanilla con precache + runtime strategies */
const CACHE_VERSION = "v1.0.0";
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME = `runtime-${CACHE_VERSION}`;
const SHELL = [
  "/", "/index.html", "/styles.css", "/app.js", "/payroll.js", "/firebase.js",
  "/assets/logo.png", "/offline.html", "/manifest.webmanifest"
];
const CDN_ORIGINS = [
  "https://cdn.jsdelivr.net",
  "https://cdn.jsdelivr.net",
  "https://www.gstatic.com",
  "https://fonts.gstatic.com",
  "https://cdn.jsdelivr.net",
  "https://cdn.jsdelivr.net",
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com"
];

self.addEventListener("install", (e)=>{
  self.skipWaiting();
  e.waitUntil(caches.open(PRECACHE).then(c=>c.addAll(SHELL)));
});

self.addEventListener("activate", (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>![PRECACHE,RUNTIME].includes(k)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e)=>{
  const { request } = e;
  const url = new URL(request.url);

  // Navegación: network-first con fallback
  if(request.mode === "navigate"){
    e.respondWith((async ()=>{
      try{
        const fresh = await fetch(request);
        const cache = await caches.open(RUNTIME);
        cache.put("/", fresh.clone());
        return fresh;
      }catch{
        const cache = await caches.open(PRECACHE);
        return (await cache.match("/index.html")) || (await cache.match("/offline.html"));
      }
    })());
    return;
  }

  // CDNs/estáticos: cache-first
  if(CDN_ORIGINS.some(origin => url.origin.startsWith(origin)) || url.pathname.match(/\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?)$/)){
    e.respondWith((async ()=>{
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(request);
      if(cached) return cached;
      try{
        const resp = await fetch(request);
        if(resp.ok) cache.put(request, resp.clone());
        return resp;
      }catch{
        return cached || Response.error();
      }
    })());
    return;
  }

  // Default: pasar directo
});

self.addEventListener("message", (e)=>{
  if(e.data?.type === "SKIP_WAITING"){ self.skipWaiting(); }
});
