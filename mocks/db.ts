/**
 * Mock 資料庫：把 fixtures 載入記憶體，並決定性地產生 2026 年 1–10 月的歷史交易，
 * 讓報表、餘額走勢、對帳等畫面都有一致的數字。餘額＝期初＋交易（期初由 fixtures 的目前餘額回推）。
 */
import type * as L from "../src/types/ledger";
import currencies from "./fixtures/currencies.json";
import categoriesFx from "./fixtures/categories.json";
import accountsFx from "./fixtures/accounts.json";
import investmentsFx from "./fixtures/investments.json";
import tagsFx from "./fixtures/tags.json";
import txFx from "./fixtures/transactions.json";
import history from "./fixtures/history.json";
import budgetsFx from "./fixtures/budgets.json";
import projectsFx from "./fixtures/projects.json";
import goalsFx from "./fixtures/goals.json";
import recurringFx from "./fixtures/recurring.json";
import recFx from "./fixtures/reconciliations.json";

export const MOCK_TODAY = "2026-11-03";
export const MOCK_NOW = "2026-11-03T19:05:00+08:00";
export const OPENING_AT = "2025-12-31T23:59:00+08:00";

/* ------------------------------------------------------------------ types */
export type Row = {
  id: number; version: number;
  type: L.TransactionType; direction: L.Direction;
  amount: number; currency: string;
  date: string; time: string;
  account_key: string; category_key: string | null;
  merchant: string | null; note: string | null; tag_ids: string[];
  project_id: string | null; source: L.Source;
  group_id: string | null; leg: "out" | "in" | null; counterpart_id: number | null; fee_id: number | null;
  recurring_rule_id: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
  history: L.TransactionDetail["history"];
};
export type Acc = {
  account_key: string; name: string; group: L.AccountGroup; currency: string; icon: string | null;
  aliases: string[]; is_archived: boolean; sort_order: number;
  opening: { amount: number; at: string } | null;
  latest_snapshot: { amount: L.Money; as_of: string } | null;
  reminder_days: number;
  credit_card: null | { statement_day: number | null; due_day: number | null; credit_limit: string | null;
    current_statement: { period_start: string; period_end: string; amount: string; due_date: string | null; paid: string } | null };
  deleted_at: string | null;
};
export type Cat = { category_key: string; name: string; kind: L.CategoryKind; icon: string | null; is_hidden: boolean; sort_order: number; parent_key: string | null };
export type Rec = L.Reconciliation;
export type GoalRow = Omit<L.SavingsGoal, "current" | "progress" | "monthly_required" | "projected_date" | "is_behind"> & {
  entries: { entry_id: string; date: string; amount: number; note: string | null }[];
};

/* ------------------------------------------------------------------ helpers */
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const S = (n: number, dec = 2) => { const v = Number(n.toFixed(dec)); return String(Object.is(v, -0) ? 0 : v); };
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const dt = (date: string, time: string) => `${date}T${time}:00+08:00`;
const dim = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

/* ------------------------------------------------------------------ state */
export const db = {
  currencies: currencies as L.Catalog["currencies"],
  cats: [] as Cat[],
  accs: [] as Acc[],
  investments: investmentsFx as Omit<L.InvestmentTotal, "is_stale">[],
  tags: tagsFx as L.Tag[],
  rows: [] as Row[],
  budgets: [] as { effective_from: string; lines: { category_key: string | null; amount: number; rollover: boolean }[] }[],
  projects: projectsFx as unknown as Omit<L.Project, "spent" | "remaining" | "per_day_available" | "days_total" | "days_left">[],
  goals: [] as GoalRow[],
  rules: recurringFx as unknown as Omit<L.RecurringRule, "next_due">[],
  occ: {} as Record<string, { status: "confirmed" | "skipped"; transaction_id: number | null }>, // `${rule}|${date}`
  recs: [] as Rec[],
  idem: new Map<string, { hash: string; result: unknown }>(),
  seq: 1,
};

