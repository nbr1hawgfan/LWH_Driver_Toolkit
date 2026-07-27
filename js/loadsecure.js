(function(){
  function el(id){ return document.getElementById(id); }
  // 49 CFR 393.110(b): minimum tiedown count by article length/weight
  function minTiedowns(weight,length){
    if(length<=5 && weight<=1100) return 1;
    if(length<=5 && weight>1100) return 2;
    if(length>5 && length<=10) return 2;
    // longer than 10 ft: 2, plus 1 for every additional 10 ft or fraction thereof
    const extra=Math.ceil((length-10)/10);
    return 2+extra;
  }
  function render(){
    const out=el('lsOutput'); if(!out) return;
    const weight=+el('lsWeight').value||0;
    const length=+el('lsLength').value||0;
    if(!weight||!length){
      out.innerHTML='<p class="hint">Enter cargo weight and length.</p>';
      return;
    }
    const count=minTiedowns(weight,length);
    const aggregateWLL=weight*0.5; // 393.106(d): aggregate WLL must be at least 50% of cargo weight
    const perTiedownWLL=aggregateWLL/count;
    out.innerHTML=`
      <div class="stats">
        <div><b>${count}</b><span>Minimum tie-downs required</span></div>
        <div><b>${aggregateWLL.toLocaleString(undefined,{maximumFractionDigits:0})} lbs</b><span>Minimum aggregate working load limit</span></div>
        <div><b>${perTiedownWLL.toLocaleString(undefined,{maximumFractionDigits:0})} lbs</b><span>WLL needed per tie-down if evenly split</span></div>
      </div>
      <p class="hint" style="margin-top:14px">Per 49 CFR §393.110(b): minimum tie-down count is based on article length and weight. Per §393.106(d): the aggregate working load limit of all tie-downs must be at least half the cargo weight. This is a starting-point reference — always follow your company's securement training, commodity-specific rules (e.g. logs, coils, machinery), and your supervisor's guidance. Blocked/braced loads and special-purpose vehicles have different requirements not covered here.</p>
    `;
  }
  el('lsCalc')&&(el('lsCalc').onclick=render);
  ['lsWeight','lsLength'].forEach(id=>{ const n=el(id); if(n) n.addEventListener('input',render); });
  el('lsReset')&&(el('lsReset').onclick=()=>{
    el('lsWeight').value=''; el('lsLength').value='';
    el('lsOutput').innerHTML='<p class="hint">Enter cargo weight and length and tap Calculate.</p>';
  });
})();
