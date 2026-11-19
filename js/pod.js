// Proof of Delivery (v1.43.0)
// Driver snaps each page of the signed BOL / delivery receipt. Pages are auto-cropped and cleaned
// up (same edge finder and filters as Doc Scanner), turned into one PDF, and sent to dispatch with
// the load #, customer, pallets and any OS&D. No signal? It waits on the phone and sends itself.
//
// - Same sign-in as Messages (Driver ID + PIN).
// - Upload: Edge Function pod-file → private bucket pod-files (kept, no 14-day limit). Each POD also
//   shows up in the Message Center's Driver Inbox as "Proof of delivery"; the PODs tab there searches
//   and opens them. Retries are safe (client_id).
// - The pages in progress are saved on this device (IndexedDB), so a refresh doesn't lose them.
// - "My PODs" lists what this driver sent in the last 30 days.
(function(){
  'use strict';
  const SUPA='https://tjivcqxnkftujceumdtx.supabase.co';
  const API=SUPA+'/rest/v1/rpc/', FN=SUPA+'/functions/v1/pod-file';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const VIEW='pod', DB='lwh-driver-pod';
  const CONDS=[['clean','All good'],['short','Short'],['over','Over'],['damaged','Damaged'],['refused','Refused']];
  const MAX_EDGE=2000, JPEG_Q=0.72;
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const toast=m=>{ try{ LWHUI.toast(m); }catch(e){ alert(m); } };
  const token=()=>(window.LWHStorage&&LWHStorage.get('msgToken',''))||'';
  const me=()=>(window.LWHStorage&&LWHStorage.get('msgMe',null))||null;
  const pad=n=>String(n).padStart(2,'0');
  const nowLocal=()=>{ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const when=s=>{ const d=new Date(s); return d.toLocaleDateString([], {month:'short',day:'numeric'})+' '+d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); };

  let pages=[];            // {id, blob (processed jpeg), raw (jpeg), rot, plain(bool), url}
  let form={load:'',customer:'',addr_id:'',when:nowLocal(),pallets:'',cond:'clean',note:''};
  let spot=null, nearby=[], built=false, busy=false, flushing=false;

  // ---------------------------------------------------------------- IndexedDB (draft pages + outbox)
  let dbp=null;
  function db(){
    if(!dbp) dbp=new Promise((res,rej)=>{ const r=indexedDB.open(DB,1);
      r.onupgradeneeded=()=>{ const d=r.result; d.createObjectStore('pages',{keyPath:'id'}); d.createObjectStore('outbox',{keyPath:'client_id'}); };
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
    return dbp;
  }
  async function tx(store,mode,fn){ const d=await db(); return new Promise((res,rej)=>{ const t=d.transaction(store,mode), s=t.objectStore(store); const out=fn(s); t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out); t.onerror=()=>rej(t.error); }); }
  const idb={
    all:store=>tx(store,'readonly',s=>s.getAll()),
    put:(store,v)=>tx(store,'readwrite',s=>s.put(v)),
    del:(store,k)=>tx(store,'readwrite',s=>s.delete(k)),
    clear:store=>tx(store,'readwrite',s=>s.clear())
  };
  const saveForm=()=>{ try{ LWHStorage.set('podForm',form); }catch(e){} };

  // ---------------------------------------------------------------- image work
  async function loadCanvas(file){
    let bmp=null;
    try{ bmp=await createImageBitmap(file,{imageOrientation:'from-image'}); }catch(e){}
    if(!bmp){ bmp=await new Promise((res,rej)=>{ const u=URL.createObjectURL(file), i=new Image(); i.onload=()=>{ URL.revokeObjectURL(u); res(i); }; i.onerror=()=>{ URL.revokeObjectURL(u); rej(new Error('Could not read that photo.')); }; i.src=u; }); }
    const w=bmp.width||bmp.naturalWidth, h=bmp.height||bmp.naturalHeight, s=Math.min(1,2400/Math.max(w,h));
    const c=document.createElement('canvas'); c.width=Math.round(w*s); c.height=Math.round(h*s);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height); if(bmp.close) bmp.close();
    return c;
  }
  const toBlob=(c,q)=>new Promise(r=>c.toBlob(b=>r(b),'image/jpeg',q||JPEG_Q));
  function scaled(c,max){ const s=Math.min(1,max/Math.max(c.width,c.height)); const o=document.createElement('canvas'); o.width=Math.round(c.width*s); o.height=Math.round(c.height*s); o.getContext('2d').drawImage(c,0,0,o.width,o.height); return o; }
  async function ensureCv(ms){
    if(window.DocAutoDetect&&DocAutoDetect.isReady()) return true;
    if(!window.LWHDocScan||!LWHDocScan.loadOpenCV) return false;
    try{ await Promise.race([LWHDocScan.loadOpenCV(),new Promise((_,rej)=>setTimeout(()=>rej(),ms))]); }catch(e){}
    return !!(window.DocAutoDetect&&DocAutoDetect.isReady());
  }
  // Crop to the paper and clean it up. Falls back to the full photo, cleaned, if no edges are found.
  async function processCanvas(c){
    let out=c;
    try{
      if(await ensureCv(navigator.onLine===false?1500:9000)){
        const small=scaled(c,900); let pts=null;
        try{ pts=DocAutoDetect.detectCorners(small); }catch(e){}
        if(pts&&pts.length===4){
          const o=DocAutoDetect.orderCorners?DocAutoDetect.orderCorners(pts):pts;
          const k=c.width/small.width, px=o.map(p=>({x:p.x*k,y:p.y*k}));
          const area=Math.abs(px.reduce((a,p,i)=>{ const q=px[(i+1)%4]; return a+(p.x*q.y-q.x*p.y); },0))/2;
          if(area>c.width*c.height*0.15) out=LWHDocScan._filters.warpPerspective(c,px,MAX_EDGE);
        }
      }
    }catch(e){ out=c; }
    out=scaled(out,MAX_EDGE);
    try{ if(window.LWHDocScan) out=LWHDocScan._filters.applyFilter(out,'document'); }catch(e){}
    return out;
  }
  function rotated(blob,deg){
    return new Promise(res=>{ const u=URL.createObjectURL(blob), i=new Image(); i.onload=()=>{ const c=document.createElement('canvas'); const r=deg%180!==0; c.width=r?i.height:i.width; c.height=r?i.width:i.height; const x=c.getContext('2d'); x.translate(c.width/2,c.height/2); x.rotate(deg*Math.PI/180); x.drawImage(i,-i.width/2,-i.height/2); URL.revokeObjectURL(u); res(c); }; i.src=u; });
  }

  async function addFiles(files){
    if(!files||!files.length) return;
    busy=true; status(`Fixing up ${files.length} page${files.length===1?'':'s'}…`);
    for(const f of files){
      try{
        const c=await loadCanvas(f);
        const raw=await toBlob(scaled(c,MAX_EDGE),0.75);
        const out=await processCanvas(c);
        const p={id:'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),blob:await toBlob(out),raw,rot:0,plain:false,at:Date.now()};
        pages.push(p); await idb.put('pages',strip(p));
      }catch(e){ toast(e.message||'Could not read that photo.'); }
    }
    busy=false; status(''); drawPages();
  }
  const strip=p=>({id:p.id,blob:p.blob,raw:p.raw,rot:p.rot,plain:p.plain,at:p.at});
  async function pageImage(p){ const src=p.plain?p.raw:p.blob; return p.rot?await toBlob(await rotated(src,p.rot)):src; }

  // ---------------------------------------------------------------- PDF
  async function buildPdf(){
    if(!window.jspdf||!window.jspdf.jsPDF) throw new Error('The PDF maker didn\'t load. Reload the app with signal and try again.');
    const {jsPDF}=window.jspdf; let doc=null;
    for(const p of pages){
      const b=await pageImage(p), url=URL.createObjectURL(b);
      const img=await new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.src=url; });
      const land=img.width>img.height, pw=land?792:612, ph=land?612:792, m=18;
      if(!doc) doc=new jsPDF({unit:'pt',format:'letter',orientation:land?'landscape':'portrait',compress:true}); else doc.addPage('letter',land?'landscape':'portrait');
      let w=pw-m*2, h=w*img.height/img.width; if(h>ph-m*2){ h=ph-m*2; w=h*img.width/img.height; }
      const data=new Uint8Array(await b.arrayBuffer());
      doc.addImage(data,'JPEG',(pw-w)/2,(ph-h)/2,w,h,undefined,'FAST');
      URL.revokeObjectURL(url);
    }
    doc.setProperties({title:'POD '+form.load,creator:'LWH Driver Toolkit'});
    return doc.output('blob');
  }

  // ---------------------------------------------------------------- send + outbox
  async function send(){
    if(busy) return;
    if(!token()){ toast('Sign in first (Messages → Sign in).'); return; }
    readForm();
    if(!form.load){ toast('Enter the load or BOL number.'); $('podLoad').focus(); return; }
    if(!pages.length){ toast('Take a photo of the signed BOL first.'); return; }
    if(form.cond!=='clean'&&!form.note){ toast('Add a short note about what was '+form.cond+'.'); $('podNote').focus(); return; }
    busy=true; status('Making the PDF…');
    let blob;
    try{ blob=await buildPdf(); }catch(e){ busy=false; status(''); toast(e.message); return; }
    if(blob.size>19.5*1048576){ busy=false; status(''); toast('That PDF is too big. Take fewer pages or retake them a little farther back.'); return; }
    const item={client_id:(crypto.randomUUID?crypto.randomUUID():'c'+Date.now()+Math.random().toString(36).slice(2)),
      meta:{load_no:form.load,customer:form.customer,addr_id:form.addr_id,delivered_at:new Date(form.when||Date.now()).toISOString(),
            pallets:form.pallets,condition:form.cond,note:form.note,pages:pages.length,lat:spot&&spot.lat,lon:spot&&spot.lon,acc:spot&&spot.acc},
      blob,queued_at:Date.now(),tries:0};
    item.meta.client_id=item.client_id;
    await idb.put('outbox',item);
    // Clear the form now — the POD is safe in the outbox.
    pages=[]; await idb.clear('pages');
    form={load:'',customer:'',addr_id:'',when:nowLocal(),pallets:'',cond:'clean',note:''}; saveForm();
    busy=false; drawAll();
    status('Sending…');
    await flush(true);
  }
  async function upload(item){
    const res=await fetch(FN+'?action=upload',{method:'POST',headers:{apikey:KEY,'x-msg-token':token(),'x-pod-meta':encodeURIComponent(JSON.stringify(item.meta)),'Content-Type':'application/pdf'},body:item.blob});
    let j={}; try{ j=await res.json(); }catch(e){}
    if(res.status===401) throw Object.assign(new Error('signed_out'),{stop:true});
    if(!j.ok) throw Object.assign(new Error(j.error||('HTTP '+res.status)),{stop:res.status>=400&&res.status<500});
    return j;
  }
  async function flush(loud){
    if(flushing||!token()) return; flushing=true;
    try{
      const box=await idb.all('outbox'); let sent=0;
      for(const it of box.sort((a,b)=>a.queued_at-b.queued_at)){
        if(navigator.onLine===false) break;
        try{ await upload(it); await idb.del('outbox',it.client_id); sent++; }
        catch(e){
          if(e.message==='signed_out'){ toast('Your sign-in ran out. Sign in again in Messages — your POD is saved and will send after.'); break; }
          it.tries=(it.tries||0)+1; it.last_error=e.message; await idb.put('outbox',it);
          if(e.stop&&loud) toast('POD not sent: '+e.message);
        }
      }
      if(sent){ toast(sent===1?'POD sent to dispatch ✓':`${sent} PODs sent to dispatch ✓`); loadMine(); }
      else if(loud&&navigator.onLine===false) toast('No signal — the POD is saved on this phone and sends itself when you have signal.');
    }finally{ flushing=false; status(''); drawOutbox(); }
  }

  // ---------------------------------------------------------------- location + nearby customers
  function locate(){
    if(!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async p=>{
      spot={lat:p.coords.latitude,lon:p.coords.longitude,acc:Math.round(p.coords.accuracy||0)};
      if(!token()) return;
      try{
        const r=await rpc('site_search',{p_token:token(),p_q:'',p_lat:spot.lat,p_lon:spot.lon});
        if(r.ok){ nearby=(r.sites||[]).slice(0,12); drawNearby(); }
      }catch(e){}
    },()=>{}, {enableHighAccuracy:true,timeout:10000,maximumAge:120000});
  }
  async function rpc(name,args){ const r=await fetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }

  // ---------------------------------------------------------------- UI
  function build(){
    const sec=$(VIEW); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="card pod-wrap">
      <div class="pod-head"><h2>Proof of Delivery</h2><p class="hint">Photo the signed BOL → one PDF → dispatch has it in seconds. Works with no signal; it sends when you get signal.</p></div>
      <div id="podSignIn" class="pod-note pod-warn" hidden>Sign in once with your Driver ID and PIN to send PODs. <button type="button" class="ghost" data-view="messages">Sign in</button></div>
      <div id="podOutbox" class="pod-note pod-warn" hidden></div>

      <h3 class="pod-step"><span class="pod-num">1</span> Load</h3>
      <div class="pod-grid">
        <label>Load / BOL #<input id="podLoad" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Required"></label>
        <label>Delivered<input id="podWhen" type="datetime-local"></label>
        <label class="pod-span">Customer<input id="podCust" list="podCustList" autocomplete="off" placeholder="Who received it"><datalist id="podCustList"></datalist></label>
        <div id="podNearby" class="pod-chips pod-span"></div>
        <label>Pallets delivered <span class="hint">(optional)</span><input id="podPallets" type="number" inputmode="numeric" min="0" step="1"></label>
      </div>
      <label>Condition</label>
      <div class="pod-conds">${CONDS.map(([k,l])=>`<button type="button" class="pod-cond" data-pod-cond="${k}">${l}</button>`).join('')}</div>
      <label id="podNoteLbl">Note <span class="hint" id="podNoteHint">(optional)</span><textarea id="podNote" rows="2" maxlength="500" placeholder="e.g. 2 pallets damaged — noted on BOL, photos sent"></textarea></label>

      <h3 class="pod-step"><span class="pod-num">2</span> Signed paperwork</h3>
      <div class="pod-snap">
        <label class="pod-bigbtn">📷 Take photo of page<input type="file" id="podCam" accept="image/*" capture="environment" hidden></label>
        <label class="pod-bigbtn ghosty">🖼️ Add from photos<input type="file" id="podPick" accept="image/*" multiple hidden></label>
      </div>
      <p class="hint">Lay the page flat on something dark, fill the screen with it, hold steady. One photo per page — take the next page after each one.</p>
      <div id="podPages" class="pod-pages"></div>
      <div id="podStatus" class="hint pod-status"></div>

      <button type="button" id="podSend" class="pod-send">Send POD to dispatch</button>
      <button type="button" id="podShare" class="ghost pod-share">Save / share a copy of the PDF</button>

      <h3 class="pod-step pod-mine-h">My PODs <span class="hint">(last 30 days)</span> <button type="button" class="ghost pod-small" id="podMineRefresh">Refresh</button></h3>
      <div id="podMine" class="pod-mine"><p class="hint">—</p></div>
    </div>`;
    $('podCam').onchange=e=>{ addFiles([...e.target.files]); e.target.value=''; };
    $('podPick').onchange=e=>{ addFiles([...e.target.files]); e.target.value=''; };
    $('podSend').onclick=send;
    $('podShare').onclick=shareCopy;
    $('podMineRefresh').onclick=loadMine;
    ['podLoad','podWhen','podCust','podPallets','podNote'].forEach(id=>$(id).addEventListener('input',()=>{ readForm(); saveForm(); }));
    $('podCust').addEventListener('change',()=>{ const n=nearby.find(s=>s.name===$('podCust').value); form.addr_id=n?n.addr_id:''; saveForm(); });
    sec.addEventListener('click',onClick);
  }
  function readForm(){
    form.load=$('podLoad').value.trim().toUpperCase(); form.when=$('podWhen').value; form.customer=$('podCust').value.trim();
    form.pallets=$('podPallets').value; form.note=$('podNote').value.trim();
  }
  function drawForm(){
    $('podLoad').value=form.load||''; $('podWhen').value=form.when||nowLocal(); $('podCust').value=form.customer||'';
    $('podPallets').value=form.pallets||''; $('podNote').value=form.note||'';
    document.querySelectorAll('[data-pod-cond]').forEach(b=>b.classList.toggle('on',b.dataset.podCond===form.cond));
    $('podNoteHint').textContent=form.cond==='clean'?'(optional)':'— required: what was '+form.cond+'?';
    $('podNoteLbl').classList.toggle('pod-req',form.cond!=='clean');
  }
  function drawNearby(){
    $('podCustList').innerHTML=nearby.map(s=>`<option value="${esc(s.name)}">${s.miles!=null?s.miles+' mi':''}</option>`).join('');
    const close=nearby.filter(s=>s.miles!=null&&s.miles<=1.5).slice(0,4);
    $('podNearby').innerHTML=close.length?'<span class="hint">You\'re near:</span> '+close.map(s=>`<button type="button" class="pod-chip" data-pod-near="${esc(s.addr_id)}">${esc(s.name)} <small>${s.miles} mi</small></button>`).join(''):'';
  }
  function drawPages(){
    const box=$('podPages'); if(!box) return;
    pages.forEach(p=>{ if(p.url) URL.revokeObjectURL(p.url); });
    Promise.all(pages.map(async p=>{ p.url=URL.createObjectURL(await pageImage(p)); })).then(()=>{
      box.innerHTML=pages.map((p,i)=>`<div class="pod-page"><img src="${p.url}" alt="Page ${i+1}"><div class="pod-page-bar"><b>${i+1}</b><button type="button" class="pod-ic" data-pod-rot="${p.id}" title="Turn">↻</button><button type="button" class="pod-ic${p.plain?' on':''}" data-pod-plain="${p.id}" title="Use the photo as taken (no crop / cleanup)">${p.plain?'Photo':'Clean'}</button><button type="button" class="pod-ic pod-del" data-pod-del="${p.id}" title="Remove">✕</button></div></div>`).join('');
      $('podSend').textContent=pages.length?`Send POD to dispatch (${pages.length} page${pages.length===1?'':'s'})`:'Send POD to dispatch';
      $('podShare').hidden=!pages.length;
    });
  }
  async function drawOutbox(){
    const b=$('podOutbox'); if(!b) return;
    let box=[]; try{ box=await idb.all('outbox'); }catch(e){}
    b.hidden=!box.length;
    b.innerHTML=box.length?`<b>${box.length} POD${box.length===1?'':'s'} waiting to send</b> (${box.map(x=>esc(x.meta.load_no)).join(', ')}) — ${navigator.onLine===false?'no signal right now, it sends by itself.':`<button type="button" class="ghost pod-small" data-pod="retry">Send now</button>`}${box.some(x=>x.last_error&&x.last_error!=='signed_out')?`<div class="hint">Last try: ${esc(box.find(x=>x.last_error).last_error)}</div>`:''}`:'';
  }
  function drawAll(){ drawForm(); drawPages(); drawOutbox(); $('podSignIn').hidden=!!token(); }
  function status(t){ const s=$('podStatus'); if(s) s.textContent=t||''; }

  async function loadMine(){
    const box=$('podMine'); if(!box) return;
    if(!token()){ box.innerHTML='<p class="hint">Sign in to see your PODs.</p>'; return; }
    try{
      const r=await rpc('pod_list',{p_token:token(),p_days:30});
      if(!r.ok){ box.innerHTML=`<p class="hint">${r.error==='signed_out'?'Sign in again in Messages.':esc(r.error)}</p>`; return; }
      box.innerHTML=r.pods.length?r.pods.map(p=>`<button type="button" class="pod-row" data-pod-open="${p.id}"><b>Load ${esc(p.load_no)}</b>${p.customer?' · '+esc(p.customer):''}<span class="hint">${when(p.delivered_at)} · ${p.pages||'?'} pg${p.condition!=='clean'?` · <span class="pod-bad">${esc(p.condition.toUpperCase())}</span>`:''}${p.reviewed_at?' · ✓ seen by dispatch':''}</span></button>`).join(''):'<p class="hint">None yet.</p>';
    }catch(e){ box.innerHTML='<p class="hint">No connection.</p>'; }
  }
  async function openPod(id){
    try{
      const r=await fetch(FN+'?action=url',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({token:token(),id})}).then(r=>r.json());
      if(!r.ok) throw new Error(r.error||'Not available'); window.open(r.url,'_blank','noopener');
    }catch(e){ toast(e.message); }
  }
  async function shareCopy(){
    if(!pages.length) return; readForm();
    try{
      status('Making the PDF…'); const blob=await buildPdf(); status('');
      const name=`POD ${form.load||'delivery'} ${new Date().toISOString().slice(0,10)}.pdf`.replace(/[^\w .-]/g,'_');
      const file=new File([blob],name,{type:'application/pdf'});
      if(navigator.canShare&&navigator.canShare({files:[file]})){ try{ await navigator.share({files:[file],title:name}); }catch(e){} }
      else { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); }
    }catch(e){ status(''); toast(e.message); }
  }

  async function onClick(e){
    const b=e.target.closest('button'); if(!b) return; const d=b.dataset;
    if(d.podCond){ form.cond=d.podCond; saveForm(); drawForm(); if(form.cond!=='clean') $('podNote').focus(); return; }
    if(d.podNear){ const s=nearby.find(x=>x.addr_id===d.podNear); if(s){ form.customer=s.name; form.addr_id=s.addr_id; $('podCust').value=s.name; saveForm(); } return; }
    if(d.podDel){ if(!confirm('Remove this page?')) return; pages=pages.filter(p=>p.id!==d.podDel); await idb.del('pages',d.podDel); drawPages(); return; }
    if(d.podRot){ const p=pages.find(x=>x.id===d.podRot); p.rot=(p.rot+90)%360; await idb.put('pages',strip(p)); drawPages(); return; }
    if(d.podPlain){ const p=pages.find(x=>x.id===d.podPlain); p.plain=!p.plain; await idb.put('pages',strip(p)); drawPages(); return; }
    if(d.podOpen){ openPod(d.podOpen); return; }
    if(d.pod==='retry'){ flush(true); return; }
  }

  async function restore(){
    try{ const f=LWHStorage.get('podForm',null); if(f) form=Object.assign(form,f); }catch(e){}
    try{ pages=(await idb.all('pages')).sort((a,b)=>a.at-b.at); }catch(e){ pages=[]; }
  }

  window.addEventListener('online',()=>flush(false));
  setInterval(()=>{ if(document.visibilityState==='visible') flush(false); },90000);
  document.addEventListener('DOMContentLoaded',async()=>{
    const sec=$(VIEW); if(!sec) return;
    await restore();
    const onShow=()=>{ build(); drawAll(); locate(); loadMine(); flush(false); if(window.LWHDocScan&&navigator.onLine!==false) ensureCv(20000); };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
    setTimeout(()=>flush(false),5000);
  });
  window.LWHPod={flush};
})();