/* ------------------------------------------------------------------ categories */
categoriesFx.forEach((c, i) => {
  db.cats.push({ category_key: c.key, name: c.name, kind: c.kind as L.CategoryKind, icon: c.icon, is_hidden: false, sort_order: i, parent_key: null });
  (c.children as string[][]).forEach(([k, n], j) => db.cats.push({ category_key: `${c.key}.${k}`, name: n, kind: c.kind as L.CategoryKind, icon: c.icon, is_hidden: false, sort_order: j, parent_key: c.key }));
});
export const cat = (k: string | null) => (k ? db.cats.find((c) => c.category_key === k) ?? null : null);
export const mainOf = (k: string) => k.split(".")[0];

/* ------------------------------------------------------------------ accounts */
accountsFx.forEach((a: any, i) => db.accs.push({
  account_key: a.account_key, name: a.name, group: a.group, currency: a.currency, icon: a.icon, aliases: a.aliases,
  is_archived: !!a.is_archived, sort_order: i, opening: null, latest_snapshot: a.latest_snapshot ?? null,
  reminder_days: a.reconcile.reminder_days, credit_card: a.credit_card ?? null, deleted_at: null,
}));
export const acc = (k: string) => db.accs.find((a) => a.account_key === k && !a.deleted_at) ?? null;

/* ------------------------------------------------------------------ rows */
function hist(source: L.Source, at: string): L.TransactionDetail["history"][number] {
  const actor = ({ web: "網頁", iphone_shortcut: "捷徑", chat_bot: "聊天機器人", moze_import: "MOZE 匯入", auto: "系統", other: "其他" } as const)[source];
  return { action: source === "moze_import" ? "migrate" : "create", actor, at, changed_fields: [], before: null, after: null };
}
export function addRow(p: Partial<Row> & Pick<Row, "type" | "direction" | "amount" | "date" | "time" | "account_key">): Row {
  const at = dt(p.date, p.time);
  const row: Row = {
    id: db.seq++, version: 1, currency: acc(p.account_key)?.currency ?? "TWD", category_key: null, merchant: null, note: null, tag_ids: [], project_id: null,
    source: "web", group_id: null, leg: null, counterpart_id: null, fee_id: null, recurring_rule_id: null,
    created_at: at, updated_at: at, deleted_at: null, history: [], ...p,
  } as Row;
  if (!row.history.length) row.history = [hist(row.source, at)];
  db.rows.push(row);
  return row;
}
export function addTransfer(o: { type: "transfer" | "credit_card_payment"; from: string; to: string; out: number; in?: number; date: string; time: string; note?: string | null; merchant?: string | null; source?: L.Source; fee?: number; feeCat?: string }) {
  const gid = `g${db.seq}`;
  const a = addRow({ type: o.type, direction: "out", amount: o.out, date: o.date, time: o.time, account_key: o.from, merchant: o.merchant ?? null, note: o.note ?? null, source: o.source ?? "web", group_id: gid, leg: "out" });
  const b = addRow({ type: o.type, direction: "in", amount: o.in ?? o.out, date: o.date, time: o.time, account_key: o.to, merchant: o.merchant ?? null, note: o.note ?? null, source: o.source ?? "web", group_id: gid, leg: "in" });
  a.counterpart_id = b.id; b.counterpart_id = a.id;
  if (o.fee) {
    const f = addRow({ type: "expense", direction: "out", amount: o.fee, date: o.date, time: o.time, account_key: o.from, category_key: o.feeCat ?? "personal.fee", merchant: "轉帳手續費", source: o.source ?? "web", group_id: gid });
    a.fee_id = f.id;
  }
  return [a, b] as const;
}

