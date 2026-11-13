// Time Clock (v1.42.0)
// Drivers clock in / out on their own phone (or a shared tablet): pick your name, type the same
// PIN as the PTO / time off app, tap the big button. Lunch = Clock Out, then Clock In again.
// - Each punch sends the phone's GPS position (if allowed); the server notes the nearest LWH site.
// - No signal: the PIN is checked on the phone (against the last good sign-in on this phone) and the
//   punch is saved here with the time it was tapped, then sent as soon as there is signal.
// - The screen forgets the PIN right after each punch, so a shared tablet is safe to hand around.
// Backend: Supabase RPCs tc_roster / tc_check / tc_punch (supabase/migrations/20261113_driver_timeclock.sql).
// Hours flow to TLand's Driver Hours tool through Sync-DriverClock.ps1 on APP02.
(function(){
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const PIN_HOLD_MS=120000, RESET_AFTER_MS=25000;
  const $=id=>document.getElementById(id);
  const safe=s=>LWHUI.safe(s);
  const st={ roster:[], driver:'', pin:'', pinAt:0, status:null, busy:false, resetTimer:null, tick:null };

  async function rpc(name,args,timeoutMs){
    const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),timeoutMs||15000);
    try{
      const r=await fetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store',signal:ctrl.signal});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // ------------------------------------------------------------ on-phone memory
  // profiles[driver_id] = { salt, hash, device, name }   (from the last good PIN on this phone)
  const mem={
    get roster(){ return LWHStorage.get('tcRoster',[]); }, set roster(v){ LWHStorage.set('tcRoster',v); },
    get driver(){ return LWHStorage.get('tcDriver',''); }, set driver(v){ v?LWHStorage.set('tcDriver',v):LWHStorage.remove('tcDriver'); },
    get profiles(){ return LWHStorage.get('tcProfiles',{}); }, set profiles(v){ LWHStorage.set('tcProfiles',v); },
    get queue(){ return LWHStorage.get('tcQueue',[]); }, set queue(v){ LWHStorage.set('tcQueue',v); },
    get last(){ return LWHStorage.get('tcLast',{}); }, set last(v){ LWHStorage.set('tcLast',v); }
  };
  async function sha(s){
    const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  function rand(n){ const a=new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x=>x.toString(16).padStart(2,'0')).join(''); }
  async function rememberGood(id,pin,device,status){
    const p=mem.profiles, salt=rand(12);
    p[id]={ salt, hash:await sha(salt+'|'+pin), device:device||(p[id]&&p[id].device)||'', name:(status&&status.name)||'' };
    mem.profiles=p;
    if(status) saveLast(id,status);
  }
  function saveLast(id,s){ const l=mem.last; l[id]={ type:s.last_type||null, at:s.last_at||null, stale:!!s.stale_in, saved:Date.now() }; mem.last=l; }

  // ------------------------------------------------------------ time helpers
  const fmtT=iso=>new Date(iso).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const fmtDT=iso=>{ const d=new Date(iso), today=new Date();
    return d.toDateString()===today.toDateString()? fmtT(iso) : d.toLocaleDateString([], {weekday:'short'})+' '+fmtT(iso); };
  const hrs=v=>v===null||v===undefined?'—':(+v).toFixed(2).replace(/\.00$/,'');
  const pad=n=>String(n).padStart(2,'0');
  const isoDay=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());

  // ------------------------------------------------------------ GPS (never holds a punch up more than 8 s)
  function getFix(){
    return new Promise(res=>{
      if(!('geolocation' in navigator)) return res(null);
      let done=false; const fin=v=>{ if(!done){ done=true; res(v); } };
      setTimeout(()=>fin(null),8000);
      try{ navigator.geolocation.getCurrentPosition(p=>fin({lat:p.coords.latitude,lon:p.coords.longitude,acc:Math.round(p.coords.accuracy||0)}),()=>fin(null),{enableHighAccuracy:true,timeout:7500,maximumAge:60000}); }
      catch(e){ fin(null); }
    });
  }

  // ------------------------------------------------------------ roster
  async function loadRoster(){
    if(!st.roster.length) st.roster=mem.roster;
    renderNames();
    if(!navigator.onLine) return;
    try{ const r=await rpc('tc_roster',{}); if(Array.isArray(r)){ st.roster=r; mem.roster=r; renderNames(); } }
    catch(e){ if(!st.roster.length) msg('Could not load the driver list. Check your signal and try again.', 'bad'); }
  }
  function nameOf(id){ const d=st.roster.find(x=>x.driver_id===id); return d?d.name:((mem.profiles[id]||{}).name||id); }

  // ------------------------------------------------------------ screens
  function msg(text,kind){ const m=$('tcMsg'); if(!m) return; m.textContent=text||''; m.className='tc-msg'+(kind?' '+kind:''); m.hidden=!text; }
  function showStep(step){ ['tcStepName','tcStepPin','tcStepPunch','tcStepDone'].forEach(id=>{ const e=$(id); if(e) e.hidden=(id!==step); }); }

  function renderNames(){
    const sel=$('tcName'); if(!sel) return;
    const keep=st.driver||mem.driver;
    sel.innerHTML='<option value="">Pick your name…</option>'+st.roster.map(d=>`<option value="${safe(d.driver_id)}">${safe(d.name)}${d.has_pin?'':' (no PIN yet)'}</option>`).join('');
    if(keep && st.roster.some(d=>d.driver_id===keep)) sel.value=keep;
  }

  function startOver(keepName){
    clearTimeout(st.resetTimer);
    st.pin=''; st.pinAt=0; st.status=null;
    if($('tcPin')) $('tcPin').value='';
    msg('');
    const id=keepName?(st.driver||mem.driver):'';
    if(id){ st.driver=id; $('tcWho').textContent=nameOf(id); showStep('tcStepPin'); setTimeout(()=>{ try{$('tcPin').focus();}catch(e){} },50); }
    else { st.driver=''; showStep('tcStepName'); }
    renderQueueNote();
  }

  async function pickName(){
    const id=$('tcName').value;
    if(!id){ msg('Pick your name from the list.','bad'); return; }
    const d=st.roster.find(x=>x.driver_id===id);
    st.driver=id; mem.driver=id;
    $('tcWho').textContent=nameOf(id);
    msg(d&&!d.has_pin?'No PIN on file for you yet. Ask Chris to put your PIN in the PTO tracker (the same PIN you use for time off).':'', d&&!d.has_pin?'bad':'');
    showStep('tcStepPin');
    setTimeout(()=>{ try{$('tcPin').focus();}catch(e){} },50);
  }

  async function submitPin(){
    if(st.busy) return;
    const pin=($('tcPin').value||'').replace(/\D/g,'');
    if(pin.length<4){ msg('Type your PIN (4 to 6 numbers).','bad'); return; }
    st.busy=true; $('tcPinGo').disabled=true; msg('Checking…');
    try{
      if(navigator.onLine){
        try{
          const prev=mem.profiles[st.driver];
          const r=await rpc('tc_check',{p_driver_id:st.driver,p_pin:pin,p_device:(prev&&prev.device)||null});
          if(!r.ok){ msg(r.error||'That did not work.','bad'); $('tcPin').value=''; return; }
          st.pin=pin; st.pinAt=Date.now(); st.status=r.status;
          await rememberGood(st.driver,pin,r.device,r.status);
          renderPunch(); return;
        }catch(e){ /* fall through to offline */ }
      }
      // Offline: check against the last good sign-in on this phone
      const p=mem.profiles[st.driver];
      if(!p||!p.device){ msg('No signal, and this phone has not been used to clock in yet. Try again when you have signal, or tell Chris the time.','bad'); return; }
      if(await sha(p.salt+'|'+pin)!==p.hash){ msg('That PIN is not right.','bad'); $('tcPin').value=''; return; }
      st.pin=pin; st.pinAt=Date.now();
      const l=mem.last[st.driver]||{};
      const q=mem.queue.filter(x=>x.driver_id===st.driver);
      const lastQ=q[q.length-1];
      st.status={ offline:true, name:nameOf(st.driver),
        last_type: lastQ?lastQ.type:l.type, last_at: lastQ?lastQ.device_at:l.at,
        on_clock: (lastQ?lastQ.type:l.type)==='in' && (Date.now()-new Date(lastQ?lastQ.device_at:l.at).getTime())<16*3600e3,
        stale_in: (lastQ?lastQ.type:l.type)==='in' && (Date.now()-new Date(lastQ?lastQ.device_at:l.at).getTime())>=16*3600e3,
        today:[], week:[] };
      renderPunch();
    } finally { st.busy=false; $('tcPinGo').disabled=false; }
  }

  function renderPunch(){
    const s=st.status||{};
    $('tcWho2').textContent=s.name||nameOf(st.driver);
    const box=$('tcState'), big=$('tcBig'), alt=$('tcAlt');
    let next='in';
    if(s.on_clock){
      next='out';
      box.className='tc-state on';
      box.innerHTML=`<b>ON THE CLOCK</b><span>since ${fmtDT(s.last_at)}</span>`;
    } else if(s.stale_in){
      box.className='tc-state warn';
      box.innerHTML=`<b>You did not clock out last time</b><span>Clocked in ${fmtDT(s.last_at)}. Tell Chris what time you left.</span>`;
    } else {
      box.className='tc-state off';
      box.innerHTML=`<b>OFF THE CLOCK</b><span>${s.last_type==='out'&&s.last_at?'Clocked out '+fmtDT(s.last_at):'Not clocked in'}</span>`;
    }
    big.dataset.type=next;
    big.className='tc-big '+(next==='in'?'go':'stop');
    big.textContent=next==='in'?'CLOCK IN':'CLOCK OUT';
    alt.dataset.type=next==='in'?'out':'in';
    alt.textContent=next==='in'?'I need to Clock Out instead':'I need to Clock In instead';
    big.disabled=false; alt.disabled=false;
    $('tcOffNote').hidden=!s.offline;
    renderToday(s);
    msg('');
    showStep('tcStepPunch');
    clearTimeout(st.resetTimer); st.resetTimer=setTimeout(()=>startOver(true),PIN_HOLD_MS);
  }

  function renderToday(s){
    const t=$('tcToday'), w=$('tcWeek');
    const today=(s.today||[]);
    t.innerHTML=today.length?`<h3>Today</h3><ul class="tc-list">${today.map(p=>`<li><b class="${p.type==='in'?'in':'out'}">${p.type==='in'?'In':'Out'}</b> ${fmtDT(p.at)}${p.site?` <span class="hint">· ${safe(p.site)}</span>`:''}${p.offline?' <span class="hint">· sent later</span>':''}</li>`).join('')}</ul>`:'';
    const week=s.week||[];
    if(!week.length||!s.week_start){ w.innerHTML=''; return; }
    const by={}; week.forEach(d=>by[d.date]=d);
    const ws=new Date(s.week_start+'T00:00:00'); let tot=0;
    const cells=[0,1,2,3,4,5,6].map(i=>{ const d=new Date(ws); d.setDate(d.getDate()+i); const k=isoDay(d), x=by[k];
      if(x) tot+=+x.hours||0;
      return `<td><span>${d.toLocaleDateString([], {weekday:'short'})}</span><b>${x?hrs(x.hours)+(x.on_clock?'+':''):'—'}</b></td>`; }).join('');
    w.innerHTML=`<h3>This week</h3><div class="tc-week-wrap"><table class="tc-week"><tr>${cells}<td class="tot"><span>Total</span><b>${hrs(tot)}</b></td></tr></table></div><p class="hint">+ = still on the clock. Hours are rounded down to the nearest 3 minutes, the same as payroll. Chris checks them before payroll.</p>`;
  }

  async function punch(type){
    if(st.busy) return;
    if(!st.pin||Date.now()-st.pinAt>PIN_HOLD_MS){ startOver(true); msg('Type your PIN again.','bad'); return; }
    if(type!==$('tcBig').dataset.type && !confirm(type==='in'?'Clock IN now?':'Clock OUT now?')) return;
    st.busy=true; $('tcBig').disabled=true; $('tcAlt').disabled=true;
    msg('Getting your location…');
    const fix=await getFix();
    const item={ client_id:'tc-'+Date.now().toString(36)+'-'+rand(4), driver_id:st.driver, type, device_at:new Date().toISOString(),
                 lat:fix&&fix.lat, lon:fix&&fix.lon, acc:fix&&fix.acc };
    msg('Sending…');
    let r=null;
    if(navigator.onLine){
      try{ r=await rpc('tc_punch',{p_driver_id:st.driver,p_type:type,p_pin:st.pin,p_client_id:item.client_id,p_device_at:item.device_at,
                                   p_lat:item.lat??null,p_lon:item.lon??null,p_accuracy:item.acc??null}); }
      catch(e){ r=null; }
    }
    st.busy=false;
    if(r&&!r.ok){ msg(r.error||'That did not work.','bad'); $('tcBig').disabled=false; $('tcAlt').disabled=false; return; }
    if(r&&r.ok){
      if(r.status){ st.status=r.status; saveLast(st.driver,r.status); }
      done(type, r.punch?r.punch.at:item.device_at, r.punch&&r.punch.site, false, !fix);
    } else {
      // no signal: keep it on the phone with the time it was tapped
      const p=mem.profiles[st.driver];
      if(!p||!p.device){ msg('No signal and this phone is not set up for offline punches yet. Try again in a minute, or tell Chris the time.','bad'); $('tcBig').disabled=false; $('tcAlt').disabled=false; return; }
      const q=mem.queue; q.push(item); mem.queue=q;
      const l=mem.last; l[st.driver]={type,at:item.device_at,stale:false,saved:Date.now()}; mem.last=l;
      done(type, item.device_at, null, true, !fix);
    }
  }

  function done(type, at, site, queued, noGps){
    st.pin=''; st.pinAt=0; $('tcPin').value='';
    const d=$('tcDoneBox');
    d.className='tc-done '+(type==='in'?'in':'out');
    d.innerHTML=`<div class="tc-check">✓</div><b>${type==='in'?'CLOCKED IN':'CLOCKED OUT'}</b><span class="tc-done-time">${fmtT(at)}</span>
      <span>${safe(nameOf(st.driver))}${site?' · '+safe(site):''}</span>
      ${queued?'<span class="tc-done-note">No signal: saved on this phone. It will send by itself when you have signal. Leave the app installed.</span>':''}
      ${noGps?'<span class="tc-done-note">Location was not available. That is OK; the time still counts.</span>':''}
      ${type==='out'?'<span class="tc-done-note">Going to lunch? Clock back in when you return.</span>':''}`;
    msg('');
    showStep('tcStepDone');
    renderQueueNote(); updateHome();
    if(queued) flushSoon();
    clearTimeout(st.resetTimer); st.resetTimer=setTimeout(()=>startOver(true),RESET_AFTER_MS);
  }

  // ------------------------------------------------------------ offline queue
  let flushing=false, flushTimer=null;
  function flushSoon(){ clearTimeout(flushTimer); flushTimer=setTimeout(flush,4000); }
  async function flush(){
    if(flushing||!navigator.onLine) return;
    let q=mem.queue; if(!q.length) return;
    flushing=true;
    try{
      for(const item of q.slice()){
        const p=mem.profiles[item.driver_id];
        let r;
        try{ r=await rpc('tc_punch',{p_driver_id:item.driver_id,p_type:item.type,p_device:p&&p.device||'',p_client_id:item.client_id,
                                     p_device_at:item.device_at,p_lat:item.lat??null,p_lon:item.lon??null,p_accuracy:item.acc??null}); }
        catch(e){ break; }   // still no real signal; try later
        if(r&&r.ok){ if(r.status) saveLast(item.driver_id,r.status); }
        else if(r&&r.device_expired){ item.needsPin=true; }
        q=mem.queue.filter(x=>x.client_id!==item.client_id);
        if(r&&!r.ok){ item.error=r.error; item.failedAt=new Date().toISOString(); const f=LWHStorage.get('tcFailed',[]); f.push(item); LWHStorage.set('tcFailed',f.slice(-20)); }
        mem.queue=q;
      }
    } finally { flushing=false; renderQueueNote(); updateHome(); }
  }
  function renderQueueNote(){
    const n=mem.queue.length, f=LWHStorage.get('tcFailed',[]), el=$('tcQueue'); if(!el) return;
    let html='';
    if(n) html+=`<div class="tc-queue">${n===1?'1 punch is':n+' punches are'} saved on this phone, waiting for signal. <button type="button" class="ghost" id="tcSendNow">Send now</button></div>`;
    if(f.length) html+=`<div class="tc-queue bad">${f.length===1?'1 saved punch':f.length+' saved punches'} could not be sent (${safe(f[f.length-1].error||'')}). Tell Chris: ${f.map(x=>`${safe(nameOf(x.driver_id))} ${x.type==='in'?'in':'out'} ${fmtDT(x.device_at)}`).join('; ')}. <button type="button" class="ghost" id="tcFailedOk">Done, I told him</button></div>`;
    el.innerHTML=html;
    if($('tcSendNow')) $('tcSendNow').onclick=()=>{ if(!navigator.onLine){ LWHUI.toast('Still no signal'); return; } flush(); };
    if($('tcFailedOk')) $('tcFailedOk').onclick=()=>{ LWHStorage.remove('tcFailed'); renderQueueNote(); };
  }

  // ------------------------------------------------------------ clock face
  function tick(){ const c=$('tcNow'); if(!c) return; const d=new Date();
    c.innerHTML=`<b>${d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</b><span>${d.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}</span>`; }

  // Home card: the remembered driver's last punch on this phone
  function updateHome(){
    const sub=$('tcHomeSub'); if(!sub) return;
    const id=mem.driver, l=id&&mem.last[id], n=mem.queue.length;
    let t='Clock in and out with your PTO PIN.';
    if(l&&l.type==='in'&&l.at&&Date.now()-new Date(l.at).getTime()<16*3600e3) t='On the clock since '+fmtDT(l.at)+'. Tap to clock out.';
    else if(l&&l.type==='out'&&l.at&&Date.now()-new Date(l.at).getTime()<16*3600e3) t='Clocked out '+fmtDT(l.at)+'.';
    if(n) t+=' '+(n===1?'1 punch':n+' punches')+' waiting for signal.';
    sub.textContent=t;
  }

  function onShow(){
    tick(); clearInterval(st.tick); st.tick=setInterval(tick,10000);
    loadRoster(); flush(); startOver(true);
  }
  function onHide(){ updateHome(); clearInterval(st.tick); clearTimeout(st.resetTimer); st.pin=''; st.pinAt=0; if($('tcPin')) $('tcPin').value=''; }

  window.addEventListener('load',()=>{
    const root=$('timeclock'); if(!root) return;
    $('tcNameGo').onclick=pickName;
    $('tcName').onchange=()=>{ if($('tcName').value) pickName(); };
    $('tcPinGo').onclick=submitPin;
    $('tcPin').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); submitPin(); } });
    $('tcNotMe').onclick=()=>{ mem.driver=''; st.driver=''; $('tcName').value=''; startOver(false); };
    $('tcBig').onclick=()=>punch($('tcBig').dataset.type);
    $('tcAlt').onclick=()=>punch($('tcAlt').dataset.type);
    $('tcCancel').onclick=()=>startOver(true);
    $('tcAgain').onclick=()=>startOver(true);
    window.addEventListener('online',()=>{ flushSoon(); renderQueueNote(); });
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) flushSoon(); });
    setInterval(()=>{ if(mem.queue.length) flush(); },60000);
    let was=root.classList.contains('active');
    new MutationObserver(()=>{ const now=root.classList.contains('active'); if(now&&!was) onShow(); if(!now&&was) onHide(); was=now; })
      .observe(root,{attributes:true,attributeFilter:['class']});
    if(was) onShow();
    if(mem.queue.length) flushSoon();
    updateHome(); setInterval(updateHome,60000);
  });

  window.LWHTimeClock={ flush, queue:()=>mem.queue };
})();
