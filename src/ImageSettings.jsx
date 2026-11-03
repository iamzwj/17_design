import { CUSTOM_IMAGE_SIZE, supportsCustomImageSize, parseCustomImageSize, customImageEdgeBounds, normalizeCustomImageSize } from '../shared/customImageSize.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { imageQualityOptions, supportsImageResolution, VIP_IMAGE_RESOLUTION_OPTIONS } from './imageModels.js'
import './imageSettings.css'

export default function ImageSettings({ model, ratio, ratios, onRatio, resolution, onResolution, quality, onQuality, count = 1, onCount }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ width: '1024', height: '1024' })
  const customSize = parseCustomImageSize(ratio)
  const canCustomize = supportsCustomImageSize(model)
  const isCustom = Boolean(customSize && canCustomize)
  const widthBounds = customImageEdgeBounds(customSize?.height || 1024)
  const heightBounds = customImageEdgeBounds(customSize?.width || 1024)
  useEffect(() => { const size = parseCustomImageSize(ratio); if (size) setDraft({ width: String(size.width), height: String(size.height) }) }, [ratio])
  function commitCustom(edge, value = draft[edge]) {
    const size = normalizeCustomImageSize(edge === 'width' ? value : draft.width, edge === 'height' ? value : draft.height, edge)
    setDraft({ width: String(size.width), height: String(size.height) })
    onRatio(`${size.width}x${size.height}`)
  }
  function changeCustom(edge, value) {
    setDraft((previous) => ({ ...previous, [edge]: value }))
    const number = Number(value)
    if (value && Number.isInteger(number) && number >= CUSTOM_IMAGE_SIZE.minEdge && number <= CUSTOM_IMAGE_SIZE.maxEdge && number % CUSTOM_IMAGE_SIZE.step === 0) commitCustom(edge, value)
  }
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
  const qualityOptions = imageQualityOptions(model)
  const canSetResolution = supportsImageResolution(model)
  return <div className="image-settings" ref={root}>
    <button ref={trigger} className="composer-select-trigger" type="button" aria-label="生成参数" aria-haspopup="dialog" aria-expanded={open} title={`${isCustom ? `尺寸 ${customSize.width} × ${customSize.height} px` : `比例 ${ratio}，分辨率 ${resolution.toUpperCase()}`}，数量 ${count}${qualityOptions.length ? `，质量 ${quality}` : ''}`} onClick={() => setOpen((value) => !value)}><Icon name="gear" size={14}/><b>参数</b><Icon name="chevron" size={13}/></button>
    {open && <div className="image-settings-panel" ref={panel} role="dialog" aria-label="生成参数"><header><b>生成参数</b><button type="button" aria-label="关闭生成参数" onClick={() => { setOpen(false); trigger.current?.focus() }}><Icon name="x" size={15}/></button></header>
      <fieldset><legend>比例</legend><div className="image-settings-ratios">{ratios.map((option) => <button type="button" key={option.value} aria-pressed={ratio === option.value} onClick={() => onRatio(option.value)}><span className={`ratio-shape${option.value === 'auto' ? ' auto' : ''}`} style={shape(option.value)}/><span>{option.label}</span></button>)}</div></fieldset>
      <fieldset className="image-custom-size"><legend>自定义</legend><button className="image-custom-toggle" type="button" disabled={!canCustomize} aria-pressed={isCustom} onClick={() => commitCustom('width')}>{isCustom ? `自定义尺寸 · ${customSize.width} × ${customSize.height} px` : '自定义宽高（px）'}</button>
        {canCustomize ? <>{isCustom && <div className="image-custom-inputs">{[['width', '宽度', widthBounds], ['height', '高度', heightBounds]].map(([edge, label, bounds]) => <label key={edge}>{label}<input type="number" inputMode="numeric" aria-label={`自定义${label}`} min={bounds.min} max={bounds.max} step={CUSTOM_IMAGE_SIZE.step} value={draft[edge]} onChange={(event) => changeCustom(edge, event.target.value)} onBlur={() => commitCustom(edge)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}/><small>{bounds.min}–{bounds.max} px</small></label>)}</div>}<small>最长边 3840 px，比例 1:3～3:1；宽高按 16 px 对齐，另一边随输入联动调整。</small></> : <small>当前模型不支持自定义分辨率</small>}
      </fieldset>
      <fieldset><legend>数量</legend><div className="image-settings-choices">{(onCount ? [1, 2, 3, 4] : [1]).map((value) => <button type="button" key={value} aria-pressed={count === value} onClick={() => onCount?.(value)}>{value} 张</button>)}</div>{!onCount && <small>对话模式每次生成 1 张</small>}</fieldset>
      {qualityOptions.length > 0 && <fieldset><legend>质量</legend><div className="image-settings-choices">{qualityOptions.map((option) => <button type="button" key={option.value} aria-pressed={quality === option.value} onClick={() => onQuality(option.value)}>{option.label}</button>)}</div></fieldset>}
      <fieldset><legend>分辨率</legend><div className="image-settings-choices">{VIP_IMAGE_RESOLUTION_OPTIONS.map((option) => <button type="button" key={option.value} aria-pressed={!isCustom && resolution === option.value} disabled={isCustom || (!canSetResolution && option.value !== resolution)} onClick={() => { if (canSetResolution && !isCustom) onResolution(option.value) }}>{option.label}</button>)}</div>{isCustom ? <small>自定义模式按输入像素生成；选择上方预设比例可恢复分辨率档位。</small> : !canSetResolution && <small>当前模型仅支持 1K</small>}</fieldset>
    </div>}
  </div>
}
