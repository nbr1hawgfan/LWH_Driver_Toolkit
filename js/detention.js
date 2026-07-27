(function(){
  function el(id){ return document.getElementById(id); }
  const LOG_KEY='detentionLog';

  function toMinutes(t){
    if(!t) return null;
    const [h,m]=t.split(':').map(Number);
    return h*60+m;
  }
  function fmtHrs(mins){
    if(mins<=0) return '0h 0m';
    return `${Math.floor(mins/60)}h ${mins%60}m`;
  }
  function nowTimeStr(){
    const d=new Date();
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  function computeCurrent(){
    const arrival=toMinutes(el('dtArrival').value);
    const departure=toMinutes(el('dtDeparture').value);
    const freeHrs=+el('dtFreeTime').value||0;
    if(arrival===null||departure===null) return null;
    let onSite=departure-arrival;
    if(onSite<0) onSite+=24*60; // crossed midnight
    const detentionMins=Math.max(0,onSite-freeHrs*60);
    return {onSite,detentionMins,freeHrs};
  }

  function renderOutput(){
    const out=el('dtOutput'); if(!out) return;
    const result=computeCurrent();
    if(!result){ out.innerHTML='<p class="hint">Enter arrival and departure times, then tap Calculate.</p>'; return; }
    out.innerHTML=`
      <div class="stats">
        <div><b>${fmtHrs(result.onSite)}</b><span>Total time on-site</span></div>
        <div><b style="color:${result.detentionMins>0?'var(--bad)':'var(--good)'}">${fmtHrs(result.detentionMins)}</b><span>Estimated detention time</span></div>
        <div><b>${result.freeHrs}h</b><span>Free time allowed</span></div>
      </div>
      <p class="hint" style="margin-top:12px">Detention = time on-site beyond your free time allowance. Confirm the exact rule (from arrival vs. from appointment time) against your company's detention pay policy.</p>
    `;
  }

  function loadLog(){ return LWHStorage.get(LOG_KEY,[]); }
  function saveLog(log){ LWHStorage.set(LOG_KEY,log); }

  function renderLog(){
    const wrap=el('dtLog'); if(!wrap) return;
    const log=loadLog();
    if(!log.length){ wrap.innerHTML='<p class="hint">No saved entries yet.</p>'; return; }
    wrap.innerHTML=log.map((entry,i)=>`
      <div class="dt-entry">
        <b>${LWHUI.safe(entry.location||'(no location)')}</b> — ${entry.date}<br>
        Sched ${entry.scheduled||'—'} · Arrived ${entry.arrival||'—'} · Departed ${entry.departure||'—'}<br>
        On-site: ${fmtHrs(entry.onSite)} · Detention: ${fmtHrs(entry.detentionMins)}
        <div class="actions" style="margin-top:6px"><button type="button" class="ghost" data-remove-dt="${i}">Remove</button></div>
      </div>
    `).join('');
  }

  function summaryText(){
    const log=loadLog();
    if(!log.length) return 'No detention entries logged.';
    return log.map(e=>`${e.date} — ${e.location||'(no location)'}: Sched ${e.scheduled||'—'}, Arrived ${e.arrival||'—'}, Departed ${e.departure||'—'}, On-site ${fmtHrs(e.onSite)}, Detention ${fmtHrs(e.detentionMins)}`).join('\n');
  }

  function initControls(){
    ['dtArrival','dtDeparture','dtFreeTime'].forEach(id=>{
      const n=el(id); if(n) n.addEventListener('input',renderOutput);
    });
    el('dtArrivalNow')&&(el('dtArrivalNow').onclick=()=>{ el('dtArrival').value=nowTimeStr(); renderOutput(); });
    el('dtDepartureNow')&&(el('dtDepartureNow').onclick=()=>{ el('dtDeparture').value=nowTimeStr(); renderOutput(); });
    el('dtCalc')&&(el('dtCalc').onclick=renderOutput);
    el('dtSave')&&(el('dtSave').onclick=()=>{
      const result=computeCurrent();
      if(!result){ LWHUI.toast('Enter arrival and departure times first'); return; }
      const log=loadLog();
      log.unshift({
        date:new Date().toISOString().slice(0,10),
        location:el('dtLocation').value.trim(),
        scheduled:el('dtScheduled').value,
        arrival:el('dtArrival').value,
        departure:el('dtDeparture').value,
        onSite:result.onSite,
        detentionMins:result.detentionMins
      });
      saveLog(log);
      renderLog();
      LWHUI.toast('Entry saved');
    });
    el('dtCopyAll')&&(el('dtCopyAll').onclick=()=>{
      const text=summaryText();
      navigator.clipboard?.writeText(text).then(()=>LWHUI.toast('Copied to clipboard')).catch(()=>LWHUI.toast('Copy failed — select and copy manually'));
    });
    el('dtEmailAll')&&(el('dtEmailAll').onclick=()=>{
      const subject=encodeURIComponent('Detention time summary');
      const body=encodeURIComponent(summaryText());
      window.location.href=`mailto:Dispatch@Logistics-Warehouse.com?subject=${subject}&body=${body}`;
    });
    el('dtClearLog')&&(el('dtClearLog').onclick=()=>{
      if(!confirm('Clear all saved detention entries?')) return;
      saveLog([]);
      renderLog();
    });
    el('dtLog')&&el('dtLog').addEventListener('click',e=>{
      const b=e.target.closest('[data-remove-dt]'); if(!b) return;
      const log=loadLog();
      log.splice(+b.dataset.removeDt,1);
      saveLog(log);
      renderLog();
    });
  }

  function init(){
    if(!el('detention')) return;
    initControls();
    renderOutput();
    renderLog();
  }
  window.addEventListener('load',init);
})();
