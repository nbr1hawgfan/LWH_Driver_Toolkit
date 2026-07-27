// Trimmed down from the Warehouse Toolkit's labels.js — kept only the shared
// print/QR helpers that Contact QR and Generate Code still depend on.
// Rack/Signs/Pallet-specific generators were removed along with those views.
function page(cls,html){const d=document.createElement('div');d.className='label-page '+cls;d.innerHTML=html;const x=+LWHStorage.get('calX',0),y=+LWHStorage.get('calY',0),sc=+LWHStorage.get('calScale',100);d.style.transform=`translate(${x}px,${y}px) scale(${sc/100})`;d.style.transformOrigin='top left';return d}
function setPrintPageSize(widthIn,heightIn){
  let style=document.getElementById('dynamicPageSize');
  if(!style){style=document.createElement('style');style.id='dynamicPageSize';document.head.appendChild(style);}
  style.textContent=(widthIn&&heightIn)?`@media print{@page{size:${widthIn}in ${heightIn}in;margin:0}}`:'';
}
function finishBarcodes(root){root.querySelectorAll('svg[data-barcode]').forEach(svg=>LWHBarcode.make(svg,svg.dataset.barcode,{height:+svg.dataset.height||80,width:+svg.dataset.width||2}));root.querySelectorAll('.qrbox[data-qr]').forEach(q=>LWHQR.make(q,q.dataset.qr,+q.dataset.size||110));}
function autoFitText(el,minPx=30){
  if(!el)return;
  const cs=getComputedStyle(el);
  const maxPx=parseFloat(el.dataset.maxFont || cs.fontSize) || 108;
  const rect=el.getBoundingClientRect();
  const padX=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0);
  const padY=(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0);
  const boxW=Math.max(10,(rect.width || el.clientWidth)-padX-10);
  const boxH=Math.max(10,(rect.height || el.clientHeight)-padY-6);
  const text=(el.textContent||'').trim();
  const canvas=autoFitText._canvas || (autoFitText._canvas=document.createElement('canvas'));
  const ctx=canvas.getContext('2d');
  let size=maxPx;
  function measure(px){ctx.font=`${cs.fontStyle} ${cs.fontWeight} ${px}px ${cs.fontFamily}`;return ctx.measureText(text).width;}
  const measured=measure(maxPx);
  if(measured>boxW) size=Math.floor(maxPx*(boxW/measured));
  size=Math.min(size,Math.floor(boxH/0.98));
  size=Math.max(minPx,Math.min(maxPx,size));
  el.style.fontSize=size+'px';
  el.style.lineHeight='0.95';
  el.style.whiteSpace='nowrap';
  el.style.overflow='hidden';
  el.style.textOverflow='clip';
  let guard=0;
  while(size>minPx && guard<40 && (el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+2)){
    size-=2; el.style.fontSize=size+'px'; guard++;
  }
}
function autoFitRackTitles(root){root.querySelectorAll('.rack-title').forEach(el=>{if(!el.dataset.maxFont)el.dataset.maxFont=parseFloat(getComputedStyle(el).fontSize);autoFitText(el,24);});requestAnimationFrame(()=>root.querySelectorAll('.rack-title').forEach(el=>autoFitText(el,24)));}
function safeAttr(v){return LWHUI.safe(String(v??''));}
function generateContact(){const out=contactOutput;out.innerHTML='';LWHUI.readFile(conLogo,logo=>{const c={name:conName.value,title:conTitle.value,company:conCompany.value,phone:conPhone.value,email:conEmail.value,website:conWebsite.value,street:conStreet.value,city:conCity.value,state:conState.value,zip:conZip.value};for(let i=0;i<(+conCopies.value||1);i++){out.append(page(`contact-card ${conLayout.value==='qronly'?'qronly':''}`,`<div class="qrbox" data-qr="${safeAttr(LWHQR.vcard(c))}" data-size="122"></div>${conLayout.value==='qronly'?'':`<div class="contact-info">${logo?`<img class="contact-logo" src="${logo}">`:''}<div class="name">${safeAttr(c.name)}</div><div>${safeAttr(c.title)}</div><div><b>${safeAttr(c.company)}</b></div>${c.phone?`<div>Cell: ${safeAttr(c.phone)}</div>`:''}<div>Office: ${safeAttr(LWHQR.COMPANY_LANDLINE)}</div><div>${safeAttr(c.email)}</div></div>`}`))}finishBarcodes(out);LWHStorage.set('printJobs',(+LWHStorage.get('printJobs',0))+out.children.length);LWHUI.toast(`Generated ${out.children.length} contact card(s)`)})}
window.LWHLabels={generateContact,setPrintPageSize};
