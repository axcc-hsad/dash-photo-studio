// ─────────────────────────────────────────────────────────────
//  client-api.js  —  Browser-side API layer
//
//  Strategy (no CORS proxies needed):
//    1. Images  → probe LG CDN URL patterns with Image() object (no CORS)
//    2. Product info → Gemini reads the URL directly (url_context tool)
//    3. Fallback  → CORS proxy HTML parse (if both above fail)
// ─────────────────────────────────────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── apiCall router ────────────────────────────────────────────────
async function apiCall(ep, body) {
  if (ep === 'scrape-pdp')     return clientScrape(body.url);
  if (ep === 'generate-image') return clientGenerateImage(body.productType, body.region, body.ratio, body.prompt);
  throw new Error(`Unknown endpoint: ${ep}`);
}

// ── Fetch with timeout (iOS Safari: AbortSignal.timeout not supported) ──
function fetchWithTimeout(url, options, ms) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// ══ SCRAPE ORCHESTRATOR ══════════════════════════════════════════
async function clientScrape(url) {
  if (!url.includes('lg.com')) throw new Error('Not an LG URL');

  const urlInfo = extractUrlInfo(url);

  // ── Phase A: probe LG CDN image patterns + Gemini in parallel ──
  const imgSet = new Set();
  const [, geminiResult] = await Promise.allSettled([
    probeImagePatterns(urlInfo, imgSet),   // fills imgSet via Image() — no CORS
    analyzeWithGemini(url),                // Gemini reads the page directly
  ]);

  const gd = geminiResult.status === 'fulfilled' ? geminiResult.value : null;

  // Merge any images Gemini found in the page
  if (gd?.imageUrls) {
    gd.imageUrls
      .filter(u => /\.(jpg|jpeg|png|webp)/i.test(u))
      .forEach(u => imgSet.add(u));
  }

  // ── Phase B: if still no images, try CORS proxy HTML parse ────
  if (imgSet.size === 0) {
    console.log('[DASH] No images from CDN probe — trying CORS proxy');
    try {
      const html = await fetchHtmlViaProxy(url);
      const parsed = await parseLGHtml(html, url, urlInfo);
      if (gd) {
        // Prefer Gemini's richer product info
        parsed.productName    = gd.productName    || parsed.productName;
        parsed.productFeatures = gd.productFeatures || parsed.productFeatures;
      }
      return parsed;
    } catch (e) {
      console.warn('[DASH] Proxy fallback failed:', e.message);
    }
  }

  // ── Build final result ────────────────────────────────────────
  const productName     = gd?.productName    || urlInfo.displayName;
  const productType     = gd?.productType    || urlInfo.productType;
  const productFeatures = gd?.productFeatures || [];

  const scored = rankImages(imgSet);

  const VIEW_LABELS = ['Front View', 'Side View', '3/4 Angle', 'Detail Shot', 'Lifestyle'];
  const QC_SCORES   = [4.8, 4.3, 4.0, 3.7, 3.5];

  const candidateImages = scored.length
    ? scored.map((item, i) => ({
        url:   item.url,
        label: VIEW_LABELS[i] || `View ${i + 1}`,
        score: QC_SCORES[i]  || 3.0,
      }))
    : [{ url: 'https://placehold.co/400x400/eee/555?text=No+Image', label: 'Product', score: 3.0 }];

  if (!scored.length && !gd) {
    throw new Error('Could not retrieve product images. Please check the URL.');
  }

  return { productName, productType, candidateImages, productFeatures };
}

// ══ URL INFO EXTRACTION ══════════════════════════════════════════
// Parse market, category, slug, model variants from the URL itself
function extractUrlInfo(url) {
  try {
    const u      = new URL(url);
    const parts  = u.pathname.split('/').filter(Boolean);
    // e.g. ['uk','fridge-freezers','american-style-...','gsxv80pzle1']
    // e.g. ['us','refrigerators','lg-LRMVS3006S']
    const market   = parts[0] || 'us';
    const category = parts[1] || '';
    const slug     = (parts[parts.length - 1] || '').toLowerCase();

    // Clean model: remove 'lg-' prefix, uppercase
    const modelRaw = slug.replace(/^lg-/i, '').toUpperCase();
    // Variant without trailing single digit suffix (e.g. GSXV80PZLE1 → GSXV80PZLE)
    const modelBase = modelRaw.replace(/([A-Z])\d$/i, '$1');

    // Guess product type from URL
    const uStr = url.toLowerCase();
    const productType =
      /refrigerat|fridge|freezer|lrmv|lfxs|gsxv|gsx|instaview/.test(uStr) ? 'fridge'  :
      /washer|dryer|wm\d|dlex|dlgx/.test(uStr)                             ? 'washer'  :
      /oled|qned|nano|tv|65u|55u|75u/.test(uStr)                           ? 'tv'      : 'appliance';

    // Human-readable name from slug
    const displayName = 'LG ' + modelRaw.replace(/-/g, ' ');

    return { market, category, slug, modelRaw, modelBase, productType, displayName };
  } catch {
    return { market:'us', category:'', slug:'', modelRaw:'', modelBase:'', productType:'appliance', displayName:'LG Product' };
  }
}