/* ------------------------------------------------------------------ history generator */
const MERCH: Record<string, string[]> = {
  "food.breakfast": ["美而美", "麥味登", "早安美芝城", "拉亞漢堡"], "food.lunch": ["學餐", "八方雲集", "自助餐", "池上便當", "麥當勞"],
  "food.dinner": ["巷口麵店", "Uber Eats", "foodpanda", "滷肉飯", "火鍋"], "food.snack": ["7-ELEVEN", "全家", "雞排"],
  "food.drink": ["50嵐", "可不可", "星巴克", "路易莎"], "transport.mrt": ["台北捷運"], "transport.bus": ["公車"],
  "transport.taxi": ["Uber", "台灣大車隊"], "transport.train": ["台鐵"], "shopping.daily": ["寶雅", "屈臣氏", "康是美"],
  "shopping.clothes": ["UNIQLO", "GU", "NET"], "shopping.electronics": ["燦坤", "PChome", "momo"], "shopping.grocery": ["全聯", "家樂福"],
  "entertainment.movie": ["威秀影城", "國賓影城"], "entertainment.game": ["Steam", "Nintendo eShop"], "entertainment.party": ["KTV", "桌遊店"],
  "subscription.streaming": ["Spotify", "Netflix"], "subscription.cloud": ["Apple iCloud+"], "learning.books": ["誠品書店", "博客來"],
  "learning.course": ["Hahow"], "medical.clinic": ["診所掛號"], "medical.medicine": ["藥局"], "other": ["雜支"],
};
const SUBS: Record<string, string[]> = {
  food: ["food.breakfast", "food.lunch", "food.lunch", "food.dinner", "food.snack", "food.drink"],
  transport: ["transport.mrt", "transport.bus", "transport.taxi", "transport.mrt"],
  shopping: ["shopping.daily", "shopping.grocery", "shopping.clothes", "shopping.electronics"],
  entertainment: ["entertainment.movie", "entertainment.game", "entertainment.party"],
  subscription: ["subscription.streaming", "subscription.cloud"], learning: ["learning.books", "learning.course"],
  medical: ["medical.clinic", "medical.medicine"], other: ["other"],
};
const ACC_FOR: Record<string, string[]> = {
  food: ["Wallet_TWD", "Wallet_TWD", "EasyCard", "LineBank"], transport: ["EasyCard", "LineBank"], shopping: ["Cube_Card", "ESun_Unicard"],
  entertainment: ["Cube_Card", "LineBank"], subscription: ["Cube_Card"], learning: ["ESun_Unicard"], medical: ["Wallet_TWD"], other: ["Wallet_TWD", "LineBank"],
};
const PIECES: Record<string, number> = { food: 34, transport: 8, shopping: 5, entertainment: 2, subscription: 2, learning: 1, medical: 1, other: 4 };

function split(total: number, n: number, r: () => number): number[] {
  n = Math.max(1, Math.min(n, Math.floor(total / 30)));
  const w = Array.from({ length: n }, () => 0.4 + r() * 1.6);
  const s = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.max(5, Math.round((x / s) * total / 5) * 5));
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
  if (out[out.length - 1] <= 0) return [total];
  return out;
}

