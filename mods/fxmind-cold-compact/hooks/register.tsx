import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ColdCompactSettings, LastCompact } from '../types'

// Compacts a cold session holding a large context before the next prompt
// enters, then lets the prompt through. A cold resume (after a quota reset,
// say) re-sends the whole context uncached; compacting first keeps that small.
//
// Settings are shared with the fxmind CLI and web panel: ~/.fxmind/panel.json
// → panel.coldCompact { enabled, minutes, tokens }. On by default.

const PANE = 'fxmind-cold-compact'
const DEFAULTS: ColdCompactSettings = { enabled: true, minutes: 60, tokens: 80000 }
const MAX_READ = 4 * 1024 * 1024

const settings = atom({ plugin: 'fxmind-cold-compact', key: 'settings' } as const, DEFAULTS, {
  shape: 'settings-1',
})
const last = atom({ plugin: 'fxmind-cold-compact', key: 'last' } as const, null as LastCompact | null, {
  shape: 'last-1',
})

type Json = Record<string, unknown>

function positive(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function normalize(raw: unknown): ColdCompactSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Json
  return {
    enabled: value.enabled !== false,
    minutes: positive(value.minutes, DEFAULTS.minutes),
    tokens: positive(value.tokens, DEFAULTS.tokens),
  }
}

async function configPath($: EngineInterface): Promise<string | null> {
  const explicit = await $.env.get('FXMIND_PANEL_CONFIG')
  if (explicit) return explicit
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return home ? `${home}/.fxmind/panel.json` : null
}

