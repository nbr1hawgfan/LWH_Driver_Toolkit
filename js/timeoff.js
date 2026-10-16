/* Unpaid Time Off — driver side of the LWH Time Off Requests app.
   Talks to the same Apps Script backend (same Sheet, manager emails and
   Outlook invites). Managers keep approving in the Time Off app's Manager tab. */
(function () {
  const API = 'https://script.google.com/macros/s/AKfycbxz1Jp44C5vJnn1EPSkgaxwf3Vn96l_ctgjTXNgYKFj4jTU89nuJMZ4RuWtxt7SWKa5Kg/exec';
  const $ = id => document.getElementById(id);
  const safe = s => LWHUI.safe(s);
  const st = { meta: null, type: 'Full', mine: [], loading: false };

  async function api(action, data, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 45000);
    let text;
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, data || {})), redirect: 'follow', signal: ctrl.signal });
      text = await res.text();
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'The server took too long to answer.' : 'No connection to the server.'); }
    finally { clearTimeout(t); }
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error('The time off server could not be reached.'); }
    if (!j.ok) throw new Error(j.error || 'Request failed.');
    return j;
  }

  /* ---------- helpers ---------- */
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const dObj = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayDiff = (a, b) => Math.round((dObj(b) - dObj(a)) / 86400000);
  const fmtD = (s, yr) => s ? dObj(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: yr ? 'numeric' : undefined }) : '';
  const fmtT = t => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + pad(m) + ' ' + ap; };
  const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  function when(r) {
    if (r.type === 'Partial') return fmtD(r.startDate) + ' · ' + fmtT(r.startTime) + '–' + fmtT(r.endTime);
    return r.startDate === r.endDate ? fmtD(r.startDate) : fmtD(r.startDate) + ' – ' + fmtD(r.endDate);
  }
  const amount = r => r.type === 'Partial' ? r.hours + ' hrs' : r.days + (r.days === 1 ? ' day' : ' days');
  const driver = () => $('toDriver').value;

  /* ---------- load roster ---------- */
  async function loadMeta() {
    if (st.loading) return; st.loading = true;
    const cached = LWHStorage.get('utoMeta', null);
    if (cached && !st.meta) applyMeta(cached);
    try { const j = await api('meta'); LWHStorage.set('utoMeta', { categories: j.categories, drivers: j.drivers, maxDays: j.maxDays }); applyMeta(j); $('toErr').hidden = true; }
    catch (e) { if (!st.meta) { $('toErrMsg').textContent = e.message; $('toErr').hidden = false; } }
    finally { st.loading = false; }
  }
  function applyMeta(m) {
    st.meta = m;
    const sel = $('toDriver');
    const saved = LWHStorage.get('utoDriver', '') || '';
    const profile = (LWHStorage.get('userName', '') || '').trim();
    sel.innerHTML = '<option value="">Select your name…</option>' + (m.drivers || []).map(n => `<option>${safe(n)}</option>`).join('');
    const pick = (m.drivers || []).includes(saved) ? saved : (m.drivers || []).find(n => n.toLowerCase() === profile.toLowerCase()) || '';
    sel.value = pick;
    const cat = $('toCat'), keep = cat.value;
    cat.innerHTML = '<option value="">Select…</option>' + (m.categories || []).map(c => `<option>${safe(c)}</option>`).join('');
    cat.value = keep;
    if (!$('toMine').hidden) loadMine();
  }

  /* ---------- tabs ---------- */
  function tab(t) {
    document.querySelectorAll('#toTabs .seg').forEach(b => b.classList.toggle('active', b.dataset.totab === t));
    $('toForm').hidden = t !== 'req'; $('toMine').hidden = t !== 'mine';
    if (t === 'mine') loadMine();
  }

  /* ---------- request form ---------- */
  function setType(t) {
    st.type = t;
    document.querySelectorAll('#toType .seg').forEach(b => b.classList.toggle('active', b.dataset.type === t));
    $('toEndWrap').hidden = t === 'Partial'; $('toTimes').hidden = t !== 'Partial';
    $('toStartLbl').textContent = t === 'Partial' ? 'Date' : 'Start date';
    summary();
  }
  function compute() {
    const r = { type: st.type, startDate: $('toStart').value, category: $('toCat').value, reason: $('toReason').value.trim() };
    if (!r.startDate) return { r, err: 'Pick your dates', soft: true };
    const maxDays = (st.meta && st.meta.maxDays) || 30;
    if (r.type === 'Full') {
      r.endDate = $('toEnd').value || r.startDate;
      if (r.endDate < r.startDate) return { r, err: 'End date is before the start date' };
      r.days = dayDiff(r.startDate, r.endDate) + 1;
      if (r.days > maxDays) return { r, err: 'Max ' + maxDays + ' days per request' };
    } else {
      r.endDate = r.startDate; r.startTime = $('toT1').value; r.endTime = $('toT2').value;
      if (!r.startTime || !r.endTime) return { r, err: 'Pick the start and end times', soft: true };
      if (r.endTime <= r.startTime) return { r, err: 'End time must be after the start time' };
      r.hours = Math.round((mins(r.endTime) - mins(r.startTime)) / 60 * 100) / 100;
    }
    return { r };
  }
  function summary() {
    const { r, err, soft } = compute(), el = $('toSummary');
    el.classList.toggle('err', !!err && !soft);
    if (err) { el.textContent = err; return; }
    el.textContent = (r.type === 'Partial'
      ? fmtD(r.startDate, true) + ' · ' + fmtT(r.startTime) + '–' + fmtT(r.endTime) + ' · ' + r.hours + ' hrs'
      : (r.days === 1 ? fmtD(r.startDate, true) : fmtD(r.startDate) + ' – ' + fmtD(r.endDate, true)) + ' · ' + r.days + (r.days === 1 ? ' day' : ' days'))
      + (r.startDate < today() ? '  ·  ⚠ starts in the past' : '');
  }
  async function submit() {
    if (!driver()) return LWHUI.toast('Select your name first');
    const { r, err } = compute();
    if (err) return LWHUI.toast(err);
    if (!r.category) return LWHUI.toast('Pick a reason category');
    if (r.reason.length < 5) return LWHUI.toast('Please explain the reason');
    const btn = $('toSubmit'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api('submit', { driver: driver(), request: r });
      LWHUI.toast('Request sent — the managers have been emailed.');
      $('toReason').value = ''; $('toStart').value = ''; $('toEnd').value = ''; $('toT1').value = ''; $('toT2').value = ''; $('toCat').value = '';
      setType('Full'); tab('mine');
    } catch (e) { LWHUI.toast(e.message); }
    finally { btn.disabled = false; btn.textContent = 'Submit request'; }
  }

  /* ---------- my requests ---------- */
  async function loadMine() {
    const box = $('toList');
    if (!driver()) { box.innerHTML = '<p class="hint" style="text-align:center;padding:20px">Select your name above to see your requests.</p>'; return; }
    if (!st.mine.length) box.innerHTML = '<p class="hint" style="text-align:center;padding:20px">Loading…</p>';
    try {
      const j = await api('myRequests', { driver: driver() });
      st.mine = j.requests || []; renderMine();
    } catch (e) { box.innerHTML = `<p class="hint" style="text-align:center;padding:20px">${safe(e.message)}</p>`; }
  }
  function renderMine() {
    const box = $('toList'), t = today();
    if (!st.mine.length) { box.innerHTML = '<p class="hint" style="text-align:center;padding:20px">No requests yet.</p>'; return; }
    box.innerHTML = st.mine.map(r => `
      <div class="to-card s-${r.status}">
        <div class="to-top"><div><div class="to-when">${safe(when(r))}</div><div class="hint">${safe(amount(r))} · ${safe(r.category)}</div></div><span class="to-pill s-${r.status}">${safe(r.status)}</span></div>
        <div class="to-reason">${safe(r.reason)}</div>
        ${r.decidedBy && r.status !== 'Cancelled' ? `<div class="hint">${safe(r.status)} by ${safe(r.decidedBy)}</div>` : ''}
        ${r.status === 'Cancelled' && r.cancelledBy ? `<div class="hint">Cancelled by ${safe(r.cancelledBy)}</div>` : ''}
        ${r.managerNote ? `<div class="to-note">Manager note: ${safe(r.managerNote)}</div>` : ''}
        ${(r.status === 'Pending' || r.status === 'Approved') && r.endDate >= t ? `<button type="button" class="ghost to-cancel" data-cancel="${safe(r.id)}">Cancel request</button>` : ''}
      </div>`).join('');
  }
  async function cancel(id) {
    if (!confirm('Cancel this request?')) return;
    try { await api('driverCancel', { driver: driver(), id }); LWHUI.toast('Request cancelled'); loadMine(); }
    catch (e) { LWHUI.toast(e.message); }
  }

  /* ---------- wiring ---------- */
  function init() {
    const root = $('timeoff'); if (!root) return;
    document.querySelectorAll('#toTabs .seg').forEach(b => b.onclick = () => tab(b.dataset.totab));
    document.querySelectorAll('#toType .seg').forEach(b => b.onclick = () => setType(b.dataset.type));
    $('toDriver').addEventListener('change', () => { LWHStorage.set('utoDriver', driver()); st.mine = []; if (!$('toMine').hidden) loadMine(); });
    ['toStart', 'toEnd', 'toT1', 'toT2'].forEach(id => $(id).addEventListener('change', () => {
      if (id === 'toStart' && st.type === 'Full') { const s = $('toStart').value, e = $('toEnd').value; $('toEnd').min = s; if (s && (!e || e < s)) $('toEnd').value = s; }
      summary();
    }));
    $('toSubmit').onclick = submit;
    $('toList').addEventListener('click', e => { const b = e.target.closest('[data-cancel]'); if (b) cancel(b.dataset.cancel); });
    $('toRetry').onclick = loadMeta;
    const obs = new MutationObserver(() => { if (root.classList.contains('active')) loadMeta(); });
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    if (root.classList.contains('active')) loadMeta();
  }
  window.addEventListener('load', init);
})();
