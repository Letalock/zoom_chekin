(function () {
  const GATEWAY = "https://letalock.github.io/aula_zoom?u=";

  const isZoomHost = h =>
    h === "zoom.us" || h.endsWith(".zoom.us") ||
    h === "zoom.com" || h.endsWith(".zoom.com") ||
    h === "zoomgov.com" || h.endsWith(".zoomgov.com");
  const isJoinPath = p => /^\/(j|wc\/join|s)\//.test(p);
  const isMeetHost = h => h === "meet.google.com";

  function shouldWrap(href) {
    try {
      const u = new URL(href, location.href);
      const http = u.protocol === "http:" || u.protocol === "https:";
      const zoom = isZoomHost(u.hostname) && isJoinPath(u.pathname);
      const meet = isMeetHost(u.hostname);
      return http && (zoom || meet);
    } catch { return false; }
  }
  const alreadyWrapped = href => typeof href === "string" && href.startsWith(GATEWAY);
  const wrap = href => (!href || alreadyWrapped(href) || !shouldWrap(href)) ? href : (GATEWAY + encodeURIComponent(href));

  // 1) Intercepta clique global (inclui shadow DOM)
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
      const href = a.getAttribute("href");
      const newHref = wrap(href);
      if (newHref && newHref !== href) {
        evt.preventDefault();
        window.open(newHref, "_blank", "noopener,noreferrer"); // evita iframe bloqueado
      }
    } catch {}
  }, true);

  // 2) Reescreve anchors continuamente (pega SPA/iframes same-origin)
  function rewriteAnchors(root) {
    try {
      (root || document).querySelectorAll('a[href]:not(.ufc-checkin-bypass)').forEach(a => {
        const oldHref = a.getAttribute("href");
        const newHref = wrap(oldHref);
        if (newHref && newHref !== oldHref) {
          a.setAttribute("href", newHref);
          if (!a.hasAttribute("target")) a.setAttribute("target", "_blank");
          a.setAttribute("rel", (a.getAttribute("rel") || "") + " noopener noreferrer");
        }
      });
    } catch {}
    // iframes same-origin
    document.querySelectorAll("iframe").forEach(ifr => {
      try {
        const idoc = ifr.contentDocument || ifr.contentWindow?.document;
        if (idoc) rewriteAnchors(idoc);
      } catch {}
    });
  }

  // loop curto para conteúdo dinâmico
  rewriteAnchors(document);
  const obs = new MutationObserver(() => rewriteAnchors(document));
  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href","src"] });
  setInterval(() => rewriteAnchors(document), 1500);

  // Diagnóstico rápido no console
  window.UFC_DIAG = () => {
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
    const cand = links.filter(h => shouldWrap(h) && !alreadyWrapped(h));
    console.table(cand.slice(0,30));
    console.info(`Total links: ${links.length} | Candidatos a wrap: ${cand.length}`);
  };
})();
