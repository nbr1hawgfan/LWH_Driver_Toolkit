// The Driver and Warehouse Toolkits are both hosted on nbr1hawgfan.github.io,
// which the browser treats as ONE site — so they share localStorage. Both used
// the 'lwh_' prefix, which meant settings (Quick Links, brand color, name,
// managers…) leaked between the two apps. The driver app now has its own
// 'lwhdrv_' prefix. On first run, everything already saved under 'lwh_' is
// COPIED over (never deleted — the Warehouse Toolkit still uses those).
(function(){
  const P='lwhdrv_', OLD='lwh_', FLAG=P+'migratedFromShared';
  const DRIVER_SAFETY='https://logisticswarehouse.infinit-i.net/#/login';
  try{
    if(!localStorage.getItem(FLAG)){
      Object.keys(localStorage).filter(k=>k.startsWith(OLD)).forEach(k=>{
        const nk=P+k.slice(OLD.length);
        if(localStorage.getItem(nk)===null) localStorage.setItem(nk,localStorage.getItem(k));
      });
      // Quick Links may have been seeded by the Warehouse Toolkit — point the
      // Safety Training link at the drivers' safety site.
      const ql=JSON.parse(localStorage.getItem(P+'quickLinks')||'null');
      if(Array.isArray(ql)){
        let hasDriver=false;
        ql.forEach(l=>{
          if(l&&/safety/i.test(l.name||'')&&l.url!==DRIVER_SAFETY){ l.url=DRIVER_SAFETY; }
          if(l&&l.url===DRIVER_SAFETY) hasDriver=true;
        });
        if(!hasDriver) ql.push({name:'Safety Training',url:DRIVER_SAFETY});
        localStorage.setItem(P+'quickLinks',JSON.stringify(ql));
        localStorage.setItem(P+'quickLinksMigratedSafety','true');
      }
      localStorage.setItem(FLAG,'1');
    }
  }catch(e){}
  window.LWHStorage={
    get(k,d=null){try{return JSON.parse(localStorage.getItem(P+k))??d}catch{return d}},
    set(k,v){try{localStorage.setItem(P+k,JSON.stringify(v))}catch{}},
    remove(k){try{localStorage.removeItem(P+k)}catch{}},
    // Only clears the driver app's own keys — never touches the Warehouse Toolkit's.
    clear(){Object.keys(localStorage).filter(k=>k.startsWith(P)).forEach(k=>localStorage.removeItem(k))}
  };
})();
