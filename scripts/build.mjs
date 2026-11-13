// Builds the static pages from scripts/page.html and public/templates.json:
//   public/index.html                     /tier-lists/ (the template list)
//   public/<slug>/index.html              /tier-lists/<slug>/ (rank; ?l=<id> a published list)
//   public/<slug>/consensus/index.html    /tier-lists/<slug>/consensus/
//   public/config.json                    {launch} from rules/launch.json
//   data/sitemap-state.json (+ public/)   per-URL content hash and lastmod
// Each page carries its own title, description, canonical and og: tags (all on
// hoopsmatic.com) and a plain HTML version of its content (title, line,
// players with their HoopsMatic links) that app.js replaces.
//
//   node scripts/build.mjs        (after scripts/build-templates.mjs)
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = 'https://hoopsmatic.com/tier-lists/';
const shell = readFileSync(ROOT + 'scripts/page.html', 'utf8');
const D = JSON.parse(readFileSync(ROOT + 'public/templates.json', 'utf8'));
const L = JSON.parse(readFileSync(ROOT + 'rules/launch.json', 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Cache-buster for app.js and style.css: their content hash.
const V = createHash('sha256').update(readFileSync(ROOT + 'public/app.js')).update(readFileSync(ROOT + 'public/style.css')).digest('hex').slice(0, 10);

function render(vars) {
  let h = shell;
  for (const [k, v] of Object.entries({ ...vars, V })) h = h.split('{{' + k + '}}').join(v);
  if (/\{\{[A-Z]+\}\}/.test(h)) throw new Error('page.html placeholder left: ' + h.match(/\{\{[A-Z]+\}\}/)[0]);
  return h;
}
const playerList = (t) => '<ul class="plain">' + t.players.map((r) => `<li><a href="${esc(r[3])}">${esc(r[1])}</a>${r[4] ? ', ' + esc(r[4]) : ''}</li>`).join('') + '</ul>';

const pages = {};
pages['/tier-lists/'] = render({
  TITLE: 'NBA Tier Lists: rank the players, see the fans’ consensus | HoopsMatic',
  DESC: 'Rank NBA players in S, A, B, C and D tiers: MVP race, best point guards of the 2010s, Celtics all-time and more. Publish your list and compare it with the fans.',
  CANON: SITE, OGTITLE: 'NBA Tier Lists: rank the players', PAGE: 'home', SLUG: '',
  STATIC: '<h1>NBA Tier Lists</h1>\n<p class="subtitle">Rank NBA players in S, A, B, C and D tiers, publish your list and see where the fans land.</p>\n<ul class="plain">'
    + D.templates.map((t) => `<li><a href="${SITE}${t.slug}/">${esc(t.title)}</a></li>`).join('') + '</ul>',
});
for (const t of D.templates) {
  pages[`/tier-lists/${t.slug}/`] = render({
    TITLE: esc(`${t.title} tier list: rank the players | HoopsMatic`),
    DESC: esc(`Make your ${t.title} tier list: put ${t.players.length} players in S, A, B, C and D tiers, publish it and share it. ${t.blurb}`),
    CANON: `${SITE}${t.slug}/`, OGTITLE: esc(`${t.title} tier list`), PAGE: 'rank', SLUG: t.slug,
    STATIC: `<h1>${esc(t.title)}</h1>\n<p class="subtitle">${esc(t.blurb)}</p>\n${playerList(t)}`,
  });
  pages[`/tier-lists/${t.slug}/consensus/`] = render({
    TITLE: esc(`${t.title}: the fans’ consensus tier list | HoopsMatic`),
    DESC: esc(`Where the fans rank ${t.players.length} players in the ${t.title} tier list: the average of every published list, S to D. ${t.blurb}`),
    CANON: `${SITE}${t.slug}/consensus/`, OGTITLE: esc(`${t.title}: the fans’ consensus`), PAGE: 'consensus', SLUG: t.slug,
    STATIC: `<h1>${esc(t.title)}: the fans’ consensus</h1>\n<p class="subtitle">${esc(t.blurb)}</p>\n${playerList(t)}`,
  });
}

// Remove page folders of templates that no longer exist (never fonts/).
const keep = new Set(D.templates.map((t) => t.slug).concat(['fonts']));
for (const f of readdirSync(ROOT + 'public')) if (statSync(ROOT + 'public/' + f).isDirectory() && !keep.has(f)) rmSync(ROOT + 'public/' + f, { recursive: true });
for (const [path, html] of Object.entries(pages)) {
  const dir = ROOT + 'public/' + path.replace(/^\/tier-lists\//, '');
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + 'index.html', html);
}
writeFileSync(ROOT + 'public/config.json', JSON.stringify({ launch: L.launch || null }) + '\n');

// Sitemap state: a URL's lastmod moves only when its page's content changes.
const file = ROOT + 'data/sitemap-state.json';
const old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).urls || {} : {};
const today = new Date().toISOString().slice(0, 10);
const urls = {};
let moved = 0;
for (const [path, html] of Object.entries(pages)) {
  // The hash leaves out the cache-buster, so a CSS or JS change alone does not move lastmod.
  const hash = createHash('sha256').update(html.replace(/\?v=[0-9a-f]{10}/g, '')).digest('hex').slice(0, 16);
  const prev = old[path];
  if (prev && prev.hash === hash) urls[path] = prev; else { urls[path] = { hash, lastmod: today }; moved++; }
}
const state = JSON.stringify({ _about: 'Per-URL content hash and lastmod for hoopsmatic.com/tier-lists/sitemap.xml (scripts/build.mjs). hoopsmatic-worker lists the main page and, from launch, each consensus page with 25+ lists.', urls }) + '\n';
writeFileSync(file, state);
writeFileSync(ROOT + 'public/sitemap-state.json', state);
console.log(`pages ${Object.keys(pages).length}, lastmod moved ${moved}`);
