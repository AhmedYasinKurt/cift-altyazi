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
})();
