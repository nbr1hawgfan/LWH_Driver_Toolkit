window.LWHBarcode={
  make(svg,text,opts={}){try{JsBarcode(svg,String(text||''),{format:'CODE128',displayValue:false,margin:0,width:opts.width||2,height:opts.height||80});}catch(e){svg.outerHTML='<div class="barcode-error">Barcode error</div>'}}
};
