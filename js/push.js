/* LWH notifications (Driver Toolkit + Transportation Manager share this file).
   Real phone / PC notifications, no extra app:
   - Android phones, truck tablets, and Chrome / Edge on a PC: tap "Turn on" and Allow.
   - iPhone / iPad: only after the app is added to the Home Screen (Apple's rule), then Turn on.
   This device's notification address is saved with the person signed in (Supabase push_subscribe).
   Sign out -> it's removed, so the next driver on a shared tablet never gets someone else's messages.
   Setup per app: window.LWHPushCfg = { app:'dt'|'tm', token:()=>string, signedIn:()=>bool, open:(url)=>void } */
(function(){
  const SB='https://tjivcqxnkftujceumdtx.supabase.co', KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const PUB='BMZQ9ilXZzI_VIOrnMtjCjP_Ls2szBmQa5EYMWUoUrRkwTBV-6ddbLXaXhjG_Fa2Wmov7zefaFHJYqtUhucahbg';
  const FN=SB+'/functions/v1/lwh-push';
  const cfg=()=>window.LWHPushCfg||{};
  const LS={ get:k=>{ try{ return localStorage.getItem('lwhpush_'+cfg().app+'_'+k); }catch(e){ return null; } },
             set:(k,v)=>{ try{ v==null?localStorage.removeItem('lwhpush_'+cfg().app+'_'+k):localStorage.setItem('lwhpush_'+cfg().app+'_'+k,v); }catch(e){} } };

  const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const supported=()=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  const keyBytes=()=>{ const s=PUB.replace(/-/g,'+').replace(/_/g,'/'); const b=atob(s+'='.repeat((4-s.length%4)%4)); return Uint8Array.from(b,c=>c.charCodeAt(0)); };

  async function rpc(fn,args){
    const r=await fetch(`${SB}/rest/v1/rpc/${fn}`,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(args)});
    if(!r.ok) throw new Error('Server error '+r.status); return r.json();
  }
  async function reg(){ return navigator.serviceWorker.ready; }
  async function current(){ try{ return await (await reg()).pushManager.getSubscription(); }catch(e){ return null; } }

  // What the screen should say: on | off | blocked | ios_home | unsupported
  function state(){
    if(!supported()) return isIOS()&&!standalone()?'ios_home':'unsupported';
    if(isIOS()&&!standalone()) return 'ios_home';
    if(Notification.permission==='denied') return 'blocked';
    return Notification.permission==='granted'&&LS.get('on')==='1'?'on':'off';
  }

  async function register(sub){
    const t=cfg().token&&cfg().token(); if(!t) throw new Error('Sign in first.');
    const r=await rpc('push_subscribe',{p_token:t,p_sub:sub.toJSON?sub.toJSON():sub,p_app:cfg().app,p_ua:navigator.userAgent.slice(0,200)});
    if(!r.ok) throw new Error(r.error==='not_manager'?'Only managers get these.':r.error==='signed_out'?'Sign in first.':'Could not turn on.');
    LS.set('on','1'); LS.set('who',t.slice(-12)); return true;
  }
  async function enable(){
    const s=state();
    if(s==='ios_home') throw new Error('On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), open it from there, then turn on notifications.');
    if(s==='unsupported') throw new Error('This browser can\'t do notifications. Use Chrome or Edge.');
    const perm=await Notification.requestPermission();
    if(perm!=='granted') throw new Error(perm==='denied'?'Notifications are blocked for this app. Turn them on in the phone or browser settings.':'Notifications were not allowed.');
    const r=await reg();
    let sub=await r.pushManager.getSubscription();
    if(!sub) sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes()});
    await register(sub); paint(); return true;
  }
  async function disable(){
    const sub=await current();
    if(sub){ try{ await rpc('push_unsubscribe',{p_endpoint:sub.endpoint}); }catch(e){} try{ await sub.unsubscribe(); }catch(e){} }
    LS.set('on',null); LS.set('who',null); paint();
  }
  // Sign out: stop this device getting the old person's notifications (keeps the browser permission).
  async function signedOut(){
    if(!supported()) return;
    const sub=await current();
    if(sub){ try{ await rpc('push_unsubscribe',{p_endpoint:sub.endpoint}); }catch(e){} }
    LS.set('who',null); paint();
  }
  // Sign in / app open: if this device already allowed notifications, tie it to whoever is signed in now.
  async function sync(){
    if(!supported()||Notification.permission!=='granted'||LS.get('on')!=='1') { paint(); return; }
    const t=cfg().token&&cfg().token(); if(!t){ paint(); return; }
    try{
      let sub=await current();
      if(!sub) sub=await (await reg()).pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes()});
      if(LS.get('who')!==t.slice(-12)||!LS.get('synced')||Date.now()-(+LS.get('synced'))>7*864e5){ await register(sub); LS.set('synced',String(Date.now())); }
    }catch(e){}
    paint();
  }
  async function test(){
    const sub=await current(); if(!sub) throw new Error('Notifications are not on for this device.');
    const r=await fetch(FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test',endpoint:sub.endpoint})}).then(x=>x.json());
    if(!r.ok) throw new Error(r.error||'The test did not go through.');
    return true;
  }

  // ---- screen bits: any element with these data attributes is kept up to date
  //   [data-push-status] text, [data-push-on] / [data-push-off] / [data-push-test] buttons, [data-push-banner] (shown while off)
  function paint(){
    const s=state(), signed=!!(cfg().signedIn&&cfg().signedIn());
    const txt={ on:'On for this device.', off:'Off for this device.', blocked:'Blocked. Turn notifications on for this app in the phone or browser settings, then tap Turn on.',
      ios_home:'iPhone: add the app to your Home Screen first (Share → Add to Home Screen), open it from there, then tap Turn on.', unsupported:'This browser can\'t do notifications. Use Chrome or Edge.' }[s];
    document.querySelectorAll('[data-push-status]').forEach(e=>{ e.textContent=txt; e.dataset.state=s; });
    document.querySelectorAll('[data-push-on]').forEach(b=>{ b.hidden=s==='on'||s==='unsupported'; b.disabled=s==='ios_home'; });
    document.querySelectorAll('[data-push-off],[data-push-test]').forEach(b=>b.hidden=s!=='on');
    const dismissed=LS.get('later')&&Date.now()-(+LS.get('later'))<7*864e5;
    document.querySelectorAll('[data-push-banner]').forEach(b=>b.hidden=!signed||s==='on'||s==='unsupported'||!!dismissed);
  }
  function toast(t){ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(t); else if(window.TM&&TM.toast) TM.toast(t); else alert(t); }

  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-push-on],[data-push-off],[data-push-test],[data-push-later]'); if(!b) return;
    e.preventDefault();
    try{
      if(b.hasAttribute('data-push-on')){ b.disabled=true; await enable(); toast('Notifications are on'); }
      else if(b.hasAttribute('data-push-off')){ await disable(); toast('Notifications are off for this device'); }
      else if(b.hasAttribute('data-push-test')){ await test(); toast('Test sent — watch for it'); }
      else if(b.hasAttribute('data-push-later')){ LS.set('later',String(Date.now())); paint(); }
    }catch(err){ toast(err.message||String(err)); }
    finally{ b.disabled=false; paint(); }
  });
  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('message',e=>{
      const d=e.data||{};
      if(d.type==='openUrl'&&cfg().open) cfg().open(d.url);
      if(d.type==='resubscribe') { LS.set('synced',null); sync(); }
    });
  }
  window.addEventListener('load',()=>{ setTimeout(sync,1500); });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) paint(); });
  window.LWHPush={ state, enable, disable, signedOut, sync, test, paint };
})();
