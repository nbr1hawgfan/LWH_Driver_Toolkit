// Messages from dispatch (v1.39.0, files + Message Dispatch in v1.40.0)
// - Each driver signs in once with their Driver ID + 6-digit PIN (first time: setup code from dispatch).
// - Inbox is checked every 30 seconds while the app is open, and whenever it comes back on screen.
// - New messages can be read out loud automatically; on a phone or tablet paired with the truck's
//   Bluetooth (or a headset) the voice plays through that, like any other media audio.
// - While the device is moving (GPS over ~5 mph) message text is hidden; Read Aloud still works.
// - Dispatch can attach a BOL/PDF or photo. Files are saved on the device when the message arrives so
//   they open with no signal, full screen, to show at the dock.
// - Drivers can message dispatch when stopped: a topic button, optional text, photo and location.
// Backend: Supabase RPCs drv_* and msg_*, plus the msg-file Edge Function (supabase/migrations/20261106*.sql).
(function(){
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const FILE_API='https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/msg-file';
  const FILE_CACHE='lwh-msg-files';
  const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const TOPICS=['Where to next?','Trailer not loaded','Running late','Waiting at customer','Equipment problem','Call me'];
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
  let sentMsgs=[], compose={replyTo:null,topic:'',photo:null};
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
    let t=`Message from ${m.sender_name}.`;
    if(m.in_reply_to) t+=` Answer to your message${m.in_reply_to.topic?' about '+m.in_reply_to.topic:''}.`;
    if(m.body) t+=` ${m.body}`;
    const files=(m.attachments||[]).filter(a=>!a.removed);
    if(files.length) t+=` . ${files.length===1?'One attachment':files.length+' attachments'}: ${files.map(a=>a.name.replace(/\.[a-z0-9]+$/i,'')).join(', ')}. Open it when you are stopped.`;
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
    if(moving){ if($('msgCompose')&&!$('msgCompose').hidden){ $('msgCompose').hidden=true; compose.paused=true; } closeViewer(); }
    else if(compose.paused){ compose.paused=false; $('msgCompose').hidden=false; }
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
      messages=r.messages||[]; sentMsgs=r.sent||[];
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
      prefetchFiles();
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
    store.token=''; store.me=null; messages=[]; sentMsgs=[]; stopPoll(); stopGeo(); stopSpeaking(); closeCompose(); closeViewer();
    try{ if(window.caches) caches.delete(FILE_CACHE); }catch(e){}
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
      actions+=`<button type="button" class="ghost msg-replybtn" data-msg-answer="${m.id}">Reply</button>`;
    }
    const body=moving?'<p class="msg-body msg-body-hidden">Message hidden while moving. Tap Read Aloud to listen.</p>':(m.body?`<p class="msg-body">${safe(m.body).replace(/\n/g,'<br>')}</p>`:'');
    const ctx=m.in_reply_to&&!moving?`<div class="msg-ctx">Answer to your message: <b>${safe(m.in_reply_to.topic||'')}</b>${m.in_reply_to.body?' — '+safe(m.in_reply_to.body):''}</div>`:'';
    const files=(m.attachments||[]).length&&!moving?`<div class="msg-files">${m.attachments.map(a=>fileBtn(a,m.id)).join('')}</div>`:'';
    return `<article class="msg-item card${act?' msg-item-act':''}${unread?' msg-item-unread':''}${m.urgent?' msg-item-urgent':''}">
      <div class="msg-meta"><b>${safe(m.sender_name)}</b><span>${ago(m.created_at)}</span>${tag}${typeTag}${unread?'<span class="msg-tag msg-tag-new">New</span>':''}</div>
      ${ctx}${body}${files}${done}
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
    $('msgNewBtn').disabled=moving; $('msgNewBtn').textContent=moving?'Stop to Message Dispatch':'Message Dispatch';
    $('msgSentHead').hidden=!sentMsgs.length;
    $('msgSentList').innerHTML=sentMsgs.map(sentCard).join('');
  }
  function sentCard(m){
    let st='Sent — not seen yet';
    if(m.handled_at) st=`✓ Handled by ${safe(m.handled_by||'dispatch')}`;
    else if(m.dispatch_read_at) st=`Seen by ${safe(m.dispatch_read_by||'dispatch')} · ${ago(m.dispatch_read_at)}`;
    const rep=m.replies?` · ${m.replies===1?'1 answer':m.replies+' answers'} above`:'';
    const files=(m.attachments||[]).length&&!moving?`<div class="msg-files">${m.attachments.map(a=>fileBtn(a,null)).join('')}</div>`:'';
    return `<article class="msg-sent card"><div class="msg-meta"><b>To dispatch</b><span>${ago(m.created_at)}</span>${m.topic?`<span class="msg-tag">${safe(m.topic)}</span>`:''}</div>
      ${m.body&&!moving?`<p class="msg-sent-body">${safe(m.body)}</p>`:''}${files}<div class="msg-sent-st${m.handled_at||m.dispatch_read_at?' ok':''}">${st}${rep}</div></article>`;
  }
  function fileBtn(a,msgId){
    if(a.removed) return `<span class="msg-file msg-file-gone">${safe(a.name)} — removed after 14 days</span>`;
    const pdf=a.mime==='application/pdf';
    const icon=pdf?'<svg class="icon" viewBox="0 0 24 24"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8 13h8M8 17h5"/></svg>':'<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/></svg>';
    return `<button type="button" class="msg-file" data-file="${a.id}" data-file-msg="${msgId||''}" data-file-name="${safe(a.name)}" data-file-mime="${safe(a.mime)}">${icon}<span>Open ${safe(a.name)}</span><small class="msg-file-saved" data-saved="${a.id}"></small></button>`;
  }

  // ---------------------------------------------------------------- files (offline cache + viewer)
  const cacheKey=id=>new URL('./__msgfile/'+id,location.href).href;
  async function cachedFile(id){
    try{ if(!window.caches) return null; const c=await caches.open(FILE_CACHE); const r=await c.match(cacheKey(id)); return r?await r.blob():null; }catch(e){ return null; }
  }
  async function downloadFile(id){
    const r=await fetch(FILE_API+'?action=url',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({token:store.token,id})});
    const j=await r.json().catch(()=>({ok:false,error:'HTTP '+r.status}));
    if(!j.ok){ if(j.error==='signed_out') signedOut('Your sign-in ran out. Please sign in again.'); throw new Error(j.error||'Could not get the file'); }
    const f=await fetch(j.url,{cache:'no-store'}); if(!f.ok) throw new Error('Download failed');
    const blob=await f.blob();
    try{ if(window.caches){ const c=await caches.open(FILE_CACHE); await c.put(cacheKey(id),new Response(blob,{headers:{'Content-Type':j.mime||blob.type}})); } }catch(e){}
    return blob;
  }
  async function getFile(id){ return (await cachedFile(id))||downloadFile(id); }
  let prefetching=false;
  async function prefetchFiles(){
    if(prefetching||!navigator.onLine||!window.caches) return; prefetching=true;
    try{
      const keep=new Set();
      const all=[...messages,...sentMsgs].flatMap(m=>(m.attachments||[]).filter(a=>!a.removed));
      for(const a of all){
        keep.add(cacheKey(a.id));
        if(!(await cachedFile(a.id))){ try{ await downloadFile(a.id); }catch(e){} }
        const el=document.querySelector(`[data-saved="${a.id}"]`); if(el) el.textContent='Saved on this device';
      }
      const c=await caches.open(FILE_CACHE);
      (await c.keys()).forEach(k=>{ if(!keep.has(k.url)) c.delete(k); });
    }catch(e){} finally{ prefetching=false; }
  }
  let viewerZoom=1, viewerDoc=null, viewerUrl=null;
  function loadPdfJs(){
    if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=PDFJS_URL; s.onload=()=>{ pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER; res(pdfjsLib); }; s.onerror=()=>rej(new Error('PDF viewer did not load')); document.head.appendChild(s); });
  }
  async function openFile(id,name,mime,msgId){
    const v=$('msgViewer'), body=$('msgViewerBody');
    $('msgViewerName').textContent=name||'File'; body.innerHTML='<p class="msg-viewer-note">Opening…</p>'; v.hidden=false; document.body.classList.add('msg-viewer-open');
    viewerZoom=1; viewerDoc=null;
    try{
      const blob=await getFile(id);
      if(msgId){ const m=messages.find(x=>x.id===msgId); if(m&&!m.opened_at){ m.opened_at=new Date().toISOString(); mark(m,'open',null,true); } }
      if(viewerUrl) URL.revokeObjectURL(viewerUrl); viewerUrl=URL.createObjectURL(blob);
      $('msgViewerZoomIn').hidden=$('msgViewerZoomOut').hidden=false;
      if((mime||blob.type)==='application/pdf'){
        const lib=await loadPdfJs();
        viewerDoc=await lib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;
        await renderPdf();
      }else{
        body.innerHTML=`<img class="msg-viewer-img" src="${viewerUrl}" alt="">`; applyImgZoom();
      }
    }catch(e){
      body.innerHTML=`<p class="msg-viewer-note">Could not open this file. ${safe(e.message||'')}<br>${navigator.onLine?'':'You are offline and it was not saved on this device yet.'}</p>`;
    }
  }
  async function renderPdf(){
    const body=$('msgViewerBody'); if(!viewerDoc) return;
    const width=Math.min(body.clientWidth-16,1400)*viewerZoom, dpr=Math.min(window.devicePixelRatio||1,2);
    body.innerHTML='';
    for(let i=1;i<=viewerDoc.numPages;i++){
      const page=await viewerDoc.getPage(i), vp1=page.getViewport({scale:1}), scale=width/vp1.width, vp=page.getViewport({scale:scale*dpr});
      const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height; cv.style.width=(vp.width/dpr)+'px'; cv.className='msg-viewer-page';
      body.appendChild(cv); await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
    }
  }
  function applyImgZoom(){ const img=document.querySelector('.msg-viewer-img'); if(img) img.style.width=(100*viewerZoom)+'%'; }
  function zoomViewer(f){ viewerZoom=Math.max(0.5,Math.min(4,viewerZoom*f)); if(viewerDoc) renderPdf(); else applyImgZoom(); }
  function closeViewer(){ const v=$('msgViewer'); if(!v) return; v.hidden=true; document.body.classList.remove('msg-viewer-open'); $('msgViewerBody').innerHTML=''; viewerDoc=null; if(viewerUrl){ URL.revokeObjectURL(viewerUrl); viewerUrl=null; } }

  // ---------------------------------------------------------------- driver -> dispatch
  function renderTopics(){ $('msgCmpTopics').innerHTML=TOPICS.map(t=>`<button type="button" class="msg-topic${compose.topic===t?' on':''}" data-topic="${safe(t)}">${safe(t)}</button>`).join(''); }
  function renderPhoto(){ const p=$('msgCmpPhotoPrev'); if(compose.photo){ p.hidden=false; $('msgCmpPhotoImg').src=compose.photo.url; } else p.hidden=true; }
  function openCompose(replyTo){
    if(moving) return LWHUI.toast('Stop first, then message dispatch');
    compose.replyTo=replyTo?replyTo.id:null;
    $('msgCmpTitle').textContent=replyTo?`Reply to ${replyTo.sender_name}`:'Message Dispatch';
    $('msgCmpCtx').hidden=!replyTo; if(replyTo) $('msgCmpCtx').textContent='“'+(replyTo.body||'').slice(0,140)+'”';
    $('msgCmpErr').hidden=true; renderTopics(); renderPhoto();
    $('msgCompose').hidden=false; $('msgCompose').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function closeCompose(){
    const c=$('msgCompose'); if(!c) return; c.hidden=true; compose.paused=false;
    compose={replyTo:null,topic:'',photo:null}; $('msgCmpText').value=''; $('msgCmpPhoto').value='';
  }
  async function shrinkPhoto(file){
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('Could not read that photo')); i.src=url; });
      const max=1600, k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
      const cv=document.createElement('canvas'); cv.width=Math.round(img.naturalWidth*k); cv.height=Math.round(img.naturalHeight*k);
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      return await new Promise(res=>cv.toBlob(res,'image/jpeg',0.8));
    }finally{ URL.revokeObjectURL(url); }
  }
  async function pickPhoto(e){
    const f=e.target.files&&e.target.files[0]; if(!f) return;
    try{ const blob=await shrinkPhoto(f); compose.photo={blob,url:URL.createObjectURL(blob)}; renderPhoto(); }
    catch(err){ LWHUI.toast(err.message); }
  }
  function currentSpot(){
    if(!$('msgCmpLoc').checked||!('geolocation' in navigator)) return Promise.resolve(null);
    if(lastFix&&Date.now()-lastFix.t<120000) return Promise.resolve({lat:lastFix.lat,lon:lastFix.lon,acc:null});
    return new Promise(res=>navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude,acc:Math.round(p.coords.accuracy||0)}),()=>res(null),{enableHighAccuracy:true,timeout:8000,maximumAge:60000}));
  }
  async function sendCompose(){
    const err=$('msgCmpErr'), text=$('msgCmpText').value.trim(); err.hidden=true;
    if(moving){ err.textContent='You are moving. Stop first.'; err.hidden=false; return; }
    if(!compose.topic&&!text&&!compose.photo){ err.textContent='Tap a topic or type a message.'; err.hidden=false; return; }
    if(!navigator.onLine){ err.textContent='No signal right now. Try again when you have service, or call dispatch.'; err.hidden=false; return; }
    const b=$('msgCmpSend'); b.disabled=true; b.textContent='Sending…';
    try{
      let files=null;
      if(compose.photo){
        const up=await fetch(FILE_API+'?action=upload',{method:'POST',headers:{apikey:KEY,'Content-Type':'image/jpeg','x-msg-token':store.token,'x-file-name':encodeURIComponent('photo-'+new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')+'.jpg')},body:compose.photo.blob});
        const uj=await up.json().catch(()=>({ok:false,error:'HTTP '+up.status}));
        if(!uj.ok){ if(uj.error==='signed_out') return signedOut('Your sign-in ran out. Please sign in again.'); throw new Error(uj.error||'Photo did not upload'); }
        files=[uj.id];
      }
      const spot=await currentSpot();
      const r=await rpc('msg_driver_send',{p_token:store.token,p_topic:compose.topic||'',p_body:text,p_lat:spot?spot.lat:null,p_lon:spot?spot.lon:null,p_acc:spot?spot.acc:null,p_reply_to:compose.replyTo,p_attachments:files});
      if(!r.ok){ if(r.error==='signed_out') return signedOut('Your sign-in ran out. Please sign in again.'); throw new Error(r.error); }
      closeCompose(); LWHUI.toast('Sent to dispatch'); refresh();
    }catch(e2){ err.textContent=(e2.message||'Could not send')+'. Try again, or call dispatch.'; err.hidden=false; }
    finally{ b.disabled=false; b.textContent='Send to Dispatch'; }
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click',e=>{
    const f=e.target.closest('[data-file]');
    if(f){ if(moving) return LWHUI.toast('Open files when you are stopped'); openFile(f.dataset.file,f.dataset.fileName,f.dataset.fileMime,f.dataset.fileMsg?Number(f.dataset.fileMsg):null); return; }
    const an=e.target.closest('[data-msg-answer]');
    if(an){ const m=messages.find(x=>x.id===Number(an.dataset.msgAnswer)); if(m) openCompose(m); return; }
    const tp=e.target.closest('[data-topic]');
    if(tp){ compose.topic=compose.topic===tp.dataset.topic?'':tp.dataset.topic; renderTopics(); return; }
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
    $('msgNewBtn').onclick=()=>openCompose(null);
    $('msgCmpCancel').onclick=closeCompose;
    $('msgCmpSend').onclick=sendCompose;
    $('msgCmpPhoto').onchange=pickPhoto;
    $('msgCmpPhotoDel').onclick=()=>{ compose.photo=null; $('msgCmpPhoto').value=''; renderPhoto(); };
    $('msgViewerClose').onclick=closeViewer;
    $('msgViewerZoomIn').onclick=()=>zoomViewer(1.25);
    $('msgViewerZoomOut').onclick=()=>zoomViewer(0.8);
    $('msgTestVoice').onclick=()=>{ if(!speechOk) return LWHUI.toast('This device cannot read out loud'); chime().then(()=>speak([{id:0,sender_name:'Dispatch',body:'This is a test. If you hear this over the truck speakers, spoken messages are working.',msg_type:'notice',read_at:'x'}])); };
    render();
    if(store.token){ startPoll(); startGeo(); refresh({speakUnread:true}); }
  }
  window.LWHMessages={refresh,render,isSignedIn:()=>!!store.token};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();
})();
