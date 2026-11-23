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
  assert.deepEqual(CA.normalizeSettings(undefined), { showOriginal: true, trMode: 'onDemand' });
  assert.deepEqual(CA.normalizeSettings({ trMode: 'x', showOriginal: 'evet' }), { showOriginal: true, trMode: 'onDemand' });
  assert.deepEqual(CA.normalizeSettings({ trMode: 'always', showOriginal: false }), { showOriginal: false, trMode: 'always' });
});

test('@version ile VERSION aynı', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'cift-altyazi.user.js'), 'utf8');
  const meta = src.match(/@version\s+(\S+)/)[1];
  const code = src.match(/const VERSION = '([^']+)'/)[1];
  assert.equal(code, meta);
});
