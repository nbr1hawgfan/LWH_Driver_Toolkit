// Front door (v1.51.0) — one sign-in for the whole Driver Toolkit.
// Scan your time clock card, or pick your name and type your PTO / time off PIN.
// That one sign-in covers Messages, Proof of Delivery, Site Notes and the Time Clock, and stays on this
// phone or tablet until the driver signs out (Sign out at the top, or "Not you?" on the Time Clock).
// Shared trucks/tablets: with "Shared truck or tablet" on (Settings), clocking out signs the driver out,
// so the front door is ready for the next card.
// A card scan opens the Time Clock for spotters (anyone who used the clock in the last 60 days); Home for everyone else.
// No signal + a card that has worked on this device before: opens the Time Clock to punch (saved and
// sent later), the same as before; the front door comes back after the punch.
(function(){
  const $=id=>document.getElementById(id);
  const safe=s=>LWHUI.safe(s);
  let bypass=false, busy=false;

  function signedIn(){ return !!(window.LWHMsgAuth&&LWHMsgAuth.signedIn()); }
  function show(){
    const g=$('dtGate'); if(!g) return;
    g.hidden=false; document.body.classList.add('gated');
    fillNames(); msg('');
  }
  function hide(){ const g=$('dtGate'); if(!g) return; g.hidden=true; document.body.classList.remove('gated'); }
  // Shared truck/tablet (box on the Messages screen): also signs the driver out after 4 hours of no use,
  // so the next driver never lands in someone else's sign-in.
  const IDLE_MS=4*3600e3;
  let idleBusy=false;
  async function idleCheck(){
    if(idleBusy||!signedIn()||LWHStorage.get('msgShared',false)!==true) return false;
    const last=+LWHStorage.get('lastActive',0)||0;
    if(!last||Date.now()-last<IDLE_MS) return false;
    idleBusy=true;
    try{ await LWHMsgAuth.signOut({confirmed:true,quiet:true}); }catch(e){}
    idleBusy=false; show(); msg('Signed out after 4 hours with no use (shared truck or tablet). Scan your card or sign in.');
    return true;
  }
  let lastMark=0;
  function mark(){ const n=Date.now(); if(n-lastMark>60e3&&signedIn()){ lastMark=n; LWHStorage.set('lastActive',n); } }
  function check(){ if(signedIn()||bypass){ hide(); return; } show(); }
  function msg(t,kind){ const m=$('gErr'); if(!m) return; m.textContent=t||''; m.className='g-msg'+(kind?' '+kind:''); m.hidden=!t; }

  async function fillNames(fresh){
    const sel=$('gName'); if(!sel||!window.LWHMsgAuth) return;
    const draw=list=>{
      const keep=sel.value||LWHStorage.get('msgLastId','')||LWHStorage.get('tcDriver','');
      const drv=(list||[]).filter(d=>d.role!=='Manager'), mgr=(list||[]).filter(d=>d.role==='Manager');
      const opt=d=>`<option value="${safe(d.driver_id)}">${safe(d.name)}</option>`;
      sel.innerHTML='<option value="">Pick your name…</option>'+drv.map(opt).join('')+(mgr.length?'<optgroup label="Dispatch / managers">'+mgr.map(opt).join('')+'</optgroup>':'');
      if(keep&&(list||[]).some(d=>d.driver_id===keep)) sel.value=keep;
    };
    draw(LWHMsgAuth.roster());
    if(fresh!==false) draw(await LWHMsgAuth.loadRoster());
  }

  // ---- card
  function scan(){
    if(!window.LWHScanner){ msg('The camera did not load. Use your name and PIN below.','bad'); return; }
    LWHScanner.start(code=>cardIn(code),{key:'timeclock',title:'Scan your time clock card'});
  }
  async function cardIn(code){
    if(busy) return; busy=true; msg('Checking your card…');
    try{
      const r=await LWHTimeClock.badgeLogin(code);
      if(!r.ok){ msg(r.error,'bad'); return; }
      if(r.offline){
        // no signal: Time Clock only, for this one punch
        bypass=true; hide(); LWHUI.show('timeclock');
        setTimeout(async()=>{ await LWHTimeClock.badgeIn(r.code); bypass=false; },300);
        return;
      }
      // Spotters (people who use the time clock) go straight to it; everyone else lands on Home.
      hide(); LWHUI.show(r.uses_clock?'timeclock':'home');
      LWHUI.toast(`Hi ${(r.name||'').split(' ')[0]} — you're signed in`);
    } finally { busy=false; }
  }

  // ---- name + PIN
  async function pinIn(){
    if(busy) return;
    const id=$('gName').value, pin=($('gPin').value||'').replace(/\D/g,'');
    if(!id){ msg('Pick your name from the list.','bad'); return; }
    if(pin.length<4){ msg('Type your PIN — the same one you use for time off (4 to 6 numbers).','bad'); return; }
    busy=true; $('gGo').disabled=true; $('gGo').textContent='Signing in…'; msg('');
    try{
      const r=await LWHMsgAuth.signIn(id,pin);
      if(!r.ok){
        $('gPin').value='';
        msg(r.needs_setup?'First time? Tap "No PTO PIN? Use a setup code" below.':(r.error||'That PIN did not work.'),'bad');
        if(r.needs_setup) $('gSetupBox').hidden=false;
        return;
      }
      $('gPin').value=''; hide(); LWHUI.show('home');
    }catch(e){ msg('No signal — try again in a minute, or scan your card.','bad'); }
    finally{ busy=false; $('gGo').disabled=false; $('gGo').textContent='Sign in'; }
  }
  async function setupIn(){
    if(busy) return;
    const id=$('gName').value, code=($('gCode').value||'').trim(), pin=($('gNew').value||'').replace(/\D/g,'');
    if(!id){ msg('Pick your name from the list first.','bad'); return; }
    if(!code){ msg('Type the setup code.','bad'); return; }
    if(!/^\d{4,6}$/.test(pin)){ msg('Make a PIN of 4 to 6 numbers.','bad'); return; }
    busy=true; $('gSetupGo').disabled=true;
    try{
      const r=await LWHMsgAuth.setup(id,code,pin);
      if(!r.ok){ msg(r.error||'That did not work.','bad'); return; }
      $('gCode').value=''; $('gNew').value=''; $('gSetupBox').hidden=true; hide(); LWHUI.show('home');
      LWHUI.toast('PIN saved. You are signed in.');
    }catch(e){ msg('No signal — try again in a minute.','bad'); }
    finally{ busy=false; $('gSetupGo').disabled=false; }
  }

  window.addEventListener('load',()=>{
    if(!$('dtGate')) return;
    $('gScan').onclick=scan;
    $('gGo').onclick=pinIn;
    $('gPin').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); pinIn(); } });
    $('gName').onchange=()=>{ if($('gName').value) setTimeout(()=>$('gPin').focus(),50); };
    $('gSetupLink').onclick=()=>{ $('gSetupBox').hidden=!$('gSetupBox').hidden; };
    $('gSetupGo').onclick=setupIn;
    idleCheck().then(gone=>{ if(!gone) check(); });
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) idleCheck().then(gone=>{ if(!gone) check(); }); });
    ['pointerdown','keydown'].forEach(ev=>document.addEventListener(ev,mark,{passive:true,capture:true}));
    setInterval(()=>{ if(!document.hidden) idleCheck(); },5*60e3);
    textSize(LWHStorage.get('textSize','normal'));
    document.querySelectorAll('[data-textsize]').forEach(b=>b.onclick=()=>{ textSize(b.dataset.textsize); LWHUI.toast('Text size saved on this phone'); });
  });
  // Bigger text (Settings): scales the whole app on this phone.
  function textSize(v){
    const z={normal:1,large:1.15,xl:1.3}[v]||1;
    LWHStorage.set('textSize',z===1?'normal':v);
    document.body.style.zoom=z===1?'':String(z); document.body.classList.toggle('ts-big',z>1);
    document.querySelectorAll('[data-textsize]').forEach(b=>b.classList.toggle('on',b.dataset.textsize===(z===1?'normal':v)));
  }
  window.LWHGate={ check, show, hide, cardIn, textSize };
})();
