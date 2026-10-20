// Route Conditions — runs after the Distance / Route Planner finds a route.
//  • Wind gusts, crosswind, ice/snow risk at points along the route, at the
//    time the truck should reach each point (Open-Meteo, free, keyless).
//  • NWS watches/warnings active along the route right now (api.weather.gov).
//  • Weigh stations on the route (OpenStreetMap) with LWH driver Open/Closed reports.
(function(){
  const el=id=>document.getElementById(id);
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const pad=n=>String(n).padStart(2,'0');
  const SAMPLE_MI=25, MAX_SAMPLES=30, MAX_ALERT_POINTS=18;
  let last=null, layer=null, scales=[], scaleReports={}, runId=0;

  // Wind guide — general guidance only; dispatch and company policy decide.
  const LIMITS={empty:{caution:{gust:30,cross:25},danger:{gust:45,cross:35}},loaded:{caution:{gust:40,cross:35},danger:{gust:55,cross:45}}};
  const WX={0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Cloudy',45:'Fog',48:'Freezing fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Freezing drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Showers',81:'Showers',82:'Heavy showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorms',96:'T-storms w/ hail',99:'T-storms w/ hail'};

  const nowLocal=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
  const fmtTime=t=>{const d=new Date(t);const today=new Date().toDateString()===d.toDateString();return (today?'':d.toLocaleDateString(undefined,{weekday:'short'})+' ')+d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});};
  function miles(a,b){ return LWHScales.miles(a,b); }

  // ---------- sample the route ----------
  // Returns points every ~SAMPLE_MI miles with mile marker, heading and ETA.
  function samplesFor(route,departMs,dwellMins){
    const coords=route.geometry.coordinates.map(c=>({lat:c[1],lon:c[0]}));
    const cum=[0]; for(let i=1;i<coords.length;i++) cum.push(cum[i-1]+miles(coords[i-1],coords[i]));
    const totalMi=cum[cum.length-1]||1;
    // Leg boundaries in miles, so ETA follows each leg's own speed and adds dwell at stops.
    const legs=(route.legs||[]).map(l=>({mi:l.distance/1609.344,sec:l.duration}));
    const legScale=totalMi/(legs.reduce((s,l)=>s+l.mi,0)||totalMi);
    function etaAt(mi){
      let t=departMs, m=mi/legScale;
      for(let i=0;i<legs.length;i++){
        const L=legs[i];
        if(m<=L.mi||i===legs.length-1) return t+Math.min(1,m/(L.mi||1))*L.sec*1000;
        t+=L.sec*1000+(dwellMins[i+1]||0)*60000; m-=L.mi;
      }
      return t+route.duration*1000*(mi/totalMi);
    }
    const step=Math.max(SAMPLE_MI,totalMi/(MAX_SAMPLES-1));
    const marks=[]; for(let m=0;m<totalMi;m+=step) marks.push(m);
    if(marks.length>1&&totalMi-marks[marks.length-1]<step*0.4) marks.pop(); marks.push(totalMi);
    let j=0;
    const pts=marks.map(m=>{
      while(j<cum.length-2&&cum[j+1]<m) j++;
      const a=coords[j], b=coords[Math.min(j+1,coords.length-1)];
      const f=cum[j+1]>cum[j]?(m-cum[j])/(cum[j+1]-cum[j]):0;
      const p={lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f};
      // Heading over a ~2 mi stretch so one kinked segment doesn't skew it.
      let k=j; while(k<cum.length-1&&cum[k]-m<2) k++;
      let h=j; while(h>0&&m-cum[h]<2) h--;
      return {...p,mi:m,heading:LWHScales.bearing(coords[h],coords[k]),eta:etaAt(m)};
    });
    return {pts,coords,cum,totalMi};
  }

  // ---------- weather ----------
  async function forecast(pts){
    const lat=pts.map(p=>p.lat.toFixed(3)).join(','), lon=pts.map(p=>p.lon.toFixed(3)).join(',');
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch&timeformat=unixtime&forecast_days=4&timezone=auto`;
    const res=await fetch(url,{cache:'no-store'});
    if(!res.ok) throw new Error('Weather service error ('+res.status+')');
    const d=await res.json();
    return Array.isArray(d)?d:[d];
  }
  function judge(p,load){
    const L=LIMITS[load], flags=[]; let lvl=0;
    const ang=Math.abs(((p.windDir-p.heading)%360+540)%360-180); // 0 = head/tail wind, 90 = straight across
    p.cross=Math.round(p.gust*Math.abs(Math.sin(ang*Math.PI/180)));
    if(p.gust>=L.danger.gust||p.cross>=L.danger.cross){ lvl=2; flags.push(`High wind${p.cross>=L.danger.cross?' across the road':''}`); }
    else if(p.gust>=L.caution.gust||p.cross>=L.caution.cross){ lvl=1; flags.push('Gusty'+(p.cross>=L.caution.cross?' crosswind':'')); }
    if([56,57,66,67].includes(p.code)){ lvl=2; flags.push('Freezing rain / drizzle'); }
    else if([71,73,75,77,85,86].includes(p.code)){ lvl=Math.max(lvl,p.code===75||p.code===86?2:1); flags.push('Snow'); }
    else if(p.temp<=34&&(p.pop>=40||p.precip>0)){ lvl=Math.max(lvl,1); flags.push('Near freezing with precip — watch bridges'); }
    if([95,96,99].includes(p.code)){ lvl=Math.max(lvl,1); flags.push('Thunderstorms'); }
    if(p.code===45||p.code===48){ lvl=Math.max(lvl,1); flags.push('Fog'); }
    p.lvl=lvl; p.flags=flags; return p;
  }
  function pickHour(fc,eta){
    const h=fc.hourly; if(!h||!h.time) return null;
    const t=eta/1000; let best=0, bd=Infinity;
    h.time.forEach((x,i)=>{ const dd=Math.abs(x-t); if(dd<bd){bd=dd;best=i;} });
    if(bd>3*3600) return null; // ETA is past the forecast window
    return {temp:Math.round(h.temperature_2m[best]),pop:h.precipitation_probability?.[best]??0,precip:h.precipitation?.[best]??0,code:h.weather_code[best],
      wind:Math.round(h.wind_speed_10m[best]),gust:Math.round(h.wind_gusts_10m[best]),windDir:h.wind_direction_10m[best]};
  }

  // ---------- NWS alerts ----------
  async function alertsAlong(pts){
    const step=Math.max(1,Math.ceil(pts.length/MAX_ALERT_POINTS));
    const use=pts.filter((_,i)=>i%step===0||i===pts.length-1);
    const found=new Map(); let ok=0;
    for(let i=0;i<use.length;i+=4){
      await Promise.all(use.slice(i,i+4).map(async p=>{
        try{
          const res=await fetch(`https://api.weather.gov/alerts/active?point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`,{cache:'no-store',headers:{'Accept':'application/geo+json'}});
          if(!res.ok) return; ok++;
          const d=await res.json();
          (d.features||[]).forEach(f=>{
            const a=f.properties||{}; const id=a.id||f.id;
            if(!found.has(id)) found.set(id,{event:a.event,severity:a.severity,headline:a.headline,ends:a.ends||a.expires,area:a.areaDesc,instruction:a.instruction,mi:[]});
            found.get(id).mi.push(p.mi);
          });
        }catch(e){}
      }));
    }
    if(!ok) throw new Error('Weather alerts unavailable right now');
    const rank={Extreme:0,Severe:1,Moderate:2,Minor:3,Unknown:4};
    return [...found.values()].sort((a,b)=>(rank[a.severity]??5)-(rank[b.severity]??5));
  }

  // ---------- scales on the route ----------
  // Bundled + driver-added scales within ~0.5 mi of the route line (no network needed).
  function scalesAlong(coords,cum){ return LWHScales.along(coords,cum,0.5); }

  // ---------- render ----------
  const LVL=[{cls:'rw-ok',txt:'OK'},{cls:'rw-warn',txt:'CAUTION'},{cls:'rw-bad',txt:'DANGER'}];
  function renderWx(pts,load){
    const box=el('rwWx'); if(!box) return;
    const rows=pts.filter(p=>p.gust!=null);
    if(!rows.length){ box.innerHTML='<p class="hint">Forecast not available for this departure time (it only reaches about 3 days out).</p>'; return; }
    const worst=Math.max(...rows.map(p=>p.lvl));
    const maxG=rows.reduce((a,p)=>p.gust>a.gust?p:a,rows[0]);
    const bad=rows.filter(p=>p.lvl===worst&&worst>0);
    const head=worst===0
      ?`<div class="rw-banner rw-ok"><b>No wind or winter weather flags on this route.</b><span>Strongest gust about ${maxG.gust} mph near mile ${Math.round(maxG.mi)}.</span></div>`
      :`<div class="rw-banner ${LVL[worst].cls}"><b>${worst===2?'Dangerous':'Watch'} conditions: ${safe([...new Set(bad.flatMap(p=>p.flags))].join(', '))}</b><span>Miles ${Math.round(bad[0].mi)}–${Math.round(bad[bad.length-1].mi)} · around ${fmtTime(bad[0].eta)}${load==='empty'?' · pulling empty/light':''}</span></div>`;
    box.innerHTML=head+`<div class="rw-table" role="table">
      <div class="rw-tr rw-th" role="row"><span>Mile</span><span>ETA</span><span>Wind / gusts</span><span>Crosswind</span><span>Temp</span><span>Conditions</span></div>
      ${rows.map(p=>`<div class="rw-tr ${LVL[p.lvl].cls}" role="row">
        <span><b>${Math.round(p.mi)}</b></span><span>${fmtTime(p.eta)}</span>
        <span>${p.wind} / <b>${p.gust}</b> mph</span><span>${p.cross} mph</span><span>${p.temp}°F</span>
        <span>${safe(WX[p.code]||'—')}${p.pop?` · ${p.pop}%`:''}${p.flags.length?`<em>${safe(p.flags.join(', '))}</em>`:''}</span></div>`).join('')}
    </div><p class="hint">Gust and crosswind flags are a general guide (empty/light: caution ${LIMITS.empty.caution.gust}+ mph gusts, danger ${LIMITS.empty.danger.gust}+). Follow dispatch and company policy. Forecast: Open-Meteo.</p>`;
  }
  function renderAlerts(list,err){
    const box=el('rwAlerts'); if(!box) return;
    if(err){ box.innerHTML=`<p class="hint">${safe(err)}</p>`; return; }
    if(!list.length){ box.innerHTML='<p class="hint">No active National Weather Service watches or warnings along this route right now.</p>'; return; }
    box.innerHTML=list.map(a=>{
      const sev=a.severity==='Extreme'||a.severity==='Severe'?'rw-bad':(a.severity==='Moderate'?'rw-warn':'rw-ok');
      const lo=Math.round(Math.min(...a.mi)), hi=Math.round(Math.max(...a.mi));
      return `<details class="rw-alert ${sev}"><summary><b>${safe(a.event)}</b><span>${lo===hi?'Near mile '+lo:`Miles ${lo}–${hi}`}${a.ends?' · until '+fmtTime(a.ends):''}</span></summary>
        <p>${safe(a.headline||'')}</p>${a.instruction?`<p class="hint">${safe(a.instruction)}</p>`:''}<p class="hint">${safe(a.area||'')}</p></details>`;
    }).join('')+'<p class="hint">Active right now — National Weather Service. Tap one for details.</p>';
  }
  function renderScales(err){
    const box=el('rwScales'); if(!box) return;
    if(err){ box.innerHTML=`<p class="hint">${safe(err)}</p>`; return; }
    if(!scales.length){ box.innerHTML='<p class="hint">No listed scales on this route yet. Not every scale is in the list — add any you pass from Road &amp; Nearby → Weigh Stations.</p>'; return; }
    box.innerHTML=scales.map(s=>`<div class="nb-item"><div class="nb-main"><div class="nb-name">${safe(s.name)}</div>${LWHScales.controls(s,scaleReports[s.id])}</div>
      <div class="nb-side"><div class="nb-dist">Mile ${Math.round(s.mi)}</div><a class="btn-link ghost nb-go" href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}" target="_blank" rel="noopener">Map</a></div></div>`).join('')
      +'<p class="hint">Open/Closed comes from LWH drivers — tap Report when you pass one. Reports older than 24 hours drop off. Not every scale is listed yet; add missing ones from Road &amp; Nearby → Weigh Stations. Scale locations © OpenStreetMap contributors and LWH drivers.</p>';
  }
  function drawMap(pts){
    const map=window.LWHDistance&&LWHDistance.getMap&&LWHDistance.getMap();
    if(!map||!window.L) return;
    if(layer){ map.removeLayer(layer); layer=null; }
    layer=L.layerGroup();
    const col=['#1a7a1a','#b8860b','#b91c1c'];
    pts.filter(p=>p.gust!=null).forEach(p=>L.circleMarker([p.lat,p.lon],{radius:p.lvl?8:5,color:'#fff',weight:1.5,fillColor:col[p.lvl],fillOpacity:.95})
      .bindPopup(`<b>Mile ${Math.round(p.mi)}</b> · ${fmtTime(p.eta)}<br>Gusts ${p.gust} mph (crosswind ${p.cross})<br>${p.temp}°F ${safe(WX[p.code]||'')}${p.flags.length?'<br><b>'+safe(p.flags.join(', '))+'</b>':''}`).addTo(layer));
    scales.forEach(s=>{ const r=scaleReports[s.id];
      L.circleMarker([s.lat,s.lon],{radius:7,color:'#111',weight:2,fillColor:r?(r.status==='Open'?'#b91c1c':'#1a7a1a'):'#fff',fillOpacity:1})
        .bindPopup(`<b>${safe(s.name)}</b><br>${r?`${r.status} · reported ${fmtTime(r.reported_at)}`:'No report in 24h'}`).addTo(layer); });
    layer.addTo(map);
  }

  // ---------- run ----------
  async function run(){
    if(!last) return;
    const id=++runId, card=el('rwCard'); if(!card) return;
    card.hidden=false;
    const departVal=el('rwDepart').value, departMs=departVal?new Date(departVal).getTime():Date.now();
    const load=el('rwEmpty').checked?'empty':'loaded';
    const {pts,coords,cum}=samplesFor(last.route,departMs,last.dwell);
    el('rwWx').innerHTML='<p class="hint">Checking wind and weather along the route…</p>';
    el('rwAlerts').innerHTML='<p class="hint">Checking National Weather Service alerts…</p>';
    el('rwScales').innerHTML='<p class="hint">Finding weigh stations on the route…</p>';

    const wxP=forecast(pts).then(fcs=>{
      if(id!==runId) return;
      pts.forEach((p,i)=>{ const h=fcs[i]&&pickHour(fcs[i],p.eta); if(h){ Object.assign(p,h); judge(p,load); } });
      renderWx(pts,load); drawMap(pts);
    }).catch(e=>{ if(id===runId) el('rwWx').innerHTML=`<p class="hint">${safe(e.message)} — try Refresh in a minute.</p>`; });

    const alP=alertsAlong(pts).then(l=>{ if(id===runId) renderAlerts(l); }).catch(e=>{ if(id===runId) renderAlerts([],e.message); });

    const scP=Promise.resolve().then(()=>scalesAlong(coords,cum)).then(async list=>{
      if(id!==runId) return; scales=list; scaleReports=await LWHScales.latest(list.map(s=>s.id));
      if(id!==runId) return; renderScales(); drawMap(pts);
    }).catch(e=>{ if(id===runId){ scales=[]; renderScales('Weigh station list unavailable right now.'); } });

    await Promise.all([wxP,alP,scP]);
  }

  window.LWHRouteWx={
    // Called by distance.js after a successful route. dwell[i] = minutes at stop i.
    run(route,dwell){ last={route,dwell:dwell||[]}; const d=el('rwDepart'); if(d&&!d.dataset.touched) d.value=nowLocal(); run(); },
    clear(){
      last=null; runId++; scales=[]; const c=el('rwCard'); if(c) c.hidden=true;
      const map=window.LWHDistance&&LWHDistance.getMap&&LWHDistance.getMap(); if(map&&layer) map.removeLayer(layer); layer=null;
      const d=el('rwDepart'); if(d){ d.value=''; delete d.dataset.touched; }
    },
  };

  window.addEventListener('load',()=>{
    if(!el('rwCard')) return;
    el('rwRefresh').onclick=run;
    el('rwDepart').addEventListener('change',e=>{ e.target.dataset.touched='1'; run(); });
    el('rwEmpty').checked=LWHStorage.get('rwEmpty',false);
    el('rwEmpty').addEventListener('change',e=>{ LWHStorage.set('rwEmpty',e.target.checked); run(); });
    LWHScales.wire(el('rwScales'),sid=>scales.find(s=>s.id===sid),async()=>{ scaleReports=await LWHScales.latest(scales.map(s=>s.id)); renderScales(); });
  });
})();
