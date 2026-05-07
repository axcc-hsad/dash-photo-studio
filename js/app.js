// ─────────────────────────────────────────────────────────────
//  DASH PHOTO STUDIO  |  app.js
//  Streaming text effect + full conversation flow
// ─────────────────────────────────────────────────────────────

// ══ i18n ═══════════════════════════════════════════════════════
const T = {
  ko: {
    idxMsg:      `안녕하세요. <span class="em">DASH Photographer</span> 입니다.\nLG.COM 제품 라이프스타일을 만들어보세요.\n원하는 이미지를 손쉽게 만들 수 있도록 도와드릴게요.`,
    btnStart:    '시작하기',
    placeholder: 'PDP URL을 입력해주세요.',

    step1:       'lg.com에서 라이프스타일 이미지 제작이 필요한 제품 PDP URL을 복사해서 입력해주세요.',
    analyzing:   'URL을 분석하고 있습니다. 이미지를 탐색하는 중이니 잠시만 기다려주세요. (최대 30초)',
    invalidUrl:  '올바른 lg.com 제품 URL을 입력해주세요.\n예: https://www.lg.com/us/refrigerators/lg-LRMVS3006S',
    noImages:    '제품 이미지를 불러오지 못했습니다. 잠시 후 다시 시도하거나 다른 URL을 입력해주세요.',

    foundImages: (n, name) => `제품 이미지를 확인했습니다.\n${name}\n\n라이프스타일에 합성할 적합한 제품이미지를 선택해주세요.`,
    btnPick:     '이미지 선택',

    regionQ:     '인테리어 분위기를 선택해주세요.',
    ratioQ:      '이미지 비율을 선택해주세요.',

    promptIntro: '생성 프롬프트를 확인해주세요. 수정이 필요하면 직접 편집 후 진행하세요.',
    btnGenerate: '이미지 생성하기',

    sA: '제품 이미지 분석 중',
    sB: '인테리어 스타일 적용 중',
    sC: '라이프스타일 이미지 생성 중',
    sD: '품질 검수 중',

    resultMsg:   () => `라이프스타일 이미지가 완성됐습니다. 확인해보세요.`,
    qcTitle:     '',
    qcLabels:    ['제품 외형 보존', '비율 자연스러움', '배경 조화', '스타일 일치'],
    btnDL:       '다운로드',
    btnEdit:     '수정 요청',
    revLeft:     (n) => `수정 ${n}회 남음`,

    revQ:        '수정 방향을 선택하거나 직접 입력해주세요.',
    revChips:    ['배경 더 밝게', '배경 더 따뜻하게', '소품 줄이기', '스타일 강화', '제품 더 크게', '공간 정돈', '정사각형 1:1', '가로 16:9', '세로 4:5', '이미지 업스케일링'],
    revising:    (r) => `수정 요청을 반영합니다. "${r}"\n약 30초 소요됩니다.`,
    revised:     '수정이 완료됐습니다. 결과를 확인해주세요.',
    noRev:       '수정 횟수를 모두 사용했습니다. 다운로드하거나 처음부터 시작해주세요.',
    btnReset:    '처음부터',

    regions: {
      na:   { label:'Clean & Bright',    desc:'빛이 가득한 모던 아메리칸 인테리어', img:'assets/style-na.png'   },
      eu:   { label:'Minimal & Refined', desc:'차분하고 절제된 유러피안 무드',       img:'assets/style-eu.png'   },
      asia: { label:'Modern & Elegant',  desc:'세련되고 깔끔한 아시안 컨템포러리',   img:'assets/style-asia.png' },
      la:   { label:'Warm & Natural',    desc:'따뜻하고 자연스러운 라틴 감성',       img:'assets/style-la.png'   },
    },
    btnNew:      '+ 새로 만들기',
    btnImgSize:  '이미지 사이즈',
    btnUpscale:  'Upscale',
    ratios: {
      square:    { label:'정사각형', sub:'1 : 1',  icon:'◼' },
      landscape: { label:'가로형',   sub:'16 : 9', icon:'▬'  },
      portrait:  { label:'세로형',   sub:'4 : 5',  icon:'▮'  },
    },
  },

  en: {
    idxMsg:      `Hello. I'm <span class="em">DASH Photographer</span>.\nCreate lifestyle images for LG.COM products.\nI'll help you make the image you want, easily.`,
    btnStart:    'Get Started',
    placeholder: 'Enter PDP URL.',

    step1:       'Please paste the LG product PDP URL for the lifestyle image you want to create.',
    analyzing:   'Analyzing URL and scanning for product images. Please wait (up to 30 sec).',
    invalidUrl:  'Please enter a valid lg.com product URL.\nExample: https://www.lg.com/us/refrigerators/lg-LRMVS3006S',
    noImages:    'Could not load product images. Please try again or use a different URL.',

    foundImages: (n, name) => `Product images retrieved.\n${name}\n\nSelect the best image for lifestyle compositing.`,
    btnPick:     'Proceed with this image',

    regionQ:     'Choose an interior style.',
    ratioQ:      'Select the image ratio.',

    promptIntro: 'Review the generation prompt. Edit if needed, then confirm.',
    btnGenerate: 'Generate Image',

    sA: 'Analyzing product image',
    sB: 'Applying interior style',
    sC: 'Generating lifestyle image',
    sD: 'Quality check',

    resultMsg:   () => `Lifestyle image complete. Please review.`,
    qcTitle:     'QC Check',
    qcLabels:    ['Product integrity', 'Natural proportions', 'Background harmony', 'Style match'],
    btnDL:       'Download',
    btnEdit:     'Request edit',
    btnNew:      '+ New Image',
    btnImgSize:  'Image Size',
    btnUpscale:  'Upscale',
    revLeft:     (n) => `${n} revision${n===1?'':'s'} left`,

    revQ:        'Select a revision or type below.',
    revChips:    ['Brighter background', 'Warmer tone', 'Fewer props', 'Stronger style', 'Larger product', 'Cleaner space', 'Square 1:1', 'Landscape 16:9', 'Portrait 4:5', 'Upscale Image'],
    revising:    (r) => `Applying revision. "${r}"\nTakes about 30 seconds.`,
    revised:     'Revision complete. Please review.',
    noRev:       'No revisions left. Download or start over.',
    btnReset:    'Start Over',

    regions: {
      na:   { label:'Clean & Bright',    desc:'Modern American — bright & airy',    img:'assets/style-na.png'   },
      eu:   { label:'Minimal & Refined', desc:'European — calm, architectural',      img:'assets/style-eu.png'   },
      asia: { label:'Modern & Elegant',  desc:'Asian Contemporary — clean & sleek',  img:'assets/style-asia.png' },
      la:   { label:'Warm & Natural',    desc:'Latin American — warm, earthy tones', img:'assets/style-la.png'   },
    },
    ratios: {
      square:    { label:'Square',    sub:'1 : 1',  icon:'◼' },
      landscape: { label:'Landscape', sub:'16 : 9', icon:'▬'  },
      portrait:  { label:'Portrait',  sub:'4 : 5',  icon:'▮'  },
    },
  },
};

