(function(){
  function el(id){ return document.getElementById(id); }
  function fmtHrs(h){
    if(h<=0) return '0h 0m';
    const totalMin=Math.round(h*60);
    return `${Math.floor(totalMin/60)}h ${totalMin%60}m`;
  }
  function nowFraction(){
    const d=new Date();
    return d.getHours()+d.getMinutes()/60;
  }
  function parseTimeToHours(v){
    if(!v) return null;
    const [h,m]=v.split(':').map(Number);
    if(isNaN(h)||isNaN(m)) return null;
    return h+m/60;
  }
  function hoursSinceStart(startHours){
    let now=nowFraction();
    let diff=now-startHours;
    if(diff<0) diff+=24; // shift crossed midnight
    return diff;
  }
  function render(){
    const out=el('hosOutput'); if(!out) return;
    const cycleLimit=+el('hosCycle').value;
    const startVal=el('hosStart').value;
    const driving=+el('hosDriving').value||0;
    const onDuty=+el('hosOnDuty').value||0;
    const cycleHours=+el('hosCycleHours').value||0;

    const drivingRemaining=Math.max(0,11-driving);
    let windowRemaining=null;
    if(startVal){
      const startHours=parseTimeToHours(startVal);
      const elapsed=hoursSinceStart(startHours);
      windowRemaining=Math.max(0,14-elapsed);
    }
    const totalOnDutyToday=driving+onDuty;
    const cycleRemaining=Math.max(0,cycleLimit-(cycleHours+totalOnDutyToday));

    const limits=[
      {label:'11-hour driving limit',value:drivingRemaining},
      ...(windowRemaining!==null?[{label:'14-hour on-duty window',value:windowRemaining}]:[]),
      {label:`${cycleLimit}-hour/${cycleLimit===70?8:7}-day cycle`,value:cycleRemaining}
    ];
    const binding=limits.reduce((a,b)=>b.value<a.value?b:a,limits[0]);

    out.innerHTML=`
      <div style="margin-bottom:10px"><span class="hint">Most limiting factor right now:</span><h2 style="margin:4px 0;color:${binding.value<=1?'var(--bad)':'var(--brand)'}">${fmtHrs(binding.value)} — ${binding.label}</h2></div>
      <div class="stats">
        ${limits.map(l=>`<div><b style="color:${l.value<=1?'var(--bad)':'var(--ink)'}">${fmtHrs(l.value)}</b><span>${l.label}</span></div>`).join('')}
      </div>
      <p class="hint" style="margin-top:14px">This is a reference estimate based on what you entered — it does not read your ELD and is not a legal record of hours. Always confirm against your actual ELD before driving.</p>
    `;
  }
  el('hosCycle')&&el('hosCycle').addEventListener('change',()=>{ el('hosCycleLabel').textContent=el('hosCycle').value==='70'?'8-day':'7-day'; render(); });
  el('hosCalc')&&(el('hosCalc').onclick=render);
  el('hosReset')&&(el('hosReset').onclick=()=>{
    el('hosStart').value=''; el('hosDriving').value=0; el('hosOnDuty').value=0; el('hosCycleHours').value=0;
    el('hosOutput').innerHTML='<p class="hint">Enter your shift details and tap Update.</p>';
  });
  // Auto-refresh every minute while the tab is open so the 14-hour window stays live
  setInterval(()=>{ if(document.getElementById('hos')&&document.getElementById('hos').classList.contains('active')) render(); },60000);
})();
