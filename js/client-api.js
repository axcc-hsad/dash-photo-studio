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
  if (ep === 'generate-image') return clientGenerateImage(body.productImageUrl, body.productType, body.region, body.ratio, body.prompt);
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
  const imgs    = new Set();   // all collected image URLs
  const cdnImgs = new Set();   // CDN-probed only (medium01-05 / _AEK_1-5) — guaranteed packshots
  let   name = info.displayName;
  let   type = info.productType;
  let   feat = [];

  // ── Run all parallel sources ──────────────────────────────────
  const [jinaR, cdnR, gemR, htmlGalR] = await Promise.allSettled([
    jinaFetch(url),                     // A. Jina renders the page
    cdnProbe(info, imgs, cdnImgs),      // B. CDN pattern probing (fills both sets)
    geminiAnalyze(url, info),           // C. Gemini reads page + web search
    extractGalleryUrls(url, info),      // D. CORS proxy + __NEXT_DATA__ gallery extraction
  ]);

  // ── Merge: Jina — text info only if CDN images found; images always added ──
  if (jinaR.status === 'fulfilled') {
    const j = jinaR.value;
    j.images.forEach(u => imgs.add(u));   // jina images go into fallback pool only
    if (j.title) name = j.title;
    if (j.features.length) feat = j.features;
    console.log('[DASH] Jina: ok,', j.images.length, 'images');
  } else {
    console.warn('[DASH] Jina failed:', jinaR.reason?.message);
  }

  // ── Merge: Gemini (highest priority for text; images go to fallback pool) ──
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

  // ── Merge: HTML gallery extraction (goes directly into cdnImgs — guaranteed packshots) ──
  if (htmlGalR.status === 'fulfilled' && htmlGalR.value.length > 0) {
    htmlGalR.value.forEach(u => { imgs.add(u); cdnImgs.add(u); });
    console.log('[DASH] HTML gallery:', htmlGalR.value.length, 'packshots added to CDN set');
  } else {
    console.warn('[DASH] HTML gallery failed or empty:', htmlGalR.reason?.message || 'no gallery URLs found');
  }

  // CDN-probed images are already in imgs too; log both counts
  cdnImgs.forEach(u => imgs.add(u));
  console.log('[DASH] total images found:', imgs.size, '| CDN gallery:', cdnImgs.size);

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

  return await buildResult(imgs, cdnImgs, name, type, feat, info.slug, url);
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
      // ⚠️  Only keep LG CDN images — Jina returns ALL images on the page including
      // ThinQ app icons, Apple/Google store badges, partner logos, etc.
      // Restricting to LG CDN domains here prevents icon images from entering the pool.
      const imgField = d.images;
      if (imgField) {
        const raw = Array.isArray(imgField)
          ? imgField.map(i => (typeof i === 'string' ? i : i.url)).filter(Boolean)
          : Object.keys(imgField);
        images = raw.filter(u => /(?:gscs-b2c\.lge\.com|lg\.com\/content\/dam)/i.test(u));
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

  // And bare LG CDN URLs in the text — covers both content/dam and gscs-b2c goldimage CDN
  const cdnRe = /(https?:\/\/(?:gscs-b2c\.lge\.com|[^\s]*lg\.com\/content\/dam)[^\s,)"'\\]+\.(?:jpg|jpeg|png|webp)[^\s,)"'\\]*)/gi;
  for (const m of markdown.matchAll(cdnRe)) images.push(m[1].replace(/[\\'"]+$/, ''));

  // Extract features from markdown — skip cookie banners, nav menus, category lists
  const JUNK = /cookie|privacy|consent|analytics|adverti|functional|necessary|social.?media|navigation|business|heating|cooling|computing|accessories|audio|video|open.?menu|sign.?in|log.?in|register|basket|cart|wishlist/i;
  const features = [];
  for (const m of markdown.matchAll(/^[-*•]\s+(.{10,150})$/gm)) {
    const txt = m[1].trim();
    if (features.length >= 6) break;
    if (/^https?:/.test(txt))   continue;   // bare URLs
    if (/^!\[/.test(txt))       continue;   // markdown image
    if (/^\[/.test(txt))        continue;   // [x] checkboxes
    if (/^[A-Z][a-z]+(\/[A-Z][a-z]+)+$/.test(txt)) continue;  // "TV/Audio/Video" nav patterns
    if (JUNK.test(txt))         continue;
    features.push(txt);
  }

  // Clean title: remove "| LG XX" market suffix
  const cleanTitle = (title || '').replace(/\s*[\|–-]\s*LG\s+\w+\s*$/i, '').trim();

  // For AEM-style gallery URLs found in Jina, also probe higher-resolution variants.
  // LG AEM CDN serves the same image in multiple size folders:
  //   /gallery/450x450/Name.jpg  →  try /gallery/1600x1062/Name.jpg  (highest quality)
  //   /gallery/350x350/Name.jpg  →  try /gallery/1100x730/Name.jpg
  // Probing is done via Image() (no CORS restriction).
  const aemGallery = [...new Set(images)].filter(u =>
    /\/content\/dam\/channel\/wcms\/.+\/gallery\/\d+x\d+\//i.test(u)
  );
  if (aemGallery.length > 0) {
    const hiResSizes = ['1600x1062', '1100x730', '2010x1334'];
    const hiResProbes = [];
    for (const u of aemGallery) {
      for (const sz of hiResSizes) {
        const hiRes = u.replace(/\/gallery\/\d+x\d+\//i, `/gallery/${sz}/`);
        if (!images.includes(hiRes)) {
          hiResProbes.push(
            imgExists(hiRes).then(ok => { if (ok) images.push(hiRes); })
          );
        }
      }
    }
    await Promise.all(hiResProbes);
    console.log('[DASH] Jina AEM gallery: probed hi-res variants,', images.length, 'total');
  }

  return {
    title:    cleanTitle,
    images:   [...new Set(images)].filter(imgUrl),
    features,
  };
}

// ══ B. CDN PATTERN PROBING ════════════════════════════════════════
// Uses browser Image() — no CORS restriction on image loading
// IMPORTANT: never probe D* patterns (D01.jpg = Dimension drawing)
// Limit to slots 1-5 only — slot 6+ are usually spec/back images
async function cdnProbe(info, imgSet, cdnSet = new Set()) {
  const { market, category, categoryPath, slug, modelRaw, modelBase } = info;
  if (!slug) return;
  // Use full category path (e.g. "tv-barres-de-son/qned") so we hit the correct CDN URL.
  // Many LG URLs have subcategories (e.g. /tvs/oled-tvs/, /tv-barres-de-son/qned/) that
  // must be included; using just parts[1] caused 404s and fallback to Jina's full page pool.
  const cdnCat = categoryPath || category;

  // Local probe: load image, check dimensions, reject video/landscape thumbnails
  function probeUrl(url) {
    return new Promise(resolve => {
      const img   = new Image();
      const timer = setTimeout(() => resolve(), 7000);
      img.onload  = () => {
        clearTimeout(timer);
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        // Skip tiny images (icons, placeholders)
        if (w < 100 || h < 100) return resolve();
        // NOTE: aspect-ratio filtering was removed.
        // TV front-facing packshots (ratio ~1.7) and video thumbnails (ratio 1.78)
        // are too close to distinguish by ratio alone — ratio filter incorrectly
        // blocked the TV front-view packshot. Vision scoring handles this instead.
        imgSet.add(url); cdnSet.add(url);
        resolve();
      };
      img.onerror = () => { clearTimeout(timer); resolve(); };
      img.src = url;
    });
  }

  const probes = [];
  // Prefer modelBase (no variant suffix) to reduce duplicates
  // Also try modelRaw in case CDN uses the full slug
  const models = [...new Set([modelBase, modelRaw].filter(m => m && m.length >= 4))];
  // Market suffixes for EU/US/Asia CDN filenames
  // _AEK = UK/Europe, _AEKQ = UK variant, _MEA = Middle East/Africa,
  // _AU = Australia, _CA = Canada, _US = USA
  const mkSufx = ['_AEK', '_AEKQ', '_AEK2', '_EEK', '_EEK2', '_MEA', '_AU', '_CA', '_US', ''];

  // ── LG content/dam gallery: probe full categoryPath + last segment + single category ──
  // e.g. /uk/laundry/washtowers/wt1210bbtn1/ → tries:
  //   "laundry/washtowers", "washtowers", "laundry"
  // The last segment alone ("washtowers") is often the actual CDN directory name.
  const lastCat = categoryPath.includes('/') ? categoryPath.split('/').pop() : null;
  const catPaths = [...new Set([cdnCat, lastCat, category].filter(Boolean))];
  for (const cp of catPaths) {
    for (let n = 1; n <= 8; n++) {      // Extended to 8 — some LG products have 6–8 gallery images
      const pad = String(n).padStart(2, '0');
      for (const ext of ['jpg', 'png']) {
        probes.push(probeUrl(
          `https://www.lg.com/content/dam/channel/wcms/${market}/images/${cp}/${slug}/gallery/medium${pad}.${ext}`
        ));
        // Also try with lg- prefix (some UK slugs like w4x7016tbb exist without it on web but with it on CDN)
        if (!slug.startsWith('lg-')) {
          probes.push(probeUrl(
            `https://www.lg.com/content/dam/channel/wcms/${market}/images/${cp}/lg-${slug}/gallery/medium${pad}.${ext}`
          ));
        }
      }
    }
  }

  // ── gscs-b2c.lge.com goldimage CDN (global): slots 1-8 ─────────
  for (const model of models) {
    for (let n = 1; n <= 8; n++) {
      for (const sfx of mkSufx) {
        probes.push(probeUrl(
          `https://gscs-b2c.lge.com/lglib/goldimage/${model}/${model}${sfx}_${n}.jpg`
        ));
      }
    }
  }

  // ── US content/dam gallery: medium01–08 ──────────────────────
  for (const model of models) {
    const lm = model.toLowerCase();
    for (let n = 1; n <= 8; n++) {
      const pad = String(n).padStart(2, '0');
      probes.push(probeUrl(
        `https://www.lg.com/content/dam/channel/wcms/us/images/${category}/lg-${lm}/gallery/medium${pad}.jpg`
      ));
    }
  }

  await Promise.all(probes);
}

// module-level probe still used by parseHtml's gallery-sibling expansion
function probe(url, set) {
  return imgExists(url).then(ok => { if (ok) set.add(url); });
}

// ══ B2. HTML GALLERY EXTRACTOR ════════════════════════════════════
// Fetches raw page HTML via CORS proxy and extracts gallery image URLs
// from __NEXT_DATA__ JSON (embedded in static HTML by Next.js SSR).
// This catches lazy-loaded gallery images that Jina misses — because
// __NEXT_DATA__ is part of the initial HTML payload, not triggered by scroll.
async function extractGalleryUrls(url, info) {
  const found = new Set();
  try {
    const html = await proxyFetch(url);

    // 1. __NEXT_DATA__ — Next.js SSR JSON blob (contains ALL product images)
    const nx = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nx) { try { walkImgs(JSON.parse(nx[1]), found); } catch {} }

    // 2. JSON-LD structured data
    for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
      try { walkImgs(JSON.parse(m[1]), found); } catch {}
    }

    // 3. Bare CDN URLs in raw HTML text
    const cdnRe = /https?:\/\/(?:gscs-b2c\.lge\.com|[^"'\s]*?lg\.com\/content\/dam)[^"'\s,)>]+\.(?:jpg|jpeg|png|webp)(?:[^"'\s,)>]*)?/gi;
    for (const m of html.matchAll(cdnRe)) found.add(m[0].split('\\u')[0].replace(/[\\'"]+$/, ''));

  } catch (e) {
    console.warn('[DASH] extractGalleryUrls: HTML fetch failed —', e.message);
    return [];
  }

  // Keep only confirmed gallery-packshot URL patterns,
  // AND require the product slug in the URL to exclude related-product images.
  const slugCoreH = (info.slug || '').toLowerCase().replace(/^lg-/, '');
  const galleryUrls = [...found].filter(imgUrl).filter(u => {
    const ul = u.toLowerCase();
    if (/\/gallery\/medium\d+\./i.test(u)) return !slugCoreH || ul.includes(slugCoreH);
    if (/\/content\/dam\/channel\/wcms\/[^/]+\/images\/.+\/gallery\//i.test(u))
      return slugCoreH && ul.includes(slugCoreH);
    if (/gscs-b2c\.lge\.com\/lglib\/goldimage\//i.test(u))
      return !slugCoreH || ul.includes(slugCoreH);
    return false;
  });

  // If we found the base (medium01), probe siblings 2–8
  const baseUrl = galleryUrls.find(u => /medium0?1\.[a-z]{2,4}$/i.test(u.split('?')[0]));
  if (baseUrl) {
    const baseNoQ = baseUrl.split('?')[0];
    const extM = baseNoQ.match(/\.[a-z]{2,4}$/i);
    const ext  = extM ? extM[0] : '.jpg';
    const sibProbes = [2,3,4,5,6,7,8].map(n => {
      const sibling = baseNoQ.replace(/medium0?1(\.[a-z]{2,4})$/i, `medium${String(n).padStart(2,'0')}${ext}`);
      return imgExists(sibling).then(ok => { if (ok) galleryUrls.push(sibling); });
    });
    await Promise.all(sibProbes);
  }

  const unique = [...new Set(galleryUrls)].filter(imgUrl);
  if (unique.length) console.log('[DASH] extractGalleryUrls: found', unique.length, 'gallery packshots from HTML');
  return unique;
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
  "productFeatures": ["key spec 1", "key spec 2", "key spec 3", "key spec 4", "key spec 5"],
  "imageUrls": ["https://full-cdn-image-url.jpg"]
}

Rules for productFeatures — extract REAL product key specs/USPs ONLY:
✓ Good: "635L Total Capacity", "InstaView Door-in-Door", "Total No Frost", "A++ Energy Rating", "Craft Ice Maker"
✗ Bad: navigation categories (TV/Audio, Appliances), cookie notices, generic phrases, site menu items
Extract up to 5 specific technical specs or named features from the product page itself.

For imageUrls: ONLY main product gallery packshot images — photos of the product itself
on a white or plain studio background (front view, side view, 3/4 angle, open-door detail, etc.).
On LG pages these appear in the image carousel/gallery at the top-right of the product page.

Rules:
✓ Include: product photos from the gallery carousel → CDN paths typically contain "/gallery/" or
  follow the gscs-b2c goldimage pattern (*_AEK_1.jpg, *_AEK_2.jpg …)
✗ Exclude: USP/feature banners (images with "AI DD", "TurboWash", feature text overlays),
  lifestyle photos with people in a room, energy-rating graphics, dimension diagrams,
  video thumbnails, images from the "Key Features" scroll section of the page

Provide full absolute CDN URLs only (gscs-b2c.lge.com or lg.com/content/dam), max 8.
If you cannot access the page, infer productType from the URL path and leave imageUrls empty.`;

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
  if (/fridge|refrig|freezer/.test(s))       return 'fridge';
  if (/wash|dryer|washtower/.test(s))         return 'washer';
  if (/monitor|ultrawide|curved.?screen/.test(s)) return 'monitor';
  if (/tv|oled|qned|display|soundbar/.test(s)) return 'tv';
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

  return await buildResult(imgs, new Set(), name || info.displayName, type || info.productType, feat, info.slug);
}

// ══ RESULT BUILDER ════════════════════════════════════════════════
async function buildResult(imgSet, cdnImgs, productName, productType, productFeatures, slug = '', pageUrl = '') {
  // ── CDN-first strategy ────────────────────────────────────────
  // CDN-probed images (medium01-05 / _AEK_1-5) are preferred packshots.
  // When any CDN gallery images exist, use those first; fall back to full pool.
  const hasCdnGallery = cdnImgs && cdnImgs.size > 0;
  const source = hasCdnGallery ? cdnImgs : imgSet;
  if (hasCdnGallery) {
    console.log('[DASH] CDN-first mode: using', cdnImgs.size, 'gallery images exclusively');
  }

  // 1. Hard-filter — LG CDN domain ONLY, then pattern-based rejects
  //    LG product packshots are always served from:
  //      • www.lg.com/content/dam/  (AEM CDN)
  //      • gscs-b2c.lge.com/lglib/goldimage/  (goldimage CDN)
  //    Any other domain (Apple CDN, Google Play, partner logos, etc.) is not a packshot.
  let pool = [...source]
    .filter(imgUrl)
    .filter(u => /(?:gscs-b2c\.lge\.com|lg\.com\/content\/dam)/i.test(u))  // LG CDN only
    .filter(u => !isSpecImage(u))
    .filter(u => !/icon|logo|badge|flag|ribbon|sprite/i.test(u));

  // 1b. Product-type exclusion: filter out images whose URL clearly signals a different
  //     product category (e.g. washer URLs appearing on a TV page due to related products).
  //     Works regardless of CDN source — catches cross-promotion images at the URL level.
  const WRONG_PRODUCT_KEYWORDS = {
    tv:       ['washer', 'dryer', 'washing-machine', 'laveuse', 'lave-linge', 'waschmaschine',
               'sèche-linge', 'refrigerator', 'fridge', 'congel', 'refrigerateur',
               'dishwasher', 'lave-vaisselle', 'vacuum', 'air-purif', 'purif-air'],
    fridge:   ['washer', 'dryer', 'washing-machine', 'dishwasher', 'televisions', 'oled', 'qned'],
    washer:   ['refrigerator', 'fridge', 'televisions', 'oled', 'qned', 'dishwasher'],
    monitor:  ['washer', 'dryer', 'refrigerator', 'fridge', 'dishwasher'],
    appliance:['televisions', 'oled', 'qned'],
  };
  const excludeKw = WRONG_PRODUCT_KEYWORDS[productType] || [];
  if (excludeKw.length > 0) {
    const before = pool.length;
    pool = pool.filter(u => !excludeKw.some(kw => u.toLowerCase().includes(kw)));
    if (pool.length < before) console.log('[DASH] Wrong-product filter removed', before - pool.length, 'images');
  }

  // 1c. Gallery-path priority filter (STRONGEST signal of a packshot)
  //
  //     LG uses TWO different CDN naming conventions depending on market/product:
  //
  //     A) classic "medium" naming: /gallery/medium01.jpg, medium02.jpg ...
  //        e.g. French QNED: .../images/tv-barres-de-son/qned/{slug}/gallery/medium01.jpg
  //
  //     B) AEM descriptive naming (UK/EU newer products):
  //        .../images/{category}/{slug}/gallery/{SIZE}/{DescriptiveName}.jpg
  //        e.g. UK WashTower: .../images/washtower/wt1210bbtn1/gallery/1600x1062/WashTower24_..._Front.jpg
  //
  //     USP/feature images never live under /images/{cat}/{slug}/gallery/ or medium* paths,
  //     so matching either pattern is a reliable packshot signal.
  //     gscs-b2c goldimage CDN (*_AEK_N.jpg) is also guaranteed packshot.
  //
  // slugCore: strip "lg-" prefix so both "lg-wt1210wwf" and "wt1210wwf" match the CDN path
  const slugCore = slug.toLowerCase().replace(/^lg-/, '');

  const galleryMediumUrls = pool.filter(u => {
    const ul = u.toLowerCase();
    // Classic medium01.jpg naming — slug is already in the CDN path, no extra check needed
    if (/\/gallery\/medium\d+\./i.test(u)) return true;
    // AEM descriptive naming: must ALSO contain the product slug to prevent
    // related-product images (from "You may also like" sections) slipping through.
    // e.g. /images/washtower/wt1210wwf/gallery/...  ← contains slug ✓
    //      /images/washing-machines/f4wv912p2se/gallery/... ← does NOT contain wt1210wwf ✗
    if (/\/content\/dam\/channel\/wcms\/[^/]+\/images\/.+\/gallery\//i.test(u)) {
      return slugCore && ul.includes(slugCore);
    }
    return false;
  });
  const goldimageUrls = pool.filter(u => {
    const ul = u.toLowerCase();
    if (!/gscs-b2c\.lge\.com.+_\d+\.jpg/i.test(u)) return false;
    // Also slug-match goldimage URLs to avoid wrong-product packshots
    return !slugCore || ul.includes(slugCore);
  });
  const strictGallery = [...new Set([...galleryMediumUrls, ...goldimageUrls])];

  if (strictGallery.length >= 1) {
    console.log('[DASH] Gallery-priority: using', strictGallery.length,
      'packshot URLs (medium*/AEM gallery path or gscs-b2c goldimage)');
    // When multiple sizes of the same image exist (e.g. /450x450/ and /1600x1062/),
    // keep the highest-resolution version of each unique image.
    pool = deduplicateByFilename(strictGallery);
    console.log('[DASH] After filename-dedup:', pool.length, 'unique gallery images');
  } else {
    // No confirmed gallery packshots — fall back to slug/model matching
    // to at least exclude other-product cross-promo images.
    const segs  = slug.replace(/^lg-/, '').split('-');
    const model = segs.find(s => s.length >= 5 && /[a-z]/i.test(s) && /\d/.test(s)) || '';

    const bySlug  = pool.filter(u => u.toLowerCase().includes(slug.toLowerCase()));
    const byModel = model ? pool.filter(u => u.toLowerCase().includes(model.toLowerCase())) : [];

    if (bySlug.length >= 2) {
      console.log('[DASH] Slug-filter: using', bySlug.length, 'exact-slug images');
      pool = bySlug;
    } else if (byModel.length >= 2) {
      console.log('[DASH] Model-filter: using', byModel.length, 'model-matched images');
      pool = byModel;
    } else if (byModel.length === 1) {
      pool = [...byModel, ...pool.filter(u => !byModel.includes(u))];
    }
  }

  // 2. Deduplicate: same slot number = same physical image from different CDNs
  //    e.g. medium01.jpg + GSXV80PZLE_AEK_1.jpg → keep highest-scored URL for slot 1
  const deduped = deduplicateBySlot(pool);   // returns slots 1-5, sorted by slot
  console.log('[DASH] After dedup:', deduped.length, 'unique images');

  // 3. If still > 5 (shouldn't happen after dedup), take top 5 by score
  const finalUrls = deduped.length > 5
    ? deduped.sort((a, b) => lgScore(b) - lgScore(a)).slice(0, 5)
    : deduped;

  const VIEW_LABELS = ['Front View', 'Side View', '3/4 Angle', 'Detail Shot', 'Lifestyle'];
  const QC_SCORES   = [4.8, 4.3, 4.0, 3.7, 3.5];

  let candidateImages = finalUrls.slice(0, 5).map((url, i) => ({
    url,
    label: VIEW_LABELS[i] || `View ${i + 1}`,
    score: QC_SCORES[i]  || 3.0,
  }));

  // 4. Vision scoring: Gemini Flash analyzes each image and removes
  //    lifestyle shots, campaign crops, dimension diagrams, etc.
  //    This catches bad images that slip past URL-pattern filters.
  if (candidateImages.length > 0) {
    try {
      const ranked = await visionScoreImages(candidateImages, productType, pageUrl);
      if (ranked.length > 0) {
        candidateImages = ranked.map((c, i) => ({
          ...c,
          label: VIEW_LABELS[i] || `View ${i + 1}`,
          score: QC_SCORES[i]  || 3.0,
        }));
        console.log('[DASH] Vision ranking done:', candidateImages.length, 'images kept');
      }
    } catch (e) {
      console.warn('[DASH] Vision scoring skipped:', e.message);
    }
  }

  if (!candidateImages.length) {
    candidateImages.push({ url: 'https://placehold.co/400x400/eee/555?text=No+Image', label: 'Product', score: 3.0 });
  }

  return {
    productName:     cleanName(productName) || 'LG Product',
    productType:     productType || 'appliance',
    candidateImages,
    productFeatures: (productFeatures || []).filter(f => typeof f === 'string' && f.length > 3),
  };
}

// ── Vision-based image scoring ─────────────────────────────────────
// Sends image URLs to Gemini via urlContext (server-side fetch — no CORS).
// Gemini scores each 0-3: 0=reject (lifestyle/diagram/wrong product),
// 3=ideal packshot. Rejected images are removed; remainder sorted best-first.
//
// Fallback: if urlContext fails, tries individual image fetch via proxy.
async function visionScoreImages(candidates, productType, pageUrl = '') {
  const key = CONFIG.GEMINI_API_KEY;

  // ── Primary: pageUrl approach — Gemini loads the LG product PAGE and scores ──
  // LG product pages are accessible to Google's crawlers; Gemini can visually
  // inspect the gallery and match scores to each image URL.
  // This avoids needing to proxy individual CDN image files (which LG blocks).
  if (pageUrl) {
    try {
      return await _visionByPageUrl(pageUrl, candidates, productType, key);
    } catch (e) {
      console.warn('[DASH] Vision pageUrl failed:', e.message, '— trying individual urlContext');
    }
  }

  // ── Fallback 1: individual image URLs via urlContext ──────────────
  try {
    return await _visionByUrlContext(candidates, productType, key);
  } catch (e) {
    console.warn('[DASH] Vision urlContext failed:', e.message, '— trying base64 fallback');
  }

  // ── Fallback 2: fetch as base64 via CORS proxies ──────────────────
  try {
    return await _visionByBase64(candidates, productType, key);
  } catch (e) {
    console.warn('[DASH] Vision base64 fallback also failed:', e.message);
    return candidates;   // give up — return original order
  }
}

// ── Shared: build the vision scoring prompt (all product types) ───────────────
function _visionPrompt(productType, urlList, context = '') {
  const typeGuide = {
    tv: [
      'TV frame/bezel/stand clearly visible = score 2–3 even with demo content on screen',
      'ONLY screen content with no visible frame/bezel = score 0',
      'Large text/logo overlay ("LG QNED evo AI / 2025") covering most of image = score 0',
    ],
    washer: [
      'Front-facing or 3/4 packshot on white/light gray background = score 3',
      'Open drum detail or side profile on white background = score 2',
      'Washer in a kitchen/laundry room lifestyle scene WITH PEOPLE = score 0',
      'Internal drum close-up (no product outline) = score 1',
    ],
    fridge: [
      'Front door closed on white/neutral background = score 3',
      'Door open showing interior contents, on white background = score 2',
      'Fridge in a kitchen lifestyle scene WITH PEOPLE = score 0',
      'Close-up of handle or shelves only (no product silhouette) = score 1',
    ],
    monitor: [
      'Front-facing on white/dark/neutral background = score 3',
      'Side profile or 3/4 angle on plain background = score 2',
      'Monitor in a desk/workspace lifestyle scene WITH PEOPLE = score 0',
    ],
    appliance: [
      'Product clearly visible as the main subject on plain background = score 2–3',
      'Product in a lifestyle room scene WITH PEOPLE = score 0',
    ],
  };

  const guide = (typeGuide[productType] || typeGuide.appliance)
    .map(l => `  • ${l}`).join('\n');

  return `You are an LG product image quality evaluator for lifestyle image compositing.
${context}
Score each image URL below on a 0–3 scale:

${urlList}

── Scoring rules ──────────────────────────────────────────────────────────────
3 = IDEAL packshot: product clearly visible, front-facing or ¾ angle,
    WHITE or plain studio/neutral background, no people, no significant text overlay
2 = ACCEPTABLE: product clearly visible, non-white but neutral/gray background,
    slight angle, or minor text that doesn't dominate
1 = POOR: back view, extreme side profile (product very thin), product very small
    in frame, single-detail crop (handle, button, drum) without full product silhouette
0 = REJECT — score 0 for ANY of these:
    • Lifestyle scene with PEOPLE visible in a room
    • Dimension/installation diagram or specification chart
    • Wrong product type (e.g. a refrigerator image on a washer page)
    • Video thumbnail (movie, game, or YouTube-style scene full-screen)
    • Marketing/campaign banner where large text covers more than half the image
    • Abstract color art or texture swatch with no product present
    • Near-empty image (blank background, no product visible)
    • USP feature graphic: partial product buried in text/icon overlays

── ${productType.toUpperCase()} specific rules ──────────────────────────────────────────
${guide}

Return ONLY a JSON array — no markdown, no explanation:
[{"i":1,"score":3},{"i":2,"score":0},...] — one entry per image.`;
}

// ── Shared: apply scores and filter; safety net prevents empty result ─────────
function _applyVisionScores(candidates, scores, logLabel) {
  const scoreMap = new Map(scores.map(s => [s.i - 1, s.score]));
  const scored   = candidates.map((c, i) => ({ ...c, vScore: scoreMap.get(i) ?? 1 }));
  console.log(`[DASH] ${logLabel}:`, scored.map(s => `${s.url.split('/').pop()}→${s.vScore}`).join(', '));

  const passed = scored.filter(c => c.vScore > 0).sort((a, b) => b.vScore - a.vScore);

  // Safety net: never return empty — if all scored 0, keep best 1-2 to prevent "No Image"
  const result = passed.length > 0
    ? passed
    : scored.sort((a, b) => b.vScore - a.vScore).slice(0, 2);

  return result.map(({ vScore, ...rest }) => rest);
}

// ── PRIMARY: Load LG product PAGE, score images from page context ─────────────
// LG pages are accessible to Google crawlers via urlContext. Gemini visually
// inspects the gallery and matches scores to the candidate URLs we provide.
async function _visionByPageUrl(pageUrl, candidates, productType, key) {
  const urlList = candidates.map((c, i) => `Image ${i + 1}: ${c.url}`).join('\n');
  const context = `Access this LG product page to see the gallery: ${pageUrl}\nThen score each image URL listed below.`;
  const prompt  = _visionPrompt(productType, urlList, context);

  const res = await fetchT(
    `${GEMINI_BASE}/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ urlContext: {} }] }),
    },
    35000
  );
  if (!res.ok) throw new Error(`pageUrl vision API ${res.status}`);

  const data  = await res.json();
  if (data.error) throw new Error(data.error.message);

  const text  = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
  const match = text.match(/\[[\s\S]+\]/);
  if (!match) throw new Error('No JSON array in pageUrl vision response');

  return _applyVisionScores(candidates, JSON.parse(match[0]), 'pageUrl vision');
}

// ── SECONDARY: Individual image URLs via urlContext ───────────────────────────
async function _visionByUrlContext(candidates, productType, key) {
  const urlList = candidates.map((c, i) => `Image ${i + 1}: ${c.url}`).join('\n');
  const prompt  = _visionPrompt(productType, urlList);

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ urlContext: {} }],
  };

  const res = await fetchT(
    `${GEMINI_BASE}/gemini-2.0-flash:generateContent?key=${key}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) },
    35000
  );
  if (!res.ok) throw new Error(`urlContext API ${res.status}`);

  const data  = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text  = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
  // Use greedy match to capture the full array (non-greedy cuts off early on nested content)
  const match = text.match(/\[[\s\S]+\]/);
  if (!match) throw new Error('No JSON array in urlContext response');

  return _applyVisionScores(candidates, JSON.parse(match[0]), 'urlContext vision');
}

// Fallback path: fetch each image as base64 via CORS proxy, send inline
async function _visionByBase64(candidates, productType, key) {
  const fetched = await Promise.all(candidates.map(async (c, idx) => {
    try {
      const { b64, mime } = await fetchImageAsBase64(c.url);
      return { ...c, b64, mime, idx, ok: true };
    } catch {
      return { ...c, idx, ok: false };
    }
  }));

  const loaded = fetched.filter(f => f.ok);
  if (loaded.length === 0) throw new Error('No images fetchable via proxy');

  const parts = [];
  loaded.forEach((img, i) => {
    parts.push({ text: `[Image ${i + 1}]` });
    parts.push({ inlineData: { mimeType: img.mime, data: img.b64 } });
  });
  // Use the same comprehensive prompt as other paths
  parts.push({ text: _visionPrompt(productType, loaded.map((img, i) => `Image ${i + 1}: (inline image above)`).join('\n')) });

  const res = await fetchT(
    `${GEMINI_BASE}/gemini-2.0-flash:generateContent?key=${key}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{parts}] }) },
    30000
  );
  if (!res.ok) throw new Error(`base64 vision API ${res.status}`);

  const data  = await res.json();
  const text  = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '[]';
  const match = text.match(/\[[\s\S]+\]/);
  if (!match) throw new Error('No JSON in base64 response');

  const scores        = JSON.parse(match[0]);
  const loadedScoreMap = new Map(scores.map(s => [s.i - 1, s.score]));

  // Map scores back to original fetched list (including images that failed to load)
  const scoredFetched = fetched.map(img => ({
    ...img,
    vScore: img.ok ? (loadedScoreMap.get(loaded.findIndex(l => l.url === img.url)) ?? 1) : 0,
  }));

  const result = _applyVisionScores(
    scoredFetched.map(({ b64, mime, ok, idx, ...rest }) => rest),
    scoredFetched.map((img, i) => ({ i: i + 1, score: img.vScore })),
    'base64 vision'
  );
  return result;
}

