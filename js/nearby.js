// Near Me Now — weigh stations, truck stops, rest areas and truck parking
// around the driver.
//  • Scales: bundled regional list (js/scales-data.js, from OpenStreetMap) +
//    scales LWH drivers added ("Add a scale here"). Works with no signal.
//  • Truck stops / rest areas / parking: live OpenStreetMap (Overpass API),
//    cached on the phone for a day per area so a repeat look is instant.
// LWHScales also carries the Open/Closed reports drivers send — no state in
// our area publishes a free live scale-status feed. Reports queue offline.
(function(){
  const el=id=>document.getElementById(id);
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const SCALE_API='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/scale-reports';
  const PEND='scalePending', MINE='scaleMine', SITES='scaleSites', OPCACHE='nearCache', OPGOOD='overpassGood';
  // Public Overpass servers are free and often busy; try the last one that worked first.
  const OVERPASS=['https://overpass.openstreetmap.fr/api/interpreter','https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter'];
  const SCALE_RADIUS_MI=100;
  const post=body=>fetch(SCALE_API,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

  // ---------- geometry ----------
  function miles(a,b){
    const R=3958.8, r=Math.PI/180;
    const dLat=(b.lat-a.lat)*r, dLon=(b.lon-a.lon)*r;
    const h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }
  function bearing(a,b){
    const r=Math.PI/180, y=Math.sin((b.lon-a.lon)*r)*Math.cos(b.lat*r);
    const x=Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lon-a.lon)*r);
    return (Math.atan2(y,x)/r+360)%360;
  }
  const compass=d=>['N','NE','E','SE','S','SW','W','NW'][Math.round(d/45)%8];

  // ---------- Overpass (truck stops, rest areas, parking) ----------
  async function overpass(q){
    const good=LWHStorage.get(OPGOOD,'');
    const order=good&&OVERPASS.includes(good)?[good,...OVERPASS.filter(u=>u!==good)]:OVERPASS;
    let last=null;
    for(const url of order){
      try{
        const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),14000);
        const res=await fetch(url,{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:ctl.signal});
        clearTimeout(t);
        if(!res.ok){ last=new Error('Map data servers are busy'); continue; }
        const data=await res.json();
        LWHStorage.set(OPGOOD,url);
        return (data.elements||[]).map(e=>{
          const lat=e.lat??(e.center&&e.center.lat), lon=e.lon??(e.center&&e.center.lon);
          return lat==null?null:{id:`${e.type}/${e.id}`,lat,lon,tags:e.tags||{}};
        }).filter(Boolean);
      }catch(e){ last=e.name==='AbortError'?new Error('Map data servers are slow right now'):e; }
    }
    throw last||new Error('Map data unavailable');
  }
  const CATS={
    trucks:{label:'Truck stops',radius:50000,q:`nwr["amenity"="fuel"]["hgv"~"yes|designated"]{A};nwr["amenity"="fuel"]["name"~"love's|pilot|flying j|petro|travelcenter|travel center|truck stop|travel plaza|travel stop|truckstop",i]{A};nwr["amenity"="fuel"]["brand"~"love's|pilot|flying j|petro|travelcenters|^TA$",i]{A};`},
    rest:{label:'Rest areas',radius:80000,q:`nwr["highway"~"^(rest_area|services)$"]{A};`},
    parking:{label:'Truck parking',radius:50000,q:`nwr["amenity"="parking"]["hgv"~"yes|designated"]{A};nwr["amenity"="parking"]["parking:hgv"]{A};nwr["amenity"="parking"]["name"~"truck",i]{A};`},
  };
  const query=(filter,area,limit)=>`[out:json][timeout:25];(${filter.replaceAll('{A}',area)});out center tags ${limit||150};`;
  async function nearPlaces(cat,here){
    // Cache per category per ~7-mile grid square for 24h.
    const key=`${cat}:${here.lat.toFixed(1)},${here.lon.toFixed(1)}`;
    const cache=LWHStorage.get(OPCACHE,{});
    const hit=cache[key];
    if(hit&&Date.now()-hit.t<24*3600000) return {els:hit.els,cached:hit.t};
    try{
      const c=CATS[cat];
      const els=await overpass(query(c.q,`(around:${c.radius},${here.lat.toFixed(4)},${here.lon.toFixed(4)})`));
      const slim=els.map(e=>({id:e.id,lat:+e.lat.toFixed(5),lon:+e.lon.toFixed(5),tags:pickTags(e.tags)}));
      const fresh={}; Object.entries(cache).forEach(([k,v])=>{ if(Date.now()-v.t<24*3600000) fresh[k]=v; });
      fresh[key]={t:Date.now(),els:slim}; LWHStorage.set(OPCACHE,fresh);
      return {els:slim};
    }catch(e){
      if(hit) return {els:hit.els,cached:hit.t,stale:true};
      throw e;
    }
  }
  const pickTags=t=>{ const o={}; ['name','brand','operator','highway','opening_hours','addr:street','addr:housenumber','addr:city','capacity:hgv','capacity','fee'].forEach(k=>{ if(t[k]) o[k]=t[k]; }); return o; };
  function placeName(cat,t){
    const n=t.name||t.brand||t.operator;
    if(n) return n;
    return {trucks:'Truck stop / fuel',rest:t.highway==='services'?'Service plaza':'Rest area',parking:'Truck parking'}[cat]||'Place';
  }

  // ---------- scales ----------
  function ago(iso){
    const m=Math.round((Date.now()-new Date(iso).getTime())/60000);
    if(m<1) return 'just now'; if(m<60) return m+' min ago';
    const h=Math.floor(m/60); return h+'h'+(m%60?' '+(m%60)+'m':'')+' ago';
  }
  const Scales={
    // Bundled list + driver-added scales (cached; refreshed at most hourly).
    async all(){
      let c=LWHStorage.get(SITES,{t:0,sites:[]});
      if(Date.now()-c.t>3600000){
        try{
          const res=await post({action:'sites'}); const d=await res.json();
          if(d.ok){ c={t:Date.now(),sites:(d.sites||[]).map(s=>({id:s.id,lat:s.lat,lon:s.lon,name:s.name,added:s.added_by||'driver'}))}; LWHStorage.set(SITES,c); }
        }catch(e){ /* offline — use what we have */ }
      }
      const base=(window.LWH_SCALES_BASE||[]);
      const added=c.sites.filter(s=>!base.some(b=>miles(b,s)<0.15));
      return base.concat(added);
    },
    async latest(ids){
      ids=[...new Set(ids)].slice(0,300); if(!ids.length) return {};
      let out={};
      try{ const res=await post({action:'latest',osm_ids:ids,hours:24}); out=(await res.json()).reports||{}; }
      catch(e){ (LWHStorage.get(MINE,[])).forEach(p=>{ if(ids.includes(p.osm_id)&&!out[p.osm_id]) out[p.osm_id]=p; }); }
      // My own unsent reports win — they're newer than anything on the server.
      (LWHStorage.get(PEND,[])).forEach(p=>{ if(ids.includes(p.osm_id)) out[p.osm_id]={status:p.status,driver:p.driver,reported_at:p.reported_at,pending:true}; });
      return out;
    },
    report(s,status){
      const item={action:'submit',id:'sr-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),osm_id:s.id,name:s.name||'',lat:s.lat,lon:s.lon,status,
        driver:(LWHStorage.get('userName','')||'').trim(),reported_at:new Date().toISOString()};
      const q=LWHStorage.get(PEND,[]); q.push(item); LWHStorage.set(PEND,q);
      const mine=LWHStorage.get(MINE,[]).filter(x=>Date.now()-new Date(x.reported_at).getTime()<24*3600000);
      mine.unshift({osm_id:item.osm_id,status,driver:item.driver,reported_at:item.reported_at}); LWHStorage.set(MINE,mine.slice(0,50));
      return this.flush();
    },
    async addSite(name,lat,lon){
      const id='lwh/'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
      const res=await post({action:'add_site',id,name,lat,lon,added_by:(LWHStorage.get('userName','')||'').trim()});
      const d=await res.json();
      if(!d.ok) throw new Error(d.error||'Could not save');
      LWHStorage.set(SITES,{t:0,sites:(LWHStorage.get(SITES,{sites:[]}).sites||[])}); // force refresh next time
      return d.existing?{...d.existing,existing:true}:{id:d.id,name,lat,lon};
    },
    flushing:false,
    async flush(){
      if(this.flushing) return; this.flushing=true;
      try{
        for(const item of LWHStorage.get(PEND,[])){
          if(Date.now()-new Date(item.reported_at).getTime()>11*3600000){ LWHStorage.set(PEND,LWHStorage.get(PEND,[]).filter(x=>x.id!==item.id)); continue; }
          try{
            const res=await post(item);
            if(res.ok||res.status===400) LWHStorage.set(PEND,LWHStorage.get(PEND,[]).filter(x=>x.id!==item.id));
            else break;
          }catch(e){ break; }
        }
      }finally{ this.flushing=false; }
    },
    // Status pill + Open/Closed buttons for one scale.
    controls(s,rep){
      const pill=rep?`<span class="nb-pill ${rep.status==='Open'?'nb-open':'nb-closed'}">${rep.status.toUpperCase()}</span><span class="hint">${safe(ago(rep.reported_at))}${rep.driver?' · '+safe(rep.driver):''}${rep.pending?' · sending…':''}</span>`
        :`<span class="nb-pill nb-unk">NO REPORT</span><span class="hint">in the last 24h</span>`;
      return `<div class="nb-scale-row">${pill}<span class="nb-scale-btns"><button type="button" class="ghost nb-rep" data-scale-rep="Open" data-scale-id="${safe(s.id)}">Report Open</button><button type="button" class="ghost nb-rep" data-scale-rep="Closed" data-scale-id="${safe(s.id)}">Report Closed</button></span></div>`;
    },
    // Wires Open/Closed buttons inside `root`; `lookup(id)` returns the scale; `refresh()` redraws with new reports.
    wire(root,lookup,refresh){
      root.addEventListener('click',async e=>{
        const b=e.target.closest('[data-scale-rep]'); if(!b) return;
        const s=lookup(b.dataset.scaleId); if(!s) return;
        const p=Scales.report(s,b.dataset.scaleRep);
        if(window.LWHUI) LWHUI.toast(`Thanks — reported ${b.dataset.scaleRep.toLowerCase()}`);
        await refresh(); await p; await refresh();
      });
    },
    // Scales within `bufferMi` of a route line. coords=[{lat,lon}], cum=miles at each coord.
    async along(coords,cum,bufferMi){
      const list=await this.all(), out=[];
      const r=Math.PI/180;
      list.forEach(s=>{
        let best=Infinity, at=0;
        for(let i=0;i<coords.length-1;i++){
          const a=coords[i], b=coords[i+1];
          if(Math.abs(a.lat-s.lat)>0.3&&Math.abs(b.lat-s.lat)>0.3) continue;
          const k=Math.cos(s.lat*r)*69.17, ax=(a.lon-s.lon)*k, ay=(a.lat-s.lat)*69.05, bx=(b.lon-s.lon)*k, by=(b.lat-s.lat)*69.05;
          const dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy;
          const t=L?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/L)):0;
          const d=Math.hypot(ax+t*dx,ay+t*dy);
          if(d<best){ best=d; at=cum[i]+t*(cum[i+1]-cum[i]); }
        }
        if(best<=bufferMi) out.push({...s,mi:at});
      });
      return out.sort((a,b)=>a.mi-b.mi);
    },
    miles, bearing, compass,
  };
  window.LWHScales=Scales;

  // ---------- Near Me screen ----------
  let cur='', results=[], reports={}, here=null;
  function getHere(){
    return new Promise((res,rej)=>{
      if(!navigator.geolocation) return rej(new Error('Location is not available on this device'));
      navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),
        e=>rej(new Error(e.code===1?'Location permission is off — allow location for this app and try again':'Could not get your location — try again')),
        {enableHighAccuracy:true,timeout:15000,maximumAge:60000});
    });
  }
  function render(){
    const list=el('nbList'); if(!list) return;
    const add=cur==='scales'?`<div class="nb-add" id="nbAddWrap">
      <button type="button" class="ghost" id="nbAddBtn">+ Add a scale here</button>
      <span class="hint">At a scale that isn't listed? Add it at your spot so every LWH driver sees it.</span>
      <div id="nbAddForm" hidden><label>Scale name<input id="nbAddName" maxlength="80" placeholder="e.g. I-40 WB Alma, AR" /></label>
        <div class="actions"><button type="button" id="nbAddSave">Save Scale</button><button type="button" class="ghost" id="nbAddCancel">Cancel</button></div></div>
    </div>`:'';
    list.innerHTML=add+results.slice(0,25).map(r=>{
      const nav=`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;
      const t=r.tags||{};
      const sub=cur==='scales'?(r.added?`Added by ${safe(r.added)}`:''):[t['addr:street']?`${t['addr:housenumber']||''} ${t['addr:street']}`.trim():'',t['addr:city']||'',t.opening_hours==='24/7'?'Open 24/7':'',t['capacity:hgv']?t['capacity:hgv']+' truck spots':''].filter(Boolean).join(' · ');
      return `<div class="nb-item">
        <div class="nb-main"><div class="nb-name">${safe(r.name)}</div>${sub?`<div class="hint">${sub}</div>`:''}
          ${cur==='scales'?Scales.controls(r,reports[r.id]):''}</div>
        <div class="nb-side"><div class="nb-dist">${r.mi<10?r.mi.toFixed(1):Math.round(r.mi)} mi</div><div class="hint">${r.dir}</div><a class="btn-link ghost nb-go" href="${nav}" target="_blank" rel="noopener">Go</a></div>
      </div>`;
    }).join('');
  }
  async function search(cat){
    cur=cat;
    document.querySelectorAll('[data-nb-cat]').forEach(b=>b.classList.toggle('active',b.dataset.nbCat===cat));
    const st=el('nbStatus'), list=el('nbList'); list.innerHTML=''; results=[];
    try{
      st.textContent='Getting your location…';
      here=await getHere();
      if(cat==='scales'){
        st.textContent='Finding scales…';
        const all=await Scales.all();
        results=all.map(s=>({...s,mi:miles(here,s),dir:compass(bearing(here,s))})).filter(s=>s.mi<=SCALE_RADIUS_MI).sort((a,b)=>a.mi-b.mi);
        render();
        reports=await Scales.latest(results.slice(0,25).map(r=>r.id));
        st.textContent=results.length?`${results.length} within ${SCALE_RADIUS_MI} miles — closest first. Not every scale is listed yet; add any you pass.`:`No listed scales within ${SCALE_RADIUS_MI} miles yet — add one when you pass it.`;
        render();
        return;
      }
      const c=CATS[cat];
      st.textContent=`Looking for ${c.label.toLowerCase()} within ${Math.round(c.radius/1609)} miles…`;
      const {els,cached,stale}=await nearPlaces(cat,here);
      const seen=new Set();
      results=els.filter(e=>{ if(seen.has(e.id)) return false; seen.add(e.id); return true; })
        .map(e=>({...e,name:placeName(cat,e.tags),mi:miles(here,e),dir:compass(bearing(here,e))}))
        .sort((a,b)=>a.mi-b.mi);
      results=results.filter((r,i)=>!results.slice(0,i).some(p=>p.name===r.name&&miles(p,r)<0.15));
      const note=stale?' Map servers are busy — showing what was saved earlier.':(cached?' (saved earlier today)':'');
      st.textContent=(results.length?`${results.length} found — closest first${results.length>25?' (showing 25)':''}.`:`None found within ${Math.round(c.radius/1609)} miles in OpenStreetMap — try the Google Maps buttons below.`)+note+' Map data © OpenStreetMap contributors.';
      render();
    }catch(e){ st.textContent=e.message+(cat!=='scales'?' — try again in a minute, or use the Google Maps buttons below.':''); }
  }
  async function saveSite(){
    const name=(el('nbAddName').value||'').trim();
    if(name.length<3){ LWHUI.toast('Give the scale a name first'); return; }
    const btn=el('nbAddSave'); btn.disabled=true; btn.textContent='Saving…';
    try{
      const pos=await getHere();
      const s=await Scales.addSite(name,+pos.lat.toFixed(5),+pos.lon.toFixed(5));
      LWHUI.toast(s.existing?`Already listed as "${s.name}"`:'Scale added — thanks!');
      await search('scales');
    }catch(e){ LWHUI.toast(e.message.includes('fetch')?'No signal — try again when you have service':e.message); btn.disabled=false; btn.textContent='Save Scale'; }
  }

  window.addEventListener('load',()=>{
    Scales.flush();
    window.addEventListener('online',()=>Scales.flush());
    const wrap=el('nbCats'); if(!wrap) return;
    wrap.addEventListener('click',e=>{ const b=e.target.closest('[data-nb-cat]'); if(b) search(b.dataset.nbCat); });
    const list=el('nbList');
    list.addEventListener('click',e=>{
      if(e.target.id==='nbAddBtn'){ el('nbAddForm').hidden=false; el('nbAddBtn').hidden=true; el('nbAddName').focus(); }
      else if(e.target.id==='nbAddCancel'){ el('nbAddForm').hidden=true; el('nbAddBtn').hidden=false; }
      else if(e.target.id==='nbAddSave') saveSite();
    });
    Scales.wire(list,id=>results.find(r=>r.id===id),async()=>{ reports=await Scales.latest(results.slice(0,25).map(r=>r.id)); render(); });
  });
})();
