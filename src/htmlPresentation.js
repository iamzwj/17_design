export const PRESENTATION_INSTRUCTIONS = '当用户要求制作或修改 HTML 演示稿时，请结合上下文直接输出完整、可独立运行的 HTML，放在一个 html 代码块中。包含响应式版面、页码、上一页和下一页按钮，并支持键盘方向键；仅使用内联 CSS 和 JavaScript，不引用外部字体、脚本或图片。修改时重新输出完整 HTML。无需询问用户保存文件夹，界面提供预览与保存按钮。不要声称生成了 PPTX。'

export function extractPresentation(content) {
  const text = String(content || '')
  const fenced = text.match(/```(?:html)?[ \t]*\n([\s\S]*?)```/i)?.[1]?.trim()
  const html = fenced && /<html\b/i.test(fenced) ? fenced : text.match(/(?:<!doctype\s+html[^>]*>\s*)?<html\b[\s\S]*?<\/html\s*>/i)?.[0]
  return html && /<html\b/i.test(html) && /<\/html\s*>/i.test(html) ? html : ''
}

export function presentationPreview(html) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`
  return '<!doctype html>' + csp + html.replace(/^\s*<!doctype\s+html[^>]*>/i, '')
}