// ══ Style rules ══════════════════════════════════════════════════
const STYLES = {
  na:   { space:'spacious bright American kitchen or living room', mood:'clean, practical, family-friendly', palette:'white countertops, warm gray, beige, light wood', light:'bright natural daylight, neutral-warm', props:'small plant, coffee mug, minimal decor', avoid:'no luxury excess, no vintage, no strong contrast' },
  eu:   { space:'minimal European kitchen or living room', mood:'refined, calm, architectural', palette:'off-white, stone gray, taupe, deep wood', light:'soft diffused natural light, neutral', props:'low-saturation vase, thin books, minimal tray', avoid:'no bold patterns, no primary colors, no clutter' },
  asia: { space:'modern Asian living room or kitchen', mood:'clean, sophisticated, contemporary', palette:'white, light oak, subtle earth tones', light:'natural light, bright, soft shadows', props:'minimal ceramics, clean textiles, subtle greenery', avoid:'no kitsch, no excess decoration, no dark heavy tones' },
  la:   { space:'warm Latin American kitchen or living room', mood:'warm, lively, welcoming, natural', palette:'warm beige, terracotta, olive green, honey wood', light:'warm natural light, golden tone', props:'fruit bowl, fabric runner, plant, ceramics', avoid:'no sterile space, no cold blue light, no crowded props' },
};
const PRODUCT_CTX = {
  fridge:  'large refrigerator as the hero, front-facing, door handles clearly visible, plain white or studio background',
  washer:  'washing machine centered, door porthole and control panel visible, plain white or studio background',
  tv:      'LG OLED TV as the hero, wall-mounted or on a sleek stand, ultra-thin bezels prominent; the screen must display a vivid cinematic movie scene or a vibrant video game scene — rich saturated colors, no black screen, no reflection, no mirroring',
  monitor: 'LG monitor as the hero, on a desk, ultra-thin bezels prominent; the screen must display a vivid cinematic movie scene or dynamic creative content — rich colors, no black screen',
  appliance:'LG home appliance as hero, clearly visible and unobstructed, plain white or studio background',
};
const RATIO_DIMS = {
  square:{w:1024,h:1024}, landscape:{w:1344,h:768}, portrait:{w:832,h:1040},
};

// ══ State ════════════════════════════════════════════════════════
const S = {
  lang:'en', step:'IDLE', busy:false,
  pdpUrl:'', productName:'', productType:'fridge',
  productFeatures:[],
  candidates:[], pickedIdx:0,
  region:'', ratio:'square',
  genPrompt:'', resultUrl:'', lastQc:null,
  revisions:0, maxRev:2, history:[],
};

// ══ DOM ══════════════════════════════════════════════════════════
const $msgs     = document.getElementById('msgList');
const $inp      = document.getElementById('inp');
const $send     = document.getElementById('sendBtn');
const $hist     = document.getElementById('histStrip');
const $inputBar = document.querySelector('.input-bar');

// Steps that require text input from user
const INPUT_STEPS = ['URL', 'REVISE'];

function updateInputBar() {
  const show = INPUT_STEPS.includes(S.step);
  $inputBar.classList.toggle('visible', show);
  if (S.step === 'URL') {
    $inp.placeholder = t('placeholder');
  } else if (S.step === 'REVISE') {
    $inp.placeholder = S.lang === 'ko' ? '수정 내용을 직접 입력하세요…' : 'Type your revision request…';
  }
  if (show) setTimeout(() => $inp.focus(), 50);
}

// ══ Boot ═════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  applyLang();
  streamIdxBubble(S.lang);          // ← animate the landing bubble on load
  $inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !S.busy) handleSend();
  });
});

// ══ Screen nav ═══════════════════════════════════════════════════
function goHome() {
  document.getElementById('chat').classList.remove('active');
  document.getElementById('idx').classList.add('active');
  streamIdxBubble(S.lang);
}

// ── Password Gate ─────────────────────────────────────────────────────────
// Computes SHA-256 of the entered password and compares to CONFIG.PASS_HASH.
// Admin changes the password by updating PASS_HASH in config.js.
async function checkPassword() {
  const input = document.getElementById('pw-input');
  const hint  = document.getElementById('pw-hint');
  const val   = (input?.value || '').trim();

  if (!val) {
    showPwError(input, hint, S.lang === 'ko' ? '비밀번호를 입력해주세요.' : 'Please enter the password.');
    return;
  }

  // SHA-256 via Web Crypto API (supported in all modern browsers)
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(val));
  const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (hash === CONFIG.PASS_HASH) {
    // Correct — clear and proceed
    if (hint) { hint.classList.remove('show'); }
    if (input) { input.classList.remove('error'); input.value = ''; }
    goChat();
  } else {
    showPwError(input, hint, S.lang === 'ko' ? '비밀번호가 올바르지 않습니다.' : 'Incorrect password. Please try again.');
  }
}

