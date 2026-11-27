import { useEffect, useId, useState } from 'react'
import mermaidUrl from 'mermaid/dist/mermaid.min.js?url'

let renderer
function loadRenderer() {
  renderer ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = mermaidUrl
    script.onload = () => {
      const mermaid = window.mermaid
      if (!mermaid?.render) { reject(new Error('Diagram renderer unavailable')); return }
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, htmlLabels: false, maxTextSize: 20000, maxEdges: 200 })
      resolve(mermaid)
    }
    script.onerror = () => reject(new Error('Diagram renderer failed to load'))
    document.head.append(script)
  }).catch(error => {
    renderer = undefined
    throw error
  })
  return renderer
}

export default function AnswerDiagram({ source }) {
  const id = useId().replace(/[^a-z0-9_-]/gi, '')
  const [result, setResult] = useState(null)
  useEffect(() => {
    let disposed = false
    let url
    async function render() {
      try {
        if (!source || source.length > 20000 || /^\s*---|%%\s*\{/m.test(source)) throw new Error('Unsupported diagram')
        const mermaid = await loadRenderer()
        if (disposed) return
        const { svg } = await mermaid.render(`answer-diagram-${id}`, source)
        if (disposed) return
        url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        setResult({ source, url })
      } catch {
        if (!disposed) setResult({ source, url: '' })
      }
    }
    void render()
    return () => { disposed = true; if (url) URL.revokeObjectURL(url) }
  }, [id, source])
  if (result?.source !== source) return <p role="status">正在绘制流程图…</p>
  if (!result.url) return <details><summary>流程图未能显示，查看源码</summary><pre>{source}</pre></details>
  return <figure className="answer-diagram"><img src={result.url} alt="回答中的流程图" /></figure>
}
