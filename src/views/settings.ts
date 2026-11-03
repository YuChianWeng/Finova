/** 設定（/finance/settings 與子頁）、更多（/finance/more）、帳戶表單與刪除流程。 */
import type * as L from "../types/ledger";
import { $, $$, esc, ic } from "../lib/dom";
import { fmt, MINUS, neg, curInfo, isPositiveAmount } from "../lib/money";
import { today, md, slash, splitDT, daysBetween, isoDateTime } from "../lib/dates";
import { app, getCatalog, invalidateCatalog, accOpt, catLabel } from "../state";
import { api } from "../api/ledger";
import { LedgerError } from "../api/client";
import { registerView, actions, rerender, reload, handleError, currentData, go } from "../app";
import { href } from "../router";
import { amtHTML, emptyState, GROUP_TEXT, catColor, catIconName } from "../ui/components";
import { dialog, toast, openSheet, setSheet, sheetShell, closeSheet } from "../ui/overlay";

const MOCK = import.meta.env.VITE_USE_MOCK === "true";
let mockPanel: { get: () => string; set: (s: any) => void; list: [string, string][] } | null = null;
if (MOCK) import("../../mocks/browser").then((m) => (mockPanel = { get: m.getScenario, set: m.setScenario, list: m.SCENARIOS }));

/* ------------------------------------------------------------ 設定首頁 */
registerView("settings", {
  load: async () => ({ rec: await api.recurring(), trash: await api.trash() }),
  render: (d: { rec: L.RecurringResponse; trash: L.TrashResponse }) => {
    const th = document.documentElement.dataset.theme || "system";
    const item = (p: string, icn: string, l: string, extra = "") => `<a href="${href(p)}">${ic(icn)}${l}${extra ? `<span class="xs mu" style="margin-left:auto">${extra}</span>` : ""}${ic("chev-r", "chev")}</a>`;
    const mock = MOCK && mockPanel ? `<div class="card sp-6"><div class="ch"><h2 class="h2">${ic("gear")}開發用 Mock</h2><span class="eyebrow">只在 mock 模式出現</span></div><p class="sm mu" style="margin:0 0 10px">模擬契約 §7 要求的錯誤情境。單次情境觸發一次後會自動回到正常。</p><div class="wrap-row">${mockPanel.list.map(([k, l]) => `<button class="chip" data-a="mock" data-v="${k}" aria-pressed="${mockPanel!.get() === k}">${esc(l)}</button>`).join("")}</div></div>` : "";
    return `<div class="grid">
      <div class="card sp-6"><div class="ch"><h2 class="h2">${ic("sun")}外觀</h2></div><div class="seg full" role="group" aria-label="主題">${[["system", "跟隨系統"], ["dark", "深色"], ["light", "淺色"]].map(([k, l]) => `<button data-a="set-theme" data-v="${k}" aria-pressed="${th === k}">${l}</button>`).join("")}</div></div>
      <div class="card sp-6"><div class="mlist">
        ${item("/settings/accounts", "wallet", "帳戶管理", `${app.catalog!.accounts.filter((a) => !a.is_archived).length} 個`)}
        ${item("/settings/accounts/opening", "scale", "期初餘額")}
        ${item("/settings/categories", "tag", "分類管理", "兩層")}
        ${item("/settings/tags", "tag", "標籤", `${app.catalog!.tags.length} 個`)}
        ${item("/settings/recurring", "repeat", "週期交易", `${d.rec.rules.filter((r) => r.is_active).length} 條`)}
        ${item("/settings/trash", "trash", "最近刪除", `${d.trash.transactions.length + d.trash.accounts.length} 筆`)}
      </div></div>
      <div class="card sp-6"><div class="ch"><h2 class="h2">${ic("download")}匯出</h2></div><p class="sm mu" style="margin:0 0 12px">把交易匯出成 CSV，可用 Excel 或 Google 試算表開啟。可以先在明細篩選再匯出。</p><a class="btn" href="${href("/transactions")}">${ic("list")}到明細匯出</a></div>
      ${mock}
    </div>`;
  },
  title: () => "設定", back: "/more", nav: "/settings",
});