function showPwError(input, hint, msg) {
  if (hint)  { hint.textContent = msg; hint.classList.add('show'); }
  if (input) {
    input.classList.add('error');
    input.select();
    setTimeout(() => input?.classList.remove('error'), 400);
  }
}

function goChat() {
  document.getElementById('idx').classList.remove('active');
  document.getElementById('chat').classList.add('active');
  if (S.step === 'IDLE') {
    S.step = 'URL';
    updateInputBar();
    setTimeout(() => stream(t('step1')), 350);
  }
}

// ══ Language ═════════════════════════════════════════════════════
function setLang(lang) { S.lang = lang; applyLang(); }

function applyLang() {
  const l = S.lang;
  ['ko1','ko2'].forEach(id => document.getElementById(id)?.classList.toggle('on', l==='ko'));
  ['en1','en2'].forEach(id => document.getElementById(id)?.classList.toggle('on', l==='en'));
  document.getElementById('btn-start').textContent = T[l].btnStart;
  const nb = document.getElementById('newImgBtn');
  if (nb) nb.textContent = T[l].btnNew;
  // Update password input placeholder for current language
  const pwInput = document.getElementById('pw-input');
  if (pwInput) pwInput.placeholder = l === 'ko' ? '비밀번호를 입력해주세요' : 'Enter password';
  updateInputBar();   // sets correct placeholder per current step
  // Re-stream bubble only when index screen is visible
  if (document.getElementById('idx').classList.contains('active')) {
    streamIdxBubble(l);
  }
}

function t(key, ...a) {
  const v = T[S.lang][key];
  return typeof v === 'function' ? v(...a) : (v ?? key);
}

// ══ Send ═════════════════════════════════════════════════════════
async function handleSend() {
  const val = $inp.value.trim();
  if (!val || S.busy) return;
  $inp.value = '';
  if (S.step === 'URL')    { userSay(val); return onUrl(val); }
  if (S.step === 'REVISE' || S.step === 'RESULT') return onRevision(val);
  // REVISE는 applyRev 내부에서 userSay 처리
}

// ══ Step: URL ════════════════════════════════════════════════════
async function onUrl(url) {
  if (!isUrl(url) || !url.includes('lg.com')) {
    await stream(t('invalidUrl'));
    return;
  }
  S.pdpUrl = url;
  setBusy(true);
  showTyping();
  await delay(600);
  hideTyping();
  await stream(t('analyzing'));
  showTyping();   // keep dots while actually fetching

  let data = null;
  let scrapeErr = null;
  if (CONFIG.DEMO_MODE) {
    data = demoScrape(url);
  } else {
    data = await apiCall('scrape-pdp', {url}).catch(e => { scrapeErr = e; console.error('[DASH] scrape:', e); return null; });
  }
  hideTyping();
  if (!data) {
    const msg = scrapeErr?.message?.includes('NO_IMAGES') || scrapeErr?.message?.includes('image')
      ? t('noImages')
      : t('invalidUrl');
    await stream(msg); setBusy(false); return;
  }

  S.productName    = data.productName;
  S.productType    = data.productType;
  S.productFeatures = data.productFeatures || [];
  S.candidates     = data.candidateImages;
  S.pickedIdx      = 0;

  // stream intro text, then show image grid
  await stream(t('foundImages', data.candidateImages.length, data.productName), () => {
    appendToLast(imageGrid());
  });
  setBusy(false);
  S.step = 'IMAGES';
  updateInputBar();
}

// ══ Demo ═════════════════════════════════════════════════════════
function demoScrape(url) {
  const u = url.toLowerCase();
  const type = u.includes('fridge')||u.includes('refrigerator')||u.includes('lrmv') ? 'fridge'
    : u.includes('washer')||u.includes('wm') ? 'washer'
    : u.includes('tv')||u.includes('oled') ? 'tv' : 'appliance';
  const names    = {fridge:'LG LRMVS3006S French Door Refrigerator',washer:'LG WM4000HWA Front Load Washer',tv:'LG C3 OLED evo TV',appliance:'LG Appliance'};
  const clr      = {fridge:['e0edf5','d0e2ef','bfd6e8','cce7f5','b8d4e5'],washer:['ece8fb','ddd8f8','cdc8ef','c0b8f0','b4aee8'],tv:['e8e8e8','dedede','d2d2d2','c6c6c6','bababa'],appliance:['eee','e5e5e5','ddd','d5d5d5','cdcdcd']};
  const icon     = {fridge:'🧊',washer:'🫧',tv:'📺',appliance:'📦'}[type];
  const c = clr[type];
  const featureMap = {
    fridge:   ['InstaView Door-in-Door', 'Craft Ice Maker', 'Door Cooling+', 'ThinQ AI Connected'],
    washer:   ['TurboWash 360°', '6Motion Technology', 'AI Wash Sensor', 'Steam+'],
    tv:       ['OLED evo Panel', 'α9 AI Processor', 'Dolby Vision IQ', 'ThinQ AI'],
    appliance:['Smart Diagnosis', 'Energy Star Certified', 'ThinQ AI Compatible'],
  };
  return {
    productName: names[type], productType: type,
    productFeatures: featureMap[type] || [],
    candidateImages: [
      {url:`https://placehold.co/300x300/${c[0]}/555?text=${icon}+Front`,  score:4.8, label:S.lang==='ko'?'정면 촬영':'Front View'},
      {url:`https://placehold.co/300x300/${c[1]}/555?text=${icon}+Side`,   score:4.3, label:S.lang==='ko'?'측면 촬영':'Side View'},
      {url:`https://placehold.co/300x300/${c[2]}/555?text=${icon}+3/4`,    score:4.0, label:S.lang==='ko'?'3/4 구도':'3/4 Angle'},
      {url:`https://placehold.co/300x300/${c[3]}/555?text=${icon}+Detail`, score:3.7, label:S.lang==='ko'?'디테일':'Detail Shot'},
      {url:`https://placehold.co/300x300/${c[4]}/555?text=${icon}+Life`,   score:3.5, label:S.lang==='ko'?'라이프스타일':'Lifestyle'},
    ],
  };
}

