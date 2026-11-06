// Messages from dispatch (v1.39.0)
// - Each driver signs in once with their Driver ID + 6-digit PIN (first time: setup code from dispatch).
// - Inbox is checked every 30 seconds while the app is open, and whenever it comes back on screen.
// - New messages can be read out loud automatically; on a phone or tablet paired with the truck's
//   Bluetooth (or a headset) the voice plays through that, like any other media audio.
// - While the device is moving (GPS over ~5 mph) message text is hidden; Read Aloud still works.
// Backend: Supabase RPCs drv_* and msg_* (supabase/migrations/20261106_driver_messages.sql).
(function(){
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const POLL_MS=30000;
  const MOVING_ON=2.2, MOVING_OFF=1.0, STOP_HOLD_MS=20000; // m/s (~5 mph on, ~2 mph off), 20 s still to unlock
  const $=id=>document.getElementById(id);
  const safe=s=>LWHUI.safe(s);
  const store={
    get token(){ return LWHStorage.get('msgToken',''); },
    set token(v){ v?LWHStorage.set('msgToken',v):LWHStorage.remove('msgToken'); },
    get me(){ return LWHStorage.get('msgMe',null); },
    set me(v){ v?LWHStorage.set('msgMe',v):LWHStorage.remove('msgMe'); },
    get seen(){ return LWHStorage.get('msgSeen',[]); },
    set seen(v){ LWHStorage.set('msgSeen',v.slice(-200)); },
    get autoRead(){ return LWHStorage.get('msgAutoRead',true)!==false; },
    set autoRead(v){ LWHStorage.set('msgAutoRead',!!v); },
    get chime(){ return LWHStorage.get('msgChime',true)!==false; },
    set chime(v){ LWHStorage.set('msgChime',!!v); }
  };
  let messages=[], pollTimer=null, loading=false, moving=false, stillSince=0, geoWatch=null, lastFix=null, firstLoad=true;

  async function rpc(name,args){
    const r=await fetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  // ---------------------------------------------------------------- speech
  const speechOk='speechSynthesis' in window;
  let voice=null;
  function pickVoice(){
    if(!speechOk) return;
    const vs=speechSynthesis.getVoices()||[];
    voice=vs.find(v=>/en[-_]US/i.test(v.lang)&&/google|samsung/i.test(v.name))||vs.find(v=>/en[-_]US/i.test(v.lang))||vs.find(v=>/^en/i.test(v.lang))||null;
  }
  if(speechOk){ pickVoice(); speechSynthesis.onvoiceschanged=pickVoice; }
  function canSpeakNow(){ return speechOk && (!navigator.userActivation || navigator.userActivation.hasBeenActive); }
  function chime(){
    if(!store.chime) return Promise.resolve();
    try{
      const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return Promise.resolve();
      const ctx=new AC(), t=ctx.currentTime;
      [[880,0],[1175,0.18]].forEach(([f,d])=>{
        const o=ctx.createOscillator(), g=ctx.createGain(); o.type='sine'; o.frequency.value=f;
        g.gain.setValueAtTime(0.0001,t+d); g.gain.exponentialRampToValueAtTime(0.35,t+d+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+d+0.16);
        o.connect(g).connect(ctx.destination); o.start(t+d); o.stop(t+d+0.18);
      });
      return new Promise(res=>setTimeout(()=>{ ctx.close().catch(()=>{}); res(); },450));
    }catch(e){ return Promise.resolve(); }
  }
  function spokenText(m){
    let t=`Message from ${m.sender_name}. ${m.body}`;
    if(m.msg_type==='ack' && !m.acked_at) t+=' . When you are stopped, tap Got it.';
    if(m.msg_type==='reply' && !m.replied_at){
      const o=m.reply_options||[];
      t+=` . Reply options: ${o.length>1?o.slice(0,-1).join(', ')+', or '+o[o.length-1]:o[0]}. Reply when you are stopped.`;
    }
    return t;
  }
  function speak(list){
    if(!speechOk||!list.length) return;
    speechSynthesis.cancel();
    list.forEach(m=>{
      const u=new SpeechSynthesisUtterance(spokenText(m));
      u.lang='en-US'; if(voice) u.voice=voice; u.rate=0.95; u.volume=1;
      speechSynthesis.speak(u);
    });
    list.forEach(m=>{ if(!m.read_at) mark(m,'read',null,true); });
  }
  function stopSpeaking(){ if(speechOk) speechSynthesis.cancel(); }

  // ---------------------------------------------------------------- moving lock
  function setMoving(v){
    if(v===moving) return;
    moving=v; document.body.classList.toggle('msg-moving',moving);
    if($('msgMovingBar')) $('msgMovingBar').hidden=!moving;
    render();
  }
  function onFix(p){
    const now=Date.now();
    let speed=(typeof p.coords.speed==='number'&&!isNaN(p.coords.speed))?p.coords.speed:null;
    if(speed===null && lastFix){
      const dt=(p.timestamp-lastFix.t)/1000;
      if(dt>=2){
        const R=6371000, toR=x=>x*Math.PI/180;
        const dLat=toR(p.coords.latitude-lastFix.lat), dLon=toR(p.coords.longitude-lastFix.lon);
        const a=Math.sin(dLat/2)**2+Math.cos(toR(lastFix.lat))*Math.cos(toR(p.coords.latitude))*Math.sin(dLon/2)**2;
        const d=2*R*Math.asin(Math.sqrt(a));
        if(d>(p.coords.accuracy||20)) speed=d/dt; else speed=0;
      }
    }
    lastFix={t:p.timestamp,lat:p.coords.latitude,lon:p.coords.longitude};
    if(speed===null) return;
    if(speed>=MOVING_ON){ stillSince=0; setMoving(true); }
    else if(speed<=MOVING_OFF){
      if(!stillSince) stillSince=now;
      if(now-stillSince>=STOP_HOLD_MS) setMoving(false);
    }
  }
  function startGeo(){
    if(geoWatch!==null||!('geolocation' in navigator)||!store.token) return;
    try{ geoWatch=navigator.geolocation.watchPosition(onFix,()=>{},{enableHighAccuracy:true,maximumAge:5000,timeout:20000}); }catch(e){}
  }
  function stopGeo(){ if(geoWatch!==null){ try{ navigator.geolocation.clearWatch(geoWatch); }catch(e){} geoWatch=null; } }

  // ---------------------------------------------------------------- data
  async function refresh(opts={}){
    if(!store.token||loading) return;
    if(!navigator.onLine){ setStatus('Offline — messages will update when you have signal.'); return; }
    loading=true;
    try{
      const r=await rpc('msg_inbox',{p_token:store.token});
      if(!r.ok){ if(r.error==='signed_out') return signedOut('Your sign-in ran out. Please sign in again.'); throw new Error(r.error); }
      const before=new Set(store.seen);
      messages=r.messages||[];
      const fresh=messages.filter(m=>!before.has(m.id));
      store.seen=[...before,...fresh.map(m=>m.id)];
      setStatus('Updated '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}));
      render();
      if(!firstLoad && fresh.length){
        if(store.autoRead && canSpeakNow()){ chime().then(()=>speak(fresh.slice().reverse())); }
        else { chime(); LWHUI.toast(fresh.length===1?'New message from dispatch':`${fresh.length} new messages from dispatch`); }
      }else if(firstLoad && opts.speakUnread && store.autoRead && canSpeakNow()){
        const unread=messages.filter(m=>!m.read_at); if(unread.length) chime().then(()=>speak(unread.slice().reverse()));
      }
      firstLoad=false;
    }catch(e){
      setStatus('Could not check messages ('+(e.message||'network')+'). Trying again shortly.');
    }finally{ loading=false; }
  }
  async function mark(m,action,reply,quiet){
    try{
      const r=await rpc('msg_mark',{p_token:store.token,p_message_id:m.id,p_action:action,p_reply:reply||null});
      if(!r.ok){ if(r.error==='signed_out') return signedOut(); if(!quiet) LWHUI.toast(r.error||'Could not save'); return; }
      const now=new Date().toISOString();
      if(action==='read') m.read_at=m.read_at||now;
      if(action==='ack'){ m.acked_at=now; m.read_at=m.read_at||now; }
      if(action==='reply'){ m.reply=reply; m.replied_at=now; m.acked_at=m.acked_at||now; m.read_at=m.read_at||now; }
      render();
      if(!quiet&&action!=='read') LWHUI.toast(action==='reply'?'Reply sent':'Dispatch will see you got it');
    }catch(e){ if(!quiet) LWHUI.toast('No signal — try again in a minute'); }
  }

  // ---------------------------------------------------------------- sign in
  function signedOut(msg){
    store.token=''; store.me=null; messages=[]; stopPoll(); stopGeo(); stopSpeaking();
    render(); if(msg) showLoginErr(msg);
  }
  function showLoginErr(msg){ const e=$('msgLoginErr'); if(e){ e.textContent=msg||''; e.hidden=!msg; } }
  async function afterSignIn(token){
    store.token=token; store.seen=[]; firstLoad=true;
    try{
      const me=await rpc('drv_me',{p_token:token});
      if(me.ok){
        store.me={driver_id:me.driver_id,name:me.name,location:me.location,role:me.role};
        // Use the signed-in name for the greeting and usage tracking.
        LWHStorage.set('userName',me.name);
        if(window.heroGreeting&&window.getGreeting) heroGreeting.textContent=getGreeting();
        if(window.showHeaderUser) showHeaderUser();
      }
    }catch(e){}
    ['msgPin','msgSetupCode','msgNewPin','msgNewPin2'].forEach(id=>{ if($(id)) $(id).value=''; });
    showLoginErr(''); render(); startPoll(); startGeo(); refresh({speakUnread:false});
  }
  async function doLogin(){
    const id=($('msgDriverId').value||'').trim().toUpperCase(), pin=($('msgPin').value||'').trim();
    if(!id||!/^\d{6}$/.test(pin)) return showLoginErr('Enter your Driver ID and your 6-digit PIN.');
    const b=$('msgLoginBtn'); b.disabled=true; b.textContent='Signing in…';
    try{
      const r=await rpc('drv_login',{p_driver_id:id,p_pin:pin});
      if(!r.ok){ showLoginErr(r.error); if(r.needs_setup) setSetupMode(true); return; }
      LWHStorage.set('msgLastId',id); await afterSignIn(r.token);
    }catch(e){ showLoginErr('No signal — try again in a minute.'); }
    finally{ b.disabled=false; b.textContent='Sign In'; }
  }
  async function doSetup(){
    const id=($('msgDriverId').value||'').trim().toUpperCase(), code=($('msgSetupCode').value||'').trim();
    const p1=($('msgNewPin').value||'').trim(), p2=($('msgNewPin2').value||'').trim();
    if(!id||!code) return showLoginErr('Enter your Driver ID and the setup code from dispatch.');
    if(!/^\d{6}$/.test(p1)) return showLoginErr('Your new PIN must be exactly 6 digits.');
    if(p1!==p2) return showLoginErr('The two PINs do not match.');
    const b=$('msgSetupBtn'); b.disabled=true; b.textContent='Saving…';
    try{
      const r=await rpc('drv_create_pin',{p_driver_id:id,p_setup_code:code,p_pin:p1});
      if(!r.ok) return showLoginErr(r.error);
      LWHStorage.set('msgLastId',id); setSetupMode(false); await afterSignIn(r.token);
      LWHUI.toast('PIN saved. You are signed in.');
    }catch(e){ showLoginErr('No signal — try again in a minute.'); }
    finally{ b.disabled=false; b.textContent='Create PIN & Sign In'; }
  }
  function setSetupMode(on){
    $('msgSetupBox').hidden=!on; $('msgPinBox').hidden=on;
    $('msgSetupToggle').textContent=on?'I already have a PIN':'First time sign-in';
    showLoginErr('');
  }
  async function doLogout(){
    if(!confirm('Sign out of messages on this device? The next driver can then sign in.')) return;
    const t=store.token;
    signedOut(); LWHStorage.remove('userName'); if(window.showHeaderUser) showHeaderUser();
    if(window.heroGreeting&&window.getGreeting) heroGreeting.textContent=getGreeting();
    try{ await rpc('drv_logout',{p_token:t}); }catch(e){}
  }

  // ---------------------------------------------------------------- polling
  function startPoll(){ stopPoll(); if(store.token) pollTimer=setInterval(()=>{ if(document.visibilityState==='visible') refresh(); },POLL_MS); }
  function stopPoll(){ if(pollTimer){ clearInterval(pollTimer); pollTimer=null; } }
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&store.token){ refresh(); startGeo(); }
    else if(document.visibilityState==='hidden'){ stopGeo(); }
  });
  window.addEventListener('online',()=>refresh());

  // ---------------------------------------------------------------- render
  function setStatus(t){ if($('msgStatus')) $('msgStatus').textContent=t||''; }
  function ago(iso){
    const d=new Date(iso), s=(Date.now()-d)/1000;
    if(s<60) return 'just now'; if(s<3600) return Math.floor(s/60)+' min ago';
    const today=new Date(); const t=d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    if(d.toDateString()===today.toDateString()) return 'Today '+t;
    const y=new Date(today); y.setDate(y.getDate()-1); if(d.toDateString()===y.toDateString()) return 'Yesterday '+t;
    return d.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'})+' '+t;
  }
  const needsAction=m=>(m.msg_type==='ack'&&!m.acked_at)||(m.msg_type==='reply'&&!m.replied_at);
  function renderHomeCard(){
    const c=$('msgHomeCard'); if(!c) return;
    const title=$('msgHomeTitle'), sub=$('msgHomeSub'), badge=$('msgHomeBadge');
    c.classList.remove('msg-home-alert','msg-home-new');
    if(!store.token){
      title.textContent='Messages from Dispatch'; sub.textContent='Sign in with your Driver ID to get messages here — read out loud over Bluetooth.'; badge.hidden=true; return;
    }
    const unread=messages.filter(m=>!m.read_at).length, act=messages.filter(needsAction).length;
    const n=Math.max(unread,act);
    badge.hidden=!n; badge.textContent=n;
    if(act){ c.classList.add('msg-home-alert'); title.textContent=act===1?'1 message needs your answer':`${act} messages need your answer`; sub.textContent='Tap to open. Answer when you are stopped.'; }
    else if(unread){ c.classList.add('msg-home-new'); title.textContent=unread===1?'1 new message':`${unread} new messages`; sub.textContent='Tap to read, or tap Read Aloud.'; }
    else { title.textContent='Messages'; sub.textContent=messages.length?'No new messages. You are all caught up.':'No messages from dispatch right now.'; }
  }
  function msgCard(m){
    const act=needsAction(m), unread=!m.read_at;
    const tag=m.urgent?'<span class="msg-tag msg-tag-urgent">Urgent</span>':'';
    const typeTag=m.msg_type==='ack'?'<span class="msg-tag">Must acknowledge</span>':m.msg_type==='reply'?'<span class="msg-tag">Needs reply</span>':'';
    let done='';
    if(m.msg_type==='ack'&&m.acked_at) done=`<div class="msg-done">✓ You acknowledged this · ${ago(m.acked_at)}</div>`;
    if(m.msg_type==='reply'&&m.replied_at) done=`<div class="msg-done">✓ You replied: <b>${safe(m.reply)}</b> · ${ago(m.replied_at)}</div>`;
    let actions=`<button type="button" class="msg-speak" data-msg-speak="${m.id}"><svg class="icon" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>Read Aloud</button>`;
    if(!moving){
      if(m.msg_type==='ack'&&!m.acked_at) actions+=`<button type="button" class="msg-ack" data-msg-ack="${m.id}">✓ Got It</button>`;
      if(m.msg_type==='reply'&&!m.replied_at) actions+=(m.reply_options||[]).map(o=>`<button type="button" class="msg-reply ghost" data-msg-reply="${m.id}" data-reply="${safe(o)}">${safe(o)}</button>`).join('');
      if(m.msg_type==='notice'&&unread) actions+=`<button type="button" class="ghost" data-msg-read="${m.id}">Mark Read</button>`;
    }
    const body=moving?'<p class="msg-body msg-body-hidden">Message hidden while moving. Tap Read Aloud to listen.</p>':`<p class="msg-body">${safe(m.body).replace(/\n/g,'<br>')}</p>`;
    return `<article class="msg-item card${act?' msg-item-act':''}${unread?' msg-item-unread':''}${m.urgent?' msg-item-urgent':''}">
      <div class="msg-meta"><b>${safe(m.sender_name)}</b><span>${ago(m.created_at)}</span>${tag}${typeTag}${unread?'<span class="msg-tag msg-tag-new">New</span>':''}</div>
      ${body}${done}
      <div class="msg-actions">${actions}</div></article>`;
  }
  function render(){
    renderHomeCard();
    const signed=!!store.token;
    if(!$('msgView')) return;
    $('msgLogin').hidden=signed; $('msgSigned').hidden=!signed;
    if(!signed){ if($('msgDriverId')&&!$('msgDriverId').value) $('msgDriverId').value=LWHStorage.get('msgLastId',''); return; }
    const me=store.me||{};
    $('msgWho').textContent=me.name?`${me.name} (${me.driver_id})`:'';
    $('msgAutoRead').checked=store.autoRead; $('msgChime').checked=store.chime;
    $('msgAudioBar').hidden=!(store.autoRead&&speechOk&&!canSpeakNow());
    $('msgSpeakAll').hidden=!messages.some(m=>!m.read_at||needsAction(m));
    $('msgList').innerHTML=messages.length?messages.map(msgCard).join(''):'<div class="card msg-empty"><b>No messages right now.</b><span>New messages from dispatch show up here on their own.</span></div>';
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-msg-speak],[data-msg-ack],[data-msg-reply],[data-msg-read]'); if(!t) return;
    const id=Number(t.dataset.msgSpeak||t.dataset.msgAck||t.dataset.msgReply||t.dataset.msgRead);
    const m=messages.find(x=>x.id===id); if(!m) return;
    if(t.dataset.msgSpeak){ if(!speechOk) return LWHUI.toast('This device cannot read out loud'); speak([m]); }
    else if(t.dataset.msgAck){ if(moving) return; mark(m,'ack'); }
    else if(t.dataset.msgReply){ if(moving) return; mark(m,'reply',t.dataset.reply); }
    else if(t.dataset.msgRead){ mark(m,'read'); }
  });
  function wire(){
    if(!$('msgView')) return;
    $('msgLoginBtn').onclick=doLogin;
    $('msgPin').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
    $('msgSetupBtn').onclick=doSetup;
    $('msgSetupToggle').onclick=()=>setSetupMode($('msgSetupBox').hidden);
    $('msgLogout').onclick=doLogout;
    $('msgRefresh').onclick=()=>refresh();
    $('msgSpeakAll').onclick=()=>{ const l=messages.filter(m=>!m.read_at||needsAction(m)).reverse(); speak(l.length?l:messages.slice(0,3).reverse()); };
    $('msgStop').onclick=stopSpeaking;
    $('msgAutoRead').onchange=e=>{ store.autoRead=e.target.checked; render(); };
    $('msgChime').onchange=e=>{ store.chime=e.target.checked; };
    $('msgAudioOn').onclick=()=>{ // a tap unlocks speech for this session
      if(speechOk){ const u=new SpeechSynthesisUtterance('Spoken messages are on.'); if(voice) u.voice=voice; speechSynthesis.speak(u); }
      $('msgAudioBar').hidden=true;
    };
    $('msgTestVoice').onclick=()=>{ if(!speechOk) return LWHUI.toast('This device cannot read out loud'); chime().then(()=>speak([{id:0,sender_name:'Dispatch',body:'This is a test. If you hear this over the truck speakers, spoken messages are working.',msg_type:'notice',read_at:'x'}])); };
    render();
    if(store.token){ startPoll(); startGeo(); refresh({speakUnread:true}); }
  }
  window.LWHMessages={refresh,render,isSignedIn:()=>!!store.token};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();
})();
