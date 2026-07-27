(function(){
  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  let stops=[{v:'',dwell:''},{v:'',dwell:''}]; // v = location text; dwell = optional minutes at that stop (loading/unloading, breaks)
  let map=null, mapLayer=null;
  let lastMiles=null; // drives the Fuel Cost Estimator without re-running geocode/route

  function renderStops(){
    const wrap=el('distStops'); if(!wrap) return;
    wrap.innerHTML=stops.map((s,i)=>{
      const label=i===0?'From':(i===stops.length-1?'To':`Stop ${i+1}`);
      const removable=stops.length>2;
      const dwellField=i>0?`<input data-stop-dwell="${i}" value="${String(s.dwell||'').replace(/"/g,'&quot;')}" placeholder="Dwell (min)" inputmode="numeric" style="max-width:110px" />`:'<span></span>';
      return `<div class="dist-stop-row" style="align-items:center;margin-bottom:6px">
        <input data-stop-idx="${i}" value="${String(s.v||'').replace(/"/g,'&quot;')}" placeholder="${label} — city, state or ZIP" />
        ${dwellField}
        ${removable?`<button type="button" class="ghost" data-remove-stop="${i}">Remove</button>`:'<span></span>'}
      </div>`;
    }).join('');
  }

  // Geocoding: OpenStreetMap Nominatim — free, keyless, but a shared public
  // resource with a fair-use policy (max ~1 request/second). Sequential calls
  // are spaced out below to respect that rather than firing all at once.
  async function geocode(query){
    const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res=await fetch(url,{headers:{'Accept':'application/json'}});
    if(!res.ok) throw new Error(`Geocoding service error for "${query}"`);
    const data=await res.json();
    if(!data.length) throw new Error(`Could not find location "${query}" — try a more specific city/state or ZIP`);
    return {lat:parseFloat(data[0].lat),lon:parseFloat(data[0].lon),label:data[0].display_name,query};
  }
  async function geocodeAll(queries){
    const results=[];
    for(let i=0;i<queries.length;i++){
      if(i>0) await new Promise(r=>setTimeout(r,1100)); // respect Nominatim's ~1 req/sec fair-use policy
      results.push(await geocode(queries[i]));
    }
    return results;
  }

  // Driving route: OSRM's free public demo server — also free/keyless, also
  // a shared demo instance with no uptime guarantee (unlike a paid routing API).
  async function routeDistance(points){
    const coordStr=points.map(p=>`${p.lon},${p.lat}`).join(';');
    const url=`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const res=await fetch(url);
    if(!res.ok) throw new Error('Routing service error — it may be temporarily unavailable, try again shortly');
    const data=await res.json();
    if(data.code!=='Ok'||!data.routes||!data.routes.length) throw new Error('No drivable route found between those points');
    return data.routes[0];
  }

  function haversineMiles(a,b){
    const R=3958.8;
    const dLat=(b.lat-a.lat)*Math.PI/180, dLon=(b.lon-a.lon)*Math.PI/180;
    const lat1=a.lat*Math.PI/180, lat2=b.lat*Math.PI/180;
    const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }
  function metersToMiles(m){ return m/1609.344; }
  function secondsToHm(s){ const h=Math.floor(s/3600), m=Math.round((s%3600)/60); return h?`${h}h ${m}m`:`${m}m`; }

  function renderMap(points,routeGeojson){
    const mapDiv=el('distMap'); if(!mapDiv||!window.L) return;
    mapDiv.style.display='block';
    if(!map){ map=L.map(mapDiv); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors',maxZoom:18}).addTo(map); }
    if(mapLayer) map.removeLayer(mapLayer);
    const group=L.featureGroup();
    points.forEach((p,i)=>{ L.marker([p.lat,p.lon]).bindPopup(`${i+1}. ${safe(p.query)}`).addTo(group); });
    if(routeGeojson) L.geoJSON(routeGeojson,{style:{color:'#0f4a45',weight:4}}).addTo(group);
    group.addTo(map);
    mapLayer=group;
    setTimeout(()=>{ map.invalidateSize(); map.fitBounds(group.getBounds(),{padding:[30,30]}); },50);
  }

  function calcFuelCost(){
    const costEl=el('distFuelCost'), detailEl=el('distFuelDetail');
    if(!costEl) return;
    if(lastMiles==null){ costEl.textContent='—'; detailEl.textContent='Calculate a route above first'; return; }
    const mpg=parseFloat((el('distMpg')||{}).value), price=parseFloat((el('distFuelPrice')||{}).value);
    if(!mpg||!price){ costEl.textContent='—'; detailEl.textContent='Enter MPG and fuel price to estimate cost'; return; }
    const gallons=lastMiles/mpg;
    const cost=gallons*price;
    costEl.textContent='$'+cost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    detailEl.textContent=`${Math.round(lastMiles).toLocaleString()} mi ÷ ${mpg} mpg = ${gallons.toFixed(1)} gal × $${price}/gal`;
  }

  async function calculate(){
    const status=el('distStatus'), totalMiles=el('distTotalMiles'), totalDetail=el('distTotalDetail'), legsWrap=el('distLegs');
    const dayTotal=el('distDayTotal'), dayDetail=el('distDayDetail');
    const usableStops=stops.filter(s=>(s.v||'').trim());
    const queries=usableStops.map(s=>s.v.trim());
    if(queries.length<2){ status.textContent='Enter at least a From and To.'; return; }
    status.textContent='Looking up locations…';
    totalMiles.textContent='—'; totalDetail.textContent='—'; legsWrap.innerHTML='';
    if(dayTotal){ dayTotal.textContent='—'; dayDetail.textContent='—'; dayTotal.style.color=''; }
    try{
      const points=await geocodeAll(queries);
      status.textContent='Calculating route…';
      let route=null, routeError=null;
      try{ route=await routeDistance(points); }
      catch(e){ routeError=e.message; }

      const legs=[];
      for(let i=0;i<points.length-1;i++){
        const straight=haversineMiles(points[i],points[i+1]);
        const driveLeg=route&&route.legs&&route.legs[i]?metersToMiles(route.legs[i].distance):null;
        legs.push({from:points[i].query,to:points[i+1].query,straight,driveLeg});
      }
      const straightTotal=legs.reduce((s,l)=>s+l.straight,0);

      // Sum any dwell time entered at intermediate/end stops (not the starting "From")
      const totalDwellMin=usableStops.slice(1).reduce((sum,s)=>sum+(parseInt(s.dwell)||0),0);

      if(route){
        totalMiles.textContent=Math.round(metersToMiles(route.distance)).toLocaleString()+' mi';
        totalDetail.textContent=`Driving distance · ~${secondsToHm(route.duration)} drive time · ${Math.round(straightTotal).toLocaleString()} mi straight-line`;
        lastMiles=metersToMiles(route.distance);

        if(dayTotal){
          const driveSeconds=route.duration;
          const totalSeconds=driveSeconds+totalDwellMin*60;
          dayTotal.textContent=secondsToHm(totalSeconds);
          const driveHours=driveSeconds/3600;
          let hosNote='';
          if(driveHours>11) hosNote=' — driving time alone is over the 11-hour daily limit';
          else if(driveHours>9) hosNote=' — getting close to the 11-hour daily driving limit';
          dayTotal.style.color=driveHours>11?'var(--bad)':(driveHours>9?'#b8860b':'var(--good)');
          dayDetail.textContent=`${secondsToHm(driveSeconds)} driving${totalDwellMin?` + ${secondsToHm(totalDwellMin*60)} dwell (entered)`:''}${hosNote}`;
        }
      } else {
        totalMiles.textContent=Math.round(straightTotal).toLocaleString()+' mi (straight-line)';
        totalDetail.textContent=`Driving route unavailable right now (${routeError}) — showing straight-line distance only`;
        lastMiles=straightTotal;
        if(dayTotal){ dayTotal.textContent='—'; dayDetail.textContent='Drive time needs a working route — unavailable right now'; }
      }
      calcFuelCost();

      legsWrap.innerHTML=legs.map(l=>`<div class="result-card"><div><b>${safe(l.from)}</b> → <b>${safe(l.to)}</b></div><div>${l.driveLeg!=null?`${Math.round(l.driveLeg).toLocaleString()} mi driving`:`${Math.round(l.straight).toLocaleString()} mi straight-line`}</div></div>`).join('');

      status.textContent=`${points.length} stop(s) found.`;
      renderMap(points,route?route.geometry:null);
    }catch(e){
      status.textContent='Error: '+e.message;
    }
  }

  window.addEventListener('load',()=>{
    if(!el('distStops')) return;
    renderStops();
    el('distStops').addEventListener('input',e=>{
      const t=e.target;
      if(t.dataset.stopIdx!==undefined){ stops[+t.dataset.stopIdx].v=t.value; return; }
      if(t.dataset.stopDwell!==undefined){ stops[+t.dataset.stopDwell].dwell=t.value; return; }
    });
    el('distStops').addEventListener('click',e=>{
      const b=e.target.closest('[data-remove-stop]'); if(!b) return;
      stops.splice(+b.dataset.removeStop,1);
      renderStops();
    });
    const addBtn=el('distAddStop'); if(addBtn) addBtn.onclick=()=>{ stops.splice(stops.length-1,0,{v:'',dwell:''}); renderStops(); };
    const calcBtn=el('distCalc'); if(calcBtn) calcBtn.onclick=calculate;
    const mpgEl=el('distMpg'), priceEl=el('distFuelPrice');
    if(mpgEl) mpgEl.addEventListener('input',calcFuelCost);
    if(priceEl) priceEl.addEventListener('input',calcFuelCost);

    window.LWHToolClear=window.LWHToolClear||{};
    window.LWHToolClear.distance=()=>{
      stops=[{v:'',dwell:''},{v:'',dwell:''}];
      renderStops();
      if(mpgEl) mpgEl.value='';
      if(priceEl) priceEl.value='';
      lastMiles=null;
      const ids=['distStatus','distTotalMiles','distTotalDetail','distDayTotal','distDayDetail','distFuelCost','distFuelDetail','distLegs'];
      ids.forEach(id=>{ const e=el(id); if(e) e.textContent = id==='distStatus' ? 'Enter at least a From and To.' : (id==='distLegs' ? '' : '—'); });
      const mapEl=el('distMap'); if(mapEl){ mapEl.style.display='none'; mapEl.innerHTML=''; }
    };
  });
})();