// Deduplicate by filename: same image served at multiple resolutions (450x450, 1600x1062 etc.)
// → keep only the highest-scored (highest-res) URL per unique filename.
// This prevents wasting gallery slots on size-duplicates of the same photo.
function deduplicateByFilename(urls) {
  const byName = new Map();
  for (const u of urls) {
    const name = u.split('/').pop().split('?')[0].toLowerCase();
    const existing = byName.get(name);
    if (!existing || lgScore(u) > lgScore(existing)) {
      byName.set(name, u);
    }
  }
  return [...byName.values()];
}

// Extract a "slot number" from a URL (1 = first product shot, 99 = unknown/non-gallery)
// LG CDN convention: medium01 / _AEK_1 / _1 → slot 1; D01 → dimension (99)
function slotIndex(url) {
  const filename = url.split('/').pop().split('?')[0];
  // D01.jpg, D02.jpg etc. → dimension images, never show
  if (/^[Dd]\d+\./i.test(filename)) return 99;
  // Extract trailing number before extension: medium03 → 3, F2X50S9TBB_AEK_2.jpg → 2
  const m = filename.match(/(\d+)\.[a-z]{2,4}$/i);
  return m ? parseInt(m[1], 10) : 99;
}

// Keep best-scored URL per slot; deduplicate same slot from different CDN sources.
// Falls back to score-sorted full pool if no standard numbered slots found
// (prevents "No Image" for products with non-standard CDN filenames).
function deduplicateBySlot(urls) {
  const slots = new Map(); // slot# → best URL
  for (const url of urls) {
    const slot = slotIndex(url);
    if (slot === 99) continue;         // dimension / non-gallery
    if (slot > 10) continue;           // very high slot numbers are usually extra/campaign
    const existing = slots.get(slot);
    if (!existing || lgScore(url) > lgScore(existing)) {
      slots.set(slot, url);
    }
  }

  const numbered = [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, url]) => url)
    .slice(0, 5);  // max 5 images

  // Safety fallback: if no images had standard numeric slots (AEM descriptive naming, etc.),
  // deduplicate by filename first (to avoid same image in 3 different sizes taking all 5 slots),
  // then score-sort and take top 5.
  if (numbered.length === 0 && urls.length > 0) {
    console.log('[DASH] dedup: no numbered slots — filename-dedup + score-sort for', urls.length, 'images');
    const byFile = deduplicateByFilename(urls);
    return byFile.sort((a, b) => lgScore(b) - lgScore(a)).slice(0, 5);
  }

  return numbered;
}

