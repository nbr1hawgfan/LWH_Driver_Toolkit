// Fuel Surcharge Calculator — OOIDA method.
//   Surcharge per gallon = current diesel price - base (peg) price
//   Surcharge per mile   = surcharge per gallon / MPG
//   Trip surcharge       = surcharge per mile x miles
// Optional linehaul rate shows the surcharge as a % of linehaul and the all-in
// rate per mile. Inputs are remembered on the device so a driver only has to
// update the diesel price week to week.
(function(){
  const KEY='fscInputs';
  const IDS=['fscCurrent','fscBase','fscMpg','fscMiles','fscLinehaul'];
  const DEFAULTS={fscCurrent:'',fscBase:'1.25',fscMpg:'6.5',fscMiles:'',fscLinehaul:''};
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
    el('fscCalc').onclick=render;
    el('fscReset').onclick=()=>{
      LWHStorage.remove(KEY); load();
      el('fscOutput').innerHTML='<p class="hint">Enter the current diesel price, base price, and MPG.</p>';
    };
    render();
  }
  window.addEventListener('load',init);
})();
