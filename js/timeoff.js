/* TIME OFF (v1.99.0; shared with the Driver Toolkit v1.55.0) — PTO requests and time off asks inside the Toolkit, plus approvals for PTO managers.
   A second door into the SAME PTO tracker the LWH_PTO apps use (one source of truth): requests made here
   show up in the PTO app and the other way around, with the same emails, PDFs and balance math.

   No second PIN: the PTO server's 'bridge.login' (Api.gs v1.2.0) asks Supabase (pto_bridge_who) who the
   Toolkit sign-in belongs to and opens a PTO session for that person. Manager rights come only from the
   PTO sheet's Managers tab. Someone turned off in Access, or inactive, can't get in this way.
   Talks to the PTO Apps Script directly (text/plain POST, same as the PTO app). */
(function(){
  'use strict';
  const VIEW='timeOff';
  const PTO_API='https://script.google.com/macros/s/AKfycbwXblseav0VCgynTXxL6BYTLniZ4xJAiYholbDgnFPXBqL46_sxP1Rc49MWMga52QsV/exec';
  const PTO_APP='https://nbr1hawgfan.github.io/LWH_PTO/', PTO_MGR_APP='https://nbr1hawgfan.github.io/LWH_PTO/manager/';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  // notes saved by the old portals may already be HTML-escaped — decode once, then escape
  const txt=s=>esc(String(s==null?'':s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'));
  const toast=t=>{ try{ LWHUI.toast(t); }catch(e){} };
  // Same file in the Warehouse Toolkit and the Driver Toolkit. Each app can set window.LWHTimeOffCfg
  // { token(), who() -> id, signIn(msg), calendarView } — defaults are the Warehouse Toolkit's.
  const CFG=Object.assign({
    token:()=>(window.LWHAuth&&LWHAuth.token&&LWHAuth.token())||'',
    who:()=>{ const m=window.LWHAuth&&LWHAuth.me&&LWHAuth.me(); return m&&m.emp_id; },
    signIn:msg=>{ if(window.LWHAuth) LWHAuth.requireSignIn(msg); },
    calendarView:'absenceCal'
  },window.LWHTimeOffCfg||{});
  const appTok=()=>CFG.token()||'';
  const me=()=>{ const id=CFG.who(); return id?{emp_id:id}:null; };
  const num=v=>{ const x=parseFloat(v); return isNaN(x)?0:Math.round(x*100)/100; };
  const todayIso=()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const mdy2iso=s=>{ const m=String(s||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m?m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0'):String(s||'').slice(0,10); };
  const nice=s=>{ const i=mdy2iso(s); const m=i.match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!m) return esc(s); return new Date(+m[1],+m[2]-1,+m[3]).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'}); };
  const range=(a,b)=>{ const A=mdy2iso(a), B=mdy2iso(b); return !B||A===B?nice(A):nice(A)+' – '+nice(B); };

  let tab='mine', emp=null, mgr=null, isPtoMgr=false, busy=false, setupNeeded=false, notLinked='';

  // ---------------------------------------------------------------- PTO sessions (one per Toolkit person)
  const SK=r=>'lwh_pto_'+r;
  function getS(role){ try{ const s=JSON.parse(localStorage.getItem(SK(role))||'null'); const m=me();
    if(!s||!s.token||s.expires<Date.now()+60e3||!m||s.who!==m.emp_id) return null; return s; }catch(e){ return null; } }
  function setS(role,s){ try{ s?localStorage.setItem(SK(role),JSON.stringify(s)):localStorage.removeItem(SK(role)); }catch(e){} }
  async function post(body){
    const ctrl=new AbortController(), t=setTimeout(()=>ctrl.abort(),60000);
    let r;
    try{ r=await fetch(PTO_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body),redirect:'follow',signal:ctrl.signal}); }
    catch(e){ throw new Error(e.name==='AbortError'?'The PTO server took too long. Try again.':(navigator.onLine?'Could not reach the PTO server.':'You are offline.')); }
    finally{ clearTimeout(t); }
    let j; try{ j=await r.json(); }catch(e){ throw new Error('Unexpected reply from the PTO server.'); }
    return j;
  }
  async function bridge(role){
    const j=await post({action:'bridge.login',appToken:appTok(),role});
    if(!j.ok){
      const e=String(j.error||'');
      if(/Unknown action/i.test(e)){ setupNeeded=true; throw new Error('setup'); }
      if(e==='SIGNED_OUT'){ CFG.signIn('Please sign in again.'); throw new Error('Please sign in again.'); }
      if(/not linked/i.test(e)){ notLinked=e; throw new Error('notlinked'); }
      throw new Error(e||'Could not open Time Off.');
    }
    const d=j.data, m=me();
    const s={token:d.token,expires:d.expires,who:m&&m.emp_id,isManager:!!d.isManager,name:d.profile&&d.profile.name};
    setS(role,s); if(role==='employee') isPtoMgr=!!d.isManager;
    return s;
  }
  async function call(role,action,payload,retried){
    let s=getS(role); if(!s) s=await bridge(role);
    const j=await post(Object.assign({action,token:s.token},payload||{}));
    if(!j.ok){
      if(j.error==='SESSION_EXPIRED'&&!retried){ setS(role,null); return call(role,action,payload,true); }
      throw new Error(j.error||'Something went wrong.');
    }
    return j.data;
  }

  // ---------------------------------------------------------------- screen
  function build(){
    const sec=$(VIEW); if(!sec||sec.dataset.built) return; sec.dataset.built='1';
    sec.innerHTML=`<div class="mh-wrap to">
      <div class="mh-top"><div><h2>Time Off</h2><div class="mh-sub">PTO requests and time off asks — the same PTO tracker as the PTO app. No extra PIN.</div></div>
        <button type="button" class="ghost" id="toRefresh">Refresh</button></div>
      <div class="to-tabs" role="tablist"><button type="button" data-to-tab="mine" role="tab">My Time Off</button><button type="button" data-to-tab="mgr" role="tab" id="toTabMgr" hidden>Approvals <b id="toMgrCount"></b></button></div>
      <div id="toBody"><div class="mh-sub">Loading…</div></div>
    </div>`;
    sec.addEventListener('click',onClick);
    sec.addEventListener('change',onChange);
    sec.addEventListener('submit',e=>{ e.preventDefault(); if(e.target.id==='toReqForm') submitReq(); if(e.target.id==='toAskForm') submitAsk(); });
  }
  function setTab(t){ tab=t; document.querySelectorAll('#'+VIEW+' [data-to-tab]').forEach(b=>b.classList.toggle('on',b.dataset.toTab===t)); draw(); }

  async function load(force){
    if(busy) return; busy=true;
    const body=$('toBody');
    if(!emp||force) body.innerHTML='<div class="mh-sub">Loading…</div>';
    try{
      emp=await call('employee','emp.bootstrap');
      const s=getS('employee'); isPtoMgr=!!(s&&s.isManager);
      if(isPtoMgr){ try{ mgr=await call('manager','mgr.bootstrap'); }catch(e){ mgr=null; } }
      $('toTabMgr').hidden=!isPtoMgr;
      draw();
    }catch(e){
      if(e.message==='setup') body.innerHTML=`<div class="card"><h3>Almost ready</h3><p>Time Off in the Toolkit needs a one-time update on the PTO server (Tim is installing it). Until then, use the PTO app.</p><a class="btn-link" href="${PTO_APP}" target="_blank" rel="noopener">Open the PTO app</a></div>`;
      else if(e.message==='notlinked') body.innerHTML=`<div class="card"><h3>Not linked to PTO yet</h3><p>${esc(notLinked)}</p><a class="btn-link" href="${PTO_APP}" target="_blank" rel="noopener">Open the PTO app</a></div>`;
      else body.innerHTML=`<div class="card"><p>${esc(e.message)}</p><button type="button" class="ghost" id="toRetry">Try again</button></div>`;
    }finally{ busy=false; }
  }

  function draw(){
    if(!emp) return;
    const pend=mgr?(mgr.requests||[]).filter(r=>r.status==='Pending').length+(mgr.asks||[]).filter(a=>a.status==='Waiting').length:0;
    const c=$('toMgrCount'); if(c) c.textContent=pend?pend:'';
    if(tab==='mgr'&&isPtoMgr) drawMgr(); else drawMine();
  }

  // ------------------------------------------------ employee
  function chip(st){ const k=String(st||'').toLowerCase(); return `<span class="to-chip to-${esc(k)}">${esc(st||'')}</span>`; }
  function drawMine(){
    const b=emp.balance||{}, reqs=(emp.requests||[]).slice(0,40), asks=(emp.asks||[]).slice(0,20), t=todayIso();
    $('toBody').innerHTML=`
      <div class="to-bal">
        <div class="to-bal-big"><b>${num(b.remaining)}</b><span>PTO days left</span></div>
        <div><b>${num(b.allocated)}</b><span>for the year</span></div><div><b>${num(b.used)}</b><span>used</span></div>
      </div>
      <div class="to-grid">
        <form class="card" id="toReqForm">
          <h3>Request PTO</h3>
          <div class="to-seg" role="radiogroup"><label><input type="radio" name="toType" value="Full Day PTO" checked> Full day(s)</label><label><input type="radio" name="toType" value="Half Day PTO"> Half day</label></div>
          <div class="to-2"><label>First day<input type="date" id="toStart" min="${t}" required></label><label id="toEndWrap">Last day<input type="date" id="toEnd" min="${t}"></label></div>
          <label>Note for your manager (optional)<input id="toNotes" maxlength="500" placeholder="e.g. family trip"></label>
          <div id="toDup" class="to-warn" hidden></div>
          <button type="submit" id="toReqGo">Send PTO request</button>
          <div class="mh-sub">Comes out of your PTO balance once a manager approves it. Weekends and company holidays don't count.</div>
        </form>
        <form class="card" id="toAskForm">
          <h3>Ask for time off <span class="mh-sub">(not PTO)</span></h3>
          <div class="mh-sub" style="margin-bottom:8px">Leave early, come in late, or a day you need off without using PTO. Your manager decides; an ask is not approval.</div>
          <div class="to-2"><label>Date<input type="date" id="toAskStart" min="${t}" required></label><label>Through (optional)<input type="date" id="toAskEnd" min="${t}"></label></div>
          <label>What you need<select id="toAskTiming"><option value="allday">All day</option><option value="leave">Leave early</option><option value="arrive">Come in late</option><option value="custom">Part of the day</option></select></label>
          <div class="to-2" id="toAskTimes" hidden><label id="toAskT1L">Time<input type="time" id="toAskT1"></label><label id="toAskT2L" hidden>Until<input type="time" id="toAskT2"></label></div>
          <label>Why<input id="toAskWhy" maxlength="500" required placeholder="e.g. kid's ballgame"></label>
          <button type="submit" id="toAskGo">Send ask</button>
        </form>
      </div>
      <h3 class="mh-h">My requests</h3>
      <div class="to-list">${reqs.length?reqs.map(r=>{
        const future=mdy2iso(r.endDate||r.startDate)>=t, canW=(r.status==='Pending'||r.status==='Approved')&&future;
        return `<div class="to-row"><div><b>${esc(r.absenceType)}</b> ${chip(r.status)}<div class="mh-sub">${range(r.startDate,r.endDate)} · ${num(r.daysCount)} day${num(r.daysCount)===1?'':'s'}${r.approvedBy&&r.status==='Approved'?' · approved by '+esc(r.approvedBy):''}${r.denialReason?' · '+txt(r.denialReason):''}</div>${r.notes?`<div class="mh-sub">${txt(r.notes)}</div>`:''}</div>
          ${canW?`<button type="button" class="ghost" data-to-cancel="${esc(r.requestId)}">Withdraw</button>`:''}</div>`; }).join(''):'<div class="mh-sub">No requests yet.</div>'}</div>
      ${asks.length?`<h3 class="mh-h">My asks</h3><div class="to-list">${asks.map(a=>`<div class="to-row"><div><b>${esc(a.timingLabel)}</b> ${chip(a.status)}<div class="mh-sub">${range(a.startDate,a.endDate)} · ${txt(a.reason)}${a.managerNote?' · '+esc(a.handledBy)+': '+txt(a.managerNote):''}${a.recordedAs?' · recorded as '+esc(a.recordedAs):''}</div></div>
        ${a.status==='Waiting'?`<button type="button" class="ghost" data-to-askw="${esc(a.askId)}">Withdraw</button>`:''}</div>`).join('')}</div>`:''}
      <p class="mh-sub" style="margin-top:14px">Everything here is the PTO tracker itself — you'll get the same emails as the PTO app. <a href="${PTO_APP}" target="_blank" rel="noopener">Open the PTO app</a></p>`;
  }
  function onChange(e){
    if(e.target.name==='toType'){ const half=e.target.value==='Half Day PTO'; $('toEndWrap').hidden=half; dupCheck(); }
    if(e.target.id==='toStart'||e.target.id==='toEnd'){ if(e.target.id==='toStart'&&$('toEnd')&&(!$('toEnd').value||$('toEnd').value<$('toStart').value)) $('toEnd').value=$('toStart').value; dupCheck(); }
    if(e.target.id==='toAskTiming'){ const v=e.target.value; $('toAskTimes').hidden=v==='allday'; $('toAskT2L').hidden=v!=='custom';
      $('toAskT1L').firstChild.textContent=v==='leave'?'Leave at':v==='arrive'?'Come in at':'From'; }
  }
  async function dupCheck(){
    const s=$('toStart')&&$('toStart').value; if(!s) return;
    const half=document.querySelector('input[name=toType]:checked').value==='Half Day PTO', e=half?s:($('toEnd').value||s);
    try{ const d=await call('employee','emp.checkDup',{startDate:s,endDate:e}); const box=$('toDup'); if(!box) return;
      box.hidden=!(d&&d.length); if(d&&d.length) box.innerHTML='You already have '+d.map(x=>`<b>${esc(x.absenceType)}</b> (${esc(x.status)}) ${range(x.startDate,x.endDate)}`).join(', ')+' on those dates.'; }catch(err){}
  }
  async function submitReq(){
    const type=document.querySelector('input[name=toType]:checked').value, s=$('toStart').value, half=type==='Half Day PTO', e=half?s:($('toEnd').value||s);
    if(!s){ toast('Pick the first day.'); return; }
    if(e<s){ toast('The last day is before the first day.'); return; }
    if(!confirm(`Send a ${type} request for ${range(s,e)}?`)) return;
    const b=$('toReqGo'); b.disabled=true; b.textContent='Sending…';
    try{ const r=await call('employee','emp.submit',{absenceType:type,startDate:s,endDate:e,notes:$('toNotes').value.trim()});
      toast(r&&r.message?r.message:'Request sent'); await load(false); }
    catch(err){ toast(err.message); }
    finally{ const bb=$('toReqGo'); if(bb){ bb.disabled=false; bb.textContent='Send PTO request'; } }
  }
  async function submitAsk(){
    const timing=$('toAskTiming').value, s=$('toAskStart').value, e=$('toAskEnd').value||s;
    const body={startDate:s,endDate:e<s?s:e,timing,startTime:$('toAskT1').value,endTime:$('toAskT2').value,reason:$('toAskWhy').value.trim()};
    if(!s||!body.reason){ toast('Pick a date and say why.'); return; }
    const b=$('toAskGo'); b.disabled=true; b.textContent='Sending…';
    try{ await call('employee','emp.ask',body); toast('Ask sent to your manager — not approved yet'); await load(false); }
    catch(err){ toast(err.message); }
    finally{ const bb=$('toAskGo'); if(bb){ bb.disabled=false; bb.textContent='Send ask'; } }
  }

  // ------------------------------------------------ managers
  function drawMgr(){
    if(!mgr){ $('toBody').innerHTML='<div class="card"><p>Could not load approvals.</p><button type="button" class="ghost" id="toRetry">Try again</button></div>'; return; }
    const pend=(mgr.requests||[]).filter(r=>r.status==='Pending').sort((a,b)=>mdy2iso(a.startDate).localeCompare(mdy2iso(b.startDate)));
    const asks=(mgr.asks||[]).filter(a=>a.status==='Waiting');
    const bal={}; (mgr.team||[]).forEach(t=>bal[t.id]=t);
    const types=(mgr.absenceTypes||[]).filter(t=>!t.isPTO).map(t=>t.name);
    $('toBody').innerHTML=`
      <h3 class="mh-h">PTO requests waiting <span class="mh-sub">(${pend.length})</span></h3>
      <div class="to-list">${pend.length?pend.map(r=>{ const t=bal[r.employeeId];
        return `<div class="to-row to-pend"><div><b>${esc(r.employeeName)}</b> · ${esc(r.absenceType)} · <b>${num(r.daysCount)}</b> day${num(r.daysCount)===1?'':'s'}
          <div class="mh-sub">${range(r.startDate,r.endDate)}${t?` · balance ${num(t.remaining)} → ${num(t.remaining-num(r.daysCount))} if approved`:''} · sent ${esc(r.submittedDate)}</div>${r.notes?`<div class="mh-sub">${txt(r.notes)}</div>`:''}</div>
          <div class="to-act"><button type="button" data-to-approve="${esc(r.requestId)}" data-name="${esc(r.employeeName)}">Approve</button><button type="button" class="ghost" data-to-deny="${esc(r.requestId)}" data-name="${esc(r.employeeName)}">Deny</button></div></div>`; }).join(''):'<div class="mh-sub">Nothing waiting. 👍</div>'}</div>
      <h3 class="mh-h">Time off asks waiting <span class="mh-sub">(${asks.length})</span></h3>
      <div class="to-list">${asks.length?asks.map(a=>`<div class="to-row to-pend"><div><b>${esc(a.employeeName)}</b> · ${esc(a.timingLabel)}
          <div class="mh-sub">${range(a.startDate,a.endDate)} · ${txt(a.reason)}</div>
          <div class="to-askrec" hidden data-rec-box="${esc(a.askId)}"><label>Record as<select data-rec-type>${types.map(t=>`<option>${esc(t)}</option>`).join('')}</select></label>
            <label>Note to employee (optional)<input data-rec-note maxlength="300"></label>
            <button type="button" data-to-askrecgo="${esc(a.askId)}" data-start="${esc(a.startDate)}" data-end="${esc(a.endDate)}" data-t1="${esc(a.startTime)}" data-t2="${esc(a.endTime)}">Record it</button></div></div>
        <div class="to-act"><button type="button" data-to-askrec="${esc(a.askId)}">Yes — record</button><button type="button" class="ghost" data-to-askdecl="${esc(a.askId)}" data-name="${esc(a.employeeName)}">Decline</button></div></div>`).join(''):'<div class="mh-sub">No asks waiting.</div>'}</div>
      <p class="mh-sub" style="margin-top:14px">Approving sends the same emails and PDF as the PTO Manager app and takes the days off their balance. For recording absences, reports and team analytics, use the <a href="${PTO_MGR_APP}" target="_blank" rel="noopener">PTO Manager app</a>${CFG.calendarView?'; for the month view, the <a href="#" data-to-cal>Absence Calendar</a>':''}.</p>`;
  }
  async function act(btn,fn,okMsg){
    btn.disabled=true; const t=btn.textContent; btn.textContent='…';
    try{ await fn(); toast(okMsg); mgr=await call('manager','mgr.bootstrap'); emp=await call('employee','emp.bootstrap'); draw(); }
    catch(e){ toast(e.message); btn.disabled=false; btn.textContent=t; }
  }

  function onClick(e){
    const T=e.target;
    const tb=T.closest('[data-to-tab]'); if(tb){ setTab(tb.dataset.toTab); return; }
    if(T.id==='toRefresh'||T.id==='toRetry'){ emp=null; mgr=null; load(true); return; }
    if(T.closest('[data-to-cal]')){ e.preventDefault(); if(CFG.calendarView) LWHUI.show(CFG.calendarView); return; }
    const c=T.closest('[data-to-cancel]'); if(c){ const why=prompt('Withdraw this request? Give a short reason (your manager sees it):',''); if(why===null) return;
      if(!why.trim()){ toast('A reason is required.'); return; }
      act(c,()=>call('employee','emp.cancel',{requestId:c.dataset.toCancel,reason:why.trim()}),'Request withdrawn'); return; }
    const aw=T.closest('[data-to-askw]'); if(aw){ if(!confirm('Withdraw this ask?')) return; act(aw,()=>call('employee','emp.askWithdraw',{askId:aw.dataset.toAskw}),'Ask withdrawn'); return; }
    const ap=T.closest('[data-to-approve]'); if(ap){ if(!confirm('Approve '+ap.dataset.name+"'s request?")) return; act(ap,()=>call('manager','mgr.approve',{requestId:ap.dataset.toApprove}),'Approved — emails and PDF sent'); return; }
    const dn=T.closest('[data-to-deny]'); if(dn){ const why=prompt('Deny '+dn.dataset.name+"'s request. Reason (they'll see it):",''); if(why===null) return;
      if(!why.trim()){ toast('A reason is required.'); return; } act(dn,()=>call('manager','mgr.deny',{requestId:dn.dataset.toDeny,reason:why.trim()}),'Denied'); return; }
    const ar=T.closest('[data-to-askrec]'); if(ar){ const box=document.querySelector(`[data-rec-box="${CSS.escape(ar.dataset.toAskrec)}"]`); if(box) box.hidden=!box.hidden; return; }
    const ag=T.closest('[data-to-askrecgo]'); if(ag){ const box=ag.closest('.to-askrec');
      act(ag,()=>call('manager','mgr.askRecord',{askId:ag.dataset.toAskrecgo,absenceType:box.querySelector('[data-rec-type]').value,startDate:ag.dataset.start,endDate:ag.dataset.end,
        startTime:ag.dataset.t1,endTime:ag.dataset.t2,note:box.querySelector('[data-rec-note]').value.trim()}),'Recorded — employee emailed'); return; }
    const ad=T.closest('[data-to-askdecl]'); if(ad){ const note=prompt('Decline '+ad.dataset.name+"'s ask. Short note for them:",''); if(note===null) return;
      if(!note.trim()){ toast('A note is required.'); return; } act(ad,()=>call('manager','mgr.askDecline',{askId:ad.dataset.toAskdecl,note:note.trim()}),'Declined — employee emailed'); return; }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$(VIEW); if(!sec) return;
    const onShow=()=>{
      if(!appTok()){ sec.innerHTML='<div class="card"><h2>Time Off</h2><p>Sign in to use Time Off.</p></div>'; delete sec.dataset.built; return; }
      const want=(new URLSearchParams(location.search).get('totab'))||sessionStorage.getItem('lwh_toTab');
      sessionStorage.removeItem('lwh_toTab');
      build(); setTab(want==='mgr'?'mgr':tab); load(false);
    };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
  });
  // Manager → "PTO Approvals" opens straight to the Approvals tab
  window.LWHTimeOff={ openApprovals(){ try{ sessionStorage.setItem('lwh_toTab','mgr'); }catch(e){} LWHUI.show(VIEW); } };
})();
