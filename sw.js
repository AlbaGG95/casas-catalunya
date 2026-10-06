const CACHE="casa-catalunya-v6-ui-v2";
const SHELL=["/","/index.html","/property.html","/styles.css","/ui-v2.css","/manifest.webmanifest","/icon.svg"];

self.addEventListener("install",e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())
));

self.addEventListener("activate",e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);

  if(u.pathname==="/app.js"||u.pathname==="/property.js"||(u.pathname==="/styles.css"||u.pathname==="/ui-v2.css")||u.hostname.endsWith("supabase.co")||u.hostname==="esm.sh"){
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

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification?.data?.url||"/";
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of list){
      if("focus" in client){
        try{await client.navigate(target)}catch{}
        return client.focus();
      }
    }
    if(clients.openWindow)return clients.openWindow(target);
  })());
});
