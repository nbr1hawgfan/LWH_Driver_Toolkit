// Dispatch Board — two tabs:
//   Day       — pick any day: every driver's status updates as a timeline,
//               plus every yard check sent that day, with totals.
//   Yards Now — each yard's latest synced Yard Check, with days on yard.
// Reads the yard-check-history and status-history edge functions; the
// days-on-yard math is shared with yardcheck.js (window.LWHYard).
(function(){
  const el=id=>document.getElementById(id);
  const API='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/';
  const STATUS_URL=API+'status-history', PHOTO_URLS=API+'yard-photo-urls';
  const S=s=>LWHUI.safe(s);
  const pad=n=>String(n).padStart(2,'0');
  const fmt=t=>new Date(t).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const tm=t=>new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const post=async(url,body)=>{
    const res=await fetch(url,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!res.ok){ const b=await res.json().catch(()=>({})); throw new Error(b.error||('HTTP '+res.status)); }
    return res.json();
  };
  let tab='day';
  let yards=[], yardsLoaded=false;
  let day={date:'',updates:[],checks:[],loaded:false};

  function status(t){ const s=el('ybStatus'); if(s) s.textContent=t; }

  // ---------- Photos: thumbnails get short-lived links after the page draws ----------
  const urlCache={}; // path -> {url, at}
  function photoCell(t){
    const ph=t.photos||[];
    const chip=t.damaged?'<span class="yb-chip s-damaged">Damaged</span>':'';
    const thumbs=ph.length?`<div class="yb-thumbs">${ph.map(p=>`<a class="yb-thumb" data-path="${S(p)}" target="_blank" rel="noopener"><img data-path="${S(p)}" alt="Trailer photo"></a>`).join('')}</div>`:'';
    return chip+thumbs;
  }
  async function fillPhotos(){
    const nodes=[...document.querySelectorAll('#ybResults [data-path],#ybFind [data-path]')];
    if(!nodes.length) return;
    const fresh=p=>urlCache[p]&&Date.now()-urlCache[p].at<45*60000;
    const need=[...new Set(nodes.map(n=>n.dataset.path))].filter(p=>!fresh(p));
    if(need.length){
      try{ const b=await post(PHOTO_URLS,{paths:need}); Object.entries(b.urls||{}).forEach(([p,u])=>urlCache[p]={url:u,at:Date.now()}); }
      catch(e){ console.warn('Photo links failed',e); }
    }
    nodes.forEach(n=>{ const u=urlCache[n.dataset.path]&&urlCache[n.dataset.path].url; if(!u) return; if(n.tagName==='IMG') n.src=u; else n.href=u; });
  }

  // ======================= Day view =======================
  function dayRange(dateStr){
    const a=new Date(dateStr+'T00:00:00'), b=new Date(a); b.setDate(b.getDate()+1);
    return {from:a.toISOString(),to:b.toISOString()};
  }
  async function loadDay(){
    const date=el('ybDate').value||ymd(new Date()); el('ybDate').value=date;
    status('Loading '+new Date(date+'T00:00:00').toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'})+'…');
    const r=dayRange(date);
    const [u,c]=await Promise.allSettled([post(STATUS_URL,{...r,limit:1000}),post(window.LWHYard.HISTORY_URL,{...r,limit:500})]);
    day={date,updates:u.status==='fulfilled'?(u.value.updates||[]):[],checks:c.status==='fulfilled'?(c.value.checks||[]):[],loaded:true};
    const errs=[u,c].filter(x=>x.status==='rejected').map(x=>x.reason.message);
    status(errs.length?'Some data didn\'t load: '+errs.join('; '):'Updated '+tm(Date.now()));
    fillDrivers(); renderDay();
  }
  function fillDrivers(){
    const cur=el('ybDriver').value;
    const names=[...new Set(day.updates.map(u=>u.driver).concat(day.checks.map(c=>c.driver)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    el('ybDriver').innerHTML='<option value="">All drivers</option>'+names.map(n=>`<option${n===cur?' selected':''}>${S(n)}</option>`).join('');
  }
  function renderDay(){
    const who=el('ybDriver').value;
    const ups=day.updates.filter(u=>!who||u.driver===who).slice().sort((a,b)=>new Date(a.sent_at)-new Date(b.sent_at));
    const cks=day.checks.filter(c=>!who||c.driver===who).slice().sort((a,b)=>new Date(a.checked_at)-new Date(b.checked_at));
    const tr=cks.flatMap(c=>c.trailers||[]);
    const L=tr.filter(t=>t.status==='Loaded').length, E=tr.filter(t=>t.status==='Empty').length;
    const drivers=new Set(ups.map(u=>u.driver||'(no name)').concat(cks.map(c=>c.driver||'(no name)')));
    const late=ups.filter(u=>u.status==='Running Late').length;
    const dmg=tr.filter(t=>t.damaged).length;

    const stats=`<div class="stats yb-stats">
      <div><b>${ups.length}</b><span>Status updates</span></div>
      <div><b>${drivers.size}</b><span>Drivers</span></div>
      <div><b>${cks.length}</b><span>Yard checks</span></div>
      <div><b>${tr.length}</b><span>Trailers (${L} L · ${E} E)</span></div>
      ${late?`<div><b style="color:var(--brand)">${late}</b><span>Running late</span></div>`:''}
      ${dmg?`<div><b style="color:var(--brand)">${dmg}</b><span>Damaged</span></div>`:''}
    </div>`;

    // Timeline grouped by driver, in time order.
    const byDriver={};
    ups.forEach(u=>{ (byDriver[u.driver||'(no name)']=byDriver[u.driver||'(no name)']||[]).push(u); });
    const timeline=Object.keys(byDriver).sort((a,b)=>a.localeCompare(b)).map(d=>{
      const list=byDriver[d], last=list[list.length-1];
      return `<div class="card yb-driver">
        <div class="yb-driver-head"><h3 style="margin:0">${S(d)}</h3><span class="hint">Last: <b>${S(last.status)}</b>${last.location?' at '+S(last.location):''} · ${tm(last.sent_at)}</span></div>
        <ol class="yb-tl">${list.map(u=>{
          const ids=[u.trailer&&'Trailer '+S(u.trailer),u.load_ref&&'Load '+S(u.load_ref)].filter(Boolean).join(' · ');
          return `<li class="yb-tl-item"><span class="yb-tl-time">${tm(u.sent_at)}</span>
            <div><span class="yb-chip s-${u.status.replace(/\s+/g,'').toLowerCase()}">${S(u.status)}</span> ${u.location?'<b>'+S(u.location)+'</b>':''}
            ${ids||u.eta||u.note||u.pin?`<div class="hint">${[ids,u.eta&&'New ETA '+S(u.eta),u.note&&S(u.note)].filter(Boolean).join(' · ')}${u.pin?` · <a href="${S(u.pin)}" target="_blank" rel="noopener">Map</a>`:''}</div>`:''}</div></li>`;
        }).join('')}</ol>
      </div>`;
    }).join('');

    const checks=cks.map(c=>`<div class="card yb-yard">
      <div class="yb-driver-head"><h3 style="margin:0">${S(c.location||'(no location)')}</h3><span class="hint">${tm(c.checked_at)}${c.driver?' · '+S(c.driver):''}${c.pin?` · <a href="${S(c.pin)}" target="_blank" rel="noopener">Map</a>`:''}</span></div>
      <table class="yb-table"><thead><tr><th>Trailer</th><th>Status</th><th>Product / note</th></tr></thead><tbody>
      ${(c.trailers||[]).map(t=>`<tr class="${t.damaged?'dmg':''}"><td><button type="button" class="yb-tnum" data-find="${S(t.trailer)}">${S(t.trailer)}</button></td><td>${S(t.status||'—')}</td><td>${S(t.note||'')}${photoCell(t)}</td></tr>`).join('')}
      </tbody></table>
      ${c.notes?`<p class="hint" style="margin:8px 0 0"><b>Yard notes:</b> ${S(c.notes)}</p>`:''}
    </div>`).join('');

    el('ybResults').innerHTML=stats+
      `<h3 class="yb-section">Driver timeline</h3>`+(timeline||'<p class="hint">No status updates this day.</p>')+
      `<h3 class="yb-section">Yard checks</h3>`+(checks||'<p class="hint">No yard checks this day.</p>');
    fillPhotos();
  }
  function shiftDay(n){ const d=new Date((el('ybDate').value||ymd(new Date()))+'T00:00:00'); d.setDate(d.getDate()+n); el('ybDate').value=ymd(d); loadDay(); }

  // ======================= Yards Now =======================
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
        return {trailer:t.trailer,status:t.status||'',note:t.note||'',damaged:!!t.damaged,photos:t.photos||[],days,since:first||asOf};
      }).sort((a,b)=>b.days-a.days||a.trailer.localeCompare(b.trailer,undefined,{numeric:true}));
      return {name:latest.location||'(no location)',latest,checks:list.length,trailers};
    }).sort((a,b)=>new Date(b.latest.checked_at)-new Date(a.latest.checked_at));
  }
  async function loadYards(){
    status('Loading yard checks…');
    try{
      const body=await post(window.LWHYard.HISTORY_URL,{limit:500});
      yards=build(body.checks||[]); yardsLoaded=true;
      status(yards.length?`${yards.length} yard${yards.length===1?'':'s'} · ${(body.checks||[]).length} checks loaded · ${tm(Date.now())}`:'No yard checks synced yet.');
      renderYards();
    }catch(e){ status('Load failed: '+e.message+' — check your connection.'); console.error(e); }
  }
  function renderYards(){
    const q=(el('ybSearch').value||'').trim().toLowerCase(), minDays=+el('ybMinDays').value||0;
    const out=yards.map(y=>{
      const nameHit=!q||y.name.toLowerCase().includes(q);
      const rows=y.trailers.filter(t=>t.days>=minDays&&(minDays!==-1||t.damaged)&&(nameHit||t.trailer.toLowerCase().includes(q)||t.note.toLowerCase().includes(q)||(t.damaged&&'damaged'.includes(q))));
      if(!rows.length) return '';
      const L=y.trailers.filter(t=>t.status==='Loaded').length, E=y.trailers.filter(t=>t.status==='Empty').length;
      const pin=y.latest.pin?` · <a href="${S(y.latest.pin)}" target="_blank" rel="noopener">Map</a>`:'';
      return `<div class="card yb-yard">
        <h3 style="margin:0 0 4px">${S(y.name)}</h3>
        <div class="hint">Last check ${fmt(y.latest.checked_at)}${y.latest.driver?' by '+S(y.latest.driver):''} · ${y.trailers.length} trailer${y.trailers.length===1?'':'s'} (${L} loaded, ${E} empty) · ${y.checks} check${y.checks===1?'':'s'} on file${pin}</div>
        <table class="yb-table"><thead><tr><th>Trailer</th><th>Status</th><th>On yard</th><th>Product / note</th></tr></thead><tbody>
        ${rows.map(t=>`<tr class="${t.days>=7?'long':''}${t.damaged?' dmg':''}"><td><button type="button" class="yb-tnum" data-find="${S(t.trailer)}">${S(t.trailer)}</button></td><td>${S(t.status||'—')}</td><td>${t.days>=1?`${t.days} day${t.days===1?'':'s'}<br><span class="hint">since ${new Date(t.since).toLocaleDateString([], {month:'short',day:'numeric'})}</span>`:'<span class="hint">new</span>'}</td><td>${S(t.note)}${photoCell(t)}</td></tr>`).join('')}
        </tbody></table>
        ${y.latest.notes?`<p class="hint" style="margin:8px 0 0"><b>Yard notes:</b> ${S(y.latest.notes)}</p>`:''}
      </div>`;
    }).join('');
    el('ybResults').innerHTML=out||(yardsLoaded?'<p class="hint">No trailers match.</p>':'');
    fillPhotos();
  }

  // ======================= Shared =======================
  function download(name,lines){
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'}));
    a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }
  const esc=v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`;
  function csv(){
    if(tab==='day'){
      if(!day.loaded){ LWHUI.toast('Load a day first'); return; }
      const who=el('ybDriver').value;
      const lines=[['Type','Time','Driver','Status / Trailer','Location','Trailer / Status','Load / Note','ETA / Note','Map'].map(esc).join(',')];
      day.updates.filter(u=>!who||u.driver===who).slice().sort((a,b)=>new Date(a.sent_at)-new Date(b.sent_at))
        .forEach(u=>lines.push(['Status update',fmt(u.sent_at),u.driver,u.status,u.location,u.trailer,u.load_ref,[u.eta&&'ETA '+u.eta,u.note].filter(Boolean).join(' · '),u.pin].map(esc).join(',')));
      day.checks.filter(c=>!who||c.driver===who).forEach(c=>(c.trailers||[]).forEach(t=>lines.push(['Yard check',fmt(c.checked_at),c.driver,t.trailer,c.location,t.status+(t.damaged?' · DAMAGED':''),[t.note,(t.photos||[]).length?(t.photos.length+' photo(s)'):''].filter(Boolean).join(' · '),c.notes,c.pin].map(esc).join(','))));
      download(`dispatch-day-${day.date}.csv`,lines);
    }else{
      if(!yards.length){ LWHUI.toast('Load the yard checks first'); return; }
      const lines=[['Yard','Trailer','Status','Damaged','Photos','Days on yard','On yard since','Product / note','Last check','Checked by'].map(esc).join(',')];
      yards.forEach(y=>y.trailers.forEach(t=>lines.push([y.name,t.trailer,t.status,t.damaged?'Yes':'',(t.photos||[]).length||'',t.days,new Date(t.since).toLocaleDateString(),t.note,fmt(y.latest.checked_at),y.latest.driver].map(esc).join(','))));
      download(`yards-now-${ymd(new Date())}.csv`,lines);
    }
  }

  // ======================= Find a trailer =======================
  // Searches every synced yard check and status update (not just one day).
  // Partial numbers work: "4180" finds 514180. Exact matches are listed first.
  const tk=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9-]/g,'');
  let findSeq=0;
  async function findTrailer(raw){
    const q=tk(raw);
    if(q.length<3){ LWHUI.toast('Type at least 3 characters of the trailer number'); return; }
    const seq=++findSeq, box=el('ybFind');
    box.hidden=false; el('ybResults').hidden=true;
    box.innerHTML=`<div class="card"><p class="hint" style="margin:0">Searching for <b>${S(q)}</b>…</p></div>`;
    const [c,u]=await Promise.allSettled([post(window.LWHYard.HISTORY_URL,{trailer:q,limit:300}),post(STATUS_URL,{trailer:q,limit:300})]);
    if(seq!==findSeq) return;
    if(c.status==='rejected'&&u.status==='rejected'){ box.innerHTML=`<div class="card"><p class="hint" style="margin:0">Search failed: ${S(c.reason.message)} — check your connection.</p></div>`; return; }
    const checks=c.status==='fulfilled'?(c.value.checks||[]):[], ups=u.status==='fulfilled'?(u.value.updates||[]):[];
    // Group every sighting by the actual trailer number.
    const groups={};
    const g=n=>groups[n]=groups[n]||{num:n,seen:[],updates:[]};
    checks.forEach(ck=>(ck.trailers||[]).forEach(t=>{ const n=tk(t.trailer); if(n.includes(q)) g(n).seen.push({ck,t}); }));
    ups.forEach(x=>{ const n=tk(x.trailer); if(n.includes(q)) g(n).updates.push(x); });
    const last=gr=>Math.max(...gr.seen.map(x=>+new Date(x.ck.checked_at)),...gr.updates.map(x=>+new Date(x.sent_at)),0);
    const list=Object.values(groups).sort((a,b)=>(b.num===q)-(a.num===q)||last(b)-last(a));
    if(!list.length){
      box.innerHTML=`<div class="card yb-find-card"><div class="yb-driver-head"><h3 style="margin:0">No sightings of ${S(q)}</h3><button type="button" class="ghost" data-findclear>✕ Clear</button></div>
        <p class="hint" style="margin:8px 0 0">No yard check or status update mentions a trailer number containing <b>${S(q)}</b>. It may not have been checked since drivers started saving to the board, or the number may have been typed differently.</p></div>`;
      return;
    }
    const shown=list.slice(0,5);
    // Days on yard needs that yard's other checks (to see when the trailer was missing).
    const yardHist={};
    await Promise.all([...new Set(shown.map(gr=>gr.seen[0]&&gr.seen.sort((a,b)=>new Date(b.ck.checked_at)-new Date(a.ck.checked_at))[0].ck.location).filter(Boolean))]
      .map(loc=>post(window.LWHYard.HISTORY_URL,{location:loc,limit:80}).then(b=>{ yardHist[loc]=b.checks||[]; }).catch(()=>{})));
    if(seq!==findSeq) return;
    const Y=window.LWHYard;
    box.innerHTML=(list.length>1?`<div class="card yb-find-sum"><div class="yb-driver-head"><span><b>${list.length}</b> trailer number${list.length===1?'':'s'} contain <b>${S(q)}</b>${list.length>5?' — showing the 5 most recent; type more digits to narrow it':''}</span><button type="button" class="ghost" data-findclear>✕ Clear</button></div></div>`:'')+
      shown.map((gr,gi)=>{
        gr.seen.sort((a,b)=>new Date(b.ck.checked_at)-new Date(a.ck.checked_at));
        gr.updates.sort((a,b)=>new Date(b.sent_at)-new Date(a.sent_at));
        const top=gr.seen[0];
        let where='<p class="hint" style="margin:6px 0 0">Not on any yard check yet — only in status updates.</p>';
        if(top){
          const asOf=+new Date(top.ck.checked_at);
          const first=Y.since(gr.num,Y.normChecks(yardHist[top.ck.location]||[top.ck]),asOf)||asOf;
          const d=Y.calDays(first,asOf), ago=Y.calDays(asOf,Date.now());
          where=`<div class="yb-find-where">
            <div class="yb-find-loc">📍 ${S(top.ck.location||'(no location)')}</div>
            <div>${top.t.status?`<b>${S(top.t.status)}</b> · `:''}last seen ${fmt(top.ck.checked_at)}${top.ck.driver?' by '+S(top.ck.driver):''}${ago>=1?` <span class="hint">(${ago} day${ago===1?'':'s'} ago)</span>`:''}</div>
            <div class="hint">${d>=1?`On that yard since ${new Date(first).toLocaleDateString([], {month:'short',day:'numeric'})} · ${d} day${d===1?'':'s'} as of that check`:'First check that saw it at this yard'}${top.ck.pin?` · <a href="${S(top.ck.pin)}" target="_blank" rel="noopener">Map</a>`:''}</div>
            ${top.t.note?`<div>Note: ${S(top.t.note)}</div>`:''}
            ${photoCell(top.t)}
          </div>`;
        }
        const hist=gr.seen.slice(0,25).map(x=>`<li class="yb-tl-item"><span class="yb-tl-time">${new Date(x.ck.checked_at).toLocaleDateString([], {month:'short',day:'numeric'})}</span>
          <div><b>${S(x.ck.location||'(no location)')}</b> · ${S(x.t.status||'not marked')}${x.t.damaged?' <span class="yb-chip s-damaged">Damaged</span>':''}<div class="hint">${tm(x.ck.checked_at)}${x.ck.driver?' · '+S(x.ck.driver):''}${x.t.note?' · '+S(x.t.note):''}${(x.t.photos||[]).length?` · ${x.t.photos.length} photo${x.t.photos.length===1?'':'s'}`:''}</div></div></li>`).join('');
        const upd=gr.updates.slice(0,25).map(x=>`<li class="yb-tl-item"><span class="yb-tl-time">${new Date(x.sent_at).toLocaleDateString([], {month:'short',day:'numeric'})}</span>
          <div><span class="yb-chip s-${x.status.replace(/\s+/g,'').toLowerCase()}">${S(x.status)}</span> ${x.location?'<b>'+S(x.location)+'</b>':''}<div class="hint">${tm(x.sent_at)}${x.driver?' · '+S(x.driver):''}${x.load_ref?' · Load '+S(x.load_ref):''}${x.note?' · '+S(x.note):''}</div></div></li>`).join('');
        return `<div class="card yb-find-card">
          <div class="yb-driver-head"><h3 style="margin:0">Trailer ${S(gr.num)}${gr.num===q?'':' <span class="hint">(partial match)</span>'}</h3>${list.length===1&&gi===0?'<button type="button" class="ghost" data-findclear>✕ Clear</button>':''}</div>
          ${where}
          ${hist?`<h4 class="yb-find-h">Yard checks (${gr.seen.length})</h4><ol class="yb-tl">${hist}</ol>`:''}
          ${upd?`<h4 class="yb-find-h">Status updates (${gr.updates.length})</h4><ol class="yb-tl">${upd}</ol>`:''}
        </div>`;
      }).join('');
    fillPhotos();
  }
  function clearFind(){ findSeq++; el('ybFind').hidden=true; el('ybFind').innerHTML=''; el('ybResults').hidden=false; el('ybFindInput').value=''; }
  function setTab(t){
    tab=t;
    document.querySelectorAll('#ybTabs [data-ybtab]').forEach(b=>b.classList.toggle('active',b.dataset.ybtab===t));
    el('ybDayCtl').hidden=t!=='day'; el('ybYardCtl').hidden=t!=='yards';
    el('ybResults').innerHTML='';
    if(t==='day'){ day.loaded?(renderDay(),status('Updated '+tm(Date.now()))):loadDay(); }
    else{ yardsLoaded?renderYards():loadYards(); }
  }
  function refresh(){ tab==='day'?loadDay():loadYards(); }

  function init(){
    if(!el('yardBoard')) return;
    el('ybDate').value=ymd(new Date());
    el('ybTabs').addEventListener('click',e=>{ const b=e.target.closest('[data-ybtab]'); if(b) setTab(b.dataset.ybtab); });
    el('ybDate').addEventListener('change',loadDay);
    el('ybPrev').onclick=()=>shiftDay(-1);
    el('ybNext').onclick=()=>shiftDay(1);
    el('ybToday').onclick=()=>{ el('ybDate').value=ymd(new Date()); loadDay(); };
    el('ybDriver').addEventListener('change',renderDay);
    el('ybLoad').onclick=refresh;
    el('ybCsv').onclick=csv;
    el('ybSearch').addEventListener('input',renderYards);
    el('ybMinDays').addEventListener('change',renderYards);
    el('ybFindForm').addEventListener('submit',e=>{ e.preventDefault(); findTrailer(el('ybFindInput').value); el('ybFindInput').blur(); });
    el('yardBoard').addEventListener('click',e=>{
      if(e.target.closest('[data-findclear]')){ clearFind(); return; }
      const f=e.target.closest('[data-find]');
      if(f){ el('ybFindInput').value=f.dataset.find; findTrailer(f.dataset.find); el('yardBoard').scrollIntoView({behavior:'smooth',block:'start'}); }
    });
    // Load the first time the board is opened.
    new MutationObserver(()=>{ if(el('yardBoard').classList.contains('active')&&!day.loaded&&!yardsLoaded) setTab(tab); })
      .observe(el('yardBoard'),{attributes:true,attributeFilter:['class']});
  }
  window.addEventListener('load',init);
})();
