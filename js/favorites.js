// ★ My Tools — star any tool on Home to pin it to the top, same idea as the
// Warehouse Toolkit. Saved on this device only (LWHStorage 'homeFavs').
// Works on the cards already on Home: built-in tools are keyed by data-view,
// links (PTO, Safety Training, Quick Links) by their address. Home's layout is
// otherwise untouched — the pinned cards are copies of the same cards.
(function(){
  const KEY='homeFavs';
  const $=id=>document.getElementById(id);
  let favs=[];
  try{ favs=(LWHStorage.get(KEY,[])||[]).filter(k=>typeof k==='string'); }catch(e){ favs=[]; }

  const keyOf=c=>c.dataset.view||(c.getAttribute('href')?'link:'+c.getAttribute('href'):'');
  const nameOf=c=>{ const b=c.querySelector('b'); return b?b.textContent.trim():'this tool'; };
  // Every starrable card on Home except the pinned copies (and phone-number cards).
  const sources=()=>[...document.querySelectorAll('#home .module-card, #home .qa-tile')]
    .filter(c=>!c.closest('#favGrid')&&!c.classList.contains('quickcall-card')&&keyOf(c));

  function setStar(c){
    const on=favs.includes(keyOf(c));
    let s=c.querySelector(':scope > .fav-star');
    if(!s){ s=document.createElement('span'); s.className='fav-star'; s.setAttribute('role','button'); s.tabIndex=0; c.appendChild(s); }
    s.classList.toggle('on',on);
    s.textContent=on?'★':'☆';
    const label=(on?'Remove ':'Add ')+nameOf(c)+(on?' from':' to')+' My Tools';
    s.title=label; s.setAttribute('aria-label',label);
  }

  function render(){
    const grid=$('favGrid'), head=$('favHead'); if(!grid) return;
    const src=sources(), byKey={};
    src.forEach(c=>{ if(!byKey[keyOf(c)]) byKey[keyOf(c)]=c; });
    // Drop pins whose tool no longer exists (e.g. a Quick Link that was removed),
    // but only once Quick Links have had a chance to draw.
    if($('quickLinksGrid')&&$('quickLinksGrid').dataset.favReady){
      const kept=favs.filter(k=>byKey[k]); if(kept.length!==favs.length){ favs=kept; LWHStorage.set(KEY,favs); }
    }
    grid.innerHTML='';
    favs.forEach(k=>{
      const c=byKey[k]; if(!c) return;
      const copy=c.cloneNode(true);
      copy.classList.remove('qa-tile'); copy.classList.add('module-card');
      if(c.closest('.mgr-only')) copy.classList.add('mgr-only');   // manager tools stay manager-only
      grid.appendChild(copy);
    });
    const any=grid.children.length>0;
    grid.hidden=head.hidden=!any;
    const qa=$('quickAccessHead'); if(qa) qa.style.marginTop=any?'22px':'';
    src.forEach(setStar);
    [...grid.children].forEach(setStar);
  }

  function toggle(k){
    const i=favs.indexOf(k);
    if(i===-1) favs.push(k); else favs.splice(i,1);
    LWHStorage.set(KEY,favs);
    render();
    if(window.LWHUI) LWHUI.toast(i===-1?'Pinned to My Tools':'Removed from My Tools');
  }

  function init(){
    const home=$('home'); if(!home||!$('favGrid')) return;
    // Capture phase so a star tap never also opens the tool (app.js listens for [data-view] clicks).
    const hit=e=>{
      const s=e.target.closest&&e.target.closest('.fav-star'); if(!s) return false;
      const c=s.closest('.module-card,.qa-tile'); if(!c) return false;
      e.preventDefault(); e.stopPropagation(); toggle(keyOf(c)); return true;
    };
    home.addEventListener('click',hit,true);
    home.addEventListener('keydown',e=>{ if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('fav-star')) hit(e); },true);
    // Quick Links are drawn by app.js (and redrawn after edits in Settings) — star them as they appear.
    const ql=$('quickLinksGrid');
    if(ql) new MutationObserver(()=>{ if([...ql.children].some(c=>!c.querySelector(':scope > .fav-star'))){ ql.dataset.favReady='1'; render(); } }).observe(ql,{childList:true});
    render();
    setTimeout(()=>{ if(ql) ql.dataset.favReady='1'; render(); },1500);
  }
  window.addEventListener('load',init);
  window.LWHFavorites={render};
})();
