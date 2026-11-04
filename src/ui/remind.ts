/**
 * 待處理提醒（FRONTEND-CONTRACT §2.6 Alert[]）：總覽的「待處理」卡片和鈴鐺面板共用同一份 render。
 * 鈴鐺面板：手機是底部面板，桌面是鈴鐺下方的彈出面板；不換頁、不捲動（issue #7）。
 */
import type * as L from "../types/ledger";
import { $, esc, ic } from "../lib/dom";
import { fmt } from "../lib/money";
import { today, daysBetween, md } from "../lib/dates";
import { app } from "../state";
import { href } from "../router";
import { openSheet, closeSheet, sheet, setSheet } from "./overlay";

function alertItem(a: L.Alert): { ic: string; t: string; s: string; btn: string; ac?: boolean } {
  switch (a.type) {
    case "reconcile_due": return { ic: "scale", t: `${esc(a.account_name)} ${a.days} 天未對帳`, s: "對帳可以找出漏記或重複", btn: `<a class="btn sm" href="${href("/reconcile?account=" + encodeURIComponent(a.account_key))}">對帳</a>` };
    case "uncategorized": return { ic: "alert", t: `${a.count} 筆交易未分類`, s: "來自聊天機器人、捷徑與自動入帳", btn: `<a class="btn sm" href="${href("/transactions?categories=uncategorized")}">分類</a>` };
    case "recurring_due": { const dd = daysBetween(today(), a.due_date); return { ic: "repeat", ac: true, t: `週期交易：${esc(a.name)} ${dd === 0 ? "今天" : dd === 1 ? "明天" : dd < 0 ? `已過期 ${-dd} 天` : `${dd} 天後`}到期`, s: `${md(a.due_date)} · ${fmt(a.amount.amount, a.amount.currency)}`, btn: `<span class="row" style="gap:6px"><button class="btn sm g" data-a="occ-skip" data-id="${a.rule_id}" data-d="${a.due_date}">略過</button><button class="btn sm" data-a="occ-ok" data-id="${a.rule_id}" data-d="${a.due_date}">確認入帳</button></span>` }; }
    case "budget_warning": case "budget_over": return { ic: "target", t: `${esc(a.name)} 預算${a.type === "budget_over" ? "已超支" : "快用完"}（${Math.round(a.ratio * 100)}%）`, s: "看看各分類的花費", btn: `<a class="btn sm" href="${href("/budgets")}">查看</a>` };
    case "goal_behind": return { ic: "target", t: `存錢目標「${esc(a.name)}」進度落後`, s: "照目前速度會晚於期限達成", btn: `<a class="btn sm" href="${href("/goals/" + a.goal_id)}">查看</a>` };
    case "card_due": { const dd = daysBetween(today(), a.due_date); return { ic: "card", t: `${esc(a.name)} 帳單 ${dd >= 0 ? `${dd} 天後` : "已"}到期`, s: `${md(a.due_date)} · ${fmt(a.amount.amount, a.amount.currency)}`, btn: `<button class="btn sm" data-a="pay" data-id="${esc(a.account_key)}" data-amt="${a.amount.amount}">繳卡費</button>` }; }
    case "opening_missing": return { ic: "wallet", t: `${a.count} 個帳戶還沒設定期初餘額`, s: "設定後才能計算餘額與對帳", btn: `<a class="btn sm" href="${href("/settings/accounts/opening")}">設定</a>` };
    case "data_notice": return { ic: "alert", t: esc(a.message), s: "", btn: "" };
  }
}
/** 提醒清單（每一項保留原本的動作按鈕）；沒有提醒時顯示「都處理完了」 */
export function remindList(alerts: L.Alert[]) {
  if (!alerts.length) return `<p class="mu sm remind-empty">${ic("check", "s")} 都處理完了</p>`;
  return `<div class="remind-list">${alerts.map(alertItem).map((r) => `<div class="remind"><span class="ri ${r.ac ? "ac" : ""}">${ic(r.ic, "s")}</span><div style="flex:1;min-width:0"><div style="font-weight:500">${r.t}</div>${r.s ? `<div class="xs mu">${r.s}</div>` : ""}</div>${r.btn}</div>`).join("")}</div>`;
}

const panel = () => `<button class="grab" aria-hidden="true" tabindex="-1"></button><div class="sheet-h"><h2 class="h2" id="sheet-title">${ic("bell")}待處理 <span class="eyebrow" style="margin-left:4px">${app.alerts.length} 項</span></h2><button class="ibtn" data-a="closeall" aria-label="關閉">${ic("x")}</button></div><div class="sheet-b">${remindList(app.alerts)}</div>`;

/** 開啟鈴鐺面板（在目前頁面上，不換頁） */
export function openRemind(trigger?: HTMLElement | null) {
  openSheet("remind", panel(), undefined, { cls: "pop", returnFocus: "[data-a=bell]" });
  const s = $("#sheet")!;
  if (trigger && matchMedia("(min-width:960px)").matches) {
    const r = trigger.getBoundingClientRect();
    s.style.top = `${Math.round(r.bottom + 8)}px`;
    s.style.left = `${Math.round(Math.min(r.left, window.innerWidth - 420 - 16))}px`;
  }
}
/** 提醒更新後（badge 會一起變），若面板開著就同步內容 */
export function refreshRemind() { if (sheet.kind === "remind") setSheet(panel()); }

/* 面板裡點了某一項的動作：先關閉面板（焦點不回鈴鐺），再讓原本的連結／動作執行 */
let bound = false;
export function bindRemind() {
  if (bound) return; bound = true;
  const s = $("#sheet")!;
  s.addEventListener("click", (e) => {
    if (sheet.kind !== "remind") return;
    const t = (e.target as Element).closest(".remind a[href], .remind [data-a]");
    if (t) closeSheet({ restoreFocus: false });
  }, true);
  // 手機：從把手、標題或清單頂端往下滑關閉
  let y0 = -1, dy = 0;
  s.addEventListener("touchstart", (e) => {
    if (sheet.kind !== "remind" || e.touches.length !== 1) { y0 = -1; return; }
    const b = s.querySelector(".sheet-b"); const inBody = !!(e.target as Element).closest(".sheet-b");
    if (inBody && b && b.scrollTop > 0) { y0 = -1; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  s.addEventListener("touchmove", (e) => {
    if (y0 < 0) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 0) { e.preventDefault(); s.style.transition = "none"; s.style.transform = `translateY(${dy}px)`; }
  }, { passive: false });
  const end = () => {
    if (y0 < 0) return; y0 = -1;
    s.style.transition = ""; s.style.transform = "";
    if (dy > 80) closeSheet();
  };
  s.addEventListener("touchend", end); s.addEventListener("touchcancel", end);
}