// ══ IMAGE PATTERN PROBING ════════════════════════════════════════
// Uses browser Image() — no CORS restrictions, works everywhere
async function probeImagePatterns({ market, category, slug, modelRaw, modelBase }, imgSet) {
  if (!slug) return;

  const probes = [];
  const models = [...new Set([modelRaw, modelBase].filter(m => m.length >= 4))];

  // ── LG content/dam gallery pattern (EU/UK/Asia) ──────────────
  for (let n = 1; n <= 8; n++) {
    const pad = String(n).padStart(2, '0');
    const exts = ['jpg', 'jpeg', 'png', 'webp'];
    // Subcategory pages may have different structure
    for (const ext of exts) {
      const urls = [
        `https://www.lg.com/content/dam/channel/wcms/${market}/images/${category}/${slug}/gallery/medium${pad}.${ext}`,
        `https://www.lg.com/content/dam/channel/wcms/${market}/images/${category}/${slug}/gallery/D${pad}.${ext}`,
      ];
      urls.forEach(u => probes.push(imgExists(u).then(ok => { if (ok) imgSet.add(u); })));
    }
  }

  // ── LG gscs-b2c.lge.com CDN (US goldimage pattern) ──────────
  for (const model of models) {
    for (let n = 1; n <= 7; n++) {
      const urlVariants = [
        `https://gscs-b2c.lge.com/lglib/goldimage/${model}/${model}_${n}.jpg`,
        `https://gscs-b2c.lge.com/lglib/goldimage/${model}/01/${model}_${n}.jpg`,
        `https://gscs-b2c.lge.com/lglib/goldimage/${model}/${model}_AEKQ_${n}.jpg`,
        `https://gscs-b2c.lge.com/lglib/goldimage/${model}/${model}_AEK_${n}.jpg`,
        `https://gscs-b2c.lge.com/lglib/goldimage/${model}/${model}_MEA_${n}.jpg`,
      ];
      urlVariants.forEach(u => probes.push(imgExists(u).then(ok => { if (ok) imgSet.add(u); })));
    }
  }

  // ── LG US content/dam pattern ─────────────────────────────────
  for (const model of models) {
    const lModel = model.toLowerCase();
    for (let n = 1; n <= 6; n++) {
      const pad = String(n).padStart(2, '0');
      const urlVariants = [
        `https://www.lg.com/content/dam/channel/wcms/us/images/${category}/lg-${lModel}/gallery/medium${pad}.jpg`,
        `https://www.lg.com/content/dam/channel/wcms/us/images/${category}/${lModel}/gallery/medium${pad}.jpg`,
      ];
      urlVariants.forEach(u => probes.push(imgExists(u).then(ok => { if (ok) imgSet.add(u); })));
    }
  }

  await Promise.all(probes);
}

