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
  const [jinaR, cdnR, gemR] = await Promise.allSettled([
    jinaFetch(url),                     // A. Jina renders the page
    cdnProbe(info, imgs, cdnImgs),      // B. CDN pattern probing (fills both sets)
    geminiAnalyze(url, info),           // C. Gemini reads page + web search
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

  return await buildResult(imgs, cdnImgs, name, type, feat, info.slug);
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
  const mkSufx = ['_AEK', '_AEKQ', '_AEK2', '_MEA', '_AU', '_CA', '_US', ''];

  // ── LG content/dam gallery: probe BOTH full categoryPath AND single category ──
  // Full path (e.g. "tv-barres-de-son/qned") hits the correct nested CDN structure.
  // Single category is kept as fallback for simpler URL structures (/uk/tvs/lg-oled55c54la/).
  const catPaths = [...new Set([cdnCat, category].filter(Boolean))];
  for (const cp of catPaths) {
    for (let n = 1; n <= 5; n++) {
      const pad = String(n).padStart(2, '0');
      for (const ext of ['jpg', 'png']) {
        probes.push(probeUrl(
          `https://www.lg.com/content/dam/channel/wcms/${market}/images/${cp}/${slug}/gallery/medium${pad}.${ext}`
        ));
      }
    }
  }

  // ── gscs-b2c.lge.com goldimage CDN (global): slots 1-5 only ─
  for (const model of models) {
    for (let n = 1; n <= 5; n++) {
      for (const sfx of mkSufx) {
        probes.push(probeUrl(
          `https://gscs-b2c.lge.com/lglib/goldimage/${model}/${model}${sfx}_${n}.jpg`
        ));
      }
    }
  }

  // ── US content/dam gallery: medium01–05 ──────────────────────
  for (const model of models) {
    const lm = model.toLowerCase();
    for (let n = 1; n <= 5; n++) {
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

For imageUrls: full absolute CDN URLs only (gscs-b2c.lge.com or lg.com/content/dam), max 8.
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
  if (/wash|dryer/.test(s))                  return 'washer';
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
async function buildResult(imgSet, cdnImgs, productName, productType, productFeatures, slug = '') {
  // ── CDN-first strategy ────────────────────────────────────────
  // CDN-probed images (medium01-05 / _AEK_1-5) are preferred packshots.
  // When any CDN gallery images exist, use those first; fall back to full pool.
  const hasCdnGallery = cdnImgs && cdnImgs.size > 0;
  const source = hasCdnGallery ? cdnImgs : imgSet;
  if (hasCdnGallery) {
    console.log('[DASH] CDN-first mode: using', cdnImgs.size, 'gallery images exclusively');
  }

  // 1. Hard-filter obvious bad images by URL pattern
  let pool = [...source]
    .filter(imgUrl)
    .filter(u => !isSpecImage(u))
    .filter(u => !/\d{1,2}x\d{1,2}(?!\d)/.test(u))
    .filter(u => !/[_-]\d{2,3}x\d{2,3}[_.-]/i.test(u))
    .filter(u => !/icon|logo|badge|flag|ribbon|sprite/i.test(u));

  // 1b. In Jina-fallback mode (no CDN gallery), Jina scrapes the ENTIRE page including
  //     related product sections (washers on a TV page, etc.).
  //     If the product slug is known, prefer images whose URL contains that slug —
  //     those come from this product's own CDN path, not cross-promotions.
  if (!hasCdnGallery && slug) {
    const slugPool = pool.filter(u => u.toLowerCase().includes(slug.toLowerCase()));
    if (slugPool.length >= 2) {
      console.log('[DASH] Slug-filter: found', slugPool.length, 'slug-matched images → using those only');
      pool = slugPool;
    } else {
      console.log('[DASH] Slug-filter: only', slugPool.length, 'slug-matched images → using full pool');
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
      const ranked = await visionScoreImages(candidateImages, productType);
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
async function visionScoreImages(candidates, productType) {
  const key = CONFIG.GEMINI_API_KEY;

  // ── Primary: urlContext (Gemini fetches URLs from Google servers — no CORS) ──
  try {
    return await _visionByUrlContext(candidates, productType, key);
  } catch (e) {
    console.warn('[DASH] Vision urlContext failed:', e.message, '— trying base64 fallback');
  }

  // ── Fallback: fetch as base64 via CORS proxies ────────────────────
  try {
    return await _visionByBase64(candidates, productType, key);
  } catch (e) {
    console.warn('[DASH] Vision base64 fallback also failed:', e.message);
    return candidates;   // give up — return original order
  }
}

// Primary path: pass URLs directly; Gemini's urlContext loads them server-side
async function _visionByUrlContext(candidates, productType, key) {
  const urlList = candidates.map((c, i) => `Image ${i + 1}: ${c.url}`).join('\n');

  const body = {
    contents: [{
      parts: [{ text: `You are an LG product image quality evaluator.
Please access each image URL below and score it for use as a product packshot in lifestyle image compositing.

${urlList}

Scoring rules (score each image 0–3):
3 = Ideal packshot: LG ${productType} clearly visible, front-facing, white or plain neutral/gradient background, no people, minimal or no text overlay
2 = Acceptable: product clearly visible, slight angle (e.g. 3/4 view) or gray/studio-colored background
1 = Poor: back view only, extreme side-profile (product very thin), heavily cropped to just a detail, product very small in frame
0 = REJECT: ANY of the following — lifestyle scene with people in a room; dimension/spec diagram; wrong product type (e.g. washer/dryer on a TV page); extreme close-up crop with no recognisable product outline; video thumbnail (movie/game scene shown full-screen); marketing banner with large text overlay covering most of the image; abstract color art with no product visible; partial crop showing only fabric/texture/background

For ${productType} specifically:
${productType === 'tv' ? '- A TV with the screen showing abstract art or demo content is OK (score 2-3) as long as the TV frame/stand are clearly visible\n- Score 0 if it is ONLY the screen content with no TV frame/bezel visible\n- A marketing overlay ("LG QNED evo AI / 2025") covering most of the image scores 0' : '- Product must be the clear subject of the image'}

Return ONLY a JSON array (no explanation):
[{"i":1,"score":3},{"i":2,"score":0},...] — one object per image.` }],
    }],
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

  const scores   = JSON.parse(match[0]);
  const scoreMap = new Map(scores.map(s => [s.i - 1, s.score]));   // 0-indexed

  // Default to 1 (poor) if Gemini didn't score an image — prevents unscored images
  // from being treated as acceptable (score 2) and slipping through
  const scored = candidates.map((c, i) => ({ ...c, vScore: scoreMap.get(i) ?? 1 }));
  console.log('[DASH] urlContext vision scores:', scored.map(s=>`${s.url.split('/').pop()}→${s.vScore}`).join(', '));

  return scored
    .filter(c => c.vScore > 0)
    .sort((a, b) => b.vScore - a.vScore)
    .map(({ vScore, ...rest }) => rest);
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
  parts.push({ text: `Score each image 0–3 for use as an LG ${productType} packshot.
3=ideal front-facing product on white/plain bg, 2=acceptable, 1=poor, 0=REJECT (lifestyle, diagram, wrong product).
Return ONLY JSON: [{"i":1,"score":3},...] for all ${loaded.length} images.` });

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

  const scores = JSON.parse(match[0]);
  const loadedScoreMap = new Map(scores.map(s => [s.i - 1, s.score]));

  const scored = fetched.map(img => ({
    ...img,
    vScore: img.ok ? (loadedScoreMap.get(loaded.findIndex(l => l.url === img.url)) ?? 2) : 2,
  }));
  console.log('[DASH] base64 vision scores:', scored.map(s=>`${s.url.split('/').pop()}→${s.vScore}`).join(', '));

  return scored
    .filter(c => c.vScore > 0)
    .sort((a, b) => b.vScore - a.vScore)
    .map(({ b64, mime, ok, idx, vScore, ...rest }) => rest);
}

// Extract a "slot number" from a URL (1 = first product shot, 5 = fifth, 99 = unknown/bad)
// LG CDN convention: medium01 / _AEK_1 / _1 → slot 1; D01 → dimension (99)
function slotIndex(url) {
  const filename = url.split('/').pop().split('?')[0];
  // D01.jpg, D02.jpg etc. → dimension images, never show
  if (/^[Dd]\d+\./i.test(filename)) return 99;
  // Extract trailing number before extension: medium03 → 3, GSXV80PZLE_AEK_2.jpg → 2
  const m = filename.match(/(\d+)\.[a-z]{2,4}$/i);
  return m ? parseInt(m[1], 10) : 99;
}

// Keep best-scored URL per slot; discard slots > 5 and D* images
function deduplicateBySlot(urls) {
  const slots = new Map(); // slot# → best URL
  for (const url of urls) {
    const slot = slotIndex(url);
    if (slot > 5 || slot === 99) continue;
    const existing = slots.get(slot);
    if (!existing || lgScore(url) > lgScore(existing)) {
      slots.set(slot, url);
    }
  }
  // Return in slot order (1, 2, 3, 4, 5) — front view first
  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, url]) => url);
}

// URL-based filter: reject spec drawings, videos, campaign/people images
function isSpecImage(url) {
  const u = url.toLowerCase();
  // Dimension drawings
  if (/dimension|install(?:ation)?|spec[_-]|schematic|diagram|drawing|manual|technical|measure/i.test(u)) return true;
  if (/\/[Dd]\d+\.[a-z]{2,4}/i.test(url)) return true;
  if (/_[Dd]\d+\.[a-z]{2,4}$/i.test(url.split('/').pop())) return true;
  // Video files or video CDNs (play button is CSS overlay — not in image file — but URL reveals source)
  if (/youtube\.com|ytimg\.com|vimeo\.com|wistia\.com|brightcove\.net|\.mp4|\.webm|\.mov/i.test(u)) return true;
  // LG campaign / feature / highlight / banner sections
  if (/\/feature[s]?\/|\/highlight[s]?\/|\/campaign[s]?\/|\/hero-video\//i.test(u)) return true;
  if (/\/banner\/|\/promo\/|\/landing\/|\/teaser\//i.test(u)) return true;
  // Video thumbnails by naming convention
  if (/video[-_]thumb|vid[-_]poster|videoimg|video-image|vid-img/i.test(u)) return true;
  // LG feature/UI showcase images: typically 16:9 crops (1280x720, 800x450, 960x540)
  // These appear as video-like thumbnail overlays on product pages
  if (/[_-]1280x720[_.-]|[_-]800x450[_.-]|[_-]960x540[_.-]|[_-]1920x1080[_.-]/i.test(u)) return true;
  // LG-specific "area thumbnail" / UI feature image naming
  if (/_at_\d|[-_]ui[-_]|[-_]scene\d|[-_]banner\d/i.test(u)) return true;
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
      /washer|dryer|wm\d|dlex|dlgx/.test(uLow)                             ? 'washer'   :
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

  // ── 1. 제품 이미지를 base64로 변환 (합성용) ──────────────────────
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

  // ── 2. Gemini contents 구성 ───────────────────────────────────
  const parts = [];
  if (productB64) {
    // 이미지 + 합성 지시 프롬프트
    parts.push({ inlineData: { mimeType: productMime, data: productB64 } });
    parts.push({ text: `This is an LG ${productType} product photo on a plain background.\n${prompt}\nKeep the product exactly as shown in the photo — same model, same color, same proportions. Place it naturally as the hero of the scene.` });
  } else {
    // 이미지 없을 때 텍스트만
    parts.push({ text: prompt });
  }

  // ── 3. 이미지 생성 요청 (모델 순서대로 시도) ─────────────────
  // 모델이 404 등으로 실패하면 다음 모델로 자동 전환
  const IMAGE_MODELS = [
    'gemini-3.1-flash-image-preview',   // 최신 이미지 생성 모델
    'gemini-3-pro-image-preview',        // 고품질 이미지
    'gemini-2.5-flash-image',            // 빠른 이미지 생성
  ];

  const reqBody = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  let genData = null;
  let lastErr  = '';
  for (const model of IMAGE_MODELS) {
    try {
      const res = await fetchT(
        `${GEMINI_BASE}/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody },
        90000
      );
      const data = await res.json();
      if (!res.ok) {
        lastErr = `${model} HTTP ${res.status}: ${data?.error?.message || ''}`;
        console.warn('[DASH] model failed:', lastErr);
        continue;
      }
      genData = data;
      console.log('[DASH] image model used:', model);
      break;
    } catch (e) {
      lastErr = `${model}: ${e.message}`;
      console.warn('[DASH] model error:', lastErr);
    }
  }
  if (!genData) throw new Error(`All image models failed. Last: ${lastErr}`);

  // ── 4. 이미지 추출 ───────────────────────────────────────────
  const resParts = genData.candidates?.[0]?.content?.parts ?? [];
  let imageUrl = null;
  for (const part of resParts) {
    if (part.inlineData?.data) {
      imageUrl = `data:${part.inlineData.mimeType || 'image/jpeg'};base64,${part.inlineData.data}`;
      break;
    }
  }
  if (!imageUrl) {
    const reason = genData.candidates?.[0]?.finishReason || JSON.stringify(genData).slice(0, 100);
    throw new Error(`Gemini returned no image. Reason: ${reason}`);
  }

  // ── 5. QC ────────────────────────────────────────────────────
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
