/* Voice: speech-to-text and read-aloud using the browser's built-in Web Speech API (free, no server). */

const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canSpeak = 'speechSynthesis' in window;
  let warnedBn = false;

  function listen({ lang, onText, onEnd }) {
    if (!SR) return null;
    const rec = new SR();
    rec.lang = lang === 'bn' ? 'bn-BD' : 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = [...e.results].map((r) => r[0].transcript).join(' ');
      onText(text, e.results[e.results.length - 1].isFinal);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') toast('Microphone permission was blocked.');
      else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Voice input stopped. Try again or type.');
    };
    rec.onend = () => onEnd && onEnd();
    rec.start();
    return rec;
  }

  function speak(text, lang) {
    if (!canSpeak) return toast('Read-aloud is not supported in this browser.');
    speechSynthesis.cancel();
    const clean = String(text).replace(/[🟢🟡🔴📢•🎉]/gu, '').replace(/\n+/g, '. ');
    const u = new SpeechSynthesisUtterance(clean);
    const voices = speechSynthesis.getVoices();
    if (lang === 'bn') {
      const v = voices.find((x) => /^bn/i.test(x.lang));
      if (v) u.voice = v;
      else if (!warnedBn) { warnedBn = true; toast('Bangla voice may not be installed on this device. Chrome on Android works best.'); }
      u.lang = 'bn-BD';
    } else {
      const v = voices.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.lang = 'en-US';
    }
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  if (canSpeak) speechSynthesis.getVoices(); // warm up voice list
  return { supported: !!SR, canSpeak, listen, speak };
})();
