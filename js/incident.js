// Incident Report
// ---------------------------------------------------------------------------
// Everything is stored on this device only, in IndexedDB rather than
// localStorage: photos are far too big for localStorage's ~5 MB cap, and
// IndexedDB can hold real image Blobs. Nothing is uploaded anywhere — the
// driver sends the report themselves through the phone's share sheet (text
// message, email, etc.), the same pattern Quick Message already uses.
//
// Send options, most to least preferred:
//   1. Share as PDF  — one PDF with the full report and every photo embedded.
//   2. Share Text + Photos — report as text plus the original photos. Works
//      even with no signal at the time of filling out, because it doesn't
//      need the jsPDF library (which loads from a CDN).
//   3. Email Text Only — mailto fallback for browsers with no file sharing.
(function(){
  const DB_NAME='lwh-incidents', STORE='reports', DB_VER=1;
  const CURRENT_KEY='incidentCurrentId';
  const MAX_PHOTOS=12, MAX_EDGE=1600, JPEG_Q=0.8;
  const DISPATCH_EMAIL='Dispatch@Logistics-Warehouse.com';
  const FIELDS=['incType','incDate','incTime','incDriver','incTruck','incTrailer','incLoad','incLocation','incConditions','incDescription','incInjuries','incInjuryDetails','incTowed','incPolice','incPoliceDept','incReportNum','incOtherName','incOtherPhone','incOtherVehicle','incOtherInsurance','incWitnesses','incSignature'];
  const LABELS={incType:'Incident Type',incDate:'Date',incTime:'Time',incDriver:'Driver',incTruck:'Truck #',incTrailer:'Trailer #',incLoad:'Load / BOL #',incLocation:'Location',incConditions:'Weather / Road',incDescription:'What Happened',incInjuries:'Injuries',incInjuryDetails:'Injury Details',incTowed:'Vehicle Towed',incPolice:'Police Called',incPoliceDept:'Police Dept / Officer',incReportNum:'Police Report #',incOtherName:'Other Driver',incOtherPhone:'Other Driver Phone',incOtherVehicle:'Other Vehicle',incOtherInsurance:'Other Insurance',incWitnesses:'Witnesses',incSignature:'Driver Signature'};

  let db=null, current=null, saveTimer=null, thumbUrls=[];
  const el=id=>document.getElementById(id);
  const pad=n=>String(n).padStart(2,'0');
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
  const nowTime=()=>{const d=new Date();return `${pad(d.getHours())}:${pad(d.getMinutes())}`;};

  // ---------- IndexedDB ----------
  function openDb(){
    return new Promise((res,rej)=>{
      if(!('indexedDB' in window)) return rej(new Error('IndexedDB not supported'));
      const r=indexedDB.open(DB_NAME,DB_VER);
      r.onupgradeneeded=()=>{ r.result.createObjectStore(STORE,{keyPath:'id'}); };
      r.onsuccess=()=>res(r.result);
      r.onerror=()=>rej(r.error);
    });
  }
  function tx(mode,fn){
    return new Promise((res,rej)=>{
      const t=db.transaction(STORE,mode); const s=t.objectStore(STORE);
      const out=fn(s);
      t.oncomplete=()=>res(out&&out.result!==undefined?out.result:undefined);
      t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error);
    });
  }
  const dbGet=id=>tx('readonly',s=>s.get(id));
  const dbAll=()=>tx('readonly',s=>s.getAll());
  const dbPut=rec=>tx('readwrite',s=>s.put(rec));
  const dbDel=id=>tx('readwrite',s=>s.delete(id));

  function newReport(){
    return {
      id:'inc-'+Date.now(),
      createdAt:Date.now(), updatedAt:Date.now(), status:'draft', sentAt:null,
      fields:{incType:'Accident / Collision',incDate:today(),incTime:nowTime(),incDriver:(LWHStorage.get('userName','')||''),incInjuries:'No',incTowed:'No',incPolice:'No'},
      photos:[]
    };
  }

  // ---------- Form <-> record ----------
  function fillForm(){
    FIELDS.forEach(id=>{ const n=el(id); if(n) n.value=current.fields[id]||''; });
    if(!current.fields.incType) el('incType').selectedIndex=0;
    toggleConditional();
    renderPhotos();
    renderStatus();
  }
  function readForm(){ FIELDS.forEach(id=>{ const n=el(id); if(n) current.fields[id]=n.value; }); }
  function toggleConditional(){
    el('incInjuryWrap').hidden=el('incInjuries').value==='No';
    el('incPoliceWrap').hidden=el('incPolice').value==='No';
  }
  function scheduleSave(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(saveNow,400);
  }
  async function saveNow(){
    if(!current||!db) return;
    readForm();
    current.updatedAt=Date.now();
    LWHStorage.set(CURRENT_KEY,current.id);
    try{ await dbPut(current); el('incSaveState').textContent='Saved on this device · '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
    catch(e){ el('incSaveState').textContent='Could not save — storage may be full.'; console.error(e); }
    renderSaved();
  }
  function renderStatus(){
    const s=el('incStatusPill');
    if(current.status==='sent'){ s.textContent='Shared '+new Date(current.sentAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); s.style.background='#e3f3e3'; s.style.color='var(--good)'; }
    else { s.textContent='Draft — not sent yet'; s.style.background='#fff3cd'; s.style.color='#4a3800'; }
  }

  // ---------- Photos ----------
  function compress(file){
    return new Promise((res,rej)=>{
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onload=()=>{
        let w=img.naturalWidth,h=img.naturalHeight;
        const scale=Math.min(1,MAX_EDGE/Math.max(w,h));
        w=Math.round(w*scale); h=Math.round(h*scale);
        const c=document.createElement('canvas'); c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        URL.revokeObjectURL(url);
        c.toBlob(b=>b?res({blob:b,w,h}):rej(new Error('Compress failed')),'image/jpeg',JPEG_Q);
      };
      img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('Could not read image')); };
      img.src=url;
    });
  }
  async function addPhotos(fileList){
    const files=[...(fileList||[])].filter(f=>/^image\//.test(f.type));
    if(!files.length) return;
    const room=MAX_PHOTOS-current.photos.length;
    if(room<=0){ LWHUI.toast(`Limit is ${MAX_PHOTOS} photos per report`); return; }
    if(files.length>room) LWHUI.toast(`Only the first ${room} photo(s) added — limit is ${MAX_PHOTOS}`);
    el('incPhotoState').textContent='Processing photos…';
    for(const f of files.slice(0,room)){
      try{
        const {blob,w,h}=await compress(f);
        current.photos.push({id:'p'+Date.now()+Math.random().toString(36).slice(2,6),blob,w,h,takenAt:Date.now()});
      }catch(e){ console.error(e); LWHUI.toast('One photo could not be added'); }
    }
    el('incPhotoState').textContent='';
    renderPhotos();
    saveNow();
  }
  function renderPhotos(){
    thumbUrls.forEach(u=>URL.revokeObjectURL(u)); thumbUrls=[];
    const grid=el('incPhotoGrid');
    el('incPhotoCount').textContent=`${current.photos.length} of ${MAX_PHOTOS}`;
    if(!current.photos.length){ grid.innerHTML='<p class="hint">No photos yet. Get every vehicle, plate, the damage, and the whole scene.</p>'; return; }
    grid.innerHTML=current.photos.map((p,i)=>{
      const u=URL.createObjectURL(p.blob); thumbUrls.push(u);
      return `<div class="inc-thumb"><img src="${u}" alt="Photo ${i+1}" /><span>${i+1}</span><button type="button" class="ghost" data-delphoto="${p.id}" aria-label="Remove photo ${i+1}">Remove</button></div>`;
    }).join('');
  }

  // ---------- Saved list ----------
  async function renderSaved(){
    const list=el('incSavedList'); if(!list||!db) return;
    let all=[]; try{ all=await dbAll(); }catch(e){}
    all.sort((a,b)=>b.updatedAt-a.updatedAt);
    if(!all.length){ list.innerHTML='<p class="hint">No saved reports.</p>'; return; }
    list.innerHTML=all.map(r=>{
      const f=r.fields||{};
      const isCur=current&&r.id===current.id;
      const status=r.status==='sent'?'<span style="color:var(--good);font-weight:700">Shared</span>':'<span style="color:#8a6d00;font-weight:700">Draft</span>';
      return `<div class="dt-entry" style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div><b>${LWHUI.safe(f.incType||'Incident')}</b>${isCur?' <span class="hint">(open)</span>':''}<br><span class="hint">${LWHUI.safe(f.incDate||'')} ${LWHUI.safe(f.incTime||'')} · Truck ${LWHUI.safe(f.incTruck||'—')} · ${r.photos.length} photo(s) · </span>${status}</div>
        <div class="actions" style="margin:0">${isCur?'':`<button type="button" class="ghost" data-openinc="${r.id}">Open</button>`}<button type="button" class="ghost" data-delinc="${r.id}">Delete</button></div>
      </div>`;
    }).join('');
  }

  // ---------- Output builders ----------
  function textSummary(){
    readForm();
    const f=current.fields, lines=['LWH INCIDENT REPORT',''];
    FIELDS.forEach(id=>{
      const v=(f[id]||'').trim(); if(!v) return;
      if(id==='incInjuryDetails'&&f.incInjuries==='No') return;
      if((id==='incPoliceDept'||id==='incReportNum')&&f.incPolice==='No') return;
      lines.push(`${LABELS[id]}: ${v}`);
    });
    lines.push('',`Photos: ${current.photos.length}`,`Report ID: ${current.id}`);
    return lines.join('\n');
  }
  function fileBase(){
    const f=current.fields;
    return `incident-${(f.incDate||today())}-${(f.incTruck||'truck').replace(/[^\w-]+/g,'')}`;
  }
  const blobToDataUrl=b=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(b);});

  async function buildPdf(){
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({unit:'in',format:'letter'});
    const W=8.5,H=11,M=0.6,CW=W-M*2;
    let y=M;
    const f=current.fields;
    const ensure=h=>{ if(y+h>H-M){ doc.addPage(); y=M; } };
    doc.setFont('helvetica','bold'); doc.setFontSize(18);
    doc.text('Logistics Warehouse — Incident Report',M,y+0.2); y+=0.45;
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(90);
    doc.text(`Report ID ${current.id} · Generated ${new Date().toLocaleString()}`,M,y); y+=0.3;
    doc.setTextColor(0);
    const row=(label,val)=>{
      val=String(val||'').trim(); if(!val) return;
      doc.setFontSize(11);
      const wrapped=doc.splitTextToSize(val,CW-1.9);
      ensure(0.2*wrapped.length+0.08);
      doc.setFont('helvetica','bold'); doc.text(label,M,y);
      doc.setFont('helvetica','normal'); doc.text(wrapped,M+1.9,y);
      y+=0.2*wrapped.length+0.08;
    };
    const section=t=>{ ensure(0.5); y+=0.12; doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text(t,M,y); y+=0.08; doc.setDrawColor(190); doc.setLineWidth(0.012); doc.line(M,y,W-M,y); y+=0.24; };
    section('Incident');
    ['incType','incDate','incTime','incLocation','incConditions'].forEach(k=>row(LABELS[k],f[k]));
    section('Driver & Equipment');
    ['incDriver','incTruck','incTrailer','incLoad'].forEach(k=>row(LABELS[k],f[k]));
    section('What Happened');
    doc.setFontSize(11); doc.setFont('helvetica','normal');
    doc.splitTextToSize(f.incDescription||'(no description entered)',CW).forEach(line=>{ ensure(0.2); doc.text(line,M,y); y+=0.2; });
    y+=0.05;
    section('Injuries, Towing & Police');
    row('Injuries',f.incInjuries); if(f.incInjuries!=='No') row('Injury Details',f.incInjuryDetails);
    row('Vehicle Towed',f.incTowed);
    row('Police Called',f.incPolice); if(f.incPolice!=='No'){ row('Dept / Officer',f.incPoliceDept); row('Report #',f.incReportNum); }
    if(['incOtherName','incOtherPhone','incOtherVehicle','incOtherInsurance','incWitnesses'].some(k=>(f[k]||'').trim())){
      section('Other Party & Witnesses');
      ['incOtherName','incOtherPhone','incOtherVehicle','incOtherInsurance','incWitnesses'].forEach(k=>row(LABELS[k],f[k]));
    }
    section('Certification');
    row('Driver Signature',f.incSignature||'(not signed)');
    row('Photos Attached',String(current.photos.length));
    // Photos — two per page, each scaled to fit its half.
    if(current.photos.length){
      const slotH=(H-M*2-0.5)/2;
      for(let i=0;i<current.photos.length;i++){
        if(i%2===0){ doc.addPage(); y=M; doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.text(`Photos — ${current.id}`,M,y+0.1); y+=0.4; }
        const p=current.photos[i];
        const data=await blobToDataUrl(p.blob);
        let w=CW, h=w*(p.h/p.w);
        if(h>slotH-0.3){ h=slotH-0.3; w=h*(p.w/p.h); }
        doc.addImage(data,'JPEG',M+(CW-w)/2,y,w,h);
        doc.setFont('helvetica','normal'); doc.setFontSize(9);
        doc.text(`Photo ${i+1}`,M,y+h+0.18);
        y+=slotH;
      }
    }
    return doc.output('blob');
  }

  async function markShared(){
    current.status='sent'; current.sentAt=Date.now();
    renderStatus(); await saveNow();
  }
  const canShareFiles=files=>!!(navigator.canShare&&navigator.canShare({files}));

  async function sharePdf(){
    await saveNow();
    if(!window.jspdf){
      LWHUI.toast('PDF tool needs signal to load — use Share Text + Photos instead');
      return;
    }
    LWHUI.toast('Building PDF…');
    let blob;
    try{ blob=await buildPdf(); }catch(e){ console.error(e); alert('Could not build the PDF: '+e.message); return; }
    const file=new File([blob],fileBase()+'.pdf',{type:'application/pdf'});
    if(canShareFiles([file])){
      try{ await navigator.share({files:[file],title:'Incident Report',text:`Incident report — ${current.fields.incType||''}, Truck ${current.fields.incTruck||''}`}); await markShared(); LWHUI.toast('Report shared'); }
      catch(e){ if(e.name!=='AbortError') LWHUI.toast('Share failed — try Share Text + Photos'); }
    }else{
      // Desktop / no file sharing: download it and open an email to attach it to.
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=file.name; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);
      location.href=`mailto:${DISPATCH_EMAIL}?subject=${encodeURIComponent('Incident Report — '+(current.fields.incDate||''))}&body=${encodeURIComponent(textSummary()+'\n\n(PDF with photos was downloaded to this device — please attach it.)')}`;
      await markShared();
    }
  }
  async function shareTextPhotos(){
    await saveNow();
    const text=textSummary();
    const files=current.photos.map((p,i)=>new File([p.blob],`${fileBase()}-photo${i+1}.jpg`,{type:'image/jpeg'}));
    if(files.length&&canShareFiles(files)){
      try{ await navigator.share({files,title:'Incident Report',text}); await markShared(); LWHUI.toast('Report shared'); }
      catch(e){ if(e.name!=='AbortError') LWHUI.toast('Share failed'); }
    }else if(navigator.share){
      try{
        await navigator.share({title:'Incident Report',text});
        await markShared();
        if(files.length) LWHUI.toast('Photos could not be attached here — send them separately');
      }catch(e){ if(e.name!=='AbortError') LWHUI.toast('Share failed'); }
    }else{
      emailText();
    }
  }
  async function emailText(){
    await saveNow();
    location.href=`mailto:${DISPATCH_EMAIL}?subject=${encodeURIComponent('Incident Report — '+(current.fields.incDate||''))}&body=${encodeURIComponent(textSummary()+(current.photos.length?'\n\n(Photos to follow separately.)':''))}`;
  }

  // ---------- Init ----------
  async function openReport(id){
    await saveNow();
    const rec=await dbGet(id); if(!rec) return;
    current=rec; LWHStorage.set(CURRENT_KEY,id);
    fillForm(); renderSaved(); window.scrollTo(0,0);
  }
  async function startNew(){
    if(current) await saveNow();
    current=newReport(); fillForm(); await saveNow();
    LWHUI.toast('New report started — previous one is saved below');
  }

  async function init(){
    if(!el('incident')) return;
    try{ db=await openDb(); }
    catch(e){ el('incSaveState').textContent='This browser can\'t save reports on the device — send before leaving this screen.'; console.error(e); }
    const savedId=LWHStorage.get(CURRENT_KEY,null);
    if(db&&savedId){ try{ current=await dbGet(savedId); }catch(e){} }
    if(!current) current=newReport();
    fillForm(); renderSaved();

    FIELDS.forEach(id=>{ const n=el(id); if(n){ n.addEventListener('input',scheduleSave); n.addEventListener('change',()=>{ toggleConditional(); scheduleSave(); }); } });
    el('incCamera').addEventListener('change',e=>{ addPhotos(e.target.files); e.target.value=''; });
    el('incGallery').addEventListener('change',e=>{ addPhotos(e.target.files); e.target.value=''; });
    el('incPhotoGrid').addEventListener('click',e=>{
      const b=e.target.closest('[data-delphoto]'); if(!b) return;
      if(!confirm('Remove this photo?')) return;
      current.photos=current.photos.filter(p=>p.id!==b.dataset.delphoto);
      renderPhotos(); saveNow();
    });
    el('incGps').onclick=()=>{
      if(!navigator.geolocation){ LWHUI.toast('GPS not available'); return; }
      el('incGps').textContent='Locating…';
      navigator.geolocation.getCurrentPosition(pos=>{
        const {latitude:la,longitude:lo}=pos.coords;
        const coords=`${la.toFixed(5)}, ${lo.toFixed(5)} (maps.google.com/?q=${la.toFixed(5)},${lo.toFixed(5)})`;
        const loc=el('incLocation');
        loc.value=loc.value.trim()?loc.value.trim()+' — '+coords:coords;
        el('incGps').textContent='Use My GPS Location'; scheduleSave();
      },()=>{ el('incGps').textContent='Use My GPS Location'; LWHUI.toast('Could not get location — check location permission'); },{enableHighAccuracy:true,timeout:15000});
    };
    el('incNow').onclick=()=>{ el('incDate').value=today(); el('incTime').value=nowTime(); scheduleSave(); };
    el('incSharePdf').onclick=sharePdf;
    el('incShareText').onclick=shareTextPhotos;
    el('incEmail').onclick=emailText;
    el('incNew').onclick=startNew;
    el('incSavedList').addEventListener('click',async e=>{
      const o=e.target.closest('[data-openinc]'); if(o){ openReport(o.dataset.openinc); return; }
      const d=e.target.closest('[data-delinc]'); if(!d) return;
      if(!confirm('Delete this report and its photos from this device? This cannot be undone.')) return;
      await dbDel(d.dataset.delinc);
      if(current&&current.id===d.dataset.delinc){ current=newReport(); fillForm(); await saveNow(); }
      renderSaved(); LWHUI.toast('Report deleted');
    });
  }
  window.addEventListener('load',init);
})();
