// Playwright MCP için test düzeneği üretir.
// Kullanım: node test/harness/build.mjs [videoId]
// Çıktı: test/harness/out/setup.js → browser_run_code_unsafe'e `filename` olarak verilir.
// Violentmonkey'in GM_* işlevlerini taklit eder, betiği tablet kimliğiyle açılan sayfaya ekler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const userscript = fs.readFileSync(path.join(root, 'cift-altyazi.user.js'), 'utf8');
const args = process.argv.slice(2);
const mock = args.includes('--mock');
const desktop = args.includes('--desktop');
const UA = desktop
  ? 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0'
  : 'Mozilla/5.0 (Android 14; Tablet; rv:145.0) Gecko/145.0 Firefox/145.0';
const pos = args.filter((a) => !a.startsWith('--'));
const videoId = pos[0] || 'arj7oStGLkU';
const host = pos[1] || 'm.youtube.com';
// --mock: YouTube boş altyazı döndürürse (IP geçici engeli), kayıtlı gerçek altyazıyla doldur.
const fixtures = {
  arj7oStGLkU: 'ted-en-manual.json3.json',
  zBnrkKdNboI: 'vlog-en-asr.json3.json',
};
const fixturePaths = Object.fromEntries(Object.entries(fixtures).map(([k, f]) =>
  [k, path.join(root, 'test', 'fixtures', f).replace(/\\/g, '/')]));

const shims = `
(() => {
  window.GM_info = { injectInto: 'content', script: { version: 'harness' } };
  const k = (key) => 'ca-gm:' + key;
  window.GM_getValue = (key, def) => { try { const v = localStorage.getItem(k(key)); return v == null ? def : JSON.parse(v); } catch (e) { return def; } };
  window.GM_setValue = (key, val) => { localStorage.setItem(k(key), JSON.stringify(val)); };
  window.GM_deleteValue = (key) => { localStorage.removeItem(k(key)); };
  window.GM_addStyle = (css) => {
    const s = document.createElement('style'); s.textContent = css;
    const put = () => { const p = document.head || document.documentElement; if (!p) return false; p.appendChild(s); return true; };
    if (!put()) { const mo = new MutationObserver(() => { if (put()) mo.disconnect(); }); mo.observe(document, { childList: true, subtree: true }); }
    return s;
  };
  window.GM_registerMenuCommand = (name, fn) => { (window.__menu = window.__menu || {})[name] = fn; };
  window.GM_xmlhttpRequest = (d) => {
    window.__gmRequests = (window.__gmRequests || 0) + 1;
    fetch(d.url, { method: d.method || 'GET', headers: d.headers, body: d.data })
      .then(async (r) => {
        const t = await r.text();
        let response = t;
        if (d.responseType === 'json') { try { response = JSON.parse(t); } catch (e) { response = null; } }
        if (d.onload) d.onload({ status: r.status, responseText: t, response });
      })
      .catch((e) => { if (d.onerror) d.onerror(e); });
    return { abort() {} };
  };
})();
`;

// @noframes'i taklit et: yalnızca ana sayfada çalış.
const injected = 'if (window.top === window) {\n' + shims + '\n' + userscript + '\n}\n';
const injectedPath = path.join(here, 'out', 'injected.js').replace(/\\/g, '/');

const setup = `async (page) => {
  const browser = page.context().browser();
  for (const c of browser.contexts()) if (c !== page.context()) await c.close();
  const ctx = await browser.newContext({
    userAgent: ${JSON.stringify(UA)},
    viewport: { width: 1280, height: 800 }, isMobile: ${!desktop}, hasTouch: true, locale: 'en-US',
  });
  await ctx.addInitScript({ path: ${JSON.stringify(injectedPath)} });
  ${mock ? `const fx = ${JSON.stringify(fixturePaths)};
  await ctx.route('**/api/timedtext**', async (route) => {
    const u = new URL(route.request().url());
    const resp = await route.fetch();
    const body = await resp.text();
    const file = fx[u.searchParams.get('v')];
    if (body.length > 0 || !file || u.searchParams.get('tlang')) return route.fulfill({ response: resp });
    globalThis.__mocked = (globalThis.__mocked || 0) + 1;
    return route.fulfill({ status: 200, contentType: 'application/json', path: file });
  });` : ''}
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && /cift|Trusted|Content Security|CSP/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
  await p.goto('https://${host}/watch?v=${videoId}', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { const v = document.querySelector('#movie_player video'); if (v) v.muted = true; const mp = document.getElementById('movie_player'); if (mp && mp.playVideo) mp.playVideo(); });
  await p.waitForTimeout(7000);
  const dbg = await p.evaluate(() => (window.__ciftAltyaziDebug || { events: [] }).events);
  await p.screenshot({ path: ${JSON.stringify(path.join(here, 'out', 'setup.png').replace(/\\/g, '/'))} });
  return { url: p.url(), mocked: globalThis.__mocked || 0, events: dbg, errors };
}`;

fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'setup.js'), setup);
fs.writeFileSync(injectedPath, injected);
console.log('yazıldı: test/harness/out/setup.js (' + videoId + ' @ ' + host + (mock ? ', mock' : '') + (desktop ? ', masaüstü' : '') + ')');
