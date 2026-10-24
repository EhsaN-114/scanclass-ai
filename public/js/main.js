/* Start-up */

async function checkHealth() {
  const box = $('#modelStatus');
  try {
    const h = await api('/api/health');
    box.className = `nav-status ${h.reachable && h.modelFound ? 'ok' : 'bad'}`;
    box.querySelector('.txt').textContent = h.reachable && h.modelFound ? `${h.model} ready` : (h.reachable ? `${h.model} not found` : 'AI model offline');
  } catch (_) {
    box.className = 'nav-status bad';
    box.querySelector('.txt').textContent = 'Server offline';
  }
}

(async function start() {
  setLang(state.lang);
  renderProfileChip();
  try {
    state.meta = await api('/api/meta');
  } catch (e) {
    $('#homeBody').innerHTML = errorHTML(e.message);
    return;
  }
  // If a saved section no longer exists, ask again
  if (state.profile && !isTeacher() && !state.meta.sections.some((s) => s.key === state.profile.section)) {
    state.profile = null;
    store.del('profile');
  }
  route();
  checkHealth();
  if (!state.profile && location.hash !== '#admin') openSetup(true);
  Notices.refresh();
  Notices.startPolling();
})();
