// Yard Check — driver counts our trailers at a customer drop yard and sends
// the list (grouped Loaded / Empty) by text, email, or any app. No photos, so
// plain LWHStorage is plenty. The check in progress autosaves; the last 15
// sent checks are kept so a driver can see or resend what they sent.
(function(){
  const CUR='yardCurrent', HIST='yardHistory', LOCS='yardLocations';
  const CONTACTS=[{name:'Chris',phone:'14796521662'},{name:'Derek',phone:'14796519227'}];
  const DISPATCH_EMAIL='Dispatch@Logistics-Warehouse.com';
  const el=id=>document.getElementById(id);
  const pad=n=>String(n).padStart(2,'0');
  const nowLocal=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
  const rid=()=>'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  let cur=null;

  function blank(){
    return {id:'yc-'+Date.now(),when:nowLocal(),location:'',pin:'',driver:LWHStorage.get('userName','')||'',notes:'',
      rows:[{id:rid(),trailer:'',status:''},{id:rid(),trailer:'',status:''},{id:rid(),trailer:'',status:''}]};
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
    cur.rows.push({id:rid(),trailer:'',status:''}); save(); renderRows();
    if(focus){ const ins=document.querySelectorAll('#ycRows .yc-trailer'); ins[ins.length-1].focus(); }
  }

  // ---------- Summary text ----------
  function summary(c){
    c=c||cur;
    const f=c.rows.filter(r=>r.trailer.trim());
    const by=s=>f.filter(r=>r.status===s).map(r=>'  '+r.trailer.trim().toUpperCase());
    const L=by('Loaded'), E=by('Empty'), U=f.filter(r=>!r.status).map(r=>'  '+r.trailer.trim().toUpperCase());
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
      el(id).addEventListener('input',()=>{ cur[k]=el(id).value; save(); el('ycPreview').textContent=summary(); });
    });
    const rows=el('ycRows');
    rows.addEventListener('input',e=>{
      const inp=e.target.closest('.yc-trailer'); if(!inp) return;
      const r=cur.rows.find(x=>x.id===inp.closest('.yc-row').dataset.id); if(!r) return;
      r.trailer=inp.value; save(); markDupes(); renderCounts(); el('ycPreview').textContent=summary();
    });
    // Enter on a trailer field jumps to the next row (adds one at the end).
    rows.addEventListener('keydown',e=>{
      if(e.key!=='Enter'||!e.target.closest('.yc-trailer')) return;
      e.preventDefault();
      const ins=[...document.querySelectorAll('#ycRows .yc-trailer')], i=ins.indexOf(e.target);
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
        cur.rows=cur.rows.filter(x=>x!==r); if(!cur.rows.length) cur.rows.push({id:rid(),trailer:'',status:''});
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
      cur=blank(); save(); fillForm(); el('ycPreview').textContent=summary(); window.scrollTo(0,0);
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
        cur.rows=src.rows.filter(r=>r.trailer.trim()).map(r=>({id:rid(),trailer:r.trailer,status:''}));
        if(!cur.rows.length) cur.rows=blank().rows;
        save(); fillForm(); el('ycPreview').textContent=summary(); window.scrollTo(0,0);
        LWHUI.toast('Trailers copied — mark each Loaded or Empty');
      }
    });
    el('ycPreview').textContent=summary();
    // The first-run name prompt happens after this sets up, so fill the
    // driver name in whenever the tab is opened and it's still blank.
    new MutationObserver(()=>{
      if(el('yardcheck').classList.contains('active')&&!cur.driver){
        cur.driver=LWHStorage.get('userName','')||''; el('ycDriver').value=cur.driver; save(); el('ycPreview').textContent=summary();
      }
    }).observe(el('yardcheck'),{attributes:true,attributeFilter:['class']});
  }
  window.addEventListener('load',init);
})();
