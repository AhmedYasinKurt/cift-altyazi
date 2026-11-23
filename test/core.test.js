const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CA = require('../cift-altyazi.user.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const TED = fixture('ted-en-manual.json3.json');
const ASR = fixture('vlog-en-asr.json3.json');

test('parseJson3: elle yapılmış altyazının ilk satırı', () => {
  const cues = CA.parseJson3(TED);
  assert.ok(cues.length > 100);
  assert.deepEqual(cues[0], { start: 12645, end: 14015, text: 'So in college,' });
});

test('parseJson3: satır içi alt satır boşluğa dönüşür', () => {
  const cues = CA.parseJson3(TED);
  assert.equal(cues[2].text, 'which means I had to write a lot of papers.');
});

test('parseJson3: boş/segs olmayan olaylar atlanır, sıralıdır', () => {
  const cues = CA.parseJson3(ASR);
  assert.ok(cues.length > 50);
  assert.ok(cues.every((c) => c.text.trim().length > 0));
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].start);
  assert.match(cues[0].text, /^What if I told you/);
});

test('parseJson3: HTML (Sorry) ya da boş cevap → []', () => {
  assert.deepEqual(CA.parseJson3('<html><title>Sorry...</title></html>'), []);
  assert.deepEqual(CA.parseJson3(''), []);
  assert.deepEqual(CA.parseJson3('{"events":null}'), []);
});

