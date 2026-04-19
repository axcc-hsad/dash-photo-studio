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
    const result = parsePage(html, url);
    return ok(result);
  } catch (e) {
    console.error('scrape-pdp error:', e);
    return err(500, e.message);
  }
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DASHBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parsePage(html, url) {
  // ── Product name ────────────────────────────────────────
  const nameMatch =
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    html.match(/<meta[^>]+name="title"[^>]+content="([^"]+)"/i) ||
    html.match(/<h1[^>]*class="[^"]*(?:product|title)[^"]*"[^>]*>([^<]+)<\/h1>/i);
  const productName = nameMatch ? decode(nameMatch[1]) : 'LG Product';

  // ── Product type ────────────────────────────────────────
  const u = url.toLowerCase() + ' ' + productName.toLowerCase();
  const productType =
    /refrigerator|fridge|lrmv|lfxs|lrfxs/.test(u) ? 'fridge' :
    /washer|dryer|wm\d|dlex|dlgx/.test(u)          ? 'washer' :
    /oled|qned|nano|tv|65u|55u|75u/.test(u)         ? 'tv'     : 'appliance';

  // ── Images ──────────────────────────────────────────────
  const imgUrls = new Set();

  // og:image
  const ogM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/gi) || [];
  ogM.forEach(m => { const c = m.match(/content="([^"]+)"/i); if (c) imgUrls.add(c[1]); });

  // JSON-LD schema
  const jldM = html.match(/"image"\s*:\s*\[([^\]]+)\]/g) || [];
  jldM.forEach(m => {
    const urls = m.match(/https?:\/\/[^\s"',]+/g) || [];
    urls.forEach(u2 => imgUrls.add(u2));
  });

  // data-src / src with lg-specific patterns
  const srcM = html.match(/(?:data-src|src)="(https:\/\/[^"]*lg[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"[^>]*>/gi) || [];
  srcM.forEach(m => {
    const c = m.match(/(?:data-src|src)="([^"]+)"/i);
    if (c && !c[1].includes('icon') && !c[1].includes('logo') && !c[1].includes('badge')) {
      imgUrls.add(c[1]);
    }
  });

  // Filter to product-looking images only, take top 6
  const filtered = [...imgUrls]
    .filter(u2 => /\.(jpg|jpeg|png|webp)/i.test(u2))
    .filter(u2 => !/\d{1,3}x\d{1,3}/.test(u2)) // skip tiny thumbnails
    .slice(0, 6);

  const labels = {
    ko: ['정면 촬영', '측면 촬영', '3/4 구도', '상단 뷰', '디테일', '라이프스타일'],
    en: ['Front View', 'Side View', '3/4 Angle', 'Top View', 'Detail', 'Lifestyle'],
  };
  const scores = [4.7, 4.0, 3.6, 3.3, 3.1, 2.9];

  const candidateImages = filtered.map((u2, i) => ({
    url: u2,
    label: labels.en[i] || `View ${i + 1}`,
    score: scores[i] || 2.5,
  }));

  // Fallback: at least one placeholder if nothing found
  if (candidateImages.length === 0) {
    candidateImages.push({ url: 'https://placehold.co/300x300/eee/555?text=Product', label: 'Product', score: 3.0 });
  }

  return { productName, productType, candidateImages };
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

const ok  = (body) => ({ statusCode: 200, headers: HEADERS, body: JSON.stringify(body) });
const err = (code, msg) => ({ statusCode: code, headers: HEADERS, body: JSON.stringify({ error: msg }) });
const cors204 = () => ({ statusCode: 204, headers: HEADERS, body: '' });
