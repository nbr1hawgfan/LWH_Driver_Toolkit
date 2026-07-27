window.LWHUI={
  qs:(s,r=document)=>r.querySelector(s), qsa:(s,r=document)=>[...r.querySelectorAll(s)],
  toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.hidden=false;setTimeout(()=>t.hidden=true,2500)},
  show(view){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===view));document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));window.scrollTo(0,0);if(window.LWHLabels&&LWHLabels.setPrintPageSize)LWHLabels.setPrintPageSize(null,null);if(view!=='utilities'&&window.LWHUtilities&&LWHUtilities.stopScannerCamera)LWHUtilities.stopScannerCamera();if(view!=='trailer'&&window.LWHTrailer&&LWHTrailer.stopLicenseCamera)LWHTrailer.stopLicenseCamera();},
  lines(text){return String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)},
  safe(s){return String(s||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))},
  readFile(input,cb){const f=input.files&&input.files[0]; if(!f){cb('');return} const r=new FileReader(); r.onload=()=>cb(r.result); r.readAsDataURL(f);}
};
