import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultAccentTheme, readAccentTheme, saveAccentTheme } from '../src/accentThemes.js'

test('identity defaults and user-specific choices remain independent', () => {
  const values = new Map()
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const yan = { id: 'yan', identity: 'yanxuanjia' }, pulin = { id: 'pulin', identity: 'pulin' }, other = { id: 'other', identity: 'marketing' }
  assert.equal(readAccentTheme(yan), 'green')
  assert.equal(readAccentTheme(pulin), 'orange')
  assert.equal(readAccentTheme(other), 'blue')
  assert.equal(readAccentTheme(null), 'blue')
  saveAccentTheme(yan, 'pink')
  assert.equal(readAccentTheme(yan), 'pink')
  assert.equal(readAccentTheme(pulin), 'orange')
  assert.equal(readAccentTheme(other), 'blue')
  saveAccentTheme(other, 'invalid')
  assert.equal(readAccentTheme(other), 'blue')
  assert.equal(defaultAccentTheme('unknown'), 'blue')
  delete globalThis.localStorage
})
