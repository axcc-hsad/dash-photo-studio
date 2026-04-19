// ─────────────────────────────────────────────────────────────
//  scrape-pdp.js  —  Netlify Function
//  POST { url }  →  { productName, productType, candidateImages[] }
// ─────────────────────────────────────────────────────────────
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return cors204();
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }
  const { url } = body;
  if (!url || !url.includes('lg.com')) return err(400, 'Not an LG URL');

  try {
    const html = await fetchPage(url);
    const result = await parsePage(html, url);
    return ok(result);
  } catch (e) {
    console.error('scrape-pdp error:', e);
    return err(500, e.message);
  }
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function parsePage(html, url) {
  // ── Product name ────────────────────────────────────────────
  const nameMatch =
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const productName = nameMatch ? decode(nameMatch[1]).split('|')[0].trim() : 'LG Product';

  // ── Product type ────────────────────────────────────────────
  const u = (url + ' ' + productName).toLowerCase();
  const productType =
    /refrigerator|fridge|freezer|lrmv|lfxs|gsxv|gsx|instaview/.test(u) ? 'fridge' :
    /washer|dryer|wm\d|dlex|dlgx/.test(u)                               ? 'washer' :
    /oled|qned|nano|tv|65u|55u|75u/.test(u)                             ? 'tv'     : 'appliance';

  // ── Collect images ──────────────────────────────────────────
  const imgSet = new Set();

  // 1. __NEXT_DATA__ (Next.js — most reliable for LG sites)
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]{10,})<\/script>/);
  if (nextMatch) {
    try {
      const nextData = JSON.parse(nextMatch[1]);
      collectImagesFromObject(nextData, imgSet);
    } catch { /* ignore parse error */ }
  }

  // 2. JSON-LD schema.org
  const jldMatches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of jldMatches) {
    try {
      const obj = JSON.parse(m[1]);
      collectImagesFromObject(obj, imgSet);
    } catch { /* ignore */ }
  }

  // 3. og:image meta tags
  const ogMatches = [...html.matchAll(/<meta[^>]+property="og:image[^"]*"[^>]+content="([^"]+)"/gi)];
  for (const m of ogMatches) imgSet.add(m[1]);

  // 4. LG CDN patterns in script/data attributes
  const cdnRe = /https?:\/\/(?:gscs-b2c\.lge\.com|[^"'\s]*?lg\.com\/content)[^"'\s,)>]+\.(?:jpg|jpeg|png|webp)(?:[^"'\s,)>]*)?/gi;
  for (const m of html.matchAll(cdnRe)) {
    const clean = m[0].split('\\u')[0].replace(/[\\'"]+$/, '');
    imgSet.add(clean);
  }

  // 4b. If we found a gallery/medium01.jpg pattern, probe for medium02..06
  const galleryBase = [...imgSet].find(u2 => /\/gallery\/medium0?1\.(jpg|jpeg|png|webp)/i.test(u2));
  if (galleryBase) {
    for (let n = 2; n <= 6; n++) {
      const probeUrl = galleryBase.replace(/medium0?1(\.\w+)$/i, `medium0${n}$1`);
      try {
        const r = await fetch(probeUrl, { method: 'HEAD', redirect: 'follow' });
        if (r.ok) imgSet.add(probeUrl);
      } catch { /* skip */ }
    }
  }

  // 5. data-src / src with product image patterns
  const srcRe = /(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  for (const m of html.matchAll(srcRe)) {
    const u2 = m[1];
    if ((u2.includes('lge.com') || u2.includes('lg.com')) &&
        !u2.includes('icon') && !u2.includes('logo') && !u2.includes('badge') &&
        !u2.includes('flag') && !u2.includes('ribbon')) {
      imgSet.add(u2);
    }
  }

  // ── Filter & rank ───────────────────────────────────────────
  const scored = [...imgSet]
    .filter(u2 => /\.(?:jpg|jpeg|png|webp)/i.test(u2))
    .filter(u2 => !/\d{1,2}x\d{1,2}(?!\d)/.test(u2))   // skip tiny thumbs like 2x2
    .filter(u2 => !/[_-]\d{2,3}x\d{2,3}[_.-]/i.test(u2)) // skip 450x450-style sized thumbs
    .filter(u2 => !/icon|logo|badge|flag|ribbon|sprite/i.test(u2))
    .map(u2 => ({ url: u2, score: scoreImage(u2) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // ── Build candidates ────────────────────────────────────────
  const VIEW_LABELS = ['Front View', 'Side View', '3/4 Angle', 'Detail Shot', 'Lifestyle', 'Top View'];
  const QC_SCORES   = [4.8, 4.3, 4.0, 3.7, 3.5, 3.2];

  let candidateImages = scored.map((item, i) => ({
    url:   item.url,
    label: VIEW_LABELS[i] || `View ${i + 1}`,
    score: QC_SCORES[i] || 3.0,
  }));

  // ── Fallback: at least one placeholder ──────────────────────
  if (candidateImages.length === 0) {
    candidateImages = [{
      url:   'https://placehold.co/400x400/eee/555?text=Product',
      label: 'Product',
      score: 3.0,
    }];
  }

  return { productName, productType, candidateImages };
}

// Recursively walk any object/array and collect image URLs
function collectImagesFromObject(obj, set, depth = 0) {
  if (depth > 12 || !obj) return;
  if (typeof obj === 'string') {
    const clean = obj.replace(/[\\'"]+$/, '');
    if (/^https?:\/\/.+\.(?:jpg|jpeg|png|webp)/i.test(clean) &&
        !clean.includes('icon') && !clean.includes('logo')) {
      set.add(clean);
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach(item => collectImagesFromObject(item, set, depth + 1));
    return;
  }
  if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      // Prioritise keys that suggest gallery images
      const isImgKey = /image|photo|gallery|media|src|url|thumb|picture/i.test(key);
      if (isImgKey || depth < 6) {
        collectImagesFromObject(val, set, depth + (isImgKey ? 0 : 1));
      }
    }
  }
}

// Score images — higher = more likely to be a good product shot
function scoreImage(url) {
  let s = 0;
  if (url.includes('gscs-b2c.lge.com')) s += 10;
  if (url.includes('/content/dam')) s += 8;
  if (/[A-Z]{2,}[-_]\d{3,}/i.test(url)) s += 5;   // model-number-like pattern
  if (/(?:main|hero|front|primary|featured)/i.test(url)) s += 6;
  if (/gallery|product/i.test(url)) s += 4;
  if (/\d{3,4}x\d{3,4}/.test(url)) s -= 3;         // sized thumbnails less preferred
  if (/(?:2000|1600|1200|900|large|xl)/i.test(url)) s += 3;   // large images preferred
  if (/thumbnail|thumb|small|xs|_s\./i.test(url)) s -= 5;
  return s;
}

function decode(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}

// ── Helpers ───────────────────────────────────────────────────────
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok      = b      => ({ statusCode: 200, headers: HEADERS, body: JSON.stringify(b) });
const err     = (c, m) => ({ statusCode: c,   headers: HEADERS, body: JSON.stringify({ error: m }) });
const cors204 = ()     => ({ statusCode: 204, headers: HEADERS, body: '' });