function generate() {
  const fixedByMonthCat: Record<string, Record<string, number>> = {};
  (txFx.fixed as any[]).forEach((f) => {
    if (f.type !== "expense" || f.proj || f.cur) return;
    const m = f.d.slice(0, 7), c = f.cat === "uncategorized" ? "other" : mainOf(f.cat);
    ((fixedByMonthCat[m] ??= {})[c] = (fixedByMonthCat[m][c] ?? 0) + Number(f.amt));
  });
  const months = history.months as unknown as Record<string, [number, number]>;
  Object.entries(months).forEach(([m, [inc, exp]], mi) => {
    const r = rng(1000 + mi * 37);
    const days = m === "2026-10" ? 28 : dim(m);
    let targets: Record<string, number>;
    if (m === "2026-10") targets = { ...(history.october as Record<string, number>) };
    else {
      targets = {}; let rest = exp;
      Object.entries(history.mix).forEach(([k, p]) => { targets[k] = Math.round(exp * (p as number)); rest -= targets[k]; });
      targets.other = rest;
    }
    const spent: Record<string, number> = {};
    Object.entries(targets).forEach(([main, t]) => {
      const left = t - (fixedByMonthCat[m]?.[main] ?? 0);
      if (left <= 0) return;
      split(left, PIECES[main] ?? 3, r).forEach((amt) => {
        const sub = SUBS[main][Math.floor(r() * SUBS[main].length)];
        const d = `${m}-${pad(1 + Math.floor(r() * days))}`;
        const accs = ACC_FOR[main]; const a = accs[Math.floor(r() * accs.length)];
        const names = MERCH[sub] ?? MERCH.other;
        addRow({ type: "expense", direction: "out", amount: amt, date: d, time: `${pad(8 + Math.floor(r() * 13))}:${pad(Math.floor(r() * 60))}`, account_key: a,
          category_key: sub, merchant: names[Math.floor(r() * names.length)], source: m < "2026-10" ? "moze_import" : (["web", "iphone_shortcut", "chat_bot"] as const)[Math.floor(r() * 3)] });
        spent[a] = (spent[a] ?? 0) + amt;
      });
    });
    // 收入：每月 2 日生活費 3,500（自動入帳）＋打工／獎學金
    addRow({ type: "income", direction: "in", amount: 3500, date: `${m}-02`, time: "10:00", account_key: "ESunBank", category_key: "income.allowance", merchant: "生活費", source: "auto", recurring_rule_id: "r_allowance" });
    let restInc = inc - 3500;
    if (inc >= 18000) { addRow({ type: "income", direction: "in", amount: 5000, date: `${m}-18`, time: "09:00", account_key: "ESunBank", category_key: "income.scholarship", merchant: "書卷獎學金", source: m < "2026-10" ? "moze_import" : "web" }); restInc -= 5000; }
    if (restInc > 0) addRow({ type: "income", direction: "in", amount: restInc, date: `${m}-10`, time: "09:00", account_key: "ESunBank", category_key: "income.parttime", merchant: "家教打工", source: m < "2026-10" ? "moze_import" : "web" });
    // 補錢到現金／LINE／悠遊卡（等於本月在那些帳戶的支出，四捨五入到百）、卡費、存到子帳戶、定期定額
    const src = m < "2026-10" ? "moze_import" : "web";
    const up = (n: number) => Math.ceil(n / 100) * 100;
    if (spent.Wallet_TWD) addTransfer({ type: "transfer", from: "ESunBank", to: "Wallet_TWD", out: up(spent.Wallet_TWD), date: `${m}-03`, time: "12:00", merchant: "ATM 提款", source: src });
    if (spent.LineBank && m !== "2026-10") addTransfer({ type: "transfer", from: "ESunBank", to: "LineBank", out: up(spent.LineBank), date: `${m}-04`, time: "12:00", merchant: "轉到 LINE Bank", source: src });
    if (spent.EasyCard) addTransfer({ type: "transfer", from: "LineBank", to: "EasyCard", out: up(spent.EasyCard), date: `${m}-06`, time: "08:00", merchant: "悠遊卡自動加值", source: "auto" });
    if (spent.EasyCard) addTransfer({ type: "transfer", from: "ESunBank", to: "LineBank", out: up(spent.EasyCard), date: `${m}-05`, time: "12:30", merchant: "轉到 LINE Bank", source: src });
    if (m !== "2026-10" && spent.Cube_Card) addTransfer({ type: "credit_card_payment", from: "ESunBank", to: "Cube_Card", out: spent.Cube_Card, date: `${m}-28`, time: "09:30", merchant: "繳 Cube 卡費", source: src });
    if (spent.ESun_Unicard && m !== "2026-10") addTransfer({ type: "credit_card_payment", from: "ESunBank", to: "ESun_Unicard", out: spent.ESun_Unicard, date: `${m}-27`, time: "09:30", merchant: "繳 Unicard 卡費", source: src });
    addTransfer({ type: "transfer", from: "ESunBank", to: "Cathay_Sub", out: 500, date: `${m}-05`, time: "09:00", merchant: "轉入生活子帳戶", source: "auto" });
    addRow({ type: "investment_settlement", direction: "out", amount: 3000, date: `${m}-08`, time: "09:00", account_key: "ESunBank", merchant: "定期定額 0050 交割", source: "auto" });
    addRow({ type: "loan_interest_payment", direction: "out", amount: 433, date: `${m}-15`, time: "09:00", account_key: "ESunBank", merchant: "保單借款利息", source: "auto" });
  });
  // 固定交易（DESIGN-BRIEF §8 與契約 §7）
  (txFx.fixed as any[]).forEach((f) => {
    if (f.type === "transfer" || f.type === "credit_card_payment") {
      addTransfer({ type: f.type, from: f.acc, to: f.to, out: Number(f.amt), date: f.d, time: f.t, merchant: f.m, source: f.src });
      return;
    }
    const row = addRow({ type: f.type, direction: f.type === "income" ? "in" : "out", amount: Number(f.amt), currency: f.cur ?? "TWD", date: f.d, time: f.t,
      account_key: f.acc, category_key: f.cat, merchant: f.m, note: f.note ?? null, tag_ids: f.tags ?? [], project_id: f.proj ?? null, source: f.src, recurring_rule_id: f.rule ?? null });
    if (f.edited) {
      row.version = 2; row.updated_at = f.edited.at;
      row.history.push({ action: "update", actor: "網頁", at: f.edited.at, changed_fields: ["account"],
        before: { account: { account_key: f.edited.from_acc, name: acc(f.edited.from_acc)!.name, group: "cash" } } as any,
        after: { account: { account_key: f.acc, name: acc(f.acc)!.name, group: "credit_card" } } as any });
    }
  });
  db.rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id - b.id);
}
generate();

