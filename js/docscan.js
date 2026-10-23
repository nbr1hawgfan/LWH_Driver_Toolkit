// LWH Warehouse Toolkit / Driver Toolkit — Doc Scanner (shared file)
//
// Its own module now (was inside utilities.js). Scan with the camera, or bring
// in photos and PDFs (several at once, drag-and-drop, or paste). Each page can
// be cropped / straightened / cleaned up and re-edited any time. Text and key
// numbers can be pulled out, and pages leave as one PDF (optionally
// searchable), images, or a print.
//
// Heavy pieces load only when they're needed:
//   - OpenCV (~9 MB, edge finder only) — when Doc Scanner is opened
//   - pdf.js — only when someone brings in a PDF
//   - Tesseract language data — only when someone reads text
// Straightening and the clean-up filters are plain JavaScript, so they work
// even when the edge finder hasn't loaded (no signal, slow phone).
//
// Pages are kept as compressed images (not live canvases) and saved on this
// device in IndexedDB, so a refresh or a closed tab doesn't lose a stack of
// scanned paperwork, and long stacks don't run iPhones out of memory.
//
// window.DocAutoDetect (js/doc-auto-detect.js) is still the edge-detection
// engine; this file only calls it.

(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const toast=m=>{ try{ window.LWHUI&&LWHUI.toast&&LWHUI.toast(m); }catch(e){} };
  const store={
    get:(k,d)=>window.LWHStorage?LWHStorage.get(k,d):d,
    set:(k,v)=>{ if(window.LWHStorage) LWHStorage.set(k,v); }
  };

  // One file serves both Toolkits. Both apps live on the same web address, so
  // each keeps its own saved pages/settings: <section id="docscan"
  // data-db="…" data-prefix="…" data-mode="driver"> overrides the defaults.
  const SEC=document.getElementById('docscan')||{dataset:{}};
  const CFG={db:SEC.dataset.db||'lwh-docscan',prefix:SEC.dataset.prefix||'docscan',driver:SEC.dataset.mode==='driver'};
  const K=name=>CFG.prefix+name;
  const OPENCV_URL='https://docs.opencv.org/4.8.0/opencv.js';
  const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const SRC_MAX=2400;      // longest side kept for each page
  const PREVIEW_MAX=900;   // editor "Result" preview
  const DETECT_MAX=900;    // edge finder works on a smaller copy (faster, steadier)
  const PDF_PAGE_LIMIT=80;
  const FILTERS=[
    ['original','Original'],
    ['document','Document'],
    ['bw','B&W'],
    ['gray','Grayscale'],
    ['color','Color boost']
  ];
  const FILTER_NAME=Object.fromEntries(FILTERS);
  const QUALITY={
    small:{max:1400,q:0.55,label:'Small'},
    standard:{max:2000,q:0.72,label:'Standard'},
    high:{max:2600,q:0.88,label:'High detail'}
  };
  const PAGE_SIZES={ letter:[612,792], legal:[612,1008], a4:[595.28,841.89] };

  // ---------------------------------------------------------------- state
  // page = {id, srcBlob, outBlob, outW, outH, rotation, corners (normalized
  //         0..1 in rotated space, or null = whole image), filter, origin,
  //         name, ocr:{lang,text,words,w,h,conf}|null, selected, thumbUrl}
  const pages=[];
  let busy=false, restored=false, restoreNote=0, shownOnce=false;

  function uid(){ return 'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function clamp01(v){ return Math.min(1,Math.max(0,v)); }
  function fmtBytes(n){ return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB'; }
  function isActiveView(){ const s=$('docscan'); return !!(s&&s.classList.contains('active')); }

  // ---------------------------------------------------------- lazy loaders
  const scriptPromises={};
  function loadScript(url){
    if(!scriptPromises[url]){
      scriptPromises[url]=new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src=url; s.async=true;
        s.onload=()=>resolve();
        s.onerror=()=>{ delete scriptPromises[url]; s.remove(); reject(new Error('Could not load '+url.split('/').pop()+' — check your connection.')); };
        document.head.appendChild(s);
      });
    }
    return scriptPromises[url];
  }

  let cvPromise=null, cvThenCalled=false;
  function cvReady(){ return !!(window.DocAutoDetect&&DocAutoDetect.isReady()); }
  function loadOpenCV(){
    if(cvReady()) return Promise.resolve();
    if(cvPromise) return cvPromise;
    cvPromise=new Promise((resolve,reject)=>{
      let done=false, poll=null, timer=null;
      const finish=()=>{
        if(done) return;
        if(window.cv&&window.cv.Mat){
          done=true; clearInterval(poll); clearTimeout(timer);
          window.dispatchEvent(new Event('opencv-ready'));
          resolve();
        }
      };
      // OpenCV.js looks for a global Module and calls onRuntimeInitialized
      // once its WASM runtime is actually usable. Some builds expose `cv` as
      // a promise-like instead; both are handled.
      window.Module=window.Module||{};
      const prev=window.Module.onRuntimeInitialized;
      window.Module.onRuntimeInitialized=function(){ try{ prev&&prev(); }catch(e){} finish(); };
      poll=setInterval(()=>{
        if(window.cv&&!window.cv.Mat&&typeof window.cv.then==='function'&&!cvThenCalled){
          cvThenCalled=true;
          try{ window.cv.then(m=>{ if(m&&m.Mat) window.cv=m; finish(); }); }catch(e){}
        }
        finish();
      },150);
      timer=setTimeout(()=>{ if(!done){ clearInterval(poll); cvPromise=null; reject(new Error('The edge finder took too long to load.')); } },90000);
      loadScript(OPENCV_URL).catch(err=>{ clearInterval(poll); clearTimeout(timer); cvPromise=null; reject(err); });
    });
    return cvPromise;
  }
  function withTimeout(p,ms){ return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]); }

  async function loadPdfJs(){
    await loadScript(PDFJS_URL);
    const lib=window.pdfjsLib;
    if(!lib) throw new Error('The PDF reader did not load.');
    lib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;
    return lib;
  }

  // ------------------------------------------------------- image helpers
  function newCanvas(w,h){ const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w)); c.height=Math.max(1,Math.round(h)); return c; }
  function freeCanvas(c){ if(c&&c.getContext){ c.width=0; c.height=0; } }
  function ctx2d(c){ return c.getContext('2d',{willReadFrequently:true}); }
  function loadImage(blob){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(blob);
      const img=new Image();
      img.onload=()=>{ URL.revokeObjectURL(url); resolve(img); };
      img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('Could not read that image (iPhone HEIC photos only open in Safari — try a JPG or a screenshot).')); };
      img.src=url;
    });
  }
  // Downscales in halving steps so text stays crisp instead of aliased.
  function drawScaled(source,w,h,maxDim){
    const s=Math.min(1,maxDim/Math.max(w,h));
    const tw=Math.max(1,Math.round(w*s)), th=Math.max(1,Math.round(h*s));
    let cur=source, cw=w, ch=h;
    while(cw/2>=tw*1.0001&&ch/2>=th){
      const nw=Math.round(cw/2), nh=Math.round(ch/2);
      const c=newCanvas(nw,nh); const x=c.getContext('2d');
      x.imageSmoothingEnabled=true; x.imageSmoothingQuality='high';
      x.drawImage(cur,0,0,nw,nh);
      if(cur!==source) freeCanvas(cur);
      cur=c; cw=nw; ch=nh;
    }
    const out=newCanvas(tw,th); const o=out.getContext('2d');
    o.imageSmoothingEnabled=true; o.imageSmoothingQuality='high';
    o.fillStyle='#fff'; o.fillRect(0,0,tw,th);
    o.drawImage(cur,0,0,tw,th);
    if(cur!==source) freeCanvas(cur);
    return out;
  }
  function canvasToBlob(c,q){
    return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Could not save the image (the phone may be low on memory).')),'image/jpeg',q==null?0.92:q));
  }
  async function blobToCanvas(blob){
    const img=await loadImage(blob);
    const c=newCanvas(img.naturalWidth,img.naturalHeight);
    c.getContext('2d').drawImage(img,0,0);
    return c;
  }
  function rotateCanvas(src,rot){
    rot=((rot%360)+360)%360;
    if(!rot) return src;
    const swap=rot===90||rot===270;
    const c=newCanvas(swap?src.height:src.width, swap?src.width:src.height);
    const x=c.getContext('2d');
    x.translate(c.width/2,c.height/2); x.rotate(rot*Math.PI/180);
    x.drawImage(src,-src.width/2,-src.height/2);
    return c;
  }
  // Normalized corner rotation that matches rotateCanvas (clockwise).
  function rotateCornersNorm(corners,deg){
    if(!corners) return null;
    deg=((deg%360)+360)%360;
    let pts=corners.map(p=>({x:p.x,y:p.y}));
    for(let k=0;k<deg/90;k++) pts=pts.map(p=>({x:1-p.y,y:p.x}));
    return orderCorners(pts);
  }
  function orderCorners(pts){
    if(window.DocAutoDetect&&DocAutoDetect.orderCorners) return DocAutoDetect.orderCorners(pts);
    const sum=pts.map(p=>p.x+p.y), diff=pts.map(p=>p.x-p.y);
    return [pts[sum.indexOf(Math.min(...sum))],pts[diff.indexOf(Math.max(...diff))],pts[sum.indexOf(Math.max(...sum))],pts[diff.indexOf(Math.min(...diff))]];
  }
  function isFullFrame(c){
    if(!c) return true;
    const e=0.004;
    return c[0].x<e&&c[0].y<e&&c[1].x>1-e&&c[1].y<e&&c[2].x>1-e&&c[2].y>1-e&&c[3].x<e&&c[3].y>1-e;
  }
  function fullCorners(){ return [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]; }
  function insetCorners(){ const i=0.06; return [{x:i,y:i},{x:1-i,y:i},{x:1-i,y:1-i},{x:i,y:1-i}]; }
  function quadArea(p){ let s=0; for(let i=0;i<4;i++){ const a=p[i],b=p[(i+1)%4]; s+=a.x*b.y-b.x*a.y; } return Math.abs(s/2); }

  // --------------------------------------------- perspective straighten
  // Plain-JS homography warp (no OpenCV needed) with bilinear sampling.
  function solveHomography(src,dst){
    const A=[],B=[];
    for(let i=0;i<4;i++){
      const x=src[i].x,y=src[i].y,u=dst[i].x,v=dst[i].y;
      A.push([u,v,1,0,0,0,-u*x,-v*x]); B.push(x);
      A.push([0,0,0,u,v,1,-u*y,-v*y]); B.push(y);
    }
    const n=8;
    for(let i=0;i<n;i++){
      let p=i; for(let r=i+1;r<n;r++) if(Math.abs(A[r][i])>Math.abs(A[p][i])) p=r;
      [A[i],A[p]]=[A[p],A[i]]; [B[i],B[p]]=[B[p],B[i]];
      const piv=A[i][i]; if(Math.abs(piv)<1e-10) return null;
      for(let r=i+1;r<n;r++){ const f=A[r][i]/piv; if(!f) continue; for(let c=i;c<n;c++) A[r][c]-=f*A[i][c]; B[r]-=f*B[i]; }
    }
    const h=new Array(8);
    for(let i=n-1;i>=0;i--){ let s=B[i]; for(let c=i+1;c<n;c++) s-=A[i][c]*h[c]; h[i]=s/A[i][i]; }
    return h;
  }
  function warpPerspective(src,cornersPx,maxOut){
    const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    const c=cornersPx;
    let W=Math.max(d(c[0],c[1]),d(c[3],c[2])), H=Math.max(d(c[0],c[3]),d(c[1],c[2]));
    const s=Math.min(1,maxOut/Math.max(W,H));
    W=Math.max(8,Math.round(W*s)); H=Math.max(8,Math.round(H*s));
    const h=solveHomography(c,[{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}]);
    if(!h) return drawScaled(src,src.width,src.height,maxOut);
    const sw=src.width, sh=src.height;
    const sd=ctx2d(src).getImageData(0,0,sw,sh).data;
    const out=newCanvas(W,H); const octx=ctx2d(out);
    const od=octx.createImageData(W,H); const o=od.data;
    const maxX=sw-1, maxY=sh-1;
    for(let v=0;v<H;v++){
      const vv=v+0.5;
      let nx=h[0]*0.5+h[1]*vv+h[2], ny=h[3]*0.5+h[4]*vv+h[5], dn=h[6]*0.5+h[7]*vv+1;
      let oi=v*W*4;
      for(let u=0;u<W;u++){
        let x=nx/dn-0.5, y=ny/dn-0.5;
        if(x<0) x=0; else if(x>maxX) x=maxX;
        if(y<0) y=0; else if(y>maxY) y=maxY;
        const x0=x|0, y0=y|0, x1=x0<maxX?x0+1:x0, y1=y0<maxY?y0+1:y0;
        const fx=x-x0, fy=y-y0;
        const i00=(y0*sw+x0)*4, i10=(y0*sw+x1)*4, i01=(y1*sw+x0)*4, i11=(y1*sw+x1)*4;
        const w00=(1-fx)*(1-fy), w10=fx*(1-fy), w01=(1-fx)*fy, w11=fx*fy;
        o[oi]  =sd[i00]*w00+sd[i10]*w10+sd[i01]*w01+sd[i11]*w11;
        o[oi+1]=sd[i00+1]*w00+sd[i10+1]*w10+sd[i01+1]*w01+sd[i11+1]*w11;
        o[oi+2]=sd[i00+2]*w00+sd[i10+2]*w10+sd[i01+2]*w01+sd[i11+2]*w11;
        o[oi+3]=255;
        oi+=4; nx+=h[0]; ny+=h[3]; dn+=h[6];
      }
    }
    octx.putImageData(od,0,0);
    return out;
  }

  // -------------------------------------------------------------- filters
  function percentiles(hist,total,lo,hi){
    let a=0,b=255,acc=0;
    for(let i=0;i<256;i++){ acc+=hist[i]; if(acc>=total*lo){ a=i; break; } }
    acc=0;
    for(let i=255;i>=0;i--){ acc+=hist[i]; if(acc>=total*(1-hi)){ b=i; break; } }
    if(b-a<10){ a=Math.max(0,a-5); b=Math.min(255,b+5); }
    return [a,b];
  }
  function otsu(hist,total){
    let sum=0; for(let i=0;i<256;i++) sum+=i*hist[i];
    let sumB=0,wB=0,best=0,t=128;
    for(let i=0;i<256;i++){
      wB+=hist[i]; if(!wB) continue;
      const wF=total-wB; if(!wF) break;
      sumB+=i*hist[i];
      const mB=sumB/wB, mF=(sum-sumB)/wF, between=wB*wF*(mB-mF)*(mB-mF);
      if(between>best){ best=between; t=i; }
    }
    return t;
  }
  // Paper-colour estimate: shrink the page way down, "grow" the light areas
  // so text strokes disappear, blur, then stretch it back up. Dividing the
  // page by this flattens shadows, uneven light and yellowed paper.
  function estimateBackground(canvas){
    const W=canvas.width,H=canvas.height;
    const small=drawScaled(canvas,W,H,96);
    const w=small.width,h=small.height, sctx=ctx2d(small);
    const img=sctx.getImageData(0,0,w,h); let a=img.data;
    const pass=(src,fn,r)=>{
      const dst=new Uint8ClampedArray(src.length);
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        for(let c=0;c<3;c++){
          let acc=fn==='max'?0:0, n=0;
          for(let dy=-r;dy<=r;dy++){ const yy=y+dy; if(yy<0||yy>=h) continue;
            for(let dx=-r;dx<=r;dx++){ const xx=x+dx; if(xx<0||xx>=w) continue;
              const v=src[(yy*w+xx)*4+c];
              if(fn==='max'){ if(v>acc) acc=v; } else { acc+=v; n++; }
            } }
          dst[(y*w+x)*4+c]=fn==='max'?acc:acc/n;
        }
        dst[(y*w+x)*4+3]=255;
      }
      return dst;
    };
    a=pass(a,'max',2); a=pass(a,'max',1); a=pass(a,'avg',2);
    img.data.set(a); sctx.putImageData(img,0,0);
    const big=newCanvas(W,H); const bx=ctx2d(big);
    bx.imageSmoothingEnabled=true; bx.imageSmoothingQuality='high';
    bx.drawImage(small,0,0,W,H);
    const data=bx.getImageData(0,0,W,H).data;
    freeCanvas(big); freeCanvas(small);
    return data;
  }
  function applyFilter(canvas,filter){
    if(!filter||filter==='original') return canvas;
    const W=canvas.width,H=canvas.height,ctx=ctx2d(canvas);
    const img=ctx.getImageData(0,0,W,H), d=img.data, N=W*H;
    if(filter==='gray'||filter==='color'){
      const hist=new Uint32Array(256);
      for(let i=0;i<d.length;i+=4) hist[(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)|0]++;
      const [lo,hi]=percentiles(hist,N,0.005,0.995), k=255/(hi-lo);
      for(let i=0;i<d.length;i+=4){
        if(filter==='gray'){
          const g=((d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)-lo)*k;
          d[i]=d[i+1]=d[i+2]=g;
        } else {
          let r=(d[i]-lo)*k, g=(d[i+1]-lo)*k, b=(d[i+2]-lo)*k;
          const l=r*0.299+g*0.587+b*0.114, sat=1.18;
          d[i]=l+(r-l)*sat; d[i+1]=l+(g-l)*sat; d[i+2]=l+(b-l)*sat;
        }
      }
    } else if(filter==='document'||filter==='bw'){
      const bg=estimateBackground(canvas);
      const hist=new Uint32Array(256);
      for(let i=0;i<d.length;i+=4){
        for(let c=0;c<3;c++){
          let v=d[i+c]/Math.max(bg[i+c],24); // 1.0 = paper
          v=v>=0.9?1:Math.pow(v/0.9,1.5);     // paper → white, ink stays dark
          d[i+c]=v*255;
        }
        if(filter==='bw') hist[(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)|0]++;
      }
      if(filter==='bw'){
        const t=Math.min(215,Math.max(90,otsu(hist,N)+8));
        for(let i=0;i<d.length;i+=4){
          const g=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
          d[i]=d[i+1]=d[i+2]=g<t?0:255;
        }
      }
    }
    ctx.putImageData(img,0,0);
    return canvas;
  }
  // oriented canvas + normalized corners + filter → finished page canvas
  function renderOutput(oriented,corners,filter,maxOut){
    let out;
    if(isFullFrame(corners)) out=drawScaled(oriented,oriented.width,oriented.height,maxOut);
    else out=warpPerspective(oriented,corners.map(p=>({x:p.x*oriented.width,y:p.y*oriented.height})),maxOut);
    return applyFilter(out,filter);
  }

  // ------------------------------------------------------- edge detection
  async function detectCornersNorm(canvas,waitMs){
    try{
      if(!cvReady()){ if(!waitMs) return null; await withTimeout(loadOpenCV(),waitMs); }
    }catch(e){ return null; }
    const small=drawScaled(canvas,canvas.width,canvas.height,DETECT_MAX);
    let pts=null;
    try{ pts=DocAutoDetect.detectCorners(small); }catch(e){ console.error('Edge detection failed',e); }
    const sw=small.width, sh=small.height; freeCanvas(small);
    if(!pts) return null;
    const norm=orderCorners(pts.map(p=>({x:clamp01(p.x/sw),y:clamp01(p.y/sh)})));
    return quadArea(norm)>0.1?norm:null;
  }

  // ---------------------------------------------------------- persistence
  const DB_NAME=CFG.db, DB_STORE='pages', ORDER_KEY=K('Order');
  let dbp=null;
  function db(){
    if(!dbp) dbp=new Promise((resolve,reject)=>{
      if(!window.indexedDB){ reject(new Error('no indexedDB')); return; }
      const r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=()=>r.result.createObjectStore(DB_STORE,{keyPath:'id'});
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error);
    }).catch(e=>{ dbp=null; throw e; });
    return dbp;
  }
  async function dbTx(mode,fn){
    try{
      const d=await db();
      return await new Promise((resolve,reject)=>{
        const tx=d.transaction(DB_STORE,mode), st=tx.objectStore(DB_STORE);
        let result; const req=fn(st); if(req) req.onsuccess=()=>{ result=req.result; };
        tx.oncomplete=()=>resolve(result); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
      });
    }catch(e){ console.warn('Doc Scanner storage unavailable',e); return null; }
  }
  function pageRecord(p){
    return {id:p.id,srcBlob:p.srcBlob,outBlob:p.outBlob,outW:p.outW,outH:p.outH,rotation:p.rotation,corners:p.corners,filter:p.filter,origin:p.origin,name:p.name,ocr:p.ocr};
  }
  function savePage(p){ return dbTx('readwrite',st=>st.put(pageRecord(p))); }
  function deletePageRecord(id){ return dbTx('readwrite',st=>st.delete(id)); }
  function clearRecords(){ return dbTx('readwrite',st=>st.clear()); }
  function saveOrder(){ store.set(ORDER_KEY,pages.map(p=>p.id)); }
  async function restoreSession(){
    if(restored) return; restored=true;
    const all=await dbTx('readonly',st=>st.getAll());
    if(!all||!all.length) return;
    const order=store.get(ORDER_KEY,[])||[];
    all.sort((a,b)=>{ const ia=order.indexOf(a.id), ib=order.indexOf(b.id); return (ia<0?1e9:ia)-(ib<0?1e9:ib); });
    all.forEach(r=>{ if(r.outBlob&&r.srcBlob) pages.push(Object.assign({selected:false},r)); });
    restoreNote=pages.length;
    renderPages();
  }

  // ------------------------------------------------------------- busy bar
  function setBusy(text,frac){
    busy=true;
    const box=$('dsBusy'); if(!box) return;
    box.hidden=false;
    $('dsBusyText').textContent=text||'Working…';
    const bar=$('dsBusyBar');
    if(frac==null){ bar.style.width='100%'; bar.classList.add('ds-indet'); }
    else { bar.classList.remove('ds-indet'); bar.style.width=Math.round(clamp01(frac)*100)+'%'; }
  }
  function clearBusy(){ busy=false; const box=$('dsBusy'); if(box) box.hidden=true; }
  function guardBusy(){ if(busy){ toast('Still working — one moment…'); return true; } return false; }
  const nextFrame=()=>new Promise(r=>setTimeout(r,16));

  // ------------------------------------------------------------ page ops
  function defaultFilter(){ const f=store.get(K('Filter'),'document'); return FILTER_NAME[f]?f:'document'; }
  async function finishPage(page,outCanvas){
    page.outBlob=await canvasToBlob(outCanvas,0.9);
    page.outW=outCanvas.width; page.outH=outCanvas.height;
    if(page.thumbUrl){ URL.revokeObjectURL(page.thumbUrl); page.thumbUrl=null; }
  }
  // base = upright source canvas (already ≤ SRC_MAX)
  async function addPageFromBase(base,corners,filter,meta,srcBlob){
    const page={id:uid(),rotation:0,corners:isFullFrame(corners)?null:corners,filter,origin:meta.origin||'photo',name:meta.name||'',ocr:null,selected:false};
    page.srcBlob=srcBlob||await canvasToBlob(base,0.92);
    if(!page.corners&&filter==='original'&&srcBlob){
      page.outBlob=srcBlob; page.outW=base.width; page.outH=base.height;
    } else {
      const out=renderOutput(base,page.corners,filter,SRC_MAX);
      await finishPage(page,out); freeCanvas(out);
    }
    pages.push(page);
    await savePage(page); saveOrder();
    return page;
  }
  async function rotatePage(page,deg){
    const c=await blobToCanvas(page.outBlob);
    const r=rotateCanvas(c,deg);
    await finishPage(page,r);
    freeCanvas(c); if(r!==c) freeCanvas(r);
    page.rotation=((page.rotation||0)+deg+360)%360;
    page.corners=rotateCornersNorm(page.corners,deg);
    page.ocr=null;
    await savePage(page);
  }
  async function removePages(list){
    for(const p of list){
      const i=pages.indexOf(p); if(i>=0) pages.splice(i,1);
      if(p.thumbUrl) URL.revokeObjectURL(p.thumbUrl);
      await deletePageRecord(p.id);
    }
    saveOrder(); renderPages();
  }
  function movePage(from,to){
    if(to<0||to>=pages.length||from===to) return;
    const [p]=pages.splice(from,1); pages.splice(to,0,p);
    saveOrder(); renderPages();
  }
  function workingSet(){ const sel=pages.filter(p=>p.selected); return sel.length?sel:pages.slice(); }

  // ------------------------------------------------------------ page list
  function renderPages(){
    const wrap=$('dsPages'); if(!wrap) return;
    wrap.innerHTML='';
    const has=pages.length>0;
    ['dsPagesCard','dsExportCard','dsTextCard'].forEach(id=>{ const e=$(id); if(e) e.hidden=!has; });
    $('dsCount').textContent=has?`(${pages.length})`:'';
    const selCount=pages.filter(p=>p.selected).length;
    $('dsDelSel').hidden=!selCount;
    $('dsSelNone').hidden=!selCount;
    $('dsSelHint').textContent=!has?'':selCount
      ? `${selCount} of ${pages.length} selected — Save, Share, Print and Read Text use just the selected pages.`
      : 'Tap a page to fix its crop or look. Tick pages to save or share only some of them. On a computer you can drag pages to reorder.';
    pages.forEach((p,i)=>{
      if(!p.thumbUrl) p.thumbUrl=URL.createObjectURL(p.outBlob);
      const card=document.createElement('div');
      card.className='ds-page'+(p.selected?' selected':'');
      card.draggable=true; card.dataset.index=i;

      const top=document.createElement('label'); top.className='ds-pick';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!p.selected;
      cb.onchange=()=>{ p.selected=cb.checked; renderPages(); };
      const num=document.createElement('b'); num.textContent='Page '+(i+1);
      top.append(cb,num);

      const img=document.createElement('img'); img.className='ds-thumb'; img.src=p.thumbUrl; img.alt='Page '+(i+1);
      img.title='Tap to adjust'; img.onclick=()=>{ if(!guardBusy()) editPage(p); };

      const meta=document.createElement('div'); meta.className='ds-page-meta';
      const from={camera:'Camera',photo:'Photo',pdf:'PDF'}[p.origin]||'';
      meta.textContent=[FILTER_NAME[p.filter]||'Original',from,p.ocr?'Text read':''].filter(Boolean).join(' · ');

      const acts=document.createElement('div'); acts.className='ds-page-actions';
      const mk=(label,title,fn,disabled)=>{ const b=document.createElement('button'); b.type='button'; b.className='ghost'; b.textContent=label; b.title=title; b.setAttribute('aria-label',title); b.disabled=!!disabled; b.onclick=async()=>{ if(guardBusy()) return; await fn(); }; return b; };
      acts.append(
        mk('Edit','Adjust crop and look',()=>editPage(p)),
        mk('⟳','Rotate right',async()=>{ setBusy('Rotating…'); try{ await rotatePage(p,90); }finally{ clearBusy(); } renderPages(); }),
        mk('‹','Move earlier',()=>movePage(i,i-1),i===0),
        mk('›','Move later',()=>movePage(i,i+1),i===pages.length-1),
        mk('✕','Remove page',()=>{ if(confirm('Remove page '+(i+1)+'?')) removePages([p]); })
      );
      card.append(top,img,meta,acts);

      card.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/x-ds-page',String(i)); e.dataTransfer.effectAllowed='move'; card.classList.add('dragging'); });
      card.addEventListener('dragend',()=>card.classList.remove('dragging'));
      card.addEventListener('dragover',e=>{ if([...e.dataTransfer.types].includes('text/x-ds-page')){ e.preventDefault(); card.classList.add('drop-target'); } });
      card.addEventListener('dragleave',()=>card.classList.remove('drop-target'));
      card.addEventListener('drop',e=>{
        const from=e.dataTransfer.getData('text/x-ds-page'); if(from==='') return;
        e.preventDefault(); e.stopPropagation(); card.classList.remove('drop-target');
        movePage(Number(from),i);
      });
      wrap.append(card);
    });
    const nameEl=$('dsName'); if(nameEl&&!nameEl.value) nameEl.placeholder=defaultName();
    refreshTextOut();
  }

  // ------------------------------------------------------------- importing
  function isPdf(f){ return f.type==='application/pdf'||/\.pdf$/i.test(f.name||''); }
  function isImage(f){ return /^image\//.test(f.type)||/\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(f.name||''); }
  async function importFiles(fileList){
    if(guardBusy()) return;
    const files=[...(fileList||[])].filter(f=>isPdf(f)||isImage(f));
    const skipped=(fileList?fileList.length:0)-files.length;
    if(!files.length){ if(skipped) toast('Only photos and PDFs can be added here.'); return; }
    // One photo → straight into the editor so its crop can be checked.
    if(files.length===1&&isImage(files[0])){
      try{
        setBusy('Opening photo…');
        const img=await loadImage(files[0]);
        const base=drawScaled(img,img.naturalWidth,img.naturalHeight,SRC_MAX);
        clearBusy();
        openEditor({base,origin:'photo',name:files[0].name,detect:true});
      }catch(e){ clearBusy(); alert(e.message); }
      return;
    }
    let added=0, failed=0;
    const total=files.length;
    for(let fi=0;fi<total;fi++){
      const f=files[fi];
      try{
        if(isPdf(f)){
          added+=await importPdf(f,(pg,n)=>setBusy(`Reading ${f.name} — page ${pg} of ${n}`,(fi+pg/n)/total));
        } else {
          setBusy(`Adding photo ${fi+1} of ${total}…`,fi/total);
          const img=await loadImage(f);
          const base=drawScaled(img,img.naturalWidth,img.naturalHeight,SRC_MAX);
          let corners=await detectCornersNorm(base,fi===0?20000:4000);
          if(corners&&quadArea(corners)>0.85) corners=null; // already a flat scan/screenshot
          await addPageFromBase(base,corners,defaultFilter(),{origin:'photo',name:f.name});
          freeCanvas(base); added++;
        }
      }catch(e){ console.error(e); failed++; if(failed===1) alert(`${f.name}: ${e.message||e}`); }
      await nextFrame();
    }
    clearBusy(); renderPages();
    toast(`${added} page${added===1?'':'s'} added`+(failed?` — ${failed} file${failed===1?'':'s'} couldn't be read`:'')+(skipped?` — ${skipped} skipped`:''));
    scrollToPages();
  }
  async function importPdf(file,progress){
    progress(0,1);
    const lib=await loadPdfJs();
    const buf=await file.arrayBuffer();
    let pdf;
    try{ pdf=await lib.getDocument({data:buf}).promise; }
    catch(e){ throw new Error(/password/i.test(e.message||e.name||'')?'That PDF is password-protected.':'That PDF could not be opened.'); }
    let n=pdf.numPages, count=0;
    if(n>PDF_PAGE_LIMIT&&!confirm(`${file.name} has ${n} pages. Bring in the first ${PDF_PAGE_LIMIT}?`)){ pdf.destroy(); return 0; }
    n=Math.min(n,PDF_PAGE_LIMIT);
    const base=file.name.replace(/\.pdf$/i,'');
    for(let i=1;i<=n;i++){
      progress(i,n);
      const page=await pdf.getPage(i);
      const vp1=page.getViewport({scale:1});
      const scale=Math.min(3,2000/Math.max(vp1.width,vp1.height));
      const vp=page.getViewport({scale});
      const c=newCanvas(vp.width,vp.height); const x=c.getContext('2d');
      x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
      await page.render({canvasContext:x,viewport:vp}).promise;
      const blob=await canvasToBlob(c,0.9);
      await addPageFromBase(c,null,'original',{origin:'pdf',name:`${base} p${i}`},blob);
      freeCanvas(c); page.cleanup(); count++;
      await nextFrame();
    }
    pdf.destroy();
    return count;
  }
  function scrollToPages(){ const c=$('dsPagesCard'); if(c&&!c.hidden) c.scrollIntoView({behavior:'smooth',block:'start'}); }

  // ---------------------------------------------------------------- editor
  const ed={open:false,page:null,base:null,rotation:0,oriented:null,previewSrc:null,corners:null,filter:'document',fromCamera:false,origin:'photo',name:'',scale:1,drag:-1,timer:null,detectToken:0};
  async function editPage(page){
    try{
      setBusy('Opening page…');
      const base=await blobToCanvas(page.srcBlob);
      clearBusy();
      openEditor({base,page,rotation:page.rotation||0,corners:page.corners,filter:page.filter,origin:page.origin,name:page.name});
    }catch(e){ clearBusy(); alert(e.message); }
  }
  function openEditor(o){
    closeEditorCanvases();
    ed.open=true; ed.page=o.page||null; ed.base=o.base; ed.rotation=o.rotation||0;
    ed.filter=o.filter||(o.origin==='pdf'?'original':defaultFilter());
    ed.fromCamera=!!o.fromCamera; ed.origin=o.origin||'photo'; ed.name=o.name||'';
    buildOriented();
    ed.corners=o.corners?o.corners.map(p=>({...p})):(o.detect?insetCorners():fullCorners());
    const edEl=$('dsEditor'); edEl.hidden=false;
    $('dsEdTitle').textContent=ed.page?`Adjust page ${pages.indexOf(ed.page)+1}`:'Adjust page';
    $('dsSave').textContent=ed.fromCamera?'Keep & Scan Next':(ed.page?'Save Changes':'Add Page');
    $('dsSaveFinish').hidden=!ed.fromCamera;
    $('dsCancel').textContent=ed.fromCamera?'Retake':'Cancel';
    renderFilterChips();
    sizeCropCanvas(); drawCrop(); schedulePreview(0);
    if(!ed.fromCamera) edEl.scrollIntoView({behavior:'smooth',block:'start'});
    if(o.detect) runDetect(true);
    else setEdHint(ed.page?'Drag the corners to change the crop, or pick a different look.':'Drag the corners to match the page edges.');
  }
  function closeEditorCanvases(){
    if(ed.oriented&&ed.oriented!==ed.base) freeCanvas(ed.oriented);
    if(ed.base) freeCanvas(ed.base);
    if(ed.previewSrc) freeCanvas(ed.previewSrc);
    ed.base=ed.oriented=ed.previewSrc=null;
  }
  function closeEditor(){
    ed.open=false; clearTimeout(ed.timer); ed.detectToken++;
    closeEditorCanvases();
    const e=$('dsEditor'); if(e) e.hidden=true;
  }
  function buildOriented(){
    if(ed.oriented&&ed.oriented!==ed.base) freeCanvas(ed.oriented);
    if(ed.previewSrc) freeCanvas(ed.previewSrc);
    ed.oriented=rotateCanvas(ed.base,ed.rotation);
    ed.previewSrc=drawScaled(ed.oriented,ed.oriented.width,ed.oriented.height,PREVIEW_MAX);
  }
  function setEdHint(t){ const h=$('dsEdHint'); if(h) h.textContent=t; }
  async function runDetect(initial){
    const token=++ed.detectToken;
    setEdHint(cvReady()?'Finding the page edges…':'Loading the edge finder (first time can take a few seconds)…');
    const corners=await detectCornersNorm(ed.oriented,30000);
    if(!ed.open||token!==ed.detectToken) return;
    if(corners){
      ed.corners=corners;
      setEdHint('Edges found — drag any corner if it needs a nudge.');
    } else {
      if(!initial) toast('No clean edges found — drag the corners');
      setEdHint(cvReady()?"Couldn't find clean edges — drag the corners to the page edges, or use Whole image.":'Edge finder unavailable right now — drag the corners by hand.');
    }
    drawCrop(); schedulePreview(0);
  }
  function renderFilterChips(){
    const box=$('dsFilters'); box.innerHTML='';
    FILTERS.forEach(([k,label])=>{
      const b=document.createElement('button'); b.type='button';
      b.className='ds-chip'+(ed.filter===k?' active':''); b.textContent=label;
      b.onclick=()=>{ ed.filter=k; renderFilterChips(); schedulePreview(0); };
      box.append(b);
    });
  }
  function sizeCropCanvas(){
    const c=$('dsCrop'), o=ed.oriented;
    const maxW=Math.min(760,o.width), maxH=Math.min(900,o.height);
    ed.scale=Math.min(maxW/o.width,maxH/o.height);
    c.width=Math.round(o.width*ed.scale); c.height=Math.round(o.height*ed.scale);
  }
  function drawCrop(){
    const c=$('dsCrop'); if(!c||!ed.oriented) return;
    const x=c.getContext('2d');
    x.clearRect(0,0,c.width,c.height);
    x.drawImage(ed.previewSrc,0,0,c.width,c.height);
    const p=ed.corners.map(q=>({x:q.x*c.width,y:q.y*c.height}));
    // dim everything outside the page
    x.save(); x.fillStyle='rgba(0,0,0,.45)';
    x.beginPath(); x.rect(0,0,c.width,c.height);
    x.moveTo(p[0].x,p[0].y); for(let i=3;i>=0;i--) x.lineTo(p[i].x,p[i].y); x.closePath();
    x.fill('evenodd'); x.restore();
    x.strokeStyle='#c8102e'; x.lineWidth=3;
    x.beginPath(); x.moveTo(p[0].x,p[0].y); p.slice(1).forEach(q=>x.lineTo(q.x,q.y)); x.closePath(); x.stroke();
    const r=Math.max(12,Math.round(c.width/40));
    p.forEach((q,i)=>{
      x.beginPath(); x.arc(q.x,q.y,r,0,Math.PI*2);
      x.fillStyle=i===ed.drag?'#c8102e':'#fff'; x.fill();
      x.lineWidth=3; x.strokeStyle='#c8102e'; x.stroke();
    });
  }
  function schedulePreview(delay){
    clearTimeout(ed.timer);
    ed.timer=setTimeout(drawPreview,delay==null?140:delay);
  }
  function drawPreview(){
    if(!ed.open||!ed.previewSrc) return;
    const out=renderOutput(ed.previewSrc,ed.corners,ed.filter,PREVIEW_MAX);
    const pv=$('dsPreview');
    const maxW=380, s=Math.min(1,maxW/out.width,520/out.height);
    pv.width=Math.round(out.width*s); pv.height=Math.round(out.height*s);
    const x=pv.getContext('2d'); x.imageSmoothingQuality='high';
    x.drawImage(out,0,0,pv.width,pv.height);
    freeCanvas(out);
  }
  function cropPoint(e){
    const c=$('dsCrop'), r=c.getBoundingClientRect();
    return {x:(e.clientX-r.left)*(c.width/r.width), y:(e.clientY-r.top)*(c.height/r.height), k:c.width/r.width};
  }
  function onCropDown(e){
    if(!ed.open) return;
    const p=cropPoint(e), c=$('dsCrop');
    let best=-1, bd=Infinity;
    ed.corners.forEach((q,i)=>{ const d=Math.hypot(q.x*c.width-p.x,q.y*c.height-p.y); if(d<bd){ bd=d; best=i; } });
    if(bd<48*p.k){
      ed.drag=best; e.preventDefault();
      try{ c.setPointerCapture(e.pointerId); }catch(err){}
      drawCrop(); updateLoupe(p);
    }
  }
  function onCropMove(e){
    if(ed.drag<0) return;
    e.preventDefault();
    const p=cropPoint(e), c=$('dsCrop');
    ed.corners[ed.drag]={x:clamp01(p.x/c.width),y:clamp01(p.y/c.height)};
    drawCrop(); updateLoupe(p); schedulePreview();
  }
  function onCropUp(){
    if(ed.drag<0) return;
    ed.drag=-1;
    // keep TL/TR/BR/BL order if a corner was dragged past another
    ed.corners=orderCorners(ed.corners);
    $('dsLoupe').hidden=true; drawCrop(); schedulePreview(0);
  }
  function updateLoupe(p){
    const loupe=$('dsLoupe'), c=$('dsCrop'); if(!loupe||!c) return;
    const Z=3, S=loupe.width/Z, x=loupe.getContext('2d');
    x.clearRect(0,0,loupe.width,loupe.height);
    x.save(); x.beginPath(); x.arc(loupe.width/2,loupe.height/2,loupe.width/2,0,Math.PI*2); x.clip();
    x.fillStyle='#000'; x.fillRect(0,0,loupe.width,loupe.height);
    // sample the clean image (not the handles) for an accurate look
    const o=ed.previewSrc, sx=p.x/c.width*o.width, sy=p.y/c.height*o.height, ss=S/c.width*o.width;
    x.drawImage(o,sx-ss/2,sy-ss/2,ss,ss,0,0,loupe.width,loupe.height);
    x.strokeStyle='#c8102e'; x.lineWidth=2; x.beginPath();
    x.moveTo(loupe.width/2-14,loupe.height/2); x.lineTo(loupe.width/2+14,loupe.height/2);
    x.moveTo(loupe.width/2,loupe.height/2-14); x.lineTo(loupe.width/2,loupe.height/2+14); x.stroke();
    x.restore();
    const rect=c.getBoundingClientRect(), wrap=c.parentElement.getBoundingClientRect();
    const dx=rect.left-wrap.left+p.x/p.k, dy=rect.top-wrap.top+p.y/p.k;
    let top=dy-loupe.height-36; if(top<0) top=dy+36;
    let left=dx-loupe.width/2; left=Math.max(0,Math.min(wrap.width-loupe.width,left));
    loupe.style.left=left+'px'; loupe.style.top=top+'px'; loupe.hidden=false;
  }
  function edRotate(deg){
    ed.rotation=((ed.rotation+deg)%360+360)%360;
    ed.corners=rotateCornersNorm(ed.corners,deg);
    buildOriented(); sizeCropCanvas(); drawCrop(); schedulePreview(0);
  }
  async function edSave(finish){
    if(!ed.open||guardBusy()) return;
    setBusy('Saving page…'); await nextFrame();
    try{
      const corners=isFullFrame(ed.corners)?null:ed.corners.map(p=>({...p}));
      const out=renderOutput(ed.oriented,corners,ed.filter,SRC_MAX);
      if(ed.origin!=='pdf') store.set(K('Filter'),ed.filter);
      if(ed.page){
        const p=ed.page;
        const changed=p.rotation!==ed.rotation||JSON.stringify(p.corners)!==JSON.stringify(corners)||p.filter!==ed.filter;
        if(changed){
          await finishPage(p,out);
          p.rotation=ed.rotation; p.corners=corners; p.filter=ed.filter; p.ocr=null;
          await savePage(p);
        }
      } else {
        const page={id:uid(),rotation:ed.rotation,corners,filter:ed.filter,origin:ed.origin,name:ed.name,ocr:null,selected:false};
        page.srcBlob=await canvasToBlob(ed.base,0.92);
        await finishPage(page,out);
        pages.push(page); await savePage(page); saveOrder();
      }
      freeCanvas(out);
      const wasCamera=ed.fromCamera;
      closeEditor(); clearBusy(); renderPages();
      if(wasCamera&&!finish&&cam.stream){ showCameraAgain(); toast(`Page ${pages.length} added`); }
      else { if(wasCamera) stopCamera(); toast('Page saved'); scrollToPages(); }
    }catch(e){ clearBusy(); alert(e.message||e); }
  }
  function edCancel(){
    const wasCamera=ed.fromCamera;
    closeEditor();
    if(wasCamera&&cam.stream) showCameraAgain();
  }

  // ---------------------------------------------------------------- camera
  const cam={stream:null,track:null,timer:null,busy:false,history:[],armed:false,last:null,cooldownUntil:0,lockQuad:null,torch:false,
    auto:store.get(K('Auto'),true)!==false, batch:store.get(K('Batch'),false)===true};
  async function openCamera(){
    if(guardBusy()) return;
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ alert('This browser cannot open the camera. Use Upload instead.'); return; }
    try{
      cam.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1920}}});
    }catch(e){
      alert('Could not open the camera: '+(e.message||e.name)+'\n\nCheck that camera permission is allowed for this site.');
      return;
    }
    cam.track=cam.stream.getVideoTracks()[0];
    const v=$('dsVideo'); v.srcObject=cam.stream;
    try{ await v.play(); }catch(e){}
    cam.torch=false;
    let caps={}; try{ caps=cam.track.getCapabilities?cam.track.getCapabilities():{}; }catch(e){}
    const tb=$('dsTorchBtn'); tb.hidden=!caps.torch; tb.textContent='Light: Off';
    try{ if(caps.focusMode&&caps.focusMode.includes('continuous')) cam.track.applyConstraints({advanced:[{focusMode:'continuous'}]}); }catch(e){}
    updateCamButtons(); updateCamCount();
    showCameraAgain();
    loadOpenCV().catch(()=>setCamStatus('Edge finder unavailable — tap the button to capture'));
  }
  function showCameraAgain(){
    $('dsCamera').hidden=false; document.body.style.overflow='hidden';
    cam.history=[]; cam.armed=false; cam.lockQuad=cam.lockQuad||null;
    $('dsSnapBtn').classList.remove('armed');
    clearInterval(cam.timer); cam.timer=setInterval(liveTick,400);
    setCamStatus('Fit the page inside the screen');
  }
  function hideCamera(){
    clearInterval(cam.timer); cam.timer=null;
    const w=$('dsCamera'); if(w) w.hidden=true;
    document.body.style.overflow='';
  }
  function stopCamera(){
    hideCamera();
    if(cam.stream){ cam.stream.getTracks().forEach(t=>t.stop()); cam.stream=null; cam.track=null; }
    cam.lockQuad=null; cam.last=null;
    const v=$('dsVideo'); if(v) v.srcObject=null;
  }
  function setCamStatus(t){ const s=$('dsCamStatus'); if(s) s.textContent=t; }
  function updateCamButtons(){
    $('dsAutoBtn').textContent='Auto capture: '+(cam.auto?'On':'Off');
    $('dsAutoBtn').classList.toggle('on',cam.auto);
    $('dsBatchBtn').textContent='Quick batch: '+(cam.batch?'On':'Off');
    $('dsBatchBtn').classList.toggle('on',cam.batch);
  }
  function updateCamCount(){
    $('dsCamCount').textContent=String(pages.length);
    const t=$('dsLastThumb'), last=pages[pages.length-1];
    if(last){ if(!last.thumbUrl) last.thumbUrl=URL.createObjectURL(last.outBlob); t.src=last.thumbUrl; t.hidden=false; } else t.hidden=true;
  }
  async function toggleTorch(){
    if(!cam.track) return;
    try{ await cam.track.applyConstraints({advanced:[{torch:!cam.torch}]}); cam.torch=!cam.torch; $('dsTorchBtn').textContent='Light: '+(cam.torch?'On':'Off'); }
    catch(e){ toast('This camera has no light control'); }
  }
  function videoRect(){
    const v=$('dsVideo'), cw=v.clientWidth, ch=v.clientHeight, vr=v.videoWidth/v.videoHeight, cr=cw/ch;
    let w,h,x,y;
    if(vr>cr){ w=cw; h=cw/vr; x=0; y=(ch-h)/2; } else { h=ch; w=ch*vr; y=0; x=(cw-w)/2; }
    return {w,h,x,y,cw,ch};
  }
  function drawOverlay(norm,state){
    const c=$('dsOverlay'), r=videoRect();
    const dpr=Math.min(2,window.devicePixelRatio||1);
    if(c.width!==Math.round(r.cw*dpr)) c.width=Math.round(r.cw*dpr);
    if(c.height!==Math.round(r.ch*dpr)) c.height=Math.round(r.ch*dpr);
    const x=c.getContext('2d'); x.setTransform(dpr,0,0,dpr,0,0);
    x.clearRect(0,0,r.cw,r.ch);
    if(!norm){
      x.setLineDash([10,10]); x.strokeStyle='rgba(255,255,255,.75)'; x.lineWidth=3;
      x.strokeRect(r.x+24,r.y+24,r.w-48,r.h-48); x.setLineDash([]);
      return;
    }
    const p=norm.map(q=>({x:r.x+q.x*r.w,y:r.y+q.y*r.h}));
    const col=state==='stable'?'#22a447':(state==='hold'?'#f2b705':'#c8102e');
    x.strokeStyle=col; x.lineWidth=4;
    x.fillStyle=state==='stable'?'rgba(34,164,71,.2)':'rgba(200,16,46,.15)';
    x.beginPath(); x.moveTo(p[0].x,p[0].y); p.slice(1).forEach(q=>x.lineTo(q.x,q.y)); x.closePath(); x.fill(); x.stroke();
  }
  function quadMoved(a,b){
    if(!a||!b) return true;
    const ca={x:(a[0].x+a[2].x)/2,y:(a[0].y+a[2].y)/2}, cb={x:(b[0].x+b[2].x)/2,y:(b[0].y+b[2].y)/2};
    return Math.hypot(ca.x-cb.x,ca.y-cb.y)>0.08||Math.abs(quadArea(a)-quadArea(b))>0.12;
  }
  function liveTick(){
    if(cam.busy||!cam.stream||ed.open) return;
    const v=$('dsVideo'); if(!v.videoWidth) return;
    if(!cvReady()){ drawOverlay(null); setCamStatus(cam.auto?'Loading the edge finder… you can still tap capture':'Fit the page inside the screen'); return; }
    cam.busy=true;
    try{
      const s=420/v.videoWidth, c=newCanvas(v.videoWidth*s,v.videoHeight*s);
      c.getContext('2d').drawImage(v,0,0,c.width,c.height);
      let pts=null; try{ pts=DocAutoDetect.detectCorners(c); }catch(e){}
      const W=c.width,H=c.height; freeCanvas(c);
      if(!pts){ cam.history=[]; cam.last=null; cam.lockQuad=null; disarm(); drawOverlay(null); setCamStatus('Looking for the page…'); return; }
      const norm=orderCorners(pts.map(p=>({x:clamp01(p.x/W),y:clamp01(p.y/H)})));
      cam.last=norm;
      const area=quadArea(norm);
      cam.history.push({cx:(norm[0].x+norm[2].x)/2,cy:(norm[0].y+norm[2].y)/2,area});
      if(cam.history.length>4) cam.history.shift();
      const spread=k=>Math.max(...cam.history.map(h=>h[k]))-Math.min(...cam.history.map(h=>h[k]));
      const stable=cam.history.length>=4&&area>=0.12&&spread('cx')<0.025&&spread('cy')<0.025&&spread('area')<0.05;
      // after a capture, wait for the next page (the quad changes) before auto-capturing again
      if(cam.lockQuad&&quadMoved(cam.lockQuad,norm)) cam.lockQuad=null;
      const locked=!!cam.lockQuad||Date.now()<cam.cooldownUntil;
      if(area<0.12){ drawOverlay(norm,'far'); setCamStatus('Move closer to the page'); disarm(); return; }
      if(!stable){ drawOverlay(norm,'hold'); setCamStatus('Hold steady…'); disarm(); return; }
      drawOverlay(norm,'stable');
      if(!cam.auto){ setCamStatus('Page found — tap capture'); return; }
      if(locked){ setCamStatus('Captured — put the next page down'); return; }
      if(!cam.armed){
        cam.armed=true; $('dsSnapBtn').classList.add('armed'); setCamStatus('Capturing…');
        setTimeout(()=>{ if(cam.armed&&cam.timer) capture(true); },350);
      }
    }finally{ cam.busy=false; }
  }
  function disarm(){ if(cam.armed){ cam.armed=false; $('dsSnapBtn').classList.remove('armed'); } }
  async function capture(auto){
    const v=$('dsVideo'); if(!v||!v.videoWidth||busyCapture) return;
    busyCapture=true; disarm();
    try{
      const base=drawScaled(v,v.videoWidth,v.videoHeight,SRC_MAX);
      flash();
      const hint=cam.last?cam.last.map(p=>({...p})):null;
      cam.lockQuad=hint; cam.cooldownUntil=Date.now()+1500;
      if(cam.batch){
        let corners=hint||await detectCornersNorm(base,0);
        if(corners){
          setCamStatus('Saving page…');
          await addPageFromBase(base,corners,defaultFilter(),{origin:'camera',name:''});
          freeCanvas(base); renderPages(); updateCamCount();
          setCamStatus(`Page ${pages.length} added — next page`);
          return;
        }
      }
      hideCamera();
      openEditor({base,fromCamera:true,origin:'camera',corners:hint,detect:!hint});
    }catch(e){ alert(e.message||e); }
    finally{ busyCapture=false; }
  }
  let busyCapture=false;
  function flash(){ const f=$('dsFlash'); if(!f) return; f.hidden=false; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); setTimeout(()=>{ f.hidden=true; },350); }

  // ------------------------------------------------------- text reading
  let ocrWorker=null, ocrLang=null, ocrCb=null;
  async function getWorker(lang){
    if(!window.Tesseract) throw new Error('The text reader did not load — check your internet connection and reload.');
    if(ocrWorker&&ocrLang===lang) return ocrWorker;
    if(ocrWorker){ try{ await ocrWorker.terminate(); }catch(e){} ocrWorker=null; }
    ocrWorker=await Tesseract.createWorker(lang,1,{logger:m=>{ if(ocrCb) ocrCb(m); }});
    ocrLang=lang;
    return ocrWorker;
  }
  function collectWords(data){
    const out=[];
    const push=w=>{ if(w&&w.text&&w.bbox&&w.text.trim()) out.push({t:w.text,x0:w.bbox.x0,y0:w.bbox.y0,x1:w.bbox.x1,y1:w.bbox.y1}); };
    if(Array.isArray(data.words)&&data.words.length){ data.words.forEach(push); return out; }
    (data.blocks||[]).forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>(l.words||[]).forEach(push))));
    return out;
  }
  async function readText(list,label){
    const lang=$('dsLang').value||'eng';
    const todo=list.filter(p=>!p.ocr||p.ocr.lang!==lang);
    if(!todo.length) return true;
    let idx=0;
    ocrCb=m=>{
      if(m.status==='recognizing text') setBusy(`${label||'Reading text'} — page ${idx+1} of ${todo.length}`,(idx+(m.progress||0))/todo.length);
      else if(/load|initializ/i.test(m.status||'')) setBusy('Loading the text reader (first time is slower)…',null);
    };
    try{
      setBusy('Loading the text reader…',null);
      const worker=await getWorker(lang);
      for(idx=0;idx<todo.length;idx++){
        const p=todo[idx];
        setBusy(`${label||'Reading text'} — page ${idx+1} of ${todo.length}`,idx/todo.length);
        const {data}=await worker.recognize(p.outBlob,{},{text:true,blocks:true});
        p.ocr={lang,text:(data.text||'').trim(),words:collectWords(data),w:p.outW,h:p.outH,conf:Math.round(data.confidence||0)};
        await savePage(p);
      }
      return true;
    }catch(e){
      console.error(e); alert('Reading text failed: '+(e.message||e)); return false;
    }finally{ ocrCb=null; clearBusy(); renderPages(); }
  }
  let textDirty=false;
  function refreshTextOut(){
    const out=$('dsTextOut'); if(!out) return;
    const read=pages.filter(p=>p.ocr);
    out.hidden=!read.length;
    const btn=$('dsOcrBtn');
    if(btn){
      const sel=pages.filter(p=>p.selected).length;
      btn.textContent=sel?`Read Text (${sel} selected)`:(pages.length>1?`Read Text (all ${pages.length} pages)`:'Read Text');
    }
    if(!read.length) return;
    if(!textDirty){
      $('dsText').value=pages.map((p,i)=>p.ocr?`--- Page ${i+1} ---\n${p.ocr.text||'(no text found)'}`:null).filter(Boolean).join('\n\n');
    }
    const low=read.filter(p=>p.ocr.conf&&p.ocr.conf<60).length;
    $('dsOcrNote').textContent=low?`${low} page${low===1?'':'s'} read poorly — try the Document look, better light, or a closer shot.`:'';
    renderFields();
  }

  // Key fields — pattern matching over the read text. Heuristic on purpose:
  // it lists what *looks* like a BOL/PO/PRO number etc. so it can be copied,
  // not a guarantee. Everything shown can be checked against the page.
  const ID='([A-Z0-9][A-Z0-9\\-\\/]{2,24})';
  const SEP='(?![A-Z])[ \\t]*(?:NO\\.?|NUMBER|NUM|NBR|#|ID)?[ \\t]*[:#.]?[ \\t]*';
  const FIELD_RULES=[
    ['BOL #',new RegExp('\\b(?:B\\/L|BOL|BILL\\s+OF\\s+LADING)'+SEP+ID,'gi')],
    ['PO #',new RegExp('\\b(?:P\\.?\\s?O\\.?|PURCHASE\\s+ORDER|CUST(?:OMER)?\\s+P\\.?O\\.?)(?!\\s*BOX)'+SEP+ID,'gi')],
    ['PRO #',new RegExp('\\bPRO'+SEP+ID,'gi')],
    ['Seal #',new RegExp('\\bSEALS?'+SEP+ID,'gi')],
    ['Trailer #',new RegExp('\\b(?:TRAILER|TRLR|TRL)'+SEP+ID,'gi')],
    ['Load / Order #',new RegExp('\\b(?:LOAD|SHIPMENT|DELIVERY|ORDER|SALES\\s+ORDER|SO|PICK\\s+TICKET)\\s*(?:NO\\.?|NUMBER|NUM|NBR|#|ID)[ \\t]*[:#.]?[ \\t]*'+ID,'gi')],
    ['Reference #',new RegExp('\\bREF(?:ERENCE)?'+SEP+ID,'gi')],
    ['Tracking #',/\b(1Z[0-9A-Z]{16})\b/gi],
    ['Date',/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{4}|\d{2}))\b/g],
    ['Date',/\b((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi],
    ['Weight',/\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(LBS?|POUNDS|KGS?|KILOS?)\b/gi],
    ['Count',/\b(\d{1,4})\s*(PALLETS?|PLTS?|SKIDS?|PIECES|PCS|CARTONS|CTNS|CASES|UNITS)\b/gi],
    ['Phone',/(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/g],
    ['Email',/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi]
  ];
  function validDate(s){
    const m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); if(!m) return true;
    const a=+m[1], b=+m[2];
    return a>=1&&b>=1&&((a<=12&&b<=31)||(b<=12&&a<=31));
  }
  function extractFields(){
    const found=[], seen=new Set();
    pages.forEach((p,pi)=>{
      if(!p.ocr||!p.ocr.text) return;
      const text=p.ocr.text.replace(/[|]/g,' ');
      FIELD_RULES.forEach(([label,re])=>{
        re.lastIndex=0; let m;
        while((m=re.exec(text))){
          let v;
          if(label==='Weight'||label==='Count') v=m[1]+' '+m[2].toUpperCase();
          else if(label==='Phone') v=`(${m[1]}) ${m[2]}-${m[3]}`;
          else v=(m[1]||'').replace(/[.,:;\-\/]+$/,'');
          const reject=!v||(label!=='Email'&&label!=='Date'&&!/\d/.test(v))||(label==='Date'&&!validDate(v));
          if(reject){ re.lastIndex=m.index+1; continue; }
          const key=label+'|'+v.toUpperCase();
          if(seen.has(key)){ const f=found.find(x=>x.key===key); if(f&&!f.pages.includes(pi+1)) f.pages.push(pi+1); continue; }
          seen.add(key); found.push({key,label,value:v,pages:[pi+1]});
        }
      });
    });
    return found;
  }
  function renderFields(){
    const pane=$('dsFieldsPane'); if(!pane) return;
    const fields=extractFields();
    pane.innerHTML='';
    if(!fields.length){ pane.innerHTML='<p class="hint">No BOL, PO, PRO, seal, date, weight or phone numbers spotted. The Full Text tab has everything that was read.</p>'; return; }
    const tbl=document.createElement('table'); tbl.className='ds-fields';
    tbl.innerHTML='<thead><tr><th>Field</th><th>Value</th><th>Page</th><th></th></tr></thead>';
    const tb=document.createElement('tbody');
    fields.forEach(f=>{
      const tr=document.createElement('tr');
      const td=t=>{ const d=document.createElement('td'); d.textContent=t; return d; };
      const val=td(f.value); val.className='ds-val';
      const cp=document.createElement('td'); const b=document.createElement('button'); b.type='button'; b.className='ghost ds-sm'; b.textContent='Copy';
      b.onclick=()=>copyText(f.value,f.label+' copied');
      cp.append(b);
      tr.append(td(f.label),val,td(f.pages.join(', ')),cp);
      tb.append(tr);
    });
    tbl.append(tb); pane.append(tbl);
    const acts=document.createElement('div'); acts.className='actions';
    const all=document.createElement('button'); all.type='button'; all.className='ghost'; all.textContent='Copy all fields';
    all.onclick=()=>copyText(fields.map(f=>`${f.label}\t${f.value}\tp${f.pages.join(',')}`).join('\n'),'Fields copied — paste into Excel or an email');
    const csv=document.createElement('button'); csv.type='button'; csv.className='ghost'; csv.textContent='Download CSV';
    csv.onclick=()=>{
      const q=s=>'"'+String(s).replace(/"/g,'""')+'"';
      const body='Field,Value,Pages\r\n'+fields.map(f=>[f.label,f.value,f.pages.join(' ')].map(q).join(',')).join('\r\n');
      downloadBlob(new Blob([body],{type:'text/csv'}),fileBase()+'-fields.csv');
    };
    acts.append(all,csv); pane.append(acts);
  }
  function copyText(t,msg){
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(()=>toast(msg||'Copied')).catch(()=>fallbackCopy(t,msg));
    else fallbackCopy(t,msg);
  }
  function fallbackCopy(t,msg){
    const ta=document.createElement('textarea'); ta.value=t; ta.style.position='fixed'; ta.style.opacity='0'; document.body.append(ta); ta.select();
    try{ document.execCommand('copy'); toast(msg||'Copied'); }catch(e){ alert(t); } ta.remove();
  }

  // ------------------------------------------------------------- exports
  function pad(n){ return String(n).padStart(2,'0'); }
  function defaultName(){ const d=new Date(); return `Scan_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; }
  function fileBase(){ const v=($('dsName').value||'').trim(); return (v.replace(/[\\\/:*?"<>|]+/g,'').replace(/\s+/g,' ').trim()||defaultName()).slice(0,120); }
  function downloadBlob(blob,name){
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=name; document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function exportOpts(){
    return {size:$('dsSize').value,quality:$('dsQuality').value,searchable:$('dsSearchable').checked};
  }
  function addTextLayer(doc,ocr,ox,oy,s){
    doc.setFont('helvetica','normal');
    for(const w of ocr.words){
      const t=String(w.t).replace(/[^\x20-\x7E -ÿ]/g,'').trim(); if(!t) continue;
      const bw=(w.x1-w.x0)*s, bh=(w.y1-w.y0)*s; if(bw<=0||bh<=0) continue;
      const uw=doc.getStringUnitWidth(t);
      let fs=uw>0?bw/uw:bh; fs=Math.max(1,Math.min(fs,bh*1.6));
      doc.setFontSize(fs);
      try{ doc.text(t+' ',ox+w.x0*s,oy+w.y1*s-bh*0.18,{renderingMode:'invisible'}); }catch(e){}
    }
  }
  let lastPdf=null; // {key,blob,name}
  function stateKey(list,opts){ return JSON.stringify([list.map(p=>p.id+':'+p.outBlob.size+':'+(p.ocr?1:0)),opts,fileBase()]); }
  async function buildPdf(list,opts){
    if(!window.jspdf||!window.jspdf.jsPDF){ throw new Error('The PDF maker did not load — check your internet connection and reload.'); }
    if(opts.searchable){ const ok=await readText(list,'Making it searchable'); if(!ok) throw new Error('Text reading stopped, so the PDF was not made.'); }
    const {jsPDF}=window.jspdf, Q=QUALITY[opts.quality]||QUALITY.standard;
    let doc=null;
    for(let i=0;i<list.length;i++){
      setBusy(`Building PDF — page ${i+1} of ${list.length}`,i/list.length); await nextFrame();
      const p=list[i];
      const img=await loadImage(p.outBlob);
      const W=img.naturalWidth, H=img.naturalHeight, ratio=W/H;
      const c=drawScaled(img,W,H,Q.max);
      const data=c.toDataURL('image/jpeg',p.filter==='bw'?Math.max(Q.q,0.8):Q.q);
      freeCanvas(c);
      let pw,ph,margin;
      if(opts.size==='fit'){ if(ratio>=1){ pw=792; ph=792/ratio; } else { ph=792; pw=792*ratio; } margin=0; }
      else { const sz=PAGE_SIZES[opts.size]||PAGE_SIZES.letter; [pw,ph]=ratio>1.05?[sz[1],sz[0]]:sz; margin=18; }
      const orient=pw>ph?'l':'p';
      if(!doc) doc=new jsPDF({unit:'pt',format:[pw,ph],orientation:orient,compress:true});
      else doc.addPage([pw,ph],orient);
      const mw=pw-margin*2, mh=ph-margin*2;
      let w=mw, h=w/ratio; if(h>mh){ h=mh; w=h*ratio; }
      const x=(pw-w)/2, y=(ph-h)/2;
      doc.addImage(data,'JPEG',x,y,w,h,undefined,'FAST');
      if(opts.searchable&&p.ocr&&p.ocr.words&&p.ocr.words.length) addTextLayer(doc,p.ocr,x,y,w/(p.ocr.w||W));
    }
    doc.setProperties({title:fileBase(),creator:'LWH Warehouse Toolkit'});
    return doc.output('blob');
  }
  async function getPdf(){
    const list=workingSet(), opts=exportOpts(), key=stateKey(list,opts);
    if(lastPdf&&lastPdf.key===key) return lastPdf;
    const blob=await buildPdf(list,opts);
    lastPdf={key:stateKey(list,opts),blob,name:fileBase()+'.pdf',count:list.length};
    return lastPdf;
  }
  function noteExport(r){
    const n=$('dsExportNote');
    n.textContent=`PDF ready — ${r.count} page${r.count===1?'':'s'}, ${fmtBytes(r.blob.size)}.`+(r.blob.size>20*1048576?' That is too big for most email — pick "Small" under File size.':'');
  }
  async function downloadPdf(){
    if(!pages.length||guardBusy()) return;
    try{ setBusy('Building PDF…',0); const r=await getPdf(); clearBusy(); downloadBlob(r.blob,r.name); noteExport(r); toast('PDF downloaded'); }
    catch(e){ clearBusy(); alert(e.message||e); }
  }
  async function sharePdf(){
    if(!pages.length||guardBusy()) return;
    let r;
    try{ setBusy('Building PDF…',0); r=await getPdf(); clearBusy(); noteExport(r); }
    catch(e){ clearBusy(); alert(e.message||e); return; }
    const file=new File([r.blob],r.name,{type:'application/pdf'});
    if(!(navigator.canShare&&navigator.canShare({files:[file]}))){ downloadBlob(r.blob,r.name); toast('Sharing not available here — downloaded instead'); return; }
    try{ await navigator.share({files:[file],title:r.name}); }
    catch(e){
      if(e&&e.name==='NotAllowedError'){ $('dsPdfShare').textContent='Share PDF (ready — tap again)'; toast('PDF is ready — tap Share PDF again'); }
    }
  }
  async function imageFiles(list){
    const base=fileBase();
    return list.map((p,i)=>new File([p.outBlob],`${base}-p${i+1}.jpg`,{type:'image/jpeg'}));
  }
  async function downloadImages(){
    if(!pages.length||guardBusy()) return;
    const files=await imageFiles(workingSet());
    files.forEach((f,i)=>setTimeout(()=>downloadBlob(f,f.name),i*350));
    toast(files.length===1?'Image downloaded':`Downloading ${files.length} images — allow multiple downloads if asked`);
  }
  async function shareImages(){
    if(!pages.length||guardBusy()) return;
    const files=await imageFiles(workingSet());
    if(navigator.canShare&&navigator.canShare({files})){ try{ await navigator.share({files,title:fileBase()}); }catch(e){} }
    else { files.forEach((f,i)=>setTimeout(()=>downloadBlob(f,f.name),i*350)); toast('Sharing not available here — downloaded instead'); }
  }
  function printPages(){
    if(!pages.length||guardBusy()) return;
    const list=workingSet();
    const urls=list.map(p=>URL.createObjectURL(p.outBlob));
    const frame=document.createElement('iframe');
    frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.append(frame);
    const d=frame.contentDocument;
    d.open();
    d.write('<!doctype html><html><head><title>'+fileBase().replace(/[<&]/g,'')+'</title><style>@page{margin:0.25in}html,body{margin:0}div{page-break-after:always;break-after:page;height:calc(100vh - 2px);display:flex;align-items:center;justify-content:center}div:last-child{page-break-after:auto;break-after:auto}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body>'+urls.map(u=>'<div><img src="'+u+'"></div>').join('')+'</body></html>');
    d.close();
    const imgs=[...d.images];
    let left=imgs.length;
    const go=()=>{ setTimeout(()=>{ try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){ alert('Printing is not available here — download the PDF and print that.'); }
      setTimeout(()=>{ frame.remove(); urls.forEach(u=>URL.revokeObjectURL(u)); },60000); },150); };
    if(!left) go(); else imgs.forEach(im=>{ const done=()=>{ if(--left===0) go(); }; if(im.complete) done(); else { im.onload=done; im.onerror=done; } });
  }

  // --------------------------------------------------------------- wiring
  function onShow(){
    // Warm the edge finder in the background so it's ready by the time
    // someone points the camera; nothing else in the Toolkit waits on it.
    setTimeout(()=>{ if(isActiveView()) loadOpenCV().catch(()=>{}); },600);
    restoreSession().then(()=>{
      if(!shownOnce&&restoreNote){ toast(`Picked up where you left off — ${restoreNote} page${restoreNote===1?'':'s'}`); }
      shownOnce=true;
    });
  }
  function init(){
    if(!$('docscan')) return;
    $('dsCameraBtn').onclick=openCamera;
    const fi=$('dsFileInput');
    $('dsUploadBtn').onclick=()=>fi.click();
    fi.addEventListener('change',e=>{ const f=e.target.files; importFiles(f).finally(()=>{ e.target.value=''; }); });

    // camera
    $('dsCamClose').onclick=stopCamera;
    $('dsCamDone').onclick=()=>{ stopCamera(); renderPages(); scrollToPages(); };
    $('dsSnapBtn').onclick=()=>capture(false);
    $('dsTorchBtn').onclick=toggleTorch;
    $('dsAutoBtn').onclick=()=>{ cam.auto=!cam.auto; store.set(K('Auto'),cam.auto); updateCamButtons(); disarm(); };
    $('dsBatchBtn').onclick=()=>{ cam.batch=!cam.batch; store.set(K('Batch'),cam.batch); updateCamButtons(); toast(cam.batch?'Quick batch on — pages are added without stopping to adjust (fix any later)':'Quick batch off — each page opens for a quick check'); };
    $('dsLastThumb').onclick=()=>{ stopCamera(); renderPages(); scrollToPages(); };

    // editor
    const crop=$('dsCrop');
    crop.addEventListener('pointerdown',onCropDown);
    crop.addEventListener('pointermove',onCropMove);
    crop.addEventListener('pointerup',onCropUp);
    crop.addEventListener('pointercancel',onCropUp);
    $('dsDetect').onclick=()=>runDetect(false);
    $('dsFull').onclick=()=>{ ed.corners=fullCorners(); setEdHint('Using the whole image.'); drawCrop(); schedulePreview(0); };
    $('dsRotL').onclick=()=>edRotate(-90);
    $('dsRotR').onclick=()=>edRotate(90);
    $('dsSave').onclick=()=>edSave(false);
    $('dsSaveFinish').onclick=()=>edSave(true);
    $('dsCancel').onclick=edCancel;

    // pages
    $('dsSelAll').onclick=()=>{ pages.forEach(p=>p.selected=true); renderPages(); };
    $('dsSelNone').onclick=()=>{ pages.forEach(p=>p.selected=false); renderPages(); };
    $('dsDelSel').onclick=()=>{ const sel=pages.filter(p=>p.selected); if(sel.length&&confirm(`Remove ${sel.length} selected page${sel.length===1?'':'s'}?`)) removePages(sel); };
    $('dsClear').onclick=async()=>{
      if(!pages.length||guardBusy()) return;
      if(!confirm(`Remove all ${pages.length} page${pages.length===1?'':'s'} and start over?`)) return;
      pages.forEach(p=>{ if(p.thumbUrl) URL.revokeObjectURL(p.thumbUrl); });
      pages.length=0; await clearRecords(); saveOrder();
      $('dsName').value=''; $('dsText').value=''; textDirty=false; lastPdf=null; $('dsExportNote').textContent='';
      renderPages(); window.scrollTo({top:0,behavior:'smooth'});
    };

    // export
    $('dsPdfDownload').onclick=downloadPdf;
    $('dsPrint').onclick=printPages;
    $('dsImgDownload').onclick=downloadImages;
    const canShareFiles=(()=>{ try{ return !!(navigator.canShare&&navigator.canShare({files:[new File([new Blob(['x'])],'t.pdf',{type:'application/pdf'})]})); }catch(e){ return false; } })();
    $('dsPdfShare').hidden=!canShareFiles; $('dsImgShare').hidden=!canShareFiles;
    $('dsPdfShare').onclick=sharePdf; $('dsImgShare').onclick=shareImages;
    if(CFG.driver&&canShareFiles){ $('dsPdfShare').classList.remove('ghost'); $('dsPdfDownload').classList.add('ghost'); $('dsPdfShare').parentNode.prepend($('dsPdfShare')); }
    $('dsSearchable').checked=store.get(K('Searchable'),false)===true;
    $('dsSearchable').onchange=e=>store.set(K('Searchable'),e.target.checked);
    $('dsSize').value=store.get(K('Size'),'letter'); $('dsSize').onchange=e=>store.set(K('Size'),e.target.value);
    $('dsQuality').value=store.get(K('Quality'),'standard'); $('dsQuality').onchange=e=>store.set(K('Quality'),e.target.value);
    ['dsSize','dsQuality','dsSearchable','dsName'].forEach(id=>$(id).addEventListener('input',()=>{ $('dsPdfShare').textContent='Share PDF'; $('dsExportNote').textContent=''; }));

    // text
    $('dsLang').value=store.get(K('Lang'),'eng'); $('dsLang').onchange=e=>store.set(K('Lang'),e.target.value);
    $('dsOcrBtn').onclick=async()=>{ if(!pages.length||guardBusy()) return; textDirty=false; await readText(workingSet()); const t=$('dsTextOut'); if(t&&!t.hidden) t.scrollIntoView({behavior:'smooth',block:'start'}); };
    $('dsText').addEventListener('input',()=>{ textDirty=true; });
    document.querySelectorAll('[data-dstab]').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('[data-dstab]').forEach(x=>x.classList.toggle('active',x===b));
      $('dsFieldsPane').hidden=b.dataset.dstab!=='fields'; $('dsTextPane').hidden=b.dataset.dstab!=='text';
    });
    $('dsCopyText').onclick=()=>copyText($('dsText').value,'Text copied');
    $('dsTxtDownload').onclick=()=>downloadBlob(new Blob([$('dsText').value.replace(/\n/g,'\r\n')],{type:'text/plain'}),fileBase()+'.txt');
    $('dsToNotes').onclick=()=>{
      const add=$('dsText').value.trim(); if(!add) return;
      const cur=store.get('notepadText','')||'';
      const next=cur?cur+'\n\n'+add:add;
      store.set('notepadText',next);
      const np=$('notepadText'); if(np) np.value=next;
      toast('Added to Warehouse Tools → Notepad');
    };

    // drag-and-drop + paste (mainly for the office)
    const sec=$('docscan'), drop=$('dsDrop');
    const hasFiles=e=>e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files');
    sec.addEventListener('dragover',e=>{ if(hasFiles(e)){ e.preventDefault(); drop.classList.add('over'); } });
    sec.addEventListener('dragleave',e=>{ if(e.target===sec||!sec.contains(e.relatedTarget)) drop.classList.remove('over'); });
    sec.addEventListener('drop',e=>{ if(!hasFiles(e)) return; e.preventDefault(); drop.classList.remove('over'); importFiles(e.dataTransfer.files); });
    drop.onclick=()=>fi.click();
    document.addEventListener('paste',e=>{
      if(!isActiveView()) return;
      const t=e.target; if(t&&(t.tagName==='TEXTAREA'||t.tagName==='INPUT')) return;
      const files=[...((e.clipboardData&&e.clipboardData.items)||[])].filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean);
      if(files.length){ e.preventDefault(); importFiles(files); }
    });
    document.addEventListener('keydown',e=>{
      if(!isActiveView()) return;
      if(e.key==='Escape'){ if(!$('dsCamera').hidden&&!ed.open) stopCamera(); else if(ed.open) edCancel(); }
      else if(e.key==='Enter'&&ed.open&&!(e.target&&/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName))){ e.preventDefault(); edSave(false); }
    });
    document.addEventListener('visibilitychange',()=>{ if(document.hidden&&cam.stream&&!ed.open) stopCamera(); });
    window.addEventListener('resize',()=>{ if(ed.open){ drawCrop(); } });

    renderPages();
    if(isActiveView()) onShow();
  }

  window.LWHDocScan={stopCamera,onShow,importFiles,loadOpenCV,_pages:pages,_filters:{applyFilter,warpPerspective,renderOutput}};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