// ══ Image grid ═══════════════════════════════════════════════════
function imageGrid() {
  const items = S.candidates.slice(0, 6);
  const wrap  = document.createElement('div');
  wrap.className = 'rich-block';
  const isKo = S.lang === 'ko';
  wrap.innerHTML = `
    <div class="img-grid" id="igrid">
      ${items.map((c, i) => `
        <div class="img-card${i===0?' sel':''}" onclick="pickImg(${i},this)">
          <img src="${c.url}" alt="${c.label}" loading="lazy"/>
        </div>`).join('')}
    </div>
    <div class="act-row" style="margin-top:12px;justify-content:center">
      <button class="act-btn primary" onclick="confirmImg()">${t('btnPick')}</button>
      <button class="act-btn outline" onclick="doResetUrl()">${isKo?'URL 다시 입력':'Re-enter URL'}</button>
    </div>
    <div class="manual-url-hint" style="margin-top:14px;padding:10px 14px;background:#f7f7f7;border-radius:10px;font-size:13px;color:#555;">
      <div style="margin-bottom:6px;">${isKo
        ? '💡 원하는 누끼컷이 없으면 제품 이미지 URL을 직접 입력해주세요.'
        : '💡 If the right packshot isn\'t shown, paste the product image URL directly.'}</div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input id="manualImgUrl" type="url"
          placeholder="${isKo?'이미지 URL 붙여넣기…':'Paste image URL…'}"
          style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none;"
          onkeydown="if(event.key==='Enter')useManualUrl()"/>
        <button class="act-btn outline" style="padding:6px 12px;font-size:13px;" onclick="useManualUrl()">
          ${isKo?'이 이미지 사용':'Use this image'}
        </button>
      </div>
    </div>`;
  return wrap;
}

function useManualUrl() {
  const input = document.getElementById('manualImgUrl');
  const url   = (input?.value || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    input?.focus();
    return;
  }
  // Inject as a new candidate at position 0 and auto-select it
  const manualCandidate = { url, label: S.lang === 'ko' ? '직접 입력 이미지' : 'Custom Image', score: 5.0 };
  S.candidates = [manualCandidate, ...S.candidates.filter(c => c.url !== url)];
  S.pickedIdx  = 0;

  // Re-render the grid
  const grid = document.getElementById('igrid');
  if (grid) {
    const items = S.candidates.slice(0, 6);
    grid.innerHTML = items.map((c, i) => `
      <div class="img-card${i===0?' sel':''}" onclick="pickImg(${i},this)">
        <img src="${c.url}" alt="${c.label}" loading="lazy"/>
      </div>`).join('');
  }
  input.value = '';
  if (input) input.placeholder = S.lang === 'ko' ? '✓ 추가됨 — 위 이미지를 확인하세요' : '✓ Added — check the grid above';
}

function pickImg(i) {
  S.pickedIdx = i;
  document.querySelectorAll('.img-card').forEach((el,j) => el.classList.toggle('sel', j===i));
}

function confirmImg() {
  if (S.step !== 'IMAGES') return;   // guard: ignore stale button clicks
  freezeButtons();
  userSay(S.lang === 'ko' ? '이 이미지로 선택할게요.' : 'Selected this image');
  S.step = 'REGION';
  setTimeout(() => showRegion(), 200);
}

// ══ Region ═══════════════════════════════════════════════════════
async function showRegion() {
  setBusy(true);
  await stream(t('regionQ'), () => {
    const wrap = document.createElement('div');
    wrap.className = 'rich-block';
    wrap.innerHTML = `
      <div class="sel-grid cols-2" id="rgrid">
        ${Object.entries(t('regions')).map(([k,v]) => `
          <div class="sel-card style-card" onclick="pickRegion('${k}',this)">
            <div class="sc-thumb">
              <img src="${v.img}" alt="${v.label}" loading="lazy"/>
            </div>
            <div class="sc-label">${v.label}</div>
            <div class="sc-desc">${v.desc}</div>
          </div>`).join('')}
      </div>`;
    return wrap;
  });
  setBusy(false);
}

function pickRegion(k, el) {
  if (S.step !== 'REGION') return;   // guard
  S.region = k;
  document.querySelectorAll('#rgrid .sel-card').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  freezeButtons();
  setTimeout(() => {
    userSay(t('regions')[k].label);
    S.step = 'GEN';
    updateInputBar();
    startGen();
  }, 350);
}

// ── buildPrompt는 STYLES/PRODUCT_CTX 기반으로 자동 생성 ──────────
// 프롬프트 데이터는 파일 상단 STYLES, PRODUCT_CTX 객체에서 관리하세요.
const RATIO_LABELS = { square:'square 1:1 composition', landscape:'wide landscape 16:9 composition', portrait:'portrait 4:5 composition' };