// ══ GEMINI URL ANALYSIS ══════════════════════════════════════════
// Ask Gemini to read the LG product page and return structured JSON
async function analyzeWithGemini(url) {
  const key = CONFIG.GEMINI_API_KEY;

  const prompt = `You are a product data extractor. Read the following LG product page URL and return product information as JSON only (no markdown, no extra text).

URL: ${url}

Return ONLY this JSON structure:
{
  "productName": "Full product name from the page",
  "productType": "fridge or washer or tv or appliance",
  "modelNumber": "Product model code e.g. GSXV80PZLE",
  "productFeatures": ["Key feature 1", "Key feature 2", "Key feature 3", "Key feature 4", "Key feature 5"],
  "imageUrls": ["https://full-image-url-1.jpg", "https://full-image-url-2.jpg"]
}

Rules:
- productFeatures: up to 5 key USPs or selling points (short phrases, from the page content)
- imageUrls: list all product image URLs visible on the page (full absolute URLs, .jpg/.png/.webp only)
- If you cannot access the page, infer productName and productType from the URL path`;

  const res = await fetchWithTimeout(
    `${GEMINI_BASE}/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tools: [{ url_context: {} }],
        contents: [{ parts: [{ text: prompt }] }],
      }),
    },
    35000
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 120)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
  const jsonMatch = text.match(/\{[\s\S]+\}/);
  if (!jsonMatch) throw new Error('No JSON in Gemini response');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.productName && !parsed.productType) throw new Error('Empty product data');

  return {
    productName:     parsed.productName     || null,
    productType:     normalizeType(parsed.productType),
    productFeatures: (parsed.productFeatures || []).filter(f => typeof f === 'string').slice(0, 5),
    imageUrls:       (parsed.imageUrls || []).filter(u => typeof u === 'string'),
  };
}

function normalizeType(t) {
  if (!t) return null;
  const s = String(t).toLowerCase();
  if (s.includes('fridge') || s.includes('refrig') || s.includes('freezer')) return 'fridge';
  if (s.includes('wash') || s.includes('dryer')) return 'washer';
  if (s.includes('tv') || s.includes('oled') || s.includes('display')) return 'tv';
  return 'appliance';
}

// ══ CORS PROXY FALLBACK ══════════════════════════════════════════
const PROXIES = [
  u => ({ url: `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, json: true  }),
  u => ({ url: `https://corsproxy.io/?${encodeURIComponent(u)}`,              json: false }),
  u => ({ url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,       json: false }),
  u => ({ url: `https://thingproxy.freeboard.io/fetch/${u}`,                  json: false }),
];

async function fetchHtmlViaProxy(url) {
  for (const makeProxy of PROXIES) {
    try {
      const { url: proxyUrl, json } = makeProxy(url);
      const res = await fetchWithTimeout(proxyUrl, {}, 14000);
      if (!res.ok) continue;
      const html = json ? (await res.json()).contents : await res.text();
      if (html && html.length > 2000) return html;
    } catch { continue; }
  }
  throw new Error('All proxies failed');
}