test('parseJson3: kelime kelime (aAppend) biçimi tek satırda birleşir', () => {
  const j = JSON.stringify({ events: [
    { tStartMs: 0, dDurationMs: 4000, id: 1 },
    { tStartMs: 100, dDurationMs: 3900, wWinId: 1, segs: [{ utf8: 'hello' }, { utf8: ' world', tOffsetMs: 300 }] },
    { tStartMs: 2000, dDurationMs: 50, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
  ] });
  assert.deepEqual(CA.parseJson3(j), [{ start: 100, end: 4000, text: 'hello world' }]);
});

test('findActiveCueIndex: çakışan satırlarda en son başlayan', () => {
  const cues = CA.parseJson3(ASR);
  assert.equal(cues[1].start, 3040);
  assert.equal(CA.findActiveCueIndex(cues, 4000), 1);
  assert.equal(CA.findActiveCueIndex(cues, 50), -1);
});

test('findActiveCueIndex: iki satır arasında -1, findLastCueIndex önceki satır', () => {
  const cues = CA.parseJson3(TED); // 0: 12645-14015, 1: 15349-...
  assert.equal(CA.findActiveCueIndex(cues, 14500), -1);
  assert.equal(CA.findLastCueIndex(cues, 14500), 0);
  assert.equal(CA.findLastCueIndex(cues, 1000), -1);
});

test('sentenceRange: noktalamada durur ve sınırları aşmaz', () => {
  const c = (text) => ({ start: 0, end: 1, text });
  const cues = [c('Done.'), c('So in college,'), c('I was a major,'), c('which means a lot.'), c('Next one.')];
  assert.deepEqual(CA.sentenceRange(cues, 2), [1, 3]);
  assert.deepEqual(CA.sentenceRange(cues, 0), [0, 0]);
  const noPunct = [c('a'), c('b'), c('c'), c('d'), c('e'), c('f'), c('g')];
  assert.deepEqual(CA.sentenceRange(noPunct, 3), [1, 5]);
  assert.deepEqual(CA.sentenceRange(noPunct, 3, 1, 0), [2, 3]);
});

test('chunkLines: parçalar sınırı aşmaz ve tüm satırları sırayla kapsar', () => {
  const lines = Array.from({ length: 50 }, (_, i) => 'line number ' + i + ' ' + 'x'.repeat(i * 3));
  const chunks = CA.chunkLines(lines, 300);
  let next = 0;
  for (const [from, to] of chunks) {
    assert.equal(from, next);
    assert.ok(to > from);
    assert.ok(lines.slice(from, to).join('\n').length <= 300 || to - from === 1);
    next = to;
  }
  assert.equal(next, lines.length);
  assert.deepEqual(CA.chunkLines([], 300), []);
});

test('parseTranslateResponse + splitTranslated', () => {
  const resp = [[['Yani üniversitede,\n', 'So in college,\n'], ['Bunu anlamadım.', 'x']], null, 'en'];
  const text = CA.parseTranslateResponse(resp);
  assert.equal(text, 'Yani üniversitede,\nBunu anlamadım.');
  assert.deepEqual(CA.splitTranslated(text, 2), ['Yani üniversitede,', 'Bunu anlamadım.']);
  assert.equal(CA.splitTranslated('a\nb', 3), null);
  assert.equal(CA.parseTranslateResponse(null), '');
});

test('chooseSourceTrack', () => {
  assert.deepEqual(CA.chooseSourceTrack([{ languageCode: 'en', kind: 'asr' }, { languageCode: 'en' }]), { languageCode: 'en', kind: '' });
  assert.deepEqual(CA.chooseSourceTrack([{ languageCode: 'en', kind: 'asr' }, { languageCode: 'de' }]), { languageCode: 'en', kind: 'asr' });
  assert.deepEqual(CA.chooseSourceTrack([{ languageCode: 'ar' }, { languageCode: 'en-US' }, { languageCode: 'tr' }]), { languageCode: 'en-US', kind: '' });
  assert.deepEqual(CA.chooseSourceTrack([{ languageCode: 'tr', kind: 'asr' }]), { turkish: true });
  assert.deepEqual(CA.chooseSourceTrack([{ languageCode: 'tr' }]), { turkish: true });
  assert.equal(CA.chooseSourceTrack([]), null);
  assert.equal(CA.chooseSourceTrack(undefined), null);
});

test('parseTimedtextUrl', () => {
  const u = 'https://m.youtube.com/api/timedtext?v=arj7oStGLkU&caps=asr&lang=en&kind=asr&pot=x&fmt=json3&tlang=tr';
  assert.deepEqual(CA.parseTimedtextUrl(u), { videoId: 'arj7oStGLkU', lang: 'en', kind: 'asr', tlang: 'tr' });
  assert.deepEqual(CA.parseTimedtextUrl('/api/timedtext?v=abc&lang=de'), { videoId: 'abc', lang: 'de', kind: '', tlang: '' });
});

test('normalizeSettings', () => {
  const D = { showOriginal: true, trMode: 'onDemand', sizePct: 100, bgPct: 80 };
  assert.deepEqual(CA.normalizeSettings(undefined), D);
  assert.deepEqual(CA.normalizeSettings({ trMode: 'x', showOriginal: 'evet' }), D);
  assert.deepEqual(CA.normalizeSettings({ trMode: 'always', showOriginal: false }), { ...D, showOriginal: false, trMode: 'always' });
  // 0.1.0'dan kalma kayıt (boyut/opaklık yok) → varsayılanlarla tamamlanır
  assert.deepEqual(CA.normalizeSettings({ showOriginal: false, trMode: 'always' }).sizePct, 100);
});

test('normalizeSettings: boyut ve arka plan sınırları ve adımları', () => {
  const n = (o) => CA.normalizeSettings(o);
  assert.equal(n({ sizePct: 150 }).sizePct, 150);
  assert.equal(n({ sizePct: 10 }).sizePct, 60);
  assert.equal(n({ sizePct: 500 }).sizePct, 200);
  assert.equal(n({ sizePct: 134 }).sizePct, 130);
  assert.equal(n({ sizePct: 'büyük' }).sizePct, 100);
  assert.equal(n({ bgPct: 0 }).bgPct, 0);
  assert.equal(n({ bgPct: 100 }).bgPct, 100);
  assert.equal(n({ bgPct: -20 }).bgPct, 0);
  assert.equal(n({ bgPct: 47 }).bgPct, 50);
  assert.equal(n({ bgPct: null }).bgPct, 80);
});

test('stepSetting: −/+ düğmeleri sınırda durur', () => {
  assert.equal(CA.stepSetting('sizePct', 100, +1), 110);
  assert.equal(CA.stepSetting('sizePct', 200, +1), 200);
  assert.equal(CA.stepSetting('sizePct', 60, -1), 60);
  assert.equal(CA.stepSetting('bgPct', 0, -1), 0);
  assert.equal(CA.stepSetting('bgPct', 80, +1), 90);
});

test('@version ile VERSION aynı', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'cift-altyazi.user.js'), 'utf8');
  const meta = src.match(/@version\s+(\S+)/)[1];
  const code = src.match(/const VERSION = '([^']+)'/)[1];
  assert.equal(code, meta);
});

