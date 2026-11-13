import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import './composerSelect.css'

export default function ComposerSelect({ label, value, options, onChange, disabled = false, className = '', placeholder, icon, footer, portal = false }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null), trigger = useRef(null), menu = useRef(null)
  const selected = options.find((item) => item.value === value)
  useLayoutEffect(() => {
    if (!open || !menu.current) return
    const place = () => {
      const element = menu.current
      if (!element) return
      if (portal && trigger.current) {
        const anchor = trigger.current.getBoundingClientRect()
        const width = Math.min(Math.max(anchor.width, 190), window.innerWidth - 16)
        Object.assign(element.style, {
          position: 'fixed',
          width: width + 'px',
          maxHeight: Math.min(330, window.innerHeight - 24) + 'px',
          left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)) + 'px',
          right: 'auto',
          bottom: 'auto',
          transform: 'none',
        })
        const height = element.getBoundingClientRect().height
        const below = window.innerHeight - anchor.bottom - 8
        const preferredTop = below >= height ? anchor.bottom + 6 : anchor.top - height - 6
        element.style.top = Math.max(8, Math.min(preferredTop, window.innerHeight - height - 8)) + 'px'
        return;
      }
      element.style.transform = ''
      const bounds = element.getBoundingClientRect()
      const shift = Math.max(8 - bounds.left, Math.min(0, window.innerWidth - 8 - bounds.right))
      element.style.transform = `translateX(${shift}px)`
    }
    place(); window.addEventListener('resize', place); if(portal)window.addEventListener('scroll',place,true)
    return () => {window.removeEventListener('resize', place);if(portal)window.removeEventListener('scroll',place,true)}
  }, [open, options, footer, portal])
  useEffect(() => {
    if (!open) return
    const outside = (event) => { if (!root.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false) }
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
    const buttons = [...menu.current.querySelectorAll('[role="option"]:not(:disabled)')]
    const index = buttons.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  const menuContent = <div className={`composer-select-menu ${portal ? "film-floating-menu" : ""}`} ref={menu}>
      <div className="composer-select-options" role="listbox" aria-label={label} onKeyDown={move}>{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} aria-disabled={option.disabled || undefined} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus() }}><span>{option.label}</span>{option.status && <small className="composer-option-status">{option.status}</small>}{option.value === value && <Icon name="check" size={13}/>}</button>)}</div>
      {footer && <div className="composer-select-footer">{footer}</div>}
    </div>
  return <div className={`composer-select ${className}`} ref={root}>
    <button ref={trigger} className="composer-select-trigger" type="button" aria-label={label} title={`${label}：${selected?.label || placeholder || value}`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)} onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true) } }}>
      {icon && <Icon name={icon} size={14}/>}<b>{(!value && placeholder) || selected?.label || placeholder || value}</b><Icon name="chevron" size={13}/>
    </button>
    {open && !disabled && (portal ? createPortal(menuContent, document.body) : menuContent)}
  </div>
}
