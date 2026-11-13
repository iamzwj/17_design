import { useLayoutEffect, useRef } from 'react'

// Keep each column independent without remounting cards or resetting open details.
export default function FilmAssetGrid({ children }) {
  const root = useRef(null)
  useLayoutEffect(() => {
    const grid = root.current
    if (!grid) return
    let frame = 0
    const layout = () => {
      frame = 0
      const gap = window.innerWidth <= 600 ? 12 : 16
      const columns = Math.max(1, Math.floor((grid.clientWidth + gap) / (290 + gap)))
      const width = Math.min(290, grid.clientWidth)
      const heights = Array(columns).fill(0)
      const cards = Array.from(grid.children)
      for (const card of cards) card.style.width = `${width}px`
      cards.forEach((card, index) => {
        const column = index % columns
        card.style.left = `${column * (width + gap)}px`
        card.style.top = `${heights[column]}px`
        heights[column] += card.offsetHeight + gap
      })
      const height = `${Math.max(0, ...heights) - (cards.length ? gap : 0)}px`
      if (grid.style.height !== height) grid.style.height = height
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(layout) }
    const observer = new ResizeObserver(schedule)
    observer.observe(grid)
    for (const card of grid.children) observer.observe(card)
    layout()
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [children])
  return <div className="fw-asset-grid" data-independent-columns ref={root}>{children}</div>
}
