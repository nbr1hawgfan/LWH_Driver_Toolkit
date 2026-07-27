(function(){
  function el(id){ return document.getElementById(id); }
  function todayStr(){ return new Date().toISOString().slice(0,10); }
  function nowTimeStr(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

  const ITEMS=['Coupling Device / Kingpin','Landing Gear','Frame','Suspension','Brakes','Wheels & Rims','Tires','Lights & Reflectors','Reflective/Conspicuity Tape','Doors & Seals','Door Latches / Locking Bars','Roof','Side Walls','Floor','License Plate','DOT/Annual Inspection Sticker','Mud Flaps','Spare Tire (if equipped)'];

  let currentKey='';

  function keyFor(date,trailer){ return `trailerInspect:${date}:${(trailer||'unassigned').trim()||'unassigned'}`; }

  function defaultData(){
    return { time:'', trailer:'', plate:'', driver:'', location:'', defects:{}, defectNotes:{}, safe:false, signature:'' };
  }

  function loadData(){ return LWHStorage.get(currentKey, defaultData()); }
  function saveData(d){ LWHStorage.set(currentKey, d); }

  function renderItems(data){
    const wrap=el('tiItems'); if(!wrap) return;
    wrap.innerHTML=ITEMS.map(name=>{
      const isDefect=!!data.defects[name];
      return `<div class="dvir-item${isDefect?' defect':''}" data-item="${LWHUI.safe(name)}">${LWHUI.safe(name)}${isDefect?' ⚠':''}</div>`;
    }).join('');
  }

  function renderDefectsList(data){
    const wrap=el('tiDefectsWrap'), list=el('tiDefectsList');
    if(!wrap||!list) return;
    const defects=Object.keys(data.defects).filter(k=>data.defects[k]);
    if(!defects.length){ wrap.hidden=true; return; }
    wrap.hidden=false;
    list.innerHTML=defects.map(n=>`<div class="dvir-defect-row"><b>${LWHUI.safe(n)}</b><input data-defect-note="${LWHUI.safe(n)}" placeholder="Describe the defect / repair needed" value="${LWHUI.safe(data.defectNotes[n]||'')}" /></div>`).join('');
  }

  function renderAll(){
    const data=loadData();
    el('tiTime').value=data.time||'';
    el('tiPlate').value=data.plate||'';
    el('tiDriver').value=data.driver||'';
    el('tiLocation').value=data.location||'';
    el('tiSafe').checked=!!data.safe;
    el('tiSignature').value=data.signature||'';
    renderItems(data);
    renderDefectsList(data);
  }

  function updateField(mutator){
    const data=loadData();
    mutator(data);
    saveData(data);
  }

  function refreshKeyAndRender(){
    const date=el('tiDate').value||todayStr();
    const trailer=el('tiTrailer').value||'';
    currentKey=keyFor(date,trailer);
    const data=loadData();
    data.trailer=trailer;
    saveData(data);
    renderAll();
  }

  function initFields(){
    el('tiDate').addEventListener('change',refreshKeyAndRender);
    el('tiTrailer').addEventListener('change',refreshKeyAndRender);
    [['tiTime','time'],['tiPlate','plate'],['tiDriver','driver'],['tiLocation','location'],['tiSignature','signature']].forEach(([id,field])=>{
      const node=el(id); if(!node) return;
      node.addEventListener('input',()=>updateField(d=>{ d[field]=node.value; }));
    });
    el('tiSafe').addEventListener('change',()=>updateField(d=>{ d.safe=tiSafe.checked; }));

    el('tiItems').addEventListener('click',e=>{
      const item=e.target.closest('[data-item]'); if(!item) return;
      const name=item.dataset.item;
      updateField(d=>{ d.defects[name]=!d.defects[name]; });
      renderAll();
    });

    el('tiDefectsList').addEventListener('input',e=>{
      const input=e.target.closest('[data-defect-note]'); if(!input) return;
      updateField(d=>{ d.defectNotes[input.dataset.defectNote]=input.value; });
    });

    el('tiClear').onclick=()=>{
      if(!confirm('Clear this trailer inspection report?')) return;
      const trailer=el('tiTrailer').value;
      saveData({...defaultData(),trailer});
      renderAll();
    };
  }

  function buildPrintHtml(data,date){
    const defects=Object.keys(data.defects).filter(k=>data.defects[k]);
    const defectRows=defects.map(n=>`<li><b>${LWHUI.safe(n)}</b> — ${LWHUI.safe(data.defectNotes[n]||'')}</li>`);
    return `
      <h1 style="font-size:20px;margin-bottom:4px">Trailer Inspection Report</h1>
      <p style="font-size:13px;color:#555;margin-top:0">${date} ${data.time||''} · ${LWHUI.safe(data.location||'')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px">
        <tr><td style="padding:4px 8px;border:1px solid #ccc"><b>Trailer #</b></td><td style="padding:4px 8px;border:1px solid #ccc">${LWHUI.safe(data.trailer||'')}</td>
            <td style="padding:4px 8px;border:1px solid #ccc"><b>Plate</b></td><td style="padding:4px 8px;border:1px solid #ccc">${LWHUI.safe(data.plate||'')}</td></tr>
        <tr><td style="padding:4px 8px;border:1px solid #ccc"><b>Driver</b></td><td style="padding:4px 8px;border:1px solid #ccc" colspan="3">${LWHUI.safe(data.driver||'')}</td></tr>
      </table>
      <h3 style="margin-top:16px;font-size:15px">${defectRows.length?'Defects Noted':'No Defects Noted'}</h3>
      ${defectRows.length?`<ul style="font-size:13px">${defectRows.join('')}</ul>`:'<p style="font-size:13px">All inspected items OK.</p>'}
      <p style="margin-top:16px;font-size:13px"><b>Safe to pull:</b> ${data.safe?'YES':'NO — see defects above'}</p>
      <p style="font-size:13px"><b>Driver Signature:</b> ${LWHUI.safe(data.signature||'(not signed)')}</p>
      <p style="margin-top:10px;font-size:11px;color:#777">Paper backup report.</p>
    `;
  }

  async function exportPdf(){
    if(!window.jspdf || !window.html2canvas){ alert('PDF export libraries failed to load — check your internet connection.'); return; }
    const data=loadData();
    const date=el('tiDate').value||todayStr();
    const wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;left:-9999px;top:0;width:700px;background:#fff;padding:20px;font-family:sans-serif';
    wrap.innerHTML=buildPrintHtml(data,date);
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
    doc.save(`trailer-inspection-${data.trailer||'unassigned'}-${date}.pdf`);
    LWHUI.toast('PDF downloaded');
  }

  function printReport(){
    const data=loadData();
    const date=el('tiDate').value||todayStr();
    let printDiv=el('tiPrintArea');
    if(!printDiv){
      printDiv=document.createElement('div');
      printDiv.id='tiPrintArea';
      printDiv.className='print-area';
      document.getElementById('trailerinspect').appendChild(printDiv);
    }
    printDiv.innerHTML=buildPrintHtml(data,date);
    setTimeout(()=>print(),100);
  }

  function init(){
    if(!el('trailerinspect')) return;
    el('tiDate').value=todayStr();
    currentKey=keyFor(todayStr(),'');
    const data=loadData();
    if(!data.time) data.time=nowTimeStr();
    saveData(data);
    initFields();
    el('tiExportPdf').onclick=exportPdf;
    el('tiPrint').onclick=printReport;
    renderAll();
  }
  window.addEventListener('load',init);
})();
