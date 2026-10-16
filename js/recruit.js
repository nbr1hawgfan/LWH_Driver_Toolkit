// Recruiter — each driver gets a personal QR code / link to the driver
// application. Scans are counted automatically (people reached); points come
// when the office confirms a referred applicant applied (+10) or was hired
// (+50) on the Dispatch Board's Recruiting tab (manager passcode required).
(function(){
  const API='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/';
  const RECRUIT_URL=API+'recruit', GO_URL=API+'recruit-go';
  const CODE_KEY='recruitCode', NAME_KEY='recruitName', PASS_KEY='recruitPass';
  const el=id=>document.getElementById(id);
  const S=s=>LWHUI.safe(s);
  const BADGES=[[250,'🏆 Hall of Fame'],[100,'🥇 Top Recruiter'],[50,'🥈 Talent Scout'],[10,'🥉 Recruiter']];
  const badge=p=>(BADGES.find(([n])=>p>=n)||[0,''])[1];
  const post=async body=>{
    const res=await fetch(RECRUIT_URL,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const b=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(b.error||('HTTP '+res.status));
    return b;
  };
  const myName=()=>(LWHStorage.get('userName','')||'').trim();
  const myCode=()=>LWHStorage.get(CODE_KEY,'');
  const link=(code,how)=>`${GO_URL}?r=${encodeURIComponent(code)}${how==='link'?'&m=link':''}`;
  let stats=null, period='month';

  // ---------- Driver code ----------
  async function ensureCode(){
    const name=myName();
    if(!name) return '';
    let code=myCode();
    // Register on first use, and again if the driver's name changed.
    if(!code||LWHStorage.get(NAME_KEY,'')!==name){
      const b=await post({action:'register',driver_name:name,code});
      code=b.code; LWHStorage.set(CODE_KEY,code); LWHStorage.set(NAME_KEY,name);
    }
    return code;
  }

  // ---------- Driver screen ----------
  async function openDriver(){
    const name=myName();
    el('rcNeedName').hidden=!!name; el('rcMain').hidden=!name;
    if(!name){ el('rcNameInput').value=''; return; }
    el('rcCodeLine').textContent='Setting up your code…';
    let code='';
    try{ code=await ensureCode(); el('rcCodeLine').innerHTML=`${S(name)} · code <b>${S(code)}</b>`; }
    catch(e){ code=myCode(); el('rcCodeLine').textContent=(code?'Showing your saved code — ':'')+'could not reach the office ('+e.message+'). Check your signal and reopen.'; }
    drawQr(el('rcQr'),code,220);
    loadStats();
  }
  function drawQr(box,code,size){
    if(!code){ box.innerHTML=''; return; }
    try{ LWHQR.make(box,link(code,'qr'),size); box.title=link(code,'qr'); }
    catch(e){ box.innerHTML=`<p class="hint" style="max-width:220px">QR code needs a signal the first time. Use Share Link for now.</p>`; console.warn(e); }
  }
  async function loadStats(){
    try{ stats=await post({action:'stats',code:myCode()}); }
    catch(e){ el('rcMe').innerHTML=`<p class="hint">Couldn't load points (${S(e.message)}).</p>`; return; }
    renderMe(); renderBoard(el('rcBoard'),false);
    if(el('yardBoard')&&el('yardBoard').classList.contains('active')&&window.LWHRecruit.boardOpen) renderDispatch();
  }
  function renderMe(){
    const m=stats&&stats.me||{scans:0,applied:0,hired:0,points:0,pointsMonth:0};
    const ranked=stats?stats.board.filter(r=>r.points>0).sort((a,b)=>b.points-a.points):[];
    const rank=ranked.findIndex(r=>myCode()&&r.codes.includes(myCode()))+1;
    el('rcMe').innerHTML=`<div class="stats rc-stats">
        <div><b>${m.scans}</b><span>People reached</span></div>
        <div><b>${m.applied}</b><span>Applied</span></div>
        <div><b>${m.hired}</b><span>Hired</span></div>
        <div><b style="color:var(--brand)">${m.points}</b><span>Points</span></div>
      </div>
      ${badge(m.points)?`<p class="rc-badge">${badge(m.points)}</p>`:''}
      <p class="hint" style="margin:6px 0 0">${m.points?`${m.pointsMonth} point${m.pointsMonth===1?'':'s'} this month${rank>0?` · #${rank} on the leaderboard`:''}.`:'Share your code — when someone you sent applies, the office credits you.'}</p>`;
  }
  function renderBoard(box,dispatch){
    if(!stats) return;
    const key=period==='month'?'pointsMonth':'points';
    const rows=stats.board.filter(r=>dispatch||r[key]>0||r.scans>0).slice().sort((a,b)=>b[key]-a[key]||b.scans-a.scans).slice(0,dispatch?100:10);
    const mine=r=>myCode()&&r.codes.includes(myCode());
    box.innerHTML=rows.length?`<ol class="rc-board">${rows.map((r,i)=>`<li class="${mine(r)?'me':''}">
        <span class="rc-rank">${r[key]>0?i+1:'–'}</span>
        <span class="rc-name">${S(r.name)}${badge(r.points)?` <small>${badge(r.points)}</small>`:''}</span>
        <span class="rc-pts"><b>${r[key]}</b> pts<small>${r.applied} applied · ${r.hired} hired · ${r.scans} reached</small></span>
      </li>`).join('')}</ol>`:'<p class="hint">No points yet — be the first.</p>';
  }

  // ---------- Share ----------
  const shareText=code=>`Logistics Warehouse is hiring drivers! Apply here: ${link(code,'link')}`;
  async function share(){
    const code=myCode(); if(!code) return;
    if(navigator.share){ try{ await navigator.share({title:'Drive for Logistics Warehouse',text:shareText(code)}); }catch(e){} }
    else copy();
  }
  async function copy(){
    try{ await navigator.clipboard.writeText(shareText(myCode())); LWHUI.toast('Copied — paste it into a text or post'); }
    catch(e){ LWHUI.toast('Could not copy on this phone'); }
  }
  function fullscreen(on){
    const ov=el('rcFull'); ov.hidden=!on;
    if(on){ drawQr(el('rcFullQr'),myCode(),Math.min(320,window.innerWidth-80)); }
  }

  // ---------- Dispatch Board: Recruiting tab ----------
  function renderDispatch(){
    const box=el('ybResults'); if(!stats){ box.innerHTML='<p class="hint">Loading…</p>'; return; }
    const opts=stats.board.filter(r=>r.codes.length).map(r=>`<option value="${S(r.codes[0])}">${S(r.name)}</option>`).join('');
    box.innerHTML=`
      <div class="card rc-credit">
        <h3 style="margin-top:0">Credit a referral</h3>
        <p class="hint">When an applicant was sent by one of our drivers (the application says "Current Employee", or they name who sent them), credit that driver here.</p>
        <div class="grid-2">
          <label>Driver<select id="rcAwDriver">${opts||'<option value="">No drivers have opened Recruiter yet</option>'}</select></label>
          <label>Applicant name<input id="rcAwApplicant" autocomplete="off" placeholder="e.g. John Smith" /></label>
        </div>
        <div class="segmented" id="rcAwKind"><button type="button" class="seg active" data-kind="Applied">Applied · +${stats.points.Applied}</button><button type="button" class="seg" data-kind="Hired">Hired · +${stats.points.Hired}</button></div>
        <div class="grid-2">
          <label>Note (optional)<input id="rcAwNote" autocomplete="off" placeholder="e.g. OTR, starts Monday" /></label>
          <label>Manager passcode<input id="rcAwPass" type="password" autocomplete="off" value="${S(sessionStorage.getItem(PASS_KEY)||'')}" /></label>
        </div>
        <div class="actions"><button type="button" id="rcAwGo">Credit points</button></div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="yb-driver-head"><h3 style="margin:0">Leaderboard</h3>
          <div class="segmented rc-period" style="margin:0"><button type="button" class="seg${period==='month'?' active':''}" data-period="month">This month</button><button type="button" class="seg${period==='all'?' active':''}" data-period="all">All time</button></div></div>
        <div id="rcDispBoard"></div>
      </div>
      <div class="card" style="margin-top:12px"><h3 style="margin-top:0">Recent credits</h3>
        ${stats.recent.length?`<ol class="yb-tl">${stats.recent.map(a=>`<li class="yb-tl-item"><span class="yb-tl-time">${new Date(a.created_at).toLocaleDateString([], {month:'short',day:'numeric'})}</span>
          <div><span class="yb-chip ${a.kind==='Hired'?'s-delivered':'s-arrived'}">${S(a.kind)} +${a.points}</span> <b>${S(a.driver_name)}</b>${a.applicant?' · '+S(a.applicant):''}
          <div class="hint">${a.note?S(a.note)+' · ':''}${a.awarded_by?'by '+S(a.awarded_by)+' · ':''}<button type="button" class="yb-tnum" data-unaward="${a.id}">Undo</button></div></div></li>`).join('')}</ol>`:'<p class="hint">No credits yet.</p>'}
      </div>`;
    renderBoard(el('rcDispBoard'),true);
  }
  async function award(){
    const code=el('rcAwDriver').value, kind=document.querySelector('#rcAwKind .seg.active').dataset.kind;
    const pass=el('rcAwPass').value.trim();
    if(!code){ LWHUI.toast('Pick a driver'); return; }
    if(!el('rcAwApplicant').value.trim()){ LWHUI.toast('Enter the applicant\'s name'); return; }
    if(!pass){ LWHUI.toast('Enter the manager passcode'); return; }
    const btn=el('rcAwGo'); btn.disabled=true; btn.textContent='Saving…';
    try{
      await post({action:'award',passcode:pass,code,kind,applicant:el('rcAwApplicant').value,note:el('rcAwNote').value,by:myName()});
      sessionStorage.setItem(PASS_KEY,pass);
      LWHUI.toast(`Credited ${kind} to ${el('rcAwDriver').selectedOptions[0].textContent}`);
      await loadStats(); renderDispatch();
    }catch(e){ LWHUI.toast(e.message); btn.disabled=false; btn.textContent='Credit points'; }
  }
  async function unaward(id){
    const pass=(el('rcAwPass')&&el('rcAwPass').value.trim())||sessionStorage.getItem(PASS_KEY)||'';
    if(!pass){ LWHUI.toast('Enter the manager passcode above first'); return; }
    if(!confirm('Remove this credit?')) return;
    try{ await post({action:'unaward',passcode:pass,id:+id}); await loadStats(); renderDispatch(); LWHUI.toast('Credit removed'); }
    catch(e){ LWHUI.toast(e.message); }
  }

  function init(){
    if(!el('recruiter')) return;
    el('rcShare').onclick=share; el('rcCopy').onclick=copy;
    el('rcFullBtn').onclick=()=>fullscreen(true); el('rcFull').onclick=()=>fullscreen(false);
    el('rcNameSave').onclick=()=>{ const n=el('rcNameInput').value.trim(); if(!n){ LWHUI.toast('Enter your name'); return; } LWHStorage.set('userName',n); openDriver(); };
    el('rcPeriod').addEventListener('click',e=>{ const b=e.target.closest('[data-period]'); if(!b) return; period=b.dataset.period;
      el('rcPeriod').querySelectorAll('.seg').forEach(x=>x.classList.toggle('active',x===b)); renderBoard(el('rcBoard'),false); });
    new MutationObserver(()=>{ if(el('recruiter').classList.contains('active')) openDriver(); })
      .observe(el('recruiter'),{attributes:true,attributeFilter:['class']});
    // Dispatch Board Recruiting tab (delegated; the tab's markup is redrawn often)
    el('yardBoard').addEventListener('click',e=>{
      if(!window.LWHRecruit.boardOpen) return;
      const k=e.target.closest('#rcAwKind [data-kind]'); if(k){ document.querySelectorAll('#rcAwKind .seg').forEach(x=>x.classList.toggle('active',x===k)); return; }
      const p=e.target.closest('.rc-period [data-period]'); if(p){ period=p.dataset.period; renderDispatch(); return; }
      if(e.target.closest('#rcAwGo')){ award(); return; }
      const u=e.target.closest('[data-unaward]'); if(u){ unaward(u.dataset.unaward); }
    });
  }
  window.LWHRecruit={
    boardOpen:false,
    async openBoard(){ this.boardOpen=true; el('ybResults').innerHTML='<p class="hint">Loading recruiting…</p>'; try{ stats=await post({action:'stats',code:myCode()}); }catch(e){ el('ybResults').innerHTML=`<div class="card"><p class="hint" style="margin:0">Couldn't load recruiting (${S(e.message)}).</p></div>`; return; } renderDispatch(); },
    closeBoard(){ this.boardOpen=false; }
  };
  window.addEventListener('load',init);
})();
