# Çift Altyazı — Tasarım

## Amaç
Android tablette (Firefox + Violentmonkey) YouTube izlerken:
- İngilizce (orijinal) altyazıyı ayarlardan **açıp kapatabilmek**,
- Türkçe çeviriyi **sürekli** ya da **gerektiğinde** (TR tuşu: video durur + Türkçe çıkar; tekrar basınca gizlenir + devam eder) görmek.
Ücretsiz, API anahtarı yok. Masaüstündeki Language Reactor deneyimine yakın.

## Hedef dışı
- Altyazısı hiç olmayan videolar (konuşma tanıma yok).
- Kelime sözlüğü, kelime kaydetme, alıştırma modları.
- YouTube Android uygulaması (eklenti/betik orada çalışmaz).

## Araştırmadan çıkan kısıtlar (2026-11-23, gerçek m.youtube.com üzerinde test edildi)
- Altyazı isteği (`/api/timedtext`) oynatıcının ürettiği `pot` kimliğini taşır. **Aynı adresi tekrar istemek boş döner** → altyazı yalnızca oynatıcının kendi XHR cevabı yakalanarak alınabilir.
- Mobil oynatıcı altyazıyı `fmt=json3` ile XHR üzerinden ister.
- `movie_player.setOption('captions','track',{languageCode, kind?})` oynatıcıya geçerli yeni bir istek yaptırır (yakalanabilir).
- YouTube'un kendi çevirisi (`tlang=tr`) "automated queries / Sorry" sayfasıyla engellendi → **yedek olarak kullanılmaz**. Oynatıcı `tlang` tercihini hatırlar; betik izi her zaman çevirisiz kaynak ize ayarlar.
- Oynatıcı API'sinin `tracklist`'i, elle yapılmış iz varken ASR izini göstermez; `getPlayerResponse().captions.playerCaptionsTracklistRenderer.captionTracks` hepsini gösterir.
- m.youtube.com CSP: nonce + `strict-dynamic` + `require-trusted-types-for 'script'`. Firefox'ta Violentmonkey sayfa enjeksiyonu engellenebilir.
- `translate.googleapis.com/translate_a/single?client=gtx` çalışıyor, POST destekliyor, CORS `*`. Satırlar `\n` ile birleştirilince çeviri satır satır eşleşiyor. Resmi değil.

## Yaklaşımlar (değerlendirilen)
1. Hazır Firefox eklentisi (Dualsub) — kullanıcı denedi, **çalışmadı**.
2. **Firefox + Violentmonkey + kendi userscript'imiz — SEÇİLDİ.** Kurulum kolay, imza/hesap gerekmez, davranış tam istenen gibi.
3. Kendi .xpi eklentimiz — aynı yetenek, tablete kurulum zor (imza + gizli menü).
4. Link yapıştırılan web sayfası — PO token yüzünden güvenilir değil.
5. Android uygulaması (WebView) — 2'nin çok daha zahmetli hali.

## Mimari
Tek dosya `cift-altyazi.user.js`, `@inject-into content`, `@run-at document-start`.

**Sayfa parçası** (`pagePart`, metin olarak sayfaya eklenir; YouTube'un `script[nonce]` değeri + Trusted Types politikası ile):
- `XMLHttpRequest`/`fetch` sarar; `/api/timedtext` cevaplarını (videoId, lang, kind, tlang, metin) `window.postMessage` ile betiğe yollar (rastgele jeton ile).
- Video değişimini izler; kaynak izi seçer ve gerekiyorsa `setOption` ile yükletir (video başına en çok 2 deneme).
- Betikten gelen komutları uygular.
- Başladığında `ready` mesajı yollar; 4 sn içinde gelmezse betik ekranda hata notu gösterir.

**Betik parçası** (Violentmonkey alanı): ayarlar (`GM_getValue/GM_setValue`), ekran katmanı, çeviri (`GM_xmlhttpRequest`), önbellek, menü komutu.

**Kaynak iz seçimi:** konuşma dili = ASR izinin dili. Öncelik: o dilde elle yapılmış iz → ASR izi → `en*` elle iz → ilk `tr` olmayan iz. Konuşma dili Türkçe ise çeviri yapılmaz.

**Ekran:** `#movie_player` içine katman (tam ekranda görünür). YouTube'un kendi altyazı kutusu (`#ytp-caption-window-container`) yalnızca bizim altyazımız hazırken CSS ile gizlenir. Etkin satır = başlangıcı ≤ t olan ve bitişi > t olan **en son başlayan** satır. DOM yalnız `createElement`/`textContent` ile (Trusted Types).

**Ayarlar** (varsayılan): `showOriginal: true`, `trMode: 'onDemand'` (`'always' | 'onDemand'`). ⚙ düğmesi + Violentmonkey menüsü.

**Türkçe — sürekli:** tüm satırlar `\n` ile birleştirilip ≤4500 karakterlik parçalar halinde POST; satır sayısı tutmazsa parça ikiye bölünüp yeniden denenir. Önce şu anki zamanı içeren parça. Sonuç video+dil başına önbellekte (son 20 video).

**Türkçe — gerektiğinde:** TR tuşu → `video.pause()` + cümle aralığı (geriye: önceki satır `.?!…` ile bitmiyorsa en çok 2 satır; ileriye: satır noktalama ile bitmiyorsa en çok 2 satır) tek istekte çevrilir; İngilizce açıksa aynı aralığın İngilizcesi de gösterilir. Tekrar basınca gizle + `play()`. Video başka yoldan oynatılırsa Türkçe gizlenir.

## Dağıtım
GitHub herkese açık depo; `@downloadURL`/`@updateURL` raw adresi. Yayınlamadan önce kullanıcıya sorulur.

## Riskler
YouTube yapı değişikliği; gtx adresinin kapanması/sınırlanması; Firefox'ta nonce enjeksiyonunun çalışmaması (tablette doğrulanacak; çalışmazsa ekranda açık hata mesajı).
