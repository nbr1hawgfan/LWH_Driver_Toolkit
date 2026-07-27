window.LWHQR={
  make(el,text,size=100){el.innerHTML=''; if(!text)return; new QRCode(el,{text:String(text),width:size,height:size,correctLevel:QRCode.CorrectLevel.M});},
  COMPANY_LANDLINE:'479-410-2611',
  vcard(c){
    const esc=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    const lines=['BEGIN:VCARD','VERSION:3.0',`FN:${esc(c.name)}`,`ORG:${esc(c.company)}`,`TITLE:${esc(c.title)}`];
    if(c.phone) lines.push(`TEL;TYPE=CELL:${esc(c.phone)}`);
    lines.push(`TEL;TYPE=WORK,VOICE:${esc(LWHQR.COMPANY_LANDLINE)}`); // office landline, included on every card automatically
    lines.push(`EMAIL:${esc(c.email)}`,`URL:${esc(c.website)}`,`ADR:;;${esc(c.street)};${esc(c.city)};${esc(c.state)};${esc(c.zip)};`,'END:VCARD');
    return lines.join('\n');
  }
};
