(function(){
  const TIMESHEETS_URL='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/spotter-timesheets-csv';
  let rows=[];
  let lastResults=[];
  let loaded=false;
  const DAY_LABELS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function el(id){ return document.getElementById(id); }
  function stStatus(msg){ const s=el('stStatus'); if(s) s.textContent=msg; }
  function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

  function formatUpdatedAt(iso){
    if(!iso) return null;
    const d=new Date(iso.includes('T')?iso:iso.replace(' ','T'));
    if(isNaN(d)) return null;
    return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }
  function fmtWeekLabel(weekStart){
    const d=new Date(weekStart+'T00:00:00');
    if(isNaN(d)) return weekStart;
    const end=new Date(d); end.setDate(end.getDate()+6);
    return `${d.toLocaleDateString([],{month:'short',day:'numeric'})} – ${end.toLocaleDateString([],{month:'short',day:'numeric'})}`;
  }

  function parseCsv(text){
    text=(text||'').replace(/^\uFEFF/,'').trim(); if(!text) return [];
    const lines=[]; let cur='', row=[], q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(c==='"'){ if(q&&n==='"'){cur+='"';i++;} else q=!q; }
      else if(!q && c===','){ row.push(cur);cur=''; }
      else if(!q && (c==='\n'||c==='\r')){
        if(c==='\r'&&n==='\n')i++;
        row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row); row=[]; cur='';
      } else cur+=c;
    }
    row.push(cur); if(row.some(x=>String(x).trim())) lines.push(row);
    if(!lines.length) return [];
    const head=lines.shift();
    return lines.map(r=>{
      const obj={};
      head.forEach((h,i)=>{ obj[h.trim()]=r[i]!==undefined?r[i]:''; });
      return {
        driverName:obj.DriverName||'', location:obj.Location||'', weekStart:obj.WeekStart||'',
        hours:[obj.SunHours,obj.MonHours,obj.TueHours,obj.WedHours,obj.ThuHours,obj.FriHours,obj.SatHours].map(h=>parseFloat(h)||0),
        totalHours:parseFloat(obj.TotalHours)||0, updatedAt:obj.UpdatedAt||''
      };
    });
  }

  async function loadTimesheets(force){
    if(loaded && !force){ return rows; }
    stStatus('Loading timesheets…');
    try{
      const bust=(TIMESHEETS_URL.includes('?')?'&':'?')+'_='+Date.now();
      const res=await fetch(TIMESHEETS_URL+bust,{cache:'no-store',mode:'cors'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const text=await res.text();
      rows=parseCsv(text);
      loaded=true;
      stStatus(`Loaded ${rows.length} timesheet record(s).`);
    }catch(e){
      stStatus('Load failed: '+e.message+' — try Load / Refresh, or check your connection.');
      console.error(e);
    }
    return rows;
  }

  function search(q){
    q=(q||'').trim().toLowerCase();
    if(!q) return rows.slice(0,300);
    return rows.filter(r=>
      r.driverName.toLowerCase().includes(q) ||
      r.location.toLowerCase().includes(q) ||
      r.weekStart.includes(q)
    ).slice(0,300);
  }

  function renderResults(list){
    lastResults=list;
    const out=el('stResults'); if(!out) return;
    out.innerHTML='';
    if(!list.length){ out.innerHTML='<div class="card">No matching timesheets found.</div>'; return; }

    list.sort((a,b)=> b.weekStart.localeCompare(a.weekStart) || a.driverName.localeCompare(b.driverName));

    const top=document.createElement('div'); top.className='card';
    top.innerHTML=`<b>${list.length}</b> timesheet(s)`;
    out.append(top);

    list.forEach(r=>{
      const card=document.createElement('div'); card.className='card'; card.style.marginTop='10px';
      const dayCells=r.hours.map((h,i)=>`<td style="text-align:center">${DAY_LABELS[i]}<br><b>${h||0}</b></td>`).join('');
      card.innerHTML=`
        <div><b>${safe(r.driverName)}</b> · ${safe(r.location||'—')} · Week of ${fmtWeekLabel(r.weekStart)}</div>
        <div style="margin-top:8px;overflow-x:auto"><table class="pls-table"><tbody><tr>${dayCells}<td style="text-align:center;background:var(--brand-tint)">Total<br><b>${r.totalHours}</b></td></tr></tbody></table></div>
        <div class="hint" style="margin-top:6px">Last synced: ${formatUpdatedAt(r.updatedAt)||'—'}</div>
      `;
      out.append(card);
    });
  }

  function csvEscape(v){
    const s=String(v??'');
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }

  function exportCsv(){
    if(!lastResults.length){ LWHUI.toast('No results to export — run a search first'); return; }
    const header=['Driver','Location','Week Start',...DAY_LABELS,'Total Hours','Last Synced'];
    const csvRows=lastResults.map(r=>[r.driverName,r.location,r.weekStart,...r.hours,r.totalHours,r.updatedAt].map(csvEscape));
    const csv=[header.join(','), ...csvRows.map(r=>r.join(','))].join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const stamp=new Date().toISOString().slice(0,10);
    a.href=url; a.download=`spotter-timesheets-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    LWHUI.toast(`Exported ${lastResults.length} row(s) to CSV`);
  }

  function renderPrintTable(){
    const out=el('stPrintTable'); if(!out) return;
    if(!lastResults.length){ out.innerHTML=''; LWHUI.toast('No results to print — run a search first'); return; }
    const header=['Driver','Location','Week Start',...DAY_LABELS,'Total'].map(h=>`<th>${h}</th>`).join('');
    const printRows=lastResults.map(r=>`<tr><td>${safe(r.driverName)}</td><td>${safe(r.location)}</td><td>${fmtWeekLabel(r.weekStart)}</td>${r.hours.map(h=>`<td>${h}</td>`).join('')}<td>${r.totalHours}</td></tr>`).join('');
    out.innerHTML=`
      <h2>Spotter Timesheets — ${lastResults.length} result(s)</h2>
      <table class="txn-print-table">
        <thead><tr>${header}</tr></thead>
        <tbody>${printRows}</tbody>
      </table>
    `;
    setTimeout(()=>print(),100);
  }

  function clearResults(){
    lastResults=[];
    const out=el('stResults'); if(out) out.innerHTML='';
    const printOut=el('stPrintTable'); if(printOut) printOut.innerHTML='';
  }

  window.addEventListener('load',()=>{
    if(!el('stSearchBtn')) return;
    async function runSearch(){
      await loadTimesheets(false);
      renderResults(search(el('stSearch').value));
    }
    el('stSearchBtn').onclick=()=>{runSearch();};
    el('stSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();el('stSearchBtn').click();}};
    el('stLoadBtn').onclick=async()=>{await loadTimesheets(true); runSearch(); LWHUI.toast('Timesheets refreshed');};
    el('stClearBtn').onclick=()=>{el('stSearch').value=''; clearResults(); el('stSearch').focus();};
    el('stCsvBtn').onclick=exportCsv;
    el('stPrintBtn').onclick=renderPrintTable;
  });
})();
