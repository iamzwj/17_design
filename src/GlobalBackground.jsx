import { useEffect, useState } from 'react'
import MicroSlats from './MicroSlats.jsx'

export default function GlobalBackground() {
  const [color, setColor] = useState('#164bb8')
  useEffect(() => {
    const update = () => setColor(getComputedStyle(document.documentElement).getPropertyValue('--dp-highlight').trim() || '#164bb8')
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    return () => observer.disconnect()
  }, [])
  return <div className="global-background" aria-hidden="true"><MicroSlats color={color} glintColor="#ffffff" backgroundColor="transparent" preset="swell" speed={0.18} slatWidth={4} slatHeight={9} gap={3} roundness={0.55} interactive cursorStrength={3} cursorSize={34} swirl={0.65} trail={1.1} lean={0} intro={false}/></div>
}
