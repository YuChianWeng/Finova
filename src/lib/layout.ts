/** 版面斷點（issue #12）：≥ 960px 用平板／桌面版面；< 960px 維持手機版面。 */
const MQ = typeof matchMedia === "function" ? matchMedia("(min-width: 960px)") : null;
export const wide = () => !!MQ?.matches;
export const onWideChange = (f: () => void) => MQ?.addEventListener?.("change", f);

/**
 * 滑條閒置時隱藏（issue #14）：滑鼠在某個可捲動的欄內、鍵盤焦點在欄內時加上 .sb-on；
 * 捲動中加上 .is-scrolling，停止 900ms 後移除。
 * 用 class 而不用 CSS :hover，因為 Chrome 不一定會在 :hover 改變時重畫 ::-webkit-scrollbar-thumb。
 * scroll 事件不會冒泡，所以在 document 用 capture 監聽；只在滑鼠／觸控板裝置啟用。
 */
export function bindScrollHint() {
  if (!matchMedia("(hover:hover) and (pointer:fine)").matches) return;
  const root = document.documentElement;
  const scrollers = (start: Element | null) => {
    const out = new Set<Element>();
    for (let el = start; el && el !== document.body && el !== root; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if ((/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) || (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth)) out.add(el);
    }
    out.add(root);
    return out;
  };
  let hover = new Set<Element>(), focus = new Set<Element>();
  const apply = (prev: Set<Element>, next: Set<Element>, other: Set<Element>) => {
    prev.forEach((el) => { if (!next.has(el) && !other.has(el)) el.classList.remove("sb-on"); });
    next.forEach((el) => el.classList.add("sb-on"));
  };
  document.addEventListener("mouseover", (ev) => { const n = scrollers(ev.target as Element); apply(hover, n, focus); hover = n; }, { passive: true });
  document.addEventListener("mouseout", (ev) => { if (!ev.relatedTarget) { apply(hover, new Set(), focus); hover = new Set(); } }, { passive: true });
  document.addEventListener("focusin", (ev) => { const n = scrollers(ev.target as Element); apply(focus, n, hover); focus = n; });
  document.addEventListener("focusout", (ev) => { if (!ev.relatedTarget) { apply(focus, new Set(), hover); focus = new Set(); } });
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  document.addEventListener("scroll", (ev) => {
    const el = ev.target === document ? root : (ev.target as Element);
    if (!(el instanceof Element)) return;
    el.classList.add("is-scrolling");
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => el.classList.remove("is-scrolling"), 900));
  }, { capture: true, passive: true });
}
