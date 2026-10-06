const CACHE="casa-catalunya-v4-official-v1";
const SHELL=["/","/index.html","/property.html","/styles.css","/manifest.webmanifest","/icon.svg"];

self.addEventListener("install",e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())
));

self.addEventListener("activate",e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);

  if(u.pathname==="/app.js"||u.pathname==="/property.js"||u.pathname==="/styles.css"||u.hostname.endsWith("supabase.co")||u.hostname==="esm.sh"){
    e.respondWith(fetch(e.request,{cache:"no-store"}));
    return;
  }
  if(u.origin!==location.origin)return;

  e.respondWith(
    fetch(e.request,{cache:"no-store"}).then(r=>{
      const copy=r.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy));
      return r;
    }).catch(()=>caches.match(e.request).then(r=>r||caches.match("/")))
  );
});