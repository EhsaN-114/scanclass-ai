/* Admin: department admin gives each section's CR a private PIN */

const Admin = (() => {
  let token = null; // kept in memory only: closing the tab logs the admin out
  let sections = [];
  let dept = '';
  let sem = '';

  async function adminApi(url, options = {}) {
    const headers = { 'x-admin-token': token || '' };
    if (options.json) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.json);
    }
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/api/admin/login') { token = null; show(); }
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  function show() {
    $('#adminLogout').hidden = !token;
    if (!token) {
      $('#adminBody').innerHTML = `<div class="card" style="max-width:460px">
        <h3 style="font-size:17px">Admin login</h3>
        <p class="muted" style="margin:6px 0 0;font-size:14px">For the department office or organizer. The admin key is set on the server.</p>
        <label class="lbl" for="adminKey">Admin key</label>
        <input type="password" id="adminKey" autocomplete="off">
        <button class="btn btn-primary btn-block" id="adminLogin"><svg><use href="#i-shield"/></svg> Log in</button></div>`;
      $('#adminLogin').addEventListener('click', login);
      $('#adminKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
      return;
    }
    load();
  }

  async function login() {
    const key = $('#adminKey').value;
    if (!key) return toast('Enter the admin key.');
    try {
      token = (await adminApi('/api/admin/login', { method: 'POST', json: { key } })).token;
      show();
    } catch (e) { toast(e.message); }
  }

  async function load() {
    try {
      sections = (await adminApi('/api/admin/sections')).sections;
      const depts = [...new Set(sections.map((s) => s.dept))];
      dept = dept || depts[0];
      const sems = [...new Set(sections.filter((s) => s.dept === dept).map((s) => s.semester))];
      if (!sems.includes(sem)) sem = sems[0];
      const rows = sections.filter((s) => s.dept === dept && s.semester === sem);
      const privateCount = sections.filter((s) => s.pin === 'private').length;
      $('#adminBody').innerHTML = `
        <p class="muted" style="margin:0 0 12px;font-size:13.5px">${privateCount} of ${sections.length} sections have a private PIN. Others still use the demo PIN 1234.</p>
        <div class="admin-filters">
          <select id="aDept">${depts.map((d) => `<option ${d === dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
          <select id="aSem">${sems.map((s) => `<option value="${esc(s)}" ${s === sem ? 'selected' : ''}>Semester ${esc(s)}</option>`).join('')}</select>
        </div>
        ${rows.map((s) => `<div class="admin-row">
          <div class="grow"><b>${esc(s.dept)} · ${esc(s.section)}</b><br>
            <span class="pin-state ${s.pin}">${s.pin === 'private' ? 'Private PIN set' : 'Demo PIN (1234)'}</span>
            ${s.setAt ? `<small class="muted"> · ${esc(new Date(s.setAt).toLocaleDateString())}</small>` : ''}</div>
          <button class="btn ${s.pin === 'private' ? 'btn-ghost' : 'btn-primary'} btn-sm" data-key="${esc(s.key)}">${s.pin === 'private' ? 'Reset PIN' : 'Generate PIN'}</button>
        </div>`).join('')}`;
      $('#aDept').addEventListener('change', (e) => { dept = e.target.value; sem = ''; load(); });
      $('#aSem').addEventListener('change', (e) => { sem = e.target.value; load(); });
    } catch (e) {
      $('#adminBody').innerHTML = errorHTML(e.message);
    }
  }

  $('#adminBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    b.disabled = true;
    try {
      const { pin, section } = await adminApi('/api/admin/pin', { method: 'POST', json: { section: b.dataset.key } });
      openModal(`<h3 id="modalTitle">New CR PIN · ${esc(sectionLabel(section))}</h3>
        <p class="sub">Give this PIN privately to the CR of this section. It is shown only once. The old PIN no longer works.</p>
        <div class="big-pin">${esc(pin)}</div>
        <button class="btn btn-ghost btn-block" id="copyPin">Copy PIN</button>
        <button class="btn btn-primary btn-block" style="margin-top:10px" onclick="closeModal()">Done</button>
        <p class="hint">The CR can change it later from their profile.</p>`);
      $('#copyPin').addEventListener('click', () => {
        navigator.clipboard && navigator.clipboard.writeText(pin).then(() => toast('PIN copied.'), () => toast('Copy failed. Write it down.'));
      });
      load();
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  });

  $('#adminLogout').addEventListener('click', async () => {
    try { await adminApi('/api/admin/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
    token = null;
    show();
  });

  return { show };
})();
routeHooks.admin = () => Admin.show();
