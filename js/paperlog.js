(function(){
  const STATUS_COLORS=['#c9c9d2','#5b8fc7','#1a7a1a','#e0a800']; // Off Duty, Sleeper Berth, Driving, On-Duty
  const STATUS_LABELS=['Off Duty','Sleeper Berth','Driving','On-Duty (Not Driving)'];
  const SLOTS=96; // 24h * 4 (15-min increments)
  let activeStatus=0;
  let currentDate=todayStr();
  let painting=false;

  function el(id){ return document.getElementById(id); }
  function todayStr(){ const d=new Date(); return d.toISOString().slice(0,10); }
  function dayKey(date){ return 'paperLog:'+date; }
  function loadDay(date){
    return LWHStorage.get(dayKey(date), {
      driver:'', carrier:'Logistics Warehouse', vehicle:'', codriver:'', shipDoc:'',
      grid:Array(SLOTS).fill(0), remarks:[]
    });
  }
  function saveDay(date,data){ LWHStorage.set(dayKey(date),data); }

  function renderHourLabels(){
    const wrap=el('plHourLabels'); if(!wrap) return;
    wrap.innerHTML='';
    for(let h=0;h<24;h++){
      const span=document.createElement('span');
      const label=h===0?'12A':h<12?h+'A':h===12?'12P':(h-12)+'P';
      span.textContent=label;
      span.style.flex='4'; // 4 quarter-slots per hour
      wrap.append(span);
    }
  }

  function renderTimeline(data){
    const timeline=el('plTimeline'); if(!timeline) return;
    timeline.innerHTML='';
    data.grid.forEach((status,i)=>{
      const cell=document.createElement('div');
      cell.className='pl-cell';
      cell.style.background=STATUS_COLORS[status];
      cell.dataset.idx=i;
      timeline.append(cell);
    });
  }

  function renderStaircase(data){
    const wrap=el('plStaircase'); if(!wrap) return;
    const w=960, rowH=26, h=rowH*4+10;
    const slotW=w/SLOTS;
    let path=`M0,${rowY(data.grid[0])}`;
    for(let i=0;i<SLOTS;i++){
      const x=i*slotW, xEnd=(i+1)*slotW;
      const y=rowY(data.grid[i]);
      path+=` L${x},${y} L${xEnd},${y}`;
      if(i<SLOTS-1 && data.grid[i+1]!==data.grid[i]){
        path+=` L${xEnd},${rowY(data.grid[i+1])}`;
      }
    }
    function rowY(status){ return 5+status*rowH+rowH/2; }
    const rowLines=STATUS_LABELS.map((label,i)=>`<text x="2" y="${rowY(i)-6}" font-size="9" fill="#5c5c6b">${label}</text><line x1="0" y1="${rowY(i)}" x2="${w}" y2="${rowY(i)}" stroke="#e2e0e4" stroke-width="1"/>`).join('');
    wrap.innerHTML=`<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;background:#fff">${rowLines}<path d="${path}" fill="none" stroke="#c8102e" stroke-width="2"/></svg>`;
  }

  function computeTotals(grid){
    const counts=[0,0,0,0];
    grid.forEach(s=>counts[s]++);
    return counts.map(c=>c*0.25); // each slot = 15 min = 0.25 hr
  }

  function renderTotals(data){
    const out=el('plTotals'); if(!out) return;
    const totals=computeTotals(data.grid);
    out.innerHTML=STATUS_LABELS.map((label,i)=>`<div><b>${totals[i].toFixed(2)}h</b><span>${label}</span></div>`).join('');
  }

  function renderRemarks(data){
    const list=el('plRemarksList'); if(!list) return;
    if(!data.remarks.length){ list.innerHTML='<p class="hint">No remarks yet.</p>'; return; }
    list.innerHTML=data.remarks.map((r,i)=>`<div class="pl-remark-row"><span class="time">${r.time||''}</span><span>${LWHUI.safe(r.note||'')}</span><button type="button" class="ghost" data-remove-remark="${i}">Remove</button></div>`).join('');
  }

  function renderAll(){
    const data=loadDay(currentDate);
    el('plDate').value=currentDate;
    el('plDriver').value=data.driver;
    el('plCarrier').value=data.carrier;
    el('plVehicle').value=data.vehicle;
    el('plCodriver').value=data.codriver;
    el('plShipDoc').value=data.shipDoc;
    renderHourLabels();
    renderTimeline(data);
    renderStaircase(data);
    renderTotals(data);
    renderRemarks(data);
  }

  function updateFieldsAndSave(mutator){
    const data=loadDay(currentDate);
    mutator(data);
    saveDay(currentDate,data);
    return data;
  }

  function idxFromEvent(e,timeline){
    const rect=timeline.getBoundingClientRect();
    const clientX=(e.touches&&e.touches[0]?e.touches[0].clientX:e.clientX);
    const ratio=Math.min(1,Math.max(0,(clientX-rect.left)/rect.width));
    return Math.min(SLOTS-1,Math.floor(ratio*SLOTS));
  }

  function paintAt(idx){
    const data=loadDay(currentDate);
    data.grid[idx]=activeStatus;
    saveDay(currentDate,data);
    renderTimeline(data);
    renderStaircase(data);
    renderTotals(data);
  }

  function initTimelinePainting(){
    const timeline=el('plTimeline'); if(!timeline) return;
    const start=e=>{ painting=true; paintAt(idxFromEvent(e,timeline)); };
    const move=e=>{ if(!painting) return; e.preventDefault(); paintAt(idxFromEvent(e,timeline)); };
    const end=()=>{ painting=false; };
    timeline.addEventListener('mousedown',start);
    timeline.addEventListener('mousemove',move);
    window.addEventListener('mouseup',end);
    timeline.addEventListener('touchstart',start,{passive:true});
    timeline.addEventListener('touchmove',move,{passive:false});
    timeline.addEventListener('touchend',end);
  }

  function initControls(){
    document.querySelectorAll('#plStatusPicker [data-status]').forEach(btn=>{
      btn.onclick=()=>{
        document.querySelectorAll('#plStatusPicker .seg').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        activeStatus=+btn.dataset.status;
      };
    });
    ['plDriver','plCarrier','plVehicle','plCodriver','plShipDoc'].forEach(id=>{
      const field=el(id); if(!field) return;
      const key={plDriver:'driver',plCarrier:'carrier',plVehicle:'vehicle',plCodriver:'codriver',plShipDoc:'shipDoc'}[id];
      field.addEventListener('input',()=>updateFieldsAndSave(d=>{ d[key]=field.value; }));
    });
    el('plDate').addEventListener('change',()=>{ currentDate=el('plDate').value||todayStr(); renderAll(); });
    el('plPrevDay').onclick=()=>{ const d=new Date(currentDate); d.setDate(d.getDate()-1); currentDate=d.toISOString().slice(0,10); renderAll(); };
    el('plNextDay').onclick=()=>{ const d=new Date(currentDate); d.setDate(d.getDate()+1); currentDate=d.toISOString().slice(0,10); renderAll(); };
    el('plRemarkAdd').onclick=()=>{
      const time=el('plRemarkTime').value, note=el('plRemarkNote').value.trim();
      if(!note){ LWHUI.toast('Enter a remark note first'); return; }
      updateFieldsAndSave(d=>d.remarks.push({time,note}));
      el('plRemarkNote').value=''; el('plRemarkTime').value='';
      renderRemarks(loadDay(currentDate));
    };
    el('plRemarksList').addEventListener('click',e=>{
      const b=e.target.closest('[data-remove-remark]'); if(!b) return;
      updateFieldsAndSave(d=>d.remarks.splice(+b.dataset.removeRemark,1));
      renderRemarks(loadDay(currentDate));
    });
    el('plClearDay').onclick=()=>{
      if(!confirm('Clear this day\'s log grid and remarks?')) return;
      saveDay(currentDate,{driver:el('plDriver').value,carrier:el('plCarrier').value,vehicle:el('plVehicle').value,codriver:el('plCodriver').value,shipDoc:el('plShipDoc').value,grid:Array(SLOTS).fill(0),remarks:[]});
      renderAll();
    };
    el('plExportPdf').onclick=exportPdf;
  }

  async function exportPdf(){
    if(!window.jspdf || !window.html2canvas){ alert('PDF export libraries failed to load — check your internet connection.'); return; }
    const card=el('paperlog').querySelector('.card');
    LWHUI.toast('Building PDF…');
    const canvas=await html2canvas(card,{scale:2,backgroundColor:'#ffffff'});
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({unit:'in',format:'letter',orientation:'landscape'});
    const pageW=11, pageH=8.5, margin=0.3;
    const maxW=pageW-margin*2, maxH=pageH-margin*2;
    const ratio=canvas.width/canvas.height;
    let w=maxW,h=w/ratio;
    if(h>maxH){ h=maxH; w=h*ratio; }
    doc.addImage(canvas.toDataURL('image/png'),'PNG',(pageW-w)/2,margin,w,h);
    doc.save(`paper-log-${currentDate}.pdf`);
    LWHUI.toast('PDF downloaded');
  }

  function init(){
    if(!el('paperlog')) return;
    currentDate=todayStr();
    initTimelinePainting();
    initControls();
    renderAll();
  }
  window.addEventListener('load',init);
})();
