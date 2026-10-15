// Yard Check — driver counts our trailers at a customer drop yard and sends
// the list (grouped Loaded / Empty) by text, email, or any app. No photos, so
// plain LWHStorage is plenty. The check in progress autosaves; the last 15
// sent checks are kept so a driver can see or resend what they sent.
(function(){
  const CUR='yardCurrent', HIST='yardHistory', LOCS='yardLocations', PEND='yardPending', HCACHE='yardServerHist';
  const API='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/';
  const SUBMIT_URL=API+'yard-check-submit', HISTORY_URL=API+'yard-check-history';
  const CONTACTS=[{name:'Chris',phone:'14796521662'},{name:'Derek',phone:'14796519227'}];
  const DISPATCH_EMAIL='Dispatch@Logistics-Warehouse.com';
  const el=id=>document.getElementById(id);
  const pad=n=>String(n).padStart(2,'0');
  const nowLocal=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
  const rid=()=>'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  let cur=null;
  const locKey=s=>String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const tKey=s=>String(s||'').trim().toUpperCase();
  const DAY=86400000;

  // ---------- Days on yard ----------
  // Walk this yard's earlier checks newest-first; a trailer has been there
  // since the oldest check in the unbroken run that includes it. Missing from
  // one check resets the clock, so it's only as good as how often we check.
  function since(trailer,checks,asOf){
    const k=tKey(trailer); let first=null;
    for(const c of checks){
      if(asOf&&c.t>asOf) continue;
      if(c.trailers.has(k)) first=c.t; else break;
    }
    return first;
  }
  function normChecks(list,excludeId){
    const seen=new Set(), out=[];
    list.forEach(c=>{
      if(!c||c.id===excludeId||seen.has(c.id)) return; seen.add(c.id);
      const t=new Date(c.checked_at||c.when).getTime(); if(isNaN(t)) return;
      const rows=c.trailers||c.rows||[];
      out.push({id:c.id,t,trailers:new Set(rows.map(r=>tKey(r.trailer)).filter(Boolean))});
    });
    return out.sort((a,b)=>b.t-a.t);
  }
  // Calendar days, so "since Oct 6" on Oct 15 reads 9 days whatever the time of day.
  const calDays=(from,to)=>{ const a=new Date(from), b=new Date(to); a.setHours(0,0,0,0); b.setHours(0,0,0,0); return Math.round((b-a)/DAY); };
  function daysLabel(first,asOf){
    const d=calDays(first,asOf);
    const when=new Date(first).toLocaleDateString([], {month:'short',day:'numeric'});
    return {days:d,text:d>=1?`On yard since ${when} · ${d} day${d===1?'':'s'}`:`Also here on the last check (${when})`};
  }
  // Earlier checks at the current yard: server copy + this phone's sent list.
  function priorChecks(){
    const k=locKey(cur.location); if(!k) return [];
    const server=(LWHStorage.get(HCACHE,{})[k]||{}).checks||[];
    const local=LWHStorage.get(HIST,[]).filter(c=>locKey(c.location)===k);
    return normChecks(server.concat(local),cur.id);
  }
  function dwellFor(r){
    if(!r.trailer.trim()) return null;
    const asOf=new Date(cur.when||Date.now()).getTime();
    const f=since(r.trailer,priorChecks(),asOf);
    return f?daysLabel(f,asOf):null;
  }
  let histTimer=null;
  async function loadYardHistory(){
    const k=locKey(cur.location);
    if(!k){ setDwellStatus(''); return; }
    if(!navigator.onLine){ setDwellStatus('Offline — days on yard uses this phone\'s checks only.'); refreshDwell(); return; }
    try{
      const res=await fetch(HISTORY_URL,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:cur.location})});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const body=await res.json();
      const cache=LWHStorage.get(HCACHE,{}); cache[k]={at:Date.now(),checks:body.checks||[]};
      // keep the cache small: 10 most recent yards
      const keys=Object.keys(cache).sort((a,b)=>cache[b].at-cache[a].at); keys.slice(10).forEach(x=>delete cache[x]);
      LWHStorage.set(HCACHE,cache);
    }catch(e){ console.warn('Yard history unavailable',e); }
    if(locKey(cur.location)!==k) return;
    const n=priorChecks().length;
    setDwellStatus(n?`Days on yard based on ${n} earlier check${n===1?'':'s'} at this yard.`:'No earlier checks at this yard yet — days on yard starts with this one.');
    refreshDwell(); el('ycPreview').textContent=summary();
  }
  // Update days-on-yard lines in place (doesn't steal focus from a box being typed in).
  function refreshDwellRow(rowEl){
    const r=cur.rows.find(x=>x.id===rowEl.dataset.id); if(!r) return;
    let span=rowEl.querySelector('.yc-dwell'); const d=dwellFor(r);
    if(!d){ if(span) span.remove(); return; }
    if(!span){ span=document.createElement('span'); rowEl.insertBefore(span,rowEl.querySelector('.yc-note')); }
    span.className='yc-dwell'+(d.days>=7?' long':''); span.textContent=d.text;
  }
  function refreshDwell(){ document.querySelectorAll('#ycRows .yc-row').forEach(refreshDwellRow); }
  function setDwellStatus(t){ const s=el('ycDwellStatus'); if(s){ s.textContent=t; s.hidden=!t; } }

  // ---------- Office sync ----------
  function payload(c,how){
    return {id:c.id,location:c.location.trim(),pin:c.pin||'',driver:(c.driver||'').trim(),checked_at:new Date(c.when||Date.now()).toISOString(),how:how||'',notes:(c.notes||'').trim(),
      trailers:c.rows.filter(r=>r.trailer.trim()).map(r=>({trailer:tKey(r.trailer),status:r.status||'',note:(r.note||'').trim()}))};
  }
  function setSync(t,err){ const s=el('ycSync'); if(!s) return; s.textContent=t; s.style.color=err?'var(--brand)':''; }
  function queue(c,how){
    const q=LWHStorage.get(PEND,[]).filter(x=>x.id!==c.id); q.push(payload(c,how)); LWHStorage.set(PEND,q); flush();
  }
  let flushing=false;
  async function flush(){
    if(flushing) return; let q=LWHStorage.get(PEND,[]); if(!q.length) return;
    if(!navigator.onLine){ setSync(`Offline — ${q.length} yard check${q.length===1?'':'s'} will sync to the office when you have signal.`); return; }
    flushing=true; setSync('Syncing to office…');
    let failed=null;
    for(const item of q.slice()){
      try{
        const res=await fetch(SUBMIT_URL,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});
        if(!res.ok){ const b=await res.json().catch(()=>({})); throw new Error(b.error||('HTTP '+res.status)); }
        q=LWHStorage.get(PEND,[]).filter(x=>x.id!==item.id); LWHStorage.set(PEND,q);
      }catch(e){ failed=e; break; }
    }
    flushing=false;
    if(failed){ setSync(`Saved on this phone — office sync will retry (${failed.message}).`,true); console.warn('Yard sync failed',failed); }
    else setSync('Synced to office ✓ · '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}));
  }
  window.addEventListener('online',flush);

  function blank(){
    return {id:'yc-'+Date.now(),when:nowLocal(),location:'',pin:'',driver:LWHStorage.get('userName','')||'',notes:'',
      rows:[{id:rid(),trailer:'',status:'',note:''},{id:rid(),trailer:'',status:'',note:''},{id:rid(),trailer:'',status:'',note:''}]};
  }
  const save=()=>LWHStorage.set(CUR,cur);
  const filled=()=>cur.rows.filter(r=>r.trailer.trim());

  // ---------- Rows ----------
  function rowHtml(r,i){
    return `<div class="yc-row" data-id="${r.id}">
      <span class="yc-num">${i+1}</span>
      <input class="yc-trailer" data-f="trailer" value="${LWHUI.safe(r.trailer)}" placeholder="Trailer #" autocapitalize="characters" autocomplete="off" aria-label="Trailer number ${i+1}" />
      <div class="yc-toggle" role="group" aria-label="Trailer ${i+1} status">
        <button type="button" class="yc-btn${r.status==='Loaded'?' on loaded':''}" data-status="Loaded" aria-pressed="${r.status==='Loaded'}">Loaded</button>
        <button type="button" class="yc-btn${r.status==='Empty'?' on empty':''}" data-status="Empty" aria-pressed="${r.status==='Empty'}">Empty</button>
      </div>
      <button type="button" class="yc-del ghost" data-del aria-label="Remove row ${i+1}">✕</button>
      ${(()=>{const d=dwellFor(r);return d?`<span class="yc-dwell${d.days>=7?' long':''}">${d.text}</span>`:'';})()}
      <input class="yc-note" data-f="note" value="${LWHUI.safe(r.note||'')}" placeholder="Product / note (optional)" autocomplete="off" enterkeyhint="next" aria-label="Product or note for trailer ${i+1}" />
    </div>`;
  }
  function renderRows(){
    el('ycRows').innerHTML=cur.rows.map(rowHtml).join('');
    markDupes(); renderCounts();
  }
  function markDupes(){
    const seen={};
    cur.rows.forEach(r=>{ const k=r.trailer.trim().toUpperCase(); if(k) seen[k]=(seen[k]||0)+1; });
    document.querySelectorAll('#ycRows .yc-row').forEach(rowEl=>{
      const r=cur.rows.find(x=>x.id===rowEl.dataset.id); if(!r) return;
      rowEl.classList.toggle('dupe',!!r.trailer.trim()&&seen[r.trailer.trim().toUpperCase()]>1);
    });
  }
  function renderCounts(){
    const f=filled(), L=f.filter(r=>r.status==='Loaded').length, E=f.filter(r=>r.status==='Empty').length, U=f.length-L-E;
    el('ycCounts').innerHTML=`<div><b>${f.length}</b><span>Trailers</span></div><div><b class="yc-c-loaded">${L}</b><span>Loaded</span></div><div><b class="yc-c-empty">${E}</b><span>Empty</span></div>`+
      (U?`<div><b style="color:#8a6d00">${U}</b><span>Not marked</span></div>`:'');
  }
  function addRow(focus){
    cur.rows.push({id:rid(),trailer:'',status:'',note:''}); save(); renderRows();
    if(focus){ const ins=document.querySelectorAll('#ycRows .yc-trailer'); ins[ins.length-1].focus(); }
  }

  // ---------- Summary text ----------
  function summary(c){
    c=c||cur;
    const f=c.rows.filter(r=>r.trailer.trim());
    const days=r=>{ if(c!==cur) return ''; const d=dwellFor(r); return d&&d.days>=1?` (${d.days} day${d.days===1?'':'s'} on yard)`:''; };
    const line=r=>'  '+r.trailer.trim().toUpperCase()+((r.note||'').trim()?' — '+r.note.trim():'')+days(r);
    const by=s=>f.filter(r=>r.status===s).map(line);
    const L=by('Loaded'), E=by('Empty'), U=f.filter(r=>!r.status).map(line);
    const when=c.when?new Date(c.when).toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
    const drv=(c.driver||LWHStorage.get('userName','')||'').trim();
    const out=[`YARD CHECK — ${c.location.trim()||'(location not entered)'}`,`${when}${drv?' · Driver: '+drv:''}`];
    if(c.pin) out.push(`Pin: ${c.pin}`);
    out.push('',`${f.length} trailer${f.length===1?'':'s'}: ${L.length} loaded, ${E.length} empty${U.length?`, ${U.length} not marked`:''}`);
    if(L.length) out.push('',`LOADED (${L.length})`,...L);
    if(E.length) out.push('',`EMPTY (${E.length})`,...E);
    if(U.length) out.push('',`NOT MARKED (${U.length})`,...U);
    if(c.notes.trim()) out.push('',`Notes: ${c.notes.trim()}`);
    return out.join('\n');
  }

  // ---------- Send ----------
  function ready(){
    const f=filled();
    if(!f.length){ LWHUI.toast('Add at least one trailer number'); return false; }
    if(!cur.location.trim()&&!cur.pin){ if(!confirm('No location entered. Send anyway?')) return false; }
    const unmarked=f.filter(r=>!r.status).length;
    if(unmarked&&!confirm(`${unmarked} trailer(s) not marked Loaded or Empty. Send anyway?`)) return false;
    return true;
  }
  function logSent(how){
    const h=LWHStorage.get(HIST,[]).filter(x=>x.id!==cur.id);
    h.unshift(Object.assign(JSON.parse(JSON.stringify(cur)),{sentAt:Date.now(),how}));
    LWHStorage.set(HIST,h.slice(0,15));
    queue(cur,how);
    const loc=cur.location.trim();
    if(loc){ const locs=LWHStorage.get(LOCS,[]).filter(x=>x.toLowerCase()!==loc.toLowerCase()); locs.unshift(loc); LWHStorage.set(LOCS,locs.slice(0,25)); fillLocList(); }
    renderHistory();
  }
  // iOS wants "sms:NUMBER&body=", Android "sms:NUMBER?body=".
  const smsHref=(phone,body)=>`sms:${phone||''}${/iPhone|iPad|iPod/i.test(navigator.userAgent)?'&':'?'}body=${encodeURIComponent(body)}`;
  async function share(){
    if(!ready()) return;
    const text=summary();
    if(navigator.share){
      try{ await navigator.share({title:'Yard Check',text}); logSent('Shared'); LWHUI.toast('Yard check sent'); }catch(e){}
    }else{ copy(true); }
  }
  function textTo(c){
    if(!ready()) return;
    logSent('Text to '+c.name);
    location.href=smsHref(c.phone,summary());
  }
  function emailIt(){
    if(!ready()) return;
    logSent('Email');
    location.href=`mailto:${DISPATCH_EMAIL}?subject=${encodeURIComponent('Yard Check — '+(cur.location.trim()||'location'))}&body=${encodeURIComponent(summary())}`;
  }
  async function copy(isFallback){
    if(!isFallback&&!filled().length){ LWHUI.toast('Add at least one trailer number'); return; }
    try{ await navigator.clipboard.writeText(summary()); LWHUI.toast('Copied — paste it into a text or email'); if(isFallback) logSent('Copied'); }
    catch(e){ el('ycPreviewWrap').open=true; LWHUI.toast('Long-press the preview to copy'); }
  }

  // ---------- History ----------
  function renderHistory(){
    const h=LWHStorage.get(HIST,[]);
    el('ycHistory').innerHTML=h.length?h.map((c,i)=>{
      const f=c.rows.filter(r=>r.trailer.trim());
      const L=f.filter(r=>r.status==='Loaded').length, E=f.filter(r=>r.status==='Empty').length;
      return `<div class="dt-entry" style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div><b>${LWHUI.safe(c.location||'(no location)')}</b><br><span class="hint">${new Date(c.sentAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · ${f.length} trailers (${L} loaded, ${E} empty) · ${LWHUI.safe(c.how||'')}</span></div>
        <div class="actions" style="margin:0"><button type="button" class="ghost" data-hresend="${i}">Resend</button><button type="button" class="ghost" data-hedit="${i}">Copy to New</button></div>
      </div>`;
    }).join(''):'<p class="hint">Nothing sent yet.</p>';
  }
  function fillLocList(){
    el('ycLocList').innerHTML=LWHStorage.get(LOCS,[]).map(l=>`<option value="${LWHUI.safe(l)}"></option>`).join('');
  }

  // ---------- Init ----------
  function fillForm(){
    el('ycLocation').value=cur.location; el('ycWhen').value=cur.when; el('ycDriver').value=cur.driver; el('ycNotes').value=cur.notes;
    el('ycPin').textContent=cur.pin?'Pinned: '+cur.pin:''; el('ycPin').hidden=!cur.pin;
    el('ycClearPin').hidden=!cur.pin;
    renderRows();
  }
  function init(){
    if(!el('yardcheck')) return;
    cur=LWHStorage.get(CUR,null)||blank();
    if(!cur.rows||!cur.rows.length) cur.rows=blank().rows;
    fillForm(); fillLocList(); renderHistory();

    [['ycLocation','location'],['ycWhen','when'],['ycDriver','driver'],['ycNotes','notes']].forEach(([id,k])=>{
      el(id).addEventListener('input',()=>{ cur[k]=el(id).value; save(); el('ycPreview').textContent=summary();
        if(k==='location'){ clearTimeout(histTimer); histTimer=setTimeout(loadYardHistory,700); }
        if(k==='when'){ refreshDwell(); el('ycPreview').textContent=summary(); } });
    });
    const rows=el('ycRows');
    rows.addEventListener('input',e=>{
      const inp=e.target.closest('.yc-trailer,.yc-note'); if(!inp) return;
      const r=cur.rows.find(x=>x.id===inp.closest('.yc-row').dataset.id); if(!r) return;
      if(inp.classList.contains('yc-note')){ r.note=inp.value; save(); el('ycPreview').textContent=summary(); return; }
      r.trailer=inp.value; save(); markDupes(); renderCounts(); el('ycPreview').textContent=summary();
    });
    // Refresh the days-on-yard line once the driver leaves a trailer box.
    rows.addEventListener('focusout',e=>{ const inp=e.target.closest('.yc-trailer'); if(inp) refreshDwellRow(inp.closest('.yc-row')); });
    // Enter on a trailer field jumps to the next row (adds one at the end).
    rows.addEventListener('keydown',e=>{
      if(e.key!=='Enter'||!e.target.closest('.yc-trailer,.yc-note')) return;
      e.preventDefault();
      const ins=[...document.querySelectorAll('#ycRows .yc-trailer')], i=ins.indexOf(e.target.closest('.yc-row').querySelector('.yc-trailer'));
      if(i<ins.length-1) ins[i+1].focus(); else addRow(true);
    });
    rows.addEventListener('click',e=>{
      const rowEl=e.target.closest('.yc-row'); if(!rowEl) return;
      const r=cur.rows.find(x=>x.id===rowEl.dataset.id); if(!r) return;
      const sb=e.target.closest('[data-status]');
      if(sb){
        r.status=r.status===sb.dataset.status?'':sb.dataset.status; save();
        rowEl.querySelectorAll('[data-status]').forEach(b=>{
          const on=b.dataset.status===r.status;
          b.classList.toggle('on',on); b.classList.toggle('loaded',on&&r.status==='Loaded'); b.classList.toggle('empty',on&&r.status==='Empty'); b.setAttribute('aria-pressed',on);
        });
        renderCounts(); el('ycPreview').textContent=summary(); return;
      }
      if(e.target.closest('[data-del]')){
        if(r.trailer.trim()&&!confirm(`Remove trailer ${r.trailer}?`)) return;
        cur.rows=cur.rows.filter(x=>x!==r); if(!cur.rows.length) cur.rows.push({id:rid(),trailer:'',status:'',note:''});
        save(); renderRows(); el('ycPreview').textContent=summary();
      }
    });
    el('ycAdd').onclick=()=>addRow(true);
    el('ycNow').onclick=()=>{ cur.when=nowLocal(); el('ycWhen').value=cur.when; save(); };
    el('ycGps').onclick=()=>{
      if(!navigator.geolocation){ LWHUI.toast('GPS not available'); return; }
      el('ycGps').textContent='Locating…';
      navigator.geolocation.getCurrentPosition(pos=>{
        const la=pos.coords.latitude.toFixed(5), lo=pos.coords.longitude.toFixed(5);
        cur.pin=`https://maps.google.com/?q=${la},${lo}`; save();
        el('ycPin').textContent='Pinned: '+cur.pin; el('ycPin').hidden=false; el('ycClearPin').hidden=false;
        el('ycGps').textContent='Pin My Location'; el('ycPreview').textContent=summary();
      },()=>{ el('ycGps').textContent='Pin My Location'; LWHUI.toast('Could not get location — check location permission'); },{enableHighAccuracy:true,timeout:15000});
    };
    el('ycClearPin').onclick=()=>{ cur.pin=''; save(); el('ycPin').hidden=true; el('ycClearPin').hidden=true; el('ycPreview').textContent=summary(); };
    el('ycShare').onclick=share;
    el('ycEmail').onclick=emailIt;
    el('ycCopy').onclick=()=>copy(false);
    el('ycTextBtns').innerHTML=CONTACTS.map((c,i)=>`<button type="button" class="ghost" data-textto="${i}">Text ${c.name}</button>`).join('');
    el('ycTextBtns').addEventListener('click',e=>{ const b=e.target.closest('[data-textto]'); if(b) textTo(CONTACTS[+b.dataset.textto]); });
    el('ycNew').onclick=()=>{
      if(filled().length&&!LWHStorage.get(HIST,[]).some(h=>h.id===cur.id)&&!confirm('This yard check hasn\'t been sent. Start a new one anyway?')) return;
      cur=blank(); save(); fillForm(); el('ycPreview').textContent=summary(); window.scrollTo(0,0); setDwellStatus('');
    };
    el('ycHistory').addEventListener('click',async e=>{
      const h=LWHStorage.get(HIST,[]);
      const rs=e.target.closest('[data-hresend]');
      if(rs){
        const text=summary(h[+rs.dataset.hresend]);
        if(navigator.share){ try{ await navigator.share({title:'Yard Check',text}); }catch(err){} }
        else{ try{ await navigator.clipboard.writeText(text); LWHUI.toast('Copied'); }catch(err){} }
        return;
      }
      const ed=e.target.closest('[data-hedit]');
      if(ed){
        // Same yard, new visit: keep location and trailer numbers, clear statuses.
        const src=h[+ed.dataset.hedit];
        cur=blank(); cur.location=src.location; cur.pin=src.pin;
        cur.rows=src.rows.filter(r=>r.trailer.trim()).map(r=>({id:rid(),trailer:r.trailer,status:'',note:''}));
        if(!cur.rows.length) cur.rows=blank().rows;
        save(); fillForm(); el('ycPreview').textContent=summary(); window.scrollTo(0,0); loadYardHistory();
        LWHUI.toast('Trailers copied — mark each Loaded or Empty');
      }
    });
    el('ycPreview').textContent=summary();
    if(cur.location.trim()) loadYardHistory();
    flush();
    // The first-run name prompt happens after this sets up, so fill the
    // driver name in whenever the tab is opened and it's still blank.
    new MutationObserver(()=>{
      if(el('yardcheck').classList.contains('active')&&!cur.driver){
        cur.driver=LWHStorage.get('userName','')||''; el('ycDriver').value=cur.driver; save(); el('ycPreview').textContent=summary();
      }
    }).observe(el('yardcheck'),{attributes:true,attributeFilter:['class']});
  }
  window.LWHYard={HISTORY_URL,locKey,tKey,normChecks,since,daysLabel,calDays};
  window.addEventListener('load',init);
})();
