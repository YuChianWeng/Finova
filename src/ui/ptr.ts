/**
 * 下拉更新（TECH-SPEC §13.1）：從主畫面開啟（standalone）時沒有瀏覽器的下拉重新整理，
 * 所以在總覽、帳戶、明細頁自己做。瀏覽器分頁裡不啟用，以免和 Safari／Chrome 內建的重複。
 */
import { ic } from "../lib/dom";

const THRESHOLD = 64; // 拉超過這個距離（px）放開就更新
const MAX = 96;

export function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
}

export function bindPullToRefresh(opt: { enabled: () => boolean; refresh: () => Promise<unknown> }) {
  if (!isStandalone() || !("ontouchstart" in window)) return;
  document.documentElement.classList.add("standalone");
  const el = document.createElement("div");
  el.className = "ptr"; el.setAttribute("aria-hidden", "true");
  el.innerHTML = ic("undo");
  document.body.appendChild(el);

  let y0 = 0, x0 = 0, dy = 0, mode: "idle" | "maybe" | "pull" | "busy" = "idle";
  const set = (d: number, anim = false) => {
    el.style.transition = anim ? "transform .2s, opacity .2s" : "none";
    el.style.transform = `translate(-50%, ${d - 48}px) rotate(${d * 4}deg)`;
    el.style.opacity = String(Math.min(1, d / THRESHOLD));
    el.classList.toggle("ready", d >= THRESHOLD);
  };
  const blocked = (t: EventTarget | null) =>
    !!(t as Element | null)?.closest?.(".sheet, .dlg, .scrim.on, input, textarea, select, .kpis, .chips-scroll, .seg");

  document.addEventListener("touchstart", (e) => {
    if (mode === "busy" || e.touches.length !== 1 || window.scrollY > 0 || !opt.enabled() || blocked(e.target)) { mode = "idle"; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; mode = "maybe";
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (mode !== "maybe" && mode !== "pull") return;
    const ddy = e.touches[0].clientY - y0, ddx = e.touches[0].clientX - x0;
    if (mode === "maybe") {
      if (Math.abs(ddx) > Math.abs(ddy) || ddy <= 0) { if (Math.abs(ddx) > 8 || ddy < -8) mode = "idle"; return; } // 左右滑（交易列）或往上捲
      if (ddy < 8) return;
      mode = "pull";
    }
    if (window.scrollY > 0) { mode = "idle"; set(0, true); return; }
    e.preventDefault();
    dy = Math.min(MAX, ddy * 0.5); // 阻尼
    set(dy);
  }, { passive: false });

  const end = async () => {
    if (mode !== "pull") { if (mode === "maybe") mode = "idle"; return; }
    if (dy < THRESHOLD) { mode = "idle"; set(0, true); return; }
    mode = "busy"; el.classList.add("spin"); set(THRESHOLD, true);
    try { await opt.refresh(); } finally { el.classList.remove("spin"); set(0, true); mode = "idle"; }
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
}
