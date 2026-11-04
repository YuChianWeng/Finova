/** 底部面板／右側抽屜、確認對話框、toast（viewer 不顯示 alert/confirm，所以全部自己做）。 */
import { $, ic } from "../lib/dom";

export type SheetKind = "entry" | "filter" | "form" | "remind" | null;
export const sheet = { kind: null as SheetKind, onClose: null as null | (() => void) };
/** 關閉面板後焦點要回到哪裡：開啟時的元素；它被重畫掉了就用 fallback 選擇器重新找 */
let returnTo: { el: HTMLElement | null; fallback?: string } = { el: null };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
export const focusables = (root: Element) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);

/* 焦點鎖在面板／對話框內（Tab、Shift+Tab 循環） */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const root = dialogOpen() ? $("#dlg") : sheetOpen() ? $("#sheet") : null;
  if (!root) return;
  const f = focusables(root); if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1], a = document.activeElement as HTMLElement | null;
  if (!a || !root.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
});

export function sheetShell(title: string, body: string, foot: string) {
  return `<button class="grab" data-a="sfull" aria-label="展開成全螢幕"></button><div class="sheet-h"><h2 class="h2" id="sheet-title">${title}</h2><button class="ibtn" data-a="closeall" aria-label="關閉">${ic("x")}</button></div><div class="sheet-b">${body}</div><div class="sheet-f">${foot}</div>`;
}
export function openSheet(kind: SheetKind, html: string, onClose?: () => void, o: { cls?: string; returnFocus?: string } = {}) {
  const prevOpen = sheetOpen();
  sheet.kind = kind; sheet.onClose = onClose ?? null;
  if (!prevOpen) returnTo = { el: document.activeElement as HTMLElement | null, fallback: o.returnFocus };
  else if (o.returnFocus) returnTo.fallback = o.returnFocus;
  const s = $("#sheet")!;
  s.innerHTML = html;
  s.removeAttribute("style");
  s.classList.toggle("pop", o.cls === "pop");
  s.classList.add("on"); $("#scrim")!.classList.add("on");
  document.body.style.overflow = "hidden";
  (s.querySelector<HTMLElement>("[data-a=closeall]") ?? focusables(s)[0])?.focus({ preventScroll: true });
}
export function setSheet(html: string) {
  const s = $("#sheet")!; const b = s.querySelector(".sheet-b"); const top = b?.scrollTop ?? 0;
  // 重畫後把焦點還給「同一個」元素（依 id 或 data-a + data-id 對應），焦點才不會掉到 body
  const a = document.activeElement as HTMLElement | null;
  const key = a && s.contains(a) ? (a.id ? `#${CSS.escape(a.id)}` : a.dataset.a ? `[data-a="${a.dataset.a}"]${a.dataset.id ? `[data-id="${CSS.escape(a.dataset.id)}"]` : ""}` : null) : null;
  s.innerHTML = html;
  const nb = s.querySelector(".sheet-b"); if (nb) nb.scrollTop = top;
  if (key) s.querySelector<HTMLElement>(key)?.focus({ preventScroll: true });
}
export function closeSheet(o: { restoreFocus?: boolean } = {}) {
  const wasOpen = sheetOpen();
  const f = sheet.onClose; sheet.kind = null; sheet.onClose = null;
  $("#sheet")!.classList.remove("on", "full"); $("#scrim")!.classList.remove("on");
  document.body.style.overflow = "";
  f?.();
  if (wasOpen && o.restoreFocus !== false) {
    const t = returnTo.el?.isConnected ? returnTo.el : returnTo.fallback ? [...document.querySelectorAll<HTMLElement>(returnTo.fallback)].find(visible) : null;
    t?.focus({ preventScroll: true });
  }
  returnTo = { el: null };
}
export const sheetOpen = () => $("#sheet")!.classList.contains("on");

let dlgOk: null | (() => void) = null, dlgCancel: null | (() => void) = null;
export function dialog(title: string, body: string, okLabel: string, ok: () => void, o: { danger?: boolean; cancel?: string; onCancel?: () => void } = {}) {
  dlgOk = ok; dlgCancel = o.onCancel ?? null;
  $("#dlg")!.innerHTML = `<h2 id="dlg-title">${title}</h2><div class="sm">${body}</div><div class="row" style="justify-content:flex-end;flex-wrap:wrap">${o.cancel === "" ? "" : `<button class="btn" data-a="dlg-cancel">${o.cancel ?? "取消"}</button>`}<button class="btn ${o.danger ? "d" : "p"}" data-a="dlg-ok">${okLabel}</button></div>`;
  $("#dlg")!.classList.add("on"); $("#scrim")!.classList.add("on");
  setTimeout(() => ($("#dlg input") ?? $("#dlg [data-a=dlg-cancel]") ?? $("#dlg [data-a=dlg-ok]"))?.focus(), 50);
}
export const dialogOpen = () => $("#dlg")!.classList.contains("on");
function hideDlg() { $("#dlg")!.classList.remove("on"); if (!sheetOpen()) $("#scrim")!.classList.remove("on"); }
export function dlgConfirm() { const f = dlgOk; dlgOk = null; dlgCancel = null; hideDlg(); f?.(); }
export function dlgDismiss() { const f = dlgCancel; dlgOk = null; dlgCancel = null; hideDlg(); f?.(); }

let toastT: ReturnType<typeof setTimeout> | undefined, toastUndo: null | (() => void) = null;
export function toast(msg: string, undo?: (() => void) | null, extra = "", ms = 5200) {
  toastUndo = undo ?? null; const el = $("#toast")!;
  el.innerHTML = `<span>${msg}</span>${undo ? `<button class="btn" data-a="undo">${ic("undo", "s")}復原</button>` : ""}${extra}`;
  el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), ms);
}
export function runUndo() { const f = toastUndo; toastUndo = null; $("#toast")!.classList.remove("on"); f?.(); }
export const hideToast = () => $("#toast")!.classList.remove("on");
