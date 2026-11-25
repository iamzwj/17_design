const logoMarker = '<!-- DGEN_BRAND_LOGO -->'

export function htmlBrandAccent(sources) {
  for (const { text } of sources) {
    const color = text.match(/(?:品牌主色|标准主色|主色(?:调)?|primary colou?r)[^\n；;。#]{0,35}(#[\da-f]{6})(?![\da-f])/i)?.[1]
    if (color) return color.toUpperCase()
  }
  return null
}

export function htmlBrandPrompt(brand) {
  return [
    '保留所选 Skill 的版式、字体、背景、正文色和组件，只应用以下品牌强调色及正式 Logo。',
    brand.accent && `仅把高亮和强调色设为 var(--dgen-brand-accent, ${brand.accent})，保持其余配色及字面内容。`,
    brand.logo && `在封面或顶部页眉留出空间，在合适位置输出一次 ${logoMarker}，系统会放入正式 Logo；不要自行绘制、替换或猜测 Logo。`,
    !brand.logo && '当前没有正式 Logo 素材，省略 Logo。',
  ].filter(Boolean).join('\n')
}

export function embedHtmlBrand(html, { accent, logo }) {
  if (accent && /^#[\da-f]{6}$/i.test(accent)) {
    html = html.replace(/<\/head\s*>/i, closing => `<style>:root{--dgen-brand-accent:${accent}}</style>${closing}`)
  }
  if (!logo) return html.replaceAll(logoMarker, '')
  if (!/<body\b[^>]*>/i.test(html)) return html
  const image = `<img alt="品牌 Logo" src="${logo}" style="display:block;max-width:min(24%,160px);max-height:44px;width:auto;height:auto;object-fit:contain;object-position:left center;margin-block-end:12px">`
  const bodyStart = html.search(/<body\b/i)
  const body = html.slice(bodyStart)
  if (body.includes(logoMarker)) return html.slice(0, bodyStart).replaceAll(logoMarker, '') + body.replace(logoMarker, image).replaceAll(logoMarker, '')
  return html.replace(/(<body\b[^>]*>[\s\S]*?<header\b[^>]*>|<body\b[^>]*>)/i, '$1' + image)
}
