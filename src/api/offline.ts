/**
 * 離線新增佇列（契約 §6）：
 * - 離線時新增交易存進 IndexedDB（完整請求＋idempotency_key），畫面標「待同步」。
 * - online／visibilitychange／使用者按「同步」時依序送出。
 * - created 或 duplicate → 移除；4xx → 留在佇列並標示錯誤；網路或 5xx → 停下等下次。
 * IndexedDB 不能用時（私密模式等）退回記憶體，至少本次開啟期間不會遺失。
 */
import type { CreateTransactionRequest, CreateTransferRequest } from "../types/ledger";
import { api } from "./ledger";
import { LedgerError } from "./client";

export type QueueItem = {
  key: string; // idempotency_key
  kind: "transaction" | "transfer";
  body: CreateTransactionRequest | CreateTransferRequest;
  queued_at: string;
  error?: { code: string; message: string } | null;
};

const DB = "finova-ledger", STORE = "queue";
let mem: QueueItem[] = [];
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (!("indexedDB" in globalThis)) return resolve(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "key" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const r = f(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const listeners = new Set<() => void>();
export const onQueueChange = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
const changed = () => listeners.forEach((f) => f());

export async function list(): Promise<QueueItem[]> {
  const db = await open();
  if (!db) return mem.slice();
  return ((await tx("readonly", (s) => s.getAll())) as QueueItem[] | undefined ?? []).sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}
export async function enqueue(item: QueueItem) {
  const db = await open();
  if (!db) { mem = mem.filter((x) => x.key !== item.key).concat(item); }
  else await tx("readwrite", (s) => s.put(item));
  changed();
}
export async function remove(key: string) {
  const db = await open();
  if (!db) mem = mem.filter((x) => x.key !== key);
  else await tx("readwrite", (s) => s.delete(key));
  changed();
}
async function mark(item: QueueItem, error: QueueItem["error"]) { await enqueue({ ...item, error }); }

let flushing: Promise<{ sent: number; failed: number }> | null = null;
/** 依序送出佇列。回傳成功與失敗筆數。 */
export function flush(): Promise<{ sent: number; failed: number }> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0, failed = 0;
    for (const item of await list()) {
      if (item.error) { failed++; continue; } // 4xx 錯誤要使用者處理後才重送
      try {
        if (item.kind === "transfer") await api.createTransfer(item.body as CreateTransferRequest);
        else await api.createTransaction(item.body as CreateTransactionRequest);
        await remove(item.key); // created 或 duplicate 都視同成功
        sent++;
      } catch (e) {
        const err = e as LedgerError;
        if (err instanceof LedgerError && err.isClientError) { await mark(item, { code: err.code, message: err.message }); failed++; continue; }
        break; // 離線、網路、503：保留順序，下次再送
      }
    }
    return { sent, failed };
  })().finally(() => { flushing = null; });
  return flushing;
}
/** 使用者修正錯誤後重送：清掉錯誤標記 */
export async function retryItem(key: string, body?: QueueItem["body"]) {
  const it = (await list()).find((x) => x.key === key);
  if (it) await enqueue({ ...it, body: body ?? it.body, error: null });
}
