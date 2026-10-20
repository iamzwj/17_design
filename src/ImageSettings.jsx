import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { imageQualityOptions, supportsImageResolution, VIP_IMAGE_RESOLUTION_OPTIONS } from './imageModels.js'
import './imageSettings.css'

export default function ImageSettings({ model, ratio, ratios, onRatio, resolution, onResolution, quality, onQuality, count = 1, onCount }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null), panel = useRef(null), trigger = useRef(null)
  useEffect(() => {
    if (!open) return
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    panel.current?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true })
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const element = panel.current; if (!element) return
      element.style.transform = ''
      const bounds = element.getBoundingClientRect()
      const shift = Math.max(8 - bounds.left, Math.min(0, window.innerWidth - 8 - bounds.right))
      element.style.transform = `translateX(${shift}px)`
    }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  function shape(value) {
    const [w, h] = value.split(':').map(Number)
    if (!w || !h) return {}
    const scale = 19 / Math.max(w, h)
    return { width: Math.max(6, w * scale), height: Math.max(6, h * scale) }
  }
  const canSetResolution = supportsImageResolution(model)
  return <div className="image-settings" ref={root}>
    <button ref={trigger} className="composer-select-trigger" type="button" aria-label="生成参数" aria-haspopup="dialog" aria-expanded={open} title={`比例 ${ratio}，数量 ${count}，质量 ${quality}，分辨率 ${resolution.toUpperCase()}`} onClick={() => setOpen((value) => !value)}><Icon name="gear" size={14}/><b>参数</b><Icon name="chevron" size={13}/></button>
    {open && <div className="image-settings-panel" ref={panel} role="dialog" aria-label="生成参数"><header><b>生成参数</b><button type="button" aria-label="关闭生成参数" onClick={() => { setOpen(false); trigger.current?.focus() }}><Icon name="x" size={15}/></button></header>
      <fieldset><legend>比例</legend><div className="image-settings-ratios">{ratios.map((option) => <button type="button" key={option.value} aria-pressed={ratio === option.value} onClick={() => onRatio(option.value)}><span className={`ratio-shape${option.value === 'auto' ? ' auto' : ''}`} style={shape(option.value)}/><span>{option.label}</span></button>)}</div></fieldset>
      <fieldset><legend>数量</legend><div className="image-settings-choices">{(onCount ? [1, 2, 3, 4] : [1]).map((value) => <button type="button" key={value} aria-pressed={count === value} onClick={() => onCount?.(value)}>{value} 张</button>)}</div>{!onCount && <small>对话模式每次生成 1 张</small>}</fieldset>
      <fieldset><legend>质量</legend><div className="image-settings-choices">{imageQualityOptions(model).map((option) => <button type="button" key={option.value} aria-pressed={quality === option.value} onClick={() => onQuality(option.value)}>{option.label}</button>)}</div></fieldset>
      <fieldset><legend>分辨率</legend><div className="image-settings-choices">{VIP_IMAGE_RESOLUTION_OPTIONS.map((option) => <button type="button" key={option.value} aria-pressed={resolution === option.value} disabled={!canSetResolution && option.value !== resolution} onClick={() => { if (canSetResolution) onResolution(option.value) }}>{option.label}</button>)}</div>{!canSetResolution && <small>当前模型仅支持 1K</small>}</fieldset>
    </div>}
  </div>
}
