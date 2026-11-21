// Keeps bottom-pinned bars (tab bar, offline bar) on screen in kiosk apps and older iPad web views,
// where the page can be taller than what's visible or a toolbar covers the bottom. Sets
// --vv-bottom to how far the visible area's bottom sits above the layout viewport's bottom.
export function startViewportFit() {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const fit = () => {
    const vv = window.visualViewport;
    const layoutH = Math.max(window.innerHeight, document.documentElement.clientHeight);
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const gap = Math.max(0, Math.round(layoutH - visibleBottom));
    // Ignore the on-screen keyboard (a big jump while typing): only small gaps are toolbars/rounding.
    root.style.setProperty("--vv-bottom", `${gap > 0 && gap < 200 ? gap : 0}px`);
    root.style.setProperty("--vv-h", `${Math.round(vv ? vv.height : window.innerHeight)}px`);
  };
  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", () => window.setTimeout(fit, 350));
  window.visualViewport?.addEventListener("resize", fit);
  window.visualViewport?.addEventListener("scroll", fit);
}
