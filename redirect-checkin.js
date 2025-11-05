(function () {
  const GATEWAY = "https://letalock.github.io/zoom_chekin?u=";

  if (window.__UFC_CHECKIN_SAFE__) return;
  window.__UFC_CHECKIN_SAFE__ = true;

  // ===== Helpers =====
  const isZoomHost = h =>
    h === "zoom.us" || h.endsWith(".zoom.us") ||
    h === "zoom.com" || h.endsWith(".zoom.com") ||
    h === "zoomgov.com" || h.endsWith(".zoomgov.com");

  const isJoinPath    = p => /^\/(j|wc\/join|s)\//.test(p);
  // ✅ rota LTI do Zoom (ex.: /lti/rich/j/88365598174)
  const isLtiJoinPath = p => /^\/lti\/[^/]+\/j\/\d+/.test(p);

  // ✅ NOVO: considerar também o host do Zoom LTI
  const isZoomApplicationsHost = h => h === "applications.zoom.us" || h.endsWith(".applications.zoom.us");

  const isMeetHost = h => h === "meet.google.com";
  const isBrightspace = h => /\.brightspace\.com$/i.test(h) || h.includes(".d2l.");

  const PARAM_KEYS = ["targetUrl", "url", "u", "target", "href", "link"];

  const toAbs = (h) => { try { return new URL(h, location.href).href; } catch { return null; } };
  const alreadyWrapped = (href) => typeof href === "string" && href.startsWith(GATEWAY);
  const isSkippableScheme = (href) => /^(mailto:|tel:|javascript:|data:|blob:|#)/i.test(href || "");

  // 🔧 NOVO: extrai meetingId de qualquer caminho que contenha "/j/123..."
  function extractMeetingIdFromPath(pathname) {
    const m = pathname.match(/\/j\/(\d+)/);
    return m ? m[1] : null;
  }

  // 🔧 NOVO: normaliza LTI → join direto (https://zoom.us/j/{id})
  function normalizeZoomLti(absHref) {
    try {
      const u = new URL(absHref);
      if (isZoomApplicationsHost(u.hostname) && isLtiJoinPath(u.pathname)) {
        const meetingId = extractMeetingIdFromPath(u.pathname);
        if (meetingId) {
          return `https://zoom.us/j/${meetingId}`;
        }
      }
      return absHref;
    } catch {
      return absHref;
    }
  }

  function isEligibleAbsolute(absHref) {
    try {
      const u = new URL(absHref);
      if (!(u.protocol === "http:" || u.protocol === "https:")) return false;

      // ✅ AJUSTE: aceitar zoom.us *ou* applications.zoom.us, com caminhos join/LTI
      const zoom = (isZoomHost(u.hostname) || isZoomApplicationsHost(u.hostname))
                && (isJoinPath(u.pathname) || isLtiJoinPath(u.pathname));

      const meet = isMeetHost(u.hostname);
      return zoom || meet;
    } catch { return false; }
  }

  function extractExternalFromBrightspace(absHref) {
    try {
      const u = new URL(absHref);
      if (!isBrightspace(u.hostname)) return null;

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

      if (u.hash && u.hash.length > 1) {
        const hp = new URLSearchParams(u.hash.slice(1));
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

  function resolveTargetForWrap(href) {
    if (!href || isSkippableScheme(href)) return null;
    const absRaw = toAbs(href);
    if (!absRaw) return null;

    // 🔧 NOVO: normaliza LTI → join direto antes de validar
    const abs = normalizeZoomLti(absRaw);

    try {
      const u = new URL(abs);
      if (isBrightspace(u.hostname)) {
        const ext = extractExternalFromBrightspace(abs);
        // se extraiu, também normaliza caso venha LTI
        const normalized = ext ? normalizeZoomLti(ext) : null;
        return normalized && isEligibleAbsolute(normalized) ? normalized : null;
      }
      return isEligibleAbsolute(abs) ? abs : null;
    } catch { return null; }
  }

  const gatewayFor = (targetAbs) => GATEWAY + encodeURIComponent(targetAbs);

  // ===== Reescrita proativa de anchors
  function rewriteAnchors(root) {
    try {
      const scope = root || document;
      const anchors = scope.querySelectorAll('a[href]:not(.ufc-checkin-bypass):not([data-ufc-bypass])');
      anchors.forEach(a => {
        const href = a.getAttribute("href");
        if (!href || alreadyWrapped(href) || isSkippableScheme(href)) return;
        const targetAbs = resolveTargetForWrap(href);
        if (!targetAbs) return;

        a.setAttribute("href", gatewayFor(targetAbs));
        const rel = (a.getAttribute("rel") || "");
        if (!/\bnoopener\b/i.test(rel) || !/\bnoreferrer\b/i.test(rel)) {
          a.setAttribute("rel", (rel + " noopener noreferrer").trim());
        }
      });
    } catch {}
  }

  rewriteAnchors(document);
  const mo = new MutationObserver(list => {
    let should = false;
    for (const m of list) {
      if (m.type === "attributes") { should = true; break; }
      if (m.addedNodes && m.addedNodes.length) { should = true; break; }
    }
    if (should) rewriteAnchors(document);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href","src"] });

  // ===== Clique (fallback)
  const clickHandler = (evt) => {
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
      if (href.startsWith(GATEWAY)) return;

      const targetAbs = resolveTargetForWrap(href);
      if (!targetAbs) return;

      const openNew = evt.ctrlKey || evt.metaKey || evt.button === 1;
      evt.preventDefault();
      const url = gatewayFor(targetAbs);
      if (openNew) window.open(url, "_blank", "noopener,noreferrer");
      else window.location.replace(url);
    } catch {}
  };

  document.addEventListener("click", clickHandler, true);
  // 🔧 NOVO: cobre clique com botão do meio em todos os navegadores
  document.addEventListener("auxclick", clickHandler, true);

  // ===== JOIN INTERCEPTION (window.open / location.*)
  (function joinInterceptor() {
    const resolveJoin = (urlLike) => {
      try {
        if (!urlLike) return null;
        const abs0 = toAbs(String(urlLike));
        if (!abs0) return null;

        // 🔧 NOVO: normaliza LTI também aqui
        const abs = normalizeZoomLti(abs0);

        const wrapped = resolveTargetForWrap(abs);
        if (wrapped) return gatewayFor(wrapped);

        if (isEligibleAbsolute(abs)) return gatewayFor(abs);
        return null;
      } catch { return null; }
    };

    try {
      const _open = window.open;
      Object.defineProperty(window, "open", {
        configurable: true,
        writable: true,
        value: function (url, name, specs) {
          try {
            const gw = resolveJoin(url);
            if (gw) return _open.call(window, gw, name || "_self", specs);
          } catch {}
          return _open.apply(window, arguments);
        }
      });
    } catch {}

    try {
      const loc = window.location;
      const _assign  = loc.assign.bind(loc);
      const _replace = loc.replace.bind(loc);

      loc.assign  = function (url) { const gw = resolveJoin(url); return _assign(gw || url);  };
      loc.replace = function (url) { const gw = resolveJoin(url); return _replace(gw || url); };

      const desc = Object.getOwnPropertyDescriptor(Location.prototype, "href");
      if (desc && desc.set) {
        const _set = desc.set;
        const _get = desc.get;
        Object.defineProperty(loc, "href", {
          configurable: true,
          get: function() { return _get.call(loc); },
          set: function(v) { const gw = resolveJoin(v); return _set.call(loc, gw || v); }
        });
      }
    } catch {}
  })();

  // ===== Diagnóstico
  window.UFC_DIAG_SAFE = () => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const cand = anchors
      .filter(a => !(a.hasAttribute("data-ufc-bypass") || a.classList.contains("ufc-checkin-bypass")))
      .map(a => { const href = a.getAttribute("href"); return { href, target: resolveTargetForWrap(href) }; })
      .filter(x => x.target);
    console.table(cand.slice(0, 30));
    console.info(`Candidatos a wrap: ${cand.length} / Anchors: ${anchors.length}`);
    return cand;
  };
})();
