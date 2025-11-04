(function () {
  const GATEWAY = "https://letalock.github.io/zoom_chekin?u=";

  // evita rodar 2x
  if (window.__UFC_CHECKIN_SAFE__) return;
  window.__UFC_CHECKIN_SAFE__ = true;

  // ===== Helpers =====
  const isZoomHost = h =>
    h === "zoom.us" || h.endsWith(".zoom.us") ||
    h === "zoom.com" || h.endsWith(".zoom.com") ||
    h === "zoomgov.com" || h.endsWith(".zoomgov.com");

  const isJoinPath = p => /^\/(j|wc\/join|s)\//.test(p);
  const isMeetHost = h => h === "meet.google.com";
  const isBrightspace = h => /\.brightspace\.com$/i.test(h) || h.includes(".d2l.");

  // parâmetros que o D2L costuma usar para encapsular um link externo
  const PARAM_KEYS = ["targetUrl", "url", "u", "target", "href", "link"];

  const toAbs = (h) => { try { return new URL(h, location.href).href; } catch { return null; } };
  const alreadyWrapped = (href) => typeof href === "string" && href.startsWith(GATEWAY);

  function isSkippableScheme(href) {
    return /^(mailto:|tel:|javascript:|data:|blob:|#)/i.test(href || "");
  }

  function isEligibleAbsolute(absHref) {
    try {
      const u = new URL(absHref);
      if (!(u.protocol === "http:" || u.protocol === "https:")) return false;
      const zoom = isZoomHost(u.hostname) && isJoinPath(u.pathname);
      const meet = isMeetHost(u.hostname);
      return zoom || meet;
    } catch { return false; }
  }

  // tenta extrair um link externo (Zoom/Meet) guardado como parâmetro do D2L
  function extractExternalFromBrightspace(absHref) {
    try {
      const u = new URL(absHref);
      if (!isBrightspace(u.hostname)) return null;

      // 1) parâmetros da query (?url=...)
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

      // 2) alguns wrappers colocam no fragmento (#u=...)
      if (u.hash && u.hash.length > 1) {
        const hash = u.hash.slice(1);
        const hp = new URLSearchParams(hash);
        for (const k of PARAM_KEYS) {
          const raw = hp.get(k);
          if (!raw) continue;
          let v = raw;
          try { v = decodeURIComponent(v); } catch {}
          try { v = decodeURIComponent(v); } catch {}
          if (!/^https?:\/\//i.test(v)) continue;
          const t = new URL(v);
          if (isEligibleAbsolute(t.href)) return t.href;
        }
      }

      return null;
    } catch { return null; }
  }

  // decide qual URL (se houver) deve ser enviada ao gateway
  function resolveTargetForWrap(href) {
    if (!href || isSkippableScheme(href)) return null;
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

  // monta URL do gateway
  function gatewayFor(targetAbs) {
    return GATEWAY + encodeURIComponent(targetAbs);
  }

  // ===== Reescrita proativa de anchors (melhora UX em SPA) =====
  function rewriteAnchors(root) {
    try {
      const scope = root || document;
      const anchors = scope.querySelectorAll('a[href]:not(.ufc-checkin-bypass):not([data-ufc-bypass])');
      anchors.forEach(a => {
        const href = a.getAttribute("href");
        if (!href || alreadyWrapped(href) || isSkippableScheme(href)) return;
        const targetAbs = resolveTargetForWrap(href);
        if (!targetAbs) return;

        // reescreve o href para o gateway (mesma aba, evita popup-blocker)
        a.setAttribute("href", gatewayFor(targetAbs));

        // por padrão mantemos o target original. Se quiser abrir sempre em nova aba:
        // if (!a.hasAttribute("target")) a.setAttribute("target", "_blank");

        // boas práticas
        const rel = (a.getAttribute("rel") || "");
        if (!/\bnoopener\b/i.test(rel) || !/\bnoreferrer\b/i.test(rel)) {
          a.setAttribute("rel", (rel + " noopener noreferrer").trim());
        }
      });
    } catch { /* silencioso */ }
  }

  // roda de cara e observa mudanças
  rewriteAnchors(document);
  const mo = new MutationObserver((list) => {
    // pequena otimização: só reescreve se mudarem href/src ou entrar nó novo
    let should = false;
    for (const m of list) {
      if (m.type === "attributes") { should = true; break; }
      if (m.addedNodes && m.addedNodes.length) { should = true; break; }
    }
    if (should) rewriteAnchors(document);
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "src"]
  });

  // ===== Clique: interfere só quando deve envolver =====
  document.addEventListener("click", (evt) => {
    try {
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
      if (!href || alreadyWrapped(href) || isSkippableScheme(href)) return;

      // se já foi reescrito (href => gateway), deixa seguir
      if (href.startsWith(GATEWAY)) return;

      const targetAbs = resolveTargetForWrap(href);
      if (!targetAbs) return; // não mexe em cliques normais

      // respeita Ctrl/⌘ ou botão do meio => nova aba
      const openNew = evt.ctrlKey || evt.metaKey || evt.button === 1;

      evt.preventDefault();
      const url = gatewayFor(targetAbs);
      if (openNew) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        window.location.href = url; // mesma aba (evita popup-blocker)
      }
    } catch { /* silencioso */ }
  }, true);

  // ===== Diagnóstico =====
  window.UFC_DIAG_SAFE = () => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const cand = anchors
      .filter(a => !(a.hasAttribute("data-ufc-bypass") || a.classList.contains("ufc-checkin-bypass")))
      .map(a => {
        const href = a.getAttribute("href");
        return { node: a, href, target: resolveTargetForWrap(href) };
      })
      .filter(x => x.target);
    console.table(cand.slice(0, 30).map(x => ({ href: x.href, target: x.target })));
    console.info(`Candidatos a wrap: ${cand.length} / Anchors: ${anchors.length}`);
    return cand;
  };
})();
