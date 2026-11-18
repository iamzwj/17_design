import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPresentation, presentationPreview } from '../src/htmlPresentation.js'

test('recognizes complete HTML presentations and rejects incomplete responses', () => {
  assert.equal(extractPresentation('介绍\n```html\n<html><head></head><body>内容</body></html>\n```'), '<html><head></head><body>内容</body></html>')
  assert.equal(extractPresentation('```html\n<html><body>未完成\n```'), '')
  assert.equal(extractPresentation('普通回答'), '')
})
test('restricts network and forms in presentation preview', () => {
  const value = presentationPreview('<html><head><script>1</script></head></html>')
  assert.ok(value.indexOf('Content-Security-Policy') < value.indexOf('<script>'))
  assert.match(value, /connect-src 'none'/)
  assert.match(value, /form-action 'none'/)
})
