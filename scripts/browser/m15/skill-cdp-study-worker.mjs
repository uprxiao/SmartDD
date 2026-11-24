import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

class StudySocket extends EventTarget {
  readyState = WebSocket.OPEN

  receive(message) {
    if (message?.kind === 'revoked') this.close()
    else if (message?.kind === 'cdp' && this.readyState === WebSocket.OPEN)
      this.dispatchEvent(new MessageEvent('message', { data: message.data }))
  }

  send(data) {
    assert.equal(this.readyState, WebSocket.OPEN, 'Study transport is closed')
    process.send({ kind: 'cdp', data })
  }

  close() {
    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }
}

function send(message) {
  return new Promise((resolve, reject) => {
    process.send(message, error => { if (error) reject(error); else resolve() })
  })
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

const root = process.env.WY_STUDY_ROOT
assert(root && isAbsolute(root), 'Missing absolute study root')
assert(process.send, 'Study worker requires a parent IPC channel')

const mode = process.argv[2]
assert(['case', 'cancel'].includes(mode), 'Invalid study mode')
const baseline = join(root, 'baseline')
const socket = new StudySocket()
process.on('message', message => socket.receive(message))
process.once('disconnect', () => socket.close())

const visibleHeadings = `Array.from(document.querySelectorAll('h2'))
 .filter(node => node.checkVisibility())
 .map(node => node.textContent.trim())`
const selectLabels = `(() => {
 const text = document.querySelector('#catalog-choice').closest('.ant-select').innerText.trim()
 return text ? [text] : []
})()`

async function runCase(driver) {
  const manifest = await readJson(join(baseline, 'manifest.json'))
  const map = await readJson(join(baseline, 'script-map.json'))
  const test = (await readJson(join(baseline, 'cases.json'))).cases.find(row => row.id === 'CATALOG-CHOICE')
  const mapping = map.cases.find(row => row.id === test.id)
  assert.equal(map.suiteFile, 'suite.mjs')
  for (const file of ['suite.mjs', 'component-plan.json', 'pages.mjs', 'cases.json', 'runtime/cdp.mjs']) {
    const bytes = await readFile(join(baseline, file))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.entries.find(entry => entry.file === file)?.sha256)
  }
  const suite = await import(pathToFileURL(join(baseline, map.suiteFile)))
  const page = suite.pages[test.page.key]
  const assertions = []
  const operations = []
  const ctx = {
    ...driver,
    signal: AbortSignal.timeout(30000),
    equal(id, actual) {
      const spec = test.assertions.find(assertion => assertion.id === id)
      assert.equal(spec?.expectedRef, '/labels')
      const expected = test.expected.labels
      assert.deepEqual(actual, expected)
      assertions.push({ id, actual, expected, status: 'passed' })
    },
    recordComponent(event) {
      if (event.status === 'completed')
        operations.push({ operation: event.operation, stepId: event.stepId, controlIds: event.controlIds })
    },
  }

  const targets = (await driver.cdp('Target.getTargets')).targetInfos
  assert.deepEqual(targets, [{targetId:'study-page', type:'page'}])
  await assert.rejects(driver.cdp('Target.getTargetInfo', {targetId:'study-other-page'}), /STUDY_FOREIGN_TARGET/)

  await suite.setup(ctx)
  await page.open(ctx)
  await ctx.waitFor(page.ready)
  await page.reset(ctx)
  assert(await page.verify(ctx), 'Frozen fixture page verification failed')
  assert.equal(await driver.evaluate('document.querySelector("#identity").textContent'), 'fixture-user')

  const before = await driver.evaluate(visibleHeadings)
  assert.deepEqual(before, ['catalog'])
  const previousSelection = await driver.evaluate(selectLabels)
  assert(!previousSelection.includes(test.expected.labels[0]), 'Initial UI already has the expected selection')

  const outcome = await suite.handlers[mapping.handler](ctx, test)
  assert.equal(outcome?.status, 'passed', JSON.stringify(outcome))
  assert.equal(assertions.length, test.assertions.length)
  assert(operations.some(event => event.operation === 'select.choose'))
  const selection = await driver.evaluate(selectLabels)
  assert.deepEqual(selection, test.expected.labels, 'Independent DOM read disagrees with recorded assertion')
  const screenshot = join(root, 'selected.png')
  await driver.screenshot(screenshot)
  const bytes = await readFile(screenshot)
  assert(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
  assert.equal(bytes.length, (await stat(screenshot)).size)

  await driver.click('#switch')
  await driver.waitFor("document.querySelector('#teams').checkVisibility()")
  const after = await driver.evaluate(visibleHeadings)
  assert.deepEqual(after, ['teams'])
  const {nodes} = await driver.cdp('Accessibility.getFullAXTree')
  assert(nodes.some(node => node.role?.value === 'heading' && node.name?.value === 'teams'))
  assert.deepEqual(driver.eventErrors, [])

  return {
    status: 'passed', caseId: test.id, baselineRevision: manifest.revision, suiteResult: outcome.status,
    assertions, operations, before, after, selection,
    screenshot: { file: 'selected.png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    diagnostics: driver.diagnostics(), foreignTargetDenied:true, freshAXHeading:'teams',
  }
}

async function runCancellation(driver) {
  const start = performance.now()
  const waiting = driver.waitFor("Boolean(document.querySelector('#nonexistent-study-wait'))", 5000)
  waiting.catch(() => {})
  await send({ kind: 'waiting' })
  let reason
  try {
    await waiting
  } catch (error) {
    reason = error.message
  }
  assert.equal(socket.readyState, WebSocket.CLOSED)
  assert.match(reason, /Owned page connection closed|CDP is disconnected/)
  return { status: 'cancelled', reason, elapsedMs: Math.round(performance.now() - start) }
}

let driver
try {
  const { connectForStudy } = await import(pathToFileURL(join(baseline, 'runtime/study-cdp.mjs')))
  driver = await connectForStudy({ targetId: 'study-page' }, socket)
  const result = mode === 'case' ? await runCase(driver) : await runCancellation(driver)
  await send({ kind: 'result', result })
} catch (error) {
  let screenshot
  if (driver && socket.readyState === WebSocket.OPEN && mode === 'case') {
    try {
      await driver.screenshot(join(root, 'failed.png'))
      screenshot = 'failed.png'
    } catch {
      // Preserve the original error when screenshot capture is unavailable.
    }
  }
  await send({ kind: 'result', result: {
    status: 'failed', mode, error: error.message?.slice(0, 500), code: error.code, stage: error.stage, screenshot,
  } })
  process.exitCode = 1
} finally {
  driver?.disconnect()
  socket.close()
  if (process.connected) process.disconnect()
}
