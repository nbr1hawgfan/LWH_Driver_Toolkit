let deferredInstallPrompt=null;
// Default Managers CSV — same idea as Master Lookup's default sheet: bakes in
// the real list so every install works out of the box with no manual setup.
// Still overridable per-device via Settings if ever needed.
const MANAGERS_DEFAULT_URL='https://docs.google.com/spreadsheets/d/e/2PACX-1vSRqVtSZLZSa1kh9LyCEHwoZCdwWclMqm3QDaBvrnK67ZY_Q-qFdQWQgx98hPSso0AsEJB1zFtxu3ue/pub?output=csv';
// Fort Smith, AR — used unless someone overrides it in Settings.
const DEFAULT_WEATHER_LOC={lat:35.3859,lon:-94.3985};
function parseWeatherLoc(v){
  const parts=String(v||'').split(',').map(s=>parseFloat(s.trim()));
  if(parts.length===2 && !isNaN(parts[0]) && !isNaN(parts[1])) return {lat:parts[0],lon:parts[1]};
  return DEFAULT_WEATHER_LOC;
}
function getGreeting(){
  const h=new Date().getHours();
  const base = h<12?'Good Morning':(h<17?'Good Afternoon':'Good Evening');
  const fullName=(LWHStorage.get('userName','')||'').trim();
  const firstName=fullName?fullName.split(/\s+/)[0]:'';
  return firstName?`${base}, ${firstName}!`:base;
}
function tickClock(){
  if(window.heroClock) heroClock.textContent=new Date().toLocaleTimeString([], {weekday:'short', hour:'numeric', minute:'2-digit', second:'2-digit'});
}
function weatherCodeText(code){
  const map={0:'Clear',1:'Mostly Clear',2:'Partly Cloudy',3:'Overcast',45:'Foggy',48:'Foggy',51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',56:'Freezing Drizzle',57:'Freezing Drizzle',61:'Light Rain',63:'Rain',65:'Heavy Rain',66:'Freezing Rain',67:'Freezing Rain',71:'Light Snow',73:'Snow',75:'Heavy Snow',77:'Snow Grains',80:'Light Showers',81:'Showers',82:'Heavy Showers',85:'Snow Showers',86:'Snow Showers',95:'Thunderstorm',96:'Thunderstorm, Hail',99:'Thunderstorm, Hail'};
  return map[code]||'Weather';
}
function dayLabel(iso){
  const d=new Date(iso+'T00:00:00');
  return d.toLocaleDateString([], {weekday:'short'});
}
async function refreshForecast(loc){
  if(!window.heroForecast) return;
  const cacheKey='forecastCache';
  const cached=LWHStorage.get(cacheKey,null);
  if(cached && cached.lat===loc.lat && cached.lon===loc.lon && (Date.now()-cached.at)<60*60*1000){
    heroForecast.innerHTML=cached.html; return;
  }
  try{
    const res=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=7`,{cache:'no-store'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    const days=data.daily.time.map((t,i)=>({
      label:i===0?'Today':dayLabel(t),
      hi:Math.round(data.daily.temperature_2m_max[i]),
      lo:Math.round(data.daily.temperature_2m_min[i]),
      code:data.daily.weather_code[i]
    }));
    const html=days.map(d=>`<div class="weather-day"><b>${d.label}</b><span>${weatherCodeText(d.code)}</span><span>${d.hi}°/${d.lo}°</span></div>`).join('');
    heroForecast.innerHTML=html;
    LWHStorage.set(cacheKey,{lat:loc.lat,lon:loc.lon,html,at:Date.now()});
  }catch(e){
    console.error('Forecast fetch failed',e);
  }
}
async function refreshAlerts(loc){
  if(!window.heroAlert) return;
  try{
    const res=await fetch(`https://api.weather.gov/alerts/active?point=${loc.lat},${loc.lon}`,{cache:'no-store',headers:{'Accept':'application/geo+json'}});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    const features=data.features||[];
    if(!features.length){ heroAlert.hidden=true; return; }
    // Show the most severe/first active alert; note the count if more than one.
    const top=features[0].properties;
    const more=features.length>1?` (+${features.length-1} more active)`:'';
    heroAlert.hidden=false;
    heroAlert.textContent=`⚠ ${top.event}${top.areaDesc?' — '+top.areaDesc:''}${more}`;
  }catch(e){
    heroAlert.hidden=true;
    console.error('Weather alert fetch failed',e);
  }
}
async function refreshHero(){
  if(window.heroGreeting) heroGreeting.textContent=getGreeting();
  if(!window.heroWeather) return;
  const loc=parseWeatherLoc(LWHStorage.get('weatherLoc',''));
  const cached=LWHStorage.get('weatherCache',null);
  const fresh=cached && cached.lat===loc.lat && cached.lon===loc.lon && (Date.now()-cached.at)<30*60*1000;
  if(fresh){ heroWeather.textContent=cached.text; }
  else{
    try{
      const res=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`,{cache:'no-store'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data=await res.json();
      const temp=Math.round(data.current.temperature_2m);
      const text=`${temp}°F · ${weatherCodeText(data.current.weather_code)}`;
      heroWeather.textContent=text;
      LWHStorage.set('weatherCache',{lat:loc.lat,lon:loc.lon,text,at:Date.now()});
    }catch(e){
      heroWeather.textContent=cached?cached.text:'Weather unavailable right now.';
      console.error('Weather fetch failed',e);
    }
  }
  refreshForecast(loc);
  refreshAlerts(loc);
}
// Small helpers so the header/nav/hover colors always follow whatever brand
// color is picked in Settings, instead of a second color being hardcoded.
function hexToRgb(hex){hex=String(hex||'').trim().replace('#',''); if(hex.length===3)hex=hex.split('').map(c=>c+c).join(''); const n=parseInt(hex,16)||0; return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};}
function rgbToHex(r,g,b){return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');}
function shadeColor(hex,percent){const {r,g,b}=hexToRgb(hex); const t=percent<0?0:255; const p=Math.abs(percent); return rgbToHex(r+(t-r)*p,g+(t-g)*p,b+(t-b)*p);}
function applySettings(){
  const company=LWHStorage.get('companyName','Logistics Warehouse'); document.getElementById('companyTitle').textContent=company+' Toolkit'; setCompany.value=company;
  const color=LWHStorage.get('primaryColor','#c8102e');
  document.documentElement.style.setProperty('--brand',color);
  document.documentElement.style.setProperty('--brand-dark',shadeColor(color,-0.28));
  document.documentElement.style.setProperty('--brand-tint',shadeColor(color,0.88));
  setColor.value=color;
  if(window.setWeatherLoc) setWeatherLoc.value=LWHStorage.get('weatherLoc','');
  if(window.setReadAloud) setReadAloud.checked=LWHStorage.get('readAloudEnabled',true);
  const logo=LWHStorage.get('companyLogo',''); if(logo){brandLogoBox.hidden=false; brandLogoBox.style.backgroundImage=`url(${logo})`;} else {brandLogoBox.hidden=true;}
  if(window.setTagline) setTagline.value=LWHStorage.get('companyTagline','');
  if(window.setUserName) setUserName.value=LWHStorage.get('userName','');
  if(window.setUsageLogUrl) setUsageLogUrl.value=LWHStorage.get('usageLogUrl','')||USAGE_LOG_URL_DEFAULT;
  if(window.setCustomerLookupUrl){ const custUrl=LWHStorage.get('customerLookupUrl','')||LWHInventory.CUSTOMER_DEFAULT_URL; setCustomerLookupUrl.value=custUrl; if(window.custCurrentUrl) custCurrentUrl.textContent=custUrl; }
  if(window.LWHInventory && LWHInventory.loadCustomerLabelsToSettings) LWHInventory.loadCustomerLabelsToSettings();
  calX.value=LWHStorage.get('calX',0); calY.value=LWHStorage.get('calY',0); calScale.value=LWHStorage.get('calScale',100);
  statPrints.textContent=LWHStorage.get('printJobs',0); statLookups.textContent=LWHStorage.get('lookupCount',0); statVisitors.textContent=(LWHStorage.get('visitorLog',[])||[]).length;
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;installBtn.hidden=false});
let renderManagersList=()=>{};
// Deliberately self-contained and independent of inventory.js's master-sheet
// parser — this is a plain two-column CSV (Name, Email), nothing like the
// 19-column master schema, and it should stay that way so touching one never
// risks the other.
function splitManagerCsv(text){
  text=(text||'').replace(/^\uFEFF/,'').trim();
  if(!text) return [];
  const delim=text.indexOf('\t')>-1?'\t':',';
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let rows=lines;
  if(lines.length && (/name/i.test(lines[0]) && /email/i.test(lines[0]))) rows=lines.slice(1);
  return rows.map(line=>{
    const parts=line.split(delim);
    return {name:(parts[0]||'').trim(),email:(parts[1]||'').trim()};
  }).filter(m=>m.name||m.email);
}
async function loadManagersFromUrl(){
  const input=document.getElementById('mgrSourceUrl');
  const statusEl=document.getElementById('mgrSourceStatus');
  const url=(input&&input.value||LWHStorage.get('managersSourceUrl','')||MANAGERS_DEFAULT_URL||'').trim();
  if(!url){ if(statusEl) statusEl.textContent='Paste a Google Sheet CSV link above first.'; return; }
  LWHStorage.set('managersSourceUrl',url);
  if(statusEl) statusEl.textContent='Loading...';
  try{
    const res=await fetch(url+(url.includes('?')?'&':'?')+'_='+Date.now(),{cache:'no-store',mode:'cors'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const text=await res.text();
    if(/<html|<!doctype html|ServiceLogin|accounts\.google/i.test(text.slice(0,300))) throw new Error('Got a webpage instead of CSV — check the sheet is published as CSV (File → Share → Publish to web).');
    const managers=splitManagerCsv(text);
    LWHStorage.set('managers',managers);
    if(statusEl) statusEl.textContent=`Loaded ${managers.length} manager(s) from the sheet.`;
    renderManagersList();
    if(window.refreshQuickMessageManagers) refreshQuickMessageManagers();
    LWHUI.toast(`Loaded ${managers.length} manager(s)`);
  }catch(e){
    if(statusEl) statusEl.textContent='Load failed: '+e.message;
    LWHUI.toast('Manager sheet load failed');
  }
}
function initManagers(){
  const list=document.getElementById('mgrList'); if(!list) return;
  renderManagersList=function render(){
    const managers=LWHStorage.get('managers',[]);
    list.innerHTML=managers.length?managers.map((m,i)=>`<div class="grid-2" style="align-items:center;margin-bottom:6px"><input data-idx="${i}" data-field="name" value="${String(m.name||'').replace(/"/g,'&quot;')}" placeholder="Name" /><input data-idx="${i}" data-field="email" type="email" value="${String(m.email||'').replace(/"/g,'&quot;')}" placeholder="email@company.com" /></div><div class="actions" style="margin-bottom:12px"><button type="button" class="ghost" data-remove="${i}">Remove</button></div>`).join(''):'<p class="hint">No managers yet.</p>';
  };
  list.addEventListener('input',e=>{
    const t=e.target; if(t.dataset.idx===undefined) return;
    const managers=LWHStorage.get('managers',[]);
    if(!managers[t.dataset.idx]) return;
    managers[t.dataset.idx][t.dataset.field]=t.value;
    LWHStorage.set('managers',managers);
    if(window.refreshQuickMessageManagers) refreshQuickMessageManagers();
  });
  list.addEventListener('click',e=>{
    const b=e.target.closest('[data-remove]'); if(!b) return;
    const managers=LWHStorage.get('managers',[]);
    managers.splice(+b.dataset.remove,1);
    LWHStorage.set('managers',managers);
    renderManagersList();
    if(window.refreshQuickMessageManagers) refreshQuickMessageManagers();
  });
  const addBtn=document.getElementById('mgrAddBtn');
  if(addBtn) addBtn.onclick=()=>{
    const managers=LWHStorage.get('managers',[]);
    managers.push({name:'',email:''});
    LWHStorage.set('managers',managers);
    renderManagersList();
  };
  const sourceInput=document.getElementById('mgrSourceUrl');
  if(sourceInput) sourceInput.value=LWHStorage.get('managersSourceUrl','')||MANAGERS_DEFAULT_URL;
  const loadBtn=document.getElementById('mgrLoadBtn');
  if(loadBtn) loadBtn.onclick=loadManagersFromUrl;
  const resetBtn=document.getElementById('mgrResetBtn');
  if(resetBtn) resetBtn.onclick=()=>{
    LWHStorage.set('managersSourceUrl',MANAGERS_DEFAULT_URL);
    if(sourceInput) sourceInput.value=MANAGERS_DEFAULT_URL;
    loadManagersFromUrl();
    LWHUI.toast('Reset to default manager list');
  };
  renderManagersList();
}

let renderQuickLinksList=()=>{};
// Seeded once on first run only — if quickLinks already exists in storage
// (even as an empty array from someone removing everything), it's left
// alone so edits/removals aren't silently undone on a later load.
const QUICK_LINKS_DEFAULT=[
  {name:'PTO Requests',url:'https://script.google.com/macros/s/AKfycbwXblseav0VCgynTXxL6BYTLniZ4xJAiYholbDgnFPXBqL46_sxP1Rc49MWMga52QsV/exec'},
  {name:'Trailer Inspection',url:'https://script.google.com/macros/s/AKfycbyTZ4y30FAUEqoSBZR2luzCrwWWGtitmrDEAmILm1NTywV78yveXPxYSI5tBLI6QyFO/exec'},
  {name:'Safety Training',url:'https://logisticswarehouse.infinit-i.net/#/login'}
];
function renderQuickLinksHome(){
  const wrap=document.getElementById('quickLinksHome'), grid=document.getElementById('quickLinksGrid');
  if(!wrap||!grid) return;
  const links=LWHStorage.get('quickLinks',[]).filter(l=>l.name&&l.url);
  if(!links.length){ wrap.hidden=true; return; }
  wrap.hidden=false;
  grid.innerHTML=links.map(l=>`<a class="module-card" href="${String(l.url).replace(/"/g,'&quot;')}" target="_blank" rel="noopener"><div class="icon-badge"><svg class="icon" viewBox="0 0 24 24"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg></div><b>${String(l.name).replace(/</g,'&lt;')}</b><span>Opens in a new tab</span></a>`).join('');
}
function initQuickLinks(){
  const list=document.getElementById('qlList'); if(!list) return;
  if(LWHStorage.get('quickLinks',null)===null){ LWHStorage.set('quickLinks',QUICK_LINKS_DEFAULT.slice()); }
  // One-time migration: devices that already seeded Quick Links before Safety
  // Training existed get it appended once here, without touching anything
  // already there. Runs only once ever (flagged below), so it won't keep
  // re-adding it if someone deliberately removes it afterward.
  if(!LWHStorage.get('quickLinksMigratedSafety',false)){
    const links=LWHStorage.get('quickLinks',[]);
    const safety=QUICK_LINKS_DEFAULT.find(l=>l.name==='Safety Training');
    if(safety && !links.some(l=>l.url===safety.url)){ links.push(safety); LWHStorage.set('quickLinks',links); }
    LWHStorage.set('quickLinksMigratedSafety',true);
  }
  renderQuickLinksList=function render(){
    const links=LWHStorage.get('quickLinks',[]);
    list.innerHTML=links.length?links.map((l,i)=>`<div class="grid-2" style="align-items:center;margin-bottom:6px"><input data-idx="${i}" data-field="name" value="${String(l.name||'').replace(/"/g,'&quot;')}" placeholder="Name (e.g. Forklift Inspection)" /><input data-idx="${i}" data-field="url" value="${String(l.url||'').replace(/"/g,'&quot;')}" placeholder="https://..." /></div><div class="actions" style="margin-bottom:12px"><button type="button" class="ghost" data-remove="${i}">Remove</button></div>`).join(''):'<p class="hint">No quick links yet.</p>';
  };
  list.addEventListener('input',e=>{
    const t=e.target; if(t.dataset.idx===undefined) return;
    const links=LWHStorage.get('quickLinks',[]);
    if(!links[t.dataset.idx]) return;
    links[t.dataset.idx][t.dataset.field]=t.value;
    LWHStorage.set('quickLinks',links);
    renderQuickLinksHome();
  });
  list.addEventListener('click',e=>{
    const b=e.target.closest('[data-remove]'); if(!b) return;
    const links=LWHStorage.get('quickLinks',[]);
    links.splice(+b.dataset.remove,1);
    LWHStorage.set('quickLinks',links);
    renderQuickLinksList();
    renderQuickLinksHome();
  });
  const addBtn=document.getElementById('qlAddBtn');
  if(addBtn) addBtn.onclick=()=>{
    const links=LWHStorage.get('quickLinks',[]);
    links.push({name:'',url:''});
    LWHStorage.set('quickLinks',links);
    renderQuickLinksList();
  };
  const resetBtn=document.getElementById('qlResetBtn');
  if(resetBtn) resetBtn.onclick=()=>{
    LWHStorage.set('quickLinks',QUICK_LINKS_DEFAULT.slice());
    renderQuickLinksList();
    renderQuickLinksHome();
    LWHUI.toast('Reset to default links');
  };
  renderQuickLinksList();
  renderQuickLinksHome();
}

// Usage Tracking: simple, self-reported (no login system exists in this
// app), and deliberately minimal — one name prompt, one ping per day, that's
// it. Fails silently if unconfigured or if the network call doesn't go
// through, since this is informational only and should never block or
// interrupt someone's actual work.
const USAGE_LOG_URL_DEFAULT='https://script.google.com/macros/s/AKfycbxK1F5DNmXdtJma1NZHXQj6-URZdjjRgE8maFm9ypPQ7JinlXnzQGwUmLuwyCgau0YR/exec';
function promptForNameIfNeeded(){
  let name=LWHStorage.get('userName','');
  if(!name){
    name=(prompt("What's your name? Used to track app usage for the team — nothing else is collected.")||'').trim();
    if(name){ LWHStorage.set('userName',name); if(window.heroGreeting) heroGreeting.textContent=getGreeting(); }
  }
  if(window.setUserName) setUserName.value=name;
}
async function pingUsage(){
  const name=LWHStorage.get('userName',''); const url=LWHStorage.get('usageLogUrl','')||USAGE_LOG_URL_DEFAULT;
  if(!name||!url) return;
  const today=new Date().toISOString().slice(0,10);
  if(LWHStorage.get('lastUsagePingDate','')===today) return; // already logged today
  try{
    await fetch(url+'?name='+encodeURIComponent(name)+'&date='+today,{mode:'no-cors'});
    LWHStorage.set('lastUsagePingDate',today);
  }catch(e){ /* silent — non-critical, never interrupt the user's actual work */ }
}
if(window.saveUsageSettings) saveUsageSettings.onclick=()=>{
  LWHStorage.set('userName',(setUserName.value||'').trim());
  LWHStorage.set('usageLogUrl',(setUsageLogUrl.value||'').trim());
  if(window.heroGreeting) heroGreeting.textContent=getGreeting();
  LWHUI.toast('Saved');
  pingUsage();
};

// Handles two kinds of incoming URL params, both driven by manifest.json:
// - App Shortcuts (long-press the installed icon) land here as ?view=NAME
// - Web Share Target (this app appearing in the OS share sheet) lands here
//   as ?title=&text=&url= — routed into Notepad since that's the simplest
//   generic drop point for "whatever just got shared in."
function applyIncomingUrlParams(){
  const params=new URLSearchParams(location.search);
  const view=params.get('view');
  const title=params.get('title')||'', text=params.get('text')||'', sharedUrl=params.get('url')||'';
  if(title||text||sharedUrl){
    const shared=[title,text,sharedUrl].filter(Boolean).join('\n');
    LWHUI.show('utilities');
    const notepadTab=document.querySelector('[data-util="notepad"]');
    if(notepadTab) notepadTab.click();
    const ta=document.getElementById('notepadText');
    if(ta){
      ta.value=(ta.value?ta.value+'\n\n':'')+shared;
      ta.dispatchEvent(new Event('input')); // reuses Notepad's own autosave listener
    }
    LWHUI.toast('Shared content added to Notepad');
    history.replaceState(null,'',location.pathname);
    return;
  }
  if(view && document.getElementById(view)) LWHUI.show(view);
}

window.addEventListener('load',()=>{
  applySettings();
  refreshHero();
  tickClock();
  setInterval(tickClock,1000);
  setInterval(refreshHero,30*60*1000);
  initManagers();
  initQuickLinks();
  promptForNameIfNeeded();
  pingUsage();
  setTimeout(()=>{ loadManagersFromUrl(); },500);
  LWHInventory.loadCached();
  // Auto-load the one master-sheet source so the team never has to remember
  // to hit Load / Refresh Data before searching or printing receiving.
  setTimeout(async()=>{
    try{
      await LWHInventory.loadCustomerFromUrl();
    }catch(e){
      if(window.custLookupStatus) custLookupStatus.textContent='Auto-load failed: '+e.message+' — open Settings to check the source, or use Load / Refresh Data.';
      console.error(e);
    }
  },300);
  if('serviceWorker' in navigator){navigator.serviceWorker.register('./service-worker.js').then(()=>pwaStatus.textContent='Service worker registered. App is installable from HTTPS/GitHub Pages.').catch(err=>pwaStatus.textContent='Service worker error: '+err.message)}else{pwaStatus.textContent='Service workers not supported in this browser.'}
  applyIncomingUrlParams();
});
document.addEventListener('click',e=>{const v=e.target.closest('[data-view]'); if(v){LWHUI.show(v.dataset.view); document.querySelector('.nav').classList.remove('open'); return}});
if(window.navToggle){navToggle.onclick=()=>document.querySelector('.nav').classList.toggle('open');}
installBtn.onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;installBtn.hidden=true};