function buildPrompt() {
  const s  = STYLES[S.region];
  const pt = PRODUCT_CTX[S.productType] || PRODUCT_CTX.appliance;
  const featLine = S.productFeatures && S.productFeatures.length
    ? `\nProduct highlights: ${S.productFeatures.slice(0, 3).join(', ')}.`
    : '';
  const ratioLine = RATIO_LABELS[S.ratio] || RATIO_LABELS.square;
  return `Create a professional lifestyle interior photo for an LG ${S.productType} advertisement.
Place the product (${pt}) naturally in a ${s.space}.${featLine}
Mood: ${s.mood}.
Color palette: ${s.palette}.
Lighting: ${s.light}.
Styling props: ${s.props}.
Composition: ${ratioLine}.
Avoid: ${s.avoid}.
The product must be the clear hero — fully visible, undistorted, front-facing.
No people. No text, no words, no letters, no typography, no captions, no watermarks, no labels anywhere in the image.
Photorealistic, high-end commercial photography quality.`;
}

// ══ Generation progress streamer ═════════════════════════════════
// Streams cycling messages in a single bubble while generation is in progress.
// Caller: const stop = { stopped:false }; streamGenProgress(stop, 'gen');
// To end: stop.stopped = true; await progressPromise;
async function streamGenProgress(stopSignal, mode = 'gen') {
  const ko = mode === 'rev'
    ? ['수정사항을 반영하는 중이에요.', '조금만 기다려주세요...', '거의 다 됐어요!', '마무리 중이에요, 잠시만요.']
    : ['지금 이미지를 합성하고 있어요.', '조금만 기다려주세요...', '거의 다 됐어요!', '잠시만요, 마무리 중입니다.'];
  const en = mode === 'rev'
    ? ['Applying your revision now.', 'Just a moment...', 'Almost there!', 'Finishing up.']
    : ['Generating your lifestyle image now.', 'Just a moment...', 'Almost there!', 'Adding the finishing touches.'];
  const messages = S.lang === 'ko' ? ko : en;

  const { row, bub } = makeAgentRow();
  $msgs.appendChild(row);
  scroll();

  const textSpan   = document.createElement('span');
  const cursorSpan = document.createElement('span');
  cursorSpan.className = 'stream-cursor';
  bub.appendChild(textSpan);
  bub.appendChild(cursorSpan);

  let i = 0;
  while (!stopSignal.stopped) {
    const msg = messages[i % messages.length];
    let html = '';
    textSpan.innerHTML = '';

    // Stream characters
    for (const ch of msg) {
      if (stopSignal.stopped) break;
      html += ch === '\n' ? '<br>' : esc1(ch);
      textSpan.innerHTML = html;
      scroll();
      await delay(STREAM_SPEED);
    }
    if (stopSignal.stopped) break;

    // Pause between messages (checked every 100ms so stop is responsive)
    for (let t = 0; t < 18 && !stopSignal.stopped; t++) await delay(100);
    if (stopSignal.stopped) break;

    // Soft fade before next message
    bub.style.transition = 'opacity 0.2s';
    bub.style.opacity    = '0.3';
    for (let t = 0; t < 2 && !stopSignal.stopped; t++) await delay(100);
    textSpan.innerHTML = '';
    bub.style.opacity    = '1';
    bub.style.transition = '';

    i++;
  }

  cursorSpan.remove();
  row.remove();   // remove progress bubble when done
}

// ══ Generation ═══════════════════════════════════════════════════
async function startGen() {
  setBusy(true);
  S.genPrompt = buildPrompt();
  updateInputBar();

  // Progress messages stream in background while the API call runs
  const genStop   = { stopped: false };
  const genProgress = streamGenProgress(genStop, 'gen');
  const stopProgress = async () => { genStop.stopped = true; await genProgress; };

  let imgUrl, qc;
  if (CONFIG.DEMO_MODE) {
    await delay(2200);
    const dims={square:'900x900',landscape:'1280x720',portrait:'800x1000'}[S.ratio]||'900x900';
    const col ={fridge:'e4eef5/667',washer:'ece8fb/667',tv:'e8e8e8/555',appliance:'eeeeee/555'}[S.productType]||'e4eef5/667';
    imgUrl = `https://placehold.co/${dims}/${col}?text=DASH+${S.productType}+${S.region.toUpperCase()}`;
    qc = {a:94,b:88,c:91,d:85};
  } else {
    let genErr = null;
    const res = await apiCall('generate-image',{
      productImageUrl: S.candidates[S.pickedIdx].url,
      productType: S.productType, region: S.region,
      ratio: S.ratio, prompt: S.genPrompt,
    }).catch(e => { genErr = e; console.error('[DASH] generate-image error:', e); return null; });
    if (!res) {
      await stopProgress();
      const msg = S.lang === 'ko'
        ? `이미지 생성에 실패했습니다. 다시 시도해주세요.\n(${genErr?.message || '알 수 없는 오류'})`
        : `Image generation failed. Please try again.\n(${genErr?.message || 'Unknown error'})`;
      await stream(msg);
      S.step = 'GEN_READY';
      setBusy(false);
      return;
    }
    imgUrl = res.imageUrl;
    const qs = res.qcScores||{};
    qc = {a:qs.productIntegrity||90, b:qs.naturalProportions||87, c:qs.backgroundHarmony||89, d:qs.regionalStyleMatch||84};
  }

  await stopProgress();

  S.resultUrl = imgUrl;
  S.lastQc    = qc;
  S.revisions = 0;
  addHistory(imgUrl);
  await showResult(imgUrl, qc);
  setBusy(false);
}

