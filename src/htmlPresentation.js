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