async function readConfig($: EngineInterface): Promise<Json> {
  const file = await configPath($)
  if (!file) return {}
  try {
    const parsed = JSON.parse(await $.fs.read(file))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function loadSettings($: EngineInterface): Promise<ColdCompactSettings> {
  const config = await readConfig($)
  const next = normalize((config.panel as Json | undefined)?.coldCompact)
  await update($, settings, () => next)
  return next
}

async function saveSettings($: EngineInterface, patch: Partial<ColdCompactSettings>) {
  const file = await configPath($)
  const config = await readConfig($)
  const panel = (config.panel && typeof config.panel === 'object' ? config.panel : {}) as Json
  const merged = normalize({ ...normalize(panel.coldCompact), ...patch })
  if (file) {
    await $.fs.write(file, `${JSON.stringify({ ...config, panel: { ...panel, coldCompact: merged } }, null, 2)}\n`)
  }
  await update($, settings, () => merged)
}

/** Last activity and context size from the transcript, when the engine has no figure yet. */
async function fromTranscript($: EngineInterface): Promise<{ lastAt: number; tokens: number }> {
  const home = await $.env.get('HOME')
  if (!home) return { lastAt: 0, tokens: 0 }
  const root: string = await $.session.root()
  const id: string = await $.session.id()
  const file = `${home}/.claude/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
  try {
    const stat = await $.fs.stat(file)
    if (stat.size > MAX_READ) return { lastAt: stat.mtimeMs, tokens: 0 }
    const lines = String(await $.fs.read(file)).split('\n')
    let lastAt = 0
    let tokens: number | null = null
    for (let i = lines.length - 1; i >= 0 && (!lastAt || tokens === null); i--) {
      let entry: any
      try {
        entry = JSON.parse(lines[i] ?? '')
      } catch {
        continue
      }
      if (entry.isSidechain) continue
      if (!lastAt && entry.timestamp && (entry.type === 'user' || entry.type === 'assistant')) {
        lastAt = Date.parse(entry.timestamp) || 0
      }
      if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
        tokens = tokens ?? 0
        break
      }
      const usage = entry.type === 'assistant' ? entry.message?.usage : null
      if (usage && tokens === null) {
        tokens =
          (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
      }
    }
    return { lastAt, tokens: tokens || 0 }
  } catch {
    return { lastAt: 0, tokens: 0 }
  }
}

// The prompt this mod held back and is about to submit again.
let resubmitting: string | null = null

async function compactThenResubmit(
  $: EngineInterface,
  held: { text: string; context?: readonly string[] },
  label: string,
  base: LastCompact,
) {
  $.ui.status(`fxmind: compactando sessão fria (${label})…`)
  let record = base
  try {
    const result = await $.session.compact()
    record = result.skip ? { ...record, note: result.skip } : { ...record, ok: true }
  } catch (error) {
    record = { ...record, note: String((error as Error)?.message || error) }
  } finally {
    $.ui.status(undefined)
  }
  await update($, last, () => record)
  $.ui.toast(
    record.ok
      ? `fxmind: sessão fria compactada (${label}); continuando.`
      : `fxmind: compact não rodou (${record.note}); continuando assim mesmo.`,
  )
  await $.prompt.submit({ text: held.text, ...(held.context ? { context: held.context } : {}) } as any)
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await loadSettings($)
    await $.command.register({
      name: 'fxmind-compact',
      description: 'fxmind: configure compact-before-resume for cold, large sessions',
    })
    return next(e)
  })

  on('command.run', { command: 'fxmind-compact' }, async $ => {
    await loadSettings($)
    await $.ui.open({ id: PANE, title: 'fxmind · cold compact' })
    return { text: 'Painel do fxmind cold compact aberto.' }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await $.store.set(`lastAt:${await $.session.id()}`, await $.clock.now())
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Slash commands (/compact itself), hidden prompts and deliveries into a
    // running turn pass untouched.
    if (e.command || e.isMeta || e.turnId || e.attachments?.length) return next(e)
    if (resubmitting !== null && e.text === resubmitting) {
      resubmitting = null
      return next(e)
    }
    const config = await loadSettings($)
    if (!config.enabled) return next(e)

    const now = await $.clock.now()
    const stored = Number(await $.store.get(`lastAt:${await $.session.id()}`)) || 0
    let tokens = (await $.session.usage()).context.tokens ?? 0
    let lastAt = stored
    if (!lastAt || !tokens) {
      const found = await fromTranscript($)
      lastAt = lastAt || found.lastAt
      tokens = tokens || found.tokens
    }
    if (!lastAt) return next(e)
    const idleMinutes = (now - lastAt) / 60000
    if (idleMinutes < config.minutes || tokens < config.tokens) return next(e)

    const label = `${Math.round(tokens / 1000)}k tokens, ociosa há ${Math.round(idleMinutes)} min`
    // The engine refuses a compaction under the turn a prompt.submit hook holds,
    // so the prompt is held back, the session compacted right after, and the
    // same prompt submitted again.
    const held = { text: e.text, context: e.context }
    resubmitting = held.text
    $.clock.after(0, () => {
      void compactThenResubmit($, held, label, {
        at: now,
        tokensBefore: tokens,
        idleMinutes: Math.round(idleMinutes),
        ok: false,
      })
    })
    return { drop: `fxmind: sessão fria (${label}) — compactando e reenviando a mensagem…` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const s = await read($, settings)
    const done = await read($, last)

    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          Compactar antes de retomar sessão fria e grande:{' '}
          <Text bold color={s.enabled ? 'green' : 'red'}>
            {s.enabled ? 'ativado' : 'desativado'}
          </Text>
        </Text>
        <Button
          key="toggle"
          variant="primary"
          label={s.enabled ? 'Desativar' : 'Ativar'}
          onPress={() => saveSettings($, { enabled: !s.enabled })}
        />
        <Input
          key="minutes"
          label="Fria após (minutos parada)"
          value={String(s.minutes)}
          submitLabel="Salvar"
          onSubmit={value => saveSettings($, { minutes: positive(value, s.minutes) })}
        />
        <Input
          key="tokens"
          label="Grande a partir de (tokens)"
          value={String(s.tokens)}
          submitLabel="Salvar"
          onSubmit={value => saveSettings($, { tokens: positive(value, s.tokens) })}
        />
        <Text dimColor>Config compartilhada com o painel web e a CLI (~/.fxmind/panel.json).</Text>
        {done && (
          <Text dimColor>
            Último: {done.ok ? 'compactou' : `não compactou (${done.note})`} · {Math.round(done.tokensBefore / 1000)}k
            tokens · {done.idleMinutes} min parada
          </Text>
        )}
      </Box>
    )
  })
}
