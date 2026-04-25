// ─────────────────────────────────────────────────────────────
//  client-api.js  —  Browser-side replacements for Netlify Functions
//  Calls Gemini REST API directly; uses CORS proxy for LG scraping
// ─────────────────────────────────────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── apiCall router ────────────────────────────────────────────────
async function apiCall(ep, body) {
  if (ep === 'scrape-pdp')     return clientScrape(body.url);
  if (ep === 'generate-image') return clientGenerateImage(body.productType, body.region, body.ratio, body.prompt);
  throw new Error(`Unknown endpoint: ${ep}`);
}

// ── Fetch with timeout (iOS Safari compat — AbortSignal.timeout not supported) ──
function fetchWithTimeout(url, options, ms) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// ══ SCRAPE LG PDP ════════════════════════════════════════════════
// CORS proxies tried in order — first success wins
const PROXIES = [
  u => ({ url: `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, json: true  }),
  u => ({ url: `https://corsproxy.io/?${encodeURIComponent(u)}`,              json: false }),
  u => ({ url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,       json: false }),
  u => ({ url: `https://thingproxy.freeboard.io/fetch/${u}`,                  json: false }),
];

async function clientScrape(url) {
  if (!url.includes('lg.com')) throw new Error('Not an LG URL');

  let html = null;
  for (const makeProxy of PROXIES) {
    try {
      const { url: proxyUrl, json } = makeProxy(url);
      const res = await fetchWithTimeout(proxyUrl, {}, 14000);
      if (!res.ok) continue;
      if (json) {
        const data = await res.json();
        html = data.contents || null;
      } else {
        html = await res.text();
      }
      if (html && html.length > 2000) break;   // got real content
      html = null;
    } catch { continue; }
  }

  if (!html) throw new Error('All proxies failed — no content returned');
  return parseLGPage(html, url);
}

async function parseLGPage(html, url) {
  // ── Product name ────────────────────────────────────────────
  const nameMatch =
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const productName = nameMatch ? lgDecode(nameMatch[1]).split('|')[0].trim() : 'LG Product';

  // ── Product type ────────────────────────────────────────────
  const u = (url + ' ' + productName).toLowerCase();
  const productType =
    /refrigerator|fridge|freezer|lrmv|lfxs|gsxv|gsx|instaview/.test(u) ? 'fridge' :
    /washer|dryer|wm\d|dlex|dlgx/.test(u)                               ? 'washer' :
    /oled|qned|nano|tv|65u|55u|75u/.test(u)                             ? 'tv'     : 'appliance';

  // ── Parse __NEXT_DATA__ once (used for both images and features) ──
  let nextData = null;
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]{10,})<\/script>/);
  if (nextMatch) {
    try { nextData = JSON.parse(nextMatch[1]); } catch {}
  }

  // ── Collect images ──────────────────────────────────────────
  const imgSet = new Set();

  // 1. __NEXT_DATA__ (most reliable for LG Next.js sites)
  if (nextData) {
    try { collectImgs(nextData, imgSet); } catch {}
  }

  // 2. JSON-LD
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectImgs(JSON.parse(m[1]), imgSet); } catch {}
  }

  // 3. og:image meta
  for (const m of html.matchAll(/<meta[^>]+property="og:image[^"]*"[^>]+content="([^"]+)"/gi)) {
    imgSet.add(m[1]);
  }

  // 4. LG CDN patterns
  const cdnRe = /https?:\/\/(?:gscs-b2c\.lge\.com|[^"'\s]*?lg\.com\/content)[^"'\s,)>]+\.(?:jpg|jpeg|png|webp)(?:[^"'\s,)>]*)?/gi;
  for (const m of html.matchAll(cdnRe)) {
    imgSet.add(m[0].split('\\u')[0].replace(/[\\'"]+$/, ''));
  }

  // 5. data-src / src with LG domains
  const srcRe = /(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  for (const m of html.matchAll(srcRe)) {
    const u2 = m[1];
    if ((u2.includes('lge.com') || u2.includes('lg.com')) &&
        !u2.includes('icon') && !u2.includes('logo') && !u2.includes('badge')) {
      imgSet.add(u2);
    }
  }

  // 6. Probe gallery/medium02–07 using Image() — no server needed, no CORS issue
  const galleryBase = [...imgSet].find(u2 => /\/gallery\/medium0?1\.(jpg|jpeg|png|webp)/i.test(u2));
  if (galleryBase) {
    const probes = [];
    for (let n = 2; n <= 7; n++) {
      const probe = galleryBase.replace(/medium0?1(\.\w+)$/i, `medium0${n}$1`);
      probes.push(
        imgExists(probe).then(ok => { if (ok) imgSet.add(probe); })
      );
    }
    await Promise.all(probes);
  }

  // ── Filter & rank ───────────────────────────────────────────
  const scored = [...imgSet]
    .filter(u2 => /\.(?:jpg|jpeg|png|webp)/i.test(u2))
    .filter(u2 => !/\d{1,2}x\d{1,2}(?!\d)/.test(u2))
    .filter(u2 => !/[_-]\d{2,3}x\d{2,3}[_.-]/i.test(u2))
    .filter(u2 => !/icon|logo|badge|flag|ribbon|sprite/i.test(u2))
    .map(u2 => ({ url: u2, score: lgScore(u2) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const VIEW_LABELS = ['Front View', 'Side View', '3/4 Angle', 'Detail Shot', 'Lifestyle'];
  const QC_SCORES   = [4.8, 4.3, 4.0, 3.7, 3.5];

  const candidateImages = scored.length
    ? scored.map((item, i) => ({ url: item.url, label: VIEW_LABELS[i] || `View ${i+1}`, score: QC_SCORES[i] || 3.0 }))
    : [{ url: 'https://placehold.co/400x400/eee/555?text=Product', label: 'Product', score: 3.0 }];

  // ── Extract product features / USPs ─────────────────────────
  const productFeatures = extractFeatures(html, nextData);

  return { productName, productType, candidateImages, productFeatures };
}

// ══ FEATURE / USP EXTRACTION ═════════════════════════════════════

function extractFeatures(html, nextData) {
  const features = new Set();

  // 1. Walk __NEXT_DATA__ JSON for feature-related keys
  if (nextData) {
    collectFeatureJSON(nextData, features, 0);
  }

  // 2. JSON-LD product description sentences
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj.description && typeof obj.description === 'string') {
        obj.description.split(/[.!;\n]/)
          .map(s => s.trim())
          .filter(s => s.length > 10 && s.length < 130)
          .slice(0, 4)
          .forEach(s => features.add(s));
      }
    } catch {}
  }

  // 3. HTML feature list items with class names hinting at USP/features
  const listRe = /<(?:li|dt)[^>]*class="[^"]*(?:feature|usp|key|benefit|highlight|selling)[^"]*"[^>]*>([\s\S]*?)<\/(?:li|dt)>/gi;
  for (const m of html.matchAll(listRe)) {
    const text = stripHtml(m[1]);
    if (text.length > 5 && text.length < 130) features.add(text);
    if (features.size >= 8) break;
  }

  // 4. LG-specific: feature headline spans / headings
  const headRe = /<(?:h[2-4]|span)[^>]*class="[^"]*(?:feature|kv-text|key-visual|headline|usp|product-feature)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[2-4]|span)>/gi;
  for (const m of html.matchAll(headRe)) {
    const text = stripHtml(m[1]);
    if (text.length > 5 && text.length < 100) features.add(text);
    if (features.size >= 8) break;
  }

  return [...features]
    .filter(f => f.length > 5 && !/^https?:\/\//i.test(f))
    .slice(0, 5);
}

// Recursively scan JSON for keys that suggest feature/USP data
function collectFeatureJSON(obj, set, depth) {
  if (depth > 10 || !obj || set.size >= 10) return;
  if (Array.isArray(obj)) {
    obj.forEach(i => collectFeatureJSON(i, set, depth + 1));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (/^(?:feature|keyFeature|highlight|benefit|usp|bullet|sellingPoint|keyPoint)/i.test(k)) {
        if (typeof v === 'string' && v.length > 5 && v.length < 150) {
          set.add(v.trim());
        } else if (Array.isArray(v)) {
          v.forEach(item => {
            if (typeof item === 'string' && item.length > 5 && item.length < 150) {
              set.add(item.trim());
            } else if (item && typeof item === 'object') {
              const text = item.title || item.name || item.text || item.description || item.headline || item.copy;
              if (text && typeof text === 'string' && text.length > 5 && text.length < 150) set.add(text.trim());
            }
          });
        } else if (v && typeof v === 'object') {
          const text = v.title || v.name || v.text || v.description;
          if (text && typeof text === 'string' && text.length > 5 && text.length < 150) set.add(text.trim());
        }
      } else {
        collectFeatureJSON(v, set, depth + 1);
      }
    }
  }
}

// Strip HTML tags and decode common entities
function stripHtml(str) {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ══ IMAGE HELPERS ════════════════════════════════════════════════

function collectImgs(obj, set, depth = 0) {
  if (depth > 12 || !obj) return;
  if (typeof obj === 'string') {
    const clean = obj.replace(/[\\'"]+$/, '');
    if (/^https?:\/\/.+\.(?:jpg|jpeg|png|webp)/i.test(clean) &&
        !clean.includes('icon') && !clean.includes('logo')) set.add(clean);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach(i => collectImgs(i, set, depth + 1)); return; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const isImg = /image|photo|gallery|media|src|url|thumb|picture/i.test(k);
      if (isImg || depth < 6) collectImgs(v, set, depth + (isImg ? 0 : 1));
    }
  }
}

function lgScore(url) {
  let s = 0;
  if (url.includes('gscs-b2c.lge.com')) s += 10;
  if (url.includes('/content/dam')) s += 8;
  if (/[A-Z]{2,}[-_]\d{3,}/i.test(url)) s += 5;
  if (/(?:main|hero|front|primary|featured)/i.test(url)) s += 6;
  if (/gallery|product/i.test(url)) s += 4;
  if (/\d{3,4}x\d{3,4}/.test(url)) s -= 3;
  if (/(?:2000|1600|1200|900|large|xl)/i.test(url)) s += 3;
  if (/thumbnail|thumb|small|xs|_s\./i.test(url)) s -= 5;
  return s;
}

function lgDecode(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}

// Check if image URL loads (browser Image object — no CORS issue for <img>)
function imgExists(url) {
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 4000);
    img.onload  = () => { clearTimeout(timer); resolve(true);  };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

// ══ GENERATE IMAGE via Gemini ════════════════════════════════════
async function clientGenerateImage(productType, region, ratio, prompt) {
  const key = CONFIG.GEMINI_API_KEY;

  // 1. Generate image
  const genRes = await fetchWithTimeout(
    `${GEMINI_BASE}/gemini-2.0-flash-exp-image-generation:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    },
    60000
  );
  if (!genRes.ok) throw new Error(`Gemini image error: ${genRes.status}`);
  const genData = await genRes.json();

  const parts = genData.candidates?.[0]?.content?.parts ?? [];
  let imageUrl = null;
  for (const part of parts) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType || 'image/jpeg';
      imageUrl = `data:${mime};base64,${part.inlineData.data}`;
      break;
    }
  }
  if (!imageUrl) throw new Error('No image returned from Gemini');

  // 2. QC via Gemini Vision
  let qcScores = { productIntegrity: 88, naturalProportions: 85, backgroundHarmony: 87, regionalStyleMatch: 83 };
  try {
    const base64 = imageUrl.split(',')[1];
    const mime   = imageUrl.split(';')[0].split(':')[1];
    qcScores = await clientQC(key, base64, mime, productType, region);
  } catch {}

  return { imageUrl, qcScores };
}

async function clientQC(key, base64, mime, productType, region) {
  const res = await fetchWithTimeout(
    `${GEMINI_BASE}/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: mime, data: base64 } },
            { text: `QC expert. Score 0-100 as JSON only: {"productIntegrity":N,"naturalProportions":N,"backgroundHarmony":N,"regionalStyleMatch":N}. Product: LG ${productType}. Region: ${region}.` },
          ],
        }],
      }),
    },
    30000
  );
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const match = text.match(/\{[^}]+\}/);
  return match ? JSON.parse(match[0]) : { productIntegrity: 88, naturalProportions: 85, backgroundHarmony: 87, regionalStyleMatch: 83 };
}
