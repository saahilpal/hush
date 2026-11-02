import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './classify.js';

test('classify - rule 1: right after sending (ageMs < quietMs)', () => {
  const [kind, why] = classify({ ageMs: 10000, quietMs: 90000, ua: 'Mozilla/5.0' });
  assert.equal(kind, 'auto');
  assert.equal(why, 'Right after sending');
});

test('classify - rule 1: quiet window boundary edge (89999ms vs 90000ms)', () => {
  const [kindBefore, whyBefore] = classify({ ageMs: 89999, quietMs: 90000 });
  assert.equal(kindBefore, 'auto');
  assert.equal(whyBefore, 'Right after sending');

  const [kindAfter, whyAfter] = classify({ ageMs: 90000, quietMs: 90000 });
  assert.equal(kindAfter, 'likely');
  assert.equal(whyAfter, 'Opened on a device');
});

test('classify - rule 2: security scanner UA (curl)', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'curl/8.4.0' });
  assert.equal(kind, 'auto');
  assert.equal(why, 'Security scanner');
});

test('classify - rule 2: security scanner UA (bot/crawler/python)', () => {
  assert.deepEqual(classify({ ageMs: 120000, ua: 'Googlebot/2.1' }), ['auto', 'Security scanner']);
  assert.deepEqual(classify({ ageMs: 120000, ua: 'python-requests/2.31.0' }), ['auto', 'Security scanner']);
  assert.deepEqual(classify({ ageMs: 120000, ua: 'Mozilla/5.0 (HeadlessChrome)' }), ['auto', 'Security scanner']);
});

test('classify - rule 2: security scanner network (Proofpoint, Zscaler, Cisco)', () => {
  assert.deepEqual(classify({ ageMs: 120000, net: 'Proofpoint Inc.' }), ['auto', 'Security scanner']);
  assert.deepEqual(classify({ ageMs: 120000, net: 'Zscaler Inc' }), ['auto', 'Security scanner']);
  assert.deepEqual(classify({ ageMs: 120000, net: 'Cisco Systems' }), ['auto', 'Security scanner']);
});

test('classify - rule 3: GoogleImageProxy', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GoogleImageProxy' });
  assert.equal(kind, 'likely');
  assert.equal(why, 'Gmail');
});

test('classify - rule 3: YahooMailProxy', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'YahooMailProxy' });
  assert.equal(kind, 'likely');
  assert.equal(why, 'Yahoo Mail');
});

test('classify - rule 4: Apple network privacy proxy', () => {
  const [kind, why] = classify({ ageMs: 120000, net: 'Apple Inc.' });
  assert.equal(kind, 'auto');
  assert.equal(why, 'Apple Mail privacy proxy');
});

test('classify - rule 5: Data center network (AWS, Hetzner, DigitalOcean)', () => {
  assert.deepEqual(classify({ ageMs: 120000, net: 'Amazon.com, Inc.' }), ['auto', 'Data center, likely a scanner']);
  assert.deepEqual(classify({ ageMs: 120000, net: 'DigitalOcean, LLC' }), ['auto', 'Data center, likely a scanner']);
  assert.deepEqual(classify({ ageMs: 120000, net: 'Hetzner Online GmbH' }), ['auto', 'Data center, likely a scanner']);
});

test('classify - rule 6: Apple Mail prefetch (AppleWebKit without Safari/Chrome/Version)', () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const [kind, why] = classify({ ageMs: 120000, ua });
  assert.equal(kind, 'auto');
  assert.equal(why, 'Apple Mail, may be prefetched');
});

test('classify - rule 6: Real Safari with AppleWebKit is not prefetch', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const [kind, why] = classify({ ageMs: 120000, ua, country: 'US' });
  assert.equal(kind, 'likely');
  assert.equal(why, 'Opened on a device, US');
});

test('classify - rule 7: Outlook / Office with country', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'Microsoft Office/16.0 (Outlook)', country: 'GB' });
  assert.equal(kind, 'likely');
  assert.equal(why, 'Outlook, GB');
});

test('classify - rule 7: Outlook without country', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'Outlook-iOS/7.0' });
  assert.equal(kind, 'likely');
  assert.equal(why, 'Outlook');
});

test('classify - rule 8: Ordinary device with country', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'Mozilla/5.0 Chrome/120', country: 'CA' });
  assert.equal(kind, 'likely');
  assert.equal(why, 'Opened on a device, CA');
});

test('classify - rule 8: Ordinary device without country', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'Mozilla/5.0 Chrome/120' });
  assert.equal(kind, 'likely');
  assert.equal(why, 'Opened on a device');
});

test('classify - missing cf/empty options', () => {
  const [kind, why] = classify();
  assert.equal(kind, 'likely');
  assert.equal(why, 'Opened on a device');
});

test('classify - click upgrade: likely device with country becomes confirmed', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'Mozilla/5.0', country: 'US', isClick: true });
  assert.equal(kind, 'confirmed');
  assert.equal(why, 'Link clicked, US');
});

test('classify - click upgrade: likely Gmail becomes confirmed without country', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'GoogleImageProxy', isClick: true });
  assert.equal(kind, 'confirmed');
  assert.equal(why, 'Link clicked');
});

test('classify - click non-upgrade: scanner keeps auto tier with lowercased why', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'curl/8.0', isClick: true });
  assert.equal(kind, 'auto');
  assert.equal(why, 'Link clicked, security scanner');
});

test('classify - click non-upgrade: quiet window keeps auto tier', () => {
  const [kind, why] = classify({ ageMs: 10000, ua: 'Mozilla/5.0', isClick: true });
  assert.equal(kind, 'auto');
  assert.equal(why, 'Link clicked, right after sending');
});


test('classify - self-view overrides proxy to auto Sender viewed sent email', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'GoogleImageProxy', isSelfView: true });
  assert.equal(kind, 'auto');
  assert.equal(why, 'Sender viewed sent email');
});

test('classify - GoogleImageProxy on Outlook recipient becomes auto sender view', () => {
  const [kind, why] = classify({ ageMs: 120000, ua: 'GoogleImageProxy', mxProvider: 'Microsoft Outlook' });
  assert.equal(kind, 'auto');
  assert.equal(why, 'Sender view in Gmail (recipient on Microsoft Outlook)');
});
