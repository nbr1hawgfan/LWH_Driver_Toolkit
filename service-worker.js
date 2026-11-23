const CACHE_NAME='lwh-driver-toolkit-v1-56-0';
// Pinned-version outside libraries are cached once and kept across updates
// (shared with the Warehouse Toolkit, same site) instead of re-downloaded every visit.
const LIB_CACHE='lwh-shared-libs-v1';
const LIB_URLS=[/^https:\/\/docs\.opencv\.org\/4\.8\.0\//,/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\//,/^https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@2\.5\.1\//,/^https:\/\/cdn\.jsdelivr\.net\/npm\/html2canvas@1\.4\.1\//,/^https:\/\/unpkg\.com\/leaflet@1\.9\.4\//];
const ASSETS=['./','./js/pod.js','./js/sitenotes.js','./index.html','./manifest.json','./css/app.css','./css/print.css','./js/storage.js','./js/qr.js','./js/barcode.js','./js/ui.js','./js/labels.js','./js/distance.js','./js/scales-data.js','./js/nearby.js','./js/routewx.js','./js/trailerinspect.js','./js/trailerdefect.js','./js/scanner.js','./js/doc-auto-detect.js','./js/docscan.js','./js/hos.js','./js/fuelcost.js','./js/eia.js','./js/fsc.js','./js/fuelboard.js','./js/loadsecure.js','./js/radar.js','./js/paperlog.js','./js/detention.js','./js/yardcheck.js','./js/yardboard.js','./js/dispatchplan.js','./js/status.js','./js/recruit.js','./js/dvir.js','./js/incident.js','./js/utilities.js','./js/messages.js','./js/timeclock.js','./js/gate.js','./js/myhours.js','./js/push.js','./js/timeoff.js','./js/timeclockboard.js','./js/favorites.js','./js/launch.js','./js/app.js','./icons/icon-192.png','./icons/icon-512.png','./icons/favicon.png','./icons/apple-touch-icon.png','./icons/company-logo.png','./icons/shortcut-lookup.png','./icons/shortcut-picklist.png','./icons/shortcut-tools.png','./icons/shortcut-bol.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lwh-driver-toolkit-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin){
    if(LIB_URLS.some(re=>re.test(e.request.url))){
      e.respondWith(caches.open(LIB_CACHE).then(c=>c.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{ if(r&&(r.ok||r.type==='opaque')) c.put(e.request,r.clone()); return r; }))));
      return;
    }
    e.respondWith(fetch(e.request,{cache:'no-store'})); return;
  }
  const networkFirst=/\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith('/');
  if(networkFirst){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)); return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));
    return;
  }
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(cached=>cached||fetch(e.request).then(r=>{const copy=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)); return r;})));
});

/* ---------- notifications (lwh-push) ---------- */
self.addEventListener('push',e=>{
  let m={}; try{ m=e.data?e.data.json():{}; }catch(er){ m={title:'Logistics Warehouse',body:e.data&&e.data.text()}; }
  const url=new URL(m.path||'',self.registration.scope).href;
  e.waitUntil(self.registration.showNotification(m.title||'Logistics Warehouse',{
    body:m.body||'', tag:m.tag||undefined, renotify:!!m.tag, requireInteraction:!!m.urgent,
    icon:'./icons/icon-192.png', badge:'./icons/icon-192.png', data:{url}
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||self.registration.scope;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const open=list.find(c=>c.url.startsWith(self.registration.scope)&&!c.url.includes('/dispatch/'));
    if(open){ open.postMessage({type:'openUrl',url}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('pushsubscriptionchange',e=>{
  e.waitUntil(self.clients.matchAll({type:'window'}).then(list=>list.forEach(c=>c.postMessage({type:'resubscribe'}))));
});
