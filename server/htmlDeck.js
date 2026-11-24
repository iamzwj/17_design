export const HTML_PLAN_MARKER = '[HTML演示稿规划]'
const DATA_MARKER = '<!-- dgen-deck:'

export const HTML_PLAN_PROMPT = `只编写待确认的逐页文案。返回一个 JSON 对象：{"version":2,"audience":"受众","goal":"目标","slides":[{"section":"原文所属章节","title":"本页标题","takeaway":"本页核心判断","points":["可直接展示的论据、事实或细节"]}]}。
先通读原文，梳理章节顺序、主次和论证关系，再按原文脉络分页。覆盖全部实质性章节和信息，保留支撑论据、对比关系、因果、专名、日期、数字、单位、统计口径及限定条件。长段落分到多页，不为控制页数删减有效信息，不自行补结论或数字。用章节、页标题、核心判断、支撑要点区分层级。输出可直接上屏的完整文案，不写占位提示或笼统提纲。输出前逐章节核对遗漏和顺序。当前阶段只处理内容，禁止输出风格、布局、配色或视觉建议。修改时返回完整的新 JSON。`

export const HTML_DESIGN_PROMPT = `用户已确认逐页文案。只设计排版，返回 JSON：{"theme":"editorial 或 standard","design":{"name":"风格名称","paper":"#F2F5F8","ink":"#0F172A","accent":"#155EEF","secondary":"#008B74","heading":"serif","align":"left","surface":"rules","density":"airy","weight":"regular","frame":"none","backdrop":"none"},"slides":[{"layout":"cover","focus":"从该页要点原样摘录，可省略"}]}。
slides 条数及顺序必须与已确认稿完全一致。禁止返回或修改任何文案字段。
选定 Skill 时，从其规范提取具体配色、标题字体类型、对齐、边框和留白，并写入 design，禁止用通用主题覆盖 Skill 明确规定的视觉需求。没有明确规定时按风格做合理选择。所有颜色使用六位十六进制，正文与底色保持清晰对比。heading 允许 serif、sans、mono；align 允许 left、center；surface 允许 rules、panels、plain；density 允许 airy、compact；weight 允许 regular、bold。Skill 要求虚线选区及四角手柄时设置 frame 为 selection，要求轮廓波纹时设置 backdrop 为 contour，其余情况分别用 none。
layout 允许 cover、split、columns、metrics、comparison、timeline、summary。根据本页内容关系和 Skill 的构图要求选择。杂志风使用 serif、rules、airy，开篇采用有视觉焦点的 cover，图文论证用 split，指标用 metrics，对照用 comparison。避免全稿反复使用等宽双栏。focus 必须来自 points，不得概括或补造数字。不要输出 HTML 或 CSS。`

const layouts = new Set(['cover', 'split', 'columns', 'metrics', 'comparison', 'timeline', 'summary'])
const choices = {
  heading: ['serif', 'sans', 'mono'],
  align: ['left', 'center'],
  surface: ['rules', 'panels', 'plain'],
  density: ['airy', 'compact'],
  weight: ['regular', 'bold'],
}
const palettes = {
  editorial: { name: '杂志风', paper: '#F2F5F8', ink: '#0F172A', accent: '#155EEF', secondary: '#008B74', heading: 'serif', align: 'left', surface: 'rules', density: 'airy', weight: 'regular' },
  standard: { name: '标准汇报', paper: '#FFFFFF', ink: '#0F172A', accent: '#405390', secondary: '#475569', heading: 'sans', align: 'left', surface: 'plain', density: 'compact', weight: 'bold' },
}
const colorKeys = ['paper', 'ink', 'accent', 'secondary']

