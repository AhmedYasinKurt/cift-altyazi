// ==UserScript==
// @name         Çift Altyazı
// @namespace    cift-altyazi
// @version      0.3.0
// @description  YouTube'da İngilizce altyazı + Türkçe çeviri (sürekli ya da TR tuşuyla gerektiğinde)
// @match        *://*.youtube.com/*
// @inject-into  content
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      translate.googleapis.com
// @homepageURL  https://github.com/AhmedYasinKurt/cift-altyazi
// @supportURL   https://github.com/AhmedYasinKurt/cift-altyazi/issues
// @downloadURL  https://raw.githubusercontent.com/AhmedYasinKurt/cift-altyazi/main/cift-altyazi.user.js
// @updateURL    https://raw.githubusercontent.com/AhmedYasinKurt/cift-altyazi/main/cift-altyazi.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Saf yardımcılar (Node testleri de bunları kullanır)
  // ---------------------------------------------------------------------------

  const SENTENCE_END = /[.?!…。！？]["'”’)\]]*$/;
  const DEFAULT_SETTINGS = Object.freeze({ showOriginal: true, trMode: 'onDemand', sizePct: 100, bgPct: 80 });
  // Sayısal ayarların sınırları: altyazı boyutu (%) ve arka plan kutusu koyuluğu (%).
  const RANGES = Object.freeze({
    sizePct: { min: 60, max: 200, step: 10 },
    bgPct: { min: 0, max: 100, step: 10 },
  });
  const VERSION = '0.3.0'; // @version ile aynı tutun

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

  /**
   * Altyazı parçalarını tam cümlelere birleştirir (sürekli modda kullanılır).
   * Bir parçada cümle bitip yenisi başlıyorsa parça bölünür; zaman, parçanın içindeki
   * harf konumuna göre orantılanır. Noktalama yoksa maxChars'ta ya da 4 sn'den uzun
   * sessizlikte kesilir. "(Laughter)" gibi parantezli satırlar tek başına kalır.
   * Dönen dizi Cue biçimindedir: [{ start, end, text }], sıralı ve üst üste binmez.
   */
  function buildSentences(cues, maxChars = 220) {
    const GAP = 4000, LINGER = 1500;
    const BOUNDARY = /[.?!…。！？]+["'”’)\]]*(?=\s|$)/g;
    const out = [];
    let acc = null; // { start, end, text }
    const flush = () => {
      if (acc && acc.text.trim()) out.push({ start: acc.start, end: acc.end, text: acc.text.trim() });
      acc = null;
    };
    for (let k = 0; k < cues.length; k++) {
      const c = cues[k];
      const next = cues[k + 1];
      // Otomatik altyazıda parçalar zamanca üst üste biner: bir sonraki başlayınca bu bitmiş say.
      const effEnd = next && next.start > c.start && next.start < c.end ? next.start : c.end;
      const dur = Math.max(1, effEnd - c.start);
      const len = Math.max(1, c.text.length);
      const at = (idx) => Math.round(c.start + (idx / len) * dur);
      if (acc && c.start - acc.end > GAP) flush();
      if (/^[\[(].*[\])]$/.test(c.text.trim())) { // (Laughter), [Music] …
        flush();
        out.push({ start: c.start, end: effEnd, text: c.text.trim() });
        continue;
      }
      // Parçayı cümle sonlarından böl.
      const pieces = [];
      let from = 0, m;
      BOUNDARY.lastIndex = 0;
      while ((m = BOUNDARY.exec(c.text)) !== null) {
        const to = m.index + m[0].length;
        pieces.push({ from, to, ends: true });
        from = to;
      }
      if (from < c.text.length) pieces.push({ from, to: c.text.length, ends: false });
      for (const pc of pieces) {
        const raw = c.text.slice(pc.from, pc.to);
        const text = raw.trim();
        if (!text) continue;
        const lead = raw.length - raw.trimStart().length;
        const start = at(pc.from + lead);
        const end = at(pc.to);
        if (!acc) acc = { start, end, text };
        else { acc.text += ' ' + text; acc.end = end; }
        if (pc.ends || acc.text.length >= maxChars) flush();
      }
    }
    flush();
    // Okumaya zaman tanı: bitişten sonra en çok LINGER kadar kal, ama sonrakine binme.
    for (let i = 0; i < out.length; i++) {
      const nextStart = i + 1 < out.length ? out[i + 1].start : Infinity;
      out[i].end = Math.min(nextStart, Math.max(out[i].end, out[i].start + 1) + LINGER);
      if (out[i].end <= out[i].start) out[i].end = out[i].start + 1;
    }
    return out;
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
      sizePct: clampStep('sizePct', r.sizePct),
      bgPct: clampStep('bgPct', r.bgPct),
    };
  }

  /** Sayıyı sınırlar içine alır ve adıma yuvarlar; sayı değilse varsayılan. */
  function clampStep(key, value) {
    const { min, max, step } = RANGES[key];
    if (typeof value !== 'number' || !isFinite(value)) return DEFAULT_SETTINGS[key];
    const v = Math.round(value / step) * step;
    return Math.min(max, Math.max(min, v));
  }

  /** −/+ düğmesi: bir adım azalt/artır (sınırda durur). */
  function stepSetting(key, value, dir) {
    return clampStep(key, value + dir * RANGES[key].step);
  }

  const CA = {
    parseJson3, findLastCueIndex, findActiveCueIndex, sentenceRange, chunkLines,
    parseTranslateResponse, splitTranslated, chooseSourceTrack, parseTimedtextUrl, normalizeSettings,
    stepSetting, buildSentences,
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
      post('seen', { videoId: info.videoId, lang: info.lang, kind: info.kind, status: (info.tlang ? 'tlang ' : '') + 'len=' + (text ? text.length : 0) });
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
      // Birkaç denemeden sonra aynı dilde başka bir iz (ör. otomatik) yakalandıysa onu kullan.
      if (have && state.attempts >= 2) {
        const base = src.languageCode.split('-')[0];
        for (const key of have.keys()) {
          const [l, k] = key.split('|');
          if (l.split('-')[0] === base) return report('ok', { lang: l, kind: k });
        }
      }

      // Video hiç oynatılmadıysa oynatıcı altyazıyı indirmez; deneme harcama, bekle.
      const v = mp.querySelector('video');
      if (!v || (v.paused && v.currentTime === 0)) return;

      const now = Date.now();
      if (state.attempts >= 3 && now - state.last > 20000) state.attempts = 1; // vazgeçme: yavaşça yeniden dene
      if (state.attempts < 3 && now - state.last > 3000) {
        state.attempts++;
        state.last = now;
        report('loading');
        // Oynatıcının kendi iz listesindeki tam nesneyi ver; yalnız dil kodu verilirse
        // masaüstü oynatıcı otomatik (ASR) izi seçebiliyor.
        const setTrack = () => {
          let list = [];
          try { list = mp.getOption('captions', 'tracklist') || []; } catch (e) { /* yok say */ }
          const exact = list.find((t) => t && t.languageCode === src.languageCode && (t.kind || '') === src.kind);
          const track = exact || (src.kind ? { languageCode: src.languageCode, kind: src.kind } : { languageCode: src.languageCode });
          mp.setOption('captions', 'track', track);
        };
        // İki yöntemi sırayla dene: mobil oynatıcı basit iz seçimiyle, masaüstü oynatıcı
        // (iz zaten seçiliyse) ancak altyazı modülü kapatılıp açılınca yeniden indiriyor.
        try {
          if (state.attempts % 2 === 0 && typeof mp.unloadModule === 'function') {
            mp.unloadModule('captions');
            mp.loadModule('captions');
            setTimeout(() => { try { setTrack(); } catch (e) { /* yok say */ } }, 1500);
          } else {
            if (typeof mp.loadModule === 'function') mp.loadModule('captions');
            setTrack();
          }
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

  function main() {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const debug = (window.__ciftAltyaziDebug = { events: [] });

    // --- Ayarlar -------------------------------------------------------------
    let settings = normalizeSettings(GM_getValue('settings'));
    function saveSettings(patch) {
      settings = normalizeSettings(Object.assign({}, settings, patch));
      GM_setValue('settings', settings);
      if (settings.trMode === 'always') startFullTranslation();
      if (settings.trMode !== 'onDemand') closeOnDemand(false);
      render(true);
      updatePanel();
    }

    // --- Durum ---------------------------------------------------------------
    const captionStore = new Map(); // videoId -> Map("lang|kind" -> metin)
    // cues: YouTube'un altyazı parçaları; sents: sürekli mod için tam cümleler; tr: sents'in Türkçesi
    let cur = { videoId: '', lang: '', cues: [], sents: [], tr: null, status: '', job: 0 };
    let od = { open: false, en: '', tr: '', range: null, session: 0 }; // gerektiğinde göster
    let bridgeReady = false;

    // --- Sayfa parçası ile haberleşme ----------------------------------------
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.src !== 'cift-altyazi' || d.dir !== 'page' || d.token !== token) return;
      debug.events.push({ type: d.type, videoId: d.videoId, lang: d.lang, kind: d.kind, status: d.status, len: d.text ? d.text.length : 0 });
      if (d.type === 'ready') {
        bridgeReady = true;
        sendToPage('resend');
      } else if (d.type === 'captions') {
        if (!captionStore.has(d.videoId)) captionStore.set(d.videoId, new Map());
        captionStore.get(d.videoId).set(d.lang + '|' + d.kind, d.text);
      } else if (d.type === 'video') {
        onVideoStatus(d);
      }
    });
    function sendToPage(type) {
      window.postMessage({ src: 'cift-altyazi', dir: 'content', token, type }, '*');
    }

    function onVideoStatus(d) {
      if (d.videoId !== cur.videoId) {
        cur = { videoId: d.videoId, lang: '', cues: [], sents: [], tr: null, status: '', job: cur.job + 1 };
        closeOnDemand(false);
      }
      cur.status = d.status;
      if (d.status === 'ok') {
        const text = captionStore.has(d.videoId) && captionStore.get(d.videoId).get(d.lang + '|' + d.kind);
        const cues = text ? parseJson3(text) : [];
        if (cues.length) {
          cur.cues = cues;
          cur.sents = buildSentences(cues);
          cur.lang = d.lang;
          cur.tr = loadCachedTranslation(trKey()) || null;
          if (settings.trMode === 'always') startFullTranslation();
        } else {
          sendToPage('retry');
        }
      } else if (d.status === 'none') {
        showNote('Bu videoda altyazı yok.');
      } else if (d.status === 'turkish') {
        showNote('Bu video Türkçe, çeviriye gerek yok.');
      } else if (d.status === 'fail' && !cur.failNoted) {
        cur.failNoted = true; // her videoda bir kez söyle; arka planda denemeye devam ediliyor
        showNote('Altyazı yüklenemedi, tekrar deneniyor. Olmazsa videodaki CC düğmesine bir kez basın.');
      }
      render(true);
    }

    // --- Çeviri ----------------------------------------------------------------
    const TR_URL = 'https://translate.googleapis.com/translate_a/single?client=gtx&tl=tr&dt=t&sl=';
    const textCache = new Map();

    function gtx(text, sl) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST',
          url: TR_URL + encodeURIComponent(sl || 'auto'),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          data: 'q=' + encodeURIComponent(text),
          timeout: 15000,
          onload: (r) => {
            if (r.status !== 200) return reject(new Error('HTTP ' + r.status));
            try { resolve(parseTranslateResponse(JSON.parse(r.responseText))); } catch (e) { reject(e); }
          },
          onerror: () => reject(new Error('ağ hatası')),
          ontimeout: () => reject(new Error('zaman aşımı')),
        });
      });
    }

    async function translateText(text) {
      if (textCache.has(text)) return textCache.get(text);
      const out = (await gtx(text, baseLang(cur.lang))).replace(/\s*\n\s*/g, ' ').trim();
      textCache.set(text, out);
      return out;
    }

    const trKey = () => 'trs:' + cur.videoId + ':' + cur.lang;
    function loadCachedTranslation(key) {
      const v = GM_getValue(key);
      return Array.isArray(v) && v.length === cur.sents.length ? v : null;
    }
    function saveCachedTranslation(key, arr) {
      GM_setValue(key, arr);
      const index = (GM_getValue('trIndex') || []).filter((k) => k !== key);
      index.push(key);
      while (index.length > 20) GM_deleteValue(index.shift());
      GM_setValue('trIndex', index);
    }

    async function translateRange(lines, from, to, sl) {
      const text = lines.slice(from, to).join('\n');
      const res = await gtx(text, sl);
      const parts = splitTranslated(res, to - from);
      if (parts) return parts;
      if (to - from === 1) return [res.replace(/\s*\n\s*/g, ' ').trim()];
      const mid = from + ((to - from) >> 1);
      return (await translateRange(lines, from, mid, sl)).concat(await translateRange(lines, mid, to, sl));
    }

    async function startFullTranslation() {
      if (!cur.sents.length || cur.translating === cur.job) return;
      if (cur.tr && cur.tr.every((x) => typeof x === 'string')) return;
      const job = cur.job;
      cur.translating = job;
      const lines = cur.sents.map((c) => c.text);
      const tr = cur.tr && cur.tr.length === lines.length ? cur.tr.slice() : new Array(lines.length).fill(null);
      const chunks = chunkLines(lines);
      const v = getVideo();
      const nowIdx = v ? Math.max(0, findLastCueIndex(cur.sents, v.currentTime * 1000)) : 0;
      let first = chunks.findIndex(([f, t]) => nowIdx >= f && nowIdx < t);
      if (first < 0) first = 0;
      const order = chunks.slice(first).concat(chunks.slice(0, first));
      try {
        for (const [f, t] of order) {
          if (cur.job !== job) return;
          if (tr.slice(f, t).every((x) => typeof x === 'string')) continue;
          const parts = await translateRange(lines, f, t, baseLang(cur.lang));
          if (cur.job !== job) return;
          for (let i = 0; i < parts.length; i++) tr[f + i] = parts[i];
          cur.tr = tr.slice();
          render(true);
          await new Promise((r) => setTimeout(r, 300));
        }
        saveCachedTranslation(trKey(), tr);
      } catch (e) {
        showNote('Çeviri şu an alınamadı, biraz sonra tekrar deneyin.');
      } finally {
        if (cur.translating === job) cur.translating = 0;
      }
    }

    // --- Gerektiğinde göster (TR tuşu) ---------------------------------------
    function openOnDemand() {
      const v = getVideo();
      if (!v || !cur.cues.length) return showNote('Henüz altyazı yüklenmedi.');
      const t = v.currentTime * 1000;
      let i = findActiveCueIndex(cur.cues, t);
      if (i < 0) i = findLastCueIndex(cur.cues, t);
      if (i < 0) return showNote('Henüz konuşma başlamadı.');
      const range = sentenceRange(cur.cues, i);
      const en = cur.cues.slice(range[0], range[1] + 1).map((c) => c.text).join(' ');
      const session = ++od.session;
      od = { open: true, en, tr: 'Çevriliyor…', range, session };
      v.pause();
      render(true);
      translateText(en).then((tr) => {
        if (od.open && od.session === session) { od.tr = tr; render(true); }
      }).catch(() => {
        const j = findLastCueIndex(cur.sents, cur.cues[i].start);
        const cached = cur.tr && j >= 0 && cur.tr[j];
        if (od.open && od.session === session) {
          od.tr = typeof cached === 'string' ? cached : 'Çeviri şu an alınamadı.';
          render(true);
        }
      });
    }
    function closeOnDemand(play) {
      if (!od.open) return;
      od = { open: false, en: '', tr: '', range: null, session: od.session };
      render(true);
      const v = getVideo();
      if (play && v) v.play().catch(() => {});
    }

    // --- Ekran -----------------------------------------------------------------
    GM_addStyle(CSS_TEXT);
    let ui = null;
    let noteTimer = 0;
    let pendingNote = '';

    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function shield(node) {
      ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick']
        .forEach((t) => node.addEventListener(t, (e) => e.stopPropagation()));
      return node;
    }
    function onTap(node, fn) {
      node.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
      return node;
    }

    function buildUi() {
      const root = el('div'); root.id = 'ca-root';
      const box = el('div'); box.id = 'ca-box';
      const lineEn = el('div', 'ca-line ca-en');
      const lineTr = el('div', 'ca-line ca-tr');
      box.append(lineEn, lineTr);

      const ctrl = shield(el('div')); ctrl.id = 'ca-ctrl';
      const trBtn = onTap(el('button', 'ca-btn', 'TR'), () => (od.open ? closeOnDemand(true) : openOnDemand()));
      trBtn.title = 'Türkçesini göster';
      trBtn.setAttribute('aria-label', 'Türkçesini göster');
      const gearBtn = onTap(el('button', 'ca-btn ca-gear', '⚙'), togglePanel);
      gearBtn.title = 'Çift Altyazı ayarları';
      gearBtn.setAttribute('aria-label', 'Çift Altyazı ayarları');
      ctrl.append(trBtn, gearBtn);

      const panel = shield(el('div')); panel.id = 'ca-panel'; panel.hidden = true;
      const head = el('div', 'ca-head');
      const close = onTap(el('button', 'ca-close', '✕'), togglePanel);
      close.title = 'Kapat';
      close.setAttribute('aria-label', 'Kapat');
      head.append(el('h3', '', 'Çift Altyazı ayarları'), close);
      panel.append(head);
      const mkStepper = (label, key) => {
        const row = el('div', 'ca-row');
        row.append(el('div', 'ca-row-label', label));
        const seg = el('div', 'ca-seg ca-step');
        const minus = onTap(el('button', 'ca-opt ca-minus', '−'), () => saveSettings({ [key]: stepSetting(key, settings[key], -1) }));
        const val = el('span', 'ca-val');
        const plus = onTap(el('button', 'ca-opt ca-plus', '+'), () => saveSettings({ [key]: stepSetting(key, settings[key], +1) }));
        minus.dataset.key = key; plus.dataset.key = key; val.dataset.key = key;
        seg.append(minus, val, plus);
        row.append(seg);
        panel.append(row);
        return () => {
          val.textContent = '%' + settings[key];
          minus.disabled = settings[key] <= RANGES[key].min;
          plus.disabled = settings[key] >= RANGES[key].max;
        };
      };
      const mkRow = (label, options, getVal, setVal) => {
        const row = el('div', 'ca-row');
        row.append(el('div', 'ca-row-label', label));
        const seg = el('div', 'ca-seg');
        const btns = options.map(([val, text]) => {
          const b = onTap(el('button', 'ca-opt', text), () => setVal(val));
          b.dataset.val = String(val);
          seg.append(b);
          return b;
        });
        row.append(seg);
        panel.append(row);
        return () => btns.forEach((b) => b.classList.toggle('ca-sel', b.dataset.val === String(getVal())));
      };
      const upd1 = mkRow('İngilizce (orijinal) altyazı', [[true, 'Açık'], [false, 'Kapalı']],
        () => settings.showOriginal, (v) => saveSettings({ showOriginal: v }));
      const upd2 = mkRow('Türkçe çeviri', [['always', 'Sürekli göster'], ['onDemand', 'Gerektiğinde göster']],
        () => settings.trMode, (v) => saveSettings({ trMode: v }));
      const upd3 = mkStepper('Altyazı boyutu', 'sizePct');
      const upd4 = mkStepper('Arka plan koyuluğu', 'bgPct');
      const diag = el('div', 'ca-diag');
      panel.append(diag);

      const note = el('div'); note.id = 'ca-note'; note.hidden = true;
      root.append(box, ctrl, panel, note);
      return { root, box, lineEn, lineTr, ctrl, trBtn, gearBtn, panel, note, diag, updRows: () => { upd1(); upd2(); upd3(); upd4(); } };
    }

    /** Sorun giderme için kısa durum satırı (ayarlar panelinin altında). */
    function diagText() {
      const parts = [];
      parts.push('Bağlantı: ' + (bridgeReady ? 'tamam' : 'YOK'));
      const statusTr = { ok: 'yüklendi', loading: 'yükleniyor', fail: 'yüklenemedi', none: 'videoda yok', turkish: 'video Türkçe' };
      parts.push('Altyazı: ' + (cur.cues.length ? cur.cues.length + ' satır (' + cur.lang + ')' : (statusTr[cur.status] || 'bekleniyor')));
      if (settings.trMode === 'always' && cur.sents.length) {
        const done = cur.tr ? cur.tr.filter((x) => typeof x === 'string').length : 0;
        parts.push('Çeviri: ' + done + '/' + cur.sents.length + ' cümle');
      }
      const seen = debug.events.filter((e) => e.type === 'seen').length;
      parts.push('İstek: ' + seen);
      parts.push('Sürüm: ' + VERSION);
      return parts.join(' · ');
    }

    function togglePanel() {
      ensureUi();
      if (!ui) return;
      ui.panel.hidden = !ui.panel.hidden;
      updatePanel();
    }
    function updatePanel() {
      if (!ui) return;
      ui.updRows();
      ui.diag.textContent = diagText();
    }

    function showNote(text) {
      // Oynatıcı henüz yoksa notu sakla; ensureUi oynatıcı gelince gösterir.
      // (Not: pendingNote'u ensureUi'den ÖNCE ayarlamak sonsuz döngüye yol açıyordu.)
      if (!ensureUi()) { pendingNote = text; return; }
      ui.note.textContent = text;
      ui.note.hidden = false;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { if (ui) ui.note.hidden = true; }, 6000);
    }

    const getPlayer = () => document.getElementById('movie_player');
    const getVideo = () => {
      const mp = getPlayer();
      return (mp && mp.querySelector('video')) || document.querySelector('video');
    };
    const isWatchPage = () => /\/watch/.test(location.pathname);

    function ensureUi() {
      const mp = getPlayer();
      if (!mp || !isWatchPage()) {
        if (ui && ui.root.isConnected) ui.root.remove();
        return false;
      }
      if (!ui) ui = buildUi();
      // Mobil YouTube'da dokunma kontrolleri #movie_player'ın dışında ve üstünde durur;
      // tuşlarımız dokunulabilir olsun diye ortak üst kaba ekle.
      const pc = mp.closest('#player-container-id');
      const host = pc || mp;
      if (ui.root.parentNode !== host) host.appendChild(ui.root);
      if (pendingNote) { const n = pendingNote; pendingNote = ''; showNote(n); }
      return true;
    }

    let lastSig = '';
    function render(force) {
      if (!ensureUi()) { document.documentElement.classList.remove('ca-active'); return; }
      const mp = getPlayer();
      const v = getVideo();
      const hasCues = cur.cues.length > 0 && cur.videoId && location.href.includes(cur.videoId);
      document.documentElement.classList.toggle('ca-active', !!hasCues);

      let en = '', tr = '';
      if (hasCues && od.open) {
        en = settings.showOriginal ? od.en : '';
        tr = od.tr;
      } else if (hasCues && v) {
        const t = v.currentTime * 1000;
        if (settings.trMode === 'always') {
          // Sürekli mod: iki satır da tam cümle
          const i = findActiveCueIndex(cur.sents, t);
          if (i >= 0) {
            if (settings.showOriginal) en = cur.sents[i].text;
            if (cur.tr && typeof cur.tr[i] === 'string') tr = cur.tr[i];
          }
        } else {
          const i = findActiveCueIndex(cur.cues, t);
          if (i >= 0 && settings.showOriginal) en = cur.cues[i].text;
        }
      }
      // Ayarlar açıkken ve o an konuşma yoksa örnek satır göster: boyut/koyuluk hemen görülsün.
      const panelOpen = !ui.panel.hidden;
      if (panelOpen && !en && !tr) {
        if (settings.showOriginal) en = 'This is how the subtitles will look.';
        tr = 'Altyazılar böyle görünecek.';
      }
      const base = Math.max(14, Math.min(34, (mp.clientHeight || 400) * 0.045));
      const fs = Math.max(10, Math.round(base * settings.sizePct / 100));
      const sig = [en, tr, fs, settings.bgPct, settings.trMode, hasCues, od.open, panelOpen].join('\u0001');
      if (!force && sig === lastSig) return;
      lastSig = sig;
      ui.box.style.fontSize = fs + 'px';
      const bg = 'rgba(8,8,8,' + (settings.bgPct / 100) + ')';
      // Kutu çok saydamsa yazıya gölge ekle ki video üstünde okunabilsin.
      const shadow = settings.bgPct < 40 ? '0 0 3px #000, 0 0 2px #000, 1px 1px 2px #000' : 'none';
      for (const line of [ui.lineEn, ui.lineTr]) {
        line.style.background = bg;
        line.style.textShadow = shadow;
      }
      ui.lineEn.textContent = en;
      ui.lineEn.hidden = !en;
      ui.lineTr.textContent = tr;
      ui.lineTr.hidden = !tr;
      ui.trBtn.hidden = !(hasCues && settings.trMode === 'onDemand');
      ui.trBtn.classList.toggle('ca-on', od.open);
    }

    // Video başka yoldan oynatılır ya da sarılırsa Türkçe paneli kapat.
    document.addEventListener('play', (e) => { if (od.open && e.target === getVideo()) closeOnDemand(false); }, true);
    document.addEventListener('seeking', (e) => { if (od.open && e.target === getVideo()) closeOnDemand(false); }, true);

    setInterval(() => {
      render(false);
      if (ui && !ui.panel.hidden) ui.diag.textContent = diagText();
    }, 150);

    GM_registerMenuCommand('Çift Altyazı ayarları', () => { ensureUi(); if (ui && ui.panel.hidden) togglePanel(); });

    injectPagePart(token);
    setTimeout(() => {
      if (!bridgeReady && injectViaEval(token)) debug.events.push({ type: 'eval-fallback' });
    }, 6000);
    setTimeout(() => {
      if (!bridgeReady && isWatchPage()) showNote('Çift Altyazı YouTube sayfasına bağlanamadı. Sayfayı yenileyin.');
    }, 12000);
  }

  const CSS_TEXT = `
#ca-root{position:absolute;inset:0;pointer-events:none;z-index:60;font-family:Roboto,Arial,sans-serif}
#ca-box{position:absolute;left:50%;bottom:16%;transform:translateX(-50%);width:max-content;max-width:86%;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.ca-line{background:rgba(8,8,8,.78);color:#fff;padding:2px 10px;border-radius:6px;line-height:1.35;white-space:pre-wrap}
.ca-line[hidden]{display:none}
.ca-tr{color:#ffd54a}
#ca-ctrl{position:absolute;right:10px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:12px;pointer-events:auto}
.ca-btn{width:48px;height:48px;border-radius:50%;border:2px solid rgba(255,255,255,.85);background:rgba(0,0,0,.55);color:#fff;font:700 16px/1 Roboto,Arial,sans-serif;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;margin:0;opacity:.8;-webkit-tap-highlight-color:transparent}
.ca-btn[hidden]{display:none}
.ca-btn.ca-gear{font-size:22px}
.ca-btn.ca-on{background:#ffd54a;color:#111;border-color:#ffd54a;opacity:1}
#ca-panel{position:absolute;left:50%;top:8px;transform:translateX(-50%);background:rgba(20,20,20,.96);color:#fff;border-radius:12px;padding:8px 12px;pointer-events:auto;width:min(560px,94%);max-height:calc(64% - 8px);overflow-y:auto;box-sizing:border-box;font-size:14px;box-shadow:0 4px 24px rgba(0,0,0,.5);z-index:2}
#ca-panel[hidden]{display:none}
.ca-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
#ca-panel h3{margin:0;font-size:16px;font-weight:700}
.ca-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:5px 0}
.ca-row-label{color:#ddd;flex:1 1 120px;min-width:0}
.ca-seg{display:flex;gap:8px;flex:0 1 auto}
.ca-opt{min-height:38px;padding:4px 12px;border-radius:8px;border:1px solid #666;background:#333;color:#fff;font-size:14px;cursor:pointer}
.ca-opt.ca-sel{background:#ffd54a;color:#111;border-color:#ffd54a;font-weight:700}
.ca-opt:disabled{opacity:.35;cursor:default}
.ca-step .ca-opt{width:42px;padding:0;font-size:22px;font-weight:700}
.ca-val{min-width:52px;display:flex;align-items:center;justify-content:center;font-weight:700}
.ca-close{width:36px;height:36px;flex:0 0 auto;border-radius:50%;border:0;background:#555;color:#fff;font-size:18px;cursor:pointer;padding:0}
.ca-diag{margin-top:4px;font-size:11px;color:#aaa;line-height:1.4}
#ca-note{position:absolute;left:10px;top:10px;max-width:70%;background:rgba(0,0,0,.8);color:#fff;padding:6px 10px;border-radius:6px;font-size:14px;line-height:1.4}
#ca-note[hidden]{display:none}
html.ca-active .ytp-caption-window-container,html.ca-active #ytp-caption-window-container{display:none!important}
`;
  main();
})();
