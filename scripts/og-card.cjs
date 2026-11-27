// Renders public/og-card.jpg (1200x630), the link-preview card for every
// Tier Lists page: the five tiers with a few headshots from public/templates.json.
// Run by hand when the look changes (Playwright + Chromium):
//   node scripts/og-card.cjs
//
// Headshots are fetched here in Node from cdn.nba.com (not hoopsmatic.com's
// /img/nba-cdn/, which puts automated clients through a bot check). NBA.com
// answers an id it has no photo of with a grey silhouette, HTTP 200 and byte
// for byte its file for id 0 at that size: that counts as no photo, and a
// player with no photo (or id 0) gets no tile at all, never the silhouette.
const { readFileSync } = require('fs');
const { createHash } = require('crypto');
const ROOT = require('path').join(__dirname, '..');
const SIZE = '260x190';
const nbaUrl = (id) => `https://cdn.nba.com/headshots/nba/latest/${SIZE}/${id}.png`;
// The 260x190 silhouette's SHA-256 as of November 2026 (4,937 bytes): only a
// stand-in for when id 0 can't be fetched.
const SILHOUETTE_SHA256 = 'b3ebe78bfd1cecb8880e51e6a48c9093c5cfb7065f981826d12fb4c01a1b0965';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
async function getPng(url, get) {
  try {
    const r = await get(url);
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch { return null; }
}
let silhouette = null;
// id 0's hash, fetched once; the stand-in when it can't be had (not kept).
async function silhouetteHash(get) {
  if (silhouette) return silhouette;
  const b = await getPng(nbaUrl(0), get);
  return b ? (silhouette = sha256(b)) : SILHOUETTE_SHA256;
}
// The headshot's bytes, or null for no photo (id 0, a failed fetch, the silhouette).
async function photo(id, get = fetch) {
  if (!id) return null;
  const [b, sil] = await Promise.all([getPng(nbaUrl(id), get), silhouetteHash(get)]);
  return b && sha256(b) !== sil ? b : null;
}
async function render() {
  const { chromium } = require('playwright');
  const T = JSON.parse(readFileSync(ROOT + '/public/templates.json', 'utf8'));
  const pick = (slug, ids) => ids.map((id) => T.templates.find((t) => t.slug === slug).players.find((p) => p[0] === id)[2]);
  const rows = [
    ['S', '#d12c2c', pick('best-players-right-now', ['nikola-jokic', 'shai-gilgeous-alexander', 'giannis-antetokounmpo'])],
    ['A', '#e07a10', pick('best-players-right-now', ['luka-doncic', 'victor-wembanyama', 'anthony-edwards', 'jayson-tatum'])],
    ['B', '#c29a00', pick('best-players-right-now', ['jalen-brunson', 'stephen-curry', 'donovan-mitchell'])],
    ['C', '#1d8a40', pick('best-players-right-now', ['devin-booker', 'tyrese-maxey'])],
    ['D', '#3b82f6', pick('best-players-right-now', ['paolo-banchero'])],
  ];
  // Each tier keeps only the players with a photo, as data URIs.
  for (const row of rows) row[2] = (await Promise.all(row[2].map((id) => photo(id)))).filter(Boolean).map((b) => 'data:image/png;base64,' + b.toString('base64'));
  const font = readFileSync(ROOT + '/public/fonts/dm-sans-latin-wght-normal.woff2').toString('base64');
  const html = `<html><head><style>
@font-face{font-family:D;src:url(data:font/woff2;base64,${font})}
body{margin:0;width:1200px;height:630px;background:#f5f5f7;font-family:D,sans-serif;display:flex;color:#1d1d1f}
.l{width:470px;padding:64px 0 0 64px;display:flex;flex-direction:column}
h1{font-size:76px;line-height:1;margin:0;letter-spacing:-.03em}
p{font-size:28px;color:#6e6e73;margin:22px 0 0;line-height:1.3}
.b{margin-top:auto;margin-bottom:56px;font-size:40px;font-weight:800}.b span{color:#3b82f6}
.r{flex:1;padding:44px 56px 44px 0;display:flex;flex-direction:column;gap:8px}
.t{flex:1;display:flex;background:#fff;border-radius:14px;overflow:hidden}
.k{width:74px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:40px}
.f{display:flex;gap:8px;padding:8px}
.f div{width:116px;height:85px;background:#e6e6ea;border-radius:8px;overflow:hidden;display:flex;align-items:flex-end;justify-content:center}
.f img{width:100%;height:100%;object-fit:contain;object-position:center bottom}
</style></head><body>
<div class="l"><h1>NBA Tier Lists</h1><p>Rank the players. Publish your list. See where the fans land.</p><div class="b">Hoops<span>Matic</span></div></div>
<div class="r">${rows.map(([t, c, srcs]) => `<div class="t"><div class="k" style="background:${c}">${t}</div><div class="f">${srcs.map((src) => `<div><img src="${src}"></div>`).join('')}</div></div>`).join('')}</div>
</body></html>`;
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await pg.setContent(html, { waitUntil: 'load' });
  await pg.screenshot({ path: ROOT + '/public/og-card.jpg', type: 'jpeg', quality: 88 });
  await b.close();
}
module.exports = { photo, SILHOUETTE_SHA256 };
if (require.main === module) render().catch((e) => { console.error(e); process.exit(1); });
