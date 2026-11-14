import { expect, test } from 'claude-code/testing'
declare const setTimeout: (fn: () => void, ms: number) => unknown

const HOUR = 3600 * 1000
const NOW = 10 * HOUR

function engine(on: any, opts: { panel?: unknown; idleMs: number; tokens: number }, compacts: string[]) {
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('fs.read', () => {
    if (opts.panel === undefined) throw new Error('ENOENT')
    return { value: JSON.stringify(opts.panel) }
  })
  on('clock.now', () => ({ value: NOW }))
  on('clock.after', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: NOW - opts.idleMs }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: opts.tokens, window: 200000 }, rateLimits: [] },
  }))
  on('session.compact', (_: any, e: any) => {
    compacts.push(e.trigger)
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  on('prompt.submit', (_: any, e: any) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_: any, e: any) => {
    toasts.push(String(e.text ?? JSON.stringify(e)))
    return { value: undefined }
  })
}
export const toasts: string[] = []
export const submitted: string[] = []

const prompt = { text: 'continue a tarefa', wait: false, origin: {} } as any

test('cold, large session: compacts first, then the prompt enters', async ($, on) => {
  const compacts: string[] = []
  engine(on, { idleMs: 2 * HOUR, tokens: 150000 }, compacts)
  const out = await $.prompt.submit(prompt)
  expect(String(out.drop)).toContain('compactando')
  await new Promise<void>(r => setTimeout(() => r(), 50))
  expect(compacts.length).toBe(1)
  expect(toasts.at(-1)).toContain('compactada')
  expect(submitted.at(-1)).toBe('continue a tarefa')
})

test('warm or small session: no compact', async ($, on) => {
  const compacts: string[] = []
  engine(on, { idleMs: 5 * 60000, tokens: 150000 }, compacts)
  await $.prompt.submit(prompt)
  expect(compacts.length).toBe(0)
})

test('turned off in the panel: no compact', async ($, on) => {
  const compacts: string[] = []
  engine(on, { panel: { panel: { coldCompact: { enabled: false } } }, idleMs: 2 * HOUR, tokens: 150000 }, compacts)
  await $.prompt.submit(prompt)
  expect(compacts.length).toBe(0)
})
