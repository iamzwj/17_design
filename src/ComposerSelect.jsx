import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import './composerSelect.css'

export default function ComposerSelect({ label, value, options, onChange, disabled = false, className = '', placeholder, icon, footer }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null), trigger = useRef(null), menu = useRef(null)
  const selected = options.find((item) => item.value === value)
  useLayoutEffect(() => {
    if (!open || !menu.current) return
    const place = () => {
      const element = menu.current
      if (!element) return
      element.style.transform = ''
      const bounds = element.getBoundingClientRect()
      const shift = Math.max(8 - bounds.left, Math.min(0, window.innerWidth - 8 - bounds.right))
      element.style.transform = `translateX(${shift}px)`
    }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, options, footer])
  useEffect(() => {
    if (!open) return
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  useEffect(() => {
    if (open) menu.current?.querySelector('[aria-selected="true"]')?.focus()
  }, [open])
  function move(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...menu.current.querySelectorAll('[role="option"]')]
    const index = buttons.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  return <div className={`composer-select ${className}`} ref={root}>
    <button ref={trigger} className="composer-select-trigger" type="button" aria-label={label} title={`${label}：${selected?.label || placeholder || value}`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)} onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true) } }}>
      {icon && <Icon name={icon} size={14}/>}<b>{(!value && placeholder) || selected?.label || placeholder || value}</b><Icon name="chevron" size={13}/>
    </button>
    {open && !disabled && <div className="composer-select-menu" ref={menu}>
      <div className="composer-select-options" role="listbox" aria-label={label} onKeyDown={move}>{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus() }}><span>{option.label}</span>{option.value === value && <Icon name="check" size={13}/>}</button>)}</div>
      {footer && <div className="composer-select-footer">{footer}</div>}
    </div>}
  </div>
}