// --- Sürekli mod: parçaları tam cümlelere birleştirme ---------------------------------
const cue = (start, end, text) => ({ start, end, text });

test('buildSentences: bölünmüş cümleler birleşir, bir parçadaki iki cümle ayrılır', () => {
  const cues = [
    cue(0, 2000, 'and an empty garage. I started at Grant'),
    cue(2000, 4000, 'Logistics when I was 30.'),
    cue(4000, 6000, 'After 10 years, they made me warehouse'),
    cue(6000, 7000, 'supervisor.'),
  ];
  const s = CA.buildSentences(cues);
  assert.deepEqual(s.map((x) => x.text), [
    'and an empty garage.',
    'I started at Grant Logistics when I was 30.',
    'After 10 years, they made me warehouse supervisor.',
  ]);
  // İkinci cümle ilk parçanın ortasında başlar (~"I" harfinin konumu)
  assert.ok(s[1].start > 900 && s[1].start < 1300, 'başlangıç ' + s[1].start);
  assert.equal(s[0].start, 0);
  assert.equal(s[2].start, 4000);
  assert.equal(s[2].end, 8500); // son cümle de 1.5 sn kalır
  assert.ok(s[1].end <= s[2].start);
});

test('buildSentences: zamanlar sıralı ve üst üste binmiyor (otomatik altyazı)', () => {
  const s = CA.buildSentences(CA.parseJson3(ASR));
  assert.ok(s.length > 10);
  for (let i = 0; i < s.length; i++) {
    assert.ok(s[i].end > s[i].start, 'süre > 0 @' + i);
    if (i > 0) assert.ok(s[i].start >= s[i - 1].end, 'binme @' + i);
  }
});

test('buildSentences: metin kaybolmuyor (TED)', () => {
  const cues = CA.parseJson3(TED);
  const s = CA.buildSentences(cues);
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  assert.equal(norm(s.map((x) => x.text).join(' ')), norm(cues.map((c) => c.text).join(' ')));
  assert.ok(s.length < cues.length);
});

test('buildSentences: noktalama yoksa uzunluk sınırında keser', () => {
  const cues = Array.from({ length: 30 }, (_, i) => cue(i * 1000, i * 1000 + 1000, 'word word word word word word'));
  const s = CA.buildSentences(cues, 220);
  assert.ok(s.length > 1);
  assert.ok(s.every((x) => x.text.length <= 220 + 40), 'çok uzun cümle');
});

test('buildSentences: parantezli satır ayrı, ondalık sayı bölünmez, uzun boşlukta keser', () => {
  const s = CA.buildSentences([
    cue(0, 1000, 'It costs 3.5 dollars'),
    cue(1000, 2000, 'per day.'),
    cue(2000, 3000, '(Laughter)'),
    cue(3000, 4000, 'and then'),
    cue(12000, 13000, 'much later'),
  ]);
  assert.deepEqual(s.map((x) => x.text), ['It costs 3.5 dollars per day.', '(Laughter)', 'and then', 'much later']);
});

test('buildSentences: cümle bitince kısa süre ekranda kalır ama sonrakiyle binmez', () => {
  const s = CA.buildSentences([cue(0, 1000, 'Hello there.'), cue(5000, 6000, 'Next one.'), cue(6100, 7000, 'Third.')]);
  assert.equal(s[0].end, 2500); // 1000 + 1500, sonraki 5000'de
  assert.equal(s[1].end, 6100); // sonraki cümle 6100'de başlıyor
  assert.equal(CA.buildSentences([]).length, 0);
});