/* ------------------------------------------------------------------ balances */
export function delta(r: Row): number { return r.direction === "in" ? r.amount : -r.amount; }
export const live = () => db.rows.filter((r) => !r.deleted_at);
export function balanceAt(key: string, upto = "9999-12-31"): number | null {
  const a = acc(key); if (!a || !a.opening) return null;
  let b = a.opening.amount;
  for (const r of db.rows) if (!r.deleted_at && r.account_key === key && r.date <= upto && dt(r.date, r.time) >= a.opening.at) b += delta(r);
  return r2(b);
}
// 期初：由 fixtures 的「目前餘額」回推。balance 為 null 的帳戶＝尚未設定期初（契約 §7）
(accountsFx as any[]).forEach((f) => {
  const a = acc(f.account_key)!;
  if (f.balance == null) return;
  const sum = db.rows.filter((r) => r.account_key === a.account_key).reduce((s, r) => s + delta(r), 0);
  a.opening = { amount: r2(Number(f.balance) - sum), at: OPENING_AT };
});

/* ------------------------------------------------------------------ budgets, goals, recs */
db.budgets.push({ effective_from: budgetsFx.effective_from, lines: budgetsFx.lines.map((l: any) => ({ category_key: l.category_key, amount: Number(l.amount), rollover: !!l.rollover })) });
(goalsFx as any[]).forEach((g) => db.goals.push({ ...g, status: "active", entries: g.entries.map(([d, a, n]: [string, number, string?], i: number) => ({ entry_id: `${g.goal_id}_${i}`, date: d, amount: a, note: n ?? null })) }));
(recFx as [string, string, string][]).forEach(([k, d, diff], i) => {
  const comp = balanceAt(k, d) ?? 0;
  db.recs.push({ reconciliation_id: `rec_${i + 1}`, account_key: k, as_of: dt(d, "21:00"), actual: { amount: S(comp + Number(diff), 0), currency: "TWD" },
    computed: { amount: S(comp, 0), currency: "TWD" }, diff: { amount: diff, currency: "TWD" }, resolution: Number(diff) ? "left_open" : "matched",
    adjustment_transaction_id: null, note: null, created_at: dt(d, "21:00") });
});
// Spotify 11/02 已入帳（但 11/04 的週期仍待確認，對應 DESIGN-BRIEF 的提醒）
db.occ["r_allowance|2026-11-02"] = { status: "confirmed", transaction_id: db.rows.find((r) => r.recurring_rule_id === "r_allowance" && r.date === "2026-11-02")?.id ?? null };
