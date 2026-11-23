// Playwright MCP: browser_run_code_unsafe(filename: test/harness/check-ui.js)
// Önce test/harness/out/setup.js çalıştırılmış olmalı (TED videosu açık).
async (page) => {
  const OUT = 'd:/claude/cift-altyazi/test/harness/out/';
  const p = page.context().browser().contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('youtube.com/watch'));
  if (!p) return 'YouTube sayfası yok: önce setup.js çalıştırın';
  const results = [];
  const check = (name, ok, info) => results.push((ok ? 'GEÇTİ ' : 'KALDI ') + name + (info ? ' → ' + info : ''));
  const state = () => p.evaluate(() => {
    const v = document.querySelector('#movie_player video');
    const q = (s) => document.querySelector(s);
    const vis = (n) => !!n && !n.hidden && n.offsetParent !== null;
    return {
      t: v.currentTime, paused: v.paused,
      en: vis(q('.ca-en')) ? q('.ca-en').textContent : '',
      tr: vis(q('.ca-tr')) ? q('.ca-tr').textContent : '',
      trBtn: vis(q('#ca-ctrl .ca-btn:not(.ca-gear)')),
      panel: vis(q('#ca-panel')),
      nativeHidden: getComputedStyle(q('.ytp-caption-window-container') || document.body).display === 'none',
      settings: localStorage.getItem('ca-gm:settings'),
    };
  });
  const tap = async (sel) => { await p.tap(sel); await p.waitForTimeout(400); };
  const until = async (fn, ms) => { const end = Date.now() + ms; let s; do { s = await state(); if (fn(s)) return s; await p.waitForTimeout(300); } while (Date.now() < end); return s; };

  // Konuşma başlayana kadar ilerlet (TED: ilk satır 12.6 sn).
  await p.evaluate(() => { const v = document.querySelector('#movie_player video'); v.muted = true; const mp = document.getElementById('movie_player'); mp.seekTo(15.6, true); mp.playVideo(); });
  await p.waitForTimeout(1500);
  let s = await state();
  check('İngilizce satır görünüyor', /government major|papers/.test(s.en), JSON.stringify(s.en));
  check('YouTube kendi altyazısı gizli', s.nativeHidden);
  check('Gerektiğinde modunda Türkçe yok', s.tr === '', s.tr);
  check('TR tuşu görünüyor', s.trBtn);
  await p.screenshot({ path: OUT + '1-ingilizce.png' });

  // TR → durur + Türkçe
  await tap('#ca-ctrl .ca-btn:not(.ca-gear)');
  const t0 = Date.now();
  s = await until((x) => x.tr.length > 3 && !/Çevriliyor/.test(x.tr), 8000);
  results.push('bilgi: çeviri süresi ~' + (Date.now() - t0) + ' ms');
  check('TR: video durdu', s.paused === true);
  check('TR: Türkçe çeviri çıktı', s.tr.length > 3 && !/Çevriliyor|alınamadı/.test(s.tr), JSON.stringify(s.tr));
  check('TR: İngilizce cümlenin tamamı', /college.*government major|government major.*papers/.test(s.en), JSON.stringify(s.en));
  await p.screenshot({ path: OUT + '2-tr-acik.png' });

  // TR tekrar → devam + Türkçe yok
  await tap('#ca-ctrl .ca-btn:not(.ca-gear)');
  await p.waitForTimeout(800);
  s = await state();
  check('TR tekrar: video oynuyor', s.paused === false);
  check('TR tekrar: Türkçe gizlendi', s.tr === '', s.tr);

  // Ayarlar: sürekli göster
  await tap('#ca-ctrl .ca-gear');
  s = await state();
  check('⚙: ayarlar paneli açıldı', s.panel);
  await p.screenshot({ path: OUT + '3-ayarlar.png' });
  await tap('#ca-panel .ca-opt[data-val="always"]');
  await tap('#ca-panel .ca-close');
  await p.evaluate(() => { const v = document.querySelector('#movie_player video'); const mp = document.getElementById('movie_player'); mp.seekTo(30, true); mp.playVideo(); });
  await p.waitForTimeout(5000);
  s = await state();
  check('Sürekli: Türkçe satır görünüyor', s.tr.length > 3, JSON.stringify(s.tr));
  check('Sürekli: İngilizce de görünüyor', s.en.length > 3, JSON.stringify(s.en));
  check('Sürekli: TR tuşu gizli', s.trBtn === false);
  check('Sürekli: video oynuyor', s.paused === false);
  await p.screenshot({ path: OUT + '4-surekli.png' });

  // İngilizce kapalı
  await tap('#ca-ctrl .ca-gear');
  await tap('#ca-panel .ca-opt[data-val="false"]');
  await tap('#ca-panel .ca-close');
  await p.waitForTimeout(1500);
  s = await state();
  check('İngilizce kapalı: İngilizce satır yok', s.en === '', s.en);
  check('İngilizce kapalı: Türkçe hâlâ var', s.tr.length > 3, s.tr);
  check('Ayarlar kaydedildi', s.settings === '{"showOriginal":false,"trMode":"always"}', s.settings);
  await p.screenshot({ path: OUT + '5-ingilizce-kapali.png' });

  // Yenileme sonrası ayar korunuyor mu, varsayılana dön
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  const kept = await p.evaluate(() => localStorage.getItem('ca-gm:settings'));
  check('Yenilemeden sonra ayarlar korunuyor', kept === '{"showOriginal":false,"trMode":"always"}', kept);
  await p.evaluate(() => localStorage.removeItem('ca-gm:settings'));

  // Yenilemeden 10 sn sonra oynat: altyazı yine de gelmeli (vazgeçmemeli).
  await p.waitForTimeout(10000);
  await p.evaluate(() => { const v = document.querySelector('#movie_player video'); v.muted = true; const mp = document.getElementById('movie_player'); mp.seekTo(15.6, true); mp.playVideo(); });
  let after, waited = 0;
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); waited++; after = await p.evaluate(() => document.documentElement.classList.contains('ca-active')); if (after) break; }
  results.push('bilgi: geç oynatmada bekleme ~' + waited + ' sn');
  const after2 = await p.evaluate(() => ({ active: document.documentElement.classList.contains('ca-active'), ev: window.__ciftAltyaziDebug.events.map((e) => e.type + ':' + (e.status || e.len)).join(' ') }));
  check('Geç oynatınca altyazı yine geliyor', after2.active, after2.ev);
  return results;
}
