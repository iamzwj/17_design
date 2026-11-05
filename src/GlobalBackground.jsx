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
  return <div className="global-background" aria-hidden="true"><MicroSlats color={color} glintColor={color} backgroundColor="transparent" preset="tide" speed={0.12} scale={2.2} slatWidth={3} slatHeight={8} gap={5} glint={0.4} interactive cursorStrength={1.2} cursorSize={100} trail={2.4} lean={0.12} intro={false}/></div>
}
