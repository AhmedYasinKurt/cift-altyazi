# Çift Altyazı Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firefox Android + Violentmonkey için, YouTube'da İngilizce altyazı aç/kapa ve Türkçe çeviri (sürekli / TR tuşuyla gerektiğinde) gösteren tek dosyalık userscript.

**Architecture:** `cift-altyazi.user.js` içerik alanında çalışır; sayfaya nonce + Trusted Types ile `pagePart` ekler. `pagePart` oynatıcının `/api/timedtext` XHR cevabını yakalar, `postMessage` ile yollar. Betik ayrıştırır, çevirir (Google gtx, `GM_xmlhttpRequest`), `#movie_player` içinde çizer.

**Tech Stack:** Düz JavaScript (derleme yok), Violentmonkey GM API, `node --test`, Playwright MCP (Chromium, tablet UA).

**Spec:** `docs/superpowers/specs/2026-11-23-cift-altyazi-design.md`

## Global Constraints
- Ücretsiz; API anahtarı yok. Çeviri yalnız `https://translate.googleapis.com/translate_a/single?client=gtx&sl=<src>&tl=tr&dt=t` (POST, `q=`).
- `tlang` içeren timedtext cevapları yok sayılır; oynatıcı her zaman çevirisiz kaynak ize ayarlanır.
- DOM yalnız `createElement`/`textContent`/`style` ile; `innerHTML` yok (Trusted Types).
- Varsayılan ayar: `{ showOriginal: true, trMode: 'onDemand' }`.
- Kullanıcıya görünen tüm metinler Türkçe. Commit mesajları Türkçe + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
- Video değişimi (SPA): eski videonun altyazısı yeni videoda görünmemeli → `videoId` eşleşmesi zorunlu (Task 2 `parseTimedtextUrl` testi + Task 4 Playwright adımı).
- Boş/HTML (Sorry) cevap: ayrıştırıcı çökmemeli, `[]` dönmeli (Task 2 testi).
- Çeviri satır sayısı tutmazsa yanlış satıra yanlış çeviri gitmemeli → bölerek yeniden dene (Task 2 `splitTranslated` testi).
- İki satır arası (aktif satır yok) TR tuşu: son söylenen satır kullanılmalı (Task 2 `findLastCueIndex` testi).
- Türkçe konuşulan video: çeviri yapılmamalı (Task 2 `chooseSourceTrack` testi).

---

### Task 1: Proje iskeleti
**Files:** Create `README.md`, `.gitignore`, `package.json` (`"test": "node --test test/"`), bu plan + tasarım.
- [ ] `.gitignore`: `node_modules/`, `.scratch*`, `.playwright-mcp/`, `test/harness/out/`
- [ ] Commit: "Proje başlangıcı: tasarım belgesi ve uygulama planı"

### Task 2: Saf fonksiyonlar + birim testleri
**Files:** Create `cift-altyazi.user.js` (metadata + `CA` saf fonksiyonları + Node dışa aktarımı), `test/core.test.js`; fixtures: `test/fixtures/ted-en-manual.json3.json`, `test/fixtures/vlog-en-asr.json3.json`.

