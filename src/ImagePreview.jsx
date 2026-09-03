import { useEffect, useMemo, useState } from 'react'
import { downloadGeneratedImage } from './api.js'
import { Icon } from './icons.jsx'

/** Shared full-screen image preview used by waterfall results and Hub outputs. */
export default function ImagePreview({ url, urls, prompt, onClose }) {
  const images = useMemo(() => {
    const unique = [...new Set((urls || []).filter(Boolean))]
    return unique.length ? unique : url ? [url] : []
  }, [url, urls])
  const [index, setIndex] = useState(() => Math.max(0, images.indexOf(url)))
  const activeUrl = images[index] || images[0] || url
  const canBrowse = images.length > 1

  useEffect(() => {
    const nextIndex = images.indexOf(url)
    setIndex(nextIndex >= 0 ? nextIndex : 0)
  }, [images, url])

  function previous() { setIndex((current) => (current - 1 + images.length) % images.length) }
  function next() { setIndex((current) => (current + 1) % images.length) }

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
      if (canBrowse && event.key === 'ArrowLeft') { event.preventDefault(); previous() }
      if (canBrowse && event.key === 'ArrowRight') { event.preventDefault(); next() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canBrowse, images, onClose])

  async function download() {
    try {
      await downloadGeneratedImage(activeUrl, prompt)
    } catch (error) {
      window.alert(`下载失败：${error.message || '请稍后重试'}`)
    }
  }

  return <div className="image-preview" role="dialog" aria-modal="true" aria-label="图片预览" onClick={onClose}>
    <img src={activeUrl} alt={`AI 生成图片预览 ${index + 1}`} onClick={(event) => event.stopPropagation()}/>
    <div className="preview-actions" onClick={(event) => event.stopPropagation()}>
      {canBrowse && <><button className="preview-nav" type="button" onClick={previous} aria-label="上一张">‹</button><span className="preview-counter">{index + 1} / {images.length}</span><button className="preview-nav" type="button" onClick={next} aria-label="下一张">›</button></>}
      <button className="preview-download" type="button" onClick={() => void download()}><Icon name="download" size={17}/>下载</button>
      <button type="button" onClick={onClose}><Icon name="chevron" size={17}/>返回</button>
    </div>
  </div>
}
