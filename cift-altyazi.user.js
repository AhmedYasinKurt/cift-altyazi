// ==UserScript==
// @name         Çift Altyazı
// @namespace    cift-altyazi
// @version      0.1.0
// @description  YouTube'da İngilizce altyazı + Türkçe çeviri (sürekli ya da TR tuşuyla gerektiğinde)
// @match        *://*.youtube.com/*
// @inject-into  content
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      translate.googleapis.com
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Saf yardımcılar (Node testleri de bunları kullanır)
  // ---------------------------------------------------------------------------

  const SENTENCE_END = /[.?!…。！？]["'”’)\]]*$/;
  const DEFAULT_SETTINGS = Object.freeze({ showOriginal: true, trMode: 'onDemand' });

  /** json3 altyazı metnini satırlara çevirir: [{ start, end, text }] (ms). */
  function parseJson3(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return []; }
    const events = data && Array.isArray(data.events) ? data.events : [];
    const cues = [];
    for (const ev of events) {
      if (!ev || !Array.isArray(ev.segs) || ev.aAppend) continue;
      const t = ev.segs.map((s) => (s && s.utf8) || '').join('').replace(/\s*\n\s*/g, ' ').trim();
      if (!t) continue;
      const start = Number(ev.tStartMs) || 0;
      cues.push({ start, end: start + (Number(ev.dDurationMs) || 0), text: t });
    }
    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  /** start <= t olan son satırın indeksi; yoksa -1. */
  function findLastCueIndex(cues, t) {
    let lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /** O an ekranda olması gereken satır: start <= t < end olanlardan en son başlayan; yoksa -1. */
  function findActiveCueIndex(cues, t) {
    const last = findLastCueIndex(cues, t);
    for (let i = last; i >= 0 && i > last - 6; i--) {
      if (cues[i].end > t) return i;
    }
    return -1;
  }

  /** i. satırın içinde bulunduğu cümlenin satır aralığı [from, to]. */
  function sentenceRange(cues, i, maxBack = 2, maxFwd = 2) {
    let from = i, to = i;
    while (from > 0 && from > i - maxBack && !SENTENCE_END.test(cues[from - 1].text)) from--;
    while (to < cues.length - 1 && to < i + maxFwd && !SENTENCE_END.test(cues[to].text)) to++;
    return [from, to];
  }

  /** Satırları '\n' ile birleşince maxChars'ı aşmayan parçalara böler: [[from, toExclusive], ...]. */
  function chunkLines(lines, maxChars = 4500) {
    const chunks = [];
    let from = 0, len = 0;
    for (let i = 0; i < lines.length; i++) {
      const add = lines[i].length + (i > from ? 1 : 0);
      if (i > from && len + add > maxChars) {
        chunks.push([from, i]);
        from = i;
        len = lines[i].length;
      } else {
        len += add;
      }
    }
    if (lines.length > from) chunks.push([from, lines.length]);
    return chunks;
  }

  /** Google gtx cevabından çevrilmiş metni çıkarır. */
  function parseTranslateResponse(json) {
    if (!Array.isArray(json) || !Array.isArray(json[0])) return '';
    return json[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('');
  }

  /** Çevrilmiş metni satırlara böler; sayı tutmazsa null. */
  function splitTranslated(text, expected) {
    const parts = String(text).split('\n').map((s) => s.trim());
    return parts.length === expected ? parts : null;
  }

  const baseLang = (code) => String(code || '').split('-')[0].toLowerCase();

  /** Çevrilecek kaynak altyazı izini seçer. */
  function chooseSourceTrack(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    const asr = tracks.find((t) => t && t.kind === 'asr');
    const manual = tracks.filter((t) => t && t.kind !== 'asr');
    const pick = (t, kind) => ({ languageCode: t.languageCode, kind });
    if (asr) {
      const spoken = baseLang(asr.languageCode);
      if (spoken === 'tr') return { turkish: true };
      const m = manual.find((t) => baseLang(t.languageCode) === spoken);
      return m ? pick(m, '') : pick(asr, 'asr');
    }
    const en = manual.find((t) => baseLang(t.languageCode) === 'en');
    if (en) return pick(en, '');
    const other = manual.find((t) => baseLang(t.languageCode) !== 'tr');
    if (other) return pick(other, '');
    return { turkish: true };
  }

  /** timedtext adresinden video ve dil bilgisi. */
  function parseTimedtextUrl(url) {
    const q = String(url).split('?')[1] || '';
    const p = new URLSearchParams(q);
    return { videoId: p.get('v') || '', lang: p.get('lang') || '', kind: p.get('kind') || '', tlang: p.get('tlang') || '' };
  }

  function normalizeSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      showOriginal: typeof r.showOriginal === 'boolean' ? r.showOriginal : DEFAULT_SETTINGS.showOriginal,
      trMode: r.trMode === 'always' || r.trMode === 'onDemand' ? r.trMode : DEFAULT_SETTINGS.trMode,
    };
  }

  const CA = {
    parseJson3, findLastCueIndex, findActiveCueIndex, sentenceRange, chunkLines,
    parseTranslateResponse, splitTranslated, chooseSourceTrack, parseTimedtextUrl, normalizeSettings,
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = CA;
    return;
  }

  // ---------------------------------------------------------------------------
  // Sayfa parçası: YouTube sayfasının kendi içinde çalışır (metin olarak eklenir).
  // Oynatıcının altyazı cevabını yakalar ve doğru altyazı izini yükletir.
  // Dışarıdaki hiçbir değişkene dokunmamalı: yalnızca parametrelerini kullanır.
  // ---------------------------------------------------------------------------

  function pagePart(token, chooseSourceTrack, parseTimedtextUrl) {
    const post = (type, data) => window.postMessage(Object.assign({ src: 'cift-altyazi', dir: 'page', token, type }, data), '*');
    if (window.__ciftAltyaziPage) { post('ready', {}); return; }
    window.__ciftAltyaziPage = true;

    const captured = new Map(); // videoId -> Map("lang|kind" -> metin)
    const isTimedtext = (u) => /\/api\/timedtext/.test(String(u || ''));

    function onTimedtext(url, text) {
      const info = parseTimedtextUrl(url);
      if (!info.videoId || info.tlang) return; // çevrilmiş izleri yok say
      if (typeof text !== 'string' || text.trim()[0] !== '{') return; // boş ya da engel sayfası
      if (!captured.has(info.videoId)) captured.set(info.videoId, new Map());
      captured.get(info.videoId).set(info.lang + '|' + info.kind, text);
      post('captions', { videoId: info.videoId, lang: info.lang, kind: info.kind, text });
    }

    const XHR = window.XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;
    XHR.open = function (method, url) {
      try { this.__caUrl = String(url); } catch (e) { /* yok say */ }
      return origOpen.apply(this, arguments);
    };
    XHR.send = function () {
      if (isTimedtext(this.__caUrl)) {
        const xhr = this;
        xhr.addEventListener('load', function () {
          try {
            let text = '';
            if (xhr.responseType === '' || xhr.responseType === 'text') text = xhr.responseText;
            else if (xhr.responseType === 'json') text = JSON.stringify(xhr.response);
            else if (xhr.responseType === 'arraybuffer' && xhr.response) text = new TextDecoder().decode(xhr.response);
            onTimedtext(xhr.responseURL || xhr.__caUrl, text);
          } catch (e) { /* yok say */ }
        });
      }
      return origSend.apply(this, arguments);
    };

    const origFetch = window.fetch;
    window.fetch = function (input) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        if (isTimedtext(url)) {
          p.then((res) => res.clone().text().then((t) => onTimedtext(res.url || url, t))).catch(() => {});
        }
      } catch (e) { /* yok say */ }
      return p;
    };

    // Video değişimini izle, doğru altyazı izini yükle.
    let state = { vid: '', attempts: 0, last: 0, status: '' };
    const report = (status, extra) => {
      if (state.status === status) return;
      state.status = status;
      post('video', Object.assign({ videoId: state.vid, status }, extra || {}));
    };

    function tick() {
      const mp = document.getElementById('movie_player');
      if (!mp || typeof mp.getVideoData !== 'function') return;
      let vid = '';
      try { vid = (mp.getVideoData() || {}).video_id || ''; } catch (e) { return; }
      if (!vid) return;
      if (vid !== state.vid) state = { vid, attempts: 0, last: 0, status: '' };

      let pr = null;
      try { pr = mp.getPlayerResponse && mp.getPlayerResponse(); } catch (e) { /* yok say */ }
      if (!pr || !pr.videoDetails || pr.videoDetails.videoId !== vid) return; // yeni video henüz hazır değil
      const tracks = pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
        pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      const src = chooseSourceTrack(tracks);
      if (!src) return report('none');
      if (src.turkish) return report('turkish');

      const have = captured.get(vid);
      if (have && have.has(src.languageCode + '|' + src.kind)) return report('ok', { lang: src.languageCode, kind: src.kind });

      const now = Date.now();
      if (state.attempts < 3 && now - state.last > 4000) {
        state.attempts++;
        state.last = now;
        report('loading');
        try {
          if (typeof mp.loadModule === 'function') mp.loadModule('captions');
          const track = { languageCode: src.languageCode };
          if (src.kind) track.kind = src.kind;
          mp.setOption('captions', 'track', track);
        } catch (e) { /* bir sonraki denemede */ }
      } else if (state.attempts >= 3 && now - state.last > 6000) {
        report('fail');
      }
    }
    setInterval(tick, 1000);

    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.src !== 'cift-altyazi' || d.dir !== 'content' || d.token !== token) return;
      if (d.type === 'resend') {
        const have = captured.get(state.vid);
        if (have) for (const [key, text] of have) {
          const [lang, kind] = key.split('|');
          post('captions', { videoId: state.vid, lang, kind, text });
        }
        state.status = '';
      } else if (d.type === 'retry') {
        state.attempts = 0;
        state.last = 0;
        state.status = '';
      }
    });

    post('ready', {});
  }

  /** Sayfa parçasını YouTube'un nonce değeri ve Trusted Types ile sayfaya ekler. */
  function injectPagePart(token) {
    const code = '(' + pagePart.toString() + ')(' + JSON.stringify(token) + ', ' +
      '(function(){ const baseLang = ' + baseLang.toString() + '; return ' + chooseSourceTrack.toString() + '; })(), ' +
      parseTimedtextUrl.toString() + ');';
    let policy = null;
    let done = false;

    function tryInject(force) {
      if (done) return true;
      const nonceEl = document.querySelector('script[nonce]');
      const nonce = nonceEl && (nonceEl.nonce || nonceEl.getAttribute('nonce'));
      if (!nonce && !force) return false;
      const s = document.createElement('script');
      if (nonce) s.nonce = nonce;
      let content = code;
      try {
        const tt = window.trustedTypes;
        if (tt && typeof tt.createPolicy === 'function') {
          policy = policy || tt.createPolicy('cift-altyazi', { createScript: (x) => x });
          content = policy.createScript(code);
        }
      } catch (e) { /* Trusted Types yoksa düz metin */ }
      try {
        s.textContent = content;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      } catch (e) { return false; }
      done = true;
      return true;
    }

    if (tryInject(false)) return;
    const mo = new MutationObserver(() => { if (tryInject(false)) mo.disconnect(); });
    mo.observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => { mo.disconnect(); tryInject(true); }, { once: true });
  }

  /** Son çare (Firefox): sayfanın kendi eval'i ile ekle. */
  function injectViaEval(token) {
    try {
      const w = window.wrappedJSObject;
      if (!w || typeof w.eval !== 'function') return false;
      const code = '(' + pagePart.toString() + ')(' + JSON.stringify(token) + ', ' +
        '(function(){ const baseLang = ' + baseLang.toString() + '; return ' + chooseSourceTrack.toString() + '; })(), ' +
        parseTimedtextUrl.toString() + ');';
      w.eval(code);
      return true;
    } catch (e) { return false; }
  }

  main();

  function main() {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const bridge = { ready: false, onCaptions: null, onVideo: null };
    const debug = (window.__ciftAltyaziDebug = { events: [] });

    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.src !== 'cift-altyazi' || d.dir !== 'page' || d.token !== token) return;
      debug.events.push({ type: d.type, videoId: d.videoId, lang: d.lang, kind: d.kind, status: d.status, len: d.text ? d.text.length : 0 });
      if (d.type === 'ready') {
        bridge.ready = true;
        sendToPage('resend');
      } else if (d.type === 'captions' && bridge.onCaptions) bridge.onCaptions(d);
      else if (d.type === 'video' && bridge.onVideo) bridge.onVideo(d);
    });

    function sendToPage(type) {
      window.postMessage({ src: 'cift-altyazi', dir: 'content', token, type }, '*');
    }

    injectPagePart(token);
    setTimeout(() => {
      if (!bridge.ready && injectViaEval(token)) debug.events.push({ type: 'eval-fallback' });
    }, 6000);

    window.__ciftAltyaziBridge = bridge;
    bridge.send = sendToPage;
  }
})();