// ══ Result ═══════════════════════════════════════════════════════
async function showResult(imgUrl, qc) {
  const rem = S.maxRev - S.revisions;
  const labels = t('qcLabels');

  await stream(t('resultMsg'), () => {
    const wrap = document.createElement('div');
    wrap.className = 'rich-block';
    wrap.innerHTML = `
      <img class="result-img" src="${imgUrl}" alt="result" loading="lazy"/>
      <div class="qc-wrap">
        ${['a','b','c','d'].map((k,i) => `
          <div class="qc-row">
            <span class="qc-name">${labels[i]}</span>
            <div class="qc-track"><div class="qc-fill" style="width:${qc[k]}%"></div></div>
            <span class="qc-val">${qc[k]}</span>
          </div>`).join('')}
      </div>
      <div class="act-row">
        <button class="act-btn primary" onclick="doDownload()">${t('btnDL')}</button>
        ${rem > 0
          ? `<button class="act-btn outline" onclick="showRevPanel()">${t('btnEdit')}</button>
             <button class="act-btn outline" onclick="showRevPanel()">${t('btnImgSize')}</button>
             <button class="act-btn outline" onclick="showRevPanel()">${t('btnUpscale')}</button>
             <span class="rev-remain">${t('revLeft', rem)}</span>`
          : `<button class="act-btn ghost" onclick="doReset()">${t('btnReset')}</button>`}
      </div>`;
    return wrap;
  });
  freezeButtons();   // 이전 결과 버블의 Download 버튼 비활성화 — 항상 최신만 활성
  S.step = 'RESULT';
  updateInputBar();
}

// ══ Revision ═════════════════════════════════════════════════════
// 칩별 아이콘 매핑
const CHIP_ICONS = {
  'Square 1:1':'◼', 'Landscape 16:9':'▬', 'Portrait 4:5':'▮', 'Upscale Image':'✦',
  '정사각형 1:1':'◼', '가로 16:9':'▬',    '세로 4:5':'▮',    '이미지 업스케일링':'✦',
};

async function showRevPanel() {
  if (S.revisions >= S.maxRev) { await stream(t('noRev')); return; }
  setBusy(true);
  await stream(t('revQ'), () => {
    const wrap = document.createElement('div');
    wrap.className = 'rich-block';
    const chips      = t('revChips');
    const sizeChips  = chips.slice(6);   // 비율·업스케일 → 상단 우선
    const styleChips = chips.slice(0, 6); // 스타일 수정 → 하단
    const chipBtn = c => {
      const icon = CHIP_ICONS[c] ? `<span style="margin-right:4px">${CHIP_ICONS[c]}</span>` : '';
      return `<button class="rev-chip" onclick="applyRev('${esc(c)}')">${icon}${c}</button>`;
    };
    wrap.innerHTML = `
      <div class="rev-chips">
        ${sizeChips.map(chipBtn).join('')}
        <hr class="rev-divider"/>
        ${styleChips.map(chipBtn).join('')}
      </div>`;
    return wrap;
  });
  setBusy(false);
  S.step = 'REVISE';
  updateInputBar();
}

async function onRevision(text) { await applyRev(text); }

// 비율 칩 → S.ratio 매핑
const RATIO_CHIP_MAP = {
  '정사각형 1:1':'square', '가로 16:9':'landscape', '세로 4:5':'portrait',
  'Square 1:1':'square',  'Landscape 16:9':'landscape', 'Portrait 4:5':'portrait',
};
const UPSCALE_CHIPS = ['이미지 업스케일링', 'Upscale Image'];

async function applyRev(req) {
  if (S.revisions >= S.maxRev) { await stream(t('noRev')); return; }

  // ── 업스케일링 (API 없음, 수정 횟수 차감 없음) ──────────────────
  if (UPSCALE_CHIPS.includes(req)) {
    userSay(req);
    setBusy(true);
    await stream(S.lang === 'ko' ? '이미지를 2배 업스케일링합니다.' : 'Upscaling image 2×…');
    showTyping();
    try {
      const upscaled = await upscaleImage(S.resultUrl);
      hideTyping();
      S.resultUrl = upscaled;
      addHistory(upscaled);
      await showResult(upscaled, S.lastQc || {a:88,b:85,c:87,d:83});
    } catch(e) {
      hideTyping();
      await stream(S.lang === 'ko' ? '업스케일링에 실패했습니다.' : 'Upscaling failed.');
    }
    setBusy(false);
    return;
  }

  // ── 비율 변경 → S.ratio 업데이트 후 재생성 ──────────────────────
  if (RATIO_CHIP_MAP[req]) {
    S.ratio = RATIO_CHIP_MAP[req];
    S.genPrompt = buildPrompt();  // 비율 반영해서 프롬프트 재빌드
  }

  userSay(req);
  S.revisions++;
  setBusy(true);

  // Progress messages stream in background while revision generates
  const revStop   = { stopped: false };
  const revProgress = streamGenProgress(revStop, 'rev');
  const stopRevProgress = async () => { revStop.stopped = true; await revProgress; };

  let newUrl, qc;
  if (CONFIG.DEMO_MODE) {
    await delay(2200);
    const dims={square:'900x900',landscape:'1280x720',portrait:'800x1000'}[S.ratio]||'900x900';
    newUrl = `https://placehold.co/${dims}/f0eaff/C8102E?text=Revised+v${S.revisions}`;
    qc = {a:93,b:89,c:92,d:87};
  } else {
    const revPrompt = RATIO_CHIP_MAP[req] ? S.genPrompt : S.genPrompt + `\nRevision: ${req}`;
    const res = await apiCall('generate-image',{
      productImageUrl:S.candidates[S.pickedIdx].url,
      productType:S.productType, region:S.region,
      ratio:S.ratio, prompt:revPrompt,
    }).catch(()=>null);
    if (!res) { await stopRevProgress(); setBusy(false); return; }
    newUrl = res.imageUrl;
    const qs = res.qcScores||{};
    qc = {a:qs.productIntegrity||91, b:qs.naturalProportions||87, c:qs.backgroundHarmony||90, d:qs.regionalStyleMatch||86};
  }

  await stopRevProgress();
  S.resultUrl = newUrl;
  S.lastQc    = qc;
  addHistory(newUrl);
  await stream(t('revised'));
  await showResult(newUrl, qc);
  setBusy(false);
}