function validDesign(design) {
  return design && typeof design.name === 'string' && design.name.trim().length > 0
    && (design.frame === undefined || ['selection', 'none'].includes(design.frame))
    && (design.backdrop === undefined || ['contour', 'none'].includes(design.backdrop))
    && colorKeys.every(key => typeof design[key] === 'string' && /^#[0-9a-f]{6}$/i.test(design[key]))
    && Object.entries(choices).every(([key, options]) => options.includes(design[key]))
}

function luminance(color) {
  const channels = color.slice(1).match(/../g).map(value => {
    const channel = Number.parseInt(value, 16) / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  })
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
}

function readableColor(color, paper, fallback) {
  const [lighter, darker] = [luminance(color), luminance(paper)].sort((a, b) => b - a)
  return (lighter + .05) / (darker + .05) >= 4.5 ? color : fallback
}

const hasText = value => typeof value === 'string' && value.trim().length > 0
const validPoints = points => Array.isArray(points) && points.length > 0 && points.every(hasText)

function parseJson(value) {
  try {
    return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    return null
  }
}

export function parseHtmlDeck(value, { requireDesign = false, contentOnly = false } = {}) {
  if (typeof value !== 'string' || value.length > 48_000) return null
  const deck = parseJson(value)
  if (!hasText(deck?.audience) || !hasText(deck.goal) || !Array.isArray(deck.slides) || !deck.slides.length) return null
  if (!deck.slides.every(slide => hasText(slide?.title) && validPoints(slide.points))) return null
  if (deck.version === 2) {
    if (requireDesign || !deck.slides.every(slide => hasText(slide.section) && hasText(slide.takeaway))) return null
    return {
      version: 2,
      audience: deck.audience,
      goal: deck.goal,
      slides: deck.slides.map(({ section, title, takeaway, points }) => ({ section, title, takeaway, points })),
    }
  }
  if (contentOnly || !Object.hasOwn(palettes, deck.theme) || ((requireDesign || deck.design !== undefined) && !validDesign(deck.design))) return null
  if (!deck.slides.every(slide => layouts.has(slide.layout) && hasText(slide.visual)
    && (slide.focus === undefined || (hasText(slide.focus) && slide.points.some(point => point.includes(slide.focus)))))) return null
  return deck
}

export function applyHtmlDeckDesign(deck, value) {
  const result = parseJson(value)
  if (!result || !Object.hasOwn(palettes, result.theme) || !validDesign(result.design)
    || !Array.isArray(result.slides) || result.slides.length !== deck.slides.length) return null
  if (!result.slides.every((style, index) => style && layouts.has(style.layout)
    && (style.focus === undefined || (hasText(style.focus) && deck.slides[index].points.some(point => point.includes(style.focus)))))) return null
  const slides = deck.slides.map((slide, index) => {
    const { layout, focus } = result.slides[index]
    return { ...slide, layout, focus }
  })
  return { ...deck, theme: result.theme, design: result.design, slides }
}

export function formatHtmlDeckPlan(deck) {
  const pages = deck.slides.map((slide, index) => {
    const heading = `### 第 ${index + 1} 页 · ${slide.title}`
    const hierarchy = deck.version === 2 ? [`所属章节：${slide.section}`, `**核心判断** · ${slide.takeaway}`] : []
    return [heading, ...hierarchy, ...slide.points.map(point => `- ${point}`)].join('\n\n')
  })
  const data = Buffer.from(JSON.stringify(deck)).toString('base64')
  return [HTML_PLAN_MARKER, `受众：${deck.audience}\n\n目标：${deck.goal}`, ...pages,
    '确认后按以上页序和内容生成 HTML 演示稿。', `${DATA_MARKER}${data} -->`].join('\n\n')
}

export function readHtmlDeckPlan(content) {
  const data = content.match(/<!-- dgen-deck:([A-Za-z0-9+/=]+) -->\s*$/)?.[1]
  return data ? parseHtmlDeck(Buffer.from(data, 'base64').toString('utf8')) : null
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function renderPoint(point, emphasis) {
  const index = emphasis ? point.indexOf(emphasis) : -1
  if (index < 0) return escapeHtml(point)
  return escapeHtml(point.slice(0, index)) + `<strong class="focus">${escapeHtml(emphasis)}</strong>` + escapeHtml(point.slice(index + emphasis.length))
}

function slideContent(slide, selectionFrame) {
  const handles = selectionFrame ? '<span class="handles" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ''
  const title = `<h1>${escapeHtml(slide.title)}${handles}</h1>` + (slide.takeaway ? `<p class="takeaway">${escapeHtml(slide.takeaway)}</p>` : '')
  const pointMarkup = point => {
    const number = point.match(/[<>≤≥约±~-]?\s*\d[\d,.]*(?:%|倍|\s*(?:万元|亿元|个月|人|张|元))?/u)?.[0]?.trim()
    const focus = slide.focus && point.includes(slide.focus) ? slide.focus : slide.layout === 'metrics' && !/[<>][a-z/]/i.test(point) ? number : ''
    return `<li>${renderPoint(point, focus)}</li>`
  }
  const list = slide.layout === 'timeline' ? 'ol' : 'ul'
  const leadIndex = slide.layout === 'cover' || slide.layout === 'split'
    ? Math.max(0, slide.points.findIndex(point => slide.focus && point.includes(slide.focus))) : -1
  if (leadIndex >= 0 && slide.points.length > 1) {
    const primary = slide.points[leadIndex]
    const others = slide.points.filter((_, index) => index !== leadIndex)
    const lead = `<p class="lead">${renderPoint(primary, slide.focus)}</p>`
    return `<div class="split-copy">${title}<ul>${others.map(pointMarkup).join('')}</ul></div>${lead}`
  }
  return `${title}<${list}>${slide.points.map(pointMarkup).join('')}</${list}>`
}

export function renderHtmlDeck(deck) {
  const design = deck.design ?? palettes[deck.theme]
  const ink = readableColor(design.ink, design.paper, luminance(design.paper) > .179 ? '#000000' : '#FFFFFF')
  const accent = readableColor(design.accent, design.paper, ink)
  const secondary = readableColor(design.secondary, design.paper, ink)
  const selectionFrame = design.frame === 'selection'
  const contour = design.backdrop === 'contour'
  const pages = deck.slides.map((slide, index) => `
<section class="slide ${slide.layout}" ${index ? 'hidden' : ''} aria-label="第 ${index + 1} 页">
  ${slide.section || index ? `<header>${escapeHtml(slide.section || deck.slides[0].title)}</header>` : ''}
  <div class="content">${slideContent(slide, selectionFrame && slide.layout === 'cover')}</div>
</section>`).join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deck.slides[0].title)}</title>
<style>
  * { box-sizing: border-box }
  body { margin: 0; background: #101116; font: 16px/1.5 system-ui, sans-serif; color: #0f172a }
  main { height: 100vh; height: 100dvh; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 12px; padding: 12px }
  .stage { container-type: size; display: grid; place-items: center; min-width: 0 }
  .slide { width: min(100cqw, 177.7778cqh, 1440px); aspect-ratio: 16 / 9; overflow: auto; container-type: inline-size; background: #f2f5f8; padding: clamp(16px, 4cqw, 64px); display: flex; flex-direction: column }
  body { --paper: ${design.paper}; --ink: ${ink}; --accent: ${accent}; --secondary: ${secondary}; --highlight: ${design.secondary}; --rule: color-mix(in srgb, var(--ink) 24%, var(--paper)); --heading: system-ui, sans-serif; --space: 1em; --weight: 700 }
  .heading-serif { --heading: "Newsreader", "Noto Serif SC", "Songti SC", "SimSun", Georgia, serif }
  .heading-mono { --heading: "Google Sans Code", ui-monospace, monospace }
  .airy { --space: 1.45em }
  .regular { --weight: 600 }
  .slide { background: var(--paper); color: var(--ink) }
  .slide[hidden] { display: none }
  header { color: var(--accent); font-weight: 650; font-size: clamp(12px, 1.5cqw, 21px); border-bottom: 1px solid var(--rule); padding-bottom: .65em }
  .content { margin-block: auto; padding-block: var(--space); font-size: clamp(14px, 2.45cqw, 30px); overflow-wrap: anywhere }
  .center h1, .center .cover .lead { text-align: center }
  h1 { margin: 0 0 .7em; line-height: 1.13; font-family: var(--heading); font-weight: var(--weight); font-size: 1.8em; letter-spacing: -.025em }
  .takeaway { margin: 0 0 .85em; font-weight: 650; color: var(--accent) }
  .cover h1 { color: var(--ink); font-size: clamp(30px, 7cqw, 90px); margin-bottom: .45em }
  ul, ol { margin: 0; padding-inline-start: 1.25em }
  li + li { margin-top: .55em }
  .cover .content:has(.lead), .split .content:has(.lead) { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr); gap: var(--space); align-items: center }
  .lead { margin: 0; border-inline-start: 2px solid var(--highlight); padding-inline-start: var(--space); color: var(--secondary); font-size: 1.1em }
  .focus { color: var(--accent); font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums }
  .lead .focus, .metrics .focus { font-size: clamp(24px, 5.3cqw, 66px); line-height: 1.15 }
  :is(.columns, .metrics, .comparison) ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .7em var(--space); list-style: none; padding: 0 }
  :is(.columns, .metrics, .comparison) li { margin: 0; padding-block: .6em }
  .rules :is(.columns, .metrics) li, .comparison li { border-top: 1px solid var(--rule) }
  .comparison ul { gap: 0 var(--space); border-bottom: 1px solid var(--rule) }
  .panels :is(.columns, .metrics, .comparison) li { background: color-mix(in srgb, var(--accent) 8%, var(--paper)); border-radius: .55em; padding: .75em }
  .plain header { border-color: transparent }
  .timeline ol { border-inline-start: 2px solid var(--rule); margin-inline-start: .25em; padding-inline-start: 1.6em }
  .timeline li::marker { color: var(--accent); font-weight: 650 }
  .contour .cover { background-image: repeating-radial-gradient(ellipse at 50% -70%, transparent 0 24px, #ffffff80 25px 26px), linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--paper)), var(--paper) 85%); }
  .selection .cover h1 { position: relative; border: 1px dashed var(--ink); padding: .22em .35em; font-size: clamp(28px, 5.8cqw, 78px) }
  .handles i { position: absolute; width: 11px; aspect-ratio: 1; background: var(--paper); border: 1px solid var(--ink) }
  .handles i:nth-child(odd) { left: -6px }
  .handles i:nth-child(even) { right: -6px }
  .handles i:nth-child(-n+2) { top: -6px }
  .handles i:nth-child(n+3) { bottom: -6px }
  .selection.center .cover .content:has(.lead) { display: block; width: min(100%, 29em); margin-inline: auto; text-align: center }
  .selection.center .cover .lead { border: 0; padding: 0; margin-top: .8em; color: var(--accent) }
  .selection.center .cover ul { list-style: none; padding: 0 }
  nav { display: flex; justify-content: center; align-items: center; gap: 12px; color: #e7e9ee }
  button { font: inherit; color: inherit; background: #252731; border: 1px solid #666a7b; border-radius: 6px; padding: 5px 12px }
  button:disabled { opacity: .5 }
  @media (max-width: 520px), (max-height: 400px) {
    .slide { width: 100%; height: 100%; aspect-ratio: auto; padding: 18px }
    .content { margin-block: 0; font-size: 16px }
    .cover .content:has(.lead), .split .content:has(.lead), :is(.columns, .metrics, .comparison) ul { grid-template-columns: 1fr }
    .lead { padding-inline-start: .8em }
  }
</style>
</head>
<body class="${deck.theme} heading-${design.heading} ${design.align} ${design.surface} ${design.density} ${design.weight}${selectionFrame ? ' selection' : ''}${contour ? ' contour' : ''}">
<main>
  <div class="stage">${pages}</div>
  <nav aria-label="演示稿翻页">
    <button id="previous" type="button">上一页</button>
    <output id="page" aria-live="polite"></output>
    <button id="next" type="button">下一页</button>
  </nav>
</main>
<script>
  const slides = [...document.querySelectorAll('.slide')];
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const page = document.getElementById('page');
  let index = 0;
  function show(position) {
    if (position < 0 || position >= slides.length) return;
    slides[index].hidden = true;
    index = position;
    slides[index].hidden = false;
    slides[index].scrollTop = 0;
    previous.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    page.textContent = (index + 1) + ' / ' + slides.length;
  }
  previous.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  document.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      show(index + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  show(0);
</script>
</body>
</html>`
}
