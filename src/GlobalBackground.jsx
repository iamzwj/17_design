import { useEffect, useState } from 'react'
import MicroSlats from './MicroSlats.jsx'

export default function GlobalBackground() {
  const [palette, setPalette] = useState({ color: '#164bb8', glint: '#ffffff' })
  useEffect(() => {
    const update = () => {
      const root = document.documentElement
      const dark = root.dataset.theme === 'dark'
      const styles = getComputedStyle(root)
      setPalette({
        color: styles.getPropertyValue(dark ? '--accent-background' : '--dp-highlight').trim() || '#164bb8',
        glint: styles.getPropertyValue('--accent-glint').trim() || '#ffffff',
      })
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'style', 'class'] })
    return () => observer.disconnect()
  }, [])
  return <div className="global-background" aria-hidden="true"><MicroSlats color={palette.color} glintColor={palette.glint} backgroundColor="transparent" preset="swell" speed={0} slatWidth={4} slatHeight={9} gap={3} roundness={0.55} interactive cursorStrength={3} cursorSize={34} swirl={0.65} trail={1.1} lean={0} intro={false}/></div>
}