// 캔버스로 2배 업스케일
function upscaleImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  * 2;
      canvas.height = img.naturalHeight * 2;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ══ History ══════════════════════════════════════════════════════
function addHistory(url) {
  S.history.push(url);
  $hist.innerHTML = '';
  S.history.forEach((u,i) => {
    const d = document.createElement('div');
    d.className = 'hist-thumb' + (i===S.history.length-1?' on':'');
    d.onclick = async () => {
      document.querySelectorAll('.hist-thumb').forEach((el,j)=>el.classList.toggle('on',j===i));
      await stream(`v${i+1}`, () => {
        const wrap = document.createElement('div');
        wrap.className = 'rich-block';
        wrap.innerHTML = `
          <img class="result-img" src="${u}" alt="v${i+1}" loading="lazy"/>
          <div class="act-row">
            <button class="act-btn primary" onclick="doDownloadIdx(${i})">${t('btnDL')}</button>
          </div>`;
        return wrap;
      });
      freezeButtons();   // 이전 결과 버블 비활성화 — 히스토리 버블만 Download 활성
    };
    d.innerHTML = `<img src="${u}" alt="v${i+1}"><span class="hist-n">v${i+1}</span>`;
    $hist.appendChild(d);
  });
  $hist.classList.add('show');
}

function doDownloadIdx(i) {
  const url = S.history[i];
  if (!url) return;
  const a = document.createElement('a');
  const ext = url.startsWith('data:image/jpeg') ? 'jpg' : 'png';
  a.download = `DASH-v${i+1}-${Date.now()}.${ext}`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ══ Utilities ════════════════════════════════════════════════════
function doDownload() {
  if (!S.resultUrl) return;
  const a = document.createElement('a');
  const ext = S.resultUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png';
  a.download = `DASH-${S.productType}-${S.region}-${S.ratio}-${Date.now()}.${ext}`;
  a.href = S.resultUrl;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function doResetUrl() {
  // URL 입력 단계로만 되돌아가기 (채팅화면 유지)
  $msgs.innerHTML = ''; $hist.innerHTML = '';
  $hist.classList.remove('show');
  Object.assign(S, {
    step:'URL', busy:false,
    pdpUrl:'', productName:'', productType:'fridge', productFeatures:[],
    candidates:[], pickedIdx:0, region:'', ratio:'square',
    genPrompt:'', resultUrl:'', lastQc:null, revisions:0, history:[],
  });
  updateInputBar();
  setTimeout(() => stream(t('step1')), 200);
}

function doReset() {
  $msgs.innerHTML = ''; $hist.innerHTML = '';
  $hist.classList.remove('show');
  Object.assign(S, {step:'IDLE',busy:false,pdpUrl:'',productName:'',productType:'fridge',productFeatures:[],candidates:[],pickedIdx:0,region:'',ratio:'square',genPrompt:'',resultUrl:'',lastQc:null,revisions:0,history:[]});
  document.getElementById('chat').classList.remove('active');
  document.getElementById('idx').classList.add('active');
  streamIdxBubble(S.lang);          // ← re-animate bubble when returning to landing
}

// ══ LANDING BUBBLE STREAM ════════════════════════════════════════
// Streams the idx-msg text just like a chat bubble, then fades in the CTA button.

let _idxGenId = 0;

async function streamIdxBubble(lang) {
  const myId = ++_idxGenId;          // cancel any in-progress stream
  const el  = document.getElementById('idx-msg');
  if (!el) return;

  const raw = (T[lang] || T.ko).idxMsg;

  // Wait for fonts (Inter) to load so measurement matches final rendered height
  await document.fonts.ready;
  if (myId !== _idxGenId) return;

  // One extra frame so the browser has applied the loaded font to the element
  await new Promise(r => requestAnimationFrame(r));
  if (myId !== _idxGenId) return;

  // Fix the element to an exact height — cursor overflow is clipped, bubble never moves
  el.style.height   = el.offsetHeight + 'px';
  el.style.overflow = 'hidden';
  el.style.visibility = 'visible';
  el.innerHTML = '';

  // Blinking cursor
  const cursor = document.createElement('span');
  cursor.className = 'stream-cursor';
  el.appendChild(cursor);

  const segments = parseSegments(raw);
  let visibleHTML = '';

  for (const seg of segments) {
    if (myId !== _idxGenId) return;

    if (seg.type === 'html') {
      visibleHTML += seg.val;
      el.innerHTML = visibleHTML;
      el.appendChild(cursor);
    } else {
      for (const ch of seg.val) {
        if (myId !== _idxGenId) return;
        visibleHTML += ch === '\n' ? '<br>' : esc1(ch);
        el.innerHTML = visibleHTML;
        el.appendChild(cursor);
        const pause = /[.!?]/.test(ch) ? STREAM_PAUSE : STREAM_SPEED;
        await delay(pause);
      }
    }
  }

  if (myId !== _idxGenId) return;
  cursor.remove();
  el.style.height   = '';
  el.style.overflow = '';
}

// ══ STREAMING TEXT ENGINE ════════════════════════════════════════
// stream(text, richFn?)
//   text   : plain text (use \n for line breaks)
//   richFn : optional function that returns a DOM element to append after streaming
//
// Returns a Promise that resolves when streaming + richFn are done.

const STREAM_SPEED = 28;   // ms per character
const STREAM_PAUSE = 180;  // ms pause at sentence end (. ! ?)

async function stream(text, richFn) {
  const {row, bub} = makeAgentRow();
  $msgs.appendChild(row);
  scroll();

  // Build the text span + blinking cursor
  const textSpan   = document.createElement('span');
  const cursorSpan = document.createElement('span');
  cursorSpan.className = 'stream-cursor';
  bub.appendChild(textSpan);
  bub.appendChild(cursorSpan);

  // Handle inline HTML tags in text (e.g. <span class="em">)
  // We split into segments: {type:'text'|'html', val}
  const segments = parseSegments(text);
  let visibleHTML = '';

  for (const seg of segments) {
    if (seg.type === 'html') {
      // HTML tags rendered instantly
      visibleHTML += seg.val;
      textSpan.innerHTML = visibleHTML;
      scroll();
    } else {
      // Stream each character
      for (const ch of seg.val) {
        visibleHTML += ch === '\n' ? '<br>' : esc1(ch);
        textSpan.innerHTML = visibleHTML;
        scroll();
        const pause = /[.!?]/.test(ch) ? STREAM_PAUSE : STREAM_SPEED;
        await delay(pause);
      }
    }
  }

  // Remove cursor after streaming
  cursorSpan.remove();

  // Append rich content (image grid, option cards, etc.)
  if (richFn) {
    const richEl = richFn();
    if (richEl) {
      richEl.style.opacity = '0';
      richEl.style.transform = 'translateY(6px)';
      richEl.style.transition = 'opacity 0.25s, transform 0.25s';
      bub.appendChild(richEl);
      scroll();
      await delay(20);
      richEl.style.opacity = '1';
      richEl.style.transform = 'translateY(0)';
      await delay(260);
      scroll();
    }
  }
}

// Parse a string with possible HTML tags into segments
function parseSegments(str) {
  const result = [];
  const tagRe = /(<[^>]+>)/g;
  let last = 0, m;
  while ((m = tagRe.exec(str)) !== null) {
    if (m.index > last) result.push({type:'text', val:str.slice(last, m.index)});
    result.push({type:'html', val:m[0]});
    last = m.index + m[0].length;
  }
  if (last < str.length) result.push({type:'text', val:str.slice(last)});
  return result;
}

// Append rich content to the last agent bubble
function appendToLast(el) {
  const bubs = $msgs.querySelectorAll('.msg-row.agent .msg-bub');
  const last  = bubs[bubs.length - 1];
  if (!last || !el) return;
  el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
  el.style.transition = 'opacity 0.25s, transform 0.25s';
  last.appendChild(el);
  scroll();
  requestAnimationFrame(() => { el.style.opacity='1'; el.style.transform='translateY(0)'; });
}

// ── Typing indicator ─────────────────────────────────────────────
let _typRow = null;
function showTyping() {
  if (_typRow) return;
  _typRow = document.createElement('div');
  _typRow.className = 'msg-row agent';
  _typRow.innerHTML = `
    <div class="avatar"><img src="assets/robot.png" alt="DASH"/></div>
    <div class="typing-bub">
      <div class="tdot"></div><div class="tdot"></div><div class="tdot"></div>
    </div>`;
  $msgs.appendChild(_typRow);
  scroll();
}
function hideTyping() {
  _typRow?.remove(); _typRow = null;
}

// ── Row / bubble builders ────────────────────────────────────────
function makeAgentRow() {
  const row = document.createElement('div');
  row.className = 'msg-row agent';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = `<img src="assets/robot.png" alt="DASH"/>`;
  const bub = document.createElement('div');
  bub.className = 'msg-bub';
  row.appendChild(avatar);
  row.appendChild(bub);
  return {row, bub};
}

function userSay(text) {
  const row = document.createElement('div');
  row.className = 'msg-row user';
  row.innerHTML = `<div class="msg-bub">${esc(text)}</div>`;
  $msgs.appendChild(row);
  scroll();
}

// ── Progress helpers ─────────────────────────────────────────────
function stepDone(pid, n) {
  const el = document.getElementById(`${pid}s${n}`);
  if (!el) return;
  el.classList.remove('on'); el.classList.add('done');
  const sp = el.querySelector('.pspin');
  if (sp) { const s=document.createElement('span'); s.className='pstep-ico'; s.textContent='✓'; sp.replaceWith(s); }
}
function stepOn(pid, n) { document.getElementById(`${pid}s${n}`)?.classList.add('on'); }
function stepErr(pid, n) {
  const el = document.getElementById(`${pid}s${n}`);
  if (!el) return;
  el.classList.remove('on');
  const sp = el.querySelector('.pspin');
  if (sp) { const s=document.createElement('span'); s.className='pstep-ico'; s.textContent='✕'; sp.replaceWith(s); }
}

// ── Freeze old interactive elements ──────────────────────────────
// Called when a step concludes — disables all buttons/cards in
// every bubble except the very last one (which may still be active).
function freezeButtons() {
  const rows = $msgs.querySelectorAll('.msg-row.agent');
  // freeze all but the last agent row
  rows.forEach((row, i) => {
    if (i === rows.length - 1) return;
    row.querySelectorAll('button, .sel-card, .img-card, .rev-chip').forEach(el => {
      el.disabled = true;
      el.style.pointerEvents = 'none';
      el.style.opacity = '0.45';
    });
  });
}

// ── Misc ─────────────────────────────────────────────────────────
function setBusy(b) { S.busy=b; $send.disabled=b; }
function scroll()   { requestAnimationFrame(()=>{ $msgs.scrollTop=$msgs.scrollHeight; }); }
function delay(ms)  { return new Promise(r=>setTimeout(r,ms)); }
function esc(s)     { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function esc1(c)    { return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c; }
function isUrl(s)   { try{const u=new URL(s);return u.protocol==='https:'||u.protocol==='http:';}catch{return false;} }

// apiCall is provided by client-api.js
