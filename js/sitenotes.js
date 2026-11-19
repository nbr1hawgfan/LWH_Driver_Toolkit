// Customer Site Notes (v1.43.0)
// The "what to know before you pull in" page for each customer: receiving hours, check-in, gate /
// door codes, where to park, docks, contacts, watch-outs. Find a site by name, or tap "Near me".
// Sites come from the Samsara address book (synced into Supabase), so most customers are already
// there. Any driver can add a note; dispatch approves it in the Message Center (Site Notes tab)
// before everyone sees it. Notes from a manager go straight in.
// Same sign-in as Messages. The last sites looked at are kept on the phone for no-signal reading.
(function(){
  'use strict';
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const VIEW='sites';
  const CATS=[['hours','Receiving hours','🕒'],['checkin','Check-in','📋'],['gate','Gate / door code','🔑'],['parking','Parking / staging','🅿️'],
              ['docks','Docks','🚚'],['contact','Contacts','📞'],['watch','Watch out','⚠️'],['other','Other','📝']];
  const CAT=Object.fromEntries(CATS.map(c=>[c[0],c]));
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const toast=m=>{ try{ LWHUI.toast(m); }catch(e){ alert(m); } };
  const token=()=>(window.LWHStorage&&LWHStorage.get('msgToken',''))||'';
  const linkify=s=>esc(s).replace(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g,m=>{ const t=m.trim(); return m.slice(0,m.length-m.trimStart().length)+`<a href="tel:${t.replace(/[^\d+]/g,'')}">${t}</a>`; }).replace(/\n/g,'<br>');

  let built=false, results=[], sel=null, spot=null, mode='near', addCat='', qT=null;

  async function rpc(name,args){ const r=await fetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status); const j=await r.json(); if(j&&j.ok===false) throw new Error(j.error==='signed_out'?'signed_out':j.error); return j; }
  const recent={ get:()=>{ try{ return LWHStorage.get('siteRecent',[]); }catch(e){ return []; } },
                 add:s=>{ try{ const l=recent.get().filter(x=>x.addr_id!==s.addr_id); l.unshift(s); LWHStorage.set('siteRecent',l.slice(0,25)); }catch(e){} } };

  function build(){
    const sec=$(VIEW); if(!sec||built) return; built=true;
    sec.innerHTML=`<div class="card sn-wrap">
      <div class="sn-top"><h2>Customer Site Notes</h2><p class="hint">Hours, check-in, gate codes, parking, docks and watch-outs for each customer — from drivers who've been there.</p></div>
      <div id="snSignIn" class="pod-note pod-warn" hidden>Sign in once with your name and PTO PIN (same as time off) to see site notes. <button type="button" class="ghost" data-view="messages">Sign in</button></div>
      <div id="snList">
        <div class="sn-searchrow"><input type="search" id="snQ" placeholder="Search customer, city or address" autocomplete="off"><button type="button" id="snNear">📍 Near me</button></div>
        <div class="sn-tabs"><button type="button" data-sn-mode="near" class="on">Results</button><button type="button" data-sn-mode="noted">All with notes</button><button type="button" data-sn-mode="recent">Recent</button></div>
        <div id="snStatus" class="hint"></div>
        <div id="snResults" class="sn-results"></div>
        <button type="button" class="ghost sn-newbtn" data-sn="new">+ Customer not listed? Add it</button>
      </div>
      <div id="snDetail" hidden></div>
    </div>`;
    $('snQ').addEventListener('input',()=>{ clearTimeout(qT); qT=setTimeout(()=>{ mode='near'; search(); },300); });
    $('snNear').onclick=()=>{ $('snQ').value=''; mode='near'; nearMe(); };
    sec.addEventListener('click',onClick);
  }

  function setMode(m){ mode=m; document.querySelectorAll('#'+VIEW+' [data-sn-mode]').forEach(b=>b.classList.toggle('on',b.dataset.snMode===m)); }
  async function search(){
    setMode(mode);
    if(!token()){ $('snSignIn').hidden=false; return; } $('snSignIn').hidden=true;
    const q=$('snQ').value.trim();
    if(mode==='recent'){ results=recent.get(); return drawResults('Sites you looked at on this phone.'); }
    if(mode==='near'&&!q&&!spot){ results=[]; return drawResults('Tap 📍 Near me, or search by name.'); }
    $('snStatus').textContent='Searching…';
    try{
      const r=await rpc('site_search',{p_token:token(),p_q:mode==='noted'?'':q,p_lat:spot&&spot.lat,p_lon:spot&&spot.lon,p_only_noted:mode==='noted'});
      results=r.sites||[]; drawResults(results.length?'':'Nothing found. Try fewer letters, or add the customer.');
    }catch(e){ if(e.message==='signed_out'){ $('snSignIn').hidden=false; $('snStatus').textContent=''; return; } results=recent.get().filter(s=>!q||(s.name+' '+(s.address||'')).toUpperCase().includes(q.toUpperCase())); drawResults('No signal — showing sites saved on this phone.'); }
  }
  function nearMe(){
    if(!navigator.geolocation){ toast('Location isn\'t available on this device.'); return; }
    $('snStatus').textContent='Finding you…';
    navigator.geolocation.getCurrentPosition(p=>{ spot={lat:p.coords.latitude,lon:p.coords.longitude}; search(); },
      ()=>{ $('snStatus').textContent='Couldn\'t get your location. Search by name instead.'; },{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
  }
  function badges(n){ return CATS.filter(c=>n&&n[c[0]]).map(c=>`<span class="sn-badge" title="${c[1]}">${c[2]}</span>`).join(''); }
  function drawResults(msg){
    $('snStatus').textContent=msg||'';
    $('snResults').innerHTML=results.map(s=>`<button type="button" class="sn-row" data-sn-open="${esc(s.addr_id)}">
      <div class="sn-row-main"><b>${esc(s.name)}</b><span class="hint">${esc(s.address||'')}</span></div>
      <div class="sn-row-side">${s.miles!=null?`<span class="sn-mi">${s.miles} mi</span>`:''}<span class="sn-badges">${badges(s.notes)||'<span class="hint">no notes yet</span>'}</span></div></button>`).join('');
  }

  function openSite(s){
    sel=s; recent.add(s); addCat='';
    $('snList').hidden=true; const d=$('snDetail'); d.hidden=false;
    const n=s.notes||{}, has=CATS.filter(c=>n[c[0]]);
    const maps=s.lat!=null?`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((s.name||'')+' '+(s.address||''))}`;
    d.innerHTML=`<button type="button" class="ghost pod-small" data-sn="back">← Back</button>
      <h3 class="sn-name">${esc(s.name)}</h3><div class="hint">${esc(s.address||'')}${s.miles!=null?` · ${s.miles} mi away`:''}</div>
      <div class="sn-actions"><a class="sn-btn" href="${maps}" target="_blank" rel="noopener">🧭 Directions</a><button type="button" class="ghost" data-sn="speak">🔊 Read aloud</button></div>
      ${has.length?has.map(c=>`<div class="sn-cat sn-cat-${c[0]}"><div class="sn-cat-h">${c[2]} ${c[1]}</div><div class="sn-cat-b">${linkify(n[c[0]])}</div></div>`).join('')
        :'<div class="pod-note">No notes yet for this customer. Be the first — add what the next driver should know.</div>'}
      ${s.updated_at?`<div class="hint">Last updated ${new Date(s.updated_at).toLocaleDateString()} by ${esc(s.updated_by||'')}</div>`:''}
      ${s.my_pending?`<div class="pod-note">You have ${s.my_pending} note${s.my_pending===1?'':'s'} waiting for dispatch to approve.</div>`:''}
      <div class="sn-add">
        <h3>Add a note</h3>
        <div class="sn-cats">${CATS.map(c=>`<button type="button" class="pod-cond" data-sn-cat="${c[0]}">${c[2]} ${c[1]}</button>`).join('')}</div>
        <textarea id="snText" rows="3" maxlength="600" placeholder="Pick what it's about, then type it the way you'd tell another driver."></textarea>
        <button type="button" data-sn="send" class="sn-send">Send note to dispatch</button>
        <p class="hint">Dispatch checks notes before everyone sees them. Don't text this while driving.</p>
      </div>`;
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function speak(){
    if(!('speechSynthesis' in window)||!sel) return;
    const n=sel.notes||{}; const parts=[sel.name+'.'].concat(CATS.filter(c=>n[c[0]]).map(c=>c[1]+': '+n[c[0]].replace(/\n/g,'. ')+'.'));
    speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(parts.length>1?parts.join(' '):sel.name+'. No notes yet.'); u.rate=.95; speechSynthesis.speak(u);
  }
  async function sendNote(){
    const t=$('snText').value.trim();
    if(!addCat){ toast('Pick what the note is about.'); return; }
    if(!t){ toast('Type the note.'); return; }
    try{
      const r=await rpc('site_suggest',{p_token:token(),p_addr_id:sel.addr_id,p_cat:addCat,p_text:t,p_lat:spot&&spot.lat,p_lon:spot&&spot.lon});
      toast(r.applied?'Note added ✓':'Thanks! Dispatch will check it, then everyone sees it.');
      if(r.applied){ sel.notes=Object.assign({},sel.notes,{[addCat]:((sel.notes||{})[addCat]?sel.notes[addCat]+'\n':'')+t}); } else sel.my_pending=(sel.my_pending||0)+1;
      openSite(sel);
    }catch(e){ toast(e.message==='signed_out'?'Sign in again in Messages.':e.message); }
  }
  function newSite(){
    $('snList').hidden=true; const d=$('snDetail'); d.hidden=false; addCat='';
    d.innerHTML=`<button type="button" class="ghost pod-small" data-sn="back">← Back</button>
      <h3 class="sn-name">Add a customer</h3>
      <p class="hint">For a place that isn't in the list. Your location is saved with it if you're there now.</p>
      <label>Customer / site name<input id="snNewName" maxlength="120"></label>
      <label>Address <span class="hint">(optional)</span><input id="snNewAddr" maxlength="200"></label>
      <div class="sn-cats">${CATS.map(c=>`<button type="button" class="pod-cond" data-sn-cat="${c[0]}">${c[2]} ${c[1]}</button>`).join('')}</div>
      <textarea id="snText" rows="3" maxlength="600" placeholder="First note for this customer"></textarea>
      <button type="button" data-sn="sendnew" class="sn-send">Send to dispatch</button>`;
    if(!spot&&navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>{ spot={lat:p.coords.latitude,lon:p.coords.longitude}; },()=>{},{timeout:8000,maximumAge:120000});
  }
  async function sendNew(){
    const name=$('snNewName').value.trim(), t=$('snText').value.trim();
    if(!name){ toast('Type the customer name.'); return; } if(!addCat){ toast('Pick what the note is about.'); return; } if(!t){ toast('Type the note.'); return; }
    try{ await rpc('site_suggest',{p_token:token(),p_addr_id:null,p_cat:addCat,p_text:t,p_new_name:name,p_new_address:$('snNewAddr').value.trim(),p_lat:spot&&spot.lat,p_lon:spot&&spot.lon});
      toast('Thanks! Dispatch will check it.'); back(); $('snQ').value=name; mode='near'; search(); }
    catch(e){ toast(e.message==='signed_out'?'Sign in again in Messages.':e.message); }
  }
  function back(){ $('snDetail').hidden=true; $('snList').hidden=false; if(window.speechSynthesis) speechSynthesis.cancel(); }

  function onClick(e){
    const b=e.target.closest('button'); if(!b) return; const d=b.dataset;
    if(d.snMode){ mode=d.snMode; search(); return; }
    if(d.snOpen){ const s=results.find(x=>x.addr_id===d.snOpen); if(s) openSite(s); return; }
    if(d.snCat){ addCat=d.snCat; document.querySelectorAll('#'+VIEW+' [data-sn-cat]').forEach(x=>x.classList.toggle('on',x===b)); $('snText').focus(); return; }
    switch(d.sn){ case 'back': back(); break; case 'speak': speak(); break; case 'send': sendNote(); break; case 'new': newSite(); break; case 'sendnew': sendNew(); break; }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const sec=$(VIEW); if(!sec) return;
    const onShow=()=>{ build(); $('snSignIn').hidden=!!token(); if(!results.length&&$('snDetail').hidden){ if(token()) nearMe(); else search(); } };
    new MutationObserver(()=>{ if(sec.classList.contains('active')) onShow(); }).observe(sec,{attributes:true,attributeFilter:['class']});
    if(sec.classList.contains('active')) onShow();
  });
})();
