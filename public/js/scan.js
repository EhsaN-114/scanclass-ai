/* Scan: Gemma 4 reads a routine photo into an editable table; the CR checks and shares it */

const Scan = (() => {
  let images = [];
  let rows = [];
  const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  const takeFile = setupDropzone($('#scanDrop'), (imgs) => {
    images = imgs;
    $('#scanBtn').disabled = false;
  });
  $('#scanDriveBox').innerHTML = driveRowHTML('scanDrive');
  wireDriveRow('scanDrive', takeFile);

  $('#scanBtn').addEventListener('click', async () => {
    const out = $('#scanResult');
    const btn = $('#scanBtn');
    btn.disabled = true;
    $('#scanActions').innerHTML = '';
    out.innerHTML = loadingHTML('Gemma 4 is reading the routine…', 'Working 0s');
    const stop = startTimer(out, 'Working');
    try {
      const fd = new FormData();
      images.forEach((img) => fd.append('image', img));
      if (state.profile) fd.append('hint', sectionLong(state.profile.section));
      const data = await api('/api/routine/extract', { method: 'POST', body: fd });
      rows = data.classes;
      draw(`✓ Read ${rows.length} classes with ${data.model} in ${data.seconds}s. Check every row against the photo.`);
    } catch (e) {
      out.innerHTML = errorHTML(e.message);
    } finally {
      stop();
      btn.disabled = false;
    }
  });

  function bad(r, k) {
    if (k === 'day') return !DAYS.includes(r.day);
    if (k === 'start' || k === 'end') return !/^\d{2}:\d{2}$/.test(r[k] || '') || (r.start && r.end && toMin(r.end) <= toMin(r.start));
    return !r[k];
  }

  function draw(msg) {
    $('#addRow').hidden = false;
    const out = $('#scanResult');
    if (!rows.length) {
      out.innerHTML = `<div class="empty"><p>No classes were found in this photo.<br>Try a straighter, brighter photo of the whole routine, or add rows by hand.</p></div>`;
      drawActions();
      return;
    }
    const lowCount = rows.filter((r) => r.confident === false).length;
    out.innerHTML = `${msg ? `<p class="ok-line">${esc(msg)}</p>` : ''}
      ${lowCount ? `<p class="ok-line" style="color:var(--maybe)">⚠️ ${lowCount} row${lowCount > 1 ? 's were' : ' was'} hard to read (highlighted). Please check them.</p>` : ''}
      <div class="table-wrap"><table class="rt"><thead><tr><th>Day</th><th>Start</th><th>End</th><th>Course</th><th>Section</th><th>Room</th><th>Teacher</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.confident === false ? 'low' : ''}" title="${esc(r.unclear || '')}">
        <td><select data-i="${i}" data-k="day" class="${bad(r, 'day') ? 'bad' : ''}"><option value="">?</option>${DAYS.map((d) => `<option ${r.day === d ? 'selected' : ''}>${d}</option>`).join('')}</select></td>
        <td><input type="time" data-i="${i}" data-k="start" value="${esc(r.start || '')}" class="${bad(r, 'start') ? 'bad' : ''}"></td>
        <td><input type="time" data-i="${i}" data-k="end" value="${esc(r.end || '')}" class="${bad(r, 'end') ? 'bad' : ''}"></td>
        <td><input data-i="${i}" data-k="course" value="${esc(r.course || '')}" class="${bad(r, 'course') ? 'bad' : ''}" placeholder="CSE-1121"></td>
        <td><input data-i="${i}" data-k="section" value="${esc(r.section || '')}" placeholder="2BM" style="width:70px"></td>
        <td><input data-i="${i}" data-k="room" value="${esc(r.room || '')}" class="${bad(r, 'room') ? 'bad' : ''}" placeholder="C-102" style="width:84px"></td>
        <td><input data-i="${i}" data-k="teacher" value="${esc(r.teacher || '')}" style="width:70px"></td>
        <td><button class="icon-btn" data-del="${i}" aria-label="Delete row"><svg><use href="#i-trash"/></svg></button></td>
      </tr>`).join('')}</tbody></table></div>`;
    drawActions();
  }

  function drawActions(changesHTML = '') {
    const box = $('#scanActions');
    if (!rows.length) { box.innerHTML = ''; return; }
    if (!state.crToken) {
      box.innerHTML = `<div class="actions-bar"><p>Only your section's <b>CR</b> can share a routine with the class.</p>
        <button class="btn btn-ghost" id="crFromScan"><svg><use href="#i-shield"/></svg> I'm the CR</button></div>`;
      $('#crFromScan').addEventListener('click', () => (state.profile ? openSetup(false) : openSetup(true)));
      return;
    }
    box.innerHTML = `${changesHTML}<div class="actions-bar"><p>Rows without a section are saved for <b>${esc(sectionLabel(state.profile.section))}</b>. Classmates get the update and a notice about any changes.</p>
      <button class="btn btn-ghost" id="previewBtn">Check changes</button>
      <button class="btn btn-primary" id="saveBtn"><svg><use href="#i-send"/></svg> Save &amp; notify class</button></div>`;
    $('#previewBtn').addEventListener('click', preview);
    $('#saveBtn').addEventListener('click', save);
  }

  async function preview() {
    try {
      const data = await api('/api/routine/preview', { method: 'POST', json: { classes: rows } });
      const list = data.changes.length
        ? `<div class="change-list">${data.changes.map((c) => `<div>${esc(c.text)}</div>`).join('')}</div>`
        : '<p class="ok-line">No changes compared with the saved routine.</p>';
      drawActions(`<h4 style="margin-top:14px">Detected changes (${data.changes.length})</h4>${list}`);
    } catch (e) {
      toast(e.message, 5000);
    }
  }

  async function save() {
    const btn = $('#saveBtn');
    btn.disabled = true;
    try {
      const data = await api('/api/routine/save', { method: 'POST', json: { classes: rows } });
      toast(`Saved ${data.saved} classes ✓${data.announcements ? ' · class notified' : ''}`, 4500);
      state.meta = await api('/api/meta');
      $('#scanActions').innerHTML = `<div class="actions-bar"><p>✅ Routine shared with ${esc(data.sections.map(sectionLabel).join(', '))}. ${data.changes.length ? `${data.changes.length} change(s) announced.` : ''}</p><a class="btn btn-ghost" href="#home">See timetable</a></div>`;
    } catch (e) {
      toast(e.message, 5000);
      btn.disabled = false;
    }
  }

  $('#scanResult').addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.k) return;
    const r = rows[+el.dataset.i];
    r[el.dataset.k] = el.value.trim();
    el.classList.toggle('bad', ['day', 'start', 'end', 'course', 'room'].includes(el.dataset.k) && bad(r, el.dataset.k));
  });
  $('#scanResult').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.k) rows[+el.dataset.i][el.dataset.k] = el.value.trim();
  });
  $('#scanResult').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    rows.splice(+b.dataset.del, 1);
    draw();
  });
  $('#addRow').addEventListener('click', () => {
    rows.push({ day: '', start: '', end: '', course: '', section: state.profile ? state.profile.section.split('|')[2] : '', room: '', teacher: '', confident: true });
    draw();
  });

  return { redrawActions: () => drawActions() };
})();
routeHooks.scan = () => Scan.redrawActions();