if(window.custScanBtn){custScanBtn.onclick=()=>LWHScanner.start(value=>{custSearch.value=value; custSearchBtn.click();});}
conGenerate.onclick=()=>{LWHLabels.generateContact();applySettings()}; conSample.onclick=()=>{conName.value='Tim Jennings';conTitle.value='Operations';conCompany.value='Logistics Warehouse';conPhone.value='';conEmail.value='tjennings@logistics-warehouse.com';conWebsite.value='https://logistics-warehouse.com';conStreet.value='';conCity.value='';conState.value='';conZip.value=''};
conEmail.addEventListener('blur',()=>{ const v=conEmail.value.trim(); if(v && !v.includes('@')) conEmail.value=v+'@logistics-warehouse.com'; });
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
// Live search: results populate as soon as someone types, pastes, or a camera
// scan fills the box — no need to hit Search first. The button still works
// for a manual re-trigger (e.g. right after Load / Refresh Data).
if(window.custSearchBtn){custSearchBtn.onclick=()=>{const res=LWHInventory.customerSearch(custSearch.value); LWHInventory.renderCustomerResults(res); LWHStorage.set('lookupCount',(+LWHStorage.get('lookupCount',0))+1); applySettings();};}
if(window.custSearch){custSearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();custSearchBtn.click();}}; custSearch.addEventListener('input',debounce(()=>{
  if(!custSearch.value.trim()){ LWHInventory.renderCustomerResults([]); return; } // clearing the box clears results too, no stale data left behind
  custSearchBtn.click();
},250));}
if(window.custClearBtn){custClearBtn.onclick=()=>{custSearch.value=''; LWHInventory.renderCustomerResults([]); custSearch.focus();};}

