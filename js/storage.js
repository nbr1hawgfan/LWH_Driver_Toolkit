window.LWHStorage={
  get(k,d=null){try{return JSON.parse(localStorage.getItem('lwh_'+k))??d}catch{return d}},
  set(k,v){try{localStorage.setItem('lwh_'+k,JSON.stringify(v))}catch{}},
  remove(k){try{localStorage.removeItem('lwh_'+k)}catch{}},
  clear(){Object.keys(localStorage).filter(k=>k.startsWith('lwh_')).forEach(k=>localStorage.removeItem(k))}
};
