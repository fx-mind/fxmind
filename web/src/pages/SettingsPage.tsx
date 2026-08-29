import { useCallback, useEffect, useState } from "react";
import { Badge, Card, EmptyState, PageHeader } from "../components/ui";
import { panelApi, type PortspaceSettings, type CursorSettings } from "../lib/api";

export function SettingsPage() {
  const [settings, setSettings] = useState<PortspaceSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [integrationKey, setIntegrationKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await panelApi.portspaceSettings();
      setSettings(data);
      setBaseUrl(data.baseUrl);
      setIntegrationKey("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const body: { baseUrl: string; integrationKey?: string; clearKey?: boolean } = {
        baseUrl: baseUrl.trim(),
      };
      if (integrationKey.trim()) body.integrationKey = integrationKey.trim();
      const next = await panelApi.savePortspaceSettings(body);
      setSettings(next);
      setIntegrationKey("");
      setMessage("Salvo.");
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    setSaving(true);
    try {
      const next = await panelApi.savePortspaceSettings({ clearKey: true });
      setSettings(next);
      setIntegrationKey("");
      setMessage("Chave removida.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="PortSpace"
        description="Conexão com o CRM. A chave nunca é exibida de volta — só o prefixo."
      />

      {loading && <p className="text-sm text-[var(--color-muted)]">Carregando…</p>}

      {!loading && (
        <Card className="max-w-lg p-4">
          <form onSubmit={save} className="flex flex-col gap-4">
            <label className="text-xs text-[var(--color-muted)]">
              URL base da API
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.seudominio.com"
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]/50"
              />
            </label>

            <div>
              <label className="text-xs text-[var(--color-muted)]">
                Chave de integração (x-integration-key)
                <input
                  type="password"
                  value={integrationKey}
                  onChange={(e) => setIntegrationKey(e.target.value)}
                  placeholder={settings?.hasKey ? "Deixe vazio para manter a atual" : "Cole a chave do app FxMind"}
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-black/40 px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)]/50"
                />
              </label>
              {settings?.hasKey && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone="learned">Chave salva</Badge>
                  <span className="font-mono text-[10px] text-[var(--color-muted)]">
                    prefixo {settings.keyPrefix}
                  </span>
                  <button
                    type="button"
                    onClick={clearKey}
                    className="text-[10px] text-[var(--color-danger)] hover:underline"
                  >
                    Remover chave
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-fit rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>

            {message && <p className="text-xs text-[var(--color-muted)]">{message}</p>}
          </form>
        </Card>
      )}

      {!loading && (
        <Card className="mt-6 max-w-lg p-4">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Agente Cursor (chat do painel)
          </h3>
          <CursorKeyForm />
        </Card>
      )}

      <EmptyState
        title="Permissão no Kanban"
        description="No PortSpace v1, autorize boards e escopos no app FxMind do marketplace. Este painel só consome a API quando o endpoint /external/fxmind/inbox existir."
        className="mt-6"
      />
    </>
  );
}

function CursorKeyForm() {
  const [settings, setSettings] = useState<CursorSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSettings(await panelApi.cursorSettings());
    setApiKey("");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const body: { apiKey?: string } = {};
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const next = await panelApi.saveCursorSettings(body);
      setSettings(next);
      setApiKey("");
      setMessage("Salvo.");
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <p className="text-xs text-[var(--color-muted)]">
        Chave em cursor.com/dashboard/integrations. Também vale a env CURSOR_API_KEY.
        Cada demanda do chat sobe um agente Cursor no cwd do projeto (várias em paralelo).
      </p>
      <label className="text-xs text-[var(--color-muted)]">
        CURSOR_API_KEY
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={settings?.hasKey ? "Deixe vazio para manter" : "cursor_…"}
          autoComplete="off"
          className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-black/40 px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)]/50"
        />
      </label>
      {settings?.hasKey && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="learned">{settings.fromEnv ? "via env" : "chave salva"}</Badge>
          <span className="font-mono text-[10px] text-[var(--color-muted)]">{settings.keyPrefix}</span>
          <button
            type="button"
            onClick={async () => {
              setSettings(await panelApi.saveCursorSettings({ clearKey: true }));
            }}
            className="text-[10px] text-[var(--color-danger)] hover:underline"
          >
            Remover chave salva
          </button>
        </div>
      )}
      <button
        type="submit"
        disabled={saving}
        className="w-fit rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Salvando…" : "Salvar chave"}
      </button>
      {message && <p className="text-xs text-[var(--color-muted)]">{message}</p>}
    </form>
  );
}
