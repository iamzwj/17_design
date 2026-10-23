import { useCallback, useEffect, useState } from 'react'
import { getAuthToken } from './api.js'
import { skillRequest } from './skillApi.js'
const key = (target) => `dgen-generation-skill:${getAuthToken().slice(-12) || 'guest'}:${target}`
export function selectGenerationSkill(target, id) {
  localStorage.setItem(key(target), id || '')
  window.dispatchEvent(new Event('dgen-generation-skill'))
}
export function useGenerationSkill(target) {
  const [id, setId] = useState(() => localStorage.getItem(key(target)) || '')
  const [skills, setSkills] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    if (!getAuthToken()) { setSkills([]); setLoading(false); return }
    setLoading(true)
    try { const data = await skillRequest(`?target=${target}`); setSkills(data.skills); setError('') } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [target])
  useEffect(() => {
    void reload()
    const changed = () => { setId(localStorage.getItem(key(target)) || ''); void reload() }
    window.addEventListener('dgen-generation-skill', changed); window.addEventListener('focus', changed)
    return () => { window.removeEventListener('dgen-generation-skill', changed); window.removeEventListener('focus', changed) }
  }, [target, reload])
  return { id, skills, loading, selected: skills.find((s) => s.id === id), error, reload, select: (value) => selectGenerationSkill(target, value) }
}
