(function(){
  function el(id){ return document.getElementById(id); }
  function todayStr(){ return new Date().toISOString().slice(0,10); }
  function nowTimeStr(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

  // Standard FMCSA §396.11/§396.13 inspection categories.
  const TRUCK_ITEMS=['Service Brakes','Parking Brake','Steering Mechanism','Lights & Reflectors','Tires','Horn','Windshield Wipers','Rear Vision Mirrors','Coupling Devices','Wheels & Rims','Emergency Equipment','Engine','Exhaust System','Fuel System','Battery','Defroster/Heater'];
  const TRAILER_ITEMS=['Service Brakes','Parking Brake','Lights & Reflectors','Tires','Wheels & Rims','Doors','Landing Gear','Coupling Devices (Kingpin)','Hitch','Roof/Tarp'];

  let dvirType='pretrip';
  let currentDate=todayStr();

  function key(date,type){ return `dvir:${date}:${type}`; }

  function defaultData(){
    return {
      time:'', odometer:'', driver:'', truck:'', trailer:'', location:'',
      truckDefects:{}, trailerDefects:{},
      truckDefectNotes:{}, trailerDefectNotes:{},
      safe:false, signature:''
    };
  }

  function loadData(){ return LWHStorage.get(key(currentDate,dvirType), defaultData()); }
  function saveData(d){ LWHStorage.set(key(currentDate,dvirType), d); }

  function renderItems(containerId, items, defectsKey, notesKey, data){
    const wrap=el(containerId); if(!wrap) return;
    wrap.innerHTML=items.map(name=>{
      const isDefect=!!data[defectsKey][name];
      return `<div class="dvir-item${isDefect?' defect':''}" data-item="${LWHUI.safe(name)}" data-defects-key="${defectsKey}">${LWHUI.safe(name)}${isDefect?' ⚠':''}</div>`;
    }).join('');
  }

  function renderDefectsList(data){
    const wrap=el('dvirDefectsWrap'), list=el('dvirDefectsList');
    if(!wrap||!list) return;
    const truckDefects=Object.keys(data.truckDefects).filter(k=>data.truckDefects[k]);
    const trailerDefects=Object.keys(data.trailerDefects).filter(k=>data.trailerDefects[k]);
    const all=[...truckDefects.map(n=>({n,src:'truckDefectNotes'})), ...trailerDefects.map(n=>({n,src:'trailerDefectNotes'}))];
    if(!all.length){ wrap.hidden=true; return; }
    wrap.hidden=false;
    list.innerHTML=all.map(({n,src})=>`<div class="dvir-defect-row"><b>${LWHUI.safe(n)}</b><input data-defect-note="${LWHUI.safe(n)}" data-note-key="${src}" placeholder="Describe the defect / repair needed" value="${LWHUI.safe(data[src][n]||'')}" /></div>`).join('');
  }

  function renderAll(){
    const data=loadData();
    el('dvirDate').value=currentDate;
    el('dvirTime').value=data.time||'';
    el('dvirOdometer').value=data.odometer||'';
    el('dvirDriver').value=data.driver||'';
    el('dvirTruck').value=data.truck||'';
    el('dvirTrailer').value=data.trailer||'';
    el('dvirLocation').value=data.location||'';
    el('dvirSafe').checked=!!data.safe;
    el('dvirSignature').value=data.signature||'';
    renderItems('dvirTruckItems', TRUCK_ITEMS, 'truckDefects', 'truckDefectNotes', data);
    renderItems('dvirTrailerItems', TRAILER_ITEMS, 'trailerDefects', 'trailerDefectNotes', data);
    renderDefectsList(data);
  }

  function updateField(mutator){
    const data=loadData();
    mutator(data);
    saveData(data);
  }

  function initTypePicker(){
    document.querySelectorAll('#dvirTypePicker [data-dvirtype]').forEach(btn=>{
      btn.onclick=()=>{
        document.querySelectorAll('#dvirTypePicker .seg').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        dvirType=btn.dataset.dvirtype;
        renderAll();
      };
    });
  }

  function initFields(){
    el('dvirDate').addEventListener('change',()=>{ currentDate=el('dvirDate').value||todayStr(); renderAll(); });
    [['dvirTime','time'],['dvirOdometer','odometer'],['dvirDriver','driver'],['dvirTruck','truck'],['dvirTrailer','trailer'],['dvirLocation','location'],['dvirSignature','signature']].forEach(([id,field])=>{
      const node=el(id); if(!node) return;
      node.addEventListener('input',()=>updateField(d=>{ d[field]=node.value; }));
    });
    el('dvirSafe').addEventListener('change',()=>updateField(d=>{ d.safe=dvirSafe.checked; }));

    ['dvirTruckItems','dvirTrailerItems'].forEach(id=>{
      const wrap=el(id); if(!wrap) return;
      wrap.addEventListener('click',e=>{
        const item=e.target.closest('[data-item]'); if(!item) return;
        const name=item.dataset.item, defectsKey=item.dataset.defectsKey;
        updateField(d=>{ d[defectsKey][name]=!d[defectsKey][name]; });
        renderAll();
      });
    });

    el('dvirDefectsList').addEventListener('input',e=>{
      const input=e.target.closest('[data-defect-note]'); if(!input) return;
      const name=input.dataset.defectNote, noteKey=input.dataset.noteKey;
      updateField(d=>{ d[noteKey][name]=input.value; });
    });

    el('dvirClear').onclick=()=>{
      if(!confirm('Clear this inspection report?')) return;
      saveData(defaultData());
      renderAll();
    };
  }

  function buildPrintSummaryHtml(data){
    const truckDefects=Object.keys(data.truckDefects).filter(k=>data.truckDefects[k]);
    const trailerDefects=Object.keys(data.trailerDefects).filter(k=>data.trailerDefects[k]);
    const defectRows=[...truckDefects.map(n=>`<li><b>${LWHUI.safe(n)}</b> (Truck) — ${LWHUI.safe(data.truckDefectNotes[n]||'')}</li>`),
                       ...trailerDefects.map(n=>`<li><b>${LWHUI.safe(n)}</b> (Trailer) — ${LWHUI.safe(data.trailerDefectNotes[n]||'')}</li>`)];
    return `
      <h1 style="font-size:20px;margin-bottom:4px">Driver Vehicle Inspection Report — ${dvirType==='pretrip'?'Pre-Trip':'Post-Trip'}</h1>
      <p style="font-size:13px;color:#555;margin-top:0">${currentDate} ${data.time||''} · ${LWHUI.safe(data.location||'')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px">
        <tr><td style="padding:4px 8px;border:1px solid #ccc"><b>Driver</b></td><td style="padding:4px 8px;border:1px solid #ccc">${LWHUI.safe(data.driver||'')}</td>
            <td style="padding:4px 8px;border:1px solid #ccc"><b>Odometer</b></td><td style="padding:4px 8px;border:1px solid #ccc">${LWHUI.safe(data.odometer||'')}</td></tr>
        <tr><td style="padding:4px 8px;border:1px solid #ccc"><b>Truck #</b></td><td style="padding:4px 8px;border:1px solid #ccc">${LWHUI.safe(data.truck||'')}</td>
            <td style="padding:4px 8px;border:1px solid #ccc"><b>Trailer #</b></td><td style="padding:4px 8px;border:1px solid #ccc">${LWHUI.safe(data.trailer||'')}</td></tr>
      </table>
      <h3 style="margin-top:16px;font-size:15px">${defectRows.length?'Defects Noted':'No Defects Noted'}</h3>
      ${defectRows.length?`<ul style="font-size:13px">${defectRows.join('')}</ul>`:'<p style="font-size:13px">All inspected items OK.</p>'}
      <p style="margin-top:16px;font-size:13px"><b>Condition satisfactory to operate:</b> ${data.safe?'YES':'NO — see defects above'}</p>
      <p style="font-size:13px"><b>Driver Signature:</b> ${LWHUI.safe(data.signature||'(not signed)')}</p>
      <p style="margin-top:10px;font-size:11px;color:#777">Paper backup report — not synced with Samsara/e-DVIR.</p>
    `;
  }

  async function exportPdf(){
    if(!window.jspdf || !window.html2canvas){ alert('PDF export libraries failed to load — check your internet connection.'); return; }
    const data=loadData();
    const wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;left:-9999px;top:0;width:700px;background:#fff;padding:20px;font-family:sans-serif';
    wrap.innerHTML=buildPrintSummaryHtml(data);
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
    doc.save(`dvir-${dvirType}-${currentDate}.pdf`);
    LWHUI.toast('PDF downloaded');
  }

  function printReport(){
    const data=loadData();
    let printDiv=el('dvirPrintArea');
    if(!printDiv){
      printDiv=document.createElement('div');
      printDiv.id='dvirPrintArea';
      printDiv.className='print-area';
      document.getElementById('dvir').appendChild(printDiv);
    }
    printDiv.innerHTML=buildPrintSummaryHtml(data);
    setTimeout(()=>print(),100);
  }

  function init(){
    if(!el('dvir')) return;
    el('dvirDate').value=currentDate;
    el('dvirTime').value=el('dvirTime').value||nowTimeStr();
    initTypePicker();
    initFields();
    el('dvirExportPdf').onclick=exportPdf;
    el('dvirPrint').onclick=printReport;
    renderAll();
  }
  window.addEventListener('load',init);
})();
