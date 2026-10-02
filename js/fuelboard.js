// Fuel Price Board — the EIA "Gasoline and Diesel Fuel Update" table, in-app.
// One API call pulls ~2 years of weekly prices for every region, which covers
// the 3-week table, the week / year / 2-year change columns, and the chart.
// Cached on the device so it still shows the last pull with no signal.
(function(){
  const REGIONS=[
    {code:'NUS',  name:'U.S.',                       sub:false},
    {code:'R10',  name:'East Coast (PADD 1)',        sub:false},
    {code:'R1X',  name:'New England (PADD 1A)',      sub:true},
    {code:'R1Y',  name:'Central Atlantic (PADD 1B)', sub:true},
    {code:'R1Z',  name:'Lower Atlantic (PADD 1C)',   sub:true},
    {code:'R20',  name:'Midwest (PADD 2)',           sub:false},
    {code:'R30',  name:'Gulf Coast (PADD 3)',        sub:false},
    {code:'R40',  name:'Rocky Mountain (PADD 4)',    sub:false},
    {code:'R50',  name:'West Coast (PADD 5)',        sub:false},
    {code:'SCA',  name:'California',                 sub:true},
    {code:'R5XCA',name:'West Coast less California', sub:true}
  ];
  const SHORT={NUS:'U.S.',R10:'East Coast',R1X:'New England',R1Y:'Central Atlantic',R1Z:'Lower Atlantic',R20:'Midwest',R30:'Gulf Coast',R40:'Rocky Mountain',R50:'West Coast',SCA:'California',R5XCA:'West Coast less CA'};
  const PRODUCTS={
    diesel:{label:'On-Highway Diesel',prefix:'EMD_EPD2D_PTE_'},
    gas:{label:'Regular Gasoline',prefix:'EMM_EPMR_PTE_'}
  };
  const COLORS=['#1f6fb2','#c8102e','#1a7a1a','#e08a00','#6a3fb5','#0a8f8f','#7a5230','#d6336c','#495057','#2b8a3e','#5c7cfa'];
  const CACHE='fuelBoardCache', CACHE_MS=6*60*60*1000;
  const PREFS='fuelBoardPrefs';
  let product='diesel', data={}, chartRange=52, selected=['NUS','R20','R30'];

  const el=id=>document.getElementById(id);
  const money=(n,d=3)=>'$'+n.toFixed(d);
  const DAY=86400000;
  const toDate=iso=>new Date(iso+'T00:00:00');
  const fmtShort=iso=>{const d=toDate(iso);return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;};
  const fmtLong=iso=>toDate(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

  // ---------- Data ----------
  async function fetchProduct(prod){
    const key=(window.LWHEIA&&LWHEIA.key)||'';
    if(!key) throw new Error('NO_KEY');
    const start=new Date(Date.now()-(2*365+35)*DAY).toISOString().slice(0,10);
    let url='https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key='+encodeURIComponent(key)+
      '&frequency=weekly&data[0]=value&start='+start+
      '&sort[0][column]=period&sort[0][direction]=asc&offset=0&length=5000';
    REGIONS.forEach(r=>{ url+='&facets[series][]='+PRODUCTS[prod].prefix+r.code+'_DPG'; });
    const res=await fetch(url,{cache:'no-store'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const rows=((await res.json()).response||{}).data||[];
    if(!rows.length) throw new Error('No data returned');
    const out={};
    rows.forEach(r=>{
      const code=String(r.series||'').replace(PRODUCTS[prod].prefix,'').replace('_DPG','');
      const v=parseFloat(r.value);
      if(!code||isNaN(v)) return;
      (out[code]=out[code]||[]).push({p:r.period,v});
    });
    Object.values(out).forEach(a=>a.sort((x,y)=>x.p<y.p?-1:1));
    return out;
  }
  async function load(force){
    const status=el('fbStatus');
    const cache=LWHStorage.get(CACHE,{});
    const c=cache[product];
    if(!force&&c&&Date.now()-c.at<CACHE_MS){ data=c.series; render(); status.textContent=''; return; }
    if(c){ data=c.series; render(); }
    status.textContent='Loading latest EIA prices…';
    try{
      const series=await fetchProduct(product);
      data=series; cache[product]={series,at:Date.now()};
      LWHStorage.set(CACHE,cache);
      status.textContent='';
      render();
    }catch(e){
      if(e.message==='NO_KEY'){ status.textContent='Add your EIA API key in js/eia.js to turn on the price board.'; return; }
      console.error('Fuel board fetch failed',e);
      status.textContent=c?`Couldn't reach EIA — showing prices saved ${new Date(c.at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}.`:'Couldn\'t reach EIA right now. Try Refresh in a minute.';
    }
  }

  // value at a date N days before the latest week (closest week within 4 days)
  function valueAgo(arr,days){
    if(!arr||!arr.length) return null;
    const target=toDate(arr[arr.length-1].p).getTime()-days*DAY;
    let best=null,bestD=Infinity;
    for(const x of arr){ const d=Math.abs(toDate(x.p).getTime()-target); if(d<bestD){bestD=d;best=x;} }
    return bestD<=4*DAY?best.v:null;
  }
  function changeCell(cur,prev){
    if(cur==null||prev==null) return '<td class="fb-num fb-na">—</td>';
    const d=cur-prev;
    if(Math.abs(d)<0.0005) return '<td class="fb-num">0.000</td>';
    return `<td class="fb-num ${d>0?'fb-up':'fb-down'}"><span aria-hidden="true">${d>0?'▲':'▼'}</span> ${Math.abs(d).toFixed(3)}<span class="sr-only">${d>0?' up':' down'}</span></td>`;
  }
  function fscSettings(){
    const f=LWHStorage.get('fscInputs',{})||{};
    const base=parseFloat(f.fscBase), mpg=parseFloat(f.fscMpg);
    return {base:isNaN(base)?1.25:base, mpg:isNaN(mpg)||mpg<=0?6.5:mpg};
  }

  // ---------- Table ----------
  function renderTable(){
    const us=data.NUS||Object.values(data)[0];
    if(!us||us.length<3){ el('fbTable').innerHTML=''; return; }
    const weeks=us.slice(-3).map(x=>x.p);
    const showFsc=product==='diesel';
    const {base,mpg}=fscSettings();
    el('fbHeading').textContent=`U.S. ${PRODUCTS[product].label} Prices (dollars per gallon)`;
    el('fbWeekOf').textContent=`Week of ${fmtLong(weeks[2])} · EIA updates weekly, usually Monday afternoon`;
    let rows='';
    REGIONS.forEach(r=>{
      const arr=data[r.code]; if(!arr||!arr.length) return;
      const byP=Object.fromEntries(arr.map(x=>[x.p,x.v]));
      const cur=byP[weeks[2]];
      const fsc=showFsc&&cur!=null?Math.max(0,(cur-base)/mpg):null;
      rows+=`<tr class="${r.sub?'fb-sub':''}">
        <th scope="row"><span class="fb-long">${r.name}</span><span class="fb-short">${SHORT[r.code]}</span></th>
        ${weeks.map((w,i)=>`<td class="fb-num${i===2?' fb-cur':' fb-wide'}">${byP[w]!=null?byP[w].toFixed(3):'—'}</td>`).join('')}
        ${changeCell(cur,valueAgo(arr,728)).replace('class="fb-num','class="fb-num fb-wide')}${changeCell(cur,valueAgo(arr,364))}${changeCell(cur,byP[weeks[1]])}
        ${showFsc?`<td class="fb-num fb-fsc">${fsc!=null?money(fsc):'—'}</td>`:''}
      </tr>`;
    });
    el('fbTable').innerHTML=`<table class="fb-table">
      <thead>
        <tr><th></th><th colspan="3" class="fb-grp fb-wide">Price</th><th class="fb-grp fb-narrow">Price</th><th colspan="3" class="fb-grp fb-wide">Change from</th><th colspan="2" class="fb-grp fb-narrow">Change from</th>${showFsc?'<th class="fb-grp">Surcharge</th>':''}</tr>
        <tr><th scope="col">Region</th>${weeks.map((w,i)=>`<th scope="col" class="fb-num${i<2?' fb-wide':''}">${fmtShort(w)}</th>`).join('')}<th scope="col" class="fb-num fb-wide">2 yr ago</th><th scope="col" class="fb-num">Year ago</th><th scope="col" class="fb-num">Week ago</th>${showFsc?'<th scope="col" class="fb-num">Per mile</th>':''}</tr>
      </thead><tbody>${rows}</tbody></table>`;
    el('fbFscNote').hidden=!showFsc;
    el('fbFscNote').textContent=`Surcharge per mile uses the Fuel Surcharge tab's settings: ${money(base,2)} base, ${mpg} MPG.`;
  }

  // ---------- Chart (plain SVG, works offline) ----------
  function niceStep(span){ const raw=span/4, mag=Math.pow(10,Math.floor(Math.log10(raw))); const n=raw/mag; return (n<1.5?1:n<3?2:n<7?5:10)*mag; }
  function renderChart(){
    const svgWrap=el('fbChart');
    const series=selected.filter(c=>data[c]&&data[c].length).map(c=>({c,pts:data[c].slice(-chartRange)}));
    if(!series.length){ svgWrap.innerHTML='<p class="hint">Pick at least one region below.</p>'; renderLegend(); return; }
    // Size the SVG to its box so labels stay a readable real-pixel size on phones.
    const W=Math.max(300,Math.round(svgWrap.clientWidth||720)), H=W<520?240:320, L=58,R=14,T=14,B=38;
    const all=series.flatMap(s=>s.pts.map(p=>p.v));
    let lo=Math.min(...all), hi=Math.max(...all);
    const step=niceStep(Math.max(hi-lo,0.2));
    lo=Math.floor(lo/step)*step; hi=Math.ceil(hi/step)*step;
    const t0=toDate(series[0].pts[0].p).getTime(), t1=toDate(series[0].pts[series[0].pts.length-1].p).getTime();
    const x=t=>L+(W-L-R)*((t-t0)/Math.max(1,t1-t0));
    const y=v=>T+(H-T-B)*(1-(v-lo)/Math.max(0.0001,hi-lo));
    let g='';
    for(let v=lo;v<=hi+1e-9;v+=step){ g+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e0e4"/><text x="${L-8}" y="${y(v)+5}" text-anchor="end" font-size="14" fill="#5c5c6b">$${v.toFixed(2)}</text>`; }
    // month ticks: every month for 3 mo, every 3 months for 1 yr, every 6 for 2 yr
    const every=(chartRange<=13?1:chartRange<=52?3:6)*(W<520&&chartRange>13?2:1);
    const d=new Date(t0); d.setDate(1); d.setMonth(d.getMonth()+1);
    while(d.getTime()<=t1){
      if(d.getMonth()%every===0||every===1){
        const xx=x(d.getTime());
        g+=`<line x1="${xx}" x2="${xx}" y1="${H-B}" y2="${H-B+5}" stroke="#999"/><text x="${xx}" y="${H-B+22}" text-anchor="middle" font-size="14" fill="#5c5c6b">${d.toLocaleDateString('en-US',{month:'short'})}${d.getMonth()===0?" '"+String(d.getFullYear()).slice(2):''}</text>`;
      }
      d.setMonth(d.getMonth()+1);
    }
    const lines=series.map(s=>{
      const col=COLORS[REGIONS.findIndex(r=>r.code===s.c)%COLORS.length];
      const path=s.pts.map((p,i)=>`${i?'L':'M'}${x(toDate(p.p).getTime()).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
      const last=s.pts[s.pts.length-1];
      return `<path d="${path}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${x(toDate(last.p).getTime())}" cy="${y(last.v)}" r="4" fill="${col}"/>`;
    }).join('');
    svgWrap.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${PRODUCTS[product].label} price trend" style="width:100%;height:auto;display:block">${g}<line x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}" stroke="#999"/>${lines}</svg>`;
    renderLegend();
  }
  function renderLegend(){
    el('fbLegend').innerHTML=REGIONS.filter(r=>data[r.code]).map((r,i)=>{
      const on=selected.includes(r.code), col=COLORS[REGIONS.indexOf(r)%COLORS.length];
      return `<button type="button" class="fb-chip${on?' on':''}" data-region="${r.code}" aria-pressed="${on}" style="--chip:${col}"><span class="fb-swatch"></span>${SHORT[r.code]}</button>`;
    }).join('');
  }

  // ---------- Customer summary ----------
  function summaryText(){
    const us=data.NUS; if(!us||!us.length) return '';
    const week=us[us.length-1].p;
    const {base,mpg}=fscSettings();
    const incFsc=product==='diesel'&&el('fbIncludeFsc').checked;
    const regions=(selected.length?selected:['NUS']).filter(c=>data[c]);
    const lines=[`EIA ${PRODUCTS[product].label} — week of ${fmtLong(week)}`,''];
    regions.forEach(c=>{
      const arr=data[c], cur=arr[arr.length-1].v, wk=arr.length>1?arr[arr.length-2].v:null, yr=valueAgo(arr,364);
      const ch=(a,b,label)=>b==null?'':`${a-b>=0?'up':'down'} ${money(Math.abs(a-b))} vs ${label}`;
      const parts=[ch(cur,wk,'last week'),ch(cur,yr,'a year ago')].filter(Boolean).join(', ');
      lines.push(`${SHORT[c]}: ${money(cur)}/gal${parts?' ('+parts+')':''}`);
      if(incFsc) lines.push(`   Fuel surcharge: ${money(Math.max(0,(cur-base)/mpg))}/mile`);
    });
    if(incFsc) lines.push('',`Surcharge figured at a ${money(base,2)} base and ${mpg} MPG.`);
    lines.push('','Source: U.S. Energy Information Administration (eia.gov)');
    return lines.join('\n');
  }

  function render(){ renderTable(); renderChart(); el('fbSummary').textContent=summaryText(); el('fbFscWrap').hidden=product!=='diesel'; }
  function savePrefs(){ LWHStorage.set(PREFS,{product,chartRange,selected}); }

  function init(){
    if(!el('fuelboard')) return;
    const p=LWHStorage.get(PREFS,null);
    if(p){ product=p.product||product; chartRange=p.chartRange||chartRange; selected=Array.isArray(p.selected)?p.selected:selected; }
    document.querySelectorAll('[data-fbprod]').forEach(b=>{
      b.classList.toggle('active',b.dataset.fbprod===product);
      b.onclick=()=>{ product=b.dataset.fbprod; document.querySelectorAll('[data-fbprod]').forEach(x=>x.classList.toggle('active',x===b)); savePrefs(); data={}; load(false); };
    });
    document.querySelectorAll('[data-fbrange]').forEach(b=>{
      b.classList.toggle('active',+b.dataset.fbrange===chartRange);
      b.onclick=()=>{ chartRange=+b.dataset.fbrange; document.querySelectorAll('[data-fbrange]').forEach(x=>x.classList.toggle('active',x===b)); savePrefs(); renderChart(); };
    });
    el('fbLegend').addEventListener('click',e=>{
      const b=e.target.closest('[data-region]'); if(!b) return;
      const c=b.dataset.region;
      selected=selected.includes(c)?selected.filter(x=>x!==c):[...selected,c];
      savePrefs(); renderChart(); el('fbSummary').textContent=summaryText();
    });
    el('fbIncludeFsc').addEventListener('change',()=>{ el('fbSummary').textContent=summaryText(); });
    el('fbRefresh').onclick=()=>load(true);
    el('fbCopy').onclick=async()=>{
      try{ await navigator.clipboard.writeText(summaryText()); LWHUI.toast('Copied — paste into your email or text'); }
      catch(e){ LWHUI.toast('Copy not allowed here — long-press the summary to copy'); }
    };
    el('fbShare').onclick=async()=>{
      const text=summaryText();
      if(navigator.share){ try{ await navigator.share({title:'Fuel Prices',text}); }catch(e){} }
      else location.href=`mailto:?subject=${encodeURIComponent('Weekly Fuel Prices')}&body=${encodeURIComponent(text)}`;
    };
    // Lazy: only pull from EIA the first time someone opens the board.
    let loaded=false;
    const tryLoad=()=>{ if(!loaded&&el('fuelboard').classList.contains('active')){ loaded=true; load(false); } };
    new MutationObserver(tryLoad).observe(el('fuelboard'),{attributes:true,attributeFilter:['class']});
    tryLoad();
    let rz; window.addEventListener('resize',()=>{ clearTimeout(rz); rz=setTimeout(()=>{ if(Object.keys(data).length) renderChart(); },200); });
  }
  window.addEventListener('load',init);
})();