/* ------------------------------------------------------------ 更多（手機） */
registerView("more", {
  load: async () => api.accounts(false),
  render: (a: L.AccountsResponse) => {
    const due = a.groups.flatMap((g) => g.accounts).filter((x) => x.reconcile.due).length;
    return `<div class="card"><div class="mlist">
      <a href="${href("/transactions")}">${ic("list")}全部交易${ic("chev-r", "chev")}</a>
      <a href="${href("/budgets")}">${ic("target")}預算・專案・存錢目標${ic("chev-r", "chev")}</a>
      <a href="${href("/reconcile")}">${ic("scale")}對帳${due ? `<span class="st warn" style="margin-left:auto">! ${due}</span>` : ""}${ic("chev-r", "chev")}</a>
      <a href="${href("/settings")}">${ic("gear")}設定${ic("chev-r", "chev")}</a>
      <a href="/portfolio" data-a="stocks">${ic("trend")}股票${ic("ext", "chev")}</a>
    </div></div>`;
  },
  title: () => "更多", nav: "/settings",
});

/* ------------------------------------------------------------ 帳戶管理 */
registerView("settings-accounts", {
  load: () => api.accounts(true),
  render: (a: L.AccountsResponse) => {
    const row = (s: L.AccountSummary) => `<a href="${href("/accounts/" + encodeURIComponent(s.account_key))}">${ic(s.icon ?? "wallet")}<span>${esc(s.name)} <span class="xs mu">${GROUP_TEXT[s.group]} · ${s.currency}${s.is_archived ? " · 已封存" : ""}</span></span>${ic("chev-r", "chev")}</a>`;
    return `<div class="card"><div class="ch"><h2 class="h2">${ic("wallet")}帳戶</h2><button class="btn sm p" data-a="acc-new">${ic("plus", "s")}新增帳戶</button></div><div class="mlist">${a.groups.flatMap((g) => g.accounts).map(row).join("")}${a.archived.map(row).join("")}</div>
      <p class="xs mu" style="margin:10px 0 0">投資帳戶由股票區管理，這裡只顯示總額。</p></div>`;
  },
  title: () => "帳戶管理", back: "/settings", nav: "/settings",
});

