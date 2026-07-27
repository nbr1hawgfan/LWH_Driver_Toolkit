const CACHE_NAME='lwh-driver-toolkit-v1-0-0';
const ASSETS=['./','./index.html','./manifest.json','./css/app.css','./css/print.css','./js/storage.js','./js/qr.js','./js/barcode.js','./js/ui.js','./js/labels.js','./js/distance.js','./js/trailer.js','./js/scanner.js','./js/doc-auto-detect.js','./js/hos.js','./js/fuelcost.js','./js/loadsecure.js','./js/utilities.js','./js/app.js','./icons/icon-192.png','./icons/icon-512.png','./icons/favicon.png','./icons/shortcut-lookup.png','./icons/shortcut-picklist.png','./icons/shortcut-tools.png','./icons/shortcut-bol.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin){ e.respondWith(fetch(e.request,{cache:'no-store'})); return; }
  const networkFirst=/\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith('/');
  if(networkFirst){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)); return r;}).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{const copy=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)); return r;})));
});
