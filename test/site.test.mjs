// The built site follows Jorge's rules. No network.
//   node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(ROOT + f, 'utf8');
const D = JSON.parse(read('public/templates.json'));
const E = JSON.parse(read('rules/edits.json')).templates;

test('25 templates, fixed S/A/B/C/D tiers, unique slugs', () => {
  assert.equal(D.templates.length, 25);
  assert.deepEqual(D.tiers, ['S', 'A', 'B', 'C', 'D']);
  assert.equal(new Set(D.templates.map((t) => t.slug)).size, 25);
});

test('every pool player links to his HoopsMatic page; ids unique per pool', () => {
  for (const t of D.templates) {
    assert.ok(t.players.length >= 20 && t.players.length <= 30, t.slug + ' pool size');
    assert.equal(new Set(t.players.map((p) => p[0])).size, t.players.length, t.slug + ' duplicates');
    for (const [id, name, nba, link, team] of t.players) {
      assert.match(link, /^https:\/\/hoopsmatic\.com\//, `${t.slug}: ${name} link`);
      assert.ok(nba === 0 || (Number.isInteger(nba) && nba > 0), `${name} nba id`);
      assert.ok(team, `${name} team`);
    }
  }
});

test('pools are alphabetical by last name (no ranking hint)', () => {
  const last = (n) => n.replace(/ (Jr\.|Sr\.|II|III|IV)$/, '').split(' ').slice(1).join(' ') || n;
  for (const t of D.templates) {
    const names = t.players.map((p) => last(p[1]));
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), t.slug);
  }
});

test('hand edits are applied and each has a reason', () => {
  for (const [slug, ed] of Object.entries(E)) {
    const t = D.templates.find((x) => x.slug === slug);
    assert.ok(t, slug);
    const ids = new Set(t.players.map((p) => p[0]));
    for (const [id, why] of Object.entries(ed.add || {})) { assert.ok(ids.has(id), `${slug} adds ${id}`); assert.ok(why.length > 8); }
    for (const [id, why] of Object.entries(ed.remove || {})) { assert.ok(!ids.has(id), `${slug} removes ${id}`); assert.ok(why.length > 8); }
  }
  assert.ok(D.templates.find((t) => t.slug === 'best-three-point-shooters-of-all-time').players.every((p) => p[0] !== 'lebron-james'));
});

test('era team names (as they were that season)', () => {
  const lakers = D.templates.find((t) => t.slug === 'lakers-all-time').players;
  assert.equal(lakers.find((p) => p[0] === 'george-mikan')[4], 'Minneapolis Lakers');
  const w = D.templates.find((t) => t.slug === 'warriors-all-time').players;
  assert.equal(w.find((p) => p[0] === 'paul-arizin')[4], 'Philadelphia Warriors');
});

test('a page per template and per consensus, canonical on hoopsmatic.com, footer, no third-party fonts', () => {
  const pages = ['public/index.html', ...D.templates.flatMap((t) => [`public/${t.slug}/index.html`, `public/${t.slug}/consensus/index.html`])];
  for (const f of pages) {
    assert.ok(existsSync(ROOT + f), f);
    const h = read(f);
    assert.match(h, /<link rel="canonical" href="https:\/\/hoopsmatic\.com\/tier-lists\/[^"]*">/, f);
    assert.match(h, /<meta property="og:url" content="https:\/\/hoopsmatic\.com\/tier-lists\//, f);
    assert.ok(h.includes('Anything wrong? Email us at <a href="mailto:hoopsmatic@hoopsmatic.com">hoopsmatic@hoopsmatic.com</a>'), f + ' footer 1');
    assert.ok(h.includes('For any other inquiry, contact us at <a href="mailto:ads@hoopsmatic.com">ads@hoopsmatic.com</a>'), f + ' footer 2');
    assert.ok(!/github\.io|fonts\.googleapis/.test(h), f + ' no github.io, no Google Fonts');
    assert.ok(!/\{\{[A-Z]+\}\}/.test(h), f + ' placeholders');
  }
});

test('launch: no date yet', () => {
  assert.equal(JSON.parse(read('rules/launch.json')).launch, null);
  assert.equal(JSON.parse(read('public/config.json')).launch, null);
});

test('the page: no pop-ups, no initials, a consensus threshold of 25, the share block', () => {
  const js = read('public/app.js'), css = read('public/style.css');
  assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(|<dialog|showModal/.test(js), 'no pop-ups');
  assert.ok(!/initials/i.test(js.replace(/never initials/gi, '')), 'no initials');
  assert.match(js, /const NEED = 25;/);
  assert.ok(js.includes('Not enough lists yet'));
  for (const k of ["['x', 'X']", "['bsky', 'Bluesky']", "['fb', 'Facebook']", "['wa', 'WhatsApp']", "['reddit', 'Reddit']", "['telegram', 'Telegram']"]) assert.ok(js.includes(k), k);
  assert.ok(js.includes("API + 'head/'"), 'share image headshots come through the same origin');
  assert.ok(!/text-transform:\s*uppercase/.test(css), 'no eyebrow kickers');
  assert.match(css, /--head-bg:#e6e6ea/, 'light-grey headshot background');
});