type AF = { key?: string; v: Record<string, string>; err: Record<string, string> };
let AFS: AF | null = null;
const afld = (id: string, label: string, input: string) => `<div class="fld"><label class="eyebrow" for="af-${id}">${label}</label>${input}${AFS!.err[id] ? `<p class="err">${ic("alert", "s")}${esc(AFS!.err[id])}</p>` : ""}</div>`;
const ainp = (id: string, attrs = "") => `<input id="af-${id}" class="in" value="${esc(AFS!.v[id] ?? "")}" ${attrs} ${AFS!.err[id] ? 'aria-invalid="true"' : ""}>`;
function accSheet() {
  const f = AFS!, edit = !!f.key, cc = f.v.group === "credit_card", liab = cc || f.v.group === "liability";
  const groups: L.AccountGroup[] = ["cash", "bank", "credit_card", "stored_value", "liability", "receivable", "other"];
  return sheetShell(edit ? "編輯帳戶" : "新增帳戶",
    afld("name", "名稱", ainp("name", 'placeholder="例：中信信用卡" maxlength="60"')) +
    `<div class="two">${afld("group", "類型", `<select id="af-group" class="in">${groups.map((g) => `<option value="${g}" ${f.v.group === g ? "selected" : ""}>${GROUP_TEXT[g]}</option>`).join("")}</select>`)}${afld("currency", "幣別" + (edit ? "（有交易後不可改）" : ""), `<select id="af-currency" class="in">${app.catalog!.currencies.map((c) => `<option value="${c.code}" ${f.v.currency === c.code ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`)}</div>` +
    afld("aliases", "別名（聊天機器人、捷徑辨識用，空白分隔）", ainp("aliases", 'placeholder="中信 LINE Pay卡"')) +
    (cc ? `<div class="two">${afld("statement_day", "結帳日", ainp("statement_day", 'inputmode="numeric" placeholder="1–31"'))}${afld("due_day", "繳款日", ainp("due_day", 'inputmode="numeric" placeholder="1–31"'))}</div>${afld("credit_limit", "信用額度", ainp("credit_limit", 'inputmode="numeric"'))}` : "") +
    afld("reconcile_reminder_days", "幾天沒對帳要提醒", ainp("reconcile_reminder_days", 'inputmode="numeric"')) +
    (edit ? "" : `<div class="two">${afld("opening", liab ? "目前欠款（期初，正數）" : "期初餘額", ainp("opening", 'inputmode="decimal" placeholder="選填"'))}${afld("opening_at", "期初日期", ainp("opening_at", 'type="date"'))}</div>`),
    `<button class="btn" data-a="closeall">取消</button><button class="btn p" data-a="af-save">${ic("check", "s")}${edit ? "儲存" : "建立"}</button>`);
}
export async function openAccountForm(key?: string) {
  await getCatalog();
  if (key) {
    try {
      const a = await api.account(key);
      AFS = { key, err: {}, v: { name: a.name, group: a.group, currency: a.currency, aliases: (accOpt(key)?.aliases ?? []).join(" "), statement_day: String(a.credit_card?.statement_day ?? ""), due_day: String(a.credit_card?.due_day ?? ""), credit_limit: a.credit_card?.credit_limit?.amount ?? "", reconcile_reminder_days: String(a.reconcile.reminder_days) } };
    } catch (e) { handleError(e); return; }
  } else AFS = { err: {}, v: { group: "bank", currency: "TWD", reconcile_reminder_days: "30", opening_at: today() } };
  openSheet("form", accSheet(), () => (AFS = null));
}
function readAcc() { $$<HTMLInputElement>("#sheet [id^=af-]").forEach((i) => (AFS!.v[i.id.slice(3)] = i.value)); }
export async function deleteAccountFlow(key: string) {
  try {
    const p = await api.deletePreview(key); const a = accOpt(key)!;
    const used = [...p.used_by.goals.map((x) => `存錢目標「${esc(x)}」`), ...p.used_by.recurring.map((x) => `週期交易「${esc(x)}」`), ...p.used_by.loans];
    const opts = p.allowed_modes.map((m) => `<label class="opt" style="cursor:pointer"><input type="radio" name="dm" value="${m}" ${m === p.allowed_modes[0] ? "checked" : ""} style="accent-color:var(--ac)"><span><b>${{ empty: "直接刪除（沒有交易）", merge: "合併到其他帳戶", with_transactions: "連同交易一起刪除" }[m]}</b><span class="sm mu">${{ empty: "帳戶沒有任何紀錄。", merge: `把 ${p.transactions} 筆交易搬到另一個同幣別帳戶。`, with_transactions: `${p.transactions} 筆交易（含 ${p.transfer_groups} 組轉帳）一起移到最近刪除，30 天內可還原。` }[m]}</span></span></label>`).join("");
    dialog(`刪除「${esc(a.name)}」？`, `${used.length ? `<div class="callout warn" style="margin-bottom:10px">${ic("alert")}<div>這個帳戶被 ${used.join("、")} 使用中，請先修改它們。</div></div>` : ""}
      <p class="mu" style="margin:0 0 10px">${p.transactions} 筆交易 · ${p.reconciliations} 筆對帳紀錄。建議改用「封存」保留歷史。</p><div class="stack" style="gap:8px">${opts}</div>
      ${p.allowed_modes.includes("merge") ? `<div class="fld" style="margin-top:10px"><label class="eyebrow" for="dm-target">合併到</label><select id="dm-target" class="in">${p.merge_targets.map((k) => `<option value="${k}">${esc(accOpt(k)?.name ?? k)}</option>`).join("")}</select></div>` : ""}
      ${p.allowed_modes.includes("with_transactions") ? `<div class="fld" style="margin-top:10px"><label class="eyebrow" for="dm-name">連同交易刪除時，請輸入帳戶名稱「${esc(a.name)}」確認</label><input id="dm-name" class="in" autocomplete="off"></div>` : ""}`,
      "刪除", async () => {
        const mode = ($<HTMLInputElement>("input[name=dm]:checked")?.value ?? "empty") as L.DeleteAccountRequest["mode"];
        try {
          const r = await api.deleteAccount(key, { mode, target_key: $<HTMLSelectElement>("#dm-target")?.value, confirm_name: $<HTMLInputElement>("#dm-name")?.value });
          invalidateCatalog(); await getCatalog(true);
          toast(r.mode === "merge" ? `已合併，搬移 ${r.moved_transactions} 筆交易` : "已刪除帳戶", r.mode !== "merge" ? async () => { try { await api.restoreAccount(key); await getCatalog(true); toast("已還原帳戶"); reload(); } catch (e) { handleError(e); } } : null);
          go("/accounts", true);
        } catch (e) { const err = e as LedgerError; toast(esc(err.message ?? "刪除失敗")); }
      }, { danger: true });
  } catch (e) { handleError(e); }
}

/* ------------------------------------------------------------ 期初餘額 */
type OD = { w: L.OpeningWizard; preview: L.OpeningPreview | null; vals: Record<string, { amount: string; at: string }> };
registerView("opening", {
  load: async () => { const w = await api.opening(); const vals: OD["vals"] = {}; w.accounts.forEach((a) => (vals[a.account_key] = { amount: a.opening ? a.opening.amount.amount : a.latest_snapshot ? (a.is_liability ? neg(a.latest_snapshot.amount.amount).replace(/^-/, "") : a.latest_snapshot.amount.amount) : "", at: (a.opening?.at ?? a.latest_snapshot?.as_of ?? isoDateTime(today(), "00:00")).slice(0, 10) })); return { w, preview: null, vals } as OD; },
  render: (d: OD) => `<div class="grid"><div class="card sp-8"><div class="ch"><h2 class="h2">${ic("scale")}期初餘額</h2></div><p class="sm mu" style="margin:0 0 12px">期初＝開始記帳那天的餘額。之後的餘額＝期初＋交易。信用卡、負債請填「目前欠款」（正數）。</p>
    <div class="list">${d.w.accounts.map((a) => `<div class="between" style="min-height:72px;border-bottom:1px solid var(--ln);flex-wrap:wrap;gap:8px"><span style="min-width:150px"><b style="font-weight:500">${esc(a.name)}</b><br><span class="xs mu">${a.opening ? "已設定" : '<span style="color:var(--wa)">未設定</span>'}${a.computed_now ? ` · 目前 ${fmt(a.computed_now.amount, a.computed_now.currency)}` : ""}${a.latest_snapshot ? ` · 快照 ${fmt(a.latest_snapshot.amount.amount, a.latest_snapshot.amount.currency)}（${md(a.latest_snapshot.as_of.slice(0, 10))}）` : ""}</span></span>
      <span class="row" style="flex-wrap:wrap;gap:6px"><label class="vh" for="op-${a.account_key}">${esc(a.name)} ${a.is_liability ? "目前欠款" : "期初餘額"}</label><span class="xs mu">${a.is_liability ? "欠款" : ""} ${esc(curInfo(a.currency).symbol)}</span><input id="op-${a.account_key}" data-op="${a.account_key}" class="in num" inputmode="decimal" value="${esc(d.vals[a.account_key].amount)}" style="width:120px;text-align:right" placeholder="0"><label class="vh" for="opd-${a.account_key}">日期</label><input id="opd-${a.account_key}" data-opd="${a.account_key}" class="in" type="date" value="${d.vals[a.account_key].at}" style="width:auto"></span></div>`).join("")}</div>
    <div class="row" style="margin-top:14px;justify-content:flex-end;flex-wrap:wrap"><button class="btn" data-a="op-preview">預覽總額</button><button class="btn p" data-a="op-save">${ic("check", "s")}儲存</button></div></div>
    <div class="card sp-4"><div class="ch"><h2 class="h2">預覽</h2></div>${d.preview ? `<div class="stack" style="gap:0">${(["available_cash", "credit_card_due", "liabilities"] as const).map((k) => `<div class="between" style="min-height:48px;border-bottom:1px solid var(--ln)"><span class="mu">${{ available_cash: "可用現金", credit_card_due: "信用卡欠款", liabilities: "其他負債" }[k]}</span><span class="stack" style="gap:0;text-align:right">${Object.entries(d.preview!.totals[k]).map(([c, v]) => `<span class="amt">${fmt(v, c)}</span>`).join("") || "—"}</span></div>`).join("")}</div>` : '<p class="sm mu" style="margin:0">按「預覽總額」看看設定後的帳戶總額（還不會儲存）。</p>'}</div></div>`,
  title: () => "期初餘額", back: "/settings", nav: "/settings",
});
function opItems(d: OD) {
  $$<HTMLInputElement>("[data-op]").forEach((i) => (d.vals[i.dataset.op!].amount = i.value.replace(/[^\d.]/g, "")));
  $$<HTMLInputElement>("[data-opd]").forEach((i) => (d.vals[i.dataset.opd!].at = i.value));
  return Object.entries(d.vals).filter(([, v]) => v.amount !== "").map(([k, v]) => ({ account_key: k, amount: v.amount, at: isoDateTime(v.at || today(), "00:00") }));
}

/* ------------------------------------------------------------ 分類 */
registerView("categories", {
  load: () => getCatalog(true),
  render: (c: L.Catalog) => `<div class="card"><div class="ch"><h2 class="h2">${ic("tag")}分類管理</h2><button class="btn sm" data-a="cat-new">${ic("plus", "s")}新增主分類</button></div><div class="list">${c.categories.filter((m) => m.kind !== "system").map((m) => `<details style="border-bottom:1px solid var(--ln)" ${m.is_hidden ? 'class="mu"' : ""}><summary style="list-style:none;cursor:pointer;min-height:48px;display:flex;align-items:center;gap:10px"><span style="color:${catColor(m.category_key, m.icon)}">${ic(catIconName(m.category_key, m.icon))}</span><span style="flex:1">${esc(m.name)}${m.kind === "income" ? ' <span class="src">收入</span>' : ""}${m.is_hidden ? ' <span class="src">已隱藏</span>' : ""}</span><span class="xs mu">${m.children.length} 個子分類</span>${ic("chev-d", "s")}</summary>
      <div class="wrap-row" style="padding:0 0 8px 30px">${m.children.map((s) => `<button class="ptag" data-a="cat-edit" data-k="${s.category_key}" style="font-size:13px;padding:4px 10px;${s.is_hidden ? "opacity:.5" : ""}">${esc(s.name)}</button>`).join("")}<button class="link" data-a="cat-new" data-p="${m.category_key}" data-kind="${m.kind}">${ic("plus", "s")}新增</button></div>
      <div class="row" style="padding:0 0 12px 30px;flex-wrap:wrap"><button class="btn sm g" data-a="cat-edit" data-k="${m.category_key}">${ic("edit", "s")}改名／隱藏／合併</button></div></details>`).join("")}</div>
      <p class="xs mu" style="margin:10px 0 0">分類不能刪除，只能隱藏或合併到其他分類。</p></div>`,
  title: () => "分類管理", back: "/settings", nav: "/settings",
});

/* ------------------------------------------------------------ 標籤 */
registerView("tags", {
  load: () => getCatalog(true),
  render: (c: L.Catalog) => `<div class="card"><div class="ch"><h2 class="h2">${ic("tag")}標籤</h2><button class="btn sm" data-a="tag-new">${ic("plus", "s")}新增</button></div>${c.tags.length ? `<div class="list">${c.tags.map((t) => `<div class="between" style="min-height:52px;border-bottom:1px solid var(--ln)"><a class="link" href="${href("/transactions?tags=" + t.tag_id)}">#${esc(t.name)}</a><span class="row"><button class="btn sm g" data-a="tag-edit" data-id="${t.tag_id}">改名</button><button class="btn sm dg-t" data-a="tag-del" data-id="${t.tag_id}">刪除</button></span></div>`).join("")}</div>` : emptyState("還沒有標籤", "標籤可以跨分類標記交易，例如「返鄉」「報帳」。")}</div>`,
  title: () => "標籤", back: "/settings", nav: "/settings",
});

/* ------------------------------------------------------------ 週期交易 */
const FREQ: Record<string, string> = { daily: "每天", weekly: "每週", monthly: "每月", yearly: "每年" };
registerView("recurring", {
  load: () => api.recurring(),
  render: (d: L.RecurringResponse) => `<div class="grid">
    <div class="card sp-6"><div class="ch"><h2 class="h2">${ic("clock")}即將到期</h2><span class="eyebrow">未來 7 天＋過期未處理</span></div>${d.upcoming.length ? `<div class="list">${d.upcoming.map((o) => `<div class="between" style="min-height:60px;border-bottom:1px solid var(--ln);flex-wrap:wrap"><span><b style="font-weight:500">${esc(o.rule_name)}</b><br><span class="xs mu">${md(o.due_date)}${o.due_date < today() ? ' · <span style="color:var(--wa)">已過期</span>' : ""}</span></span><span class="row"><span class="num">${fmt(o.amount.amount, o.amount.currency)}</span><button class="btn sm g" data-a="occ-skip" data-id="${o.rule_id}" data-d="${o.due_date}">略過</button><button class="btn sm" data-a="occ-ok" data-id="${o.rule_id}" data-d="${o.due_date}">確認入帳</button></span></div>`).join("")}</div>` : '<p class="sm mu">沒有待處理的週期交易</p>'}</div>
    <div class="card sp-6"><div class="ch"><h2 class="h2">${ic("repeat")}規則</h2></div><div class="list">${d.rules.map((r) => `<div class="between" style="min-height:64px;border-bottom:1px solid var(--ln);flex-wrap:wrap;${r.is_active ? "" : "opacity:.55"}"><span style="min-width:0;flex:1"><b style="font-weight:500">${esc(r.name)}</b> <span class="src">${r.mode === "auto" ? "自動入帳" : "到期確認"}</span><br><span class="xs mu">${FREQ[r.freq]}${r.by_monthday ? ` ${r.by_monthday === 31 ? "月底" : r.by_monthday + " 日"}` : ""}${r.by_weekday ? ` 週${"一二三四五六日"[r.by_weekday - 1]}` : ""} · ${esc(catLabel(r.template.category_key))} · ${esc(accOpt(r.template.account_key)?.name ?? "")}${r.next_due ? ` · 下次 ${md(r.next_due)}` : ""}</span></span><span class="row"><span class="amt ${r.template.type === "income" ? "inc" : ""}">${r.template.type === "income" ? "+" : MINUS}${fmt(r.template.amount, r.template.currency)}</span><button class="btn sm g" data-a="rule-toggle" data-id="${r.rule_id}" data-v="${r.is_active ? "0" : "1"}">${r.is_active ? "暫停" : "啟用"}</button></span></div>`).join("")}</div><p class="xs mu" style="margin:10px 0 0">「到期確認」會在總覽提醒，按「確認入帳」才會記錄；「自動入帳」到期時直接記錄。</p></div></div>`,
  title: () => "週期交易", back: "/settings", nav: "/settings",
});

/* ------------------------------------------------------------ 最近刪除 */
registerView("trash", {
  load: () => api.trash(),
  render: (d: L.TrashResponse) => `<div class="grid"><div class="card sp-8"><div class="ch"><h2 class="h2">${ic("trash")}最近刪除的交易</h2><span class="eyebrow">30 天內可復原</span></div>${d.transactions.length ? `<div class="list plain">${d.transactions.map((t) => `<div class="between" style="min-height:56px;border-bottom:1px solid var(--ln);flex-wrap:wrap"><span><b style="font-weight:500">${esc(t.merchant ?? "")}</b><br><span class="xs mu">${md(t.date)} · ${esc(t.account.name)} · 剩 ${Math.max(0, daysBetween(today(), splitDT(t.purge_after).date))} 天</span></span><span class="row">${amtHTML(t)}<button class="btn sm" data-a="restore" data-id="${t.id}">${ic("undo", "s")}復原</button></span></div>`).join("")}</div>` : '<p class="sm mu" style="margin:0">沒有最近刪除的交易。</p>'}</div>
    <div class="card sp-4"><div class="ch"><h2 class="h2">刪除的帳戶</h2></div>${d.accounts.length ? d.accounts.map((a) => `<div class="between" style="min-height:56px;border-bottom:1px solid var(--ln)"><span><b style="font-weight:500">${esc(a.name)}</b><br><span class="xs mu">${a.transactions} 筆交易 · ${slash(a.deleted_at.slice(0, 10))}</span></span><button class="btn sm" data-a="restore-acc" data-id="${esc(a.account_key)}">${ic("undo", "s")}復原</button></div>`).join("") : '<p class="sm mu" style="margin:0">沒有刪除的帳戶。</p>'}</div></div>`,
  title: () => "最近刪除", back: "/settings", nav: "/settings",
});

/* ------------------------------------------------------------ actions */
async function catDialog(o: { key?: string; parent?: string; kind?: "expense" | "income" }) {
  const c = o.key ? app.catalog!.categories.flatMap((m) => [m, ...m.children]).find((x) => x.category_key === o.key) : null;
  const sameKind = app.catalog!.categories.flatMap((m) => [m, ...m.children]).filter((x) => c && x.kind === c.kind && x.category_key !== c.category_key && !x.category_key.startsWith(c.category_key + "."));
  dialog(c ? `編輯「${esc(c.name)}」` : o.parent ? `在「${esc(catLabel(o.parent))}」下新增子分類` : "新增主分類",
    `<div class="fld"><label class="eyebrow" for="cat-name">名稱</label><input id="cat-name" class="in" value="${esc(c?.name ?? "")}" maxlength="20"></div>
     ${!c && !o.parent ? `<div class="fld"><label class="eyebrow" for="cat-kind">類型</label><select id="cat-kind" class="in"><option value="expense">支出</option><option value="income">收入</option></select></div>` : ""}
     ${c ? `<label class="row sm" style="min-height:44px"><input type="checkbox" id="cat-hidden" ${c.is_hidden ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--ac)">隱藏（記一筆選單不顯示，歷史資料保留）</label>
       <div class="fld"><label class="eyebrow" for="cat-merge">合併到其他分類（選填，會搬移所有交易並隱藏這個分類）</label><select id="cat-merge" class="in"><option value="">不合併</option>${sameKind.map((x) => `<option value="${x.category_key}">${esc(catLabel(x.category_key))}</option>`).join("")}</select></div>` : ""}`,
    c ? "儲存" : "新增", async () => {
      const name = $<HTMLInputElement>("#cat-name")?.value.trim() ?? "";
      if (!name) { toast("請輸入名稱"); return; }
      try {
        if (c) {
          const merge = $<HTMLSelectElement>("#cat-merge")?.value;
          await api.updateCategory(c.category_key, { name, is_hidden: !!$<HTMLInputElement>("#cat-hidden")?.checked });
          if (merge) { const r = await api.mergeCategory(c.category_key, merge); toast(`已合併，搬移 ${r.moved_transactions} 筆交易`); } else toast("已更新分類");
        } else { await api.createCategory({ name, kind: o.kind ?? ($<HTMLSelectElement>("#cat-kind")?.value as "expense" | "income") ?? "expense", parent_key: o.parent }); toast("已新增分類"); }
        reload();
      } catch (e) { handleError(e); }
    });
}
actions({
  async mock(el) { mockPanel?.set(el.dataset.v); invalidateCatalog(); rerender(); toast(`Mock 情境：${esc(el.textContent)}`); },
  async "af-save"() {
    readAcc(); const f = AFS!; f.err = {};
    if (!f.v.name?.trim()) f.err.name = "請輸入名稱";
    const day = (k: string) => { if (f.v[k] && !(+f.v[k] >= 1 && +f.v[k] <= 31)) f.err[k] = "請輸入 1–31"; };
    day("statement_day"); day("due_day");
    if (f.v.opening && !/^\d+(\.\d+)?$/.test(f.v.opening)) f.err.opening = "請輸入 0 以上的數字";
    if (Object.keys(f.err).length) return setSheet(accSheet());
    const body: L.AccountInput = { name: f.v.name.trim(), group: f.v.group as L.AccountGroup, currency: f.v.currency, aliases: (f.v.aliases ?? "").split(/\s+/).filter(Boolean),
      reconcile_reminder_days: Number(f.v.reconcile_reminder_days) || 30, icon: { cash: "wallet", bank: "bank", credit_card: "card", stored_value: "ticket", liability: "debt", receivable: "in", other: "wallet", investment: "trend" }[f.v.group as L.AccountGroup],
      ...(f.v.group === "credit_card" ? { statement_day: f.v.statement_day ? Number(f.v.statement_day) : null, due_day: f.v.due_day ? Number(f.v.due_day) : null, credit_limit: f.v.credit_limit || null } : {}) };
    try {
      if (f.key) await api.updateAccount(f.key, body);
      else { const r = await api.createAccount({ ...body, ...(f.v.opening ? { opening: { amount: f.v.opening, at: isoDateTime(f.v.opening_at || today(), "00:00") } } : {}) }); f.key = r.account.account_key; }
      closeSheet(); await getCatalog(true); toast("已儲存帳戶"); reload();
    } catch (e) { const err = e as LedgerError; if (err instanceof LedgerError && err.details) { Object.entries(err.details).forEach(([k, v]) => (f.err[k] = v.join("；"))); setSheet(accSheet()); } else handleError(e); }
  },
  async "op-preview"() { const d = currentData<OD>(); try { d.preview = (await api.setOpening({ preview: true, items: opItems(d) })) as L.OpeningPreview; rerender(); } catch (e) { handleError(e); } },
  async "op-save"() {
    const d = currentData<OD>(); const items = opItems(d);
    if (items.some((i) => !isPositiveAmount(i.amount, 2) && i.amount !== "0")) { toast("金額要是 0 以上的數字"); return; }
    try { const r = (await api.setOpening({ preview: false, items })) as { updated: string[] }; toast(`已更新 ${r.updated.length} 個帳戶的期初`); reload(); } catch (e) { handleError(e); }
  },
  "cat-new"(el) { catDialog({ parent: el.dataset.p, kind: el.dataset.kind as "expense" | "income" | undefined }); },
  "cat-edit"(el) { catDialog({ key: el.dataset.k }); },
  "tag-new"() { dialog("新增標籤", `<div class="fld"><label class="eyebrow" for="tag-name">名稱</label><input id="tag-name" class="in" maxlength="20"></div>`, "新增", async () => { const n = $<HTMLInputElement>("#tag-name")?.value.trim(); if (!n) return; try { await api.createTag(n); toast("已新增標籤"); reload(); } catch (e) { handleError(e); } }); },
  "tag-edit"(el) { const t = app.catalog!.tags.find((x) => x.tag_id === el.dataset.id)!; dialog("標籤改名", `<div class="fld"><label class="eyebrow" for="tag-name">名稱</label><input id="tag-name" class="in" value="${esc(t.name)}" maxlength="20"></div>`, "儲存", async () => { const n = $<HTMLInputElement>("#tag-name")?.value.trim(); if (!n) return; try { await api.updateTag(t.tag_id, n); toast("已更新"); reload(); } catch (e) { handleError(e); } }); },
  "tag-del"(el) { const t = app.catalog!.tags.find((x) => x.tag_id === el.dataset.id)!; dialog(`刪除標籤「#${esc(t.name)}」？`, "<p style='margin:0'>交易不會被刪除，只會移除這個標籤。</p>", "刪除", async () => { try { await api.deleteTag(t.tag_id); toast("已刪除標籤"); reload(); } catch (e) { handleError(e); } }, { danger: true }); },
  async "rule-toggle"(el) { try { await api.updateRecurring(el.dataset.id!, { is_active: el.dataset.v === "1" }); toast(el.dataset.v === "1" ? "已啟用" : "已暫停"); reload(); } catch (e) { handleError(e); } },
  async restore(el) { try { const r = await api.restoreTransaction(Number(el.dataset.id)); toast(`已復原 ${esc(r.restored[0]?.merchant ?? "")}`); reload(); } catch (e) { handleError(e); } },
  async "restore-acc"(el) { try { const r = await api.restoreAccount(el.dataset.id!); await getCatalog(true); toast(`已復原帳戶，含 ${r.restored_transactions} 筆交易`); reload(); } catch (e) { handleError(e); } },
});
document.addEventListener("change", (e) => { const t = e.target as HTMLSelectElement; if (t.id === "af-group" && AFS) { readAcc(); setSheet(accSheet()); } });
