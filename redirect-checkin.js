
(function () {
  const GATEWAY = "https://letalock.github.io/zoom_chekin?u=";

  if (window.__UFC_CHECKIN_SAFE__) return;
  window.__UFC_CHECKIN_SAFE__ = true;

  // --- helpers
  const isZoomHost = h =>
    h === "zoom.us" || h.endsWith(".zoom.us") ||
    h === "zoom.com" || h.endsWith(".zoom.com") ||
    h === "zoomgov.com" || h.endsWith(".zoomgov.com");
  const isJoinPath = p => /^\/(j|wc\/join|s)\//.test(p);
  const isMeetHost = h => h === "meet.google.com";
  const isBrightspace = h => /\.brightspace\.com$/i.test(h) || h.includes(".d2l.");

  const PARAM_KEYS = ["targetUrl","url","u","target","href","link"];

  const toAbs = (h) => { try { return new URL(h, location.href).href; } catch { return null; } };
  const alreadyWrapped = href => typeof href === "string" && href.startsWith(GATEWAY);

  function isEligibleAbsolute(absHref) {
    try {
      const u = new URL(absHref);
      if (!(u.protocol === "http:" || u.protocol === "https:")) return false;
      const zoom = isZoomHost(u.hostname) && isJoinPath(u.pathname);
      const meet = isMeetHost(u.hostname);
      return zoom || meet;
    } catch { return false; }
  }

  function extractExternalFromBrightspace(absHref) {
    try {
      const u = new URL(absHref);
      if (!isBrightspace(u.hostname)) return null;

      // 1) busca nos parâmetros comuns
      for (const k of PARAM_KEYS) {
        const raw = u.searchParams.get(k);
        if (!raw) continue;
        let v = raw;
        try { v = decodeURIComponent(v); } catch {}
        try { v = decodeURIComponent(v); } catch {}
        if (!/^https?:\/\//i.test(v)) continue;
        const t = new URL(v);
        if (isEligibleAbsolute(t.href)) return t.href;
      }
      return null;
    } catch { return null; }
  }

  function resolveTargetForWrap(href) {
    const abs = toAbs(href);
    if (!abs) return null;
    try {
      const u = new URL(abs);
      if (isBrightspace(u.hostname)) {
        const ext = extractExternalFromBrightspace(abs);
        return ext && isEligibleAbsolute(ext) ? ext : null;
      }
      return isEligibleAbsolute(abs) ? abs : null;
    } catch { return null; }
  }

  // ===== clique: só atua quando DEVE envolver =====
  document.addEventListener("click", (evt) => {
    try {
      // acha <a> no composedPath ou subindo na árvore
      const path = evt.composedPath ? evt.composedPath() : [];
      let a = null;
      for (const el of path) { if (el && el.tagName === "A") { a = el; break; } }
      if (!a) {
        let n = evt.target;
        while (n && n !== document && n !== window) {
          if (n.tagName === "A") { a = n; break; }
          n = n.parentNode || n.host;
        }
      }
      if (!a) return;

      if (a.hasAttribute("data-ufc-bypass") || a.classList.contains("ufc-checkin-bypass")) return;

      const href = a.getAttribute("href");
      if (!href || alreadyWrapped(href)) return;

      const targetAbs = resolveTargetForWrap(href);
      if (!targetAbs) return;              // <<< não interfere no clique normal

      // Só aqui bloqueia o clique original e envia pelo gateway
      evt.preventDefault();
      const gateway = GATEWAY + encodeURIComponent(targetAbs);
      // mesma aba para evitar popup-blocker
      window.location.href = gateway;
    } catch { /* silencioso */ }
  }, true);

  // Diagnóstico opcional
  window.UFC_DIAG_SAFE = () => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const cand = anchors
      .filter(a => !(a.hasAttribute("data-ufc-bypass") || a.classList.contains("ufc-checkin-bypass")))
      .map(a => ({ href: a.getAttribute('href'), target: resolveTargetForWrap(a.getAttribute('href')) }))
      .filter(x => x.target);
    console.table(cand.slice(0, 30));
    console.info(`Candidatos a wrap: ${cand.length} / Anchors: ${anchors.length}`);
  };
})();
