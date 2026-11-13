// Time Clock Board (manager, v1.42.0)
// Who is on the clock right now, every punch for a day (time, nearest site, map link), and the
// Sun-Sat week with hours and anything that needs checking. Read only: fix hours in the
// Driver Hours tool (LWH Cost Entry), which is where payroll is approved.
// Uses the Messages sign-in (Driver ID + PIN); only role Manager in the drivers table gets data.
(function(){
  const API='https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const $=id=>document.getElementById(id);
  const safe=s=>LWHUI.safe(s);
  const pad=n=>String(n).padStart(2,'0');
  const isoDay=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const fmtT=iso=>new Date(iso).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const hrs=v=>v===null||v===undefined?'':(+v).toFixed(2);
  const st={ tab:'day', day:isoDay(new Date()), week:null, timer:null, loading:false };

  async function rpc(name,args){
    const r=await fetch(API+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  const token=()=>LWHStorage.get('msgToken','');
  function status(t){ const s=$('tcbStatus'); if(s) s.textContent=t||''; }
  function signedOut(){
    $('tcbOut').innerHTML=`<div class="card"><b>Sign in first.</b><p class="hint">Open <b>Messages</b> and sign in with your Driver ID and PIN. Only people set as Manager in the driver list can see the time clock.</p><button type="button" data-view="messages">Open Messages</button></div>`;
    $('tcbOut').querySelector('button').onclick=()=>LWHUI.show('messages');
  }
  function sunday(iso){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()-d.getDay()); return isoDay(d); }

  async function load(){
    if(st.loading) return;
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
    const rows=r.rows||[];
    const on=rows.filter(x=>x.on_clock), worked=rows.filter(x=>!x.on_clock&&x.punches&&x.punches.length), none=rows.filter(x=>!x.punches||!x.punches.length);
    const card=x=>{
      const p=(x.punches||[]).map(q=>{
        const map=q.lat!=null?` <a href="https://maps.google.com/?q=${q.lat},${q.lon}" target="_blank" rel="noopener">map</a>`:' <span class="tcb-flag">no GPS</span>';
        const where=q.site?` · ${safe(q.site)}${q.site_m>400?` (${(q.site_m/1609.34).toFixed(1)} mi away)`:''}`:'';
        return `<li><b class="${q.type}">${q.type==='in'?'In':'Out'}</b> ${fmtT(q.at)}${where}${q.offline?' · sent later':''}${map}</li>`;
      }).join('');
      const flags=(x.flags||[]).filter(f=>f!=='No GPS').map(f=>`<span class="tcb-flag">${safe(f)}</span>`).join(' ');
      return `<div class="tcb-card${x.on_clock?' on':''}"><div class="tcb-head"><b>${safe(x.name)}</b><span class="hint">${safe(x.location||'')}</span><span class="tcb-hrs">${x.on_clock?'On clock':''}${x.hours!=null&&(+x.hours>0||!x.on_clock)?' '+hrs(x.hours)+' hrs':''}</span></div>${flags?`<div>${flags}</div>`:''}<ul class="tc-list">${p}</ul></div>`;
    };
    const today=r.date===isoDay(new Date());
    $('tcbOut').innerHTML=
      `<h3>${today?'On the clock now':'Still open'} (${on.length})</h3>${on.length?on.map(card).join(''):'<p class="hint">Nobody.</p>'}`+
      `<h3>Clocked out (${worked.length})</h3>${worked.length?worked.map(card).join(''):'<p class="hint">Nobody yet.</p>'}`+
      `<h3>No punches (${none.length})</h3><p class="hint">${none.map(x=>safe(x.name)+(x.has_pin?'':' (no PIN)')).join(', ')||'—'}</p>`;
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
        return `<td class="${x.needs_review?'rev':''}" title="${safe(tip)}">${hrs(x.hours)}${x.on_clock?'+':''}${x.needs_review?' !':''}</td>`; }).join('');
      return `<tr><th>${safe(by[id].name)}</th>${cells}<td class="tot">${hrs(tot)}</td></tr>`; }).join('');
    const sync=r.pin_sync&&r.pin_sync.at?`PINs last copied from the PTO tracker ${new Date(r.pin_sync.at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}.`:'PINs have not been copied from the PTO tracker yet.';
    const unm=r.pin_sync&&r.pin_sync.counts&&(r.pin_sync.counts.unmatched||[]).length?` In the tracker but not matched to a driver: ${r.pin_sync.counts.unmatched.map(safe).join(', ')}.`:'';
    $('tcbOut').innerHTML=
      (review?`<div class="tc-msg bad">${review} day${review>1?'s need':' needs'} checking (marked !): a missing clock-in or clock-out, or over 14 hours. Fix the hours in the Driver Hours tool before approving.</div>`:'')+
      `<div class="tc-week-wrap"><table class="tcb-week"><thead><tr><th>Driver</th>${head}<th>Total</th></tr></thead><tbody>${body||'<tr><td colspan="9">No punches this week.</td></tr>'}</tbody></table></div>`+
      `<p class="hint">Tap and hold (or hover) a day to see the punch times. + = still on the clock. Hours are rounded down to 0.05 like Samsara.</p>`+
      `<p class="hint"><b>No PIN on file:</b> ${(r.no_pin||[]).map(safe).join(', ')||'everyone has one'}. ${sync}${unm}</p>`;
  }

  function setTab(t){ st.tab=t; ['day','week'].forEach(x=>$('tcbTab_'+x).classList.toggle('on',x===t)); load(); }

  window.addEventListener('load',()=>{
    const root=$('timeclockBoard'); if(!root) return;
    $('tcbDate').value=st.day;
    $('tcbDate').onchange=()=>{ st.day=$('tcbDate').value||isoDay(new Date()); load(); };
    $('tcbPrev').onclick=()=>{ const d=new Date(st.day+'T00:00:00'); d.setDate(d.getDate()-(st.tab==='week'?7:1)); st.day=isoDay(d); $('tcbDate').value=st.day; load(); };
    $('tcbNext').onclick=()=>{ const d=new Date(st.day+'T00:00:00'); d.setDate(d.getDate()+(st.tab==='week'?7:1)); st.day=isoDay(d); $('tcbDate').value=st.day; load(); };
    $('tcbReload').onclick=load;
    $('tcbTab_day').onclick=()=>setTab('day');
    $('tcbTab_week').onclick=()=>setTab('week');
    let was=false;
    new MutationObserver(()=>{ const now=root.classList.contains('active');
      if(now&&!was){ load(); clearInterval(st.timer); st.timer=setInterval(()=>{ if(!document.hidden) load(); },60000); }
      if(!now&&was) clearInterval(st.timer);
      was=now; }).observe(root,{attributes:true,attributeFilter:['class']});
  });
})();
