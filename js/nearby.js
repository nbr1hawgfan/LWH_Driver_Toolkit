// Nearby (live) — truck stops, weigh stations, rest areas and truck parking
// around the driver, from OpenStreetMap via the free Overpass API.
// Also LWHScales: drivers report a scale Open/Closed and everyone sees the
// newest report (no state in our area publishes a free live status feed).
// Reports queue on the phone when there's no signal and send later.
(function(){
  const el=id=>document.getElementById(id);
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const SCALE_API='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/scale-reports';
  const PEND='scalePending', MINE='scaleMine';
  // Several public Overpass servers — if one is busy we try the next.
  const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter'];

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

  // ---------- Overpass ----------
  async function overpass(q){
    let last=null;
    for(const url of OVERPASS){
      try{
        const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),30000);
        const res=await fetch(url,{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:ctl.signal});
        clearTimeout(t);
        if(!res.ok){ last=new Error('Map data server busy ('+res.status+')'); continue; }
        const data=await res.json();
        return (data.elements||[]).map(e=>{
          const lat=e.lat??(e.center&&e.center.lat), lon=e.lon??(e.center&&e.center.lon);
          return lat==null?null:{id:`${e.type}/${e.id}`,lat,lon,tags:e.tags||{}};
        }).filter(Boolean);
      }catch(e){ last=e.name==='AbortError'?new Error('Map data server timed out'):e; }
    }
    throw last||new Error('Map data unavailable');
  }
  // Filters per category. `{A}` is replaced with the area clause, e.g. (around:40000,35.3,-94.4).
  const SCALE_Q=`nwr["amenity"="weighbridge"]{A};nwr["name"~"weigh station|port of entry|scale house|weigh scale|inspection station",i]{A};`;
  const CATS={
    scales:{label:'Weigh stations',radius:80000,q:SCALE_Q},
    trucks:{label:'Truck stops',radius:50000,q:`nwr["amenity"="fuel"]["hgv"~"yes|designated"]{A};nwr["amenity"="fuel"]["name"~"love's|pilot|flying j|petro|travelcenter|travel center|truck stop|travel plaza|travel stop|truckstop",i]{A};nwr["amenity"="fuel"]["brand"~"love's|pilot|flying j|petro|travelcenters|^TA$",i]{A};`},
    rest:{label:'Rest areas',radius:80000,q:`nwr["highway"~"^(rest_area|services)$"]{A};`},
    parking:{label:'Truck parking',radius:50000,q:`nwr["amenity"="parking"]["hgv"~"yes|designated"]{A};nwr["amenity"="parking"]["parking:hgv"]{A};nwr["amenity"="parking"]["name"~"truck",i]{A};`},
  };
  function query(filter,area,limit){ return `[out:json][timeout:25];(${filter.replaceAll('{A}',area)});out center tags ${limit||150};`; }

  // ---------- scale helpers ----------
  const SCALE_NAME=/weigh station|port of entry|scale house|weigh scale|inspection station/i;
  const isScale=t=>t.amenity==='weighbridge'||SCALE_NAME.test(t.name||'');
  const isCat=t=>/\bcat\b|cat scale/i.test(`${t.name||''} ${t.brand||''} ${t.operator||''}`);
  const isPublicScale=t=>isScale(t) && !isCat(t) && !(t.amenity==='weighbridge' && /(truck stop|travel|love|pilot|flying j|petro|co-?op|grain|elevator|quarry|landfill|recycl|feed|gin)/i.test(`${t.name||''} ${t.operator||''}`));
  function scaleName(t){
    if(isCat(t)) return t.name||'CAT Scale';
    const base=t.name||t.official_name||'Weigh station';
    const extra=[t.ref,t['addr:state']].filter(Boolean).join(' · ');
    return extra&&!base.includes(t.ref||'@@')?`${base} (${extra})`:base;
  }
  function placeName(cat,t){
    if(cat==='scales') return scaleName(t);
    const n=t.name||t.brand||t.operator;
    if(n) return n;
    return {trucks:'Truck stop / fuel',rest:t.highway==='services'?'Service plaza':'Rest area',parking:'Truck parking'}[cat]||'Place';
  }
  function ago(iso){
    const m=Math.round((Date.now()-new Date(iso).getTime())/60000);
    if(m<1) return 'just now'; if(m<60) return m+' min ago';
    const h=Math.floor(m/60); return h+'h'+(m%60?' '+(m%60)+'m':'')+' ago';
  }

  const Scales={
    async latest(ids){
      ids=[...new Set(ids)].slice(0,300); if(!ids.length) return {};
      try{
        const res=await fetch(SCALE_API,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'latest',osm_ids:ids,hours:24})});
        const d=await res.json(); const out=d.reports||{};
        // My own unsent reports win — they're newer than anything on the server.
        (LWHStorage.get(PEND,[])).forEach(p=>{ if(ids.includes(p.osm_id)) out[p.osm_id]={status:p.status,driver:p.driver,reported_at:p.reported_at,pending:true}; });
        return out;
      }catch(e){
        const out={}; (LWHStorage.get(MINE,[])).forEach(p=>{ if(ids.includes(p.osm_id)&&!out[p.osm_id]) out[p.osm_id]=p; });
        return out;
      }
    },
    report(s,status){
      const item={action:'submit',id:'sr-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),osm_id:s.id,name:s.name||'',lat:s.lat,lon:s.lon,status,
        driver:(LWHStorage.get('userName','')||'').trim(),reported_at:new Date().toISOString()};
      const q=LWHStorage.get(PEND,[]); q.push(item); LWHStorage.set(PEND,q);
      const mine=LWHStorage.get(MINE,[]).filter(x=>Date.now()-new Date(x.reported_at).getTime()<24*3600000);
      mine.unshift({osm_id:item.osm_id,status,driver:item.driver,reported_at:item.reported_at}); LWHStorage.set(MINE,mine.slice(0,50));
      this.flush();
      return item;
    },
    flushing:false,
    async flush(){
      if(this.flushing) return; this.flushing=true;
      try{
        for(const item of LWHStorage.get(PEND,[])){
          // Too old to matter (server rejects >12h) — drop it.
          if(Date.now()-new Date(item.reported_at).getTime()>11*3600000){ LWHStorage.set(PEND,LWHStorage.get(PEND,[]).filter(x=>x.id!==item.id)); continue; }
          try{
            const res=await fetch(SCALE_API,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});
            if(res.ok||res.status===400) LWHStorage.set(PEND,LWHStorage.get(PEND,[]).filter(x=>x.id!==item.id));
            else break;
          }catch(e){ break; }
        }
      }finally{ this.flushing=false; }
    },
    // Status pill + Open/Closed buttons for one scale. `s` = {id,name,lat,lon,tags}
    controls(s,rep){
      if(!isPublicScale(s.tags||{})) return `<div class="nb-scale-row"><span class="nb-pill nb-cat">Private scale — open with the truck stop</span></div>`;
      const pill=rep?`<span class="nb-pill ${rep.status==='Open'?'nb-open':'nb-closed'}">${rep.status.toUpperCase()}</span><span class="hint">${safe(ago(rep.reported_at))}${rep.driver?' · '+safe(rep.driver):''}${rep.pending?' · sending…':''}</span>`
        :`<span class="nb-pill nb-unk">NO REPORT</span><span class="hint">in the last 24h</span>`;
      return `<div class="nb-scale-row">${pill}<span class="nb-scale-btns"><button type="button" class="ghost nb-rep" data-scale-rep="Open" data-scale-id="${safe(s.id)}">Report Open</button><button type="button" class="ghost nb-rep" data-scale-rep="Closed" data-scale-id="${safe(s.id)}">Report Closed</button></span></div>`;
    },
    // Wires Open/Closed buttons inside `root`; `lookup(id)` returns the scale object; `rerender()` redraws.
    wire(root,lookup,rerender){
      root.addEventListener('click',e=>{
        const b=e.target.closest('[data-scale-rep]'); if(!b) return;
        const s=lookup(b.dataset.scaleId); if(!s) return;
        Scales.report(s,b.dataset.scaleRep);
        if(window.LWHUI) LWHUI.toast(`Thanks — reported ${b.dataset.scaleRep.toLowerCase()}`);
        rerender();
      });
    },
    overpass, query, SCALE_Q, scaleName, isScale, isPublicScale, miles, bearing, compass,
  };
  window.LWHScales=Scales;

  // ---------- Near Me screen ----------
  let cur='scales', results=[], reports={}, here=null;
  function getHere(){
    return new Promise((res,rej)=>{
      if(!navigator.geolocation) return rej(new Error('Location is not available on this device'));
      navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),
        e=>rej(new Error(e.code===1?'Location permission is off — allow location for this app and try again':'Could not get your location — try again')),
        {enableHighAccuracy:false,timeout:15000,maximumAge:120000});
    });
  }
  function render(){
    const list=el('nbList'); if(!list) return;
    if(!results.length){ list.innerHTML=''; return; }
    list.innerHTML=results.slice(0,25).map(r=>{
      const nav=`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;
      const sub=[r.tags['addr:street']?`${r.tags['addr:housenumber']||''} ${r.tags['addr:street']}`.trim():'',r.tags['addr:city']||'',r.tags.opening_hours==='24/7'?'Open 24/7':''].filter(Boolean).join(' · ');
      return `<div class="nb-item">
        <div class="nb-main"><div class="nb-name">${safe(r.name)}</div>${sub?`<div class="hint">${safe(sub)}</div>`:''}
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
      const c=CATS[cat];
      st.textContent=`Looking for ${c.label.toLowerCase()} within ${Math.round(c.radius/1609)} miles…`;
      const els=await overpass(query(c.q,`(around:${c.radius},${here.lat.toFixed(5)},${here.lon.toFixed(5)})`));
      const seen=new Set();
      results=els.filter(e=>{ if(seen.has(e.id)) return false; seen.add(e.id); return true; })
        .map(e=>({...e,name:placeName(cat,e.tags),mi:miles(here,e),dir:compass(bearing(here,e))}))
        .sort((a,b)=>a.mi-b.mi);
      // Drop near-duplicate points (same place mapped as a node and an area).
      results=results.filter((r,i)=>!results.slice(0,i).some(p=>p.name===r.name&&miles(p,r)<0.15));
      if(cat==='scales'){
        results=results.filter(r=>isScale(r.tags));
        results.sort((a,b)=>(Scales.isPublicScale(b.tags)-Scales.isPublicScale(a.tags))||(a.mi-b.mi));
        reports=await Scales.latest(results.filter(r=>Scales.isPublicScale(r.tags)).map(r=>r.id));
      }
      st.textContent=results.length?`${results.length} found — closest first${results.length>25?' (showing 25)':''}. Map data © OpenStreetMap contributors.`:`None found within ${Math.round(c.radius/1609)} miles in OpenStreetMap — try the Google Maps buttons below.`;
      render();
    }catch(e){ st.textContent=e.message; }
  }

  window.addEventListener('load',()=>{
    Scales.flush();
    window.addEventListener('online',()=>Scales.flush());
    const wrap=el('nbCats'); if(!wrap) return;
    wrap.addEventListener('click',e=>{ const b=e.target.closest('[data-nb-cat]'); if(b) search(b.dataset.nbCat); });
    Scales.wire(el('nbList'),id=>results.find(r=>r.id===id),async()=>{ render(); reports=await Scales.latest(results.filter(r=>Scales.isPublicScale(r.tags)).map(r=>r.id)); render(); });
  });
})();
