(function(){
  let map=null, frames=[], activeIdx=0, timer=null, tileLayer=null, initialized=false;
  const TILE_SIZE=256;
  const RADAR_OPACITY=0.75;

  function el(id){ return document.getElementById(id); }

  function frameLayer(frame){
    return L.tileLayer(`https://tilecache.rainviewer.com${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/2/1_1.png`,{
      opacity:RADAR_OPACITY, zIndex:10
    });
  }

  function showFrame(idx){
    if(!frames.length) return;
    activeIdx=(idx+frames.length)%frames.length;
    const frame=frames[activeIdx];
    const next=frameLayer(frame);
    next.addTo(map);
    if(tileLayer) map.removeLayer(tileLayer);
    tileLayer=next;
    const d=new Date(frame.time*1000);
    const label=frame.isForecast?'Forecast: ':'';
    if(el('radarTimestamp')) el('radarTimestamp').textContent=label+d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  }

  function play(){
    if(timer) return;
    el('radarPlay').textContent='⏸ Pause';
    timer=setInterval(()=>showFrame(activeIdx+1),700);
  }
  function stop(){
    clearInterval(timer); timer=null;
    if(el('radarPlay')) el('radarPlay').textContent='▶ Play';
  }

  async function loadFrames(){
    try{
      const res=await fetch('https://api.rainviewer.com/public/weather-maps.json',{cache:'no-store'});
      const data=await res.json();
      const past=(data.radar&&data.radar.past)||[];
      const nowcast=(data.radar&&data.radar.nowcast)||[];
      frames=[...past.map(f=>({...f,isForecast:false})), ...nowcast.map(f=>({...f,isForecast:true}))];
      activeIdx=past.length?past.length-1:0; // start on the most recent actual observation
      showFrame(activeIdx);
    }catch(e){
      if(el('radarTimestamp')) el('radarTimestamp').textContent='Radar unavailable right now.';
      console.error('RainViewer fetch failed',e);
    }
  }

  function initMap(){
    if(initialized) return;
    initialized=true;
    const loc=(window.parseWeatherLoc && window.LWHStorage)
      ? parseWeatherLoc(LWHStorage.get('weatherLoc',''))
      : {lat:35.3859,lon:-94.3985};
    map=L.map('radarMap').setView([loc.lat,loc.lon],7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'&copy; OpenStreetMap contributors', maxZoom:12
    }).addTo(map);
    loadFrames();
    setInterval(loadFrames,5*60*1000); // RainViewer refreshes roughly every 5 minutes
  }

  el('radarPlay')&&(el('radarPlay').onclick=()=>{ timer?stop():play(); });
  el('radarPrev')&&(el('radarPrev').onclick=()=>{ stop(); showFrame(activeIdx-1); });
  el('radarNext')&&(el('radarNext').onclick=()=>{ stop(); showFrame(activeIdx+1); });

  // Lazy-init: only build the Leaflet map once the Radar nav item is actually
  // clicked, since Leaflet mis-sizes a map created inside a hidden (display:
  // none) container.
  document.addEventListener('click',e=>{
    const v=e.target.closest('[data-view="radar"]');
    if(v){
      setTimeout(()=>{
        initMap();
        if(map) map.invalidateSize();
      },50);
    }
  });
})();
