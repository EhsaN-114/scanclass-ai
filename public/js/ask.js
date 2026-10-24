/* Ask: Gemma understands the question (Bangla/English/voice), the server answers from real data */

const Ask = (() => {
  let busy = false;
  let rec = null;
  const CHIPS = {
    en: ['Which rooms are free now?', 'Is C-302 free now?', 'Where is my next class?', 'CSE-1121 mid syllabus?', "What are my classes tomorrow?", 'Free room on floor 4 at 2 PM?', 'Any new notices?'],
    bn: ['এখন কোন রুম খালি?', 'Cx-304 কি এখন খালি?', 'আমার পরের ক্লাস কোথায়?', 'CSE-1121 মিডের সিলেবাস কী?', 'আগামীকাল আমার কী ক্লাস?', '৪ তলায় দুপুর ২টায় খালি রুম?', 'নতুন কোনো নোটিশ আছে?'],
  };

  const TEACHER_CHIPS = {
    en: ['Where is my next class?', 'What are my classes today?', 'My classes tomorrow?', 'Which rooms are free now?', 'Is C-302 free at 2 PM?'],
    bn: ['আমার পরের ক্লাস কোথায়?', 'আজ আমার কী ক্লাস?', 'আগামীকাল আমার কী ক্লাস?', 'এখন কোন রুম খালি?', 'C-302 কি দুপুর ২টায় খালি?'],
  };
  function drawChips() {
    $('#chips').innerHTML = (isTeacher() ? TEACHER_CHIPS : CHIPS)[state.lang].map((q) => `<button class="chip" type="button">${esc(q)}</button>`).join('');
  }
  $('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) send(c.textContent); });
  $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); send($('#chatQ').value); });

  function addMsg(kind, html) {
    const thread = $('#chatThread');
    $('.chat-welcome', thread)?.remove();
    const div = document.createElement('div');
    div.className = `msg ${kind}`;
    div.innerHTML = `<span class="avatar"><svg><use href="#i-spark"/></svg></span><div class="bubble">${html}</div>`;
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;
    return div;
  }

  async function send(q) {
    q = q.trim();
    if (!q || busy) return;
    if (!state.profile) return openSetup(true);
    $('#chatQ').value = '';
    addMsg('user', esc(q));
    const pending = addMsg('ai', '<span class="typing"><i></i><i></i><i></i></span>');
    busy = true;
    try {
      const data = await api('/api/ask', { method: 'POST', json: { question: q, section: state.profile.section, teacher: isTeacher() ? teacherSpec() : undefined, now: nowCtx() } });
      const bubble = $('.bubble', pending);
      bubble.className = `bubble ${data.lang === 'bn' ? 'bn' : ''}`;
      bubble.innerHTML = `${esc(data.text)}<div class="bubble-tools">
        <button type="button" data-act="speak"><svg><use href="#i-speaker"/></svg> Listen</button>
        ${data.link && data.link.view === 'rooms' ? '<button type="button" data-act="rooms"><svg><use href="#i-door"/></svg> Open Free Rooms</button>' : ''}
        <small>Understood by ${esc(data.model)} · answered from the routine</small></div>`;
      $('[data-act=speak]', bubble).addEventListener('click', () => Voice.speak(data.text, data.lang));
      const r = $('[data-act=rooms]', bubble);
      if (r) r.addEventListener('click', () => Rooms.openWith(data.link));
    } catch (e) {
      pending.classList.add('error');
      $('.bubble', pending).textContent = e.message;
    } finally {
      busy = false;
      $('#chatThread').scrollTop = $('#chatThread').scrollHeight;
    }
  }

  // Voice input
  if (Voice.supported) {
    const mic = $('#micBtn');
    mic.hidden = false;
    mic.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      mic.classList.add('listening');
      $('#chatQ').placeholder = state.lang === 'bn' ? 'শুনছি… বলুন' : 'Listening… speak now';
      rec = Voice.listen({
        lang: state.lang,
        onText: (text, final) => {
          $('#chatQ').value = text;
          if (final) { rec && rec.stop(); send(text); }
        },
        onEnd: () => {
          rec = null;
          mic.classList.remove('listening');
          $('#chatQ').placeholder = 'e.g. এখন কোন রুম খালি?';
        },
      });
    });
  }

  langHooks.push(drawChips);
  return { drawChips };
})();
routeHooks.ask = () => Ask.drawChips();
