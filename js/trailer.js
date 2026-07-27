(function(){
  const GMP_QUESTIONS=[
    'Evidence of odor?',
    'Debris on floor or in corners?',
    'Evidence of rodent activity?',
    'Previous product residue?',
    'Sidewall or ceiling damage?',
    'Holes in floor or roof?',
    'Nails or other objects protruding from floor or walls?',
    'Evidence or leaks, moisture, standing water?',
    'Problems with door latching?',
    'Is trailer unsealable?'
  ];
  const PRESHIP_QUESTIONS=[
    'Have all instructions on Bill of Lading been followed?',
    'Does trailer latch properly?',
    'Has the trailer been sealed?',
    'If a COA is requested has driver been given copy?',
    'Has dunnage been placed where necessary if required?',
    'Inspection sheet turned into office to send with BOL?'
  ];

  function el(id){ return document.getElementById(id); }
  function safe(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  // Signature pad: Pointer Events cover mouse, touch, and stylus with one code
  // path across modern browsers. Canvas internal resolution is fixed; drawing
  // coordinates are scaled against the canvas's on-screen size so it stays
  // accurate whether it's rendered full-width on a phone or a tablet.
  function setupSignaturePad(canvas){
    if(!canvas) return null;
    canvas.width=600; canvas.height=150;
    const ctx=canvas.getContext('2d');
    ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#111';
    let drawing=false, hasInk=false, last=null;
    function pos(e){
      const rect=canvas.getBoundingClientRect();
      return {x:(e.clientX-rect.left)*(canvas.width/rect.width), y:(e.clientY-rect.top)*(canvas.height/rect.height)};
    }
    function start(e){ drawing=true; last=pos(e); e.preventDefault(); }
    function move(e){
      if(!drawing) return;
      const p=pos(e);
      ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke();
      last=p; hasInk=true;
      e.preventDefault();
    }
    function end(){ drawing=false; }
    canvas.addEventListener('pointerdown',start);
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',end);
    canvas.addEventListener('pointerleave',end);
    canvas.addEventListener('pointercancel',end);
    return {
      clear(){ ctx.clearRect(0,0,canvas.width,canvas.height); hasInk=false; },
      hasSignature(){ return hasInk; },
      dataUrl(){ return canvas.toDataURL('image/png'); }
    };
  }
  let loaderPad=null, driverPad=null;

  // ---------- Driver's license photo (optional second printed page) ----------
  let licenseStream=null, licenseCanvas=null;
  async function openLicenseCamera(){
    try{
      licenseStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
      const video=el('tcLicenseVideo'); video.srcObject=licenseStream;
      try{ await video.play(); }catch(e){}
      el('tcLicenseCameraWrap').hidden=false; el('tcLicenseOpenBtn').hidden=true; el('tcLicenseCloseBtn').hidden=false;
      el('tcLicensePreviewWrap').hidden=true;
    }catch(e){ alert('Could not open the camera: '+e.message); }
  }
  function closeLicenseCamera(){
    if(licenseStream){ licenseStream.getTracks().forEach(t=>t.stop()); licenseStream=null; }
    const wrap=el('tcLicenseCameraWrap'); if(wrap) wrap.hidden=true;
    const openBtn=el('tcLicenseOpenBtn'); if(openBtn) openBtn.hidden=false;
    const closeBtn=el('tcLicenseCloseBtn'); if(closeBtn) closeBtn.hidden=true;
  }
  function captureLicensePhoto(){
    const video=el('tcLicenseVideo'); if(!video||!video.videoWidth) return;
    licenseCanvas=document.createElement('canvas');
    licenseCanvas.width=video.videoWidth; licenseCanvas.height=video.videoHeight;
    licenseCanvas.getContext('2d').drawImage(video,0,0);
    el('tcLicensePreview').src=licenseCanvas.toDataURL('image/jpeg',0.92);
    el('tcLicensePreviewWrap').hidden=false;
    closeLicenseCamera();
  }
  function clearLicensePhoto(){
    licenseCanvas=null;
    const preview=el('tcLicensePreviewWrap'); if(preview) preview.hidden=true;
    closeLicenseCamera();
  }

  // Pre-checked defaults: GMP defaults to No (matches how these almost always
  // come back), Pre-Shipment defaults to Yes — saves a tap per row. Either can
  // still be changed or reset to blank if something's actually an exception.
  function buildQuestionRow(q,idx,prefix,defaultVal){
    const opts=['','yes','no'].map(v=>{
      const lbl=v===''?'— Not checked —':(v==='yes'?'Yes':'No');
      return `<option value="${v}"${v===defaultVal?' selected':''}>${lbl}</option>`;
    }).join('');
    return `<div class="grid-2" style="align-items:center;margin-bottom:4px"><span style="font-weight:400">${safe(q)}</span><select id="${prefix}_${idx}">${opts}</select></div>`;
  }

  function renderLists(){
    const gmp=el('tcGmpList'), preship=el('tcPreShipList');
    if(gmp) gmp.innerHTML=GMP_QUESTIONS.map((q,i)=>buildQuestionRow(q,i,'tcGmp','no')).join('');
    if(preship) preship.innerHTML=PRESHIP_QUESTIONS.map((q,i)=>buildQuestionRow(q,i,'tcPreShip','yes')).join('');
  }

  function answerFor(prefix,idx){ const s=el(prefix+'_'+idx); return s?s.value:''; }

  function tableRows(questions,prefix){
    return questions.map((q,i)=>{
      const a=answerFor(prefix,i);
      return `<tr><td class="tc-x">${a==='yes'?'X':''}</td><td class="tc-x">${a==='no'?'X':''}</td><td>${safe(q)}</td></tr>`;
    }).join('');
  }

  function formatDate(v){
    if(!v) return '';
    const [y,m,d]=v.split('-');
    return (m&&d&&y)?`${m}-${d}-${y}`:v;
  }
  function formatTime(v){
    if(!v) return '';
    const [h,mi]=v.split(':');
    if(h===undefined) return v;
    const hh=((+h+11)%12)+1, ampm=(+h>=12)?'PM':'AM';
    return `${hh}:${mi} ${ampm}`;
  }

  function checklistHtml(){
    const door=el('tcDoor').value, date=formatDate(el('tcDate').value), time=formatTime(el('tcTime').value),
      carrier=el('tcCarrier').value, trailer=el('tcTrailer').value, seal=el('tcSeal').value,
      driverName=el('tcDriverName').value, driverLicense=el('tcDriverLicense').value, notes=el('tcNotes').value;

    const mainPage=`<div class="checklist-page">
      <div class="tc-doortag">${door?('Door '+safe(door)):''}</div>
      <h1 class="tc-title">Trailer Pre-Loading Checklist</h1>
      <div class="tc-headrow">
        <div>
          <div><b>Date:</b> ${safe(date)}</div>
          <div><b>Carrier Name:</b> ${safe(carrier)}</div>
          <div><b>Seal Number:</b> ${safe(seal)}</div>
          <div><b>Driver Name:</b> ${safe(driverName)}</div>
          <div><b>Driver's License #:</b> ${safe(driverLicense)}</div>
        </div>
        <div class="tc-headright">
          <div><b>Time:</b> ${safe(time)}</div>
          <div><b>Trailer Number:</b> ${safe(trailer)}</div>
        </div>
      </div>

      <h2 class="tc-section">Drivers and Loaders</h2>
      <p class="tc-instructions">Please make sure you check the following to ensure the trailer is suitable to load. If any box is checked yes, notify the manager or supervisor.</p>
      <h3 class="tc-subsection">General Trailer GMP</h3>
      <table class="tc-table"><thead><tr><th>YES</th><th>NO</th><th></th></tr></thead><tbody>${tableRows(GMP_QUESTIONS,'tcGmp')}</tbody></table>
      <div class="tc-notes"><b>Notes/Comments:</b> ${safe(notes)}</div>
      <p class="tc-warning">Any item on this checklist could cause the trailer to be rejected</p>

      <div class="tc-box">
        <h3 class="tc-subsection">Pre-Shipment Checklist</h3>
        <table class="tc-table"><thead><tr><th>YES</th><th>NO</th><th></th></tr></thead><tbody>${tableRows(PRESHIP_QUESTIONS,'tcPreShip')}</tbody></table>
      </div>

      <p class="tc-ack">We acknowledge that this load is leaving in good condition and that all customer request and instructions have been met.</p>
      <div class="tc-sig">Loader Signature: ${(loaderPad&&loaderPad.hasSignature())?`<img class="tc-sig-img" src="${loaderPad.dataUrl()}" />`:'<span class="tc-sigline"></span>'}</div>
      <div class="tc-sig">Driver/Carrier Signature: ${(driverPad&&driverPad.hasSignature())?`<img class="tc-sig-img" src="${driverPad.dataUrl()}" />`:'<span class="tc-sigline"></span>'}</div>
    </div>`;

    const licensePage=licenseCanvas?`<div class="checklist-page" style="page-break-before:always">
      <h1 class="tc-title">Driver's License</h1>
      <p style="text-align:center;font-size:13px"><b>Driver:</b> ${safe(driverName)} &nbsp;&nbsp; <b>License #:</b> ${safe(driverLicense)}</p>
      <div style="text-align:center;margin-top:24px"><img src="${licenseCanvas.toDataURL('image/jpeg',0.92)}" style="max-width:100%;max-height:8.5in;border:1px solid #000" /></div>
    </div>`:'';

    return mainPage+licensePage;
  }

  function generate(){
    const out=el('trailerPrintOutput'); if(!out) return;
    out.innerHTML=checklistHtml();
    if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11); // full 8.5x11 page(s), not a small label
    LWHUI.toast('Checklist generated'+(licenseCanvas?' (2 pages — license photo included)':''));
  }

  function clearForm(){
    ['tcDoor','tcDate','tcTime','tcCarrier','tcTrailer','tcSeal','tcDriverName','tcDriverLicense','tcNotes'].forEach(id=>{ const f=el(id); if(f) f.value=''; });
    renderLists(); // resets GMP/Pre-Shipment selects back to their No/Yes defaults, not blank
    if(loaderPad) loaderPad.clear();
    if(driverPad) driverPad.clear();
    clearLicensePhoto();
    const out=el('trailerPrintOutput'); if(out) out.innerHTML='';
  }

  window.LWHTrailer={stopLicenseCamera:closeLicenseCamera};

  window.addEventListener('load',()=>{
    if(!el('trailerForm')) return;
    renderLists();
    loaderPad=setupSignaturePad(el('tcSigLoader'));
    driverPad=setupSignaturePad(el('tcSigDriver'));
    const loaderClearBtn=el('tcSigLoaderClear'); if(loaderClearBtn) loaderClearBtn.onclick=()=>loaderPad&&loaderPad.clear();
    const driverClearBtn=el('tcSigDriverClear'); if(driverClearBtn) driverClearBtn.onclick=()=>driverPad&&driverPad.clear();
    const genBtn=el('tcGenerate'); if(genBtn) genBtn.onclick=generate;
    const clearBtn=el('tcClear'); if(clearBtn) clearBtn.onclick=clearForm;
    const licOpen=el('tcLicenseOpenBtn'); if(licOpen) licOpen.onclick=openLicenseCamera;
    const licClose=el('tcLicenseCloseBtn'); if(licClose) licClose.onclick=closeLicenseCamera;
    const licSnap=el('tcLicenseSnapBtn'); if(licSnap) licSnap.onclick=captureLicensePhoto;
    const licRetake=el('tcLicenseRetakeBtn'); if(licRetake) licRetake.onclick=clearLicensePhoto;
    // Default Date/Time to right now, purely for convenience — still fully editable.
    const d=el('tcDate'); if(d && !d.value) d.value=new Date().toISOString().slice(0,10);
    const t=el('tcTime'); if(t && !t.value){ const now=new Date(); t.value=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'); }
  });
})();
