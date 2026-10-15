// Yard Board (Dispatch) — every yard's latest synced Yard Check, with how
// many days each trailer has been sitting there. Reads the yard-check-history
// edge function; the days-on-yard math is shared with yardcheck.js.
(function(){
  const el=id=>document.getElementById(id);
  let yards=[], loaded=false;

  function status(t){ const s=el('ybStatus'); if(s) s.textContent=t; }
  const fmt=t=>new Date(t).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

  function build(checks){
    const Y=window.LWHYard, by={};
    checks.forEach(c=>{ const k=c.location_key||Y.locKey(c.location); (by[k]=by[k]||[]).push(c); });
    return Object.values(by).map(list=>{
      list.sort((a,b)=>new Date(b.checked_at)-new Date(a.checked_at));
      const latest=list[0], asOf=new Date(latest.checked_at).getTime();
      const earlier=Y.normChecks(list.slice(1));
      const trailers=(latest.trailers||[]).map(t=>{
        const first=Y.since(t.trailer,earlier,asOf);
        const days=first?Y.calDays(first,asOf):0;
        return {trailer:t.trailer,status:t.status||'',note:t.note||'',days,since:first||asOf};
      }).sort((a,b)=>b.days-a.days||a.trailer.localeCompare(b.trailer,undefined,{numeric:true}));
      return {name:latest.location||'(no location)',latest,checks:list.length,trailers};
    }).sort((a,b)=>new Date(b.latest.checked_at)-new Date(a.latest.checked_at));
  }

  async function load(){
    status('Loading yard checks…');
    try{
      const res=await fetch(window.LWHYard.HISTORY_URL,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:500})});
      if(!res.ok){ const b=await res.json().catch(()=>({})); throw new Error(b.error||('HTTP '+res.status)); }
      const body=await res.json();
      yards=build(body.checks||[]); loaded=true;
      status(yards.length?`${yards.length} yard${yards.length===1?'':'s'} · ${(body.checks||[]).length} checks loaded · ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`:'No yard checks synced yet.');
      render();
    }catch(e){ status('Load failed: '+e.message+' — check your connection, or the yard-check-history function may not be deployed yet.'); console.error(e); }
  }

  function render(){
    const q=(el('ybSearch').value||'').trim().toLowerCase(), minDays=+el('ybMinDays').value||0;
    const S=LWHUI.safe;
    const out=yards.map(y=>{
      const nameHit=!q||y.name.toLowerCase().includes(q);
      const rows=y.trailers.filter(t=>t.days>=minDays&&(nameHit||t.trailer.toLowerCase().includes(q)||t.note.toLowerCase().includes(q)));
      if(!rows.length) return '';
      const L=y.trailers.filter(t=>t.status==='Loaded').length, E=y.trailers.filter(t=>t.status==='Empty').length;
      const pin=y.latest.pin?` · <a href="${S(y.latest.pin)}" target="_blank" rel="noopener">Map</a>`:'';
      return `<div class="card yb-yard">
        <h3 style="margin:0 0 4px">${S(y.name)}</h3>
        <div class="hint">Last check ${fmt(y.latest.checked_at)}${y.latest.driver?' by '+S(y.latest.driver):''} · ${y.trailers.length} trailer${y.trailers.length===1?'':'s'} (${L} loaded, ${E} empty) · ${y.checks} check${y.checks===1?'':'s'} on file${pin}</div>
        <table class="yb-table"><thead><tr><th>Trailer</th><th>Status</th><th>On yard</th><th>Product / note</th></tr></thead><tbody>
        ${rows.map(t=>`<tr class="${t.days>=7?'long':''}"><td><b>${S(t.trailer)}</b></td><td>${S(t.status||'—')}</td><td>${t.days>=1?`${t.days} day${t.days===1?'':'s'}<br><span class="hint">since ${new Date(t.since).toLocaleDateString([], {month:'short',day:'numeric'})}</span>`:'<span class="hint">new</span>'}</td><td>${S(t.note)}</td></tr>`).join('')}
        </tbody></table>
        ${y.latest.notes?`<p class="hint" style="margin:8px 0 0"><b>Yard notes:</b> ${S(y.latest.notes)}</p>`:''}
      </div>`;
    }).join('');
    el('ybResults').innerHTML=out||(loaded?'<p class="hint">No trailers match.</p>':'');
  }

  function csv(){
    if(!yards.length){ LWHUI.toast('Load the yard checks first'); return; }
    const esc=v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`;
    const lines=[['Yard','Trailer','Status','Days on yard','On yard since','Product / note','Last check','Checked by'].map(esc).join(',')];
    yards.forEach(y=>y.trailers.forEach(t=>lines.push([y.name,t.trailer,t.status,t.days,new Date(t.since).toLocaleDateString(),t.note,fmt(y.latest.checked_at),y.latest.driver].map(esc).join(','))));
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'}));
    a.download=`yard-board-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }

  function init(){
    if(!el('yardBoard')) return;
    el('ybLoad').onclick=load;
    el('ybCsv').onclick=csv;
    el('ybSearch').addEventListener('input',render);
    el('ybMinDays').addEventListener('change',render);
    // Load the first time the view is opened.
    new MutationObserver(()=>{ if(el('yardBoard').classList.contains('active')&&!loaded) load(); })
      .observe(el('yardBoard'),{attributes:true,attributeFilter:['class']});
  }
  window.addEventListener('load',init);
})();
