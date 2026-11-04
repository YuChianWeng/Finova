/**
 * HTTP 核心：回應信封、錯誤碼、503 自動重試、登入過期偵測（契約 §1.1、§5、§6）。
 */
import type { ApiFailure, ApiSuccess, ErrorCode } from "../types/ledger";

export const API_BASE = "/api/ledger";

/** 前端自己的錯誤碼（不是後端回傳的）：離線、網路錯誤、回應格式不對 */
export type ClientErrorCode = ErrorCode | "OFFLINE" | "NETWORK" | "BAD_RESPONSE";

export class LedgerError extends Error {
  code: ClientErrorCode;
  status: number;
  details?: Record<string, string[]>;
  current?: unknown;
  constructor(code: ClientErrorCode, message: string, status = 0, details?: Record<string, string[]>, current?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.current = current;
  }
  /** 4xx：請求本身有問題，重送也一樣會失敗（離線佇列要留著讓使用者處理） */
  get isClientError() { return this.status >= 400 && this.status < 500 && this.code !== "AUTH_EXPIRED"; }
  get isRetryable() { return this.code === "DB_BUSY" || this.code === "WRITE_SERVICE_UNAVAILABLE" || this.code === "NETWORK" || this.code === "OFFLINE"; }
}

/** 前端預設中文訊息（後端有給 message 時以後端為準；可以覆寫） */
export const ERROR_TEXT: Partial<Record<ClientErrorCode, string>> = {
  VALIDATION_ERROR: "有欄位需要修正",
  UNKNOWN_ACCOUNT: "這個帳戶已不存在，選單已重新載入",
  UNKNOWN_CATEGORY: "這個分類已不存在，選單已重新載入",
  UNKNOWN_PROJECT: "這個專案已不存在，選單已重新載入",
  CATEGORY_KIND_MISMATCH: "支出不能選收入分類",
  AMOUNT_PRECISION: "金額的小數位數太多",
  AMOUNT_NOT_POSITIVE: "金額必須大於 0",
  TRANSFER_SAME_ACCOUNT: "轉出和轉入不能是同一個帳戶",
  CARD_PAYMENT_TARGET_NOT_CARD: "繳卡費的轉入帳戶必須是信用卡",
  ACCOUNT_INACTIVE: "這個帳戶已封存",
  IDEMPOTENCY_CONFLICT: "這筆已經以不同內容送出過",
  VERSION_CONFLICT: "這筆在別處被修改過",
  RESTORE_CONFLICT: "無法還原：已有相同紀錄",
  NOT_FOUND: "找不到這筆資料",
  AUTH_EXPIRED: "登入已過期",
  FORBIDDEN: "沒有權限",
  STATEMENT_NOT_BALANCED: "差額不為 0 或還有未處理的項目，不能完成對帳",
  STATEMENT_FINALIZED: "這一期已經完成對帳",
  DB_BUSY: "伺服器忙碌中，請稍後再試",
  WRITE_SERVICE_UNAVAILABLE: "暫時無法寫入，請稍後再試",
  OFFLINE: "目前離線",
  NETWORK: "連線失敗",
  BAD_RESPONSE: "伺服器回應格式不正確",
};

export type Query = Record<string, string | number | boolean | string[] | null | undefined>;
export function qs(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  });
  const s = p.toString();
  return s ? "?" + s : "";
}

type Listener = (e: { type: "auth-expired" } | { type: "cache"; at: string | null }) => void;
const listeners = new Set<Listener>();
export const onClientEvent = (f: Listener) => { listeners.add(f); return () => listeners.delete(f); };
const emit: Listener = (e) => listeners.forEach((f) => f(e));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const RETRY_DELAYS = [400, 1200]; // 503 自動重試 2 次（指數退避）

export type RequestOptions = { query?: Query; body?: unknown; signal?: AbortSignal; raw?: boolean; retries?: number[] };

export async function request<T>(method: string, path: string, opt: RequestOptions = {}): Promise<T> {
  const delays = opt.retries ?? RETRY_DELAYS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await once<T>(method, path, opt);
    } catch (e) {
      const err = e as LedgerError;
      const busy = err.code === "DB_BUSY" || err.code === "WRITE_SERVICE_UNAVAILABLE";
      if (busy && attempt < delays.length) { await sleep(delays[attempt]); continue; }
      throw err;
    }
  }
}

async function once<T>(method: string, path: string, opt: RequestOptions): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.onLine === false && method !== "GET") {
    throw new LedgerError("OFFLINE", ERROR_TEXT.OFFLINE!);
  }
  let res: Response;
  try {
    res = await fetch(API_BASE + path + qs(opt.query), {
      method,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(opt.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
      signal: opt.signal,
      redirect: "follow",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new LedgerError(offline ? "OFFLINE" : "NETWORK", ERROR_TEXT[offline ? "OFFLINE" : "NETWORK"]!);
  }
  // service worker 回傳快取時會加這個標頭（§6 離線讀取）
  if (method === "GET") emit({ type: "cache", at: res.headers.get("X-Ledger-Cached-At") });

  const ctype = res.headers.get("Content-Type") || "";
  // §6：401、被 Cloudflare Access 導向登入頁（redirected 或拿到 HTML）都視為登入過期
  if (res.status === 401 || res.redirected || ctype.includes("text/html")) {
    emit({ type: "auth-expired" });
    throw new LedgerError("AUTH_EXPIRED", ERROR_TEXT.AUTH_EXPIRED!, 401);
  }
  if (opt.raw && res.ok) return (await res.blob()) as unknown as T;

  let json: ApiSuccess<T> | ApiFailure;
  try {
    json = await res.json();
  } catch {
    throw new LedgerError("BAD_RESPONSE", ERROR_TEXT.BAD_RESPONSE!, res.status);
  }
  if ("error" in json && json.error) {
    const { code, message, details, current } = json.error;
    if (code === "AUTH_EXPIRED") emit({ type: "auth-expired" });
    throw new LedgerError(code, message || ERROR_TEXT[code] || code, res.status, details, current);
  }
  if (!res.ok || !("data" in json)) throw new LedgerError("BAD_RESPONSE", ERROR_TEXT.BAD_RESPONSE!, res.status);
  return json.data;
}

/** 新增類請求的冪等 key：開表單時產生，重送沿用（§1.5） */
export function newIdempotencyKey(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `web:${id}`;
}
