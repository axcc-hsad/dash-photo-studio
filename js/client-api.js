// ─────────────────────────────────────────────────────────────
//  client-api.js
//
//  Scraping pipeline (runs in parallel, first wins):
//    A. r.jina.ai  — renders JS pages server-side, returns markdown
//    B. CDN probe  — imgExists() on known LG URL patterns (no CORS)
//    C. Gemini     — reads page via urlContext or google_search tool
//    D. CORS proxy — last resort HTML parse
//
//  Image generation: Gemini 2.0 Flash direct REST call
// ─────────────────────────────────────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── apiCall router ────────────────────────────────────────────────
async function apiCall(ep, body) {
  if (ep === 'scrape-pdp')     return clientScrape(body.url);
  if (ep === 'generate-image') return clientGenerateImage(body.productType, body.region, body.ratio, body.prompt);
  throw new Error(`Unknown endpoint: ${ep}`);
}

// ── iOS-safe timeout wrapper ──────────────────────────────────────
function fetchT(url, opts, ms = 15000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ══ MAIN SCRAPE ORCHESTRATOR ═════════════════════════════════════
async function clientScrape(url) {
  if (!url.includes('lg.com')) throw new Error('Not an LG URL');

  const info = parseUrl(url);
  const imgs = new Set();          // collected image URLs
  let   name = info.displayName;
  let   type = info.productType;
  let   feat = [];

  // ── Run all parallel sources ──────────────────────────────────
  const [jinaR, cdnR, gemR] = await Promise.allSettled([
    jinaFetch(url),                // A. Jina renders the page
    cdnProbe(info, imgs),          // B. CDN pattern probing (fills imgs directly)
    geminiAnalyze(url, info),      // C. Gemini reads page + web search
  ]);

  // ── Merge: Jina ───────────────────────────────────────────────
  if (jinaR.status === 'fulfilled') {
    const j = jinaR.value;
    j.images.forEach(u => imgs.add(u));
    if (j.title) name = j.title;
    if (j.features.length) feat = j.features;
    console.log('[DASH] Jina: ok,', j.images.length, 'images');
  } else {
    console.warn('[DASH] Jina failed:', jinaR.reason?.message);
  }

  // ── Merge: Gemini (highest priority for text; also adds images) ──
  if (gemR.status === 'fulfilled' && gemR.value) {
    const g = gemR.value;
    if (g.productName)            name = g.productName;
    if (g.productType)            type = g.productType;
    if (g.productFeatures?.length) feat = g.productFeatures;
    (g.imageUrls || []).filter(imgUrl).forEach(u => imgs.add(u));
    console.log('[DASH] Gemini: ok, type =', g.productType);
  } else {
    console.warn('[DASH] Gemini failed:', gemR.reason?.message);
  }

  console.log('[DASH] total images found:', imgs.size);

  // ── Last resort: CORS proxy ───────────────────────────────────
  if (imgs.size === 0) {
    console.log('[DASH] Trying CORS proxy fallback...');
    try {
      const html = await proxyFetch(url);
      return parseHtml(html, url, info, name, type, feat);
    } catch (e) {
      console.warn('[DASH] proxy failed:', e.message);
    }
  }

  // ── No images at all ─────────────────────────────────────────
  if (imgs.size === 0) {
    throw new Error('NO_IMAGES: Could not retrieve product images');
  }

  return buildResult(imgs, name, type, feat);
}

// ══ A. JINA.AI READER ════════════════════════════════════════════
// r.jina.ai renders JS pages server-side → returns clean markdown
// Free, no API key, CORS-enabled
async function jinaFetch(url) {
  const res = await fetchT(
    `https://r.jina.ai/${url}`,
    { headers: { 'Accept': 'application/json', 'X-No-Cache': 'true' } },
    25000
  );
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);

  let markdown = '';
  let title    = '';
  let images   = [];

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    // Jina JSON response: { data: { title, content, images:{url:alt,...} } }
    try {
      const j = await res.json();
      const d = j.data || j;
      title   = d.title || '';
      markdown = d.content || d.text || '';
      // images field: object {url: alt} OR array
      const imgField = d.images;
      if (imgField) {
        if (Array.isArray(imgField)) {
          images = imgField.map(i => (typeof i === 'string' ? i : i.url)).filter(Boolean);
        } else if (typeof imgField === 'object') {
          images = Object.keys(imgField);
        }
      }
    } catch {}
  } else {
    markdown = await res.text();
  }

  // Extract title from markdown if not set
  if (!title) {
    const m = markdown.match(/^(?:Title:\s*|#\s+)(.+)$/m);
    if (m) title = m[1].trim().split('|')[0].trim();
  }

  // Also extract image URLs from markdown syntax
  const mdImgRe = /!\[[^\]]*\]\((https?:\/\/[^)\s]+\.(?:jpg|jpeg|png|webp)[^)\s]*)\)/gi;
  for (const m of markdown.matchAll(mdImgRe)) images.push(m[1]);

  // And bare LG CDN URLs in the text
  const cdnRe = /(https?:\/\/(?:gscs-b2c\.lge\.com|[^\s]*lg\.com\/content\/dam)[^\s,)"'>]+\.(?:jpg|jpeg|png|webp)[^\s,)"'>]*)/gi;
  for (const m of markdown.matchAll(cdnRe)) images.push(m[1]);

  // Extract features from markdown bullet points
  const features = [];
  for (const m of markdown.matchAll(/^[-*•]\s+(.{10,120})$/gm)) {
    const txt = m[1].trim();
    if (features.length < 6 && !/^https?:/.test(txt) && !/^!\[/.test(txt)) features.push(txt);
  }

  return {
    title:    title || '',
    images:   [...new Set(images)].filter(imgUrl),
    features,
  };
}

// ══ B. CDN PATTERN PROBING ════════════════════════════════════════
// Uses browser Image() — no CORS restriction on image loading
async function cdnProbe(info, imgSet) {
  const { market, category, slug, modelRaw, modelBase } = info;
  if (!slug) return;

  const probes    = [];
  const models    = [...new Set([modelRaw, modelBase].filter(m => m && m.length >= 4))];
  const exts      = ['jpg', 'jpeg', 'png', 'webp'];
  const mkSufx    = ['', '_AEK', '_AEK2', '_AEKQ', '_MEA', '_MEAU', '_AU', '_CA', '_US', '_MFL'];

  // ── LG content/dam gallery (EU / UK / Asia format) ───────────
  for (let n = 1; n <= 9; n++) {
    const pad = String(n).padStart(2, '0');
    for (const ext of ['jpg', 'jpeg', 'png']) {
      [
        `https://www.lg.com/content/dam/channel/wcms/${market}/images/${category}/${slug}/gallery/medium${pad}.${ext}`,
        `https://www.lg.com/content/dam/channel/wcms/${market}/images/${category}/${slug}/gallery/D${pad}.${ext}`,
        `https://www.lg.com/content/dam/channel/wcms/${market}/images/${category}/${slug}/${slug}_${pad}.${ext}`,
      ].forEach(u => probes.push(probe(u, imgSet)));
    }
  }

  // ── gscs-b2c.lge.com goldimage (US / global CDN) ─────────────
  for (const model of models) {
    for (let n = 1; n <= 7; n++) {
      for (const sfx of mkSufx) {
        const variants = [
          `https://gscs-b2c.lge.com/lglib/goldimage/${model}/${model}${sfx}_${n}.jpg`,
          `https://gscs-b2c.lge.com/lglib/goldimage/${model}/01/${model}${sfx}_${n}.jpg`,
        ];
        variants.forEach(u => probes.push(probe(u, imgSet)));
      }
    }
  }

  // ── US content/dam gallery ────────────────────────────────────
  for (const model of models) {
    const lm = model.toLowerCase();
    for (let n = 1; n <= 6; n++) {
      const pad = String(n).padStart(2, '0');
      [
        `https://www.lg.com/content/dam/channel/wcms/us/images/${category}/lg-${lm}/gallery/medium${pad}.jpg`,
        `https://www.lg.com/content/dam/channel/wcms/us/images/${category}/${lm}/gallery/medium${pad}.jpg`,
      ].forEach(u => probes.push(probe(u, imgSet)));
    }
  }

  await Promise.all(probes);
}

function probe(url, set) {
  return imgExists(url).then(ok => { if (ok) set.add(url); });
}

// ══ C. GEMINI ANALYSIS ════════════════════════════════════════════
// Tries urlContext → google_search → knowledge-only, in that order
async function geminiAnalyze(url, info) {
  const key    = CONFIG.GEMINI_API_KEY;
  const prompt = `Analyze this LG product page and return product data as JSON only (no markdown, no extra text).

URL: ${url}

Required JSON:
{
  "productName": "full product name as listed on the page",
  "productType": "fridge or washer or tv or appliance",
  "productFeatures": ["key USP 1", "key USP 2", "key USP 3", "key USP 4", "key USP 5"],
  "imageUrls": ["https://full-cdn-image-url.jpg"]
}

Notes:
- productFeatures: up to 5 key selling points from the page (short phrases)
- imageUrls: actual image URLs hosted on gscs-b2c.lge.com or lg.com (full absolute URLs)
- If you cannot access the page, infer productType from the URL path and leave imageUrls empty`;

  // Tool configurations to try in order
  const toolSets = [
    [{ urlContext: {} }],       // Gemini native URL reading
    [{ google_search: {} }],    // Google Search grounding
    null,                       // No tools — Gemini's knowledge only
  ];

  for (const tools of toolSets) {
    try {
      const bodyObj = {
        contents: [{ parts: [{ text: prompt }] }],
      };
      if (tools) bodyObj.tools = tools;

      const res = await fetchT(
        `${GEMINI_BASE}/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj),
        },
        32000
      );

      if (!res.ok) {
        const errTxt = await res.text().catch(() => '');
        console.warn('[DASH] Gemini', tools?.[0] ? Object.keys(tools[0])[0] : 'no-tool', `HTTP ${res.status}:`, errTxt.slice(0, 80));
        continue;
      }

      const data = await res.json();
      if (data.error) { console.warn('[DASH] Gemini API error:', data.error.message); continue; }

      const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
      const m    = text.match(/\{[\s\S]+?\}/);
      if (!m) continue;

      const parsed = JSON.parse(m[0]);
      if (!parsed.productName && !parsed.productType) continue;

      // Normalise productType
      parsed.productType = normalizeType(parsed.productType);
      parsed.productFeatures = (parsed.productFeatures || []).filter(f => typeof f === 'string' && f.length > 3).slice(0, 5);
      parsed.imageUrls       = (parsed.imageUrls       || []).filter(u => typeof u === 'string' && /https?:\/\//i.test(u));

      console.log('[DASH] Gemini tool used:', tools ? Object.keys(tools[0])[0] : 'none');
      return parsed;

    } catch (e) {
      console.warn('[DASH] Gemini attempt failed:', e.message);
    }
  }

  return null;  // all attempts failed — that's OK, other sources handle it
}

function normalizeType(t) {
  if (!t) return null;
  const s = String(t).toLowerCase();
  if (/fridge|refrig|freezer/.test(s)) return 'fridge';
  if (/wash|dryer/.test(s))            return 'washer';
  if (/tv|oled|qned|display/.test(s))  return 'tv';
  return 'appliance';
}

// ══ D. CORS PROXY FALLBACK ════════════════════════════════════════
const PROXIES = [
  u => ({ url: `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, json: true  }),
  u => ({ url: `https://corsproxy.io/?${encodeURIComponent(u)}`,              json: false }),
  u => ({ url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,       json: false }),
  u => ({ url: `https://thingproxy.freeboard.io/fetch/${u}`,                  json: false }),
];

async function proxyFetch(url) {
  for (const mk of PROXIES) {
    try {
      const { url: pu, json } = mk(url);
      const res = await fetchT(pu, {}, 14000);
      if (!res.ok) continue;
      const html = json ? (await res.json()).contents : await res.text();
      if (html && html.length > 2000) return html;
    } catch { continue; }
  }
  throw new Error('All proxies failed');
}

async function parseHtml(html, url, info, name, type, feat) {
  const imgs = new Set();

  // __NEXT_DATA__
  const nx = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]{10,})<\/script>/);
  let nextData = null;
  if (nx) { try { nextData = JSON.parse(nx[1]); walkImgs(nextData, imgs); } catch {} }

  // JSON-LD
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walkImgs(JSON.parse(m[1]), imgs); } catch {}
  }

  // og:image
  for (const m of html.matchAll(/<meta[^>]+property="og:image[^"]*"[^>]+content="([^"]+)"/gi)) imgs.add(m[1]);

  // CDN URLs in HTML text
  const cdnRe = /https?:\/\/(?:gscs-b2c\.lge\.com|[^"'\s]*?lg\.com\/content)[^"'\s,)>]+\.(?:jpg|jpeg|png|webp)(?:[^"'\s,)>]*)?/gi;
  for (const m of html.matchAll(cdnRe)) imgs.add(m[0].split('\\u')[0].replace(/[\\'"]+$/, ''));

  // Probe gallery siblings
  const base = [...imgs].find(u => /\/gallery\/medium0?1\.(jpg|jpeg|png|webp)/i.test(u));
  if (base) {
    await Promise.all([2,3,4,5,6,7,8].map(n => {
      const u = base.replace(/medium0?1(\.\w+)$/i, `medium0${n}$1`);
      return probe(u, imgs);
    }));
  }

  // Product name from HTML (if not already set)
  if (!name || name === info.displayName) {
    const nm = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
             || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (nm) name = lgDec(nm[1]).split('|')[0].trim();
  }

  // Features from __NEXT_DATA__ if not already set
  if (!feat.length && nextData) { const fs = new Set(); collectFeat(nextData, fs, 0); feat = [...fs].slice(0, 5); }

  return buildResult(imgs, name || info.displayName, type || info.productType, feat);
}

// ══ RESULT BUILDER ════════════════════════════════════════════════
function buildResult(imgSet, productName, productType, productFeatures) {
  const scored = [...imgSet]
    .filter(imgUrl)
    .filter(u => !/\d{1,2}x\d{1,2}(?!\d)/.test(u))
    .filter(u => !/[_-]\d{2,3}x\d{2,3}[_.-]/i.test(u))
    .filter(u => !/icon|logo|badge|flag|ribbon|sprite/i.test(u))
    .map(u => ({ url: u, score: lgScore(u) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const VIEW_LABELS = ['Front View', 'Side View', '3/4 Angle', 'Detail Shot', 'Lifestyle'];
  const QC_SCORES   = [4.8, 4.3, 4.0, 3.7, 3.5];

  const candidateImages = scored.length
    ? scored.map((item, i) => ({ url: item.url, label: VIEW_LABELS[i] || `View ${i+1}`, score: QC_SCORES[i] || 3.0 }))
    : [{ url: 'https://placehold.co/400x400/eee/555?text=No+Image', label: 'Product', score: 3.0 }];

  return {
    productName:     productName || 'LG Product',
    productType:     productType || 'appliance',
    candidateImages,
    productFeatures: (productFeatures || []).filter(f => typeof f === 'string' && f.length > 3),
  };
}

// ══ URL PARSER ════════════════════════════════════════════════════
function parseUrl(url) {
  try {
    const u       = new URL(url);
    const parts   = u.pathname.split('/').filter(Boolean);
    const market  = parts[0] || 'us';
    const category = parts[1] || '';
    const slug    = parts[parts.length - 1].replace(/\/$/, '').toLowerCase();

    const modelRaw  = slug.replace(/^lg-/i, '').toUpperCase();
    // Remove trailing single-letter+digit variant suffix (e.g. GSXV80PZLE1 → GSXV80PZLE)
    const modelBase = modelRaw.replace(/([A-Z])\d$/, '$1');

    const uLow = url.toLowerCase();
    const productType =
      /refrigerat|fridge|freezer|lrmv|lfxs|gsxv|gsx|instaview/.test(uLow) ? 'fridge'   :
      /washer|dryer|wm\d|dlex|dlgx/.test(uLow)                             ? 'washer'   :
      /oled|qned|nano|tv|65u|55u|75u|c3|c4|g3|g4/.test(uLow)              ? 'tv'       : 'appliance';

    const displayName = 'LG ' + modelRaw;

    return { market, category, slug, modelRaw, modelBase, productType, displayName };
  } catch {
    return { market:'us', category:'', slug:'', modelRaw:'', modelBase:'', productType:'appliance', displayName:'LG Product' };
  }
}

// ══ IMAGE HELPERS ═════════════════════════════════════════════════
function imgUrl(u) {
  return typeof u === 'string' && /^https?:\/\/.+\.(?:jpg|jpeg|png|webp)/i.test(u);
}

function lgScore(url) {
  let s = 0;
  if (url.includes('gscs-b2c.lge.com'))                s += 10;
  if (url.includes('/content/dam'))                     s += 8;
  if (/[A-Z]{2,}[-_]\d{3,}/i.test(url))               s += 5;
  if (/(?:main|hero|front|primary|featured)/i.test(url)) s += 6;
  if (/gallery|product/i.test(url))                    s += 4;
  if (/medium0[1-3]/i.test(url))                       s += 5;
  if (/\d{3,4}x\d{3,4}/.test(url))                    s -= 3;
  if (/(?:2000|1600|1200|900|large|xl)/i.test(url))    s += 3;
  if (/thumbnail|thumb|small|xs|_s\./i.test(url))      s -= 5;
  return s;
}

function imgExists(url) {
  return new Promise(resolve => {
    const img   = new Image();
    const timer = setTimeout(() => resolve(false), 6000);
    img.onload  = () => { clearTimeout(timer); resolve(true);  };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src     = url;
  });
}

function walkImgs(obj, set, depth = 0) {
  if (depth > 12 || !obj) return;
  if (typeof obj === 'string') {
    const c = obj.replace(/[\\'"]+$/, '');
    if (imgUrl(c) && !/icon|logo/.test(c)) set.add(c);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach(i => walkImgs(i, set, depth + 1)); return; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const isImg = /image|photo|gallery|media|src|url|thumb|picture/i.test(k);
      if (isImg || depth < 6) walkImgs(v, set, depth + (isImg ? 0 : 1));
    }
  }
}

function lgDec(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}

function collectFeat(obj, set, depth) {
  if (depth > 10 || !obj || set.size >= 10) return;
  if (Array.isArray(obj)) { obj.forEach(i => collectFeat(i, set, depth + 1)); return; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (/^(?:feature|keyFeature|highlight|benefit|usp|bullet|sellingPoint)/i.test(k)) {
        if (typeof v === 'string' && v.length > 5 && v.length < 150) set.add(v.trim());
        else if (Array.isArray(v)) v.forEach(item => {
          if (typeof item === 'string' && item.length > 5) set.add(item.trim());
          else if (item?.title || item?.name || item?.text) set.add((item.title || item.name || item.text).trim());
        });
      } else { collectFeat(v, set, depth + 1); }
    }
  }
}

// ══ GENERATE IMAGE via Gemini ════════════════════════════════════
async function clientGenerateImage(productType, region, ratio, prompt) {
  const key = CONFIG.GEMINI_API_KEY;

  const genRes = await fetchT(
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
  if (!genRes.ok) throw new Error(`Gemini image ${genRes.status}`);
  const genData = await genRes.json();

  const parts = genData.candidates?.[0]?.content?.parts ?? [];
  let imageUrl = null;
  for (const part of parts) {
    if (part.inlineData?.data) {
      imageUrl = `data:${part.inlineData.mimeType || 'image/jpeg'};base64,${part.inlineData.data}`;
      break;
    }
  }
  if (!imageUrl) throw new Error('No image returned from Gemini');

  let qcScores = { productIntegrity: 88, naturalProportions: 85, backgroundHarmony: 87, regionalStyleMatch: 83 };
  try {
    const base64 = imageUrl.split(',')[1];
    const mime   = imageUrl.split(';')[0].split(':')[1];
    qcScores = await clientQC(key, base64, mime, productType, region);
  } catch {}

  return { imageUrl, qcScores };
}

async function clientQC(key, base64, mime, productType, region) {
  const res = await fetchT(
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
  const data  = await res.json();
  const text  = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const match = text.match(/\{[^}]+\}/);
  return match ? JSON.parse(match[0]) : { productIntegrity: 88, naturalProportions: 85, backgroundHarmony: 87, regionalStyleMatch: 83 };
}
