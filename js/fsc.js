// Fuel Surcharge Calculator — OOIDA method.
//   Surcharge per gallon = current diesel price - base (peg) price
//   Surcharge per mile   = surcharge per gallon / MPG
//   Trip surcharge       = surcharge per mile x miles
// Optional linehaul rate shows the surcharge as a % of linehaul and the all-in
// rate per mile. Inputs are remembered on the device so a driver only has to
// update the diesel price week to week.
(function(){
  const KEY='fscInputs';
  const IDS=['fscRegion','fscCurrent','fscBase','fscMpg','fscMiles','fscLinehaul'];
  const DEFAULTS={fscRegion:'R20',fscCurrent:'',fscBase:'1.25',fscMpg:'6.5',fscMiles:'',fscLinehaul:''};

  // ---- Weekly EIA diesel price (auto-fill) ----
  // Free key from https://www.eia.gov/opendata/register.php — paste it here.
  // Read-only public data, so it's fine for the key to live in the client.
  const EIA_API_KEY='';
  const REGION_NAMES={R20:'Midwest',R30:'Gulf Coast',NUS:'U.S. average',R10:'East Coast',R40:'Rocky Mountain',R50:'West Coast'};
  const PRICE_CACHE='fscEiaCache';       // {R20:{price,prev,period,fetchedAt}, ...}
  const CACHE_MS=6*60*60*1000;            // EIA posts once a week; 6h keeps it fresh without hammering it
  const fmtWeek=iso=>new Date(iso+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

  async function fetchEia(region){
    const series=`EMD_EPD2D_PTE_${region}_DPG`;   // weekly No. 2 diesel retail, $/gal
    const url='https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key='+encodeURIComponent(EIA_API_KEY)+
      '&frequency=weekly&data[0]=value&facets[series][]='+series+
      '&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=2';
    const res=await fetch(url,{cache:'no-store'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const rows=((await res.json()).response||{}).data||[];
    if(!rows.length) throw new Error('No data returned');
    return {price:+rows[0].value,prev:rows[1]?+rows[1].value:null,period:rows[0].period,fetchedAt:Date.now()};
  }
  function showSource(region,info,note){
    const src=el('fscPriceSource'); if(!src) return;
    if(!info){ src.textContent=note||''; return; }
    let chg='';
    if(info.prev!=null){
      const d=info.price-info.prev;
      chg=Math.abs(d)<0.0005?' · unchanged from last week':` · ${d>0?'up':'down'} ${money(Math.abs(d),3)} from last week`;
    }
    src.textContent=`EIA ${REGION_NAMES[region]} weekly average, week of ${fmtWeek(info.period)}: ${money(info.price,3)}${chg}${note?' · '+note:''}`;
  }
  // force=true: driver tapped the button or changed region, so always fill the
  // box. On plain app load we only fill it if they haven't typed their own.
  async function loadEiaPrice(force){
    const region=el('fscRegion').value||'R20';
    const cache=LWHStorage.get(PRICE_CACHE,{});
    const cached=cache[region];
    const apply=info=>{
      if(force||!LWHStorage.get('fscManualPrice',false)){
        el('fscCurrent').value=info.price.toFixed(3);
        LWHStorage.set('fscManualPrice',false);
        render();
      }
    };
    if(cached&&Date.now()-cached.fetchedAt<CACHE_MS){ showSource(region,cached); apply(cached); return; }
    if(!EIA_API_KEY){ showSource(region,cached,cached?'saved copy':'Auto price is off until an EIA key is added — enter the price manually.'); if(cached) apply(cached); return; }
    showSource(region,null,'Loading this week\'s EIA average…');
    try{
      const info=await fetchEia(region);
      cache[region]=info; LWHStorage.set(PRICE_CACHE,cache);
      showSource(region,info); apply(info);
    }catch(e){
      console.error('EIA price fetch failed',e);
      if(cached){ showSource(region,cached,'offline — showing last saved price'); apply(cached); }
      else showSource(region,null,'Couldn\'t reach EIA right now — enter the price manually.');
    }
  }
  function el(id){ return document.getElementById(id); }
  const money=(n,d=2)=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});

  function save(){
    const v={}; IDS.forEach(id=>{ if(el(id)) v[id]=el(id).value; });
    LWHStorage.set(KEY,v);
  }
  function load(){
    const v=Object.assign({},DEFAULTS,LWHStorage.get(KEY,{}));
    IDS.forEach(id=>{ if(el(id)) el(id).value=v[id]; });
  }

  function scheduleTable(base,mpg,current){
    // Reference schedule: 10-cent steps around the current price, so a driver
    // can see where the surcharge lands if diesel moves this week.
    const start=Math.max(base,Math.floor((current-0.5)*10)/10);
    let rows='';
    for(let i=0;i<11;i++){
      const p=+(start+i*0.10).toFixed(2);
      const cpm=Math.max(0,(p-base)/mpg);
      const isNow=Math.abs(p-current)<0.05;
      rows+=`<tr${isNow?' style="background:var(--brand-tint);font-weight:700"':''}><td style="padding:6px 10px;border-bottom:1px solid var(--line)">${money(p,2)}</td><td style="padding:6px 10px;border-bottom:1px solid var(--line);text-align:right">${money(cpm,3)}</td></tr>`;
    }
    return `<h3 style="margin-top:20px">Surcharge Schedule</h3>
      <p class="hint">At ${mpg} MPG over a ${money(base)} base. Highlighted row is closest to today's price.</p>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:16px">
        <thead><tr><th style="text-align:left;padding:6px 10px;border-bottom:2px solid var(--line)">Diesel $/gal</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid var(--line)">Surcharge / mile</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }

  function render(){
    const out=el('fscOutput'); if(!out) return;
    save();
    const current=parseFloat(el('fscCurrent').value);
    const base=parseFloat(el('fscBase').value);
    const mpg=parseFloat(el('fscMpg').value);
    const miles=parseFloat(el('fscMiles').value)||0;
    const linehaul=parseFloat(el('fscLinehaul').value)||0;
    if(!(current>0)||!(base>=0)||!(mpg>0)){
      out.innerHTML='<p class="hint">Enter the current diesel price, base price, and MPG.</p>';
      return;
    }
    if(current<=base){
      out.innerHTML=`<p class="hint">Diesel at ${money(current,3)} is at or below the ${money(base)} base — no fuel surcharge applies.</p>`;
      return;
    }
    const perGal=current-base;
    const perMile=perGal/mpg;
    let stats=`
      <div><b>${money(perGal,3)}</b><span>Surcharge per gallon</span></div>
      <div><b>${money(perMile,3)}</b><span>Surcharge per mile</span></div>`;
    if(miles>0){
      stats+=`
      <div><b>${(miles/mpg).toFixed(1)}</b><span>Gallons for ${miles.toLocaleString()} mi</span></div>
      <div><b>${money(perMile*miles)}</b><span>Trip fuel surcharge</span></div>`;
    }
    if(linehaul>0){
      stats+=`
      <div><b>${(perMile/linehaul*100).toFixed(1)}%</b><span>Of linehaul rate</span></div>
      <div><b>${money(linehaul+perMile,3)}</b><span>All-in rate per mile</span></div>`;
      if(miles>0) stats+=`<div><b>${money((linehaul+perMile)*miles)}</b><span>All-in trip total</span></div>`;
    }
    out.innerHTML=`
      <div class="stats" style="margin-top:0">${stats}</div>
      <p class="hint" style="margin-top:14px">(${money(current,3)} − ${money(base)}) ÷ ${mpg} MPG = ${money(perMile,3)} per mile.</p>
      ${scheduleTable(base,mpg,current)}`;
  }

  function init(){
    if(!el('fscOutput')) return;
    load();
    IDS.forEach(id=>{ const n=el(id); if(n) n.addEventListener('input',render); });
    el('fscCurrent').addEventListener('input',()=>LWHStorage.set('fscManualPrice',true));
    el('fscRegion').addEventListener('change',()=>{ render(); loadEiaPrice(true); });
    el('fscRefresh').onclick=()=>loadEiaPrice(true);
    el('fscCalc').onclick=render;
    el('fscReset').onclick=()=>{
      LWHStorage.remove(KEY); LWHStorage.set('fscManualPrice',false); load();
      el('fscOutput').innerHTML='<p class="hint">Enter the current diesel price, base price, and MPG.</p>';
      loadEiaPrice(true);
    };
    render();
    loadEiaPrice(false);
  }
  window.addEventListener('load',init);
})();
