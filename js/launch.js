/* App launcher — open the drivers' other apps (Samsara Driver, WEX CardControl) from the Toolkit.
   Order of tries:
   1) Fully Kiosk Browser on the truck tablets: fully.startApplication() (needs "Enable JavaScript Interface" in Fully).
   2) Android Chrome / installed app: an intent link; if the app is missing, Android opens its Play Store page.
   3) iPhone/iPad: the App Store page (iOS doesn't let web pages open other apps by name).
   4) Computer: a short note. */
(function(){
  'use strict';
  const APPS={
    samsara:{ name:'Samsara Driver', pkg:'com.samsara.driver', ios:'https://apps.apple.com/us/app/samsara-driver/id1106069401' },
    wex:{ name:'WEX CardControl', pkg:'com.efsllc.efsmobileapp', ios:'https://apps.apple.com/us/app/wex-cardcontrol/id1178046385' }
  };
  const ua=navigator.userAgent||'';
  const isAndroid=/Android/i.test(ua), isIOS=/iPhone|iPad|iPod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const play=pkg=>'https://play.google.com/store/apps/details?id='+pkg;
  function note(msg){ if(window.LWHUI&&LWHUI.toast) LWHUI.toast(msg); else alert(msg); }

  function launch(key){
    const a=APPS[key]; if(!a) return;
    // 1) Fully Kiosk
    try{
      if(window.fully&&typeof fully.startApplication==='function'){
        if(typeof fully.isAppInstalled!=='function'||fully.isAppInstalled(a.pkg)){ fully.startApplication(a.pkg); return; }
        note(a.name+' is not installed on this tablet. Ask dispatch to add it.'); return;
      }
    }catch(e){}
    // 2) Android
    if(isAndroid){
      location.href='intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package='+a.pkg+
        ';S.browser_fallback_url='+encodeURIComponent(play(a.pkg))+';end';
      return;
    }
    // 3) iPhone / iPad
    if(isIOS){ window.open(a.ios,'_blank','noopener'); return; }
    // 4) Computer
    note(a.name+' opens on the truck tablet or your phone.');
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-launch]'); if(!b) return;
    e.preventDefault(); launch(b.dataset.launch);
  });
  window.LWHLaunch={ launch, apps:APPS };
})();
