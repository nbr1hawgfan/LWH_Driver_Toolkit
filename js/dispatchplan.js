/* Dispatch Board > Weekly Plan — the dispatcher's weekly driver sheet as a calendar.
   ONE FILE, TWO APPS: this same file runs in Transportation Manager and in the Driver Toolkit's manager
   Dispatch Board. Change it in one repo, copy it to the other.
   Data: Supabase dispatch_plan, pushed by the Dispatch Extract Apps Script (gas/DispatchExtract.gs)
   from the dispatcher workbook's weekly tabs. Read-only here: the sheet stays the place to plan. */
window.TMDispatchPlan = (function () {
  'use strict';
  const RPC = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Transportation Manager keeps its sign-in in lwhdispatch_token; the Driver Toolkit in LWHStorage msgToken. Same Supabase session.
  const token = () => {
    try { const t = localStorage.getItem('lwhdispatch_token'); if (t) return t; } catch (e) {}
    try { if (window.LWHStorage) return LWHStorage.get('msgToken', '') || ''; } catch (e) {}
    return '';
  };
  const toast = (m, k) => { if (window.TS && TS.toast) TS.toast(m, k); else if (window.LWHUI && LWHUI.toast) LWHUI.toast(m); };
  const phone = () => window.matchMedia('(max-width: 700px)').matches;
  const st = { data: null, tab: null, loaded: false, day: null, view: null, weekend: false };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const LOAD_RE = /\b0\d{6}\b/g;
  const OFF_RE = /^(off|day off|called? off|call(ed)? in|pto|vacation|sick|holiday|no call|no show|out)\b/i;

  async function rpc(fn, args) {
    const r = await fetch(RPC + fn, { method: 'POST', cache: 'no-store', headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ p_token: token() }, args || {})) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Weekly plan request failed (' + r.status + ')');
    if (j.ok === false) throw new Error(j.error === 'signed_out' ? 'Your sign-in ended. Sign out and back in.' : (j.error || 'Request failed'));
    return j;
  }

  /* ---------- dates ---------- */
  const D = s => new Date(s + 'T12:00:00');
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const md = s => { const d = D(s); return (d.getMonth() + 1) + '/' + d.getDate(); };
  const longDate = s => D(s).toLocaleDateString([], { month: 'short', day: 'numeric' });
  function weekDays(start, end) { const out = []; for (let d = D(start); iso(d) <= end; d.setDate(d.getDate() + 1)) out.push(iso(d)); return out; }
  function ago(ts) {
    if (!ts) return 'never';
    const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' hr ago';
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* ---------- shape the week ---------- */
  // rows from the server: one per sheet row per day (day null = nothing planned). -> drivers with a cell per day.
  function build(j) {
    const byRow = new Map();
    (j.rows || []).forEach(x => {
      let r = byRow.get(x.row_no);
      if (!r) { r = { row: x.row_no, section: x.section || '', grp: x.grp || x.section || '', truck: x.truck || '', driver: x.driver || '', cells: {} }; byRow.set(x.row_no, r); }
      if (x.day) r.cells[x.day] = { a: x.a || '', n: x.n || '' };
    });
    const rows = [...byRow.values()].sort((a, b) => a.row - b.row);
    const groups = [];
    rows.forEach(r => {
      const name = r.grp || 'Other';
      let g = groups.find(x => x.name === name && x.bullpen === !!r.section);
      if (!g) { g = { name, bullpen: !!r.section, rows: [] }; groups.push(g); }
      g.rows.push(r);
    });
    const first = (j.rows || [])[0];
    const start = first ? first.start : null, end = first ? first.end : null;
    const days = start ? weekDays(start, end) : [];
    rows.forEach(r => {
      r.driver = niceName(r.driver);
      // Spotters: column B is their post (PERNOD AM, GLAT…). Show it under every weekday like a load.
      r.spot = /^spotter/i.test(r.grp);
      if (r.spot) {
        r.post = r.truck; r.truck = '';
        days.filter(d => { const k = D(d).getDay(); return k >= 1 && k <= 5; }).forEach(d => { r.cells[d] = r.cells[d] || { a: '', n: '' }; });
      }
      Object.values(r.cells).forEach(c => {
        if (r.spot) c.post = r.post;
        // OFF can be typed in the day's own column or in its NOTES column (the sheet does both)
        c.offText = isOff(c.a) ? c.a : (isOff(c.n) && (!c.a || r.spot)) ? c.n : '';
        c.off = !!c.offText;
        c.cover = c.off && r.spot && c.a && !isOff(c.a) ? c.a : '';     // spotter off + a name typed in = who covers
        c.noteShown = c.n && c.n !== c.offText ? c.n : '';
      });
    });
    return { rows, groups, start, end, days };
  }
  const isOff = a => OFF_RE.test(String(a || '').trim());
  // "JORDAN P." -> "Jordan P." so every name looks the same
  const niceName = n => (n && n === n.toUpperCase() && /[A-Z]{3}/.test(n))
    ? n.split(/(\s+)/).map(w => w.replace(/\./g, '').length <= 2 ? w : w.charAt(0) + w.slice(1).toLowerCase()).join('') : (n || '');
  const loadsIn = a => (String(a || '').match(LOAD_RE) || []);
  // split "A // B / C" into stops
  const stops = a => String(a || '').split(/\s+\/\/+\s*|\s+\/\s+|\s*\/\/\s*/).map(s => s.trim()).filter(Boolean);
  function fmtStop(s, q) {
    let h = esc(s);
    h = h.replace(LOAD_RE, m => `<button type="button" class="dp-load" data-load="${m}" title="Copy load #">${m}</button>`);
    h = h.replace(/^(yd|yard)\b/i, '<span class="dp-yd">$1</span>');
    h = h.replace(/\((\d)\s*yd\)/i, '<span class="dp-tag">$1 yd</span>');
    if (q) { const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'ig'); h = h.replace(re, '<mark>$1</mark>'); }
    return h;
  }


  /* ---------- absence check (PTO & Absence Tracker) ----------
     Reads the tracker's published Export_ tabs, the same CSVs the PTO Calendar app reads, so the tracker sheet
     and its apps don't change. Names on the dispatch sheet are short ("Vincent R.", "Paul"); they're matched to
     tracker employees automatically, and a manager can link or correct a name (saved in dispatch_name_map). */
  const ABS = {
    REQUESTS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuPdjvjICInergHmx_qGJF4mI_iYgsrmWeF1nCr-WTdz3jhqG0yZ9LPcL1M9vJWP9i7n-1-JD8Q3xb/pub?gid=491852524&single=true&output=csv',
    EMPLOYEES: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuPdjvjICInergHmx_qGJF4mI_iYgsrmWeF1nCr-WTdz3jhqG0yZ9LPcL1M9vJWP9i7n-1-JD8Q3xb/pub?gid=1288918784&single=true&output=csv',
    DEPT: 'transportation'
  };
  // Types that mean the person is out the whole day. The others (half day, personal time, late) are shown but never flagged.
  const FULL = ['Full Day PTO', 'Personal Day', 'Call-in', 'Excused Unpaid', 'No Call No Show', 'Disciplinary', 'Bereavement', 'Comp Day'];
  const SHORT = { 'Full Day PTO': 'PTO', 'Half Day PTO': '½ day PTO', 'Personal Day': 'Personal day', 'Personal Time': 'Personal time', 'Call-in': 'Call-in',
    'Late Unpaid': 'Late', 'Excused Unpaid': 'Excused', 'No Call No Show': 'No call / no show', 'Disciplinary': 'Disciplinary', 'Bereavement': 'Bereavement', 'Comp Day': 'Comp day' };
  const NICK = { brad: 'bradley', ken: 'kenneth', kenny: 'kenneth', mike: 'michael', bob: 'robert', bobby: 'robert', rob: 'robert', bill: 'william', billy: 'william',
    will: 'william', jim: 'james', jimmy: 'james', tony: 'anthony', dave: 'david', chris: 'christopher', matt: 'matthew', andy: 'andrew', dan: 'daniel',
    danny: 'daniel', steve: 'steven', ron: 'ronald', ronnie: 'ronald', don: 'donald', donnie: 'donald', joe: 'joseph', tom: 'thomas', tommy: 'thomas', larry: 'lawrence' };

  function parseCsv(text) {
    const rows = []; let row = [], f = '', q = false;
    text = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    const head = (rows.shift() || []).map(h => h.trim());
    return rows.filter(r => r.some(x => x !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  async function loadAbs(force) {
    if (!force && st.abs && Date.now() - st.abs.at < 120000) return;
    try {
      const get = async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return parseCsv(await r.text()); };
      const [reqs, emps] = await Promise.all([get(ABS.REQUESTS), get(ABS.EMPLOYEES)]);
      const byId = {}; emps.forEach(e => { byId[e.EmployeeID] = e; });
      const byEmp = {};
      reqs.forEach(r => {
        if (r.Status !== 'Approved' && r.Status !== 'Pending') return;
        const a = r.StartDate && D(r.StartDate.slice(0, 10)), b = r.EndDate ? D(r.EndDate.slice(0, 10)) : a;
        if (!a || isNaN(a) || isNaN(b)) return;
        for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
          if (d.getDay() === 0 || d.getDay() === 6) continue;          // the tracker counts business days
          ((byEmp[r.EmployeeID] = byEmp[r.EmployeeID] || {})[iso(d)] = byEmp[r.EmployeeID][iso(d)] || [])
            .push({ type: r.AbsenceType, status: r.Status, name: r.EmployeeName || (byId[r.EmployeeID] || {}).Name || r.EmployeeID });
        }
      });
      const cands = emps.filter(e => String(e.Department || '').toLowerCase() === ABS.DEPT)
        .sort((x, y) => (x.EmployeeStatus === 'Active' ? 0 : 1) - (y.EmployeeStatus === 'Active' ? 0 : 1) || x.Name.localeCompare(y.Name));
      st.abs = { at: Date.now(), byEmp, byId, cands, err: '' };
    } catch (e) {
      st.abs = { at: Date.now(), byEmp: {}, byId: {}, cands: [], err: 'Couldn\'t reach the absence tracker right now (' + e.message + ').' };
    }
  }
  const nameKey = n => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
  // "Vincent R." -> REED01 Vincent E. Reed. Returns {id, auto} or {id:null, options:[...]} when it can't be sure.
  function autoMatch(name) {
    const t = String(name || '').replace(/\./g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!t.length || !st.abs) return { id: null, options: [] };
    const first = t[0].toLowerCase(), init = t[1] ? t[1][0].toLowerCase() : '';
    const firstOk = e => {
      const p = String(e.Name || '').replace(/\./g, ' ').trim().split(/\s+/), ef = (p[0] || '').toLowerCase();
      const mail = String(e.Email || '').toLowerCase().split('@')[0].split(/[._\d-]/)[0];
      return ef === first || ef === NICK[first] || NICK[ef] === first || (mail && mail === first);
    };
    const lastOk = e => { const p = String(e.Name || '').replace(/\./g, ' ').trim().split(/\s+/); return !init || (p[p.length - 1] || '').toLowerCase()[0] === init; };
    let m = st.abs.cands.filter(e => firstOk(e) && lastOk(e));
    if (m.length > 1) { const act = m.filter(e => e.EmployeeStatus === 'Active'); if (act.length) m = act; }
    if (m.length === 1) return { id: m[0].EmployeeID, auto: true };
    return { id: null, options: m.length ? m : st.abs.cands.filter(firstOk) };
  }
  function linkFor(r, names) {
    if (!r.driver || r.section) return null;
    const saved = (names || {})[nameKey(r.driver)];
    if (saved) return { id: saved.emp_id || null, manual: true, none: !saved.emp_id, by: saved.by };
    return autoMatch(r.driver);
  }
  // Puts tracker absences on the week's cells and works out where the sheet and the tracker disagree.
  function annotate(w, names) {
    if (!w || !st.abs) return null;
    w.rows.forEach(r => {
      Object.keys(r.cells).forEach(d => { const c = r.cells[d]; if (c._absOnly) delete r.cells[d]; else { delete c.abs; delete c.absState; } });
      r.link = linkFor(r, names);
    });
    const issues = [], used = new Set();
    w.rows.forEach(r => {
      const id = r.link && r.link.id; if (id) used.add(id);
      w.days.forEach(d => {
        const wkday = ![0, 6].includes(D(d).getDay());
        const list = id ? ((st.abs.byEmp[id] || {})[d] || []) : [];
        let c = r.cells[d];
        if (list.length) {
          if (!c) { c = r.cells[d] = { a: '', n: '', off: false, offText: '', noteShown: '', _absOnly: true }; if (r.spot) c.post = r.post; }
          c.abs = list;
          const full = list.some(x => FULL.includes(x.type));
          c.absState = !full ? 'info' : c.off ? 'ok' : (c.a && !c._absOnly) ? 'warn' : 'note';
          if (c.absState === 'warn') issues.push({ k: 'warn', d, r, text: `${SHORT[list[0].type] || list[0].type}${list[0].status === 'Pending' ? ' (pending)' : ''} in the absence tracker, but the sheet has “${c.a}”` });
          if (c.absState === 'note') issues.push({ k: 'note', d, r, text: `${SHORT[list[0].type] || list[0].type}${list[0].status === 'Pending' ? ' (pending)' : ''} in the absence tracker, not marked off on the sheet` });
        } else if (c && c.off && wkday && r.link) {
          if (id) { c.absState = 'missing'; issues.push({ k: 'missing', d, r, text: 'OFF on the sheet, nothing in the absence tracker' }); }
        }
      });
    });
    // Transportation people off this week who aren't on the dispatch sheet at all (or aren't linked)
    const others = [];
    st.abs.cands.forEach(e => {
      if (used.has(e.EmployeeID)) return;
      const days = w.days.filter(d => (st.abs.byEmp[e.EmployeeID] || {})[d]);
      if (days.length) others.push({ e, days, type: st.abs.byEmp[e.EmployeeID][days[0]][0] });
    });
    const unmatched = [];
    const seen = new Set();
    w.rows.forEach(r => { if (r.link && !r.link.id && !r.link.none && !seen.has(nameKey(r.driver))) { seen.add(nameKey(r.driver)); unmatched.push(r); } });
    return { issues: issues.sort((a, b) => a.d.localeCompare(b.d) || a.r.row - b.r.row), others, unmatched };
  }
  function empOptions(sel, opts) {
    const list = st.abs ? st.abs.cands : [];
    const pri = new Set((opts || []).map(e => e.EmployeeID));
    const o = e => `<option value="${esc(e.EmployeeID)}"${e.EmployeeID === sel ? ' selected' : ''}>${esc(e.Name)}${e.EmployeeStatus !== 'Active' ? ' (inactive)' : ''}</option>`;
    return `<option value="">Pick who this is…</option>${pri.size ? `<optgroup label="Likely">${list.filter(e => pri.has(e.EmployeeID)).map(o).join('')}</optgroup>` : ''}
      <optgroup label="Transportation">${list.filter(e => !pri.has(e.EmployeeID)).map(o).join('')}</optgroup><option value="-"${sel === '-' ? ' selected' : ''}>Not in the absence tracker</option>`;
  }
  function checkHtml(days) {
    if (!st.abs) return '<div class="dp-chk loading">Checking the absence tracker…</div>';
    if (st.abs.err) return `<div class="dp-chk err">${esc(st.abs.err)}</div>`;
    const ck = st.check, inWeek = x => days.includes(x.d);
    const iss = ck.issues.filter(inWeek), okN = st.wk.rows.reduce((a, r) => a + days.filter(d => r.cells[d] && r.cells[d].absState === 'ok').length, 0);
    const lab = d => `${DOW[D(d).getDay()]} ${md(d)}`;
    const n = iss.length + ck.unmatched.length;
    const open = st.chkOpen === true || (st.chkOpen === undefined && n && !phone());
    let h = `<details class="dp-chk${n ? ' has' : ''}"${open ? ' open' : ''}><summary><b>Absence check</b>
      <span class="dp-chk-pill ${iss.length ? 'warn' : 'ok'}">${iss.length ? iss.length + ' to look at' : 'Sheet and tracker agree'}</span>
      ${okN ? `<span class="dp-chk-pill ok">${okN} match</span>` : ''}${ck.unmatched.length ? `<span class="dp-chk-pill link">${ck.unmatched.length} name${ck.unmatched.length === 1 ? '' : 's'} to link</span>` : ''}
      ${ck.others.length ? `<span class="dp-chk-pill info">${ck.others.length} more off, not on the sheet</span>` : ''}</summary><div class="dp-chk-b">`;
    if (iss.length) h += `<div class="dp-chk-h">The dispatch sheet and the absence tracker don't agree</div>` + iss.map(x =>
      `<div class="dp-chk-i k-${x.k}"><span class="dp-chk-d">${lab(x.d)}</span><b>${esc(x.r.driver)}</b>${x.r.spot ? ` <small>${esc(x.r.post)}</small>` : ''}<span>${esc(x.text)}</span></div>`).join('');
    if (ck.unmatched.length) h += `<div class="dp-chk-h">Link these sheet names to the absence tracker <small>(once; it's remembered)</small></div>` + ck.unmatched.map(r => {
      const m = autoMatch(r.driver);
      return `<div class="dp-chk-link"><b>${esc(r.driver)}</b><small>${esc([r.grp, r.truck || r.post].filter(Boolean).join(' · '))}</small><select data-linkname="${esc(r.driver)}">${empOptions('', m.options)}</select></div>`;
    }).join('');
    if (ck.others.length) h += `<div class="dp-chk-h">Also off this week, not on the dispatch sheet</div><div class="dp-chk-others">` + ck.others.map(o =>
      `<span><b>${esc(o.e.Name)}</b> ${esc(SHORT[o.type.type] || o.type.type)}${o.type.status === 'Pending' ? ' (pending)' : ''} · ${o.days.map(lab).join(', ')}</span>`).join('') + '</div>';
    if (!iss.length && !ck.unmatched.length && !ck.others.length) h += '<p class="hint" style="margin:6px 0 0">Every absence in the tracker this week is marked off on the sheet, and every OFF on the sheet is in the tracker.</p>';
    h += `<details class="dp-links"><summary>Name links (sheet name → absence tracker)</summary><div class="dp-links-b">${(() => {
      const seen = new Set();
      return st.wk.rows.filter(r => r.driver && !r.section && !seen.has(nameKey(r.driver)) && seen.add(nameKey(r.driver))).map(r => {
        const l = r.link || {}, e = l.id && st.abs.byId[l.id];
        return `<div class="dp-chk-link"><b>${esc(r.driver)}</b><small>${l.none ? 'not in tracker' : l.manual ? 'linked by ' + esc(l.by || 'a manager') : l.id ? 'matched automatically' : 'not linked'}</small>
          <select data-linkname="${esc(r.driver)}">${empOptions(l.none ? '-' : (e ? e.EmployeeID : ''), l.options)}</select>${l.manual ? `<button type="button" class="dp-unlink" data-unlink="${esc(r.driver)}" title="Go back to automatic matching">Auto</button>` : ''}</div>`;
      }).join('');
    })()}</div></details>`;
    return h + '<p class="hint dp-chk-src">From the PTO & Absence Tracker (approved and pending; reasons are never shown). The tracker\'s published copy can run a few minutes behind.</p></div></details>';
  }
  function absBadge(c) {
    if (!c || !c.abs) return '';
    const x = c.abs[0], more = c.abs.length > 1 ? ' +' + (c.abs.length - 1) : '';
    const tip = { ok: 'In the absence tracker and off on the sheet', warn: 'In the absence tracker, but the sheet has work planned', note: 'In the absence tracker, not marked off on the sheet', info: 'Part-day absence in the tracker' }[c.absState] || '';
    return `<div class="dp-abs s-${c.absState}${x.status === 'Pending' ? ' pend' : ''}" title="${esc(tip)}">${esc(SHORT[x.type] || x.type)}${x.status === 'Pending' ? ' · pending' : ''}${more}</div>`;
  }
  async function saveLink(name, val) {
    try {
      const e = st.abs && st.abs.byId[val];
      await rpc('dispatch_name_map_set', { p_sheet_name: name, p_emp_id: val === '-' ? null : val, p_emp_name: val === '-' ? 'Not in the absence tracker' : (e ? e.Name : null), p_clear: val === '' });
      (st.data.names = st.data.names || {});
      if (val === '') delete st.data.names[nameKey(name)];
      else st.data.names[nameKey(name)] = { emp_id: val === '-' ? null : val, emp_name: e ? e.Name : null, by: 'you' };
      toast(val === '' ? `${name}: back to automatic matching` : `Linked ${name}${e ? ' → ' + e.Name : ''}`, 'ok');
      render();
    } catch (err) { toast(err.message, 'err'); }
  }

  /* ---------- load ---------- */
  async function load(tab) {
    const box = $('dpBox');
    if (!st.loaded) box.innerHTML = '<div class="dp-empty">Loading the weekly plan…</div>';
    try {
      const absP = loadAbs(false);
      const j = await rpc('dispatch_plan_week', { p_tab: tab || null });
      st.data = j; st.tab = j.tab; st.loaded = true; st.wk = build(j);
      if (!st.day || !st.wk.days.includes(st.day)) st.day = st.wk.days.includes(j.today) ? j.today : (st.wk.days[0] || null);
      fillControls(); render();
      absP.then(() => { if (st.data === j) render(); });
    } catch (e) {
      box.innerHTML = `<div class="dp-empty err">${esc(e.message)}</div>`;
    }
  }
  function open() { if (!st.loaded) load(); else render(); }
  function refresh() { if (st.abs) st.abs.at = 0; return load(st.tab); }

  function fillControls() {
    const j = st.data, w = st.wk;
    const i = (j.weeks || []).findIndex(x => x.tab === st.tab);
    $('dpPrev').disabled = i <= 0; $('dpNext').disabled = i < 0 || i >= j.weeks.length - 1;
    $('dpWeek').innerHTML = (j.weeks || []).map(x => `<option value="${esc(x.tab)}">${esc(longDate(x.start))} – ${esc(longDate(x.end))}${x.start <= j.today && j.today <= x.end ? ' · this week' : ''}</option>`).join('');
    $('dpWeek').value = st.tab || '';
    const gsel = $('dpGroup'), gv = gsel.value;
    gsel.innerHTML = '<option value="">All groups</option>' + w.groups.map(g => `<option value="${esc(g.name)}">${esc(g.bullpen ? g.name + ' (no driver yet)' : g.name)}</option>`).join('');
    if ([...gsel.options].some(o => o.value === gv)) gsel.value = gv;
    $('dpSynced').textContent = 'From the dispatch sheet · updated ' + ago(j.synced_at);
    $('dpSynced').classList.toggle('stale', !j.synced_at || Date.now() - new Date(j.synced_at).getTime() > 3 * 3600e3);
  }

  /* ---------- render ---------- */
  function filteredGroups() {
    const q = $('dpSearch').value.trim().toLowerCase(), g = $('dpGroup').value;
    return st.wk.groups.filter(x => !g || x.name === g).map(x => ({ ...x, rows: x.rows.filter(r => !q ||
      [r.driver, r.truck, r.grp, r.post].some(v => v && v.toLowerCase().includes(q)) ||
      Object.values(r.cells).some(c => (c.a + ' ' + c.n).toLowerCase().includes(q))) })).filter(x => x.rows.length);
  }
  function dayStats(day) {
    let loads = new Set(), working = 0, off = 0;
    st.wk.rows.forEach(r => {
      const c = r.cells[day]; if (!c || !(c.a || c.post || c.off)) return;
      if (!c.off) loadsIn(c.a).forEach(l => loads.add(l));
      if (r.driver && !r.section) { if (c.off) off++; else working++; }
    });
    return { loads: loads.size, working, off };
  }
  function render() {
    if (!st.loaded) return;
    const w = st.wk, box = $('dpBox');
    if (!w.days.length) { box.innerHTML = '<div class="dp-empty">No weeks have come over from the dispatch sheet yet. Once the Dispatch Extract script runs with the sync key, they show up here.</div>'; return; }
    const view = phone() ? 'day' : (st.view || (window.matchMedia('(max-width: 900px)').matches ? 'day' : 'week'));
    document.querySelectorAll('[data-dpview]').forEach(b => b.classList.toggle('active', b.dataset.dpview === view));
    const hasWeekend = w.days.some(d => [0, 6].includes(D(d).getDay()) && w.rows.some(r => r.cells[d] && r.cells[d].a));
    $('dpWeekendWrap').hidden = view !== 'week' || hasWeekend;   // weekend columns always show when they have plans
    const days = w.days.filter(d => view !== 'week' || st.weekend || hasWeekend || ![0, 6].includes(D(d).getDay()));
    st.check = annotate(st.wk, st.data.names);
    const groups = filteredGroups(), q = $('dpSearch').value.trim();
    const today = st.data.today;
    const totals = w.days.reduce((a, d) => { const s = dayStats(d); a.loads += s.loads; return a; }, { loads: 0 });
    const drivers = w.rows.filter(r => r.driver && !r.section && !r.spot).length;
    const spotters = w.rows.filter(r => r.spot).length;
    const bullpen = w.rows.filter(r => r.section).reduce((a, r) => a + Object.values(r.cells).filter(c => c.a).length, 0);

    let html = `<div class="dp-head"><div><h3>Week of ${esc(longDate(w.start))} – ${esc(longDate(w.end))}</h3>
      <span class="hint">Tab ${esc(st.tab)} · ${drivers} drivers${spotters ? ` · ${spotters} spotters` : ''} · ${totals.loads} load #s planned${bullpen ? ` · <b class="dp-bp-n">${bullpen} in the bullpen</b>` : ''}</span></div></div>`;

    html += checkHtml(view === 'week' ? days : [st.day]);

    if (view === 'week') {
      const quiet = groups.filter(g => !g.bullpen && g.rows.every(r => !Object.values(r.cells).some(c => c.a || c.post || c.off || c.abs)));
      const busy = groups.filter(g => !quiet.includes(g));
      html += `<div class="dp-scroll"><table class="dp-grid" style="--dp-days:${days.length}"><thead><tr><th class="dp-who">Driver</th>${days.map(d => {
        const s = dayStats(d), dt = D(d);
        return `<th class="${d === today ? 'today' : ''}${[0, 6].includes(dt.getDay()) ? ' wknd' : ''}"><b>${DOW[dt.getDay()]}</b> <span>${md(d)}</span>
          <small>${s.loads ? s.loads + ' loads' : ''}${s.off ? `${s.loads ? ' · ' : ''}${s.off} off` : ''}</small></th>`;
      }).join('')}</tr></thead><tbody>`;
      busy.forEach(g => {
        html += `<tr class="dp-g${g.bullpen ? ' bp' : ''}"><th colspan="${days.length + 1}"><span>${esc(g.bullpen ? g.name : g.name)}</span>${g.bullpen ? '<small>Loads not on a driver yet</small>' : `<small>${g.rows.length} ${g.rows[0].spot ? (g.rows.length === 1 ? 'spotter' : 'spotters') : (g.rows.length === 1 ? 'driver' : 'drivers')}</small>`}</th></tr>`;
        g.rows.forEach(r => {
          html += `<tr class="dp-r"><th class="dp-who">${r.driver ? `<b>${esc(r.driver)}</b>` : g.bullpen ? '<b class="muted">No driver</b>' : ''}${r.truck ? `<span class="dp-truck">${esc(r.truck)}</span>` : ''}</th>` +
            days.map(d => { const b = body(r.cells[d], q), cls = (d === today ? ' today' : '') + ([0, 6].includes(D(d).getDay()) ? ' wknd' : '');
              return `<td class="dp-c ${b.cls}${cls}">${b.html}</td>`; }).join('') + '</tr>';
        });
      });
      html += '</tbody></table></div>';
      if (quiet.length) html += quietHtml(quiet);
    } else {
      const flag = d => (st.check && st.check.issues.some(x => x.d === d)) || w.rows.some(r => r.spot && r.cells[d] && r.cells[d].off && !r.cells[d].cover);
      html += `<div class="dp-days" id="dpDays">${w.days.map(d => { const s = dayStats(d), dt = D(d);
        return `<button type="button" class="dp-day${d === st.day ? ' active' : ''}${d === today ? ' today' : ''}" data-dpday="${d}"><b>${DOW[dt.getDay()]}</b><span>${md(d)}</span><small>${s.loads || '–'}</small>${flag(d) ? '<i class="dp-dot" title="Something to check"></i>' : ''}</button>`; }).join('')}</div>`;
      const d = st.day, s = dayStats(d);
      html += `<div class="dp-dayhead"><b>${DOWL[D(d).getDay()]}, ${esc(longDate(d))}</b>${d === today ? ' <span class="dp-now">Today</span>' : ''}<span class="hint">${s.working} working · ${s.off} off · ${s.loads} load #s${phone() ? ' · swipe for the next day' : ''}</span></div>`;
      groups.forEach(g => {
        const rows = g.rows.filter(r => g.bullpen ? (r.cells[d] && r.cells[d].a) : true);
        if (!rows.length) return;
        const any = rows.some(r => { const c = r.cells[d]; return c && (c.a || c.post || c.off || c.abs); });
        if (!any && !g.bullpen) { html += `<div class="dp-lgrp quiet"><span>${esc(g.name)}</span> <small>${rows.map(r => esc(r.driver || r.truck)).join(' · ')}</small> <em>nothing planned</em></div>`; return; }
        html += `<div class="dp-lgrp${g.bullpen ? ' bp' : ''}"><span>${esc(g.name)}</span>${g.bullpen ? '<small>Loads not on a driver yet</small>' : ''}</div>`;
        rows.forEach(r => {
          const b = body(r.cells[d], q, true);
          html += `<div class="dp-card ${b.cls}"><div class="dp-card-who">${r.driver ? `<b>${esc(r.driver)}</b>` : '<b class="muted">No driver</b>'}${r.truck ? `<span class="dp-truck">${esc(r.truck)}</span>` : ''}</div>
            <div class="dp-card-body">${b.html}</div></div>`;
        });
      });
    }
    if (!groups.length) html += /^\d{4,7}$/.test(q) ? '<div id="dpElsewhere"><div class="dp-empty">Not on this week. Looking in the other weeks…</div></div>' : '<div class="dp-empty">Nothing matches.</div>';
    html += `<p class="hint dp-foot">Read-only copy of the dispatch sheet. Make changes in the sheet; they show up here after the next sync. Tap a load # to copy it.</p>`;
    box.innerHTML = html;
    if ($('dpDays')) $('dpDays').style.top = stickyTop() + 'px';
    if ($('dpElsewhere')) findLoad(q, $('dpElsewhere'), true);
  }
  // What goes in one driver's day, used by both the week grid and the phone day view.
  function body(c, q, card) {
    if (!c || (!c.a && !c.n && !c.post && !c.abs)) return { cls: 'empty none', html: card ? '<span class="muted">Nothing planned</span>' : '' };
    const ab = absBadge(c), acls = c.absState ? ' abs-' + c.absState : '';
    if (c._absOnly) return { cls: 'empty' + acls, html: (c.post ? `<div class="dp-post">${fmtStop(c.post, q)}</div>` : '') + ab };
    const note = c.noteShown ? `<span class="dp-note" title="Note">${esc(c.noteShown)}</span>` : '';
    const post = c.post ? `<div class="dp-post">${fmtStop(c.post, q)}</div>` : '';
    if (c.off) {
      return { cls: 'off' + acls, html: note + `<span class="dp-offlbl">${esc(c.offText)}</span>` + ab +
        (c.post ? `<div class="dp-post muted-post">${esc(c.post)}</div>` + (c.cover ? `<div class="dp-cover">Covering: <b>${fmtStop(c.cover, q)}</b></div>` : '<div class="dp-need">Needs cover</div>') : '') };
    }
    const hit = q && [c.a, c.n, c.post].join(' ').toLowerCase().includes(q.toLowerCase());
    return { cls: (hit ? 'hit' : '') + acls, html: note + ab + post + stops(c.a).map(x => `<div class="dp-stop">${fmtStop(x, q)}</div>`).join('') };
  }
  function quietHtml(groups) {
    return `<div class="dp-quiet"><div class="dp-quiet-h">Nothing planned on the sheet this week</div>${groups.map(g => `<div class="dp-quiet-g"><b>${esc(g.name)}</b> ${g.rows.map(r => `<span>${esc(r.driver || '')}${r.truck ? ` <em>${esc(r.truck)}</em>` : ''}</span>`).join('')}</div>`).join('')}</div>`;
  }


  // Height of whatever bar stays pinned at the top of the app, so the day strip sticks just under it.
  function stickyTop() {
    let h = 0;
    document.querySelectorAll('header, nav, [class*="nav"], [class*="top"], [class*="bar"], [class*="head"]').forEach(e => {
      if (e.closest('#dpBox')) return;
      const cs = getComputedStyle(e);
      if ((cs.position === 'sticky' || cs.position === 'fixed') && parseFloat(cs.top || '1') <= 1 && cs.display !== 'none') {
        const r = e.getBoundingClientRect();
        if (r.height > 0 && r.height < 160 && r.width > window.innerWidth * 0.6) h = Math.max(h, r.height);
      }
    });
    return Math.round(h);
  }
  // Swipe left / right on the day list to go to the next / previous day (crosses into the next week too).
  function swipe(dir) {
    const w = st.wk; if (!w || !st.day) return;
    const i = w.days.indexOf(st.day), j = i + dir;
    if (j >= 0 && j < w.days.length) { st.day = w.days[j]; render(); return; }
    const ws = st.data.weeks || [], k = ws.findIndex(x => x.tab === st.tab) + dir;
    if (k >= 0 && k < ws.length) { const target = dir > 0 ? ws[k].start : ws[k].end; load(ws[k].tab).then(() => { st.day = target; render(); }); }
  }

  /* ---------- load # lookup (every synced week) ---------- */
  let findSeq = 0;
  async function findLoad(raw, box, inPlan) {
    const q = String(raw || '').replace(/\D/g, '');
    const seq = ++findSeq;
    box.hidden = false;
    if (!inPlan) box.innerHTML = `<div class="card"><p class="hint" style="margin:0">Looking for load <b>${esc(q)}</b> on the weekly plan…</p></div>`;
    try {
      const j = await rpc('dispatch_find_load', { p_q: q });
      if (seq !== findSeq) return;
      const hits = j.hits || [];
      const items = hits.map(h => {
        const who = h.driver ? niceName(h.driver) : (h.section ? 'Bullpen · no driver yet' : '');
        const dt = D(h.day);
        return `<div class="dp-hit" role="button" tabindex="0" data-goweek="${esc(h.tab)}" data-goday="${esc(h.day)}">
          <span class="dp-hit-d"><b>${DOW[dt.getDay()]}</b> ${esc(longDate(h.day))}</span>
          <span class="dp-hit-w"><b>${esc(who)}</b>${h.truck ? ` <span class="dp-truck">${esc(h.truck)}</span>` : ''}<small>${esc(h.section || h.grp || '')}</small></span>
          <span class="dp-hit-a">${stops(h.a || '').map(x => `<div class="dp-stop">${fmtStop(x, q).replace(/<button type="button" class="dp-load"[^>]*>([^<]*)<\/button>/g, '<span class="dp-load">$1</span>')}</div>`).join('')}${h.n ? `<span class="dp-note">${esc(h.n)}</span>` : ''}</span>
          <span class="dp-hit-go">Open week ›</span></div>`;
      }).join('');
      const head = `<div class="yb-driver-head"><h3 style="margin:0">Load ${esc(q)}</h3>${inPlan ? '' : '<button type="button" class="ghost" data-findclear>✕ Clear</button>'}</div>`;
      box.innerHTML = `<div class="card dp-find">${head}${hits.length
        ? `<p class="hint">On the dispatch sheet ${hits.length === 1 ? 'once' : hits.length + ' times'} in the synced weeks${hits.length === 40 ? ' (newest 40)' : ''}:</p><div class="dp-hits">${items}</div>`
        : `<p class="hint">Not on the dispatch sheet in the last 10 weeks. It may be in McLeod only, or typed differently on the sheet.</p>`}</div>`;
    } catch (e) {
      if (seq === findSeq) box.innerHTML = `<div class="card"><p class="hint" style="margin:0">${esc(e.message)}</p></div>`;
    }
  }
  // Open the Weekly Plan on a week and day (from a load # hit or a Home card)
  function focus(tab, day) {
    if (window.TMApp && TMApp.open) TMApp.open('dispatch'); else if (window.LWHUI && LWHUI.show) LWHUI.show('yardBoard');
    const b = document.querySelector('#ybTabs [data-ybtab="plan"]'); if (b && !b.classList.contains('active')) b.click();
    const f = document.getElementById('ybFind'); if (f) { f.hidden = true; f.innerHTML = ''; }
    const fi = document.getElementById('ybFindInput'); if (fi) fi.value = '';
    $('dpSearch').value = ''; st.day = day || st.day; st.chkOpen = true;
    load(tab || null).then(() => {
      if (day && st.wk && !st.wk.days.includes(day)) {
        const w = (st.data.weeks || []).find(x => x.start <= day && day <= x.end);
        if (w) return load(w.tab).then(() => { st.day = day; render(); });
      }
      if (day) { st.day = day; render(); }
    }).then(() => $('dpBox').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  /* ---------- Home > Needs attention: today and the next workday ---------- */
  let attAt = 0, attBusy = false;
  async function attention(force) {
    if (!window.TMAttention || !TMAttention.setExtra || attBusy) return;
    if (!force && Date.now() - attAt < 5 * 60000) return;
    if (!token()) return TMAttention.setExtra('dispatch', []);
    attBusy = true;
    try {
      const j = await rpc('dispatch_plan_week', { p_tab: null });
      await loadAbs(false);
      const today = j.today, nd = D(today);
      do { nd.setDate(nd.getDate() + 1); } while ([0, 6].includes(nd.getDay()));
      const days = [today, iso(nd)].filter(d => ![0, 6].includes(D(d).getDay()));
      const weeks = [build(j)];
      const w0 = weeks[0];
      if (days.some(d => !w0.days.includes(d))) {
        const next = (j.weeks || []).find(x => x.start <= days[days.length - 1] && days[days.length - 1] <= x.end && x.tab !== j.tab);
        if (next) weeks.push(build(await rpc('dispatch_plan_week', { p_tab: next.tab })));
      }
      const lab = d => d === today ? 'Today' : DOW[D(d).getDay()];
      let bp = {}, cover = [], abs = [];
      weeks.forEach(w => {
        const ck = annotate(w, j.names);
        days.filter(d => w.days.includes(d)).forEach(d => {
          w.rows.forEach(r => {
            const c = r.cells[d]; if (!c) return;
            if (r.section && c.a) bp[d] = (bp[d] || 0) + 1;
            if (r.spot && c.off && !c.cover) cover.push({ d, r });
          });
          if (ck) ck.issues.filter(x => x.d === d).forEach(x => abs.push(x));
        });
      });
      const cards = [];
      const firstDay = (list, k) => (list[0] || {})[k];
      if (cover.length) cards.push({ n: cover.length, t: cover.length === 1 ? 'spotter post needs cover' : 'spotter posts need cover', lv: 'bad',
        sub: cover.slice(0, 4).map(x => `${x.r.post} ${lab(x.d)} (${x.r.driver} off)`).join(', '), day: firstDay(cover, 'd') });
      const bpN = Object.values(bp).reduce((a, b) => a + b, 0);
      if (bpN) cards.push({ n: bpN, t: bpN === 1 ? 'bullpen load without a driver' : 'bullpen loads without a driver', lv: 'warn',
        sub: days.filter(d => bp[d]).map(d => `${lab(d)}: ${bp[d]}`).join(' · ') + ' · tap to see them', day: days.find(d => bp[d]) });
      if (abs.length) cards.push({ n: abs.length, t: abs.length === 1 ? "absence doesn't match the sheet" : "absences don't match the sheet", lv: 'warn',
        sub: abs.slice(0, 4).map(x => `${x.r.driver} ${lab(x.d)}`).join(', ') + ' · sheet vs. absence tracker', day: firstDay(abs, 'd') });
      cards.forEach(c => { c.go = 'dispatch'; c.plan = c.day; });
      TMAttention.setExtra('dispatch', cards);
      attAt = Date.now();
    } catch (e) { /* the rest of Needs attention still shows */ }
    finally { attBusy = false; }
  }

  /* ---------- export ---------- */
  function csv() {
    if (!st.loaded) return;
    const w = st.wk, head = ['Group', 'Truck', 'Driver'].concat(w.days.map(d => DOW[D(d).getDay()] + ' ' + d), w.days.map(d => 'Notes ' + DOW[D(d).getDay()]));
    const dayText = c => !c ? '' : [c.post, c.off ? c.offText.toUpperCase() : '', c.cover ? 'Covering: ' + c.cover : (c.off ? '' : c.a)].filter(Boolean).join(' · ');
    const lines = [head].concat(w.rows.map(r => [r.section ? r.section : r.grp, r.truck || r.post || '', r.driver].concat(w.days.map(d => dayText(r.cells[d])), w.days.map(d => (r.cells[d] || {}).n || ''))));
    const body = lines.map(l => l.map(v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' }));
    a.download = 'dispatch-week-' + w.start + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- wiring ---------- */
  function init() {
    if (!$('dpBox')) return;
    $('dpPrev').onclick = () => { const ws = st.data.weeks, i = ws.findIndex(x => x.tab === st.tab); if (i > 0) load(ws[i - 1].tab); };
    $('dpNext').onclick = () => { const ws = st.data.weeks, i = ws.findIndex(x => x.tab === st.tab); if (i >= 0 && i < ws.length - 1) load(ws[i + 1].tab); };
    $('dpThis').onclick = () => { st.day = null; load(null); };
    $('dpWeek').addEventListener('change', e => load(e.target.value));
    $('dpSearch').addEventListener('input', render);
    $('dpGroup').addEventListener('change', render);
    $('dpWeekend').addEventListener('change', e => { st.weekend = e.target.checked; render(); });
    document.querySelectorAll('[data-dpview]').forEach(b => b.onclick = () => { st.view = b.dataset.dpview; render(); });
    $('dpBox').addEventListener('click', e => {
      const l = e.target.closest('[data-load]');
      if (l) { const n = l.dataset.load; (navigator.clipboard ? navigator.clipboard.writeText(n) : Promise.reject()).then(() => toast('Copied load # ' + n, 'ok')).catch(() => {}); return; }
      const d = e.target.closest('[data-dpday]'); if (d) { st.day = d.dataset.dpday; render(); }
      const u = e.target.closest('[data-unlink]'); if (u) saveLink(u.dataset.unlink, '');
      const h = e.target.closest('[data-goweek]'); if (h) { $('dpSearch').value = ''; st.day = h.dataset.goday; load(h.dataset.goweek); }
    });
    $('dpBox').addEventListener('change', e => { const s = e.target.closest('select[data-linkname]'); if (s && s.value !== '') saveLink(s.dataset.linkname, s.value); });
    $('dpBox').addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('dp-chk')) st.chkOpen = e.target.open; }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('dp-hit')) e.target.click(); });
    // load # hits shown in the Dispatch Board's find area
    document.getElementById('ybFind') && document.getElementById('ybFind').addEventListener('click', e => {
      const h = e.target.closest('[data-goweek]'); if (h) focus(h.dataset.goweek, h.dataset.goday);
    });
    let tx = null, ty = 0;
    $('dpBox').addEventListener('touchstart', e => { if (e.touches.length === 1 && !e.target.closest('.dp-scroll, select, input, .dp-chk')) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; } else tx = null; }, { passive: true });
    $('dpBox').addEventListener('touchend', e => {
      if (tx === null || !document.getElementById('dpDays')) return;
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 45) swipe(dx < 0 ? 1 : -1);
    }, { passive: true });
    let rt = null; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!st.view && st.loaded && !$('dpBox').hidden) render(); }, 200); });
  }
  window.addEventListener('load', init);
  return { open, refresh, csv, findLoad, focus, attention };
})();
