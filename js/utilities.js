(function(){
  function el(id){ return document.getElementById(id); }
  function round(n,d){ return Math.round(n*Math.pow(10,d))/Math.pow(10,d); }
  // Tools with dynamically-rendered rows (Distance, Square Footage) register a
  // proper reset function here instead of relying on the generic DOM sweep,
  // which can't cleanly reset rows that were built from JS array state.
  window.LWHToolClear = window.LWHToolClear || {};

  // ---------- Tab switching ----------
  function initTabs(){
    const tabs=el('utilTabs'); if(!tabs) return;
    tabs.addEventListener('click',e=>{
      const b=e.target.closest('[data-util]'); if(!b) return;
      tabs.querySelectorAll('.seg').forEach(s=>s.classList.toggle('active',s===b));
      ['calc','convert','pallet','notepad','message','trailercube','datecalc','loancalc','costperfoot','sqftcalc','rackcap','standards','casecalc','axleweight','margincalc','freightclass','timer','tip','spinner','pwgen','health','revenue','distance','translate'].forEach(name=>{
        const panel=el('util'+name.charAt(0).toUpperCase()+name.slice(1));
        if(panel) panel.hidden=(name!==b.dataset.util);
      });
      if(b.dataset.util!=='scanner') stopScannerCamera();
    });
  }

  // ---------- Clear This Tool (resets whichever calculator is currently open) ----------
  function initClearActiveTool(){
    const btn=el('utilClearActive'); if(!btn) return;
    btn.onclick=()=>{
      const activeSeg=document.querySelector('#utilTabs .seg.active');
      const name=activeSeg?activeSeg.dataset.util:null;
      if(name && window.LWHToolClear[name]){
        window.LWHToolClear[name]();
        LWHUI.toast('Cleared');
        return;
      }
      const panel=name?el('util'+name.charAt(0).toUpperCase()+name.slice(1)):null;
      if(!panel) return;
      panel.querySelectorAll('input,select,textarea').forEach(f=>{
        if(f.type==='checkbox'||f.type==='radio'){ f.checked=f.defaultChecked; }
        else { f.value=f.defaultValue; }
        f.dispatchEvent(new Event('input',{bubbles:true}));
        f.dispatchEvent(new Event('change',{bubbles:true}));
      });
      LWHUI.toast('Cleared');
    };
  }

  // ---------- Calculator (classic four-function, left-to-right like a desk calculator) ----------
  const calc={acc:null,accDisplay:'',op:null,cur:'0',fresh:true,lastExpr:''};
  function opSymbol(op){ return {'+':'+','-':'−','*':'×','/':'÷'}[op]||op; }
  function calcRender(){
    const d=el('calcDisplay'); if(d) d.textContent=calc.cur;
    const e=el('calcExpr');
    if(e) e.textContent = calc.op ? `${calc.accDisplay} ${opSymbol(calc.op)} ${calc.cur}` : (calc.lastExpr||'\u00A0');
  }
  function calcDigit(v){
    if(calc.fresh){ calc.cur=(v==='.')?'0.':v; calc.fresh=false; if(!calc.op) calc.lastExpr=''; }
    else{
      if(v==='.'&&calc.cur.includes('.')) return;
      calc.cur=(calc.cur==='0'&&v!=='.')?v:calc.cur+v;
    }
    calcRender();
  }
  function calcApplyOp(op){
    if(calc.op&&!calc.fresh) calcEquals();
    calc.acc=parseFloat(calc.cur);
    calc.accDisplay=calc.cur;
    calc.op=op;
    calc.fresh=true;
    calcRender();
  }
  function calcEquals(){
    if(calc.op==null||calc.acc==null) return;
    const b=parseFloat(calc.cur);
    let r=calc.acc;
    if(calc.op==='+') r=calc.acc+b;
    else if(calc.op==='-') r=calc.acc-b;
    else if(calc.op==='*') r=calc.acc*b;
    else if(calc.op==='/') r=(b===0)?NaN:calc.acc/b;
    calc.lastExpr=`${calc.accDisplay} ${opSymbol(calc.op)} ${calc.cur} =`;
    calc.cur=String(round(r,8));
    calc.op=null; calc.acc=null; calc.fresh=true;
    calcRender();
  }
  function calcClear(){ calc.acc=null; calc.accDisplay=''; calc.op=null; calc.cur='0'; calc.fresh=true; calc.lastExpr=''; calcRender(); }
  function calcBack(){ calc.cur=calc.cur.length>1?calc.cur.slice(0,-1):'0'; calcRender(); }
  function calcPercent(){ calc.cur=String(round(parseFloat(calc.cur||'0')/100,8)); calcRender(); }
  function initCalc(){
    const grid=document.querySelector('#utilCalc .calc-grid'); if(!grid) return;
    grid.addEventListener('click',e=>{
      const b=e.target.closest('[data-calc]'); if(!b) return;
      const v=b.dataset.calc;
      if(v==='C') calcClear();
      else if(v==='back') calcBack();
      else if(v==='%') calcPercent();
      else if(v==='=') calcEquals();
      else if(['+','-','*','/'].includes(v)) calcApplyOp(v);
      else calcDigit(v);
    });
    window.LWHToolClear.calc=calcClear;
    calcRender();
  }

  // ---------- Unit converter (linked fields — type into any one, others update) ----------
  function initConvert(){
    const kg=el('cvKg'), lb=el('cvLb'), oz=el('cvOz'), inch=el('cvIn'), ft=el('cvFt'), cm=el('cvCm'), m=el('cvM');
    const sqft=el('cvSqft'), sqm=el('cvSqm'), cTemp=el('cvC'), fTemp=el('cvF');
    const gal=el('cvGal'), liter=el('cvLiter'), qt=el('cvQt'), floz=el('cvFloz');
    const lwGal=el('lwGal'), lwDensity=el('lwDensity'), lwLb=el('lwLb');
    if(!kg) return;
    const KG_LB=2.2046226218, IN_CM=2.54, GAL_L=3.785411784, SQM_SQFT=10.7639104167;

    // Weight: kg / lb / oz, any field drives the other two
    kg.addEventListener('input',()=>{ const v=parseFloat(kg.value); if(isNaN(v)){lb.value=oz.value='';return;} const l=v*KG_LB; lb.value=round(l,3); oz.value=round(l*16,2); });
    lb.addEventListener('input',()=>{ const v=parseFloat(lb.value); if(isNaN(v)){kg.value=oz.value='';return;} kg.value=round(v/KG_LB,3); oz.value=round(v*16,2); });
    oz.addEventListener('input',()=>{ const v=parseFloat(oz.value); if(isNaN(v)){kg.value=lb.value='';return;} const l=v/16; kg.value=round(l/KG_LB,3); lb.value=round(l,3); });

    // Length: in / ft / cm / m
    inch.addEventListener('input',()=>{ const v=parseFloat(inch.value); if(isNaN(v)){ft.value=cm.value=m.value='';return;} ft.value=round(v/12,3); cm.value=round(v*IN_CM,3); m.value=round(v*IN_CM/100,4); });
    ft.addEventListener('input',()=>{ const v=parseFloat(ft.value); if(isNaN(v)){inch.value=cm.value=m.value='';return;} inch.value=round(v*12,3); cm.value=round(v*12*IN_CM,3); m.value=round(v*12*IN_CM/100,4); });
    cm.addEventListener('input',()=>{ const v=parseFloat(cm.value); if(isNaN(v)){inch.value=ft.value=m.value='';return;} const i=v/IN_CM; inch.value=round(i,3); ft.value=round(i/12,3); m.value=round(v/100,4); });
    m.addEventListener('input',()=>{ const v=parseFloat(m.value); if(isNaN(v)){inch.value=ft.value=cm.value='';return;} const i=(v*100)/IN_CM; inch.value=round(i,3); ft.value=round(i/12,3); cm.value=round(v*100,3); });

    // Area: sq ft / sq m
    sqft.addEventListener('input',()=>{ const v=parseFloat(sqft.value); if(isNaN(v)){sqm.value='';return;} sqm.value=round(v/SQM_SQFT,3); });
    sqm.addEventListener('input',()=>{ const v=parseFloat(sqm.value); if(isNaN(v)){sqft.value='';return;} sqft.value=round(v*SQM_SQFT,3); });

    // Temperature: C / F
    cTemp.addEventListener('input',()=>{ const v=parseFloat(cTemp.value); if(isNaN(v)){fTemp.value='';return;} fTemp.value=round(v*9/5+32,2); });
    fTemp.addEventListener('input',()=>{ const v=parseFloat(fTemp.value); if(isNaN(v)){cTemp.value='';return;} cTemp.value=round((v-32)*5/9,2); });

    // Volume: gal / L / qt / fl oz
    gal.addEventListener('input',()=>{ const v=parseFloat(gal.value); if(isNaN(v)){liter.value=qt.value=floz.value='';return;} liter.value=round(v*GAL_L,3); qt.value=round(v*4,3); floz.value=round(v*128,2); });
    liter.addEventListener('input',()=>{ const v=parseFloat(liter.value); if(isNaN(v)){gal.value=qt.value=floz.value='';return;} const g=v/GAL_L; gal.value=round(g,3); qt.value=round(g*4,3); floz.value=round(g*128,2); });
    qt.addEventListener('input',()=>{ const v=parseFloat(qt.value); if(isNaN(v)){gal.value=liter.value=floz.value='';return;} const g=v/4; gal.value=round(g,3); liter.value=round(g*GAL_L,3); floz.value=round(v*32,2); });
    floz.addEventListener('input',()=>{ const v=parseFloat(floz.value); if(isNaN(v)){gal.value=liter.value=qt.value='';return;} const g=v/128; gal.value=round(g,3); liter.value=round(g*GAL_L,3); qt.value=round(g*4,3); });

    // Liquid Weight Estimator: gallons × density = pounds (density defaults to water, editable)
    function lwCalc(){
      const g=parseFloat(lwGal.value), d=parseFloat(lwDensity.value);
      if(isNaN(g)||isNaN(d)){ lwLb.value=''; return; }
      lwLb.value=round(g*d,2);
    }
    lwGal.addEventListener('input',lwCalc);
    lwDensity.addEventListener('input',lwCalc);
    lwLb.addEventListener('input',()=>{
      const p=parseFloat(lwLb.value), d=parseFloat(lwDensity.value);
      if(isNaN(p)||isNaN(d)||d===0){ lwGal.value=''; return; }
      lwGal.value=round(p/d,3);
    });
  }

  // ---------- Pallet footprint + Storage Space Estimator ----------
  function initPallet(){
    const len=el('pfLen'), wid=el('pfWid'), sqft=el('pfSqFt'), sqin=el('pfSqIn');
    const count=el('seCount'), stack=el('seStack'), aisle=el('seAisle'), seSqFt=el('seSqFt'), seDetail=el('seDetail');
    const availSqFt=el('seAvailSqFt'), seCapacity=el('seCapacity'), seCapacityDetail=el('seCapacityDetail');
    const rate=el('seRate'), seCost=el('seCost'), seCostDetail=el('seCostDetail');
    if(!len) return;
    const required={len,wid,sqft,sqin,count,stack,aisle,seSqFt,seDetail,availSqFt,seCapacity,seCapacityDetail};
    const missing=Object.keys(required).filter(k=>!required[k]);
    if(missing.length){ console.error('Warehouse Tools: Pallet Footprint is missing expected elements — check for an old cached utilities.js or index.html mismatch:',missing); return; }

    function palletSqFt(){ return ((parseFloat(len.value)||0)*(parseFloat(wid.value)||0))/144; }

    function calcSingleFootprint(){
      const area=(parseFloat(len.value)||0)*(parseFloat(wid.value)||0);
      sqft.textContent=round(area/144,2);
      sqin.textContent=Math.round(area)+' sq in';
    }
    // Forward: pallet count -> estimated sq ft needed.
    // Floor positions = ceil(count / stackHeight) since stacked pallets share a floor position.
    // Total = (positions × single pallet sq ft) inflated by the aisle allowance %.
    function calcStorageSpace(){
      const n=parseFloat(count.value)||0, s=Math.max(1,parseFloat(stack.value)||1), a=parseFloat(aisle.value)||0;
      const pFt=palletSqFt();
      if(!n||!pFt){ seSqFt.textContent='0 sq ft'; seDetail.textContent='—'; calcCost(0); return; }
      const positions=Math.ceil(n/s);
      const base=positions*pFt;
      const total=base*(1+a/100);
      seSqFt.textContent=round(total,0).toLocaleString()+' sq ft';
      seDetail.textContent=`${positions.toLocaleString()} floor position(s) × ${round(pFt,2)} sq ft, +${a}% aisle allowance`;
      calcCost(total);
    }
    function calcCost(totalSqFt){
      if(!rate||!seCost) return;
      const r=parseFloat(rate.value)||0;
      if(!totalSqFt||!r){ seCost.textContent='—'; if(seCostDetail) seCostDetail.textContent='—'; return; }
      const cost=totalSqFt*r;
      seCost.textContent='$'+cost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      if(seCostDetail) seCostDetail.textContent=`${round(totalSqFt,0).toLocaleString()} sq ft × $${r}/sq ft`;
    }
    // Reverse: available sq ft -> how many pallets fit.
    // Back out the aisle allowance first, see how many floor positions fit in what's left,
    // then multiply by stack height for total pallet capacity.
    function calcReverseCapacity(){
      const avail=parseFloat(availSqFt.value)||0, s=Math.max(1,parseFloat(stack.value)||1), a=parseFloat(aisle.value)||0;
      const pFt=palletSqFt();
      if(!avail||!pFt){ seCapacity.textContent='0 pallets'; seCapacityDetail.textContent='—'; calcRevenueVsCost(0,avail); return; }
      const usable=avail/(1+a/100);
      const positions=Math.floor(usable/pFt);
      const capacity=positions*s;
      seCapacity.textContent=capacity.toLocaleString()+' pallets';
      seCapacityDetail.textContent=`${positions.toLocaleString()} floor position(s) × stack of ${s}`;
      calcRevenueVsCost(capacity,avail);
    }
    // Revenue side: capacity × customer fee per pallet/unit per month.
    // Cost side: the same footprint (avail sq ft) × the Rate field above, so both
    // sides of the comparison share one assumed $/sq ft cost basis.
    function calcRevenueVsCost(capacity,avail){
      const feeEl=el('seFeePerPallet'), revOut=el('seRevenue'), costOut=el('seFootprintCost'), profitOut=el('seProfit'), profitDetail=el('seProfitDetail');
      if(!feeEl) return;
      const fee=parseFloat(feeEl.value)||0, r=parseFloat(rate.value)||0;
      if(!capacity||!fee){ revOut.textContent='—'; costOut.textContent='—'; profitOut.textContent='—'; profitDetail.textContent='—'; return; }
      const revenue=capacity*fee;
      const cost=avail*r;
      revOut.textContent='$'+revenue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      costOut.textContent=r?'$'+cost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'Enter a Rate above';
      if(!r){ profitOut.textContent='—'; profitDetail.textContent='Enter a Rate above to compare against cost'; return; }
      const profit=revenue-cost;
      const margin=revenue?(profit/revenue)*100:0;
      profitOut.textContent='$'+profit.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      profitOut.style.color=profit>=0?'var(--good)':'var(--bad)';
      profitDetail.textContent=`${margin.toFixed(0)}% margin — ${capacity.toLocaleString()} pallets × $${fee}/mo`;
    }
    function recalcAll(){ calcSingleFootprint(); calcStorageSpace(); calcReverseCapacity(); }

    len.addEventListener('input',recalcAll); wid.addEventListener('input',recalcAll);
    len.addEventListener('change',recalcAll); wid.addEventListener('change',recalcAll);
    document.querySelectorAll('#utilPallet [data-preset]').forEach(btn=>{
      btn.onclick=()=>{
        const [l,w]=btn.dataset.preset.split(',');
        len.value=l; wid.value=w;
        recalcAll();
      };
    });
    count.addEventListener('input',calcStorageSpace); count.addEventListener('change',calcStorageSpace);
    stack.addEventListener('input',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    stack.addEventListener('change',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    aisle.addEventListener('input',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    aisle.addEventListener('change',()=>{ calcStorageSpace(); calcReverseCapacity(); });
    if(rate){ rate.addEventListener('input',()=>{ calcStorageSpace(); calcReverseCapacity(); }); rate.addEventListener('change',()=>{ calcStorageSpace(); calcReverseCapacity(); }); }
    availSqFt.addEventListener('input',calcReverseCapacity); availSqFt.addEventListener('change',calcReverseCapacity);
    const feeEl=el('seFeePerPallet');
    if(feeEl){ feeEl.addEventListener('input',calcReverseCapacity); feeEl.addEventListener('change',calcReverseCapacity); }

    recalcAll();
  }

  // ---------- Notepad ----------
  function initNotepad(){
    const text=el('notepadText'), copyBtn=el('notepadCopy'), emailBtn=el('notepadEmail'), clearBtn=el('notepadClear'), scanBtn=el('notepadScanBtn');
    if(!text) return;
    text.value=LWHStorage.get('notepadText','');
    text.addEventListener('input',()=>LWHStorage.set('notepadText',text.value));
    if(copyBtn) copyBtn.onclick=()=>{ navigator.clipboard?.writeText(text.value).then(()=>LWHUI.toast('Copied to clipboard')).catch(()=>alert(text.value)); };
    if(emailBtn) emailBtn.onclick=()=>{ const body=encodeURIComponent(text.value||''); location.href=`mailto:?subject=${encodeURIComponent('Warehouse Notes')}&body=${body}`; };
    if(clearBtn) clearBtn.onclick=()=>{ if(confirm('Clear notepad? This cannot be undone.')){ text.value=''; LWHStorage.set('notepadText',''); } };
    if(scanBtn) scanBtn.onclick=()=>{
      if(!window.LWHScanner){ alert('Scanner not available.'); return; }
      LWHScanner.start(value=>{
        text.value=text.value?(text.value+'\n'+value):value;
        LWHStorage.set('notepadText',text.value);
        LWHUI.toast('Added to notes: '+value);
      });
    };
  }

  // ---------- Basic document scanner ----------
  let scanStream=null;
  const scanPagesData=[]; // {canvas}
  let scanLiveTimer=null, scanLiveBusy=false, scanStabilityHistory=[], scanAutoCaptureArmed=false;

  function stopScannerCamera(){
    stopScanLiveDetection();
    if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
    const wrap=el('scanCameraWrap'), openBtn=el('scanCaptureBtn'), closeBtn=el('scanCloseBtn');
    if(wrap) wrap.hidden=true; if(openBtn) openBtn.hidden=false; if(closeBtn) closeBtn.hidden=true;
    document.body.style.overflow='';
  }
  async function openScannerCamera(){
    try{
      scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}}});
      const video=el('scanVideo'); video.srcObject=scanStream;
      try{ await video.play(); }catch(playErr){ /* some browsers auto-play once metadata loads; ignore */ }
      const editWrap=el('scanEditWrap'); if(editWrap) editWrap.hidden=true;
      el('scanCameraWrap').hidden=false; el('scanCaptureBtn').hidden=true; el('scanCloseBtn').hidden=false;
      document.body.style.overflow='hidden';
      startScanLiveDetection();
    }catch(e){ alert('Could not open the camera: '+e.message+'\n\nMake sure the page is served over HTTPS and camera permission is allowed.'); }
  }
  function capturePage(){
    const video=el('scanVideo'); if(!video||!video.videoWidth) return;
    stopScanLiveDetection();
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth; canvas.height=video.videoHeight;
    canvas.getContext('2d').drawImage(video,0,0);
    el('scanCameraWrap').hidden=true;
    document.body.style.overflow='';
    loadImageToScanEditor(canvas);
  }

  // ---------- Live edge detection (camera preview) ----------
  // Runs a lightweight auto-detect pass on the live feed every ~450ms and
  // draws the found outline as an overlay. When it holds steady across a
  // few consecutive checks, it captures on its own — tapping Capture Page
  // always still works too, any time.
  function startScanLiveDetection(){
    stopScanLiveDetection();
    scanStabilityHistory=[]; scanAutoCaptureArmed=false;
    const snapBtn=el('scanSnapBtn'); if(snapBtn) snapBtn.classList.remove('armed');
    scanLiveTimer=setInterval(scanLiveDetectTick,450);
  }
  function stopScanLiveDetection(){
    if(scanLiveTimer){ clearInterval(scanLiveTimer); scanLiveTimer=null; }
    scanStabilityHistory=[]; scanAutoCaptureArmed=false;
    const snapBtn=el('scanSnapBtn'); if(snapBtn) snapBtn.classList.remove('armed');
    const overlay=el('scanLiveOverlay');
    if(overlay) overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
  }
  function scanLiveDetectTick(){
    if(scanLiveBusy||!scanStream) return;
    const video=el('scanVideo'); if(!video||!video.videoWidth||!video.videoHeight) return;
    if(!window.DocAutoDetect||!DocAutoDetect.isReady()){ drawScanDefaultGuide(); return; }
    scanLiveBusy=true;
    try{
      const targetW=420;
      const scale=targetW/video.videoWidth;
      const ds=document.createElement('canvas');
      ds.width=Math.round(video.videoWidth*scale); ds.height=Math.round(video.videoHeight*scale);
      ds.getContext('2d').drawImage(video,0,0,ds.width,ds.height);
      const detected=DocAutoDetect.detectCorners(ds);
      if(detected){
        const norm=detected.map(p=>({x:p.x/ds.width,y:p.y/ds.height}));
        const stable=trackScanStability(norm);
        drawScanLiveOverlay(norm,stable);
        if(stable&&!scanAutoCaptureArmed){
          scanAutoCaptureArmed=true;
          const snapBtn=el('scanSnapBtn'); if(snapBtn) snapBtn.classList.add('armed');
          setTimeout(()=>{ if(scanLiveTimer) capturePage(); },350);
        }
      } else {
        scanStabilityHistory=[];
        if(scanAutoCaptureArmed){ scanAutoCaptureArmed=false; const snapBtn=el('scanSnapBtn'); if(snapBtn) snapBtn.classList.remove('armed'); }
        drawScanDefaultGuide();
      }
    }catch(err){ console.error('Live detect error:',err); }
    finally{ scanLiveBusy=false; }
  }
  function trackScanStability(norm){
    const cx=(norm[0].x+norm[1].x+norm[2].x+norm[3].x)/4;
    const cy=(norm[0].y+norm[1].y+norm[2].y+norm[3].y)/4;
    const area=Math.abs(scanShoelaceArea(norm));
    scanStabilityHistory.push({cx,cy,area});
    if(scanStabilityHistory.length>4) scanStabilityHistory.shift();
    if(scanStabilityHistory.length<4) return false;
    if(area<0.12) return false;
    const spread=arr=>Math.max(...arr)-Math.min(...arr);
    return spread(scanStabilityHistory.map(h=>h.cx))<0.025
        && spread(scanStabilityHistory.map(h=>h.cy))<0.025
        && spread(scanStabilityHistory.map(h=>h.area))<0.06;
  }
  function scanShoelaceArea(pts){
    let sum=0;
    for(let i=0;i<pts.length;i++){ const a=pts[i],b=pts[(i+1)%pts.length]; sum+=a.x*b.y-b.x*a.y; }
    return sum/2;
  }
  // Maps the video's raw frame coords onto its displayed box (object-fit:
  // contain letterboxes rather than crops) so the overlay lines up with what
  // the driver actually sees.
  function scanVideoDisplayRect(){
    const video=el('scanVideo');
    const containerW=video.clientWidth, containerH=video.clientHeight;
    const videoRatio=video.videoWidth/video.videoHeight;
    const containerRatio=containerW/containerH;
    let dispW,dispH,offX,offY;
    if(videoRatio>containerRatio){ dispW=containerW; dispH=containerW/videoRatio; offX=0; offY=(containerH-dispH)/2; }
    else { dispH=containerH; dispW=containerH*videoRatio; offY=0; offX=(containerW-dispW)/2; }
    return {dispW,dispH,offX,offY,containerW,containerH};
  }
  function scanSyncOverlaySize(){
    const canvas=el('scanLiveOverlay'); const rect=scanVideoDisplayRect();
    if(canvas.width!==rect.containerW) canvas.width=rect.containerW;
    if(canvas.height!==rect.containerH) canvas.height=rect.containerH;
    return rect;
  }
  function drawScanDefaultGuide(){
    const canvas=el('scanLiveOverlay'); const rect=scanSyncOverlaySize();
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.setLineDash([8,8]); ctx.strokeStyle='rgba(255,255,255,.7)'; ctx.lineWidth=3;
    const pad=24;
    ctx.strokeRect(rect.offX+pad,rect.offY+pad,rect.dispW-pad*2,rect.dispH-pad*2);
    ctx.setLineDash([]);
  }
  function drawScanLiveOverlay(normPoints,stable){
    const canvas=el('scanLiveOverlay'); const rect=scanSyncOverlaySize();
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const pts=normPoints.map(p=>({x:rect.offX+p.x*rect.dispW,y:rect.offY+p.y*rect.dispH}));
    ctx.strokeStyle=stable?'#1a7a1a':'#0f4a45';
    ctx.fillStyle=stable?'rgba(26,122,26,.18)':'rgba(15,74,69,.18)';
    ctx.lineWidth=stable?4:3;
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y)); ctx.closePath();
    ctx.stroke(); ctx.fill();
  }

  // ---------- Crop / straighten / filter editor ----------
  // Rebuilt from a simple axis-aligned crop rectangle to a full four-corner
  // perspective editor: OpenCV.js auto-detects the document's corners (see
  // js/doc-auto-detect.js) and shows them as draggable handles so a driver
  // can nudge them if lighting or an odd angle threw off the auto-detect.
  // "Use This Scan" then perspective-warps to those corners rather than a
  // plain rectangular crop, which is what actually straightens a page shot
  // at an angle instead of just cropping around it.
  const scanEditor={rawImage:null,rotation:0,filter:'none',processedCanvas:null,scale:1,corners:null,dragIndex:-1};

  // Accepts either a canvas (straight from the camera capture — used as-is,
  // no lossy re-encode) or a data URL string (file uploads, which have no
  // other source to read from).
  function loadImageToScanEditor(src){
    const useDirectly=(source)=>{
      scanEditor.rawImage=source; scanEditor.rotation=0; scanEditor.filter='none';
      document.querySelectorAll('#scanEditWrap [data-filter]').forEach(c=>c.classList.toggle('active',c.dataset.filter==='none'));
      processScanEditorBase();
      resetScanCropCorners();
      renderScanEditor();
      el('scanEditWrap').hidden=false;
    };
    if(src instanceof HTMLCanvasElement){
      useDirectly(src);
      return;
    }
    const img=new Image();
    img.onload=()=>useDirectly(img);
    img.onerror=()=>alert('Could not load that image.');
    img.src=src;
  }
  function processScanEditorBase(){
    const img=scanEditor.rawImage;
    const MAXDIM=2200; // was 1400 in the old manual-crop-only editor; raised since auto-detect accuracy benefits noticeably from more detail, and 2200px is still smooth for interactive dragging on modern phones
    let sw=img.width, sh=img.height;
    const scaleDown=Math.min(1,MAXDIM/Math.max(sw,sh));
    sw=Math.round(sw*scaleDown); sh=Math.round(sh*scaleDown);
    const rotated=document.createElement('canvas');
    const rot=scanEditor.rotation;
    if(rot===90||rot===270){ rotated.width=sh; rotated.height=sw; } else { rotated.width=sw; rotated.height=sh; }
    const rctx=rotated.getContext('2d');
    rctx.save();
    rctx.translate(rotated.width/2,rotated.height/2);
    rctx.rotate(rot*Math.PI/180);
    rctx.drawImage(img,-sw/2,-sh/2,sw,sh);
    rctx.restore();
    if(scanEditor.filter!=='none'){
      const idata=rctx.getImageData(0,0,rotated.width,rotated.height);
      const d=idata.data;
      for(let i=0;i<d.length;i+=4){
        let gray=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
        if(scanEditor.filter==='contrast') gray=(gray-128)*1.55+128+18; // "Sharpen" — grayscale plus a contrast/brightness push so faded text pops
        gray=Math.max(0,Math.min(255,gray));
        d[i]=d[i+1]=d[i+2]=gray;
      }
      rctx.putImageData(idata,0,0);
    }
    scanEditor.processedCanvas=rotated;
  }
  // Auto-detects the document's corners on the processed (rotated/filtered)
  // canvas. If OpenCV isn't warmed up yet, falls back to a default inset box
  // immediately and re-detects once it's ready, so the driver never has to
  // wait on a blank editor.
  function resetScanCropCorners(){
    const pc=scanEditor.processedCanvas, cropCanvas=el('scanCropCanvas');
    const maxW=Math.min(600,pc.width);
    scanEditor.scale=maxW/pc.width;
    cropCanvas.width=maxW;
    cropCanvas.height=Math.round(pc.height*scanEditor.scale);

    const hint=el('scanEditHint');
    const applyDetected=(detected)=>{
      scanEditor.corners=detected
        ? DocAutoDetect.clampCorners(detected,pc.width,pc.height)
        : DocAutoDetect.defaultCorners(pc.width,pc.height);
      if(hint) hint.textContent=detected
        ? 'Edges found — drag any corner if it needs adjusting.'
        : "Couldn't find clean edges automatically — drag the corners to match the document.";
      renderScanEditor();
    };

    if(window.DocAutoDetect && DocAutoDetect.isReady()){
      let detected=null;
      try{ detected=DocAutoDetect.detectCorners(pc); }catch(err){ console.error('Detection failed',err); }
      applyDetected(detected);
    } else {
      scanEditor.corners=window.DocAutoDetect ? DocAutoDetect.defaultCorners(pc.width,pc.height) : [
        {x:pc.width*0.06,y:pc.height*0.06},{x:pc.width*0.94,y:pc.height*0.06},
        {x:pc.width*0.94,y:pc.height*0.94},{x:pc.width*0.06,y:pc.height*0.94}
      ];
      if(hint) hint.textContent='Finding the document edges…';
      if(window.DocAutoDetect){
        DocAutoDetect.whenReady(()=>{
          if(scanEditor.processedCanvas!==pc) return; // a newer page was loaded meanwhile
          let detected=null;
          try{ detected=DocAutoDetect.detectCorners(pc); }catch(err){ console.error('Detection failed',err); }
          applyDetected(detected);
        });
      }
    }
  }
  function redetectScanCropCorners(){
    const pc=scanEditor.processedCanvas; if(!pc) return;
    const hint=el('scanEditHint'); if(hint) hint.textContent='Re-scanning…';
    if(!window.DocAutoDetect||!DocAutoDetect.isReady()){ if(hint) hint.textContent="Still loading the edge-detection engine — try again in a moment."; return; }
    let detected=null;
    try{ detected=DocAutoDetect.detectCorners(pc); }catch(err){ console.error('Detection failed',err); }
    scanEditor.corners=detected
      ? DocAutoDetect.clampCorners(detected,pc.width,pc.height)
      : DocAutoDetect.defaultCorners(pc.width,pc.height);
    if(hint) hint.textContent=detected
      ? 'Edges found — drag any corner if it needs adjusting.'
      : "Still couldn't find clean edges — drag the corners to match the document.";
    renderScanEditor();
    LWHUI.toast && LWHUI.toast(detected ? 'Edges re-scanned' : 'No clean edges found — adjust manually');
  }
  function renderScanEditor(){
    const cropCanvas=el('scanCropCanvas'); if(!cropCanvas) return;
    const cropCtx=cropCanvas.getContext('2d');
    cropCtx.clearRect(0,0,cropCanvas.width,cropCanvas.height);
    cropCtx.drawImage(scanEditor.processedCanvas,0,0,cropCanvas.width,cropCanvas.height);
    if(!scanEditor.corners) return;
    const disp=scanEditor.corners.map(p=>({x:p.x*scanEditor.scale,y:p.y*scanEditor.scale}));
    cropCtx.strokeStyle='#0f4a45'; cropCtx.lineWidth=3;
    cropCtx.beginPath(); cropCtx.moveTo(disp[0].x,disp[0].y); disp.slice(1).forEach(p=>cropCtx.lineTo(p.x,p.y)); cropCtx.closePath();
    cropCtx.stroke();
    cropCtx.fillStyle='rgba(15,74,69,.14)'; cropCtx.fill();
    disp.forEach(p=>{
      cropCtx.beginPath(); cropCtx.arc(p.x,p.y,14,0,Math.PI*2); cropCtx.fillStyle='#ffffff'; cropCtx.fill();
      cropCtx.lineWidth=3; cropCtx.strokeStyle='#0f4a45'; cropCtx.stroke();
    });
  }
  function scanCanvasPoint(e){
    const cropCanvas=el('scanCropCanvas');
    const rect=cropCanvas.getBoundingClientRect();
    const cx=(e.touches?e.touches[0].clientX:e.clientX)-rect.left;
    const cy=(e.touches?e.touches[0].clientY:e.clientY)-rect.top;
    return {x:cx*(cropCanvas.width/rect.width), y:cy*(cropCanvas.height/rect.height)};
  }
  function scanPointerDown(e){
    if(!scanEditor.corners) return;
    const p=scanCanvasPoint(e);
    let closest=-1, closestDist=Infinity;
    scanEditor.corners.forEach((c,i)=>{
      const d=Math.hypot(c.x*scanEditor.scale-p.x, c.y*scanEditor.scale-p.y);
      if(d<closestDist){ closestDist=d; closest=i; }
    });
    if(closestDist<40){ scanEditor.dragIndex=closest; e.preventDefault(); scanUpdateLoupe(p); }
  }
  function scanPointerMove(e){
    if(scanEditor.dragIndex===-1) return;
    e.preventDefault();
    const p=scanCanvasPoint(e);
    const pc=scanEditor.processedCanvas;
    scanEditor.corners[scanEditor.dragIndex]={
      x:Math.min(Math.max(p.x/scanEditor.scale,0),pc.width),
      y:Math.min(Math.max(p.y/scanEditor.scale,0),pc.height)
    };
    renderScanEditor();
    scanUpdateLoupe(p);
  }
  function scanPointerUp(){
    scanEditor.dragIndex=-1;
    const loupe=el('scanCropLoupe'); if(loupe) loupe.hidden=true;
  }
  // Zoomed circular preview above the fingertip while dragging a corner —
  // a fingertip covers far more screen than the pixel accuracy a perspective
  // warp actually needs, and this closes that gap. Same trick as most phone
  // scanner apps.
  function scanUpdateLoupe(displayPoint){
    const loupe=el('scanCropLoupe'); const wrap=el('scanCropCanvas').parentElement; const canvas=el('scanCropCanvas');
    if(!loupe||!wrap||!canvas) return;
    const ZOOM=3; const SRC_SIZE=loupe.width/ZOOM;
    const ctx=loupe.getContext('2d');
    ctx.clearRect(0,0,loupe.width,loupe.height);
    ctx.save();
    ctx.beginPath(); ctx.arc(loupe.width/2,loupe.height/2,loupe.width/2,0,Math.PI*2); ctx.clip();
    const sx=Math.max(0,Math.min(canvas.width-SRC_SIZE,displayPoint.x-SRC_SIZE/2));
    const sy=Math.max(0,Math.min(canvas.height-SRC_SIZE,displayPoint.y-SRC_SIZE/2));
    ctx.drawImage(canvas,sx,sy,SRC_SIZE,SRC_SIZE,0,0,loupe.width,loupe.height);
    ctx.strokeStyle='#0f4a45'; ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(loupe.width/2-12,loupe.height/2); ctx.lineTo(loupe.width/2+12,loupe.height/2);
    ctx.moveTo(loupe.width/2,loupe.height/2-12); ctx.lineTo(loupe.width/2,loupe.height/2+12);
    ctx.stroke();
    ctx.restore();
    const wrapRect=wrap.getBoundingClientRect(); const canvasRect=canvas.getBoundingClientRect();
    const offX=canvasRect.left-wrapRect.left, offY=canvasRect.top-wrapRect.top;
    let left=offX+displayPoint.x-loupe.width/2;
    let top=offY+displayPoint.y-loupe.height-30;
    if(top<0) top=offY+displayPoint.y+30;
    loupe.style.left=left+'px'; loupe.style.top=top+'px';
    loupe.hidden=false;
  }

  function useScanCrop(){
    if(!window.DocAutoDetect || !scanEditor.corners){
      LWHUI.toast && LWHUI.toast('Edge detection not ready — try again in a moment.');
      return;
    }
    const out=DocAutoDetect.warpToCanvas(scanEditor.processedCanvas, scanEditor.corners);
    scanPagesData.push({canvas:out});
    el('scanEditWrap').hidden=true;
    renderScanPages();
    // Keep multi-page capture fast: if the camera's still live, jump straight
    // back to it for the next page instead of making the driver tap Open Camera again.
    if(scanStream){ el('scanCameraWrap').hidden=false; document.body.style.overflow='hidden'; startScanLiveDetection(); } else { el('scanCaptureBtn').hidden=false; }
  }
  function retakeScan(){
    el('scanEditWrap').hidden=true;
    if(scanStream){ el('scanCameraWrap').hidden=false; document.body.style.overflow='hidden'; startScanLiveDetection(); } else { el('scanCaptureBtn').hidden=false; }
  }
  function renderScanPages(){
    const wrap=el('scanPages'); if(!wrap) return;
    wrap.innerHTML='';
    scanPagesData.forEach((p,i)=>{
      const div=document.createElement('div'); div.className='cust-field scan-page';
      const img=document.createElement('img'); img.src=p.canvas.toDataURL('image/jpeg',0.9); img.className='scan-thumb';
      div.append(img);
      const label=document.createElement('div'); label.innerHTML=`<b>Page ${i+1}</b>`; div.append(label);
      const actions=document.createElement('div'); actions.className='actions';
      const upBtn=document.createElement('button'); upBtn.type='button'; upBtn.className='ghost'; upBtn.textContent='↑ Move Up'; upBtn.disabled=(i===0);
      upBtn.onclick=()=>{ [scanPagesData[i-1],scanPagesData[i]]=[scanPagesData[i],scanPagesData[i-1]]; renderScanPages(); };
      const downBtn=document.createElement('button'); downBtn.type='button'; downBtn.className='ghost'; downBtn.textContent='↓ Move Down'; downBtn.disabled=(i===scanPagesData.length-1);
      downBtn.onclick=()=>{ [scanPagesData[i+1],scanPagesData[i]]=[scanPagesData[i],scanPagesData[i+1]]; renderScanPages(); };
      const ocrBtn=document.createElement('button'); ocrBtn.type='button'; ocrBtn.className='ghost';
      ocrBtn.textContent=p.ocrRunning?'Extracting…':'Extract Text';
      ocrBtn.disabled=!!p.ocrRunning;
      ocrBtn.onclick=()=>extractText(p);
      const removeBtn=document.createElement('button'); removeBtn.type='button'; removeBtn.className='ghost'; removeBtn.textContent='Remove';
      removeBtn.onclick=()=>{ scanPagesData.splice(i,1); renderScanPages(); };
      actions.append(upBtn,downBtn,ocrBtn,removeBtn);
      div.append(actions);
      if(p.ocrText!=null){
        const ta=document.createElement('textarea'); ta.rows=4; ta.style.marginTop='8px'; ta.value=p.ocrText;
        ta.placeholder='Extracted text — edit to fix any misreads before copying';
        ta.addEventListener('input',()=>{ p.ocrText=ta.value; });
        div.append(ta);
        const copyBtn=document.createElement('button'); copyBtn.type='button'; copyBtn.className='ghost'; copyBtn.style.marginTop='6px';
        copyBtn.textContent='Copy Text';
        copyBtn.onclick=()=>{ navigator.clipboard?.writeText(ta.value).then(()=>LWHUI.toast('Text copied')).catch(()=>alert(ta.value)); };
        div.append(copyBtn);
      }
      wrap.append(div);
    });
    const bulk=el('scanBulkActions'); if(bulk) bulk.hidden=!scanPagesData.length;
  }
  // Runs entirely in the browser via WebAssembly (Tesseract.js) rather than
  // any OS-level camera text detection — that's deliberate, since iOS Safari
  // never implemented the browser text-detection APIs Android's Chrome has,
  // so relying on those would only ever work on Android. This approach reads
  // printed text the same way on both platforms. First run on a page loads
  // the OCR engine/language data over the network, so it's a bit slower than
  // subsequent runs in the same session.
  async function extractText(p){
    if(!window.Tesseract){ alert('Text extraction library failed to load — check your internet connection.'); return; }
    p.ocrRunning=true; renderScanPages();
    try{
      const { data }=await Tesseract.recognize(p.canvas,'eng');
      p.ocrText=(data&&data.text||'').trim()||'(No text found — try Enhance first, or retake with better lighting/focus.)';
    }catch(e){
      p.ocrText='Text extraction failed: '+e.message;
    }
    p.ocrRunning=false;
    renderScanPages();
    LWHUI.toast('Text extracted — review and Copy Text');
  }
  function canvasToFile(canvas,name){
    return new Promise(resolve=>canvas.toBlob(blob=>resolve(new File([blob],name,{type:'image/jpeg'})),'image/jpeg',0.9));
  }
  async function shareAllPages(){
    if(!scanPagesData.length) return;
    const files=await Promise.all(scanPagesData.map((p,i)=>canvasToFile(p.canvas,`page-${i+1}.jpg`)));
    if(navigator.canShare && navigator.canShare({files})){
      try{ await navigator.share({files,title:'Scanned Document'}); }
      catch(e){ /* user cancelled share sheet — not an error */ }
    } else {
      files.forEach(f=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(f); a.download=f.name; document.body.append(a); a.click(); a.remove(); });
      LWHUI.toast('Sharing not supported on this browser — downloaded instead');
    }
  }
  // Combines every captured page into one real, multi-page PDF — each photo
  // scaled to fit a letter-size page, centered, preserving its aspect ratio.
  // Good for handing off something like a signed Bill of Lading as one file
  // instead of a pile of separate photos.
  function downloadAsPdf(){
    if(!scanPagesData.length){ LWHUI.toast('No pages captured yet'); return; }
    if(!window.jspdf){ alert('The PDF library failed to load — check your internet connection. Share All Pages still works as an alternative.'); return; }
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({unit:'in',format:'letter'});
    const pageW=8.5, pageH=11, margin=0.4;
    const maxW=pageW-margin*2, maxH=pageH-margin*2;
    scanPagesData.forEach((p,i)=>{
      if(i>0) doc.addPage();
      const imgData=p.canvas.toDataURL('image/jpeg',0.9);
      const ratio=p.canvas.width/p.canvas.height;
      let w=maxW, h=w/ratio;
      if(h>maxH){ h=maxH; w=h*ratio; }
      doc.addImage(imgData,'JPEG',(pageW-w)/2,(pageH-h)/2,w,h);
    });
    const nameEl=el('scanPdfName');
    let filename=(nameEl&&nameEl.value.trim())||'';
    filename=filename.replace(/[^a-z0-9\-_ ]/gi,'').trim()||'scanned-document';
    doc.save(filename+'.pdf');
    LWHUI.toast('PDF downloaded');
  }
  function initScanner(){
    const openBtn=el('scanCaptureBtn'); if(!openBtn) return;
    openBtn.onclick=openScannerCamera;
    el('scanCloseBtn').onclick=stopScannerCamera;
    el('scanSnapBtn').onclick=capturePage;
    el('scanShareAll').onclick=shareAllPages;
    const pdfBtn=el('scanDownloadPdf'); if(pdfBtn) pdfBtn.onclick=downloadAsPdf;
    el('scanClearAll').onclick=()=>{ scanPagesData.length=0; renderScanPages(); };
    window.LWHToolClear.scanner=()=>{
      scanPagesData.length=0; renderScanPages();
      const editWrap=el('scanEditWrap'); if(editWrap) editWrap.hidden=true;
      stopScannerCamera();
    };

    const uploadBtn=el('scanUploadBtn'), fileInput=el('scanFileInput');
    if(uploadBtn&&fileInput){
      uploadBtn.onclick=()=>fileInput.click();
      fileInput.addEventListener('change',e=>{
        const file=e.target.files[0]; if(!file) return;
        const reader=new FileReader();
        reader.onload=()=>loadImageToScanEditor(reader.result);
        reader.readAsDataURL(file);
        e.target.value='';
      });
    }

    const cropCanvas=el('scanCropCanvas');
    if(cropCanvas){
      cropCanvas.addEventListener('pointerdown',scanPointerDown);
      cropCanvas.addEventListener('pointermove',scanPointerMove);
      window.addEventListener('pointerup',scanPointerUp);
    }
    const redetectBtn=el('scanRedetectBtn');
    if(redetectBtn) redetectBtn.onclick=redetectScanCropCorners;
    const rotateBtn=el('scanRotateBtn');
    if(rotateBtn) rotateBtn.onclick=()=>{
      scanEditor.rotation=(scanEditor.rotation+90)%360;
      processScanEditorBase();
      resetScanCropCorners();
      renderScanEditor();
    };
    document.querySelectorAll('#scanEditWrap [data-filter]').forEach(chip=>{
      chip.addEventListener('click',()=>{
        scanEditor.filter=chip.dataset.filter;
        document.querySelectorAll('#scanEditWrap [data-filter]').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
        processScanEditorBase();
        renderScanEditor();
      });
    });
    const useBtn=el('scanUseCropBtn'); if(useBtn) useBtn.onclick=useScanCrop;
    const retakeBtn=el('scanRetakeBtn'); if(retakeBtn) retakeBtn.onclick=retakeScan;
  }


  // ---------- Ad-hoc QR/Barcode generator ----------
  function initGenerate(){
    const text=el('genText'), tabs=el('genTypeTabs'), qrBox=el('genQrBox'), barcodeSvg=el('genBarcodeSvg'), label=el('genTextLabel'), shareBtn=el('genShareBtn'), downloadBtn=el('genDownloadBtn'), printBtn=el('genPrintBtn'), printOutput=el('genPrintOutput');
    if(!text) return;
    let mode='qr';
    function render(){
      const v=text.value.trim();
      label.textContent=v;
      if(mode==='qr'){
        qrBox.style.display=''; barcodeSvg.style.display='none';
        qrBox.innerHTML='';
        if(v && window.LWHQR) LWHQR.make(qrBox,v,220);
      } else {
        qrBox.style.display='none'; barcodeSvg.style.display='inline-block';
        barcodeSvg.innerHTML='';
        if(v && window.LWHBarcode){ try{ LWHBarcode.make(barcodeSvg,v,{height:100,width:3}); }catch(e){ barcodeSvg.outerHTML='<div class="hint">Could not generate a barcode for that text.</div>'; } }
      }
    }
    text.addEventListener('input',render);
    if(tabs) tabs.addEventListener('click',e=>{
      const b=e.target.closest('[data-gentype]'); if(!b) return;
      tabs.querySelectorAll('.seg').forEach(s=>s.classList.toggle('active',s===b));
      mode=b.dataset.gentype;
      render();
    });
    render();

    // Converts whichever code is currently shown (QR canvas, or 1D barcode SVG)
    // into a PNG so it can go through the same native share sheet already
    // used elsewhere in the app — codes are visual, not text, so the normal
    // clipboard/mailto tricks don't apply here.
    function currentOutputAsBlob(){
      if(mode==='qr'){
        const canvas=qrBox.querySelector('canvas');
        if(canvas) return new Promise(res=>canvas.toBlob(res,'image/png'));
        const img=qrBox.querySelector('img');
        if(img) return fetch(img.src).then(r=>r.blob());
        return Promise.resolve(null);
      }
      if(!barcodeSvg.querySelector('rect,path,g')) return Promise.resolve(null);
      const svgData=new XMLSerializer().serializeToString(barcodeSvg);
      const svgUrl=URL.createObjectURL(new Blob([svgData],{type:'image/svg+xml;charset=utf-8'}));
      return new Promise((resolve)=>{
        const img=new Image();
        img.onload=()=>{
          const canvas=document.createElement('canvas');
          canvas.width=barcodeSvg.clientWidth||400; canvas.height=barcodeSvg.clientHeight||150;
          const ctx=canvas.getContext('2d');
          ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          URL.revokeObjectURL(svgUrl);
          canvas.toBlob(blob=>resolve(blob),'image/png');
        };
        img.onerror=()=>resolve(null);
        img.src=svgUrl;
      });
    }
    if(shareBtn) shareBtn.onclick=async()=>{
      const blob=await currentOutputAsBlob();
      if(!blob){ alert('Type something first to generate a code.'); return; }
      const file=new File([blob],(mode==='qr'?'qr-code.png':'barcode.png'),{type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        try{ await navigator.share({files:[file],title:text.value||'Code'}); }catch(e){ /* user cancelled */ }
      } else {
        const a=document.createElement('a'); a.href=URL.createObjectURL(file); a.download=file.name; document.body.append(a); a.click(); a.remove();
        LWHUI.toast('Sharing not supported here — downloaded instead');
      }
    };
    if(downloadBtn) downloadBtn.onclick=async()=>{
      const blob=await currentOutputAsBlob();
      if(!blob){ alert('Type something first to generate a code.'); return; }
      const file=new File([blob],(mode==='qr'?'qr-code.png':'barcode.png'),{type:'image/png'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(file); a.download=file.name; document.body.append(a); a.click(); a.remove();
      LWHUI.toast('Downloaded');
    };
    if(printBtn) printBtn.onclick=()=>{
      const v=text.value.trim();
      if(!v){ alert('Type something first to generate a code.'); return; }
      if(!printOutput || !window.LWHLabels){ return; }
      printOutput.innerHTML='';
      const escaped=v.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
      // Same layout as the 4x6 Rack Labels: large bordered auto-fit text box on
      // top, code underneath — reusing those exact classes/helpers so this
      // stays visually and behaviorally consistent with Rack Labels.
      const codeHtml = mode==='qr'
        ? `<div class="qrbox" data-qr="${v.replace(/"/g,'&quot;')}" data-size="126"></div>`
        : `<div class="barcode-wrap"><svg data-barcode="${v.replace(/"/g,'&quot;')}" data-height="105" data-width="3"></svg><div class="barcode-text">${escaped}</div></div>`;
      const html = `<div class="rack-title">${escaped}</div><div class="rack-code-row" style="justify-content:center">${codeHtml}</div>`;
      const pageEl=document.createElement('div');
      pageEl.className='label-page rack-label rack-normal';
      pageEl.innerHTML=html;
      printOutput.append(pageEl);
      // finishBarcodes lives in labels.js and turns the data-qr/data-barcode
      // placeholders above into the actual rendered code — same helper every
      // other printable label in the app already uses.
      if(window.finishBarcodes) finishBarcodes(printOutput);
      if(window.autoFitRackTitles) autoFitRackTitles(printOutput);
      if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(6,4);
      LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+1);
      setTimeout(()=>window.print(),50);
    };
  }

  // ---------- Scan Code (dedicated barcode/QR reader, separate from the generator) ----------
  function looksLikeUrl(v){ return /^(https?:\/\/|www\.)\S+$/i.test(v.trim()); }
  function toHref(v){ v=v.trim(); return /^https?:\/\//i.test(v) ? v : 'https://'+v; }
  function renderScanResult(el,value){
    if(looksLikeUrl(value)){
      const a=document.createElement('a');
      a.href=toHref(value); a.target='_blank'; a.rel='noopener noreferrer';
      a.textContent=value;
      el.innerHTML=''; el.append(a);
    } else {
      el.textContent=value;
    }
  }
  function initScanCode(){
    const btn=el('scReadBtn'), resultCard=el('scResultCard'), resultText=el('scResultText');
    const copyBtn=el('scCopyBtn'), notesBtn=el('scNotesBtn'), emailBtn=el('scEmailBtn');
    if(!btn) return;
    let lastValue='';
    btn.onclick=()=>{
      if(!window.LWHScanner){ alert('Scanner not available.'); return; }
      LWHScanner.start(value=>{
        lastValue=value;
        renderScanResult(resultText,value);
        resultCard.hidden=false;
      });
    };
    if(copyBtn) copyBtn.onclick=()=>{ if(!lastValue) return; navigator.clipboard?.writeText(lastValue).then(()=>LWHUI.toast('Copied: '+lastValue)).catch(()=>{}); };
    if(notesBtn) notesBtn.onclick=()=>{
      if(!lastValue) return;
      const text=el('notepadText');
      if(text){ text.value=text.value?(text.value+'\n'+lastValue):lastValue; LWHStorage.set('notepadText',text.value); LWHUI.toast('Added to notes'); }
    };
    if(emailBtn) emailBtn.onclick=()=>{ if(!lastValue) return; location.href=`mailto:?subject=${encodeURIComponent('Scanned Code')}&body=${encodeURIComponent(lastValue)}`; };
  }

  // ---------- Quick Message (mailto for text-only; Web Share when a photo is attached) ----------
  let qmPhotoFile=null;
  function refreshQuickMessageManagers(){
    const sel=el('qmManager'); if(!sel) return;
    const managers=LWHStorage.get('managers',[]);
    const current=sel.value;
    sel.innerHTML=managers.length
      ? managers.map(m=>`<option value="${String(m.email||'').replace(/"/g,'&quot;')}">${String(m.name||m.email||'Unnamed').replace(/</g,'&lt;')}</option>`).join('')
      : '<option value="">No managers added yet — add in Settings</option>';
    if(current) sel.value=current;
  }
  window.refreshQuickMessageManagers=refreshQuickMessageManagers; // Settings calls this after adding/editing/removing a manager

  function initMessage(){
    const sel=el('qmManager'), msg=el('qmMessage'), photoInput=el('qmPhoto'), previewWrap=el('qmPhotoPreviewWrap'), preview=el('qmPhotoPreview'), removeBtn=el('qmPhotoRemove'), sendBtn=el('qmSendBtn');
    if(!sel) return;
    refreshQuickMessageManagers();
    if(photoInput) photoInput.addEventListener('change',()=>{
      const f=photoInput.files&&photoInput.files[0];
      if(!f){ qmPhotoFile=null; previewWrap.hidden=true; return; }
      qmPhotoFile=f;
      const reader=new FileReader();
      reader.onload=()=>{ preview.src=reader.result; previewWrap.hidden=false; };
      reader.readAsDataURL(f);
    });
    if(removeBtn) removeBtn.onclick=()=>{ qmPhotoFile=null; if(photoInput) photoInput.value=''; previewWrap.hidden=true; };
    if(sendBtn) sendBtn.onclick=async()=>{
      const managers=LWHStorage.get('managers',[]);
      const chosen=managers.find(m=>m.email===sel.value) || {name:'',email:sel.value};
      if(!chosen.email){ alert('Add a manager with an email in Settings first.'); return; }
      const text=(msg.value||'').trim();
      if(!text){ alert('Type a quick message first.'); return; }
      if(qmPhotoFile){
        if(navigator.canShare && navigator.canShare({files:[qmPhotoFile]})){
          try{ await navigator.share({files:[qmPhotoFile],title:'Warehouse Alert',text:`To: ${chosen.name||chosen.email} <${chosen.email}>\n\n${text}`}); }
          catch(e){ /* user cancelled — not an error */ }
        } else {
          // No file-sharing support here — download the photo and open mailto so it can be attached manually.
          const a=document.createElement('a'); a.href=URL.createObjectURL(qmPhotoFile); a.download='warehouse-photo.jpg'; document.body.append(a); a.click(); a.remove();
          location.href=`mailto:${encodeURIComponent(chosen.email)}?subject=${encodeURIComponent('Warehouse Alert')}&body=${encodeURIComponent(text+'\n\n(Photo downloaded separately to your device — please attach it to this email.)')}`;
        }
      } else {
        location.href=`mailto:${encodeURIComponent(chosen.email)}?subject=${encodeURIComponent('Warehouse Alert')}&body=${encodeURIComponent(text)}`;
      }
    };
  }

  // ---------- Trailer Cube estimator ----------
  // Rectangular-packing estimate: picks whichever floor orientation (unit as-is,
  // or rotated 90°) fits more units per layer, multiplies by how many layers
  // stack within trailer height, and separately checks whether the trailer's
  // weight limit caps the count below what cube alone would allow — reporting
  // whichever constraint is actually the limiting factor.
  function initTrailerCube(){
    const profileSel=el('tcubeProfile'), profileName=el('tcubeProfileName'), saveBtn=el('tcubeSaveProfile'), delBtn=el('tcubeDeleteProfile');
    const len=el('tcubeLen'), wid=el('tcubeWid'), ht=el('tcubeHt'), weight=el('tcubeWeight');
    const trLen=el('tcubeTrLen'), trWid=el('tcubeTrWid'), trHt=el('tcubeTrHt'), trWeight=el('tcubeTrWeight');
    const result=el('tcubeResult'), detail=el('tcubeDetail');
    if(!len) return;

    function loadProfiles(){ return LWHStorage.get('trailerCubeProfiles',[]); }
    function saveProfiles(list){ LWHStorage.set('trailerCubeProfiles',list); }
    function refreshProfileSelect(){
      const profiles=loadProfiles();
      const current=profileSel.value;
      profileSel.innerHTML='<option value="">— Custom (not saved) —</option>'+profiles.map((p,i)=>`<option value="${i}">${String(p.name||'Unnamed').replace(/</g,'&lt;')}</option>`).join('');
      if(current) profileSel.value=current;
    }
    refreshProfileSelect();

    profileSel.addEventListener('change',()=>{
      const idx=profileSel.value; if(idx==='') return;
      const p=loadProfiles()[idx]; if(!p) return;
      len.value=p.len||''; wid.value=p.wid||''; ht.value=p.ht||''; weight.value=p.weight||'';
      profileName.value=p.name||'';
      calc();
    });

    saveBtn.onclick=()=>{
      const name=(profileName.value||'').trim();
      if(!name){ alert('Give this profile a name first.'); return; }
      const profiles=loadProfiles();
      const existingIdx=profiles.findIndex(p=>String(p.name||'').toLowerCase()===name.toLowerCase());
      const entry={name,len:len.value,wid:wid.value,ht:ht.value,weight:weight.value};
      if(existingIdx>-1) profiles[existingIdx]=entry; else profiles.push(entry);
      saveProfiles(profiles);
      refreshProfileSelect();
      profileSel.value=profiles.findIndex(p=>p.name===name);
      LWHUI.toast('Profile saved: '+name);
    };
    delBtn.onclick=()=>{
      const idx=profileSel.value;
      if(idx===''){ alert('Select a saved profile to delete first.'); return; }
      const profiles=loadProfiles();
      const removed=profiles.splice(+idx,1);
      saveProfiles(profiles);
      refreshProfileSelect();
      LWHUI.toast('Profile deleted'+(removed[0]?': '+removed[0].name:''));
    };

    function calc(){
      const uL=parseFloat(len.value)||0, uW=parseFloat(wid.value)||0, uH=parseFloat(ht.value)||0, uWt=parseFloat(weight.value)||0;
      const tL=parseFloat(trLen.value)||630, tW=parseFloat(trWid.value)||98, tH=parseFloat(trHt.value)||110, tWt=parseFloat(trWeight.value)||44000;
      if(!uL||!uW){ result.textContent='0'; detail.textContent='Enter unit length and width.'; return; }
      const perLayerA=Math.floor(tW/uW)*Math.floor(tL/uL);
      const perLayerB=Math.floor(tW/uL)*Math.floor(tL/uW);
      const rotated=perLayerB>perLayerA;
      const across=rotated?Math.floor(tW/uL):Math.floor(tW/uW);
      const along=rotated?Math.floor(tL/uW):Math.floor(tL/uL);
      const perLayer=Math.max(perLayerA,perLayerB);
      const layers=uH>0?Math.max(1,Math.floor(tH/uH)):1;
      const cubeUnits=perLayer*layers;
      let weightUnits=null, weightLimited=false;
      if(uWt>0 && tWt>0){ weightUnits=Math.floor(tWt/uWt); weightLimited=weightUnits<cubeUnits; }
      const finalUnits=weightUnits!==null?Math.min(cubeUnits,weightUnits):cubeUnits;
      result.textContent=finalUnits.toLocaleString();
      let text=`${across} across × ${along} deep${rotated?' (unit rotated 90°)':''}, ${layers} layer(s) high = ${cubeUnits.toLocaleString()} by cube`;
      if(weightUnits!==null) text+=` · ${weightUnits.toLocaleString()} by weight (${tWt.toLocaleString()} lb ÷ ${uWt.toLocaleString()} lb/unit)${weightLimited?' — weight is the limiting factor':' — cube is the limiting factor'}`;
      detail.textContent=text;
    }
    [len,wid,ht,weight,trLen,trWid,trHt,trWeight].forEach(f=>f.addEventListener('input',calc));
    calc();

    const genBtn=el('tcubeGenerate');
    if(genBtn) genBtn.onclick=()=>{
      const out=el('tcubePrintOutput'); if(!out) return;
      const name=(profileName.value||'').trim()||'Custom Unit';
      out.innerHTML=`<div class="checklist-page">
        <h1 class="tc-title">Trailer Load Estimate</h1>
        <p style="text-align:center;font-size:13px">${new Date().toLocaleDateString()}</p>
        <div class="tc-headrow" style="margin-top:14px">
          <div>
            <div><b>Unit / Customer:</b> ${name}</div>
            <div><b>Unit Dimensions:</b> ${len.value||'?'}in L × ${wid.value||'?'}in W × ${ht.value||'n/a'}in H</div>
            <div><b>Weight per Unit:</b> ${weight.value?weight.value+' lb':'n/a'}</div>
          </div>
          <div class="tc-headright">
            <div><b>Trailer:</b> 53' Dry Van</div>
            <div><b>Interior:</b> ${trLen.value} × ${trWid.value} × ${trHt.value} in</div>
            <div><b>Weight Limit:</b> ${trWeight.value} lb</div>
          </div>
        </div>
        <div style="text-align:center;margin-top:36px">
          <div style="font-size:13px">Estimated Units That Should Fit</div>
          <div style="font-size:3em;font-weight:900">${result.textContent}</div>
          <div style="font-size:13px;margin-top:6px">${detail.textContent}</div>
        </div>
        <p style="text-align:center;font-size:11px;margin-top:50px;color:#555">This is a rectangular-packing estimate based on standard trailer clearances — actual fit can vary with load bars, dunnage, and real trailer variance. Confirm against the actual load.</p>
      </div>`;
      if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
      LWHUI.toast('Summary generated — ready to print');
    };
  }

  // ---------- Date Calc: days between, add/subtract, and Julian (day-of-year) conversion ----------
  function initDateCalc(){
    const start=el('dcStart'), end=el('dcEnd'), daysBetween=el('dcDaysBetween');
    const addStart=el('dcAddStart'), addDays=el('dcAddDays'), addResult=el('dcAddResult');
    const jcDate=el('jcDate'), jcCode=el('jcCode'), jcResultJulian=el('jcResultJulian'), jcResultCalendar=el('jcResultCalendar');
    if(!start) return;

    // ---------- Age Calculator ----------
    const acDob=el('acDob'), acAsOf=el('acAsOf'), acResult=el('acResult'), acDetail=el('acDetail');
    function calcAge(){
      if(!acDob.value||!acAsOf.value){ acResult.textContent='—'; acDetail.textContent='—'; return; }
      const dob=new Date(acDob.value+'T00:00:00'), asOf=new Date(acAsOf.value+'T00:00:00');
      if(asOf<dob){ acResult.textContent='—'; acDetail.textContent='"Age as of" date is before the date of birth.'; return; }
      let years=asOf.getFullYear()-dob.getFullYear();
      let months=asOf.getMonth()-dob.getMonth();
      let days=asOf.getDate()-dob.getDate();
      if(days<0){
        months--;
        const prevMonth=new Date(asOf.getFullYear(),asOf.getMonth(),0);
        days+=prevMonth.getDate();
      }
      if(months<0){ years--; months+=12; }
      const totalDays=Math.round((asOf-dob)/86400000);
      acResult.textContent=`${years}y ${months}m ${days}d`;
      acDetail.textContent=`${totalDays.toLocaleString()} total days`;
    }
    if(acDob){
      acDob.addEventListener('input',calcAge); acAsOf.addEventListener('input',calcAge);
      if(!acAsOf.value) acAsOf.value=new Date().toISOString().slice(0,10);
    }

    function calcBetween(){
      if(!start.value||!end.value){ daysBetween.textContent='0'; return; }
      const d1=new Date(start.value+'T00:00:00'), d2=new Date(end.value+'T00:00:00');
      daysBetween.textContent=Math.round((d2-d1)/86400000).toLocaleString();
    }
    start.addEventListener('input',calcBetween); end.addEventListener('input',calcBetween);

    function calcAdd(){
      if(!addStart.value){ addResult.textContent='—'; return; }
      const n=parseInt(addDays.value)||0;
      const d=new Date(addStart.value+'T00:00:00');
      d.setDate(d.getDate()+n);
      addResult.textContent=d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
    }
    addStart.addEventListener('input',calcAdd); addDays.addEventListener('input',calcAdd);

    function dayOfYear(d){ return Math.floor((d-new Date(d.getFullYear(),0,1))/86400000)+1; }
    function toJulian(dateVal){
      if(!dateVal) return '';
      const d=new Date(dateVal+'T00:00:00');
      return String(d.getFullYear()%100).padStart(2,'0')+String(dayOfYear(d)).padStart(3,'0');
    }
    // Assumes the 2000s for year reconstruction — reasonable for any near-term
    // product date code. 4-digit codes (single year digit) are inherently
    // ambiguous across decades; picks whichever matching year is closest to
    // right now, which is right the overwhelming majority of the time for
    // real product dating.
    function fromJulian(code){
      code=String(code||'').trim();
      if(!/^\d{3,5}$/.test(code)) return null;
      let yy,doy;
      if(code.length===5){ yy=parseInt(code.slice(0,2),10); doy=parseInt(code.slice(2),10); }
      else if(code.length===4){
        const yDigit=parseInt(code.slice(0,1),10); doy=parseInt(code.slice(1),10);
        const nowYY=new Date().getFullYear()%100;
        let best=null,bestDiff=Infinity;
        for(let y=0;y<100;y++){ if(y%10===yDigit){ const diff=Math.abs(y-nowYY); if(diff<bestDiff){bestDiff=diff;best=y;} } }
        yy=best;
      } else { yy=new Date().getFullYear()%100; doy=parseInt(code,10); }
      if(doy<1||doy>366) return null;
      const d=new Date(2000+yy,0,1);
      d.setDate(d.getDate()+doy-1);
      return d;
    }
    jcDate.addEventListener('input',()=>{ jcResultJulian.textContent=toJulian(jcDate.value)||'—'; });
    jcCode.addEventListener('input',()=>{ const d=fromJulian(jcCode.value); jcResultCalendar.textContent=d?d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'—'; });

    const dow=el('dcDow'), dowResult=el('dcDowResult');
    if(dow) dow.addEventListener('input',()=>{
      if(!dow.value){ dowResult.textContent='—'; return; }
      const d=new Date(dow.value+'T00:00:00');
      dowResult.textContent=d.toLocaleDateString(undefined,{weekday:'long'});
    });
  }

  // ---------- Loan Calculator (standard amortizing monthly payment) ----------
  function initLoanCalc(){
    const amount=el('lcAmount'), down=el('lcDown'), rate=el('lcRate'), term=el('lcTerm');
    const monthlyOut=el('lcMonthly'), financedOut=el('lcFinanced'), interestOut=el('lcInterest'), totalOut=el('lcTotal');
    if(!amount) return;
    function calc(){
      const principal=(parseFloat(amount.value)||0)-(parseFloat(down.value)||0);
      const annualRate=parseFloat(rate.value)||0;
      const years=parseFloat(term.value)||0;
      const n=Math.round(years*12);
      if(principal<=0||n<=0){
        monthlyOut.textContent='—'; financedOut.textContent='—'; interestOut.textContent='—'; totalOut.textContent='—';
        return;
      }
      const monthlyRate=(annualRate/100)/12;
      let payment;
      if(monthlyRate===0){
        payment=principal/n;
      } else {
        payment=principal*(monthlyRate*Math.pow(1+monthlyRate,n))/(Math.pow(1+monthlyRate,n)-1);
      }
      const totalPaid=payment*n;
      const totalInterest=totalPaid-principal;
      monthlyOut.textContent='$'+payment.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      financedOut.textContent='Financed: $'+principal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+' over '+n+' months';
      interestOut.textContent='$'+totalInterest.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      totalOut.textContent='$'+totalPaid.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    }
    [amount,down,rate,term].forEach(f=>f.addEventListener('input',calc));
  }

  // ---------- Cost per Square Foot (annualized landlord rate -> monthly) ----------
  function initCostPerFoot(){
    const annualRate=el('cpfAnnualRate'), sqFt=el('cpfSqFt');
    const monthlyRateOut=el('cpfMonthlyRate'), monthlyCostOut=el('cpfMonthlyCost'), annualCostOut=el('cpfAnnualCost');
    if(!annualRate) return;
    function calc(){
      const rate=parseFloat(annualRate.value)||0;
      if(!rate){ monthlyRateOut.textContent='—'; monthlyCostOut.textContent='—'; annualCostOut.textContent='—'; return; }
      const monthlyRate=rate/12;
      monthlyRateOut.textContent='$'+monthlyRate.toLocaleString(undefined,{minimumFractionDigits:4,maximumFractionDigits:4})+' / sq ft / mo';
      const area=parseFloat(sqFt.value)||0;
      if(area>0){
        monthlyCostOut.textContent='$'+(monthlyRate*area).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
        annualCostOut.textContent='$'+(rate*area).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      } else {
        monthlyCostOut.textContent='—'; annualCostOut.textContent='—';
      }
    }
    annualRate.addEventListener('input',calc); sqFt.addEventListener('input',calc);
  }

  // ---------- Square Footage Calculator (new-location sizing, cost/margin, export) ----------
  function initSqftCalc(){
    const rowsWrap=el('sqftRows'), addBtn=el('sqftAddRow');
    const totalOut=el('sqftTotal'), totalDetail=el('sqftTotalDetail');
    const costRate=el('sqftCostRate'), marginEl=el('sqftMargin');
    const totalCostOut=el('sqftTotalCost'), revNeededOut=el('sqftRevNeeded'), rateNeededOut=el('sqftRateNeeded'), rateNeededDetail=el('sqftRateNeededDetail');
    const copyBtn=el('sqftCopyBtn'), printBtn=el('sqftPrintBtn'), csvBtn=el('sqftCsvBtn'), printOutput=el('sqftPrintOutput');
    if(!rowsWrap) return;

    let rows=[{label:'Building 1',length:'',width:''}];

    function rowSqFt(r){ const l=parseFloat(r.length)||0, w=parseFloat(r.width)||0; return l*w; }

    function renderRows(){
      rowsWrap.innerHTML=rows.map((r,i)=>{
        const sqft=rowSqFt(r);
        return `<div class="sqft-row" style="align-items:center;margin-bottom:8px">
          <input data-sqft-field="label" data-sqft-idx="${i}" value="${String(r.label||'').replace(/"/g,'&quot;')}" placeholder="Building name" />
          <input data-sqft-field="length" data-sqft-idx="${i}" value="${String(r.length||'').replace(/"/g,'&quot;')}" placeholder="Length (ft)" inputmode="decimal" />
          <input data-sqft-field="width" data-sqft-idx="${i}" value="${String(r.width||'').replace(/"/g,'&quot;')}" placeholder="Width (ft)" inputmode="decimal" />
        </div>
        <div class="hint" style="margin:-4px 0 10px 2px">${sqft?sqft.toLocaleString()+' sq ft':'—'}${rows.length>1?` &nbsp;·&nbsp; <button type="button" class="ghost" data-sqft-remove="${i}" style="padding:2px 8px;font-size:.85em">Remove</button>`:''}</div>`;
      }).join('');
    }

    function totalSqFt(){ return rows.reduce((s,r)=>s+rowSqFt(r),0); }

    function calcAll(){
      const total=totalSqFt();
      totalOut.textContent=total.toLocaleString();
      const withArea=rows.filter(r=>rowSqFt(r)>0).length;
      totalDetail.textContent=withArea?`${withArea} building${withArea===1?'':'s'}`:'—';

      const rate=parseFloat(costRate.value)||0;
      const margin=parseFloat(marginEl.value);
      if(!total || !rate){
        totalCostOut.textContent='—'; revNeededOut.textContent='—'; rateNeededOut.textContent='—'; rateNeededDetail.textContent='—';
        return;
      }
      const totalCost=rate*total;
      totalCostOut.textContent='$'+totalCost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      if(margin===undefined || isNaN(margin) || margin>=100){
        revNeededOut.textContent='—'; rateNeededOut.textContent='—'; rateNeededDetail.textContent=(margin>=100)?'Margin must be under 100%':'Enter a target margin';
        return;
      }
      const revNeeded=totalCost/(1-margin/100);
      const rateNeeded=revNeeded/total;
      revNeededOut.textContent='$'+revNeeded.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      rateNeededOut.textContent='$'+rateNeeded.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+' / sq ft / yr';
      rateNeededDetail.textContent='$'+(rateNeeded/12).toLocaleString(undefined,{minimumFractionDigits:4,maximumFractionDigits:4})+' / sq ft / mo';
    }

    rowsWrap.addEventListener('input',e=>{
      const t=e.target; if(t.dataset.sqftIdx===undefined) return;
      rows[+t.dataset.sqftIdx][t.dataset.sqftField]=t.value;
      // Re-render just the sq-ft-per-row hint line without losing focus on every keystroke
      const sqft=rowSqFt(rows[+t.dataset.sqftIdx]);
      const hintLine=t.closest('.sqft-row').nextElementSibling;
      if(hintLine) hintLine.innerHTML=`${sqft?sqft.toLocaleString()+' sq ft':'—'}${rows.length>1?` &nbsp;·&nbsp; <button type="button" class="ghost" data-sqft-remove="${t.dataset.sqftIdx}" style="padding:2px 8px;font-size:.85em">Remove</button>`:''}`;
      calcAll();
    });
    rowsWrap.addEventListener('click',e=>{
      const b=e.target.closest('[data-sqft-remove]'); if(!b) return;
      rows.splice(+b.dataset.sqftRemove,1);
      renderRows(); calcAll();
    });
    if(addBtn) addBtn.onclick=()=>{ rows.push({label:'Building '+(rows.length+1),length:'',width:''}); renderRows(); calcAll(); };
    [costRate,marginEl].forEach(f=>f.addEventListener('input',calcAll));

    function summaryLines(){
      const lines=rows.filter(r=>rowSqFt(r)>0).map(r=>`${r.label||'(unnamed)'}: ${r.length}' x ${r.width}' = ${rowSqFt(r).toLocaleString()} sq ft`);
      lines.push(`Total: ${totalSqFt().toLocaleString()} sq ft`);
      if(totalCostOut.textContent!=='—'){
        lines.push('');
        lines.push(`Cost: $${costRate.value}/sq ft/yr → Total Annual Cost: ${totalCostOut.textContent}`);
        if(rateNeededOut.textContent!=='—'){
          lines.push(`Target Margin: ${marginEl.value}% → Revenue Needed: ${revNeededOut.textContent} → Rate to Charge: ${rateNeededOut.textContent} (${rateNeededDetail.textContent})`);
        }
      }
      return lines;
    }

    if(copyBtn) copyBtn.onclick=()=>{
      const text=summaryLines().join('\n');
      navigator.clipboard?.writeText(text).then(()=>LWHUI.toast('Summary copied')).catch(()=>{});
    };

    if(printBtn) printBtn.onclick=()=>{
      if(!printOutput) return;
      const total=totalSqFt();
      const rowsHtml=rows.filter(r=>rowSqFt(r)>0).map(r=>`<tr><td>${(r.label||'(unnamed)').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}</td><td>${r.length}'</td><td>${r.width}'</td><td>${rowSqFt(r).toLocaleString()}</td></tr>`).join('');
      const costRow = totalCostOut.textContent!=='—' ? `<p><b>Cost:</b> $${costRate.value}/sq ft/yr &nbsp; <b>Total Annual Cost:</b> ${totalCostOut.textContent}</p>` : '';
      const marginRow = rateNeededOut.textContent!=='—' ? `<p><b>Target Margin:</b> ${marginEl.value}% &nbsp; <b>Revenue Needed:</b> ${revNeededOut.textContent} &nbsp; <b>Rate to Charge:</b> ${rateNeededOut.textContent} (${rateNeededDetail.textContent})</p>` : '';
      printOutput.innerHTML='';
      const pageEl=document.createElement('div');
      pageEl.className='checklist-page';
      pageEl.innerHTML=`<h1 style="font-size:20px;margin-bottom:4px">Square Footage Summary</h1><p style="color:#555;font-size:12px;margin-bottom:14px">Generated ${new Date().toLocaleString()}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;border-bottom:2px solid #000;padding:4px">Building</th><th style="text-align:left;border-bottom:2px solid #000;padding:4px">Length</th><th style="text-align:left;border-bottom:2px solid #000;padding:4px">Width</th><th style="text-align:left;border-bottom:2px solid #000;padding:4px">Sq Ft</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
        <p style="font-size:18px;font-weight:900;margin-top:12px">Total: ${total.toLocaleString()} sq ft</p>
        ${costRow}${marginRow}`;
      printOutput.append(pageEl);
      if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
      setTimeout(()=>window.print(),50);
    };

    if(csvBtn) csvBtn.onclick=()=>{
      const csvRows=[['Building','Length (ft)','Width (ft)','Sq Ft']];
      rows.filter(r=>rowSqFt(r)>0).forEach(r=>csvRows.push([r.label,r.length,r.width,rowSqFt(r)]));
      csvRows.push(['Total','','',totalSqFt()]);
      const csv=csvRows.map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob=new Blob([csv],{type:'text/csv'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='square-footage.csv'; document.body.append(a); a.click(); a.remove();
      LWHUI.toast('CSV downloaded');
    };

    renderRows();
    calcAll();
    window.LWHToolClear.sqftcalc=()=>{
      rows=[{label:'Building 1',length:'',width:''}];
      costRate.value=''; marginEl.value='';
      renderRows(); calcAll();
      if(printOutput) printOutput.innerHTML='';
    };
  }

  // ---------- Rack Capacity Calculator ----------
  function initRackCap(){
    const rowsWrap=el('rackcapRows'), addBtn=el('rackcapAddRow');
    const totalOut=el('rackcapTotal'), totalDetail=el('rackcapTotalDetail');
    const copyBtn=el('rackcapCopyBtn'), printBtn=el('rackcapPrintBtn'), csvBtn=el('rackcapCsvBtn'), printOutput=el('rackcapPrintOutput');
    if(!rowsWrap) return;

    let rows=[{label:'Racking Type 1',units:'',levels:'',sections:''}];

    function rowSpots(r){ const u=parseFloat(r.units)||0, l=parseFloat(r.levels)||0, s=parseFloat(r.sections)||0; return u*l*s; }

    function renderRows(){
      rowsWrap.innerHTML=rows.map((r,i)=>{
        const spots=rowSpots(r);
        return `<div class="rackcap-row" style="align-items:center;margin-bottom:8px">
          <input data-rc-field="label" data-rc-idx="${i}" value="${String(r.label||'').replace(/"/g,'&quot;')}" placeholder="Racking type name" />
          <input data-rc-field="units" data-rc-idx="${i}" value="${String(r.units||'').replace(/"/g,'&quot;')}" placeholder="Units/layer" inputmode="numeric" />
          <input data-rc-field="levels" data-rc-idx="${i}" value="${String(r.levels||'').replace(/"/g,'&quot;')}" placeholder="Levels (w/ ground)" inputmode="numeric" />
          <input data-rc-field="sections" data-rc-idx="${i}" value="${String(r.sections||'').replace(/"/g,'&quot;')}" placeholder="Sections" inputmode="numeric" />
        </div>
        <div class="hint" style="margin:-4px 0 10px 2px">${spots?spots.toLocaleString()+' pallet spots':'—'}${rows.length>1?` &nbsp;·&nbsp; <button type="button" class="ghost" data-rc-remove="${i}" style="padding:2px 8px;font-size:.85em">Remove</button>`:''}</div>`;
      }).join('');
    }

    function totalSpots(){ return rows.reduce((s,r)=>s+rowSpots(r),0); }

    function calcAll(){
      const total=totalSpots();
      totalOut.textContent=total.toLocaleString();
      const withSpots=rows.filter(r=>rowSpots(r)>0).length;
      totalDetail.textContent=withSpots?`${withSpots} racking type${withSpots===1?'':'s'}`:'—';
    }

    rowsWrap.addEventListener('input',e=>{
      const t=e.target; if(t.dataset.rcIdx===undefined) return;
      rows[+t.dataset.rcIdx][t.dataset.rcField]=t.value;
      const spots=rowSpots(rows[+t.dataset.rcIdx]);
      const hintLine=t.closest('.rackcap-row').nextElementSibling;
      if(hintLine) hintLine.innerHTML=`${spots?spots.toLocaleString()+' pallet spots':'—'}${rows.length>1?` &nbsp;·&nbsp; <button type="button" class="ghost" data-rc-remove="${t.dataset.rcIdx}" style="padding:2px 8px;font-size:.85em">Remove</button>`:''}`;
      calcAll();
    });
    rowsWrap.addEventListener('click',e=>{
      const b=e.target.closest('[data-rc-remove]'); if(!b) return;
      rows.splice(+b.dataset.rcRemove,1);
      renderRows(); calcAll();
    });
    if(addBtn) addBtn.onclick=()=>{ rows.push({label:'Racking Type '+(rows.length+1),units:'',levels:'',sections:''}); renderRows(); calcAll(); };

    function summaryLines(){
      const lines=rows.filter(r=>rowSpots(r)>0).map(r=>`${r.label||'(unnamed)'}: ${r.units} units/layer x ${r.levels} levels x ${r.sections} sections = ${rowSpots(r).toLocaleString()} pallet spots`);
      lines.push(`Total: ${totalSpots().toLocaleString()} pallet spots`);
      return lines;
    }

    if(copyBtn) copyBtn.onclick=()=>{
      navigator.clipboard?.writeText(summaryLines().join('\n')).then(()=>LWHUI.toast('Summary copied')).catch(()=>{});
    };

    if(printBtn) printBtn.onclick=()=>{
      if(!printOutput) return;
      const total=totalSpots();
      const rowsHtml=rows.filter(r=>rowSpots(r)>0).map(r=>`<tr><td>${(r.label||'(unnamed)').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}</td><td>${r.units}</td><td>${r.levels}</td><td>${r.sections}</td><td>${rowSpots(r).toLocaleString()}</td></tr>`).join('');
      printOutput.innerHTML='';
      const pageEl=document.createElement('div');
      pageEl.className='checklist-page';
      pageEl.innerHTML=`<h1 style="font-size:20px;margin-bottom:4px">Rack Capacity Summary</h1><p style="color:#555;font-size:12px;margin-bottom:14px">Generated ${new Date().toLocaleString()}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;border-bottom:2px solid #000;padding:4px">Racking Type</th><th style="text-align:left;border-bottom:2px solid #000;padding:4px">Units/Layer</th><th style="text-align:left;border-bottom:2px solid #000;padding:4px">Levels</th><th style="text-align:left;border-bottom:2px solid #000;padding:4px">Sections</th><th style="text-align:left;border-bottom:2px solid #000;padding:4px">Pallet Spots</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
        <p style="font-size:18px;font-weight:900;margin-top:12px">Total: ${total.toLocaleString()} pallet spots</p>`;
      printOutput.append(pageEl);
      if(window.LWHLabels && LWHLabels.setPrintPageSize) LWHLabels.setPrintPageSize(8.5,11);
      setTimeout(()=>window.print(),50);
    };

    if(csvBtn) csvBtn.onclick=()=>{
      const csvRows=[['Racking Type','Units/Layer','Levels','Sections','Pallet Spots']];
      rows.filter(r=>rowSpots(r)>0).forEach(r=>csvRows.push([r.label,r.units,r.levels,r.sections,rowSpots(r)]));
      csvRows.push(['Total','','','',totalSpots()]);
      const csv=csvRows.map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob=new Blob([csv],{type:'text/csv'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rack-capacity.csv'; document.body.append(a); a.click(); a.remove();
      LWHUI.toast('CSV downloaded');
    };

    renderRows();
    calcAll();
    window.LWHToolClear.rackcap=()=>{
      rows=[{label:'Racking Type 1',units:'',levels:'',sections:''}];
      renderRows(); calcAll();
      if(printOutput) printOutput.innerHTML='';
    };
  }

  // ---------- Standards Calculator (production pace vs. posted standard) ----------
  function initStandardsCalc(){
    const startEl=el('stStart'), endEl=el('stEnd'), startNowBtn=el('stStartNow'), endNowBtn=el('stEndNow');
    const pieces=el('stPieces'), standard=el('stStandard'), scanBtn=el('stScanBtn');
    const elapsedOut=el('stElapsed'), rateOut=el('stActualRate'), pctOut=el('stPct'), pctDetail=el('stPctDetail');
    if(!startEl) return;

    function nowHHMM(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
    if(startNowBtn) startNowBtn.onclick=()=>{ startEl.value=nowHHMM(); calc(); };
    if(endNowBtn) endNowBtn.onclick=()=>{ endEl.value=nowHHMM(); calc(); };
    if(!endEl.value) endEl.value=nowHHMM();

    function toMinutes(hhmm){ if(!hhmm) return null; const [h,m]=hhmm.split(':').map(Number); return h*60+m; }

    function calc(){
      const sMin=toMinutes(startEl.value), eMin=toMinutes(endEl.value);
      const p=parseFloat(pieces.value)||0, std=parseFloat(standard.value)||0;
      if(sMin===null || eMin===null){ elapsedOut.textContent='—'; rateOut.textContent='—'; pctOut.textContent='—'; pctDetail.textContent='—'; return; }
      let elapsedMin=eMin-sMin;
      if(elapsedMin<0) elapsedMin+=1440; // assume an overnight wrap rather than a negative shift
      const elapsedHours=elapsedMin/60;
      elapsedOut.textContent=`${Math.floor(elapsedMin/60)}h ${elapsedMin%60}m`;

      if(elapsedHours<=0 || !std){
        rateOut.textContent='—'; pctOut.textContent='—'; pctDetail.textContent=!std?'Enter the standard for this job':'—';
        return;
      }
      const actualRate=p/elapsedHours;
      rateOut.textContent=actualRate.toLocaleString(undefined,{maximumFractionDigits:1})+' /hr';
      const pct=(actualRate/std)*100;
      pctOut.textContent=pct.toFixed(0)+'%';
      pctOut.style.color=pct>=100?'var(--good)':(pct>=90?'#b8860b':'var(--bad)');
      const paceNeeded=std*elapsedHours;
      const diff=p-paceNeeded;
      pctDetail.textContent=`${p} done vs. ${paceNeeded.toFixed(0)} needed for pace — ${diff>=0?'+':''}${diff.toFixed(0)} ${diff>=0?'ahead':'behind'}`;
    }
    [startEl,endEl,pieces,standard].forEach(f=>f.addEventListener('input',calc));

    if(scanBtn) scanBtn.onclick=()=>{
      if(!window.LWHScanner){ alert('Scanner not available.'); return; }
      LWHScanner.start(()=>{
        pieces.value=(parseFloat(pieces.value)||0)+1;
        calc();
        LWHUI.toast('Count: '+pieces.value);
      });
    };
    calc();
  }

  // ---------- Axle Weight Check ----------
  function initAxleWeight(){
    const steer=el('awSteer'), steerLim=el('awSteerLimit');
    const drive=el('awDrive'), driveLim=el('awDriveLimit');
    const trailer=el('awTrailer'), trailerLim=el('awTrailerLimit');
    const gross=el('awGross'), grossLim=el('awGrossLimit');
    const results=el('awResults'), overall=el('awOverall');
    if(!steer) return;
    function row(label,val,lim){
      if(!val && val!==0) return '';
      const over=val>lim;
      const color=over?'var(--bad)':'var(--good)';
      const diff=Math.abs(val-lim).toLocaleString();
      const status=over?`OVER by ${diff} lb`:`OK — ${diff} lb under`;
      return `<div class="result-card" style="border-left:4px solid ${color}"><div><b>${label}</b></div><div>${val.toLocaleString()} lb / ${lim.toLocaleString()} lb limit</div><div style="color:${color};font-weight:700">${status}</div></div>`;
    }
    function calc(){
      const s=parseFloat(steer.value)||0, sL=parseFloat(steerLim.value)||12000;
      const d=parseFloat(drive.value)||0, dL=parseFloat(driveLim.value)||34000;
      const t=parseFloat(trailer.value)||0, tL=parseFloat(trailerLim.value)||34000;
      const g=parseFloat(gross.value)||0, gL=parseFloat(grossLim.value)||80000;

      const rows=[
        steer.value?row('Steer Axle',s,sL):'',
        drive.value?row('Drive Axle(s)',d,dL):'',
        trailer.value?row('Trailer Axle(s)',t,tL):'',
        gross.value?row('Gross Vehicle Weight',g,gL):''
      ].filter(Boolean);
      results.innerHTML=rows.join('');

      const checks=[];
      if(steer.value) checks.push(s<=sL);
      if(drive.value) checks.push(d<=dL);
      if(trailer.value) checks.push(t<=tL);
      if(gross.value) checks.push(g<=gL);
      if(!checks.length){ overall.textContent='—'; overall.style.color=''; return; }
      const allOk=checks.every(Boolean);
      overall.textContent=allOk?'Legal':'Overweight — adjust load';
      overall.style.color=allOk?'var(--good)':'var(--bad)';
    }
    [steer,steerLim,drive,driveLim,trailer,trailerLim,gross,grossLim].forEach(f=>f.addEventListener('input',calc));
  }

  // ---------- Margin Calculator ----------
  function initMarginCalc(){
    const revenue=el('mcRevenue'), cost=el('mcCost'), marginOut=el('mcMargin'), profitOut=el('mcProfit'), markupOut=el('mcMarkup');
    const revCost=el('mcRevCost'), targetMargin=el('mcTargetMargin'), revNeededOut=el('mcRevNeeded'), revNeededDetail=el('mcRevNeededDetail');
    if(!revenue) return;
    function calcForward(){
      const r=parseFloat(revenue.value)||0, c=parseFloat(cost.value)||0;
      if(!r){ marginOut.textContent='—'; profitOut.textContent='—'; markupOut.textContent='—'; return; }
      const profit=r-c;
      const margin=(profit/r)*100;
      const markup=c>0?(profit/c)*100:0;
      marginOut.textContent=margin.toFixed(1)+'%';
      marginOut.style.color=margin<0?'var(--bad)':'var(--brand)';
      profitOut.textContent='$'+profit.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      markupOut.textContent=c>0?markup.toFixed(1)+'%':'—';
    }
    function calcReverse(){
      const c=parseFloat(revCost.value)||0, m=parseFloat(targetMargin.value);
      if(!c || m===undefined || isNaN(m) || m>=100){ revNeededOut.textContent='—'; revNeededDetail.textContent=(m>=100)?'Margin must be under 100%':'—'; return; }
      const revNeeded=c/(1-m/100);
      const profit=revNeeded-c;
      revNeededOut.textContent='$'+revNeeded.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      revNeededDetail.textContent=`Profit: $${profit.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    }
    [revenue,cost].forEach(f=>f.addEventListener('input',calcForward));
    [revCost,targetMargin].forEach(f=>f.addEventListener('input',calcReverse));
  }

  // ---------- Freight Class Estimator ----------
  // Standard NMFC density-based bands. Real classification also depends on
  // the specific commodity's NMFC item number — this gives a density-only
  // starting estimate, which is exactly what it's labeled as in the UI.
  const FREIGHT_DENSITY_BANDS=[
    {min:50,cls:'50'},{min:35,cls:'55'},{min:30,cls:'60'},{min:22.5,cls:'65'},
    {min:15,cls:'70'},{min:13.5,cls:'77.5'},{min:12,cls:'85'},{min:10.5,cls:'92.5'},
    {min:9,cls:'100'},{min:8,cls:'110'},{min:7,cls:'125'},{min:6,cls:'150'},
    {min:5,cls:'175'},{min:4,cls:'200'},{min:3,cls:'250'},{min:2,cls:'300'},
    {min:1,cls:'400'},{min:0,cls:'500'}
  ];
  function freightClassFor(density){
    for(const band of FREIGHT_DENSITY_BANDS){ if(density>=band.min) return band.cls; }
    return '500';
  }
  function initFreightClass(){
    const length=el('fcLength'), width=el('fcWidth'), height=el('fcHeight'), weight=el('fcWeight'), pieces=el('fcPieces');
    const cubicFtOut=el('fcCubicFt'), densityOut=el('fcDensity'), classOut=el('fcClass'), totalWeightOut=el('fcTotalWeight');
    if(!length) return;
    function calc(){
      const l=parseFloat(length.value)||0, w=parseFloat(width.value)||0, h=parseFloat(height.value)||0;
      const wt=parseFloat(weight.value)||0, pcs=parseFloat(pieces.value)||1;
      if(!l||!w||!h||!wt){ cubicFtOut.textContent='—'; densityOut.textContent='—'; classOut.textContent='—'; totalWeightOut.textContent='—'; return; }
      const cubicFtEach=(l*w*h)/1728;
      const totalCubicFt=cubicFtEach*pcs;
      const totalWeight=wt*pcs;
      const density=totalWeight/totalCubicFt;
      cubicFtOut.textContent=round(totalCubicFt,1).toLocaleString();
      densityOut.textContent=round(density,2)+' lb/ft³';
      classOut.textContent='Class '+freightClassFor(density);
      totalWeightOut.textContent=`Total: ${totalWeight.toLocaleString()} lb across ${pcs} piece(s)`;
    }
    [length,width,height,weight,pieces].forEach(f=>f.addEventListener('input',calc));
    window.LWHToolClear.freightclass=()=>{
      [length,width,height,weight].forEach(f=>f.value='');
      pieces.value='1';
      cubicFtOut.textContent='—'; densityOut.textContent='—'; classOut.textContent='—'; totalWeightOut.textContent='—';
    };
  }

  // ---------- Timer / Stopwatch ----------
  function initTimer(){
    const modeTimerBtn=el('tmModeTimer'), modeStopBtn=el('tmModeStopwatch'), timerFields=el('tmTimerFields');
    const minutesEl=el('tmMinutes'), secondsEl=el('tmSeconds');
    const display=el('tmDisplay'), status=el('tmStatus');
    const startBtn=el('tmStartBtn'), pauseBtn=el('tmPauseBtn'), resetBtn=el('tmResetBtn');
    if(!modeTimerBtn) return;

    let mode='timer', running=false, tickHandle=null, audioCtx=null;
    let endTime=0, remainingAtPause=0, startTime=0, elapsedAtPause=0;

    function fmtTimer(ms){
      const totalSec=Math.max(0,Math.ceil(ms/1000));
      const m=Math.floor(totalSec/60), s=totalSec%60;
      return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    }
    function fmtStopwatch(ms){
      const totalMs=Math.max(0,ms);
      const m=Math.floor(totalMs/60000), s=Math.floor((totalMs%60000)/1000), cs=Math.floor((totalMs%1000)/10);
      return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(cs).padStart(2,'0');
    }
    function beep(){
      try{
        audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
        for(let i=0;i<3;i++){
          const o=audioCtx.createOscillator(), g=audioCtx.createGain();
          o.type='sine'; o.frequency.value=880;
          o.connect(g); g.connect(audioCtx.destination);
          const t0=audioCtx.currentTime+i*0.35;
          g.gain.setValueAtTime(0.2,t0);
          g.gain.exponentialRampToValueAtTime(0.001,t0+0.3);
          o.start(t0); o.stop(t0+0.3);
        }
      }catch(e){}
    }

    function updateDisplay(){
      if(mode==='timer'){
        const remaining=running?(endTime-Date.now()):remainingAtPause;
        display.textContent=fmtTimer(remaining);
        if(running && remaining<=0){
          stopTick(); running=false;
          display.textContent='00:00';
          status.textContent="Time's up!";
          beep();
        }
      }else{
        const elapsed=running?(Date.now()-startTime+elapsedAtPause):elapsedAtPause;
        display.textContent=fmtStopwatch(elapsed);
      }
    }
    function stopTick(){ if(tickHandle){ clearInterval(tickHandle); tickHandle=null; } }

    function start(){
      if(running) return;
      if(mode==='timer'){
        const mins=parseFloat(minutesEl.value)||0, secs=parseFloat(secondsEl.value)||0;
        const totalMs=remainingAtPause>0?remainingAtPause:(mins*60+secs)*1000;
        if(totalMs<=0){ status.textContent='Set a time first.'; return; }
        endTime=Date.now()+totalMs;
        remainingAtPause=0;
      }else{
        startTime=Date.now();
      }
      running=true;
      status.textContent='Running…';
      tickHandle=setInterval(updateDisplay,200);
    }
    function pause(){
      if(!running) return;
      running=false; stopTick();
      if(mode==='timer'){ remainingAtPause=endTime-Date.now(); }
      else{ elapsedAtPause=Date.now()-startTime+elapsedAtPause; }
      status.textContent='Paused.';
    }
    function reset(){
      running=false; stopTick();
      remainingAtPause=0; elapsedAtPause=0;
      status.textContent='—';
      if(mode==='timer'){
        const mins=parseFloat(minutesEl.value)||0, secs=parseFloat(secondsEl.value)||0;
        display.textContent=fmtTimer((mins*60+secs)*1000);
      }else{
        display.textContent='00:00.00';
      }
    }
    function setMode(newMode){
      mode=newMode;
      modeTimerBtn.classList.toggle('active',mode==='timer');
      modeStopBtn.classList.toggle('active',mode==='stopwatch');
      timerFields.hidden=(mode!=='timer');
      reset();
    }

    modeTimerBtn.onclick=()=>setMode('timer');
    modeStopBtn.onclick=()=>setMode('stopwatch');
    startBtn.onclick=start;
    pauseBtn.onclick=pause;
    resetBtn.onclick=reset;
    [minutesEl,secondsEl].forEach(f=>f.addEventListener('input',()=>{ if(!running) reset(); }));

    reset();
    window.LWHToolClear.timer=reset;
  }

  // ---------- Tip & Bill Split ----------
  function initTipCalc(){
    const bill=el('tpBill'), percent=el('tpPercent'), people=el('tpPeople');
    const tipOut=el('tpTip'), totalOut=el('tpTotal'), perPersonOut=el('tpPerPerson');
    if(!bill) return;
    function calc(){
      const b=parseFloat(bill.value)||0, pct=parseFloat(percent.value)||0, n=Math.max(1,parseInt(people.value)||1);
      if(!b){ tipOut.textContent='—'; totalOut.textContent='—'; perPersonOut.textContent='—'; return; }
      const tip=b*(pct/100), total=b+tip, perPerson=total/n;
      tipOut.textContent='$'+tip.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      totalOut.textContent='$'+total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      perPersonOut.textContent='$'+perPerson.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    }
    [bill,percent,people].forEach(f=>f.addEventListener('input',calc));
    document.querySelectorAll('[data-tip]').forEach(btn=>{
      btn.addEventListener('click',()=>{ percent.value=btn.dataset.tip; calc(); });
    });
    window.LWHToolClear.tip=()=>{ bill.value=''; percent.value='18'; people.value='1'; tipOut.textContent='—'; totalOut.textContent='—'; perPersonOut.textContent='—'; };
  }

  // ---------- Random Picker / Spinner Wheel ----------
  function initSpinner(){
    const namesEl=el('spNames'), svg=el('spWheel'), winnerText=el('spWinnerText'), historyEl=el('spHistory');
    const spinBtn=el('spSpinBtn'), clearBtn=el('spClearBtn');
    if(!namesEl) return;

    let totalRotation=0;
    let history=[];
    const COLORS=['#0a5870','#128aa3','#7d1935','#8b1538','#0f4a45','#c9a227','#3d5a80','#e07a5f','#588157','#6d597a'];

    function getNames(){
      return namesEl.value.split('\n').map(s=>s.trim()).filter(Boolean);
    }
    function polarToCartesian(cx,cy,r,angleDeg){
      const rad=(angleDeg-90)*Math.PI/180;
      return { x:cx+r*Math.cos(rad), y:cy+r*Math.sin(rad) };
    }
    function arcPath(cx,cy,r,startAngle,endAngle){
      const startPt=polarToCartesian(cx,cy,r,startAngle);
      const endPt=polarToCartesian(cx,cy,r,endAngle);
      const largeArc=(endAngle-startAngle)>180?1:0;
      return `M ${cx} ${cy} L ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${largeArc} 1 ${endPt.x} ${endPt.y} Z`;
    }
    function buildWheel(){
      const names=getNames();
      totalRotation=0;
      if(names.length<2){ svg.innerHTML=''; return; }
      const seg=360/names.length;
      let content='';
      names.forEach((name,i)=>{
        const start=i*seg, end=(i+1)*seg, mid=start+seg/2;
        content+=`<path d="${arcPath(100,100,95,start,end)}" fill="${COLORS[i%COLORS.length]}" stroke="#fff" stroke-width="1"/>`;
        const labelPt=polarToCartesian(100,100,60,mid);
        content+=`<text x="${labelPt.x}" y="${labelPt.y}" fill="#fff" font-size="9" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="rotate(${mid},${labelPt.x},${labelPt.y})">${safeText(name.slice(0,14))}</text>`;
      });
      svg.innerHTML=`<g id="spWheelGroup" style="transform-origin:100px 100px;transform-box:fill-box">${content}<circle cx="100" cy="100" r="8" fill="#fff" stroke="#333" stroke-width="1.5"/></g>`;
    }
    function safeText(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

    function spin(){
      const names=getNames();
      if(names.length<2){ winnerText.textContent='Add at least two entries'; return; }
      const group=el('spWheelGroup'); if(!group) return;
      const seg=360/names.length;
      const winnerIndex=Math.floor(Math.random()*names.length);
      const currentMod=((totalRotation%360)+360)%360;
      const desiredAbsolute=(360-(winnerIndex*seg+seg/2))%360;
      const deltaNeeded=((desiredAbsolute-currentMod)%360+360)%360;
      totalRotation+=5*360+deltaNeeded;
      group.style.transition='transform 4s cubic-bezier(0.17,0.67,0.12,0.99)';
      group.style.transform=`rotate(${totalRotation}deg)`;
      spinBtn.disabled=true;
      winnerText.textContent='Spinning…';
      setTimeout(()=>{
        const winner=names[winnerIndex];
        winnerText.textContent=winner;
        history.unshift(winner);
        history=history.slice(0,10);
        historyEl.textContent=history.length?('Recent picks: '+history.join(', ')):'';
        spinBtn.disabled=false;
      },4100);
    }

    spinBtn.onclick=spin;
    clearBtn.onclick=()=>{ namesEl.value=''; buildWheel(); winnerText.textContent='—'; };
    namesEl.addEventListener('input',()=>{ clearTimeout(namesEl._t); namesEl._t=setTimeout(buildWheel,400); });

    buildWheel();
    window.LWHToolClear.spinner=()=>{ namesEl.value=''; buildWheel(); winnerText.textContent='—'; historyEl.textContent=''; history=[]; };
  }



  // ---------- Password Generator ----------
  function initPasswordGen(){
    const lengthEl=el('pgLength'), lengthVal=el('pgLengthVal'), upper=el('pgUpper'), lower=el('pgLower'), numbers=el('pgNumbers'), symbols=el('pgSymbols'), excludeAmbiguous=el('pgExcludeAmbiguous'), result=el('pgResult'), genBtn=el('pgGenerateBtn'), copyBtn=el('pgCopyBtn');
    if(!lengthEl) return;
    const AMBIGUOUS=/[0O1lI]/g;
    function charset(){
      let upperChars='ABCDEFGHIJKLMNOPQRSTUVWXYZ', lowerChars='abcdefghijklmnopqrstuvwxyz', numberChars='0123456789', symbolChars='!@#$%^&*()-_=+[]{};:,.<>?';
      let set='';
      if(upper.checked) set+=upperChars;
      if(lower.checked) set+=lowerChars;
      if(numbers.checked) set+=numberChars;
      if(symbols.checked) set+=symbolChars;
      if(excludeAmbiguous.checked) set=set.replace(AMBIGUOUS,'');
      return set;
    }
    function generate(){
      const set=charset();
      if(!set){ result.textContent='Pick at least one character type'; return; }
      const len=+lengthEl.value;
      const bytes=new Uint32Array(len);
      crypto.getRandomValues(bytes);
      let pw='';
      for(let i=0;i<len;i++) pw+=set[bytes[i]%set.length];
      result.textContent=pw;
    }
    lengthEl.addEventListener('input',()=>{ lengthVal.textContent=lengthEl.value; generate(); });
    [upper,lower,numbers,symbols,excludeAmbiguous].forEach(cb=>cb.addEventListener('change',generate));
    if(genBtn) genBtn.onclick=generate;
    if(copyBtn) copyBtn.onclick=()=>{
      const v=result.textContent;
      if(!v || v==='—' || v==='Pick at least one character type') return;
      navigator.clipboard?.writeText(v).then(()=>LWHUI.toast('Password copied')).catch(()=>{});
    };
    generate();
  }

  // ---------- Case / Layer / Pallet Counter ----------
  function initCaseCalc(){
    const upc=el('ccUnitsPerCase'), cpl=el('ccCasesPerLayer'), lpp=el('ccLayersPerPallet'), upp=el('ccUnitsPerPallet'), uppDetail=el('ccUnitsDetail');
    const target=el('ccTarget'), palletsNeeded=el('ccPalletsNeeded'), palletsDetail=el('ccPalletsDetail');
    if(!upc) return;
    function unitsPerPallet(){ return (parseFloat(upc.value)||0)*(parseFloat(cpl.value)||0)*(parseFloat(lpp.value)||0); }
    function calcPallets(){
      const u=unitsPerPallet(), t=parseFloat(target.value)||0;
      if(!u||!t){ palletsNeeded.textContent='0'; palletsDetail.textContent='—'; return; }
      const pallets=Math.ceil(t/u);
      const lastPallet=t-(pallets-1)*u;
      palletsNeeded.textContent=pallets.toLocaleString();
      palletsDetail.textContent=(t%u===0)?`Even split — all ${pallets} pallet(s) full`:`${(pallets-1).toLocaleString()} full pallet(s) + ${lastPallet.toLocaleString()} units on the last one`;
    }
    function calcUpp(){
      const u=unitsPerPallet();
      upp.textContent=u.toLocaleString();
      uppDetail.textContent=u?`${upc.value||0} units/case × ${cpl.value||0} cases/layer × ${lpp.value||0} layer(s)`:'—';
      calcPallets();
    }
    [upc,cpl,lpp].forEach(f=>f.addEventListener('input',calcUpp));
    target.addEventListener('input',calcPallets);
    calcUpp();
  }

  // ---------- Health: BMI + Body Fat % (nothing here is ever saved anywhere) ----------
  function initHealth(){
    const weight=el('bmiWeight'), hFt=el('bmiHeightFt'), hIn=el('bmiHeightIn'), bmiResult=el('bmiResult'), bmiCategory=el('bmiCategory');
    if(!weight) return;
    function calcBmi(){
      const w=parseFloat(weight.value), ft=parseFloat(hFt.value)||0, inch=parseFloat(hIn.value)||0;
      const totalIn=ft*12+inch;
      if(!w||!totalIn){ bmiResult.textContent='—'; bmiCategory.textContent='—'; return; }
      const bmi=703*w/(totalIn*totalIn);
      bmiResult.textContent=round(bmi,1);
      let cat;
      if(bmi<18.5) cat='Underweight';
      else if(bmi<25) cat='Normal weight';
      else if(bmi<30) cat='Overweight';
      else cat='Obese';
      bmiCategory.textContent=cat+' (standard BMI categories)';
    }
    [weight,hFt,hIn].forEach(f=>f.addEventListener('input',calcBmi));

    const gender=el('bfGender'), neck=el('bfNeck'), waist=el('bfWaist'), hip=el('bfHip'), hipLabel=el('bfHipLabel'), bfHeight=el('bfHeight'), bfResult=el('bfResult'), bfCategory=el('bfCategory');
    function toggleHip(){ hipLabel.style.display=(gender.value==='female')?'':'none'; }
    function bfCategoryFor(pct,sex){
      if(sex==='male'){
        if(pct<6) return 'Essential fat';
        if(pct<14) return 'Athletic';
        if(pct<18) return 'Fitness';
        if(pct<25) return 'Acceptable';
        return 'Obese range';
      }
      if(pct<14) return 'Essential fat';
      if(pct<21) return 'Athletic';
      if(pct<25) return 'Fitness';
      if(pct<32) return 'Acceptable';
      return 'Obese range';
    }
    function calcBodyFat(){
      const sex=gender.value, n=parseFloat(neck.value), wa=parseFloat(waist.value), h=parseFloat(bfHeight.value), hi=parseFloat(hip.value);
      if(!n||!wa||!h||(sex==='female'&&!hi)){ bfResult.textContent='—'; bfCategory.textContent='—'; return; }
      let bf;
      if(sex==='male') bf=86.010*Math.log10(wa-n)-70.041*Math.log10(h)+36.76;
      else bf=163.205*Math.log10(wa+hi-n)-97.684*Math.log10(h)-78.387;
      if(!isFinite(bf)||isNaN(bf)){ bfResult.textContent='—'; bfCategory.textContent='Check your measurements — waist should be larger than neck.'; return; }
      bfResult.textContent=round(bf,1)+'%';
      bfCategory.textContent=bfCategoryFor(bf,sex)+' range (estimate only)';
    }
    gender.addEventListener('change',()=>{ toggleHip(); calcBodyFat(); });
    [neck,waist,hip,bfHeight].forEach(f=>f.addEventListener('input',calcBodyFat));
    toggleHip();
  }

  // ---------- Storage Revenue & Profitability (multi-customer) ----------
  function initRevenue(){
    const rowsWrap=el('revRows'), addBtn=el('revAddRow');
    const stackIn=el('revStack'), aisleIn=el('revAisle'), costIn=el('revCostPerSqFt');
    const totalRevenueEl=el('revTotalRevenue'), totalDetailEl=el('revTotalDetail');
    if(!rowsWrap) return;

    function loadRows(){ return LWHStorage.get('storageRevenueRows',[{name:'',count:'',rate:'',len:'',wid:''}]); }
    function saveRows(rows){ LWHStorage.set('storageRevenueRows',rows); }

    // Same floor-position/aisle-allowance math as the Storage Space Estimator,
    // applied per customer row, so the sq ft figure here is consistent with
    // the rest of the app rather than a separate, different calculation.
    function rowMetrics(row,stack,aisle,costPerSqFt){
      const count=parseFloat(row.count)||0, rate=parseFloat(row.rate)||0;
      const revenue=count*rate;
      let sqft=null,effRate=null,cost=null,profit=null;
      const len=parseFloat(row.len)||0, wid=parseFloat(row.wid)||0;
      if(len&&wid&&count){
        const pFt=(len*wid)/144;
        const positions=Math.ceil(count/stack);
        sqft=positions*pFt*(1+aisle/100);
        effRate=sqft?revenue/sqft:null;
        if(costPerSqFt){ cost=sqft*costPerSqFt; profit=revenue-cost; }
      }
      return {revenue,sqft,effRate,cost,profit};
    }
    function metricsLine(m){
      return [
        `Revenue $${round(m.revenue,2).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`,
        m.sqft!=null?`${round(m.sqft,0).toLocaleString()} sq ft`:null,
        m.effRate!=null?`$${round(m.effRate,3)}/sq ft charged`:null,
        m.profit!=null?(m.profit>=0?`+$${round(m.profit,2).toLocaleString()} profit`:`−$${round(Math.abs(m.profit),2).toLocaleString()} loss`):null
      ].filter(Boolean).join(' · ');
    }
    function sharedVals(){ return {stack:Math.max(1,parseFloat(stackIn.value)||1),aisle:parseFloat(aisleIn.value)||0,costPerSqFt:parseFloat(costIn.value)||0}; }

    // Updates only the computed metrics text per row — never rebuilds the
    // input fields themselves, so typing in one row's field never steals
    // focus away mid-keystroke the way a full re-render would.
    function updateMetricsOnly(){
      const rows=loadRows(); const {stack,aisle,costPerSqFt}=sharedVals();
      let totalRev=0,totalSqft=0,totalCost=0,anySqft=false,anyCost=false;
      rows.forEach((row,i)=>{
        const m=rowMetrics(row,stack,aisle,costPerSqFt);
        const lineEl=rowsWrap.querySelector(`[data-metrics="${i}"]`);
        if(lineEl) lineEl.textContent=metricsLine(m)||'—';
        totalRev+=m.revenue;
        if(m.sqft!=null){ totalSqft+=m.sqft; anySqft=true; }
        if(m.cost!=null){ totalCost+=m.cost; anyCost=true; }
      });
      totalRevenueEl.textContent='$'+round(totalRev,2).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      let detail=`${rows.length} customer(s)`;
      if(anySqft) detail+=` · ${round(totalSqft,0).toLocaleString()} sq ft total`;
      if(anyCost){ const totalProfit=totalRev-totalCost; detail+=totalProfit>=0?` · +$${round(totalProfit,2).toLocaleString()} profit`:` · −$${round(Math.abs(totalProfit),2).toLocaleString()} loss`; }
      totalDetailEl.textContent=detail;
    }

    function render(){
      const rows=loadRows(); const {stack,aisle,costPerSqFt}=sharedVals();
      rowsWrap.innerHTML=rows.map((row,i)=>{
        const m=rowMetrics(row,stack,aisle,costPerSqFt);
        return `<div class="card" style="margin-bottom:8px">
          <div class="grid-3">
            <input data-idx="${i}" data-field="name" value="${String(row.name||'').replace(/"/g,'&quot;')}" placeholder="Customer Name" />
            <input data-idx="${i}" data-field="count" value="${String(row.count||'')}" placeholder="Pallet Count" inputmode="numeric" />
            <input data-idx="${i}" data-field="rate" value="${String(row.rate||'')}" placeholder="Rate $/Pallet" inputmode="decimal" />
          </div>
          <div class="grid-2" style="margin-top:6px">
            <input data-idx="${i}" data-field="len" value="${String(row.len||'')}" placeholder="Pallet Length (in, optional)" inputmode="decimal" />
            <input data-idx="${i}" data-field="wid" value="${String(row.wid||'')}" placeholder="Pallet Width (in, optional)" inputmode="decimal" />
          </div>
          <div class="hint" style="margin-top:6px" data-metrics="${i}">${metricsLine(m)||'—'}</div>
          <div class="actions" style="margin-top:6px"><button type="button" class="ghost" data-remove="${i}">Remove Row</button></div>
        </div>`;
      }).join('');
      updateMetricsOnly();
    }

    rowsWrap.addEventListener('input',e=>{
      const t=e.target; if(t.dataset.idx===undefined) return;
      const rows=loadRows();
      if(!rows[t.dataset.idx]) return;
      rows[t.dataset.idx][t.dataset.field]=t.value;
      saveRows(rows);
      updateMetricsOnly();
    });
    rowsWrap.addEventListener('click',e=>{
      const b=e.target.closest('[data-remove]'); if(!b) return;
      const rows=loadRows();
      rows.splice(+b.dataset.remove,1);
      if(!rows.length) rows.push({name:'',count:'',rate:'',len:'',wid:''});
      saveRows(rows);
      render();
    });
    addBtn.onclick=()=>{
      const rows=loadRows();
      rows.push({name:'',count:'',rate:'',len:'',wid:''});
      saveRows(rows);
      render();
    };
    [stackIn,aisleIn,costIn].forEach(f=>f.addEventListener('input',updateMetricsOnly));
    render();
  }

  // ---------- Translate: free, keyless via MyMemory ----------
  const TRANSLATE_QUICK_PHRASES=[
    'I need your paperwork.',
    'What is your pickup or delivery number?',
    'Do you have your Bill of Lading?',
    'Please back into dock 5.',
    'Please go to the dock number posted.',
    'Please fill out this form with your driver information, including your phone number.',
    "I need a copy of your driver's license, please.",
    'Please sign here.',
    'Please wait here.',
    'We will bring your paperwork out when we are done.',
    'The restroom is across from our shipping/receiving office.',
    "I don't understand. Please repeat that.",
    'Thank you, have a safe trip.'
  ];
  const SPEECH_LANG_MAP={en:'en-US',es:'es-ES',ru:'ru-RU',fr:'fr-FR',pt:'pt-PT',zh:'zh-CN',ar:'ar-SA',vi:'vi-VN'};
  function initTranslate(){
    const from=el('trFrom'), to=el('trTo'), input=el('trInput'), result=el('trResult'), goBtn=el('trGo'), swapBtn=el('trSwap'), voiceBtn=el('trVoiceBtn'), phrasesWrap=el('trQuickPhrases');
    const speakBtn=el('trSpeakBtn'), autoSpeak=el('trAutoSpeak');
    if(!input) return;

    const speechOk='speechSynthesis' in window;
    if(speechOk && speakBtn) speakBtn.hidden=false;
    let lastSpokenText='', lastSpokenLang='en-US';
    function speak(text,langCode){
      if(!speechOk || !text) return;
      window.speechSynthesis.cancel(); // stop anything already playing before starting the new one
      const u=new SpeechSynthesisUtterance(text);
      u.lang=SPEECH_LANG_MAP[langCode]||'en-US';
      lastSpokenText=text; lastSpokenLang=u.lang;
      window.speechSynthesis.speak(u);
    }
    if(speakBtn) speakBtn.onclick=()=>speak(lastSpokenText||result.textContent,to.value);

    async function translate(text){
      if(!text||!text.trim()){ result.textContent='Type, paste, or speak something first.'; return; }
      result.textContent='Translating…';
      try{
        const url=`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from.value}|${to.value}`;
        const res=await fetch(url);
        if(!res.ok) throw new Error('HTTP '+res.status);
        const data=await res.json();
        const translated=data && data.responseData && data.responseData.translatedText;
        if(!translated) throw new Error('No translation returned');
        result.textContent=translated;
        if(autoSpeak && autoSpeak.checked) speak(translated,to.value);
      }catch(e){
        result.textContent='Translation failed: '+e.message+' — check your connection and try again';
      }
    }

    goBtn.onclick=()=>translate(input.value);
    swapBtn.onclick=()=>{
      if(speechOk) window.speechSynthesis.cancel();
      const f=from.value; from.value=to.value; to.value=f;
      const prevResult=result.textContent;
      if(prevResult && prevResult!=='—' && !prevResult.startsWith('Translation failed') && !prevResult.startsWith('Type')){
        input.value=prevResult;
      }
      result.textContent='—';
    };
    phrasesWrap.innerHTML=TRANSLATE_QUICK_PHRASES.map((p,i)=>`<button type="button" class="ghost" data-phrase="${i}">${p}</button>`).join('');
    phrasesWrap.addEventListener('click',e=>{
      const b=e.target.closest('[data-phrase]'); if(!b) return;
      const phrase=TRANSLATE_QUICK_PHRASES[+b.dataset.phrase];
      input.value=phrase;
      translate(phrase);
    });
    if(window.attachVoiceInput) attachVoiceInput(voiceBtn,input,{lang:()=>SPEECH_LANG_MAP[from.value]||'en-US',cleanDigits:false,idleLabel:'Speak'});
  }

  window.LWHUtilities={stopScannerCamera};
  window.addEventListener('load',()=>{ initTabs(); initClearActiveTool(); initCalc(); initConvert(); initPallet(); initNotepad(); initScanner(); initGenerate(); initScanCode(); initMessage(); initTrailerCube(); initDateCalc(); initLoanCalc(); initCostPerFoot(); initSqftCalc(); initRackCap(); initStandardsCalc(); initCaseCalc(); initAxleWeight(); initMarginCalc(); initFreightClass(); initTimer(); initTipCalc(); initSpinner(); initPasswordGen(); initHealth(); initRevenue(); initTranslate(); });
})();
