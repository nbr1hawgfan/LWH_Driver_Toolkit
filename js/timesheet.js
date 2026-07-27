(function(){
  function el(id){ return document.getElementById(id); }
  const DAY_LABELS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function todayStr(){ return new Date().toISOString().slice(0,10); }

  // Snap any date to the Sunday on/before it.
  function sundayOf(dateStr){
    const d=new Date(dateStr+'T00:00:00');
    d.setDate(d.getDate()-d.getDay());
    return d.toISOString().slice(0,10);
  }
  function addDays(dateStr,n){
    const d=new Date(dateStr+'T00:00:00');
    d.setDate(d.getDate()+n);
    return d.toISOString().slice(0,10);
  }
  function fmtShort(dateStr){
    const d=new Date(dateStr+'T00:00:00');
    return d.toLocaleDateString([], {month:'short',day:'numeric'});
  }

  let weekStart=sundayOf(todayStr());

  function key(){ return `timesheet:${weekStart}`; }
  function defaultData(){ return { driver:'', location:'', hours:[0,0,0,0,0,0,0] }; }
  function loadData(){ return LWHStorage.get(key(), defaultData()); }
  function saveData(d){ LWHStorage.set(key(), d); }

  function renderDays(data){
    const wrap=el('tsDaysWrap'); if(!wrap) return;
    wrap.innerHTML=DAY_LABELS.map((label,i)=>{
      const date=addDays(weekStart,i);
      return `<div class="grid-2" style="align-items:center;margin-bottom:4px">
        <label style="margin-bottom:0">${label} — ${fmtShort(date)}</label>
        <input data-day="${i}" type="number" min="0" step="0.25" inputmode="decimal" placeholder="0" value="${data.hours[i]||''}" />
      </div>`;
    }).join('');
  }

  function renderTotal(data){
    const total=data.hours.reduce((s,h)=>s+(parseFloat(h)||0),0);
    el('tsTotal').textContent=total.toLocaleString(undefined,{maximumFractionDigits:2});
  }

  function renderAll(){
    const data=loadData();
    el('tsDriver').value=data.driver||'';
    el('tsLocation').value=data.location||'';
    el('tsWeekStart').value=weekStart;
    renderDays(data);
    renderTotal(data);
  }

  function updateField(mutator){
    const data=loadData();
    mutator(data);
    saveData(data);
  }

  function initFields(){
    el('tsDriver').addEventListener('input',()=>updateField(d=>{ d.driver=el('tsDriver').value; }));
    el('tsLocation').addEventListener('input',()=>updateField(d=>{ d.location=el('tsLocation').value; }));
    el('tsWeekStart').addEventListener('change',()=>{
      weekStart=sundayOf(el('tsWeekStart').value||todayStr());
      renderAll();
    });
    el('tsPrevWeek').onclick=()=>{ weekStart=addDays(weekStart,-7); renderAll(); };
    el('tsNextWeek').onclick=()=>{ weekStart=addDays(weekStart,7); renderAll(); };

    el('tsDaysWrap').addEventListener('input',e=>{
      const input=e.target.closest('[data-day]'); if(!input) return;
      const idx=+input.dataset.day;
      updateField(d=>{ d.hours[idx]=parseFloat(input.value)||0; });
      renderTotal(loadData());
    });

    el('tsClear').onclick=()=>{
      if(!confirm('Clear this week\'s timesheet?')) return;
      const d=loadData();
      saveData({driver:d.driver,location:d.location,hours:[0,0,0,0,0,0,0]});
      renderAll();
    };
  }

  function buildPrintHtml(data){
    const rows=DAY_LABELS.map((label,i)=>`<tr><td style="padding:5px 8px;border:1px solid #ccc">${label}</td><td style="padding:5px 8px;border:1px solid #ccc">${fmtShort(addDays(weekStart,i))}</td><td style="padding:5px 8px;border:1px solid #ccc;text-align:right">${(parseFloat(data.hours[i])||0).toLocaleString()}</td></tr>`).join('');
    const total=data.hours.reduce((s,h)=>s+(parseFloat(h)||0),0);
    return `
      <h1 style="font-size:20px;margin-bottom:4px">Weekly Timesheet</h1>
      <p style="font-size:13px;color:#555;margin-top:0">Week of ${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart,6))}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
        <tr><td style="padding:5px 8px;border:1px solid #ccc"><b>Driver</b></td><td style="padding:5px 8px;border:1px solid #ccc" colspan="2">${LWHUI.safe(data.driver||'')}</td></tr>
        <tr><td style="padding:5px 8px;border:1px solid #ccc"><b>Location</b></td><td style="padding:5px 8px;border:1px solid #ccc" colspan="2">${LWHUI.safe(data.location||'')}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px">
        <thead><tr><th style="padding:5px 8px;border:1px solid #ccc;text-align:left">Day</th><th style="padding:5px 8px;border:1px solid #ccc;text-align:left">Date</th><th style="padding:5px 8px;border:1px solid #ccc;text-align:right">Hours</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td style="padding:5px 8px;border:1px solid #ccc" colspan="2"><b>Total</b></td><td style="padding:5px 8px;border:1px solid #ccc;text-align:right"><b>${total.toLocaleString()}</b></td></tr></tfoot>
      </table>
    `;
  }

  async function exportPdf(){
    if(!window.jspdf || !window.html2canvas){ alert('PDF export libraries failed to load — check your internet connection.'); return; }
    const data=loadData();
    const wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;left:-9999px;top:0;width:600px;background:#fff;padding:20px;font-family:sans-serif';
    wrap.innerHTML=buildPrintHtml(data);
    document.body.appendChild(wrap);
    LWHUI.toast('Building PDF…');
    const canvas=await html2canvas(wrap,{scale:2,backgroundColor:'#ffffff'});
    wrap.remove();
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({unit:'in',format:'letter'});
    const pageW=8.5, pageH=11, margin=0.4;
    const maxW=pageW-margin*2, maxH=pageH-margin*2;
    const ratio=canvas.width/canvas.height;
    let w=maxW,h=w/ratio;
    if(h>maxH){ h=maxH; w=h*ratio; }
    doc.addImage(canvas.toDataURL('image/png'),'PNG',(pageW-w)/2,margin,w,h);
    doc.save(`timesheet-${data.driver||'driver'}-${weekStart}.pdf`.replace(/\s+/g,'-'));
    LWHUI.toast('PDF downloaded');
  }

  function printSheet(){
    const data=loadData();
    let printDiv=el('tsPrintArea');
    if(!printDiv){
      printDiv=document.createElement('div');
      printDiv.id='tsPrintArea';
      printDiv.className='print-area';
      document.getElementById('timesheet').appendChild(printDiv);
    }
    printDiv.innerHTML=buildPrintHtml(data);
    setTimeout(()=>print(),100);
  }

  function init(){
    if(!el('timesheet')) return;
    initFields();
    el('tsExportPdf').onclick=exportPdf;
    el('tsPrint').onclick=printSheet;
    renderAll();
  }
  window.addEventListener('load',init);
})();
