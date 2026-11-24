import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_SKILLS, skillTargets } from '../server/builtinSkills.js'
import { extractPresentation, presentationPreview } from '../src/htmlPresentation.js'
test('magazine skill is available to chat and can deliver isolated HTML presentations', () => {
 const skill = BUILTIN_SKILLS.find(item => item.id === 'magazine-editorial-layout')
 assert.ok(skill)
 assert.ok(skillTargets(skill).includes('chat'))
 assert.match(skill.markdown, /HTML 演示稿/)
 assert.match(skill.markdown, /不编造/)
 const html = extractPresentation('方案\n```html\n<html><head></head><body><section>演示内容</section></body></html>\n```')
 assert.ok(html.includes('演示内容'))
 assert.match(presentationPreview(html), /Content-Security-Policy/)
})
