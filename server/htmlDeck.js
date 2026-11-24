export const HTML_PLAN_MARKER = '[HTML演示稿规划]'
const DATA_MARKER = '<!-- dgen-deck:'

export const HTML_PLAN_PROMPT = `只生成待确认的 HTML 逐页规划。返回一个 JSON 对象，不要输出 HTML。格式为 {"audience":"受众","goal":"目标","theme":"editorial","slides":[{"title":"页面标题","layout":"cover","points":["演示时直接展示的完整短句"],"visual":"视觉建议"}]}。
layout 只用 cover、columns、metrics 或 summary，按内容选择。首页用 cover。每页 1–6 条要点，短而具体，长内容拆页。保留用户给出的事实、数值、单位和限定条件。theme 只用 editorial 或 standard，根据用户需求和所选 Skill 决定，杂志风排版使用 editorial。视觉建议须对应所选版式和主题。修改规划时返回完整的新版规划。`

const layouts = new Set(['cover', 'columns', 'metrics', 'summary'])

export function parseHtmlDeck(value) {
  try {
    const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const deck = JSON.parse(text)
    const hasText = item => typeof item === 'string' && item.trim().length > 0
    if (!['editorial', 'standard'].includes(deck.theme)) return null
    if (!hasText(deck.audience) || !hasText(deck.goal) || !Array.isArray(deck.slides) || !deck.slides.length) return null
    if (!deck.slides.every(slide => slide && hasText(slide.title) && layouts.has(slide.layout) && hasText(slide.visual)
      && Array.isArray(slide.points) && slide.points.length >= 1 && slide.points.length <= 6 && slide.points.every(hasText))) return null
    if (text.length > 12_000) return null
    return deck
  } catch {
    return null
  }
}

export function formatHtmlDeckPlan(deck) {
  const pages = deck.slides.map((slide, index) =>
    [`### 第 ${index + 1} 页 · ${slide.title}`, ...slide.points.map(point => `- ${point}`), `视觉建议：${slide.visual}`].join('\n'))
  const data = Buffer.from(JSON.stringify(deck)).toString('base64')
  return [HTML_PLAN_MARKER, `受众：${deck.audience}\n\n目标：${deck.goal}\n\n主题：${deck.theme === 'editorial' ? '杂志风' : '标准汇报'}`, ...pages,
    '确认后按以上页序和内容生成 HTML 演示稿。', `${DATA_MARKER}${data} -->`].join('\n\n')
}

export function readHtmlDeckPlan(content) {
  const data = content.match(/<!-- dgen-deck:([A-Za-z0-9+/=]+) -->\s*$/)?.[1]
  return data ? parseHtmlDeck(Buffer.from(data, 'base64').toString('utf8')) : null
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

export function renderHtmlDeck(deck) {
  const pages = deck.slides.map((slide, index) => `
<section class="slide ${slide.layout}" ${index ? 'hidden' : ''} aria-label="第 ${index + 1} 页">
  <header>${escapeHtml(deck.slides[0].title)}</header>
  <div class="content">
    <h1>${escapeHtml(slide.title)}</h1>
    <ul>${slide.points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>
  </div>
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
  .editorial { --accent: #155eef; --paper: #f2f5f8 }
  .standard { --accent: #405390; --paper: #fff }
  .slide { background: var(--paper) }
  .editorial .cover h1 { letter-spacing: -.025em }
  .slide[hidden] { display: none }
  header { color: var(--accent); font-weight: 700; font-size: clamp(12px, 1.7cqw, 23px); border-bottom: 1px solid #a8b5c8; padding-bottom: .5em }
  .content { margin-block: auto; padding-block: 1em; font-size: clamp(14px, 2.7cqw, 34px); overflow-wrap: anywhere }
  h1 { margin: 0 0 .6em; line-height: 1.14; font-size: 1.65em }
  .cover h1 { font-size: 2em }
  ul { margin: 0; padding-inline-start: 1.2em }
  li + li { margin-top: .45em }
  .columns ul, .metrics ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65em 1em; list-style: none; padding: 0 }
  .columns li, .metrics li { margin: 0; border-top: 1px solid #a8b5c8; padding-top: .5em }
  .metrics li { color: var(--accent); font-weight: 650 }
  nav { display: flex; justify-content: center; align-items: center; gap: 12px; color: #e7e9ee }
  button { font: inherit; color: inherit; background: #252731; border: 1px solid #666a7b; border-radius: 6px; padding: 5px 12px }
  button:disabled { opacity: .5 }
  @media (max-width: 520px), (max-height: 400px) {
    .slide { width: 100%; height: 100%; aspect-ratio: auto; padding: 18px }
    .content { margin-block: 0; font-size: 16px }
    .columns ul, .metrics ul { grid-template-columns: 1fr }
  }
</style>
</head>
<body class="${deck.theme}">
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
