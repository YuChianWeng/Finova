/** 底部面板／右側抽屜、確認對話框、toast（viewer 不顯示 alert/confirm，所以全部自己做）。 */
import { $, ic } from "../lib/dom";

export type SheetKind = "entry" | "filter" | "form" | null;
export const sheet = { kind: null as SheetKind, onClose: null as null | (() => void) };

export function sheetShell(title: string, body: string, foot: string) {
  return `<button class="grab" data-a="sfull" aria-label="展開成全螢幕"></button><div class="sheet-h"><h2 class="h2" id="sheet-title">${title}</h2><button class="ibtn" data-a="closeall" aria-label="關閉">${ic("x")}</button></div><div class="sheet-b">${body}</div><div class="sheet-f">${foot}</div>`;
}
export function openSheet(kind: SheetKind, html: string, onClose?: () => void) {
  sheet.kind = kind; sheet.onClose = onClose ?? null;
  $("#sheet")!.innerHTML = html;
  $("#sheet")!.classList.add("on"); $("#scrim")!.classList.add("on");
  document.body.style.overflow = "hidden";
}
export function setSheet(html: string) { const s = $("#sheet")!; const b = s.querySelector(".sheet-b"); const top = b?.scrollTop ?? 0; s.innerHTML = html; const nb = s.querySelector(".sheet-b"); if (nb) nb.scrollTop = top; }
export function closeSheet() {
  const f = sheet.onClose; sheet.kind = null; sheet.onClose = null;
  $("#sheet")!.classList.remove("on", "full"); $("#scrim")!.classList.remove("on");
  document.body.style.overflow = "";
  f?.();
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