**Interfaces (Produces, hepsi `CA.` altında):**
- `parseJson3(text: string) → Cue[]`, `Cue = { start: ms, end: ms, text: string }` (satır içi `\n` → boşluk, boş metinler atlanır, start'a göre sıralı; geçersiz JSON → `[]`)
- `findActiveCueIndex(cues, tMs) → number` (start ≤ t < end olanlardan en son başlayan; yoksa -1)
- `findLastCueIndex(cues, tMs) → number` (start ≤ t olan son satır; yoksa -1)
- `sentenceRange(cues, i, maxBack = 2, maxFwd = 2) → [from, to]`
- `chunkLines(lines: string[], maxChars = 4500) → Array<[from, toExclusive]>`
- `parseTranslateResponse(json: any) → string` (`json[0]` parçalarının `[0]`'larını birleştirir)
- `splitTranslated(text: string, expected: number) → string[] | null`
- `chooseSourceTrack(captionTracks) → { languageCode, kind } | { turkish: true } | null`
- `parseTimedtextUrl(url: string) → { videoId, lang, kind, tlang }`
- `normalizeSettings(raw) → { showOriginal: boolean, trMode: 'always' | 'onDemand' }`

- [ ] Testler (önce yaz, kırmızıyı gör): TED fixture → ilk cue `{start:12645, end:14015, text:'So in college,'}`; satır sonu birleşimi `'which means I had to write a lot of papers.'`; ASR fixture çakışan satırlarda t=4000 → index 1 (`'surviving your days…'` en son başlayan); `parseJson3('<html>Sorry')` → `[]`; `findLastCueIndex` aradaki boşlukta önceki satır; `sentenceRange` noktalamada durur ve 2 sınırını aşmaz; `chunkLines` her parça ≤ maxChars ve tüm satırları sırayla kapsar; `splitTranslated('a\nb',3)` → `null`; `chooseSourceTrack([{languageCode:'en',kind:'asr'},{languageCode:'en'}])` → `{languageCode:'en', kind:''}`; yalnız ASR tr → `{turkish:true}`; `parseTimedtextUrl` lang/kind/tlang/v; `normalizeSettings({trMode:'x'})` → varsayılanlar.
- [ ] `npm test` → hepsi PASS
- [ ] Commit: "Altyazı ayrıştırma ve çeviri yardımcıları (testlerle)"

### Task 3: Sayfa parçası + enjeksiyon + test düzeneği
**Files:** Modify `cift-altyazi.user.js` (`pagePart(token)`, `injectPagePart()`), Create `test/harness/build.mjs` (GM shim'leri + betiği bir Playwright fonksiyon dosyasına gömer → `test/harness/out/run.js`).

**Interfaces:** mesajlar `{ src:'cift-altyazi', token, type }`:
- sayfa → betik: `ready`, `captions {videoId, lang, kind, text}`, `video {videoId, status: 'ok'|'turkish'|'none'|'fail'}`
- betik → sayfa: `reload` (kaynak izi yeniden yüklet)

- [ ] Uygula; `pagePart` 1 sn'lik döngüde `getVideoData().video_id` değişimini izler, `chooseSourceTrack` (metin olarak sayfaya kopyalanır) ile izi seçer, yakalanmamışsa `setOption` (gerekirse önce `loadModule('captions')`), video başına ≤2 deneme.
- [ ] Doğrula (Playwright, tablet UA, `GM_info.injectInto='content'` yolu): TED videosunda `captions` mesajı gelir, `lang=en`, metin >10 KB; `ready` mesajı gelir; CSP/TT konsol hatası yok.
- [ ] Commit: "Oynatıcının altyazısını yakalayan sayfa parçası"

### Task 4: Ekran, ayarlar, çeviri, TR tuşu
**Files:** Modify `cift-altyazi.user.js` (`Overlay`, `Settings`, `Translator`, `main()`).
- [ ] Katman `#movie_player` içinde; İngilizce beyaz, Türkçe sarı, yarı saydam siyah zemin; ⚙ ve TR tuşları ≥44px, `pointerdown/touchstart/click` olayları oynatıcıya geçmez.
- [ ] Ayarlar paneli: "İngilizce altyazı: Açık/Kapalı", "Türkçe çeviri: Sürekli göster / Gerektiğinde göster", kapat düğmesi; değişiklik anında uygulanır ve `GM_setValue('settings')` ile saklanır; `GM_registerMenuCommand('Çift Altyazı ayarları', …)`.
- [ ] `Translator.translateAll(videoKey, lines)` (önbellekli, parça parça, önce şu anki parça) ve `Translator.translateText(text)`; hata → katmanda kısa Türkçe not ("Çeviri şu an alınamadı").
- [ ] Doğrula (Playwright): sürekli modda iki satır görünür; gerektiğinde modunda TR → `video.paused === true` + sarı Türkçe metin; tekrar TR → oynuyor + Türkçe yok; İngilizce kapalı → beyaz satır yok; sayfa yenilenince ayarlar korunur; başka videoya geçince eski metin görünmez.
- [ ] Commit: "Ekran katmanı, ayarlar paneli ve TR tuşu"

### Task 5: Tablet görünümü doğrulaması
- [ ] Playwright 1280×800 yatay ve 800×1280 dikey, `m.youtube.com` ve `www.youtube.com`; tam ekran (`requestFullscreen` sonrası katman görünür); ekran görüntüleri `docs/ekran/` altına.
- [ ] Bulunan hataları düzelt, `npm test` yeniden PASS. Commit: "Tablet görünümünde test ve düzeltmeler"

### Task 6: KULLANIM.md + GitHub
- [ ] `KULLANIM.md` (basit Türkçe): Firefox kurulumu, "bağlantıları uygulamada aç: Asla", Violentmonkey kurulumu, betik linki, kullanım, ayarlar, sorun giderme (altyazı yok, "Çeviri alınamadı", hata notu, güncelleme).
- [ ] Kullanıcıya sor → GitHub deposu (`cift-altyazi`), `@downloadURL`/`@updateURL` raw adresine güncelle, push. Commit: "Kullanım kılavuzu ve GitHub dağıtımı"
