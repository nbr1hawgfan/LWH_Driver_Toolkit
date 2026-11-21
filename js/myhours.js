// My Hours (v1.52.0) — a driver's own hours for the week, the same numbers Chris sees in Driver Hours
// (Transportation Manager). Comes from payroll (TLand), which updates about every 15 minutes on workdays.
// Home card; tap it to see each day, and flip back to earlier weeks (up to 5).
(function(){
  const $=id=>document.getElementById(id);
  const SB='https://tjivcqxnkftujceumdtx.supabase.co', KEY='sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  let week=null, open=false, data=null, busy=false;
  const n=v=>v===null||v===undefined?0:+v;
  const f=v=>(Math.round(v*100)/100).toFixed(2).replace(/\.?0+$/,'')||'0';

  async function rpc(fn,args){
    const r=await fetch(`${SB}/rest/v1/rpc/${fn}`,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(args)});
    if(!r.ok) throw new Error('http '+r.status); return r.json();
  }
  function token(){ return window.LWHMsgAuth&&LWHMsgAuth.token&&LWHMsgAuth.token(); }
  function shift(ws,days){ const d=new Date(ws+'T12:00:00'); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }

  async function load(){
    const card=$('myHoursCard'); if(!card) return;
    const t=token(); if(!t){ card.hidden=true; data=null; return; }
    card.hidden=false;
    if(busy) return; busy=true;
    try{
      const r=await rpc('drv_my_hours',{p_token:t,p_week_start:week});
      if(r&&r.ok){ data=r; LWHStorage.set('myHours',r); }
      else if(r&&r.error==='signed_out'){ card.hidden=true; return; }
    }catch(e){ if(!data) data=LWHStorage.get('myHours',null); }
    finally{ busy=false; }
    draw();
  }
  function draw(){
    const card=$('myHoursCard'); if(!card||!data) return;
    const days=data.days||[], by={}; days.forEach(d=>by[d.date]=d);
    let work=0,pto=0,hol=0; days.forEach(d=>{ work+=n(d.hours); pto+=n(d.pto); hol+=n(d.hol); });
    const tot=work+pto+hol, ot=Math.max(0,work-40);
    const label=data.current?'this week':'week of '+new Date(data.week_start+'T12:00:00').toLocaleDateString([], {month:'short',day:'numeric'});
    $('myHoursSub').textContent=days.length
      ? `${f(tot)} hrs ${label}`+(ot?` · ${f(ot)} overtime`:'')+(open?'':' · tap for each day')
      : `No hours yet ${label}`+(data.current?' · payroll fills these in as the week goes':'');
    const box=$('myHoursBox'); box.hidden=!open; if(!open) return;
    const ws=data.week_start;
    const rows=[0,1,2,3,4,5,6].map(i=>{ const k=shift(ws,i), d=by[k], dt=new Date(k+'T12:00:00');
      const extra=d?[n(d.pto)?f(n(d.pto))+' PTO':'',n(d.hol)?f(n(d.hol))+' Holiday':''].filter(Boolean).join(' · '):'';
      return `<tr><td>${dt.toLocaleDateString([], {weekday:'short',month:'numeric',day:'numeric'})}</td><td class="r">${d?f(n(d.hours)):'—'}</td><td class="hint">${extra}</td></tr>`; }).join('');
    const sync=data.synced?new Date(data.synced).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'}):'';
    box.innerHTML=`<table class="mh-table"><tr><th>Day</th><th class="r">Hours</th><th></th></tr>${rows}
      <tr class="tot"><td>Total</td><td class="r">${f(tot)}</td><td class="hint">${[f(work)+' worked',pto?f(pto)+' PTO':'',hol?f(hol)+' Holiday':''].filter(Boolean).join(' · ')}</td></tr></table>
      <p class="hint mh-note">${data.approved?'<b>Approved for payroll.</b> ':'Not final until Chris approves the week. '}${sync?'Updated '+sync+'.':''} Something wrong? Message Dispatch.</p>
      <div class="mh-nav"><button type="button" class="ghost" data-mh="-7">‹ Earlier week</button>${data.current?'':'<button type="button" class="ghost" data-mh="0">This week</button>'}</div>`;
  }

  window.addEventListener('load',()=>{
    const card=$('myHoursCard'); if(!card) return;
    $('myHoursHead').onclick=()=>{ open=!open; draw(); };
    $('myHoursBox').addEventListener('click',e=>{
      const b=e.target.closest('[data-mh]'); if(!b||!data) return;
      const d=+b.dataset.mh; week=d===0?null:shift(data.week_start,d); load();
    });
    data=LWHStorage.get('myHours',null); if(data&&!data.current) data=null;
    load();
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden){ week=null; load(); } });
    setInterval(()=>{ if(!document.hidden&&!week) load(); },15*60e3);
  });
  window.LWHMyHours={ load:()=>{ week=null; open=false; data=null; load(); } };
})();
