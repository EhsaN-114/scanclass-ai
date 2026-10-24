/* Free Rooms: live view of which rooms are free, from every uploaded routine */

const Rooms = (() => {
  const f = { live: true, day: null, time: null, building: '', floor: '', hour: false };
  let initialized = false;
  let timer = null;

  function init() {
    if (initialized || !state.meta) return;
    initialized = true;
    const days = state.meta.days.includes(nowCtx().day) ? state.meta.days : [...state.meta.days, nowCtx().day];
    $('#fDay').innerHTML = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].filter((d) => days.includes(d)).map((d) => `<option value="${d}">${DAY_FULL[d]}</option>`).join('');
    $('#fBuilding').innerHTML = [`<button class="chip active" data-b="">All buildings</button>`, ...state.meta.buildings.map((b) => `<button class="chip" data-b="${esc(b)}">Building ${esc(b)}</button>`)].join('');
    const floors = [...new Set(state.meta.rooms.map((r) => r.floor).filter(Boolean))].sort();
    $('#fFloor').innerHTML = `<option value="">All floors</option>` + floors.map((x) => `<option value="${x}">Floor ${x}</option>`).join('');

    $('#nowBtn').addEventListener('click', () => { f.live = true; syncNow(); load(); });
    $('#fDay').addEventListener('change', (e) => { f.live = false; f.day = e.target.value; load(); });
    $('#fTime').addEventListener('change', (e) => { if (!e.target.value) return; f.live = false; f.time = e.target.value; load(); });
    $('#fBuilding').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      f.building = b.dataset.b;
      $$('#fBuilding .chip').forEach((x) => x.classList.toggle('active', x === b));
      load();
    });
    $('#fFloor').addEventListener('change', (e) => { f.floor = e.target.value; load(); });
    $('#fHour').addEventListener('change', (e) => { f.hour = e.target.checked; load(); });
    $('#roomGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.room');
      if (card) showRoom(card.dataset.id);
    });
  }

  function syncNow() {
    const n = nowCtx();
    f.day = n.day;
    f.time = n.time;
  }

  // Let other screens (Ask) open Free Rooms with filters
  function openWith({ day, time, building, floor }) {
    init();
    const n = nowCtx();
    f.live = (!day || day === n.day) && !time;
    f.day = day || n.day;
    f.time = time || n.time;
    f.building = building || '';
    f.floor = floor ? String(floor) : '';
    location.hash = 'rooms';
  }

  async function load() {
    init();
    if (f.live || !f.day) syncNow();
    $('#nowBtn').classList.toggle('active', f.live);
    $('#fDay').value = f.day;
    $('#fTime').value = f.time;
    $$('#fBuilding .chip').forEach((x) => x.classList.toggle('active', x.dataset.b === f.building));
    $('#fFloor').value = f.floor;

    const n = nowCtx();
    const params = new URLSearchParams({ day: f.day, time: f.time, min: f.hour ? 60 : 0 });
    if (f.day === n.day) params.set('date', n.date);
    if (f.building) params.set('building', f.building);
    if (f.floor) params.set('floor', f.floor);
    try {
      const data = await api(`/api/rooms/free?${params}`);
      draw(data);
    } catch (e) {
      $('#roomGrid').innerHTML = errorHTML(e.message);
    }
    clearInterval(timer);
    if (f.live) timer = setInterval(() => { if (!$('#view-rooms').hidden && f.live) load(); }, 60000);
  }

  function draw(data) {
    const free = data.rooms.filter((r) => r.status === 'free');
    const maybe = data.rooms.filter((r) => r.status === 'probably');
    const busy = data.rooms.filter((r) => r.status === 'busy');
    $('#roomSummary').innerHTML = `
      <div class="sum free"><b>${free.length}</b><span>Free</span></div>
      <div class="sum maybe"><b>${maybe.length}</b><span>Probably free</span></div>
      <div class="sum busy"><b>${busy.length}</b><span>Busy</span></div>`;
    $('#roomGrid').innerHTML = data.rooms.length ? data.rooms.map(card).join('') : `<div class="empty" style="grid-column:1/-1"><p>No rooms match these filters.</p></div>`;

    const c = data.coverage;
    if (!c.sections) {
      $('#roomSummary').innerHTML = `<div class="card" style="width:100%;border-color:rgba(251,191,36,.35)"><b>No routines uploaded yet.</b><p class="muted" style="margin:4px 0 0;font-size:13.5px">Free rooms become accurate as CRs scan their class routines. Until then every room shows as "probably free".</p></div>`;
    }
    $('#coverage').innerHTML = `
      <b>How complete is this?</b> Routines from ${c.sections} of ${c.totalSections} sections are uploaded.
      ${Object.entries(c.buildings).map(([b, v]) => `<div style="margin-top:8px">Building ${esc(b)}: ${v.known} of ${v.total} rooms appear in routines<div class="bar"><i style="width:${Math.round((v.known / v.total) * 100)}%"></i></div></div>`).join('')}
      <div class="legend"><span style="--c:var(--free)">Free: no class in any uploaded routine</span><span style="--c:var(--maybe)">Probably free: not in any routine yet</span><span style="--c:var(--busy)">Busy: class scheduled</span></div>`;
  }

  function card(r) {
    const loc = `Building ${esc(r.building)}${r.floor ? ' · Floor ' + r.floor : ''}${r.type === 'Lab' ? ' · Lab' : ''}`;
    let st;
    let sub = '';
    if (r.status === 'busy') {
      st = `Busy until ${time12(r.until)}`;
      sub = `${esc(r.current.course)} · ${esc(r.current.section)}${r.current.extra ? ' · extra' : ''}`;
    } else {
      st = r.until ? `Free until ${time12(r.until)}` : 'Free rest of day';
      sub = r.status === 'probably' ? 'Not in any routine yet' : (r.until ? `${Math.floor(r.freeMinutes / 60) ? Math.floor(r.freeMinutes / 60) + 'h ' : ''}${r.freeMinutes % 60}m free` : '');
    }
    return `<button class="room ${r.status}" data-id="${esc(r.id)}">
      <div class="room-id">${esc(r.id)}</div><div class="room-loc">${loc}</div>
      <div class="room-state">${st}</div><div class="room-sub">${sub}</div></button>`;
  }

  async function showRoom(id) {
    openModal(loadingHTML(`Loading ${id}…`));
    try {
      const n = nowCtx();
      const data = await api(`/api/rooms/${encodeURIComponent(id)}/day?day=${f.day}${f.day === n.day ? '&date=' + n.date : ''}`);
      const start = 8 * 60;
      const span = 9 * 60;
      const blocks = data.blocks.map((b) => {
        const left = Math.max(0, ((toMin(b.start) - start) / span) * 100);
        const width = Math.min(100 - left, ((toMin(b.end) - toMin(b.start)) / span) * 100);
        return `<i style="left:${left}%;width:${width}%" title="${esc(b.course)}"></i>`;
      }).join('');
      openModal(`<h3 id="modalTitle">Room ${esc(id)}</h3>
        <p class="sub">${DAY_FULL[data.day]} · green = free, red = class</p>
        <div class="strip">${blocks}</div>
        <div class="strip-scale"><span>8 AM</span><span>10</span><span>12 PM</span><span>2</span><span>4</span><span>5 PM</span></div>
        <div class="block-list">${data.blocks.length ? data.blocks.map((b) => `<div><span>${time12(b.start)} – ${time12(b.end)}</span><b>${esc(b.course)} · ${esc(b.section)}${b.extra ? ' (extra)' : ''}</b></div>`).join('') : '<div><span>No classes. Free all day 🎉</span></div>'}</div>
        <button class="btn btn-primary btn-block" onclick="closeModal()">Done</button>`);
    } catch (e) {
      openModal(errorHTML(e.message));
    }
  }

  return { load, openWith, init };
})();
routeHooks.rooms = () => Rooms.load();