// Transaction History: lazy-loaded on first search rather than at app
// startup like Master Lookup — it's a much larger, less-frequently-used
// dataset, so no reason to make everyone pay that load cost on every visit.
async function runTransactionSearch(){
  await LWHTransactions.loadTransactions(false);
  const q=txnSearch.value;
  const matches=LWHTransactions.transactionSearch(q);
  LWHTransactions.renderTransactionResults(matches, matches.length);
}
if(window.txnSearchBtn){txnSearchBtn.onclick=()=>{runTransactionSearch();};}
if(window.txnSearch){txnSearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();txnSearchBtn.click();}};}
if(window.txnLoadBtn){txnLoadBtn.onclick=async()=>{await LWHTransactions.loadTransactions(true); if(txnSearch.value.trim()) runTransactionSearch(); LWHUI.toast('Transaction history loaded');};}
if(window.txnClearBtn){txnClearBtn.onclick=()=>{txnSearch.value=''; LWHTransactions.clearTransactionResults(); txnSearch.focus();};}

// Item Summary: a separate, focused lookup — does not touch Master
// Lookup's universal search or its results panel in any way.
if(window.itemSummaryBtn){itemSummaryBtn.onclick=()=>{const result=LWHInventory.itemSummary(itemSummarySearch.value); LWHInventory.renderItemSummary(result);};}
if(window.itemSummarySearch){itemSummarySearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();itemSummaryBtn.click();}};}
if(window.itemSummaryClearBtn){itemSummaryClearBtn.onclick=()=>{itemSummarySearch.value=''; itemSummaryOutput.innerHTML=''; itemSummarySearch.focus();};}

