// Time Clock Board (manager, v1.42.0; fixes v1.47.0)
// Who is on the clock right now, every punch for a day (time, nearest site, map link), and the
// Sun-Sat week with hours and anything that needs checking.
// Fixes (v1.47.0): add a missed punch, change a punch time, remove a punch (tc_fix). Every change needs a
// reason, keeps the original punch (crossed out), records who did it, and messages the driver. Hours for
// payroll recalculate from the punches, so the fix flows to the payroll export.
// Uses the Messages sign-in (Driver ID + PIN); only role Manager in the drivers table gets data.
(function(){
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const $=id=>document.getElementById(id);
  // Runs in the Driver Toolkit and in the Driver Message Center (Transportation Manager), which passes window.TCBToken.
  const safe=s=>window.LWHUI&&LWHUI.safe?LWHUI.safe(s):String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const pad=n=>String(n).padStart(2,'0');
  const isoDay=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const fmtT=iso=>new Date(iso).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const hrs=v=>v===null||v===undefined?'':(+v).toFixed(2);
  const st={ tab:'day', day:isoDay(new Date()), week:null, timer:null, loading:false, rows:[], fixing:null, focus:'' };

  async function rpc(name,args){
    const r=await fetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  const token=()=>window.TCBToken?TCBToken():LWHStorage.get('msgToken','');
  function status(t){ const s=$('tcbStatus'); if(s) s.textContent=t||''; }
  function signedOut(){
    $('tcbOut').innerHTML=`<div class="card"><b>Sign in first.</b><p class="hint">Open <b>Messages</b> and sign in with your Driver ID and PIN. Only people set as Manager in the driver list can see the time clock.</p><button type="button" data-view="messages">Open Messages</button></div>`;
    const b=$('tcbOut').querySelector('button'); if(window.LWHUI&&LWHUI.show) b.onclick=()=>LWHUI.show('messages'); else b.remove();
  }
  function sunday(iso){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()-d.getDay()); return isoDay(d); }

  async function load(){
    if(st.loading) return;
    if(st.fixing&&document.querySelector('.tcb-fix')) return;   // don't wipe a fix that is being typed
    if(!token()){ signedOut(); return; }
    st.loading=true; status('Loading…');
    try{
      if(st.tab==='day'){
        const r=await rpc('tc_board',{p_token:token(),p_date:st.day});
        if(!r.ok){ if(r.error==='signed_out') return signedOut(); throw new Error(r.error); }
        renderDay(r);
      } else {
        const r=await rpc('tc_week',{p_token:token(),p_week_start:sunday(st.day)});
        if(!r.ok){ if(r.error==='signed_out') return signedOut(); throw new Error(r.error); }
        renderWeek(r);
      }
      status('Updated '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}));
    }catch(e){ status('Could not load: '+e.message); }
    finally{ st.loading=false; }
  }

  function renderDay(r){
    const rows=r.rows||[]; st.rows=rows;
    const on=rows.filter(x=>x.on_clock), worked=rows.filter(x=>!x.on_clock&&x.punches&&x.punches.length), none=rows.filter(x=>!x.punches||!x.punches.length);
    const card=x=>{
      const p=(x.punches||[]).map(q=>{
        const map=q.lat!=null?` <a href="https://maps.google.com/?q=${q.lat},${q.lon}" target="_blank" rel="noopener">map</a>`:' <span class="tcb-flag">no GPS</span>';
        const where=q.site?` · ${safe(q.site)}${q.site_m>400?` (${(q.site_m/1609.34).toFixed(1)} mi away)`:''}`:'';
        const map2=q.manual?'':map;
        const who=q.manual?`<div class="tcb-fixed">Added by ${safe(q.by||'manager')}${q.reason?': '+safe(q.reason):''}</div>`:'';
        return `<li><b class="${q.type}">${q.type==='in'?'In':'Out'}</b> ${fmtT(q.at)}${q.manual?'':where}${q.offline?' · sent later':''}${map2}
          <button type="button" class="tcb-edit" data-fix-edit="${q.id}" data-drv="${safe(x.driver_id)}">Change</button>${who}</li>`;
      }).join('');
      const gone=(x.voided||[]).map(v=>`<li class="tcb-void"><s><b>${v.type==='in'?'In':'Out'}</b> ${fmtT(v.at)}</s> <span>${safe(v.by||'')}${v.reason?' — '+safe(v.reason):''}</span></li>`).join('');
      const flags=(x.flags||[]).filter(f=>f!=='No GPS').map(f=>`<span class="tcb-flag">${safe(f)}</span>`).join(' ');
      return `<div class="tcb-card${x.on_clock?' on':''}" data-card-drv="${safe(x.driver_id)}"><div class="tcb-head"><b>${safe(x.name)}</b><span class="hint">${safe(x.location||'')}</span><span class="tcb-hrs">${x.on_clock?'On clock':''}${x.hours!=null&&(+x.hours>0||!x.on_clock)?' '+hrs(x.hours)+' hrs':''}</span></div>${flags?`<div>${flags}</div>`:''}<ul class="tc-list">${p}</ul>
        ${gone?`<details class="tcb-gone"><summary>Changed or removed (${(x.voided||[]).length})</summary><ul class="tc-list">${gone}</ul></details>`:''}
        <button type="button" class="ghost tcb-add" data-fix-add="${safe(x.driver_id)}">+ Add a missed punch</button></div>`;
    };
    const today=r.date===isoDay(new Date());
    $('tcbOut').innerHTML=
      `<h3>${today?'On the clock now':'Still open'} (${on.length})</h3>${on.length?on.map(card).join(''):'<p class="hint">Nobody.</p>'}`+
      `<h3>Clocked out (${worked.length})</h3>${worked.length?worked.map(card).join(''):'<p class="hint">Nobody yet.</p>'}`+
      `<h3>No punches (${none.length})</h3>${none.length?`<p class="hint">Forgot to clock in at all? Tap their name to add the punches.</p><div class="tcb-none">${none.map(x=>`<button type="button" class="ghost" data-fix-add="${safe(x.driver_id)}">${safe(x.name)}${x.has_pin?'':' (no PIN)'}</button>`).join('')}</div>`:'<p class="hint">—</p>'}`;
    if(st.focus){ const c=document.querySelector(`[data-card-drv="${CSS.escape(st.focus)}"]`); if(c){ c.scrollIntoView({block:'center'}); c.classList.add('flash'); setTimeout(()=>c.classList.remove('flash'),1600); } st.focus=''; }
  }

  // ------------------------------------------------ fixes
  const REASONS=['Forgot to clock out','Forgot to clock in','Back from lunch, forgot to punch','Punched the wrong button','No signal / phone dead'];
  const hm=iso=>{ const d=new Date(iso); return pad(d.getHours())+':'+pad(d.getMinutes()); };
  function openFix(drv,punchId){
    closeFix();
    const x=st.rows.find(r=>r.driver_id===drv); if(!x) return;
    const q=punchId?(x.punches||[]).find(p=>String(p.id)===String(punchId)):null;
    const last=(x.punches||[]).slice(-1)[0];
    const type=q?q.type:(last&&last.type==='in'?'out':'in');
    st.fixing={drv,id:q?q.id:null};
    const anchor=document.querySelector(`[data-card-drv="${CSS.escape(drv)}"]`)||document.querySelector(`.tcb-none`);
    const box=document.createElement('div'); box.className='tcb-fix';
    box.innerHTML=`<h4>${q?'Change a punch':'Add a missed punch'} — ${safe(x.name)}</h4>
      ${q?`<p class="hint">Was: <b>${q.type==='in'?'Clock In':'Clock Out'} ${fmtT(q.at)}</b>. The original stays on record, crossed out.</p>`:''}
      <div class="tcb-fix-type"><button type="button" data-ft="in" class="${type==='in'?'on':''}">Clock In</button><button type="button" data-ft="out" class="${type==='out'?'on':''}">Clock Out</button></div>
      <div class="tcb-fix-row"><label>Date<input type="date" id="tcfDate" value="${q?isoDay(new Date(q.at)):st.day}"></label>
        <label>Time<input type="time" id="tcfTime" value="${q?hm(q.at):''}"></label></div>
      <label>Reason<input id="tcfReason" maxlength="200" placeholder="Why? (required)"></label>
      <div class="tcb-chips">${REASONS.map(r=>`<button type="button" class="ghost" data-fr="${safe(r)}">${safe(r)}</button>`).join('')}</div>
      <label class="tcb-check"><input type="checkbox" id="tcfNotify" checked> Send ${safe(x.name.split(' ')[0])} a message about this</label>
      <p class="tc-msg bad" id="tcfErr" hidden></p>
      <div class="tcb-fix-btns"><button type="button" id="tcfSave">Save</button>${q?'<button type="button" class="ghost danger" id="tcfRemove">Remove this punch</button>':''}<button type="button" class="ghost" id="tcfCancel">Cancel</button></div>`;
    if(anchor&&anchor.classList.contains('tcb-card')) anchor.appendChild(box); else if(anchor) anchor.after(box); else $('tcbOut').prepend(box);
    let ftype=type;
    box.querySelectorAll('[data-ft]').forEach(b=>b.onclick=()=>{ ftype=b.dataset.ft; box.querySelectorAll('[data-ft]').forEach(z=>z.classList.toggle('on',z===b)); });
    box.querySelectorAll('[data-fr]').forEach(b=>b.onclick=()=>{ $('tcfReason').value=b.dataset.fr; });
    $('tcfCancel').onclick=closeFix;
    $('tcfSave').onclick=()=>saveFix({type:ftype});
    if($('tcfRemove')) $('tcfRemove').onclick=()=>{ if(confirm('Remove this punch? It stays on record, crossed out.')) saveFix({remove:true}); };
    box.scrollIntoView({block:'center'}); setTimeout(()=>$('tcfTime').focus(),50);
  }
  function closeFix(){ document.querySelectorAll('.tcb-fix').forEach(b=>b.remove()); st.fixing=null; }
  async function saveFix(o){
    const f=st.fixing; if(!f) return;
    const err=t=>{ const e=$('tcfErr'); e.textContent=t; e.hidden=!t; };
    const reason=$('tcfReason').value.trim(), date=$('tcfDate').value, time=$('tcfTime').value;
    if(reason.length<3) return err('Type a reason, or tap one of the buttons.');
    if(!o.remove&&(!date||!time)) return err('Pick the date and time.');
    // Payroll (Sync-DriverClock on APP02) re-pulls only the last 14 days, and never changes approved weeks
    // or hours typed in Driver Hours. Warn when a fix is outside that window.
    const fixDay=o.remove?isoDay(new Date(((st.rows.find(r=>r.driver_id===f.drv)||{}).punches||[]).concat([]).find(p=>p.id===f.id)?.at||Date.now())):date;
    const age=Math.round((new Date(isoDay(new Date())+'T00:00:00')-new Date(fixDay+'T00:00:00'))/864e5);
    if(age>14&&!confirm('This day is more than 14 days ago, so payroll will NOT pick this up on its own.\n\nSave it here anyway, and also fix the hours in Driver Hours?')) return;
    $('tcfSave').disabled=true; err('');
    try{
      const r=await rpc('tc_fix',{p_token:token(),p_driver_id:f.drv,p_type:o.remove?null:o.type,p_local:o.remove?null:(date+' '+time),
        p_reason:reason,p_punch_id:f.id,p_remove:!!o.remove,p_notify:$('tcfNotify').checked});
      if(!r.ok){ if(r.error==='not_manager') return err('Only managers can fix punches. Sign in to Messages as a manager.'); return err(r.error||'Could not save.'); }
      closeFix(); st.focus=f.drv;
      if(date&&date!==st.day&&!o.remove){ st.day=date; $('tcbDate').value=date; }
      status('Saved. '+(r.message||'')+' Driver Hours picks it up within 15 minutes (5 AM–8 PM) unless the week is approved or the day was typed in by hand.'); await load();
    }catch(e){ err('Could not save: '+e.message+'. Check the connection and try again.'); }
    finally{ const b=$('tcfSave'); if(b) b.disabled=false; }
  }

  function renderWeek(r){
    const ws=new Date(r.week_start+'T00:00:00'), days=[...Array(7)].map((_,i)=>{ const d=new Date(ws); d.setDate(d.getDate()+i); return isoDay(d); });
    const by={}; (r.days||[]).forEach(x=>{ (by[x.driver_id]=by[x.driver_id]||{name:x.name,d:{}}).d[x.date]=x; });
    const ids=Object.keys(by).sort((a,b)=>by[a].name.localeCompare(by[b].name));
    const head=days.map(d=>`<th>${new Date(d+'T00:00:00').toLocaleDateString([], {weekday:'short',month:'numeric',day:'numeric'})}</th>`).join('');
    let review=0;
    const body=ids.map(id=>{ let tot=0;
      const cells=days.map(d=>{ const x=by[id].d[d]; if(!x) return '<td></td>';
        tot+=+x.hours||0; if(x.needs_review) review++;
        const tip=[x.detail,...(x.flags||[])].filter(Boolean).join('\n');
        return `<td class="${x.needs_review?'rev':''} tcb-go" data-go-day="${d}" data-go-drv="${safe(id)}" title="${safe(tip)}">${hrs(x.hours)}${x.on_clock?'+':''}${x.needs_review?' !':''}</td>`; }).join('');
      return `<tr><th>${safe(by[id].name)}</th>${cells}<td class="tot">${hrs(tot)}</td></tr>`; }).join('');
    const sync=r.pin_sync&&r.pin_sync.at?`PINs last copied from the PTO tracker ${new Date(r.pin_sync.at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}.`:'PINs have not been copied from the PTO tracker yet.';
    const unm=r.pin_sync&&r.pin_sync.counts&&(r.pin_sync.counts.unmatched||[]).length?` In the tracker but not matched to a driver: ${r.pin_sync.counts.unmatched.map(safe).join(', ')}.`:'';
    $('tcbOut').innerHTML=
      (review?`<div class="tc-msg bad">${review} day${review>1?'s need':' needs'} checking (marked !): a missing clock-in or clock-out, or over 14 hours. Tap the day to fix the punches.</div>`:'')+
      `<div class="tc-week-wrap"><table class="tcb-week"><thead><tr><th>Driver</th>${head}<th>Total</th></tr></thead><tbody>${body||'<tr><td colspan="9">No punches this week.</td></tr>'}</tbody></table></div>`+
      `<p class="hint">Tap a day to see its punches and fix them. + = still on the clock. Hours are rounded down to 0.05 like Samsara.</p>`+
      `<p class="hint"><b>No PIN on file:</b> ${(r.no_pin||[]).map(safe).join(', ')||'everyone has one'}. ${sync}${unm}</p>`;
  }

  function setTab(t){ closeFix(); st.tab=t; ['day','week'].forEach(x=>$('tcbTab_'+x).classList.toggle('on',x===t)); load(); }

  window.addEventListener('load',()=>{
    const root=$('timeclockBoard'); if(!root) return;
    $('tcbDate').value=st.day;
    $('tcbDate').onchange=()=>{ closeFix(); st.day=$('tcbDate').value||isoDay(new Date()); load(); };
    $('tcbPrev').onclick=()=>{ closeFix(); const d=new Date(st.day+'T00:00:00'); d.setDate(d.getDate()-(st.tab==='week'?7:1)); st.day=isoDay(d); $('tcbDate').value=st.day; load(); };
    $('tcbNext').onclick=()=>{ closeFix(); const d=new Date(st.day+'T00:00:00'); d.setDate(d.getDate()+(st.tab==='week'?7:1)); st.day=isoDay(d); $('tcbDate').value=st.day; load(); };
    $('tcbReload').onclick=()=>{ closeFix(); load(); };
    $('tcbTab_day').onclick=()=>setTab('day');
    $('tcbTab_week').onclick=()=>setTab('week');
    $('tcbOut').addEventListener('click',e=>{
      const ed=e.target.closest('[data-fix-edit]'); if(ed) return openFix(ed.dataset.drv,ed.dataset.fixEdit);
      const ad=e.target.closest('[data-fix-add]'); if(ad) return openFix(ad.dataset.fixAdd,null);
      const go=e.target.closest('[data-go-day]'); if(go){ st.day=go.dataset.goDay; st.focus=go.dataset.goDrv; $('tcbDate').value=st.day; setTab('day'); }
    });
    let was=false;
    new MutationObserver(()=>{ const now=root.classList.contains('active');
      if(now&&!was){ load(); clearInterval(st.timer); st.timer=setInterval(()=>{ if(!document.hidden) load(); },60000); }
      if(!now&&was) clearInterval(st.timer);
      was=now; }).observe(root,{attributes:true,attributeFilter:['class']});
  });
})();
