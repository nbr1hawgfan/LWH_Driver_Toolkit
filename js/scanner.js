(function(){
  // Ported from LWH_Master-Lookup, where this approach (html5-qrcode) was
  // confirmed working reliably on iPhone/Safari, replacing the previous
  // BarcodeDetector/ZXing implementation which was unreliable on iOS.
  let html5QrCode=null, callback=null;

  function el(id){ return document.getElementById(id); }
  function setStatus(msg){ const s=el('scannerStatus'); if(s) s.textContent=msg; }

  function scanConfig(){
    const formats=(window.Html5QrcodeSupportedFormats)?[
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.CODABAR
    ]:undefined;
    return {fps:10,qrbox:{width:260,height:140},formatsToSupport:formats};
  }

  function onScanSuccess(decodedText){
    const value=String(decodedText||'').trim();
    if(!value) return;
    try{ navigator.vibrate && navigator.vibrate(70); }catch(e){}
    const cb=callback;
    stop(true);
    if(cb) cb(value);
  }

  async function start(cb){
    callback=cb;
    const modal=el('scannerModal');
    const readerEl=el('scannerReader');
    if(!modal||!readerEl){ alert('Scanner UI not available.'); return; }
    if(typeof Html5Qrcode==='undefined'){
      alert('Camera scanner library failed to load. Check your internet connection, or type/paste the barcode into Search.');
      return;
    }
    modal.hidden=false;
    setStatus('Starting camera...');
    readerEl.innerHTML='';
    html5QrCode=new Html5Qrcode('scannerReader');
    const config=scanConfig();
    try{
      const devices=await Html5Qrcode.getCameras();
      if(!devices||!devices.length) throw new Error('No camera found');
      const back=devices.find(d=>/back|rear|environment/i.test(d.label))||devices[devices.length-1];
      setStatus('Point the camera at a barcode or QR code.');
      await html5QrCode.start(back.id,config,onScanSuccess,()=>{});
    }catch(err){
      try{
        setStatus('Point the camera at a barcode or QR code.');
        await html5QrCode.start({facingMode:'environment'},config,onScanSuccess,()=>{});
      }catch(err2){
        setStatus('Camera/scanner error: '+err2.message);
        alert('Camera scan failed: '+err2.message+'\n\nMake sure the page is served over HTTPS and camera permission is allowed. You can still use a USB/Bluetooth scanner or type into Search.');
        stop(false);
      }
    }
  }

  function stop(hide=true){
    const modal=el('scannerModal');
    if(html5QrCode){
      const inst=html5QrCode; html5QrCode=null;
      try{ inst.stop().then(()=>inst.clear()).catch(()=>{}); }catch(e){}
    }
    if(hide&&modal) modal.hidden=true;
  }

  window.addEventListener('load',()=>{ const close=el('scannerClose'); if(close) close.onclick=()=>stop(true); });
  window.LWHScanner={start,stop};
})();
