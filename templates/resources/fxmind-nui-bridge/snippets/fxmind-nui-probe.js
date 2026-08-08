/*! FXMIND-NUI-DUMP — temporary agent probe. Remove with: fxmind fivem nui-unwire */
(function () {
  if (typeof window === "undefined") return;
  if (window.__FXMIND_NUI_PROBE_INSTALLED__) return;
  window.__FXMIND_NUI_PROBE_INSTALLED__ = true;

  function safeText(value, max) {
    const text = String(value == null ? "" : value);
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  function defaultState() {
    const body = document.body;
    const active =
      document.activeElement && document.activeElement !== document.body
        ? {
            tag: document.activeElement.tagName,
            id: document.activeElement.id || null,
            className: safeText(document.activeElement.className, 120),
            text: safeText(document.activeElement.innerText || document.activeElement.value, 200),
          }
        : null;

    return {
      probe: "fxmind-dom",
      href: String(location.href || ""),
      hash: String(location.hash || ""),
      path: String(location.pathname || ""),
      title: document.title || "",
      visible: document.visibilityState,
      active,
      bodyText: safeText(body ? body.innerText || body.textContent : "", 6000),
      headings: Array.from(document.querySelectorAll("h1,h2,h3,[role='heading']"))
        .slice(0, 30)
        .map((el) => safeText(el.innerText, 160)),
      buttons: Array.from(document.querySelectorAll("button,[role='button'],a"))
        .slice(0, 40)
        .map((el) => safeText(el.innerText || el.getAttribute("aria-label") || el.id, 80))
        .filter(Boolean),
    };
  }

  if (typeof window.__FXMIND_GET_NUI_STATE__ !== "function") {
    window.__FXMIND_GET_NUI_STATE__ = defaultState;
  }

  if (typeof window.__FXMIND_GET_NUI_META__ !== "function") {
    window.__FXMIND_GET_NUI_META__ = function () {
      return {
        probe: true,
        href: String(location.href || ""),
        hash: String(location.hash || ""),
        path: String(location.pathname || ""),
        title: document.title || "",
      };
    };
  }

  window.addEventListener("message", function (event) {
    var data = event && event.data;
    if (!data || data.action !== "fxmind:nuiDump") return;

    var state = null;
    var meta = {};
    var error = null;
    try {
      state = window.__FXMIND_GET_NUI_STATE__ ? window.__FXMIND_GET_NUI_STATE__() : defaultState();
      meta = window.__FXMIND_GET_NUI_META__ ? window.__FXMIND_GET_NUI_META__() : {};
    } catch (err) {
      error = String((err && err.message) || err);
      state = defaultState();
    }

    var resource =
      data.resource ||
      (typeof window.GetParentResourceName === "function"
        ? window.GetParentResourceName()
        : "nui");

    fetch("https://" + resource + "/fxmindNuiDump", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        reqId: data.reqId,
        resource: resource,
        state: state,
        meta: meta,
        error: error,
      }),
    }).catch(function () {});
  });
})();