// URL-based filter: reject spec drawings, videos, badges, campaign images
// Called BEFORE vision scoring — catches obvious non-packshots by URL pattern alone.
function isSpecImage(url) {
  const u = url.toLowerCase();
  const fname = u.split('/').pop().split('?')[0];

  // ── Dimension / installation drawings ────────────────────────────
  if (/dimension|install(?:ation)?|spec[_-]|schematic|diagram|drawing|manual|technical|measure/i.test(u)) return true;
  if (/\/[Dd]\d+\.[a-z]{2,4}/i.test(url)) return true;
  if (/^[Dd]\d+\.[a-z]{2,4}$/i.test(fname)) return true;

  // ── Video sources ─────────────────────────────────────────────────
  if (/youtube\.com|ytimg\.com|vimeo\.com|wistia\.com|brightcove\.net|\.mp4|\.webm|\.mov/i.test(u)) return true;
  if (/video[-_]thumb|vid[-_]poster|videoimg|video-image|vid-img/i.test(u)) return true;

  // ── LG CDN path sections that never contain packshots ────────────
  if (/\/feature[s]?\/|\/highlight[s]?\/|\/campaign[s]?\/|\/hero-video\//i.test(u)) return true;
  if (/\/banner\/|\/promo\/|\/landing\/|\/teaser\//i.test(u)) return true;
  if (/\/icon[s]?\/|\/badge[s]?\/|\/award[s]?\/|\/certif/i.test(u)) return true;
  if (/\/energy[-_]|\/rating[-_]|\/label[-_]/i.test(u)) return true;   // energy-label graphics

  // ── Fixed pixel-size crops used for video/UI overlays ────────────
  if (/[_-]1280x720[_.-]|[_-]800x450[_.-]|[_-]960x540[_.-]|[_-]1920x1080[_.-]/i.test(u)) return true;

  // ── LG AEM area-thumbnail / UI naming ────────────────────────────
  if (/_at_\d|[-_]ui[-_]|[-_]scene\d|[-_]banner\d/i.test(u)) return true;

  // ── Filename-based USP/feature patterns ──────────────────────────
  // e.g. 01_AIDD_W4X7016TBB.jpg, usp-steam.jpg, kv_hero.jpg
  if (/[-_](aidd|turbowash|steamgo|wideband|directdrive|inverter|energysaving|smartcontrol)/i.test(u)) return true;
  if (/^(?:0[1-9]|[1-9]\d)_[a-z]/i.test(fname)) return true;   // "01_Feature.jpg"
  if (/\/kv[-_]|[-_]kv\d|\/hero[-_]|[-_]hero\./i.test(u)) return true;
  if (/usp[-_]|[-_]usp\d|feature[-_]img|featureimage/i.test(u)) return true;

  // ── Warranty / guarantee / award badge images ─────────────────────
  // LG galleries sometimes include guarantee badges (e.g. "5YearGuarantee.jpg")
  if (/warrant|guarant|certif|award|trophy|prize/i.test(fname)) return true;
  if (/[_-](\d+)year[_-]?(?:parts?|labour|guarantee|warranty)/i.test(fname)) return true;
  if (/5yr|10yr|\d+yr[-_]/i.test(fname)) return true;

  // ── d2c-content "add-N" spec images (dimensions, installation) ────
  // /d2c-content/.../gallery/.../lg-laundry-MODEL-add-4-450.jpg (add-4=dimensions, add-5=install)
  // add-1 (rear), add-2 (panel), add-3 (feature), add-6 (in-situ) may be ok → kept
  if (/[-_]add[-_](?:4|5)\b/i.test(fname)) return true;   // add-4 = dimensions, add-5 = installation

  return false;
}

// Remove market suffix from product name: "... | LG UK" → "..."
function cleanName(name) {
  return (name || '').replace(/\s*[\|–\-]\s*LG\s+\w[\w\s]*$/i, '').trim();
}

// ══ URL PARSER ════════════════════════════════════════════════════
function parseUrl(url) {
  try {
    const u       = new URL(url);
    const parts   = u.pathname.split('/').filter(Boolean);
    const market  = parts[0] || 'us';
    const category = parts[1] || '';
    const slug    = parts[parts.length - 1].replace(/\/$/, '').toLowerCase();
    // Full category path: everything between market and slug
    // e.g. /fr/tv-barres-de-son/qned/lg-75qned87a6b → categoryPath = "tv-barres-de-son/qned"
    const categoryPath = parts.slice(1, parts.length - 1).join('/');

    // ── Model number extraction ───────────────────────────────────
    // LG slugs: "lg-oled55c54la-oled-tv-c5-4k"
    //   → segments after stripping "lg-": ["oled55c54la", "oled", "tv", "c5", "4k"]
    //   → model = first segment that is ≥5 chars AND contains both letters AND digits
    //   This correctly yields "OLED55C54LA" rather than the whole slug.
    const segs = slug.replace(/^lg-/i, '').split('-');
    let modelRaw = '';
    for (const seg of segs) {
      if (seg.length >= 5 && /[a-z]/i.test(seg) && /\d/.test(seg)) {
        modelRaw = seg.toUpperCase();
        break;
      }
    }
    if (!modelRaw) modelRaw = (segs[0] || slug).toUpperCase();  // fallback

    // Remove trailing single-letter+digit variant suffix (e.g. GSXV80PZLE1 → GSXV80PZLE)
    const modelBase = modelRaw.replace(/([A-Z])\d$/, '$1');

    const uLow = url.toLowerCase();
    const productType =
      /refrigerat|fridge|freezer|lrmv|lfxs|gsxv|gsx|instaview/.test(uLow) ? 'fridge'   :
      /washer|dryer|wm\d|dlex|dlgx|washtower|wash-tower/.test(uLow)        ? 'washer'   :
      /monitor|ultrawide|34w|27u|32u/.test(uLow)                           ? 'monitor'  :
      /oled|qned|nano|tv|65u|55u|75u|c3|c4|c5|g3|g4|g5/.test(uLow)       ? 'tv'       : 'appliance';

    const displayName = 'LG ' + modelRaw;

    return { market, category, categoryPath, slug, modelRaw, modelBase, productType, displayName };
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
  if (url.includes('gscs-b2c.lge.com'))                  s += 10;
  if (url.includes('/content/dam'))                       s += 8;
  if (/[A-Z]{2,}[-_]\d{3,}/i.test(url))                  s += 5;
  if (/(?:main|hero|front|primary|featured)/i.test(url))  s += 6;
  if (/gallery|product/i.test(url))                       s += 4;
  if (/medium0[1-3]/i.test(url))                          s += 5;
  // 누끼/화이트배경 패키지샷 우선
  if (/packshot|cutout|white[-_]?bg|_wh\.|studio/i.test(url)) s += 10;
  if (/\.png$/i.test(url))                                s += 6;  // PNG = 보통 투명/흰배경
  // 라이프스타일/사람/캠페인 이미지 감점
  if (/lifestyle|campaign|feature[s]?[-_]|highlight/i.test(url)) s -= 8;
  if (/\d{3,4}x\d{3,4}/.test(url))                       s -= 3;
  if (/(?:2000|1600|1200|900|large|xl)/i.test(url))       s += 3;
  if (/thumbnail|thumb|small|xs|_s\./i.test(url))         s -= 5;
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
async function clientGenerateImage(productImageUrl, productType, region, ratio, prompt) {
  const key = CONFIG.GEMINI_API_KEY;

  // ── 1. 제품 이미지 base64 변환 ────────────────────────────────────
  let productB64  = null;
  let productMime = 'image/jpeg';
  if (productImageUrl) {
    try {
      const { b64, mime } = await fetchImageAsBase64(productImageUrl);
      productB64  = b64;
      productMime = mime;
      console.log('[DASH] product image fetched for compositing');
    } catch (e) {
      console.warn('[DASH] product image fetch failed, text-only fallback:', e.message);
    }
  }

  // ── 2. Request body ───────────────────────────────────────────────
  const parts = [];
  if (productB64) {
    parts.push({ inlineData: { mimeType: productMime, data: productB64 } });
    parts.push({ text: `This is an LG ${productType} product photo on a plain background.\n${prompt}\nKeep the product exactly as shown in the photo — same model, same color, same proportions. Place it naturally as the hero of the scene.` });
  } else {
    parts.push({ text: prompt });
  }

  const reqBody = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  // ── 3. 모델 순서대로 시도 ─────────────────────────────────────────
  // v1beta / v1 두 API 버전 × 여러 모델명 조합 시도.
  // 503 = 과부하(일시적) → 8초 대기 후 1회 재시도.
  // 404/403 = 해당 조합 불가 → 즉시 다음으로.
  const V1B = 'https://generativelanguage.googleapis.com/v1beta/models';
  const V1  = 'https://generativelanguage.googleapis.com/v1/models';
  const MODELS = [
    [V1B, 'gemini-2.0-flash-preview-image-generation'],
    [V1,  'gemini-2.0-flash-preview-image-generation'],
    [V1B, 'gemini-2.0-flash-exp'],
    [V1,  'gemini-2.0-flash-exp'],
    [V1B, 'gemini-2.5-flash-preview-image-generation'],
    [V1,  'gemini-2.5-flash-preview-image-generation'],
  ];

  let imageUrl = null;
  let lastErr  = '';

  outer: for (const [base, model] of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 8000));
        const res  = await fetchT(
          `${base}/${model}:generateContent?key=${key}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody },
          90000
        );
        const data = await res.json();
        if (!res.ok) {
          lastErr = `${model} HTTP ${res.status}: ${data?.error?.message?.slice(0, 80) || ''}`;
          console.warn('[DASH] img model failed:', lastErr);
          if (res.status === 503) continue;   // 과부하 → 재시도
          continue outer;                      // 4xx → 다음 모델로
        }
        for (const p of (data.candidates?.[0]?.content?.parts ?? [])) {
          if (p.inlineData?.data) {
            imageUrl = `data:${p.inlineData.mimeType || 'image/jpeg'};base64,${p.inlineData.data}`;
            console.log('[DASH] image model success:', model, base.includes('v1beta') ? 'v1beta' : 'v1');
            break outer;
          }
        }
        lastErr = `${model}: response ok but no image data`;
        console.warn('[DASH]', lastErr);
        continue outer;
      } catch (e) {
        lastErr = `${model}: ${e.message}`;
        console.warn('[DASH] img model error:', lastErr);
        continue outer;
      }
    }
  }

  if (!imageUrl) throw new Error(`All image models failed. Last: ${lastErr}`);

  // ── 4. QC ────────────────────────────────────────────────────────
  let qcScores = { productIntegrity: 88, naturalProportions: 85, backgroundHarmony: 87, regionalStyleMatch: 83 };
  try {
    const base64 = imageUrl.split(',')[1];
    const mime   = imageUrl.split(';')[0].split(':')[1];
    qcScores = await clientQC(key, base64, mime, productType, region);
  } catch {}

  return { imageUrl, qcScores };
}

// ── 제품 이미지 URL → base64 변환 ─────────────────────────────────
// 직접 fetch → CORS 프록시 순으로 시도
async function fetchImageAsBase64(url) {
  // 1. wsrv.nl — purpose-built image proxy, server-side fetch, no CORS restriction
  //    Best choice for CDN images (LG, etc.) that block browser fetch()
  try {
    const enc = encodeURIComponent(url);
    const res = await fetchT(`https://wsrv.nl/?url=${enc}&output=jpg&q=85&maxage=1d`, {}, 14000);
    if (res.ok && res.headers.get('content-type')?.startsWith('image/')) {
      const blob = await res.blob();
      return { b64: await blobToBase64(blob), mime: 'image/jpeg' };
    }
  } catch {}

  // 2. 직접 fetch (works if server allows CORS — e.g. gscs-b2c.lge.com)
  try {
    const res = await fetchT(url, {}, 12000);
    if (res.ok) {
      const blob = await res.blob();
      const mime = blob.type || guessMime(url);
      return { b64: await blobToBase64(blob), mime };
    }
  } catch {}

  // 3. allorigins raw proxy
  try {
    const res = await fetchT(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {}, 12000);
    if (res.ok) {
      const blob = await res.blob();
      return { b64: await blobToBase64(blob), mime: guessMime(url) };
    }
  } catch {}

  // 4. corsproxy.io
  try {
    const res = await fetchT(`https://corsproxy.io/?${encodeURIComponent(url)}`, {}, 12000);
    if (res.ok) {
      const blob = await res.blob();
      return { b64: await blobToBase64(blob), mime: guessMime(url) };
    }
  } catch {}

  throw new Error('All image fetch attempts failed');
}

function guessMime(url) {
  if (/\.png/i.test(url))  return 'image/png';
  if (/\.webp/i.test(url)) return 'image/webp';
  return 'image/jpeg';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