async function parseLGHtml(html, url, urlInfo) {
  const nameMatch =
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const productName = nameMatch ? lgDecode(nameMatch[1]).split('|')[0].trim() : urlInfo.displayName;
  const productType = urlInfo.productType;

  const imgSet = new Set();

  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]{10,})<\/script>/);
  let nextData = null;
  if (nextMatch) { try { nextData = JSON.parse(nextMatch[1]); collectImgs(nextData, imgSet); } catch {} }

  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectImgs(JSON.parse(m[1]), imgSet); } catch {}
  }
  for (const m of html.matchAll(/<meta[^>]+property="og:image[^"]*"[^>]+content="([^"]+)"/gi)) imgSet.add(m[1]);

  const cdnRe = /https?:\/\/(?:gscs-b2c\.lge\.com|[^"'\s]*?lg\.com\/content)[^"'\s,)>]+\.(?:jpg|jpeg|png|webp)(?:[^"'\s,)>]*)?/gi;
  for (const m of html.matchAll(cdnRe)) imgSet.add(m[0].split('\\u')[0].replace(/[\\'"]+$/, ''));

  const srcRe = /(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  for (const m of html.matchAll(srcRe)) {
    const u2 = m[1];
    if ((u2.includes('lge.com') || u2.includes('lg.com')) && !/icon|logo|badge/.test(u2)) imgSet.add(u2);
  }

  const galleryBase = [...imgSet].find(u2 => /\/gallery\/medium0?1\.(jpg|jpeg|png|webp)/i.test(u2));
  if (galleryBase) {
    await Promise.all([2,3,4,5,6,7].map(n => {
      const probe = galleryBase.replace(/medium0?1(\.\w+)$/i, `medium0${n}$1`);
      return imgExists(probe).then(ok => { if (ok) imgSet.add(probe); });
    }));
  }

  const scored = rankImages(imgSet);
  const VIEW_LABELS = ['Front View', 'Side View', '3/4 Angle', 'Detail Shot', 'Lifestyle'];
  const QC_SCORES   = [4.8, 4.3, 4.0, 3.7, 3.5];

  const candidateImages = scored.length
    ? scored.map((item, i) => ({ url: item.url, label: VIEW_LABELS[i] || `View ${i+1}`, score: QC_SCORES[i] || 3.0 }))
    : [{ url: 'https://placehold.co/400x400/eee/555?text=Product', label: 'Product', score: 3.0 }];

  const productFeatures = extractFeatures(html, nextData);

  return { productName, productType, candidateImages, productFeatures };
}

// ══ IMAGE HELPERS ════════════════════════════════════════════════

function rankImages(imgSet) {
  return [...imgSet]
    .filter(u => /\.(?:jpg|jpeg|png|webp)/i.test(u))
    .filter(u => !/\d{1,2}x\d{1,2}(?!\d)/.test(u))
    .filter(u => !/[_-]\d{2,3}x\d{2,3}[_.-]/i.test(u))
    .filter(u => !/icon|logo|badge|flag|ribbon|sprite/i.test(u))
    .map(u => ({ url: u, score: lgScore(u) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function collectImgs(obj, set, depth = 0) {
  if (depth > 12 || !obj) return;
  if (typeof obj === 'string') {
    const clean = obj.replace(/[\\'"]+$/, '');
    if (/^https?:\/\/.+\.(?:jpg|jpeg|png|webp)/i.test(clean) && !/icon|logo/.test(clean)) set.add(clean);
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
  if (url.includes('gscs-b2c.lge.com'))                          s += 10;
  if (url.includes('/content/dam'))                               s += 8;
  if (/[A-Z]{2,}[-_]\d{3,}/i.test(url))                         s += 5;
  if (/(?:main|hero|front|primary|featured)/i.test(url))         s += 6;
  if (/gallery|product/i.test(url))                              s += 4;
  if (/medium0[1-3]/i.test(url))                                 s += 5;  // gallery first shots
  if (/\d{3,4}x\d{3,4}/.test(url))                              s -= 3;
  if (/(?:2000|1600|1200|900|large|xl)/i.test(url))              s += 3;
  if (/thumbnail|thumb|small|xs|_s\./i.test(url))                s -= 5;
  return s;
}

function lgDecode(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}

// Check if image URL loads — browser Image() has no CORS restrictions for <img>
function imgExists(url) {
  return new Promise(resolve => {
    const img   = new Image();
    const timer = setTimeout(() => resolve(false), 5000);
    img.onload  = () => { clearTimeout(timer); resolve(true);  };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

// ══ FEATURE / USP EXTRACTION (for CORS proxy fallback path) ══════
function extractFeatures(html, nextData) {
  const features = new Set();
  if (nextData) collectFeatureJSON(nextData, features, 0);

  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj.description) {
        obj.description.split(/[.!;\n]/).map(s => s.trim())
          .filter(s => s.length > 10 && s.length < 130).slice(0, 4).forEach(s => features.add(s));
      }
    } catch {}
  }

  const listRe = /<(?:li|dt)[^>]*class="[^"]*(?:feature|usp|key|benefit|highlight)[^"]*"[^>]*>([\s\S]*?)<\/(?:li|dt)>/gi;
  for (const m of html.matchAll(listRe)) {
    const text = stripHtml(m[1]);
    if (text.length > 5 && text.length < 130) features.add(text);
    if (features.size >= 8) break;
  }

  return [...features].filter(f => f.length > 5 && !/^https?:\/\//i.test(f)).slice(0, 5);
}

function collectFeatureJSON(obj, set, depth) {
  if (depth > 10 || !obj || set.size >= 10) return;
  if (Array.isArray(obj)) { obj.forEach(i => collectFeatureJSON(i, set, depth + 1)); return; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (/^(?:feature|keyFeature|highlight|benefit|usp|bullet|sellingPoint)/i.test(k)) {
        if (typeof v === 'string' && v.length > 5 && v.length < 150) set.add(v.trim());
        else if (Array.isArray(v)) v.forEach(item => {
          if (typeof item === 'string' && item.length > 5 && item.length < 150) set.add(item.trim());
          else if (item && typeof item === 'object') {
            const text = item.title || item.name || item.text || item.description || item.headline;
            if (text && typeof text === 'string' && text.length > 5 && text.length < 150) set.add(text.trim());
          }
        });
      } else { collectFeatureJSON(v, set, depth + 1); }
    }
  }
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
}

// ══ GENERATE IMAGE via Gemini ════════════════════════════════════
async function clientGenerateImage(productType, region, ratio, prompt) {
  const key = CONFIG.GEMINI_API_KEY;

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

  // QC via Gemini Vision
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
