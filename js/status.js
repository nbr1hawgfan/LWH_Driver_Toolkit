// Status Update — one-tap Arrived / Loaded / Delivered / etc. texts to
// dispatch with the time and a GPS pin. The pin is grabbed when a status is
// tapped (not when sending) so Share/Text still count as a direct tap.
(function(){
  const CONTACTS=[{name:'Chris',phone:'14796521662'},{name:'Derek',phone:'14796519227'}];
  const STATUSES=['Arrived','Loaded','Unloaded','Delivered','Departed','Waiting','Running Late'];
  const KEY='statusDraft', LOG='statusLog';
  const el=id=>document.getElementById(id);
  let st=null, pin='', pinAt=0, locating=false;

  const draft=()=>LWHStorage.get(KEY,{status:'',location:'',trailer:'',load:'',eta:'',note:'',usePin:true});
  const save=()=>LWHStorage.set(KEY,st);
  const smsHref=(phone,body)=>`sms:${phone||''}${/iPhone|iPad|iPod/i.test(navigator.userAgent)?'&':'?'}body=${encodeURIComponent(body)}`;

  function message(){
    const drv=(LWHStorage.get('userName','')||'').trim();
    const now=new Date().toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const out=[`${(st.status||'STATUS').toUpperCase()}${st.location.trim()?' — '+st.location.trim():''}`,`${now}${drv?' · '+drv:''}`];
    const ids=[st.trailer.trim()&&'Trailer '+st.trailer.trim().toUpperCase(),st.load.trim()&&'Load/BOL '+st.load.trim()].filter(Boolean);
    if(ids.length) out.push(ids.join(' · '));
    if(st.status==='Running Late'&&st.eta.trim()) out.push('New ETA: '+st.eta.trim());
    if(st.note.trim()) out.push(st.note.trim());
    if(st.usePin&&pin) out.push('Pin: '+pin);
    return out.join('\n');
  }
  function preview(){ el('suPreview').textContent=message(); }

  function locate(){
    if(!st.usePin||locating||(pin&&Date.now()-pinAt<5*60000)) return;
    if(!navigator.geolocation){ el('suPin').textContent='GPS not available on this phone.'; return; }
    locating=true; el('suPin').textContent='Getting your location…';
    navigator.geolocation.getCurrentPosition(p=>{
      locating=false; pinAt=Date.now();
      pin=`https://maps.google.com/?q=${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`;
      el('suPin').textContent='Location pinned ✓'; preview();
    },()=>{ locating=false; el('suPin').textContent='Couldn\'t get location — it will send without a pin.'; },{enableHighAccuracy:true,timeout:12000,maximumAge:120000});
  }

  function renderStatuses(){
    el('suStatuses').innerHTML=STATUSES.map(s=>`<button type="button" class="su-btn${st.status===s?' on':''}" data-su="${s}">${s}</button>`).join('');
    el('suEtaWrap').hidden=st.status!=='Running Late';
  }
  function ok(){ if(!st.status){ LWHUI.toast('Tap a status first'); return false; } return true; }
  function log(how){
    const l=LWHStorage.get(LOG,[]); l.unshift({at:Date.now(),status:st.status,location:st.location.trim(),how});
    LWHStorage.set(LOG,l.slice(0,20)); renderLog();
    const locs=LWHStorage.get('yardLocations',[]), loc=st.location.trim();
    if(loc&&!locs.some(x=>x.toLowerCase()===loc.toLowerCase())){ locs.unshift(loc); LWHStorage.set('yardLocations',locs.slice(0,25)); fillLocs(); }
  }
  function renderLog(){
    const l=LWHStorage.get(LOG,[]).filter(x=>Date.now()-x.at<36*3600000);
    el('suLog').innerHTML=l.length?l.map(x=>`<div class="dt-entry"><b>${LWHUI.safe(x.status)}</b>${x.location?' — '+LWHUI.safe(x.location):''}<br><span class="hint">${new Date(x.at).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'})} · ${LWHUI.safe(x.how)}</span></div>`).join(''):'<p class="hint">No updates sent today.</p>';
  }
  function fillLocs(){ el('suLocList').innerHTML=LWHStorage.get('yardLocations',[]).map(l=>`<option value="${LWHUI.safe(l)}"></option>`).join(''); }

  function init(){
    if(!el('statusupdate')) return;
    st=Object.assign(draft(),LWHStorage.get(KEY,{}));
    [['suLocation','location'],['suTrailer','trailer'],['suLoad','load'],['suEta','eta'],['suNote','note']].forEach(([id,k])=>{
      el(id).value=st[k]||''; el(id).addEventListener('input',()=>{ st[k]=el(id).value; save(); preview(); });
    });
    el('suUsePin').checked=st.usePin!==false;
    el('suUsePin').onchange=()=>{ st.usePin=el('suUsePin').checked; save(); if(st.usePin) locate(); else el('suPin').textContent='Location will not be included.'; preview(); };
    renderStatuses(); fillLocs(); renderLog(); preview();
    el('suStatuses').addEventListener('click',e=>{
      const b=e.target.closest('[data-su]'); if(!b) return;
      st.status=b.dataset.su; save(); renderStatuses(); preview(); locate();
      if(st.status==='Running Late') el('suEta').focus();
    });
    el('suTextBtns').innerHTML=CONTACTS.map((c,i)=>`<button type="button" data-suto="${i}">Text ${c.name}</button>`).join('');
    el('suTextBtns').addEventListener('click',e=>{
      const b=e.target.closest('[data-suto]'); if(!b||!ok()) return;
      const c=CONTACTS[+b.dataset.suto]; log('Text to '+c.name); location.href=smsHref(c.phone,message());
    });
    el('suShare').onclick=async()=>{
      if(!ok()) return;
      if(navigator.share){ try{ await navigator.share({text:message()}); log('Shared'); }catch(e){} }
      else{ try{ await navigator.clipboard.writeText(message()); log('Copied'); LWHUI.toast('Copied — paste it into a text'); }catch(e){} }
    };
    el('suClear').onclick=()=>{
      // Keep location (likely the same stop) — clear everything else.
      st=Object.assign(draft(),{location:st.location,usePin:st.usePin,status:'',trailer:'',load:'',eta:'',note:''}); save();
      ['suTrailer','suLoad','suEta','suNote'].forEach(id=>el(id).value=''); renderStatuses(); preview();
    };
    new MutationObserver(()=>{ if(el('statusupdate').classList.contains('active')){ preview(); renderLog(); if(st.status) locate(); } })
      .observe(el('statusupdate'),{attributes:true,attributeFilter:['class']});
  }
  window.addEventListener('load',init);
})();
