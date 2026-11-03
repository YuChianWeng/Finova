export const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector<T & Element>(s) as T | null;
export const $$ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => Array.from(el.querySelectorAll(s)) as T[];
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** SVG sprite icon（index.html 內的 #i-*） */
export const ic = (n: string, c = "") => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
export const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 私密模式等 */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export const session = {
  get(k: string): string | null { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k: string) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};
