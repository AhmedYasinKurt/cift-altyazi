// Playwright MCP: browser_run_code_unsafe(filename: test/harness/check-sentences.js)
// Önce test/harness/out/setup.js çalıştırılmış olmalı (TED videosu).
// Sürekli modda İngilizce ve Türkçe satırların TAM CÜMLE olduğunu doğrular.
async (page) => {
  const OUT = 'd:/claude/cift-altyazi/test/harness/out/';
  const p = page.context().browser().contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('youtube.com/watch'));
  if (!p) return 'YouTube sayfası yok: önce setup.js çalıştırın';
  const results = [];
  const check = (name, ok, info) => results.push((ok ? 'GEÇTİ ' : 'KALDI ') + name + (info !== undefined ? ' → ' + info : ''));
  const st = () => p.evaluate(() => {
    const vis = (n) => !!n && !n.hidden && n.offsetParent !== null;
    const q = (s) => document.querySelector(s);
    return { en: vis(q('.ca-en')) ? q('.ca-en').textContent : '', tr: vis(q('.ca-tr')) ? q('.ca-tr').textContent : '', t: q('#movie_player video').currentTime };
  });
  const until = async (fn, ms) => { const end = Date.now() + ms; let s; do { s = await st(); if (fn(s)) return s; await p.waitForTimeout(250); } while (Date.now() < end); return s; };
  await p.evaluate(() => {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    localStorage.setItem('ca-gm:settings', JSON.stringify({ showOriginal: true, trMode: 'always', sizePct: 100, bgPct: 80 }));
  });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { const mp = document.getElementById('movie_player'); mp.querySelector('video').muted = true; mp.seekTo(15.6, true); mp.playVideo(); });

  // 15.6 sn: YouTube parçası "I was a government major," → tam cümle beklenir
  let s = await until((x) => x.en.length > 3 && x.tr.length > 3, 20000);
  check('İngilizce tam cümle', s.en === 'So in college, I was a government major, which means I had to write a lot of papers.', JSON.stringify(s.en));
  check('Türkçe tam cümle (nokta ile biter, parça değil)', /\.$/.test(s.tr) && s.tr.length > 40, JSON.stringify(s.tr));
  if (s.tr.startsWith('[TR] ')) check('Türkçe satır aynı cümlenin çevirisi (sahte çeviri)', s.tr === '[TR] ' + s.en, JSON.stringify(s.tr));
  await p.screenshot({ path: OUT + 'cumle-1.png' });
  const first = s.en;
  // Cümle sürerken (parça değişse bile) aynı kalmalı
  await p.waitForTimeout(1500);
  s = await st();
  check('Parça değişse de aynı cümle kalıyor', s.en === first, s.t.toFixed(1) + 's ' + JSON.stringify(s.en.slice(0, 40)));
  // Sonra bir sonraki cümleye geçmeli
  s = await until((x) => x.en && x.en !== first, 8000);
  check('Sonraki cümleye geçiyor', s.en && s.en !== first && /^Now, when a normal student writes a paper/.test(s.en), s.t.toFixed(1) + 's ' + JSON.stringify(s.en));
  check('Sonraki cümlenin Türkçesi de tam', /[.?!…]$/.test(s.tr), JSON.stringify(s.tr));
  if (s.tr.startsWith('[TR] ')) check('Sonraki Türkçe satır da aynı cümleye ait', s.tr === '[TR] ' + s.en, JSON.stringify(s.tr));
  await p.screenshot({ path: OUT + 'cumle-2.png' });
  const diag = await p.evaluate(() => { document.querySelector('#ca-ctrl .ca-gear').click(); const d = document.querySelector('.ca-diag').textContent; document.querySelector('#ca-panel .ca-close').click(); return d; });
  check('Durum satırında cümle sayısı', /Çeviri: \d+\/\d+ cümle/.test(diag), diag);
  await p.evaluate(() => localStorage.removeItem('ca-gm:settings'));
  return results;
}
