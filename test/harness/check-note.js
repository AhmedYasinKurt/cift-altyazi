// Playwright MCP: browser_run_code_unsafe(filename: test/harness/check-note.js)
// Önce test/harness/out/setup.js çalıştırılmış olmalı.
// Hata 0.2.0: ekrana not ("Altyazı yüklenemedi" vb.) yazılınca showNote ↔ ensureUi sonsuz
// döngüye giriyor, betik kilitleniyordu. Bu test notu bilerek tetikler ve betiğin çalışmaya
// devam ettiğini doğrular.
async (page) => {
  const p = page.context().browser().contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('youtube.com/watch'));
  if (!p) return 'YouTube sayfası yok: önce setup.js çalıştırın';
  const results = [];
  const errors = [];
  const onErr = (e) => errors.push(String(e).slice(0, 160));
  p.on('pageerror', onErr);
  const check = (name, ok, info) => results.push((ok ? 'GEÇTİ ' : 'KALDI ') + name + (info !== undefined ? ' → ' + info : ''));
  const st = () => p.evaluate(() => {
    const vis = (n) => !!n && !n.hidden && n.offsetParent !== null;
    return {
      url: location.search, note: vis(document.getElementById('ca-note')) ? document.getElementById('ca-note').textContent : '',
      active: document.documentElement.classList.contains('ca-active'),
      en: (document.querySelector('.ca-en:not([hidden])') || {}).textContent || '',
    };
  });
  const gear = async () => {
    const t = await p.tap('#ca-ctrl .ca-gear', { timeout: 3000 }).then(() => true).catch(() => false);
    await p.waitForTimeout(300);
    const open = await p.evaluate(() => { const pn = document.getElementById('ca-panel'); return !!pn && !pn.hidden && pn.offsetParent !== null; });
    if (open) await p.tap('#ca-panel .ca-close', { timeout: 3000 }).catch(() => {});
    return t && open;
  };
  const play = () => p.evaluate(() => { const mp = document.getElementById('movie_player'); mp.querySelector('video').muted = true; mp.playVideo(); });
  const goVideo = (id) => p.evaluate((id) => {
    const a = document.createElement('a'); a.href = '/watch?v=' + id; a.className = 'media-item-thumbnail-container'; a.textContent = 'git';
    (document.querySelector('ytm-app') || document.body).appendChild(a); a.click();
  }, id);

  // 1) Tüm altyazı cevaplarını boşalt → yeni videoda "yüklenemedi" notu çıkmalı.
  const empty = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '' });
  await p.route('**/api/timedtext**', empty);
  await goVideo('8KkKuTCFvzI');
  await p.waitForTimeout(3000);
  await play();
  let s;
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); s = await st(); if (/yüklenemedi/.test(s.note)) break; }
  check('"Altyazı yüklenemedi" notu göründü', /yüklenemedi/.test(s.note), s.note);
  await p.waitForTimeout(1500);
  check('Not sonrası sonsuz döngü hatası yok', !errors.some((e) => /call stack/i.test(e)), errors.join(' | ').slice(0, 200));
  check('Not sonrası ⚙ açılıyor', await gear());

  // 2) Cevapları normale döndür → başka videoda altyazı gelmeli (betik kilitlenmemiş olmalı).
  await p.unroute('**/api/timedtext**', empty);
  await goVideo('arj7oStGLkU');
  await p.waitForTimeout(3000);
  await play();
  for (let i = 0; i < 30; i++) { await p.waitForTimeout(1000); s = await st(); if (s.active && s.en) break; }
  check('Sonraki videoda altyazı geliyor', s.active && !!s.en, s.en.slice(0, 40));
  check('Sonraki videoda ⚙ açılıyor', await gear());
  check('Hiç sonsuz döngü hatası yok', !errors.some((e) => /call stack/i.test(e)), String(errors.length));
  p.off('pageerror', onErr);
  return results;
}
