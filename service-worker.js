const CACHE_NAME='lwh-driver-toolkit-v1-36-0';
// Pinned-version outside libraries are cached once and kept across updates
// (shared with the Warehouse Toolkit, same site) instead of re-downloaded every visit.
const LIB_CACHE='lwh-shared-libs-v1';
const LIB_URLS=[/^https:\/\/docs\.opencv\.org\/4\.8\.0\//,/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\//,/^https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@2\.5\.1\//,/^https:\/\/cdn\.jsdelivr\.net\/npm\/html2canvas@1\.4\.1\//,/^https:\/\/unpkg\.com\/leaflet@1\.9\.4\//];
const ASSETS=['./','./index.html','./manifest.json','./css/app.css','./css/print.css','./js/storage.js','./js/qr.js','./js/barcode.js','./js/ui.js','./js/labels.js','./js/distance.js','./js/scales-data.js','./js/nearby.js','./js/routewx.js','./js/trailerinspect.js','./js/trailerdefect.js','./js/timeoff.js','./js/timesheet.js','./js/spottertimesheets.js','./js/scanner.js','./js/doc-auto-detect.js','./js/docscan.js','./js/hos.js','./js/fuelcost.js','./js/eia.js','./js/fsc.js','./js/fuelboard.js','./js/loadsecure.js','./js/radar.js','./js/paperlog.js','./js/detention.js','./js/yardcheck.js','./js/yardboard.js','./js/status.js','./js/recruit.js','./js/dvir.js','./js/incident.js','./js/utilities.js','./js/favorites.js','./js/app.js','./icons/icon-192.png','./icons/icon-512.png','./icons/favicon.png','./icons/apple-touch-icon.png','./icons/company-logo.png','./icons/shortcut-lookup.png','./icons/shortcut-picklist.png','./icons/shortcut-tools.png','./icons/shortcut-bol.png'];
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
