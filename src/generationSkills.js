import { useCallback, useEffect, useState } from 'react'
import { getAuthToken } from './api.js'
import { skillRequest } from './skillApi.js'
import { installedLocalSkills } from './externalSkillClient.js'
const key = (target) => `dgen-generation-skill:${getAuthToken().slice(-12) || 'guest'}:${target}`
export function selectGenerationSkill(target, id) {
  localStorage.setItem(key(target), id || '')
  window.dispatchEvent(new Event('dgen-generation-skill'))
}
export function useGenerationSkill(target) {
  const [id, setId] = useState(() => localStorage.getItem(key(target)) || '')
  const [skills, setSkills] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    const token = getAuthToken()
    if (!token) { setSkills([]); setId(''); setError(''); setLoading(false); return }
    setLoading(true)
    try {
      const [data, external] = await Promise.all([skillRequest(`?target=${target}`), installedLocalSkills(token)])
      if (getAuthToken() !== token) return
      setSkills([...data.skills, ...external.filter((s) => s.compatibility.usable && s.localReady && s.targets.includes(target))]); setError('')
    } catch (e) { if (getAuthToken() === token) setError(e.message) } finally { if (getAuthToken() === token) setLoading(false) }
  }, [target])
  useEffect(() => {
    void reload()
    const changed = () => { setId(localStorage.getItem(key(target)) || ''); void reload() }
    const events = ['dgen-generation-skill', 'dgen-auth-changed', 'focus', 'storage']
    events.forEach((event) => window.addEventListener(event, changed))
    return () => events.forEach((event) => window.removeEventListener(event, changed))
  }, [target, reload])
  return { id, skills, loading, selected: skills.find((s) => s.id === id), error, reload, select: (value) => selectGenerationSkill(target, value) }
}
