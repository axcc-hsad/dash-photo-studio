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
    analyzing:   'URL을 분석하고 있습니다. 잠시만 기다려주세요.',
    invalidUrl:  '올바른 lg.com 제품 URL을 입력해주세요.\n예: https://www.lg.com/us/refrigerators/lg-LRMVS3006S',

    foundImages: (n, name) => `제품 이미지 ${n}장을 확인했습니다.\n${name}\n합성 적합도 기준으로 1순위를 추천드립니다. 선택 후 진행해주세요.`,
    btnPick:     '이 이미지로 진행',

    regionQ:     '게시할 인테리어 스타일을 선택해주세요.',
    ratioQ:      '이미지 비율을 선택해주세요.',

    promptIntro: '생성 프롬프트를 확인해주세요. 수정이 필요하면 직접 편집 후 진행하세요.',
    btnGenerate: '이미지 생성하기',

    sA: '제품 이미지 분석 중',
    sB: '인테리어 스타일 적용 중',
    sC: '라이프스타일 이미지 생성 중',
    sD: '품질 검수 중',

    resultMsg:   (r) => `${r} 스타일 이미지가 완성됐습니다. 확인해보세요.`,
    qcTitle:     'QC 체크',
    qcLabels:    ['제품 외형 보존', '비율 자연스러움', '배경 조화', '스타일 일치'],
    btnDL:       '다운로드',
    btnEdit:     '수정 요청',
    revLeft:     (n) => `수정 ${n}회 남음`,

    revQ:        '수정 방향을 선택하거나 직접 입력해주세요.',
    revChips:    ['배경 더 밝게', '배경 더 따뜻하게', '소품 줄이기', '스타일 강화', '제품 더 크게', '공간 정돈'],
    revising:    (r) => `수정 요청을 반영합니다. "${r}"\n약 30초 소요됩니다.`,
    revised:     '수정이 완료됐습니다. 결과를 확인해주세요.',
    noRev:       '수정 횟수를 모두 사용했습니다. 다운로드하거나 처음부터 시작해주세요.',
    btnReset:    '처음부터',

    regions: {
      na:   { label:'북미',   sub:'Clean & Bright',   icon:'🇺🇸' },
      eu:   { label:'유럽',   sub:'Minimal & Refined', icon:'🇪🇺' },
      asia: { label:'아시아', sub:'Modern & Elegant',  icon:'🌏' },
      la:   { label:'중남미', sub:'Warm & Natural',    icon:'🌎' },
    },
    ratios: {
      square:    { label:'정사각형', sub:'1 : 1',  icon:'⬛' },
      landscape: { label:'가로형',   sub:'16 : 9', icon:'▬'  },
      portrait:  { label:'세로형',   sub:'4 : 5',  icon:'▮'  },
    },
  },

  en: {
    idxMsg:      `Hello. I'm <span class="em">DASH Photographer</span>.\nCreate lifestyle images for LG.COM products.\nI'll help you make the image you want, easily.`,
    btnStart:    'Get Started',
    placeholder: 'Enter PDP URL.',

    step1:       'Please paste the LG product PDP URL for the lifestyle image you want to create.',
    analyzing:   'Analyzing URL. Please wait a moment.',
    invalidUrl:  'Please enter a valid lg.com product URL.\nExample: https://www.lg.com/us/refrigerators/lg-LRMVS3006S',

    foundImages: (n, name) => `Found ${n} product images.\n${name}\nRecommending the top-ranked for compositing. Please select one.`,
    btnPick:     'Proceed with this image',

    regionQ:     'Select the interior style for posting.',
    ratioQ:      'Select the image ratio.',

    promptIntro: 'Review the generation prompt. Edit if needed, then confirm.',
    btnGenerate: 'Generate Image',

    sA: 'Analyzing product image',
    sB: 'Applying interior style',
    sC: 'Generating lifestyle image',
    sD: 'Quality check',

    resultMsg:   (r) => `${r} style image is ready. Please review.`,
    qcTitle:     'QC Check',
    qcLabels:    ['Product integrity', 'Natural proportions', 'Background harmony', 'Style match'],
    btnDL:       'Download',
    btnEdit:     'Request edit',
    revLeft:     (n) => `${n} revision${n===1?'':'s'} left`,

    revQ:        'Select a revision or type below.',
    revChips:    ['Brighter background', 'Warmer tone', 'Fewer props', 'Stronger style', 'Larger product', 'Cleaner space'],
    revising:    (r) => `Applying revision. "${r}"\nTakes about 30 seconds.`,
    revised:     'Revision complete. Please review.',
    noRev:       'No revisions left. Download or start over.',
    btnReset:    'Start Over',

    regions: {
      na:   { label:'N. America', sub:'Clean & Bright',   icon:'🇺🇸' },
      eu:   { label:'Europe',     sub:'Minimal & Refined', icon:'🇪🇺' },
      asia: { label:'Asia',       sub:'Modern & Elegant',  icon:'🌏' },
      la:   { label:'Lat. Am.',   sub:'Warm & Natural',    icon:'🌎' },
    },
    ratios: {
      square:    { label:'Square',    sub:'1 : 1',  icon:'⬛' },
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
  fridge:'large refrigerator as the hero, front-facing, door handles clearly visible',
  washer:'washing machine centered, door porthole and control panel visible',
  tv:'LG TV as hero, mounted or on stand, slim bezels visible',
  appliance:'LG home appliance as hero, clearly visible and unobstructed',
};
const RATIO_DIMS = {
  square:{w:1024,h:1024}, landscape:{w:1344,h:768}, portrait:{w:832,h:1040},
};

// ══ State ════════════════════════════════════════════════════════
const S = {
  lang:'ko', step:'IDLE', busy:false,
  pdpUrl:'', productName:'', productType:'fridge',
  candidates:[], pickedIdx:0,
  region:'', ratio:'',
  genPrompt:'', resultUrl:'',
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
  $inp.placeholder = T[l].placeholder;
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
  userSay(val);
  $inp.value = '';
  if (S.step === 'URL')    return onUrl(val);
  if (S.step === 'REVISE' || S.step === 'RESULT') return onRevision(val);
}

// ══ Step: URL ════════════════════════════════════════════════════
async function onUrl(url) {
  if (!isUrl(url)) {
    await stream(t('invalidUrl'));
    return;
  }
  S.pdpUrl = url;
  setBusy(true);
  showTyping();
  await delay(1800);
  hideTyping();
  await stream(t('analyzing'));
  await delay(600);

  const data = CONFIG.DEMO_MODE ? demoScrape(url) : await apiCall('scrape-pdp', {url}).catch(() => null);
  if (!data) { await stream(t('invalidUrl')); setBusy(false); return; }

  S.productName = data.productName;
  S.productType = data.productType;
  S.candidates  = data.candidateImages;
  S.pickedIdx   = 0;

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
  const names = {fridge:'LG LRMVS3006S French Door Refrigerator',washer:'LG WM4000HWA Front Load Washer',tv:'LG C3 OLED evo TV',appliance:'LG Appliance'};
  const clr   = {fridge:['e0edf5','d0e2ef','bfd6e8'],washer:['ece8fb','ddd8f8','cdc8ef'],tv:['e8e8e8','dedede','d2d2d2'],appliance:['eee','e5e5e5','ddd']};
  const icon  = {fridge:'🧊',washer:'🫧',tv:'📺',appliance:'📦'}[type];
  const c = clr[type];
  return {
    productName: names[type], productType: type,
    candidateImages: [
      {url:`https://placehold.co/300x300/${c[0]}/555?text=${icon}+Front`,score:4.7,label:S.lang==='ko'?'정면 촬영':'Front View'},
      {url:`https://placehold.co/300x300/${c[1]}/555?text=${icon}+Side`, score:4.0,label:S.lang==='ko'?'측면 촬영':'Side View'},
      {url:`https://placehold.co/300x300/${c[2]}/555?text=${icon}+3/4`,  score:3.6,label:S.lang==='ko'?'3/4 구도':'3/4 View'},
    ],
  };
}

// ══ Image grid ═══════════════════════════════════════════════════
function imageGrid() {
  const wrap = document.createElement('div');
  wrap.className = 'rich-block';
  wrap.innerHTML = `
    <div class="img-grid" id="igrid">
      ${S.candidates.map((c,i) => `
        <div class="img-card${i===0?' sel':''}" onclick="pickImg(${i},this)">
          <img src="${c.url}" alt="${c.label}" loading="lazy"/>
          ${i===0?`<span class="img-badge">★ Best</span>`:''}
          <div class="img-score">${c.label} · ${c.score}★</div>
        </div>`).join('')}
    </div>
    <div class="act-row" style="margin-top:12px">
      <button class="act-btn primary" onclick="confirmImg()">${t('btnPick')}</button>
    </div>`;
  return wrap;
}

function pickImg(i) {
  S.pickedIdx = i;
  document.querySelectorAll('.img-card').forEach((el,j) => el.classList.toggle('sel', j===i));
}

function confirmImg() {
  if (S.step !== 'IMAGES') return;   // guard: ignore stale button clicks
  freezeButtons();
  userSay(S.candidates[S.pickedIdx].label);
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
      <div class="sel-grid cols-4" id="rgrid">
        ${Object.entries(t('regions')).map(([k,v]) => `
          <div class="sel-card" onclick="pickRegion('${k}',this)">
            <div class="sc-icon">${v.icon}</div>
            <div class="sc-label">${v.label}</div>
            <div class="sc-sub">${v.sub}</div>
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
    S.step = 'RATIO';
    updateInputBar();
    showRatio();
  }, 350);
}

// ══ Ratio ════════════════════════════════════════════════════════
async function showRatio() {
  setBusy(true);
  await stream(t('ratioQ'), () => {
    const wrap = document.createElement('div');
    wrap.className = 'rich-block';
    wrap.innerHTML = `
      <div class="sel-grid cols-3" id="rtgrid">
        ${Object.entries(t('ratios')).map(([k,v]) => `
          <div class="sel-card" onclick="pickRatio('${k}',this)">
            <div class="sc-icon">${v.icon}</div>
            <div class="sc-label">${v.label}</div>
            <div class="sc-sub">${v.sub}</div>
          </div>`).join('')}
      </div>`;
    return wrap;
  });
  setBusy(false);
}

function pickRatio(k, el) {
  if (S.step !== 'RATIO') return;   // guard
  S.ratio = k;
  document.querySelectorAll('#rtgrid .sel-card').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  freezeButtons();
  setTimeout(() => {
    userSay(t('ratios')[k].label);
    S.step = 'PROMPT';
    updateInputBar();
    showPrompt();
  }, 350);
}

// ══ Prompt preview ═══════════════════════════════════════════════
async function showPrompt() {
  setBusy(true);
  S.genPrompt = buildPrompt();
  await stream(t('promptIntro'), () => {
    const wrap = document.createElement('div');
    wrap.className = 'rich-block';
    wrap.innerHTML = `
      <div class="prompt-wrap">
        <div class="prompt-head">PROMPT</div>
        <textarea class="prompt-ta" id="ptarea" rows="5">${esc(S.genPrompt)}</textarea>
      </div>
      <div class="act-row" style="margin-top:10px">
        <button class="act-btn primary" onclick="startGen()">${t('btnGenerate')}</button>
      </div>`;
    return wrap;
  });
  setBusy(false);
}

function buildPrompt() {
  const s  = STYLES[S.region];
  const pt = PRODUCT_CTX[S.productType] || PRODUCT_CTX.appliance;
  return `Professional lifestyle interior photography of an LG ${S.productType}.
Product: ${pt}.
Setting: ${s.space}.
Mood: ${s.mood}.
Color palette: ${s.palette}.
Lighting: ${s.light}.
Props: ${s.props}.
Avoid: ${s.avoid}.
The product is the clear hero. No people. Photorealistic, high quality, commercial photography.`;
}

// ══ Generation ═══════════════════════════════════════════════════
async function startGen() {
  if (S.step !== 'PROMPT') return;   // guard
  const ta = document.getElementById('ptarea');
  if (ta) S.genPrompt = ta.value.trim() || S.genPrompt;
  freezeButtons();
  setBusy(true);
  S.step = 'GEN';
  updateInputBar();

  // Progress bubble
  const pid = 'p' + Date.now();
  const {row} = makeAgentRow();
  row.id = pid;
  const bub = row.querySelector('.msg-bub') || (() => { const b=document.createElement('div'); b.className='msg-bub'; row.appendChild(b); return b; })();
  bub.innerHTML = `
    <div class="progress">
      <div class="pstep on" id="${pid}s1"><div class="pspin"></div>${t('sA')}</div>
      <div class="pstep"    id="${pid}s2"><span class="pstep-ico">🎨</span>${t('sB')}</div>
      <div class="pstep"    id="${pid}s3"><span class="pstep-ico">🖼</span>${t('sC')}</div>
      <div class="pstep"    id="${pid}s4"><span class="pstep-ico">🔍</span>${t('sD')}</div>
    </div>`;
  $msgs.appendChild(row);
  scroll();

  await delay(1100); stepDone(pid,1); stepOn(pid,2);
  await delay(1000); stepDone(pid,2); stepOn(pid,3);

  let imgUrl, qc;
  if (CONFIG.DEMO_MODE) {
    await delay(2200);
    const dims={square:'900x900',landscape:'1280x720',portrait:'800x1000'}[S.ratio]||'900x900';
    const col ={fridge:'e4eef5/667',washer:'ece8fb/667',tv:'e8e8e8/555',appliance:'eeeeee/555'}[S.productType]||'e4eef5/667';
    imgUrl = `https://placehold.co/${dims}/${col}?text=DASH+${S.productType}+${S.region.toUpperCase()}`;
    qc = {a:94,b:88,c:91,d:85};
  } else {
    const res = await apiCall('generate-image',{
      productImageUrl:S.candidates[S.pickedIdx].url,
      productType:S.productType, region:S.region,
      ratio:S.ratio, prompt:S.genPrompt,
    }).catch(()=>null);
    if (!res) { stepErr(pid,3); setBusy(false); return; }
    imgUrl = res.imageUrl;
    const qs = res.qcScores||{};
    qc = {a:qs.productIntegrity||90, b:qs.naturalProportions||87, c:qs.backgroundHarmony||89, d:qs.regionalStyleMatch||84};
  }

  stepDone(pid,3); stepOn(pid,4);
  await delay(700); stepDone(pid,4);
  await delay(350);
  document.getElementById(pid)?.remove();

  S.resultUrl = imgUrl;
  S.revisions = 0;
  addHistory(imgUrl);
  await showResult(imgUrl, qc);
  setBusy(false);
}

// ══ Result ═══════════════════════════════════════════════════════
async function showResult(imgUrl, qc) {
  const rl  = t('regions')[S.region]?.label || S.region;
  const rem = S.maxRev - S.revisions;
  const labels = t('qcLabels');

  await stream(t('resultMsg', rl), () => {
    const wrap = document.createElement('div');
    wrap.className = 'rich-block';
    wrap.innerHTML = `
      <img class="result-img" src="${imgUrl}" alt="result" loading="lazy"/>
      <div class="qc-wrap">
        <div class="qc-title">${t('qcTitle')}</div>
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
             <span class="rev-remain">${t('revLeft', rem)}</span>`
          : `<button class="act-btn ghost" onclick="doReset()">${t('btnReset')}</button>`}
      </div>`;
    return wrap;
  });
  S.step = 'RESULT';
  updateInputBar();
}

// ══ Revision ═════════════════════════════════════════════════════
async function showRevPanel() {
  if (S.revisions >= S.maxRev) { await stream(t('noRev')); return; }
  setBusy(true);
  await stream(t('revQ'), () => {
    const wrap = document.createElement('div');
    wrap.className = 'rich-block';
    wrap.innerHTML = `
      <div class="rev-chips">
        ${t('revChips').map(c => `<button class="rev-chip" onclick="applyRev('${esc(c)}')">${c}</button>`).join('')}
      </div>`;
    return wrap;
  });
  setBusy(false);
  S.step = 'REVISE';
  updateInputBar();
}

async function onRevision(text) { await applyRev(text); }

async function applyRev(req) {
  if (S.revisions >= S.maxRev) { await stream(t('noRev')); return; }
  userSay(req);
  S.revisions++;
  setBusy(true);
  showTyping();
  await delay(2600);
  hideTyping();
  await stream(t('revising', req));

  let newUrl, qc;
  if (CONFIG.DEMO_MODE) {
    await delay(800);
    const dims={square:'900x900',landscape:'1280x720',portrait:'800x1000'}[S.ratio]||'900x900';
    newUrl = `https://placehold.co/${dims}/f0eaff/C8102E?text=Revised+v${S.revisions}`;
    qc = {a:93,b:89,c:92,d:87};
  } else {
    const res = await apiCall('generate-image',{
      productImageUrl:S.candidates[S.pickedIdx].url,
      productType:S.productType, region:S.region,
      ratio:S.ratio, prompt:S.genPrompt+`\nRevision: ${req}`,
    }).catch(()=>null);
    if (!res) { setBusy(false); return; }
    newUrl = res.imageUrl;
    const qs = res.qcScores||{};
    qc = {a:qs.productIntegrity||91, b:qs.naturalProportions||87, c:qs.backgroundHarmony||90, d:qs.regionalStyleMatch||86};
  }

  S.resultUrl = newUrl;
  addHistory(newUrl);
  await stream(t('revised'));
  await showResult(newUrl, qc);
  setBusy(false);
}

// ══ History ══════════════════════════════════════════════════════
function addHistory(url) {
  S.history.push(url);
  $hist.innerHTML = '';
  S.history.forEach((u,i) => {
    const d = document.createElement('div');
    d.className = 'hist-thumb' + (i===S.history.length-1?' on':'');
    d.onclick   = () => {
      document.querySelectorAll('.hist-thumb').forEach((el,j)=>el.classList.toggle('on',j===i));
      stream(`v${i+1} — <a href="${u}" target="_blank" style="color:var(--red)">원본 보기</a>`);
    };
    d.innerHTML = `<img src="${u}" alt="v${i+1}"><span class="hist-n">v${i+1}</span>`;
    $hist.appendChild(d);
  });
  $hist.classList.add('show');
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

function doReset() {
  $msgs.innerHTML = ''; $hist.innerHTML = '';
  $hist.classList.remove('show');
  Object.assign(S, {step:'IDLE',busy:false,pdpUrl:'',productName:'',productType:'fridge',candidates:[],pickedIdx:0,region:'',ratio:'',genPrompt:'',resultUrl:'',revisions:0,history:[]});
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

  // Lock bubble height synchronously (text already in DOM from HTML, just hidden)
  // — no await here, so no repaint between measure → clear
  el.style.minHeight = el.offsetHeight + 'px';
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
  el.style.minHeight = '';  // release fixed height after streaming
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
  row.innerHTML = `<div class="avatar ghost"></div><div class="msg-bub">${esc(text)}</div>`;
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

async function apiCall(ep, body) {
  const r = await fetch(`${CONFIG.API_BASE}/${ep}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