// Voice input: feature-detected — the mic button stays hidden entirely on
// browsers without Web Speech API support rather than showing something
// that won't work. Populating the field fires its existing 'input' handler,
// so live search runs the same as if it had been typed or pasted.
function attachVoiceInput(btn,inputEl,opts={}){
  if(!btn||!inputEl) return;
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ return; }
  btn.hidden=false;
  const recognition=new SR();
  recognition.interimResults=false;
  recognition.maxAlternatives=1;
  let listening=false;
  const idleLabel=opts.idleLabel||btn.textContent;
  btn.onclick=()=>{
    if(listening) return;
    recognition.lang=typeof opts.lang==='function'?opts.lang():(opts.lang||'en-US');
    listening=true; btn.textContent='Listening…';
    try{ recognition.start(); }catch(e){ listening=false; btn.textContent=idleLabel; }
  };
  recognition.onresult=(e)=>{
    let text=e.results[0][0].transcript;
    // Speech recognition often "smart formats" spoken digit sequences as if
    // they were phone numbers (e.g. saying "4226615" comes back "422-6615"),
    // which breaks lookups here since these are plain reference numbers, not
    // phone numbers. If the whole transcript is just digits once spaces/
    // dashes are removed, use the plain digit string instead.
    if(opts.cleanDigits){
      const digitsOnly=text.replace(/[\s-]/g,'');
      if(/^\d+$/.test(digitsOnly)) text=digitsOnly;
    }
    inputEl.value=text;
    inputEl.dispatchEvent(new Event('input'));
  };
  recognition.onerror=()=>{ listening=false; btn.textContent=idleLabel; };
  recognition.onend=()=>{ listening=false; btn.textContent=idleLabel; };
}
window.attachVoiceInput=attachVoiceInput;
if(window.custVoiceBtn) attachVoiceInput(custVoiceBtn,custSearch,{cleanDigits:true,idleLabel:'Speak Search'});
if(window.custLoadBtn){custLoadBtn.onclick=async()=>{try{await LWHInventory.loadCustomerFromUrl();LWHUI.toast('Master Lookup data loaded')}catch(e){custLookupStatus.textContent='Load failed: '+e.message; console.error(e);}};}
if(window.custPasteBtn){custPasteBtn.onclick=()=>{const rows=LWHInventory.parseCustomerDelimited(custPaste.value);LWHStorage.set('customerLookupRows',rows);LWHInventory.loadCached();LWHUI.toast(`Loaded ${rows.length} pasted row(s)`)};}
if(window.recLoadBtn){recLoadBtn.onclick=()=>custLoadBtn.click();}
if(window.recFindBtn){recFindBtn.onclick=()=>LWHInventory.findReceiving();}
if(window.recInvRec){recInvRec.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();recFindBtn.click();}}; recInvRec.addEventListener('input',debounce(()=>{
  if(!recInvRec.value.trim()){ if(window.receivingResults) receivingResults.innerHTML=''; if(window.receivingPrintOutput) receivingPrintOutput.innerHTML=''; if(window.recStatus) recStatus.textContent='Enter an InvRec to begin.'; return; }
  recFindBtn.click();
},250));}
if(window.recClearBtn){recClearBtn.onclick=()=>{recInvRec.value=''; if(window.receivingResults) receivingResults.innerHTML=''; if(window.receivingPrintOutput) receivingPrintOutput.innerHTML=''; if(window.recStatus) recStatus.textContent='Enter an InvRec to begin.'; recInvRec.focus();};}
if(window.recPrintBtn){recPrintBtn.onclick=()=>{const list=LWHInventory.findReceiving(); if(list && list.length) LWHInventory.printRows(list,receivingPrintOutput);};}
if(window.recPasteBtn){recPasteBtn.onclick=()=>{const rows=LWHInventory.parseCustomerDelimited(recPaste.value);LWHStorage.set('customerLookupRows',rows);LWHInventory.loadCached();LWHUI.toast(`Loaded ${rows.length} row(s)`);};}
saveBrand.onclick=()=>{LWHStorage.set('companyName',setCompany.value||'Logistics Warehouse');LWHStorage.set('primaryColor',setColor.value||'#c8102e');if(window.setTagline)LWHStorage.set('companyTagline',setTagline.value||'');if(window.setWeatherLoc){LWHStorage.set('weatherLoc',setWeatherLoc.value||'');LWHStorage.remove('weatherCache');}if(window.setReadAloud)LWHStorage.set('readAloudEnabled',setReadAloud.checked);LWHUI.readFile(setLogo,logo=>{if(logo)LWHStorage.set('companyLogo',logo);applySettings();refreshHero();LWHUI.toast('Branding saved')})};
clearLogo.onclick=()=>{LWHStorage.set('companyLogo','');applySettings();LWHUI.toast('Logo cleared')};
saveCalibration.onclick=()=>{LWHStorage.set('calX',calX.value||0);LWHStorage.set('calY',calY.value||0);LWHStorage.set('calScale',calScale.value||100);LWHUI.toast('Calibration saved')};
if(window.saveCustomerLookupUrl){saveCustomerLookupUrl.onclick=()=>{const url=LWHInventory.normalizeUrl(setCustomerLookupUrl.value||LWHInventory.CUSTOMER_DEFAULT_URL,LWHInventory.CUSTOMER_DEFAULT_URL); LWHStorage.set('customerLookupUrl',url); setCustomerLookupUrl.value=url; if(window.custCurrentUrl) custCurrentUrl.textContent=url; LWHUI.toast('Source saved')};}
if(window.testCustomerLookupUrl){testCustomerLookupUrl.onclick=async()=>{try{await LWHInventory.loadCustomerFromUrl();LWHUI.toast('Source works')}catch(e){custLookupStatus.textContent='Test failed: '+e.message; LWHUI.toast('Load failed')}};}
if(window.resetCustomerLookupUrl){resetCustomerLookupUrl.onclick=()=>{LWHInventory.resetCustomerSource(); LWHUI.toast('Source reset')}};
if(window.saveCustomerFieldLabels){saveCustomerFieldLabels.onclick=()=>{LWHInventory.saveCustomerLabelsFromSettings();};}
clearStorage.onclick=()=>{if(confirm('Clear saved settings and cached data?')){LWHStorage.clear();applySettings();LWHUI.toast('Saved settings cleared')}};
