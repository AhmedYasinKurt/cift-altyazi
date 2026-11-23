// Playwright MCP: browser_run_code_unsafe(filename: test/harness/check-style.js)
// Önce test/harness/out/setup.js çalıştırılmış olmalı (TED videosu açık).
// Altyazı boyutu ve arka plan koyuluğu ayarlarını dener.
async (page) => {
  const OUT = 'd:/claude/cift-altyazi/test/harness/out/';
  const p = page.context().browser().contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('youtube.com/watch'));
  if (!p) return 'YouTube sayfası yok: önce setup.js çalıştırın';
  const results = [];
  // YouTube'un "uygulamayı aç" penceresi oynatıcıyı etkisiz bırakır: varsa kapat.
  await p.evaluate(() => {
    for (const b of document.querySelectorAll('dialog[open] button, bottom-sheet-container button')) {
      if (/not now|no thanks|şimdi değil|hayır/i.test(b.textContent || '')) b.click();
    }
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  }).catch(() => {});
  const check = (name, ok, info) => results.push((ok ? 'GEÇTİ ' : 'KALDI ') + name + (info !== undefined ? ' → ' + info : ''));
  const st = () => p.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const vis = (n) => !!n && !n.hidden && n.offsetParent !== null;
    const en = q('.ca-en'), tr = q('.ca-tr'), panel = q('#ca-panel'), box = q('#ca-box');
    const r = (n) => { const b = n.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
    return {
      en: vis(en) ? en.textContent : '', tr: vis(tr) ? tr.textContent : '',
      font: parseFloat(getComputedStyle(box).fontSize),
      bg: getComputedStyle(tr).backgroundColor, shadow: getComputedStyle(tr).textShadow,
      sizeVal: (q('.ca-val[data-key="sizePct"]') || {}).textContent, bgVal: (q('.ca-val[data-key="bgPct"]') || {}).textContent,
      plusSizeDisabled: q('.ca-plus[data-key="sizePct"]') && q('.ca-plus[data-key="sizePct"]').disabled,
      minusBgDisabled: q('.ca-minus[data-key="bgPct"]') && q('.ca-minus[data-key="bgPct"]').disabled,
      panelOpen: vis(panel), panelRect: vis(panel) ? r(panel) : null, boxRect: vis(tr) ? r(tr) : null,
      settings: localStorage.getItem('ca-gm:settings'),
      panelFits: panel.scrollHeight <= panel.clientHeight + 1,
    };
  });
  const tap = async (sel, n = 1) => { for (let i = 0; i < n; i++) { await p.tap(sel); await p.waitForTimeout(250); } };

  // Konuşma başlamadan önceki ana git ve durdur: ekranda gerçek satır yok.
  await p.evaluate(() => { localStorage.removeItem('ca-gm:settings'); const mp = document.getElementById('movie_player'); mp.querySelector('video').muted = true; mp.seekTo(3, true); mp.pauseVideo(); });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  await p.evaluate(() => { const mp = document.getElementById('movie_player'); mp.querySelector('video').muted = true; mp.seekTo(3, true); mp.pauseVideo(); });
  await p.waitForTimeout(800);

  await tap('#ca-ctrl .ca-gear');
  await p.waitForTimeout(400);
  let s = await st();
  check('Panel açık', s.panelOpen);
  check('Panel kaydırmadan sığıyor', s.panelFits);
  check('Varsayılanlar %100 ve %80', s.sizeVal === '%100' && s.bgVal === '%80', s.sizeVal + ' ' + s.bgVal);
  check('Konuşma yokken örnek satır görünüyor', /böyle görünecek/.test(s.tr) && /will look/.test(s.en), s.en + ' | ' + s.tr);
  check('Panel altyazı kutusunu örtmüyor', s.panelRect && s.boxRect && s.panelRect.bottom <= s.boxRect.top, JSON.stringify([s.panelRect, s.boxRect]));
  const font100 = s.font;
  await p.screenshot({ path: OUT + 'stil-1-varsayilan.png' });

  // Boyut: +3 → %130
  await tap('.ca-plus[data-key="sizePct"]', 3);
  s = await st();
  check('Boyut %130', s.sizeVal === '%130', s.sizeVal);
  check('Yazı gerçekten büyüdü (~1.3 kat)', Math.abs(s.font / font100 - 1.3) < 0.08, font100 + 'px → ' + s.font + 'px');
  // Sınır: + çok kez → %200'de durur, + düğmesi pasif
  await tap('.ca-plus[data-key="sizePct"]', 7);
  s = await st();
  check('Boyut en fazla %200', s.sizeVal === '%200' && s.plusSizeDisabled === true, s.sizeVal + ' pasif=' + s.plusSizeDisabled);
  check('Panel %200 boyutta da kutuyu örtmüyor', s.panelRect && s.boxRect && s.panelRect.bottom <= s.boxRect.top, JSON.stringify([s.panelRect, s.boxRect]));
  await p.screenshot({ path: OUT + 'stil-2-buyuk.png' });
  // Geri − ile %120
  await tap('.ca-minus[data-key="sizePct"]', 8);
  s = await st();
  check('− ile %120', s.sizeVal === '%120', s.sizeVal);

  // Arka plan: − 8 kez → %0, kutu saydam + gölge
  await tap('.ca-minus[data-key="bgPct"]', 8);
  s = await st();
  check('Arka plan %0', s.bgVal === '%0' && s.minusBgDisabled === true, s.bgVal);
  check('Kutu tamamen saydam', /rgba\(8, 8, 8, 0\)|transparent/.test(s.bg), s.bg);
  check('Saydamken yazıda gölge var', s.shadow && s.shadow !== 'none', s.shadow);
  await p.screenshot({ path: OUT + 'stil-3-saydam.png' });
  // +5 → %50, gölge yok
  await tap('.ca-plus[data-key="bgPct"]', 5);
  s = await st();
  check('Arka plan %50', s.bgVal === '%50' && /rgba\(8, 8, 8, 0\.5\)/.test(s.bg), s.bgVal + ' ' + s.bg);
  check('%50de gölge yok', s.shadow === 'none', s.shadow);

  check('Ayarlar kaydedildi', s.settings === '{"showOriginal":true,"trMode":"onDemand","sizePct":120,"bgPct":50}', s.settings);

  // Kapat → örnek satır kaybolur
  await tap('#ca-panel .ca-close');
  s = await st();
  check('Panel kapanınca örnek satır kayboluyor', !s.panelOpen && s.tr === '' && s.en === '', s.en + ' | ' + s.tr);

  // Gerçek altyazıda da uygulanıyor: oynat, TR'ye bas
  await p.evaluate(() => { const mp = document.getElementById('movie_player'); mp.seekTo(15.6, true); mp.playVideo(); });
  await p.waitForTimeout(1500);
  await tap('#ca-ctrl .ca-btn:not(.ca-gear)');
  await p.waitForTimeout(1500);
  s = await st();
  check('Gerçek altyazıda boyut %120', Math.abs(s.font / font100 - 1.2) < 0.08 && s.tr.length > 3, s.font + 'px, ' + s.tr.slice(0, 40));
  check('Gerçek altyazıda arka plan %50', /rgba\(8, 8, 8, 0\.5\)/.test(s.bg), s.bg);
  await p.screenshot({ path: OUT + 'stil-4-gercek.png' });
  await tap('#ca-ctrl .ca-btn:not(.ca-gear)');

  // Eski (0.1.0) kayıtla açılış: boyut/koyuluk varsayılan gelmeli
  await p.evaluate(() => localStorage.setItem('ca-gm:settings', '{"showOriginal":false,"trMode":"always"}'));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  await tap('#ca-ctrl .ca-gear');
  s = await st();
  check('Eski kayıt: diğer ayarlar korunur, boyut/koyuluk varsayılan', s.sizeVal === '%100' && s.bgVal === '%80' && s.en === '' , s.sizeVal + ' ' + s.bgVal + ' en=' + JSON.stringify(s.en));
  await tap('#ca-panel .ca-close');
  await p.evaluate(() => localStorage.removeItem('ca-gm:settings'));
  return results;
}
