// Playwright MCP: browser_run_code_unsafe(filename: test/harness/check-tablet.js)
// Önce test/harness/out/setup.js çalıştırılmış olmalı (m.youtube.com, TED videosu).
async (page) => {
  const OUT = 'd:/claude/cift-altyazi/test/harness/out/';
  const p = page.context().browser().contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('youtube.com/watch'));
  if (!p) return 'YouTube sayfası yok: önce setup.js çalıştırın';
  const results = [];
  const check = (name, ok, info) => results.push((ok ? 'GEÇTİ ' : 'KALDI ') + name + (info ? ' → ' + info : ''));
  const state = () => p.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const vis = (n) => !!n && !n.hidden && n.offsetParent !== null;
    const v = q('#movie_player video');
    const r = (n) => { if (!n) return null; const b = n.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    return {
      url: location.href, t: v && v.currentTime, paused: v && v.paused,
      en: vis(q('.ca-en')) ? q('.ca-en').textContent : '',
      tr: vis(q('.ca-tr')) ? q('.ca-tr').textContent : '',
      active: document.documentElement.classList.contains('ca-active'),
      fs: document.fullscreenElement ? (document.fullscreenElement.id || document.fullscreenElement.tagName) : '',
      rootInFs: !!(document.fullscreenElement && document.fullscreenElement.contains(q('#ca-root'))),
      ctrlRect: r(q('#ca-ctrl')), boxRect: r(q('#ca-box')), playerRect: r(q('#movie_player')),
      ev: (window.__ciftAltyaziDebug || { events: [] }).events.map((e) => e.type + ':' + (e.videoId || '') + ':' + (e.status || e.len)).slice(-6).join(' '),
    };
  });
  const until = async (fn, ms) => { const end = Date.now() + ms; let s; do { s = await state(); if (fn(s)) return s; await p.waitForTimeout(400); } while (Date.now() < end); return s; };
  const play = (sec) => p.evaluate((sec) => { const v = document.querySelector('#movie_player video'); v.muted = true; const mp = document.getElementById('movie_player'); mp.seekTo(sec, true); mp.playVideo(); }, sec);

  // 1) Dikey tutuş
  await p.setViewportSize({ width: 800, height: 1280 });
  await play(20);
  let s = await until((x) => x.en.length > 3, 8000);
  check('Dikey: İngilizce satır görünüyor', s.en.length > 3, s.en);
  const inside = (a, b) => a && b && a[0] >= b[0] && a[1] >= b[1] && a[0] + a[2] <= b[0] + b[2] + 1 && a[1] + a[3] <= b[1] + b[3] + 1;
  check('Dikey: tuşlar oynatıcının içinde', inside(s.ctrlRect, s.playerRect), JSON.stringify([s.ctrlRect, s.playerRect]));
  check('Dikey: altyazı oynatıcının içinde', inside(s.boxRect, s.playerRect), JSON.stringify([s.boxRect, s.playerRect]));
  await p.screenshot({ path: OUT + '6-dikey.png' });
  await p.setViewportSize({ width: 1280, height: 800 });

  // 2) Tam ekran (YouTube'un kendi tam ekran düğmesiyle)
  await p.tap('#movie_player', { position: { x: 200, y: 150 } }).catch(() => {});
  await p.waitForTimeout(500);
  const fsBtn = await p.$('button.fullscreen-icon');
  if (fsBtn) { await fsBtn.tap().catch(() => fsBtn.click({ force: true })); }
  s = await until((x) => !!x.fs, 4000);
  check('Tam ekran açıldı', !!s.fs, s.fs);
  check('Tam ekranda katmanımız görünür alanda', s.rootInFs, s.fs);
  s = await until((x) => x.en.length > 3, 6000);
  check('Tam ekranda İngilizce satır', s.en.length > 3, s.en);
  const tapped = await p.tap('#ca-ctrl .ca-btn:not(.ca-gear)').then(() => true).catch((e) => String(e).slice(0, 120));
  s = await until((x) => x.tr.length > 3 && !/Çevriliyor/.test(x.tr), 8000);
  check('Tam ekranda TR tuşu çalışıyor', tapped === true && s.paused && s.tr.length > 3, tapped === true ? s.tr : tapped);
  await p.screenshot({ path: OUT + '7-tam-ekran.png' });
  await p.tap('#ca-ctrl .ca-btn:not(.ca-gear)').catch(() => {});
  await p.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
  await p.waitForTimeout(800);

  // 3) Uygulama içinde başka videoya geçiş (sadece otomatik altyazılı video)
  const before = (await state()).url;
  await p.evaluate(() => {
    const app = document.querySelector('ytm-app') || document.body;
    const a = document.createElement('a');
    a.href = '/watch?v=zBnrkKdNboI';
    a.className = 'media-item-thumbnail-container';
    a.textContent = 'git';
    app.appendChild(a);
    a.click();
  });
  await p.waitForTimeout(1500);
  s = await state();
  check('Video değişti', s.url !== before && s.url.includes('zBnrkKdNboI'), s.url);
  check('Eski videonun altyazısı görünmüyor', !/college|government|papers/.test(s.en + s.tr), s.en + ' | ' + s.tr);
  await p.waitForTimeout(3000);
  await play(5);
  s = await until((x) => x.active && x.en.length > 3, 30000);
  check('Otomatik altyazılı yeni videoda İngilizce satır', s.en.length > 3, s.en + ' || ' + s.ev);
  await p.screenshot({ path: OUT + '8-yeni-video.png' });
  return results;
}
