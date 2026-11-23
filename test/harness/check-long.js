// Playwright MCP: browser_run_code_unsafe(filename: test/harness/check-long.js)
// Önce test/harness/out/setup.js çalıştırılmış olmalı.
// Uzun kullanımı taklit eder: ana sayfa, Shorts, önerilen videolar arasında dolaşır;
// her izleme sayfasında ⚙ açılıyor mu, altyazı geliyor mu, sayfada kaç oynatıcı var, bakar.
async (page) => {
  const OUT = 'd:/claude/cift-altyazi/test/harness/out/';
  const p = page.context().browser().contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('youtube.com'));
  if (!p) return 'YouTube sayfası yok: önce setup.js çalıştırın';
  const log = [];
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const dismiss = () => p.evaluate(() => {
    for (const b of document.querySelectorAll('dialog[open] button, bottom-sheet-container button')) {
      if (/not now|no thanks|şimdi değil|hayır/i.test(b.textContent || '')) b.click();
    }
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  }).catch(() => {});
  const snap = () => p.evaluate(() => {
    const vis = (n) => !!n && !n.hidden && n.offsetParent !== null && n.getBoundingClientRect().width > 0;
    const players = [...document.querySelectorAll('#movie_player, .html5-video-player')];
    const root = document.getElementById('ca-root');
    const realPlayer = players.find((pl) => vis(pl) && pl.getBoundingClientRect().width > 300);
    return {
      url: location.pathname + location.search.slice(0, 16),
      players: players.length + ' (görünür ' + players.filter(vis).length + ')',
      ids: players.map((pl) => pl.id || '-').join(','),
      rootIn: root ? (root.parentElement && (root.parentElement.id || root.parentElement.tagName)) : 'yok',
      rootVisible: vis(document.querySelector('#ca-ctrl')),
      rootInRealPlayer: !!(root && realPlayer && (realPlayer.contains(root) || (root.parentElement && root.parentElement.contains(realPlayer)))),
      active: document.documentElement.classList.contains('ca-active'),
      en: (document.querySelector('.ca-en:not([hidden])') || {}).textContent || '',
      lastEv: ((window.__ciftAltyaziDebug || { events: [] }).events.slice(-3)).map((e) => e.type + ':' + (e.videoId || '') + ':' + (e.status || e.len)).join(' '),
    };
  });
  const playNow = () => p.evaluate(() => {
    const mp = [...document.querySelectorAll('#movie_player')].find((x) => x.getBoundingClientRect().width > 300) || document.getElementById('movie_player');
    if (!mp) return;
    const v = mp.querySelector('video'); if (v) v.muted = true;
    if (mp.playVideo) mp.playVideo();
  });
  const gearWorks = async () => {
    const ok = await p.tap('#ca-ctrl .ca-gear', { timeout: 3000 }).then(() => true).catch((e) => 'tap hatası: ' + String(e).split('\n')[0].slice(0, 80));
    if (ok !== true) return ok;
    await p.waitForTimeout(300);
    const open = await p.evaluate(() => { const pn = document.getElementById('ca-panel'); return !!pn && !pn.hidden && pn.offsetParent !== null; });
    if (open) await p.tap('#ca-panel .ca-close', { timeout: 3000 }).catch(() => {});
    return open;
  };
  const checkWatch = async (label) => {
    await dismiss();
    await playNow();
    let s;
    for (let i = 0; i < 25; i++) { await p.waitForTimeout(1000); s = await snap(); if (s.active && s.en) break; if (i === 6) await playNow(); }
    const gear = await gearWorks();
    log.push(`${label}: ${s.url} | oynatıcı ${s.players} [${s.ids}] | kök: ${s.rootIn} görünür=${s.rootVisible} doğruOynatıcıda=${s.rootInRealPlayer} | altyazı=${s.active} "${s.en.slice(0, 30)}" | ⚙=${gear} | ${s.lastEv}`);
  };
  const goHome = async () => { await p.goto('https://m.youtube.com/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(5000); await dismiss(); };
  const clickFirstVideo = async (skip = 0) => {
    const ok = await p.evaluate((skip) => {
      const links = [...document.querySelectorAll('a[href*="/watch?v="]')].filter((a) => a.getBoundingClientRect().width > 50);
      const a = links[skip]; if (!a) return false; a.scrollIntoView(); a.click(); return a.getAttribute('href');
    }, skip);
    await p.waitForTimeout(3000);
    return ok;
  };

  try {
  await checkWatch('1 ilk video');
  await goHome();
  log.push('ana sayfa: ' + JSON.stringify(await snap()).slice(0, 220));
  await clickFirstVideo(0);
  await checkWatch('2 ana sayfadan');
  // Shorts
  const sh = await p.evaluate(() => { const a = document.querySelector('a[href^="/shorts/"]'); if (a) { a.click(); return a.getAttribute('href'); } return null; });
  if (!sh) await p.goto('https://m.youtube.com/shorts', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(6000);
  await dismiss();
  log.push('shorts: ' + JSON.stringify(await snap()).slice(0, 220));
  await p.goBack().catch(() => {});
  await p.waitForTimeout(4000);
  await checkWatch('3 shortstan geri');
  for (let k = 4; k <= 7; k++) {
    await clickFirstVideo(1);
    await checkWatch(k + ' önerilenden');
  }
  } catch (e) { log.push('TEST HATASI: ' + String(e).split(String.fromCharCode(10))[0].slice(0, 160)); }
  await p.screenshot({ path: OUT + 'uzun-son.png' });
  return { log, errors: errors.slice(0, 5) };
}
