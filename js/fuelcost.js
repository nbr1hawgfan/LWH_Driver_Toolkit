(function(){
  function el(id){ return document.getElementById(id); }
  function render(){
    const out=el('fcOutput'); if(!out) return;
    let miles=+el('fcMiles').value||0;
    const mpg=+el('fcMpg').value||0;
    const price=+el('fcPrice').value||0;
    if(el('fcRoundTrip').checked) miles*=2;
    if(!miles||!mpg||!price){
      out.innerHTML='<p class="hint">Enter miles, MPG, and price per gallon.</p>';
      return;
    }
    const gallons=miles/mpg;
    const total=gallons*price;
    const perMile=total/miles;
    out.innerHTML=`
      <div class="stats">
        <div><b>${gallons.toFixed(1)}</b><span>Gallons needed</span></div>
        <div><b>$${total.toFixed(2)}</b><span>Estimated fuel cost</span></div>
        <div><b>$${perMile.toFixed(3)}</b><span>Cost per mile</span></div>
      </div>
      <p class="hint" style="margin-top:14px">${el('fcRoundTrip').checked?`Based on ${miles} round-trip miles at ${mpg} MPG.`:`Based on ${miles} miles at ${mpg} MPG.`}</p>
    `;
  }
  ['fcMiles','fcMpg','fcPrice','fcRoundTrip'].forEach(id=>{
    const node=el(id); if(node) node.addEventListener('input',render);
  });
  el('fcCalc')&&(el('fcCalc').onclick=render);
  el('fcReset')&&(el('fcReset').onclick=()=>{
    el('fcMiles').value=''; el('fcMpg').value=6.5; el('fcPrice').value=''; el('fcRoundTrip').checked=false;
    el('fcOutput').innerHTML='<p class="hint">Enter trip details and tap Calculate.</p>';
  });
})();
