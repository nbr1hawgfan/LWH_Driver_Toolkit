/* Trailer Inspection — submits to the existing "Trailer Defect Inspection"
   Google Apps Script project (same Sheet, PDF, email and photo folder).
   The GAS project needs Api.gs (doPost) deployed on the same web app URL. */
(function(){
  const API='https://script.google.com/macros/s/AKfycbyTZ4y30FAUEqoSBZR2luzCrwWWGtitmrDEAmILm1NTywV78yveXPxYSI5tBLI6QyFO/exec';
  const STEPS=7;
  const $=id=>document.getElementById(id);
  const safe=s=>LWHUI.safe(s);

  const st={
    loaded:false, loading:false,
    drivers:[], locations:[], defects:{},
    step:1, driver:'', location:'', selected:[], clear:false,
    photo:'', busy:false
  };

  /* ---------- API ---------- */
  async function api(action,data,timeoutMs){
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),timeoutMs||30000);
    let text;
    try{
      const res=await fetch(API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify(Object.assign({action},data||{})),redirect:'follow',signal:ctrl.signal});
      text=await res.text();
    }catch(e){
      throw new Error(e.name==='AbortError'?'The server took too long to answer.':'No connection to the server.');
    }finally{ clearTimeout(t); }
    let j; try{ j=JSON.parse(text); }catch(e){ throw new Error('The inspection server is not set up for the toolkit yet.'); }
    if(!j.ok) throw new Error(j.error||'Request failed.');
    return j;
  }

  /* ---------- load lists (cached so the form opens instantly) ---------- */
  function applyLists(d){
    st.drivers=(d.drivers||[]).slice(); st.locations=(d.locations||[]).slice(); st.defects=d.defects||{};
    st.loaded=true;
    renderChips('driver'); renderChips('location'); renderDefects();
  }
  async function loadLists(){
    if(st.loading) return;
    const cached=LWHStorage.get('tdLists',null);
    if(cached && !st.loaded) applyLists(cached);
    st.loading=true; $('tdLoadErr').hidden=true;
    try{
      const j=await api('init',{},25000);
      LWHStorage.set('tdLists',{drivers:j.drivers,locations:j.locations,defects:j.defects});
      applyLists(j);
    }catch(e){
      if(!st.loaded){ $('tdLoadErrMsg').textContent=e.message; $('tdLoadErr').hidden=false; }
    }finally{ st.loading=false; const l=$('tdLoading'); if(l) l.hidden=true; }
  }

  /* ---------- steps ---------- */
  function go(n){
    st.step=n;
    for(let i=1;i<=STEPS;i++){
      $('tdS'+i).hidden=i!==n;
      const dot=$('tdDot'+i); dot.className='td-dot'+(i===n?' active':i<n?' done':'');
    }
    $('tdStepLabel').textContent='Step '+n+' of '+STEPS;
    if(n===7) buildReview();
    window.scrollTo(0,0);
  }
  function need(cond,msg){ if(!cond){ LWHUI.toast(msg); return false; } return true; }

  /* ---------- driver / location chips ---------- */
  /* Driver names come only from the master driver list (synced hourly to the
     Drivers tab). Drivers type a few letters and the closest names come up:
     first or last name, initials ("aj"), and small typos ("micheal") all work. */
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  function near(a,b){              // true if a and b differ by at most one letter
    if(a===b) return true;
    if(Math.abs(a.length-b.length)>1) return false;
    let i=0,j=0,edits=0;
    while(i<a.length&&j<b.length){
      if(a[i]===b[j]){i++;j++;continue;}
      if(++edits>1) return false;
      if(a.length>b.length) i++; else if(b.length>a.length) j++;
      else if(a[i+1]===b[j]&&a[i]===b[j+1]){i+=2;j+=2;} else {i++;j++;}
    }
    return edits+(a.length-i)+(b.length-j)<=1;
  }
  function score(name,q){
    const n=norm(name), words=n.split(' '), parts=norm(q).split(' ').filter(Boolean);
    if(!parts.length) return 1;
    if(n.startsWith(norm(q))) return 100;
    if(parts.length===1&&parts[0].length>=2&&words.map(w=>w[0]).join('')===parts[0]) return 90;   // initials
    let total=0;
    for(const p of parts){
      let best=0;
      for(const w of words){
        if(w.startsWith(p)) best=Math.max(best,60);
        else if(w.includes(p)&&p.length>=3) best=Math.max(best,35);
        else if(p.length>=3&&(near(w.slice(0,p.length),p)||near(w.slice(0,p.length+1),p)||near(w,p))) best=Math.max(best,25);
      }
      if(!best) return 0;
      total+=best;
    }
    return total/parts.length;
  }
  function renderDriverChips(){
    const grid=$('tdDriverGrid'), q=$('tdDriverFind').value, msg=$('tdDriverFindMsg');
    $('tdDriverFindX').hidden=!q;
    if(!st.loaded){ return; }
    let list=st.drivers.map(n=>({n,s:score(n,q)})).filter(x=>x.s>0);
    list.sort((a,b)=>b.s-a.s||a.n.localeCompare(b.n));
    const last=LWHStorage.get('tdLastDriver','');
    if(!q.trim()&&last&&st.drivers.includes(last)) list=[{n:last}].concat(list.filter(x=>x.n!==last));
    msg.hidden=!q.trim();
    msg.textContent=!list.length?'No name matches "'+q.trim()+'". Check the spelling or try your last name.':list.length===1?'Is this you? Tap your name.':list.length+' names match';
    msg.className='td-findmsg'+(list.length?'':' none');
    grid.innerHTML=list.map((x,i)=>`<button type="button" class="td-chip${q.trim()&&i===0?' td-chip-top':''}" data-pick="driver" data-val="${safe(x.n)}">${safe(x.n)}${!q.trim()&&x.n===last?' <span class="td-chip-tag">last time</span>':''}</button>`).join('');
  }
  function renderChips(type){
    if(type==='driver'){
      // a remembered name that's no longer on the list (renamed / left) is dropped
      if(st.driver&&st.drivers.length&&!st.drivers.includes(st.driver)){ st.driver=''; LWHStorage.set('tdLastDriver',''); }
      renderDriverChips(); showPicked('driver'); return;
    }
    const items=st.locations;
    const grid=$('tdLocGrid');
    grid.innerHTML=items.map(n=>`<button type="button" class="td-chip" data-pick="${type}" data-val="${safe(n)}">${safe(n)}</button>`).join('')+
      `<button type="button" class="td-chip td-chip-new" data-new="${type}">＋ Different / new location</button>`;
    showPicked(type);
  }
  function pick(type,val){
    if(type==='driver'){ st.driver=val; LWHStorage.set('tdLastDriver',val); $('tdDriverFind').value=''; renderDriverChips(); }
    else st.location=val;
    showPicked(type);
  }
  function showPicked(type){
    const val=type==='driver'?st.driver:st.location;
    const p=type==='driver'?'tdDriver':'tdLoc';
    $(p+'Banner').hidden=!val;
    $(p+'BannerText').textContent=(type==='driver'?'👤 ':'📍 ')+val;
    if(type==='driver'){ $('tdDriverPick').hidden=!!val; return; }
    $(p+'Grid').hidden=!!val;
    $(p+'New').hidden=true;
  }
  function changePick(type){
    if(type==='driver'){ st.driver=''; $('tdDriverFind').value=''; renderDriverChips(); showPicked(type); setTimeout(()=>$('tdDriverFind').focus(),50); return; }
    st.location='';
    showPicked(type);
  }
  function showNew(type){
    const p=type==='driver'?'tdDriver':'tdLoc';
    $(p+'Grid').hidden=true; $(p+'New').hidden=false;
    setTimeout(()=>$(p+'NewInput').focus(),50);
  }
  function confirmNew(type){
    const p=type==='driver'?'tdDriver':'tdLoc';
    const v=$(p+'NewInput').value.trim();
    if(!need(v,type==='driver'?'Please type your full name.':'Please type the location.')) return;
    const list=type==='driver'?st.drivers:st.locations;
    if(!list.some(x=>x.toLowerCase()===v.toLowerCase())) list.push(v);
    $(p+'NewInput').value='';
    renderChips(type); pick(type,v);
  }
  function cancelNew(type){
    const p=type==='driver'?'tdDriver':'tdLoc';
    $(p+'NewInput').value=''; $(p+'New').hidden=true; $(p+'Grid').hidden=false;
  }

  /* ---------- defects ---------- */
  function renderDefects(){
    const cats=Object.keys(st.defects);
    const box=$('tdDefectList');
    if(!cats.length){ box.innerHTML='<p class="hint" style="text-align:center;padding:12px">Defect list not loaded yet.</p>'; return; }
    box.innerHTML=cats.map(cat=>`
      <div class="td-cat" data-cat="${safe(cat)}">
        <button type="button" class="td-cat-head" data-togglecat><span>${safe(cat)}</span><span class="td-cat-badge">0</span></button>
        <div class="td-cat-items">
          ${st.defects[cat].map(d=>`<button type="button" class="td-defect" data-defect="${safe(d)}"><span class="td-check"></span><span>${safe(d)}</span></button>`).join('')}
        </div>
      </div>`).join('');
    syncDefects();
  }
  function toggleDefect(d){
    const i=st.selected.indexOf(d);
    if(i>-1) st.selected.splice(i,1); else { st.selected.push(d); setClear(false); }
    syncDefects();
  }
  function syncDefects(){
    document.querySelectorAll('#tdDefectList .td-defect').forEach(b=>{
      const on=st.selected.includes(b.dataset.defect);
      b.classList.toggle('on',on); b.querySelector('.td-check').textContent=on?'✓':'';
    });
    document.querySelectorAll('#tdDefectList .td-cat').forEach(c=>{
      const n=c.querySelectorAll('.td-defect.on').length, badge=c.querySelector('.td-cat-badge');
      badge.textContent=n; badge.classList.toggle('hot',n>0);
    });
    const sum=$('tdSelected');
    sum.hidden=!st.selected.length;
    $('tdSelectedTags').innerHTML=st.selected.map(d=>`<button type="button" class="td-tag" data-untag="${safe(d)}">${safe(d)} ✕</button>`).join('');
  }
  function filterDefects(q){
    q=q.trim().toLowerCase(); let any=false;
    document.querySelectorAll('#tdDefectList .td-cat').forEach(c=>{
      let vis=0;
      c.querySelectorAll('.td-defect').forEach(b=>{ const m=!q||b.dataset.defect.toLowerCase().includes(q); b.hidden=!m; if(m) vis++; });
      c.hidden=!!q&&!vis; if(q&&vis) c.classList.remove('collapsed');
      if(vis) any=true;
    });
    $('tdNoMatch').hidden=any; $('tdSearchClear').hidden=!q;
  }
  function addCustom(val){
    const row=document.createElement('div'); row.className='td-custom-row';
    row.innerHTML=`<input type="text" class="td-custom" placeholder="Describe the defect…" autocomplete="off" value="${safe(val||'')}"><button type="button" class="td-del" aria-label="Remove">✕</button>`;
    row.querySelector('.td-del').onclick=()=>row.remove();
    row.querySelector('input').addEventListener('input',e=>{ if(e.target.value.trim()) setClear(false); });
    $('tdCustomRows').appendChild(row); row.querySelector('input').focus();
  }
  function customs(){ return [...document.querySelectorAll('#tdCustomRows .td-custom')].map(i=>i.value.trim()).filter(Boolean); }
  function setClear(on){
    st.clear=on;
    $('tdClearBtn').classList.toggle('on',on);
    $('tdClearCheck').textContent=on?'✓':'';
  }

  /* ---------- photo ---------- */
  function onPhoto(e){
    const f=e.target.files&&e.target.files[0]; if(!f) return;
    if(f.size>25*1024*1024){ LWHUI.toast('Photo is too large.'); return; }
    const r=new FileReader();
    r.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        const MAX=1600; let w=img.naturalWidth,h=img.naturalHeight;
        if(w>MAX||h>MAX){ if(w>h){ h=Math.round(h*MAX/w); w=MAX; } else { w=Math.round(w*MAX/h); h=MAX; } }
        const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h);
        const url=c.toDataURL('image/jpeg',0.72);
        st.photo=url.slice(url.indexOf(',')+1);
        $('tdPhotoImg').src=url; $('tdPhotoPreview').hidden=false; $('tdPhotoPick').hidden=true;
      };
      img.src=ev.target.result;
    };
    r.readAsDataURL(f);
  }
  function clearPhoto(){ st.photo=''; $('tdPhotoInput').value=''; $('tdPhotoPreview').hidden=true; $('tdPhotoPick').hidden=false; }

  /* ---------- review & submit ---------- */
  function fmtDate(s){ if(!s) return ''; const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}); }
  function buildReview(){
    const c=customs(), n=st.selected.length+c.length, notes=$('tdNotes').value.trim();
    const row=(k,v,cls)=>`<div class="td-rev-row"><div class="td-rev-k">${k}</div><div class="td-rev-v ${cls||''}">${v}</div></div>`;
    let h=row('Date',safe(fmtDate($('tdDate').value)))+row('Driver',safe(st.driver))+row('Trailer',safe($('tdTrailer').value.trim().toUpperCase()))+row('Location',safe(st.location));
    h+=n?row('Defects',n+' defect'+(n===1?'':'s')+' reported','bad')+row('',st.selected.concat(c).map(d=>`<span class="td-rev-tag">${safe(d)}</span>`).join(''))
        :row('Defects','✅ Trailer is clear — no defects','good');
    if(notes) h+=row('Notes',safe(notes));
    if(st.photo) h+=row('Photo','📷 Photo attached');
    $('tdReview').innerHTML=h;
  }
  function gps(){
    return new Promise(res=>{
      if(!navigator.geolocation) return res(null);
      const t=setTimeout(()=>res(null),8000);
      navigator.geolocation.getCurrentPosition(p=>{ clearTimeout(t); res({lat:p.coords.latitude.toFixed(6),lng:p.coords.longitude.toFixed(6)}); },
        ()=>{ clearTimeout(t); res(null); },{timeout:7000,maximumAge:30000});
    });
  }
  function busy(on,msg){ st.busy=on; $('tdBusy').hidden=!on; if(msg) $('tdBusyMsg').textContent=msg; $('tdSubmit').disabled=on; }
  async function submit(){
    if(st.busy) return;
    busy(true,'Getting location…');
    const loc=await gps();
    busy(true,st.photo?'Sending inspection and photo…':'Sending inspection…');
    const payload={
      inspectionDate:$('tdDate').value, driverName:st.driver,
      trailerNumber:$('tdTrailer').value.trim().toUpperCase(), trailerLocation:st.location,
      defects:st.selected.slice(), customDefects:customs(), notes:$('tdNotes').value.trim(),
      gpsLat:loc?loc.lat:'', gpsLng:loc?loc.lng:'',
      userAgent:('LWH Driver Toolkit · '+navigator.userAgent).slice(0,120)
    };
    try{
      const j=await api('submit',{payload,photo:st.photo},120000);
      busy(false);
      const n=payload.defects.length+payload.customDefects.length;
      $('tdDoneSummary').textContent=`${payload.driverName} — Trailer ${payload.trailerNumber} (${payload.trailerLocation}). `+(n?`${n} defect${n===1?'':'s'} reported.`:'No defects — trailer is clear.');
      $('tdDonePhoto').hidden=!(st.photo&&j.photoSaved===false);
      $('tdForm').hidden=true; $('tdDone').hidden=false; window.scrollTo(0,0);
    }catch(e){
      busy(false);
      $('tdSubmitErrMsg').textContent=e.message; $('tdSubmitErr').hidden=false;
    }
  }
  function reset(){
    $('tdTrailer').value=''; $('tdNotes').value=''; $('tdCustomRows').innerHTML=''; $('tdSearch').value='';
    st.selected=[]; st.location=''; setClear(false); clearPhoto(); filterDefects(''); syncDefects(); showPicked('location');
    $('tdDate').value=today(); $('tdSubmitErr').hidden=true;
    $('tdDone').hidden=true; $('tdForm').hidden=false;
    go(1);
  }
  function today(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

  /* ---------- wiring ---------- */
  function init(){
    const root=$('trailerdefect'); if(!root) return;
    $('tdDate').value=today();
    st.driver=LWHStorage.get('tdLastDriver','')||'';
    $('tdOldLink').href=API; $('tdOldLink2').href=API;

    root.addEventListener('click',e=>{
      const t=e.target.closest('button'); if(!t||!root.contains(t)) return;
      if(t.dataset.pick) return pick(t.dataset.pick,t.dataset.val);
      if(t.dataset.new) return showNew(t.dataset.new);
      if(t.dataset.defect) return toggleDefect(t.dataset.defect);
      if(t.dataset.untag) return toggleDefect(t.dataset.untag);
      if(t.hasAttribute('data-togglecat')) return t.parentElement.classList.toggle('collapsed');
      if(t.dataset.back) return go(Number(t.dataset.back));
    });
    $('tdN1').onclick=()=>need($('tdDate').value,'Please confirm the date.')&&go(2);
    $('tdN2').onclick=()=>need(st.driver&&(!st.drivers.length||st.drivers.includes(st.driver)),'Please find and tap your name.')&&go(3);
    $('tdN3').onclick=()=>need($('tdTrailer').value.trim(),'Please enter the trailer number.')&&go(4);
    $('tdN4').onclick=()=>need(st.location,'Please tap a location.')&&go(5);
    $('tdN5').onclick=()=>need(st.selected.length||customs().length||st.clear,'Tap any defects found, or confirm the trailer is clear.')&&go(6);
    $('tdN6').onclick=()=>go(7);
    $('tdSkip6').onclick=()=>go(7);
    $('tdDriverChange').onclick=()=>changePick('driver');
    $('tdLocChange').onclick=()=>changePick('location');
    $('tdDriverFind').addEventListener('input',renderDriverChips);
    $('tdDriverFind').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); const top=$('tdDriverGrid').querySelector('[data-pick]'); if(top&&$('tdDriverFind').value.trim()) top.click(); } });
    $('tdDriverFindX').onclick=()=>{ $('tdDriverFind').value=''; renderDriverChips(); $('tdDriverFind').focus(); };
    $('tdLocNewOk').onclick=()=>confirmNew('location');    $('tdLocNewCancel').onclick=()=>cancelNew('location');
    $('tdClearBtn').onclick=()=>{
      if(!st.clear&&(st.selected.length||customs().length)) return LWHUI.toast('You have defects selected — remove them first.');
      setClear(!st.clear);
    };
    $('tdAddCustom').onclick=()=>addCustom('');
    $('tdSearch').addEventListener('input',e=>filterDefects(e.target.value));
    $('tdSearchClear').onclick=()=>{ $('tdSearch').value=''; filterDefects(''); };
    $('tdPhotoPick').onclick=()=>$('tdPhotoInput').click();
    $('tdPhotoInput').addEventListener('change',onPhoto);
    $('tdPhotoRemove').onclick=clearPhoto;
    $('tdSubmit').onclick=submit;
    $('tdRetrySubmit').onclick=()=>{ $('tdSubmitErr').hidden=true; submit(); };
    $('tdRetryLoad').onclick=loadLists;
    $('tdNew').onclick=reset;
    $('tdLocNewInput').addEventListener('keydown',e=>{ if(e.key==='Enter') $('tdLocNewOk').click(); });

    // Load lists the first time the screen is opened (and refresh on later opens)
    const obs=new MutationObserver(()=>{ if(root.classList.contains('active')) loadLists(); });
    obs.observe(root,{attributes:true,attributeFilter:['class']});
    if(root.classList.contains('active')) loadLists();
    go(1);
  }
  window.addEventListener('load',init);
})();
