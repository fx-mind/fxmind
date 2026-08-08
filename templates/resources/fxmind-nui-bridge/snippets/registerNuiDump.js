/**
 * Drop into your NUI entry (main.tsx / App) after stores are ready.
 *
 * Requires client_script "@fxmind-nui-bridge/client-hook.lua" on the resource.
 *
 * @param {() => unknown} getState  Serializable snapshot (Zustand getState, React ref, etc.)
 * @param {() => Record<string, unknown>} [getMeta]  Optional UI meta (route, visible, tab)
 */
export function registerFxmindNuiDump(getState, getMeta) {
  if (typeof window === "undefined") return () => {};

  window.__FXMIND_GET_NUI_STATE__ = typeof getState === "function" ? getState : () => getState;
  if (typeof getMeta === "function") {
    window.__FXMIND_GET_NUI_META__ = getMeta;
  }

  const onMessage = (event) => {
    const data = event?.data;
    if (!data || data.action !== "fxmind:nuiDump") return;

    let state = null;
    let meta = {};
    let error = null;
    try {
      state = window.__FXMIND_GET_NUI_STATE__?.() ?? null;
      meta = window.__FXMIND_GET_NUI_META__?.() ?? {};
    } catch (err) {
      error = String(err?.message || err);
    }

    const resource =
      data.resource ||
      (typeof window.GetParentResourceName === "function"
        ? window.GetParentResourceName()
        : "nui");

    fetch(`https://${resource}/fxmindNuiDump`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        reqId: data.reqId,
        resource,
        state,
        meta,
        error,
      }),
    }).catch(() => {});
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
