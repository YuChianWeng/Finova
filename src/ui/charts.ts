/** Inline SVG 圖表（無外部套件）。數值只在這裡轉成 number 來算比例。 */
import { $, esc, ic } from "../lib/dom";
import { fmt, short } from "../lib/money";
import { emptyState } from "./components";

const F = (n: number) => fmt(String(Math.round(n)));
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
export function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/* ---------------- 每日支出＋累計＋預算線（可拖動讀值） ---------------- */
type DC = { n: number; spend: number[]; cum: number[]; upto: number; budget: number[] | null; L: number; iw: number; W: number; label: string };
const CH: Record<string, DC> = {};
export function dailyChart(key: string, spend: number[], upto: number, budget: number[] | null, label: string) {
  const n = spend.length, W = 660, H = 230, L = 40, R = 46, Tp = 14, B = 26, iw = W - L - R, ih = H - Tp - B;
  const cum: number[] = []; spend.reduce((c, v, i) => { const x = c + (i < upto ? v : 0); cum.push(x); return x; }, 0);
  const total = cum[Math.max(0, upto - 1)] ?? 0;
  const bmax = niceMax(Math.max(...spend, 100)), cmax = niceMax(Math.max(budget?.[n - 1] ?? 0, total, 1));
  const bw = iw / n; let s = "";
  for (let i = 0; i <= 4; i++) { const y = Tp + ih * i / 4; s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="g"/><text x="${L - 6}" y="${y + 3.5}" class="ax" text-anchor="end">${short(bmax * (1 - i / 4))}</text><text x="${W - R + 6}" y="${y + 3.5}" class="ax">${short(cmax * (1 - i / 4))}</text>`; }
  spend.forEach((v, i) => { const x = L + i * bw + bw * 0.2, w = bw * 0.6; if (i < upto) { const h = Math.max(1.5, v / bmax * ih); s += `<rect x="${x.toFixed(1)}" y="${(Tp + ih - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" class="bar" rx="1.5"/>`; } else s += `<rect x="${x.toFixed(1)}" y="${Tp + ih - 2}" width="${w.toFixed(1)}" height="2" class="bar-f"/>`; });
  if (budget) s += `<polyline class="pace" points="${budget.map((b, i) => `${(L + (i + 0.5) * bw).toFixed(1)},${(Tp + ih - b / cmax * ih).toFixed(1)}`).join(" ")}"/>`;
  const pts = cum.slice(0, upto).map((c, i) => [L + (i + 0.5) * bw, Tp + ih - c / cmax * ih]);
  if (pts.length > 1) s += `<polyline points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}" class="cum"/>`;
  if (pts.length) { const p = pts[pts.length - 1]; s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" class="dot wa"/>`; }
  [1, 5, 10, 15, 20, 25, n].forEach((d) => { if (d <= n) s += `<text x="${(L + (d - 0.5) * bw).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${d}</text>`; });
  s += `<line class="guide" id="gd-${key}" x1="0" x2="0" y1="${Tp}" y2="${Tp + ih}" visibility="hidden"/><rect class="hit" data-chart="${key}" x="${L}" y="${Tp}" width="${iw}" height="${ih}"/>`;
  CH[key] = { n, spend, cum, upto, budget, L, iw, W, label };
  return `<div class="chart"><div class="readout" id="ro-${key}">${readout(key, upto - 1)}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每日支出長條、累計支出折線與預算線">${s}</svg>
  <div class="legend"><span><i class="sw-bar"></i>每日支出（左軸）</span><span><i class="sw-line"></i>累計支出（右軸）</span>${budget ? '<span><i class="sw-dash"></i>預算進度線</span>' : ""}</div></div>`;
}
function readout(key: string, i: number) {
  const c = CH[key]; if (!c) return "";
  i = Math.max(0, Math.min(c.n - 1, i)); const has = i < c.upto;
  return `<span>${c.label} ${i + 1} 日</span><span>當日 <b>${has ? F(c.spend[i]) : "—"}</b></span><span>累計 <b>${has ? F(c.cum[i]) : "—"}</b></span>${c.budget ? `<span>預算線 <b>${F(c.budget[i])}</b></span>` : ""}`;
}
export function bindChartHover() {
  document.addEventListener("pointermove", (e) => {
    const h = (e.target as Element).closest?.(".hit") as SVGRectElement | null; if (!h) return;
    const key = h.dataset.chart!, c = CH[key]; if (!c) return;
    const r = h.ownerSVGElement!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * c.W; const i = Math.floor((x - c.L) / (c.iw / c.n));
    const ro = $("#ro-" + key); if (ro) ro.innerHTML = readout(key, i);
    const g = $("#gd-" + key); if (g) { const gx = c.L + (Math.max(0, Math.min(c.n - 1, i)) + 0.5) * (c.iw / c.n); g.setAttribute("x1", String(gx)); g.setAttribute("x2", String(gx)); g.setAttribute("visibility", "visible"); }
  });
}

/* ---------------- 圓環 ---------------- */
export type Slice = { k: string; label: string; v: number; c: string };
export function donut(items: Slice[], center: string, drill = false) {
  const tot = sum(items.map((i) => i.v)) || 1, r = 54, C = 2 * Math.PI * r; let off = 0;
  const segs = items.map((it) => { const len = it.v / tot * C; const gap = items.length > 1 ? 1.5 : 0; const s = `<circle class="seg" ${drill ? `data-a="seg" data-k="${esc(it.k)}"` : ""} cx="75" cy="75" r="${r}" fill="none" stroke-width="20" style="stroke:${it.c}" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${(C - len + gap).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 75 75)"><title>${esc(it.label)} ${F(it.v)}</title></circle>`; off += len; return s; }).join("");
  return `<svg viewBox="0 0 150 150" role="img" aria-label="${esc(center)} 占比"><circle cx="75" cy="75" r="${r}" fill="none" style="stroke:var(--s3)" stroke-width="20"/>${segs}<text x="75" y="70" text-anchor="middle" style="fill:var(--mu);font:500 10px var(--f-m)">${esc(center)}</text><text x="75" y="88" text-anchor="middle" style="fill:var(--tx);font:600 14px var(--f-m)">${short(sum(items.map((i) => i.v)))}</text></svg>`;
}
export function donutCard(o: { title: string; items: Slice[]; drillLabel?: string | null; legendAction: string; center: string; drillable?: boolean; extra?: string }) {
  if (!o.items.length) return `<div class="card">${emptyState("沒有支出", "這段期間還沒有支出紀錄。")}</div>`;
  const all = sum(o.items.map((i) => i.v)) || 1;
  const leg = o.items.map((it) => `<button data-a="${o.legendAction}" data-k="${esc(it.k)}"><i class="dotc" style="background:${it.c}"></i>${esc(it.label)}<span class="p">${(it.v / all * 100).toFixed(1)}%</span><span class="num sm">${F(it.v)}</span></button>`).join("");
  return `<div class="card"><div class="ch"><h2 class="h2">${esc(o.title)}${o.drillLabel ? ` <span class="mu">› ${esc(o.drillLabel)}</span>` : ""}</h2>${o.drillLabel ? `<button class="btn sm g" data-a="donut-back">${ic("chev-l", "s")}主分類</button>` : o.drillable ? `<span class="eyebrow">點扇區看子分類</span>` : ""}</div>
    <div class="donut-wrap">${donut(o.items, o.center, !!o.drillable && !o.drillLabel)}<div class="leg">${leg}</div></div>${o.extra ?? ""}</div>`;
}

/* ---------------- 折線 ---------------- */
export function lineChart(vals: number[], o: { n?: number; target?: number | null; proj?: number | null; zero?: boolean; marks?: number[]; xl?: [number, string][]; label?: string; ref?: number[] | null } = {}) {
  const W = 640, H = 200, L = 50, R = 16, Tp = 12, B = 24, iw = W - L - R, ih = H - Tp - B;
  if (!vals.length) return `<p class="sm mu">沒有資料</p>`;
  const N = Math.max(o.n ?? vals.length, 2);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (o.target != null) { hi = Math.max(hi, o.target); lo = Math.min(lo, o.target); }
  if (o.proj != null) hi = Math.max(hi, o.proj);
  if (o.ref) { hi = Math.max(hi, ...o.ref); }
  if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi === lo) { hi += 1; lo -= 1; }
  const pd = (hi - lo) * 0.1; lo -= o.zero && lo === 0 ? 0 : pd; hi += pd;
  const x = (i: number) => L + iw * i / (N - 1), y = (v: number) => Tp + ih * (1 - (v - lo) / (hi - lo));
  let s = "";
  for (let i = 0; i <= 3; i++) { const v = lo + (hi - lo) * (1 - i / 3), yy = Tp + ih * i / 3; s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="g"/><text x="${L - 6}" y="${yy + 3.5}" class="ax" text-anchor="end">${short(v)}</text>`; }
  const pts = vals.map((v, i) => [x(i), y(v)]);
  const base = y(Math.max(lo, Math.min(0, hi))).toFixed(1);
  s += `<path class="area" d="M${pts[0][0]},${base} ${pts.map((p) => "L" + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")} L${pts[pts.length - 1][0].toFixed(1)},${base}Z"/>`;
  if (o.ref) s += `<polyline class="tgt" points="${o.ref.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`;
  if (o.target != null) s += `<line class="tgt" x1="${L}" x2="${W - R}" y1="${y(o.target)}" y2="${y(o.target)}"/><text x="${W - R}" y="${y(o.target) - 6}" text-anchor="end" class="ax" style="fill:var(--wa)">目標 ${short(o.target)}</text>`;
  s += `<polyline class="line" points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"/>`;
  const lp = pts[pts.length - 1];
  if (o.proj != null) s += `<line class="proj" x1="${lp[0]}" y1="${lp[1]}" x2="${x(N - 1)}" y2="${y(o.proj)}"/>`;
  (o.marks ?? []).forEach((i) => { if (i >= 0 && i < pts.length) { const p = pts[i]; s += `<rect class="mark" x="${p[0] - 4.5}" y="${p[1] - 4.5}" width="9" height="9" transform="rotate(45 ${p[0]} ${p[1]})"><title>對帳點</title></rect>`; } });
  s += `<circle class="dot" cx="${lp[0]}" cy="${lp[1]}" r="4.5"/>`;
  (o.xl ?? []).forEach(([i, l], k) => { s += `<text x="${x(i)}" y="${H - 5}" class="ax" text-anchor="${k === 0 ? "start" : i === N - 1 ? "end" : "middle"}">${esc(l)}</text>`; });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label ?? "折線圖")}">${s}</svg></div>`;
}

/* ---------------- 長條 ---------------- */
export function barsChart(vals: number[], labels: string[], o: { ref?: number; refLabel?: string; label?: string } = {}) {
  const W = 640, H = 190, L = 40, R = 10, Tp = 18, B = 24, iw = W - L - R, ih = H - Tp - B, n = vals.length, mx = niceMax(Math.max(...vals, o.ref ?? 0, 1)), bw = iw / n; let s = "";
  for (let i = 0; i <= 2; i++) { const yy = Tp + ih * i / 2; s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="g"/><text x="${L - 6}" y="${yy + 3.5}" class="ax" text-anchor="end">${short(mx * (1 - i / 2))}</text>`; }
  vals.forEach((v, i) => { const h = v / mx * ih, x = L + i * bw + bw * 0.22, w = bw * 0.56; s += `<rect class="bar ${v ? "" : "dim"}" x="${x}" y="${Tp + ih - Math.max(h, 2)}" width="${w}" height="${Math.max(h, 2)}" rx="2"/>`; if (v) s += `<text x="${x + w / 2}" y="${Tp + ih - h - 5}" class="vlab" text-anchor="middle">${short(v)}</text>`; s += `<text x="${x + w / 2}" y="${H - 6}" class="ax" text-anchor="middle">${esc(labels[i])}</text>`; });
  if (o.ref) { const yy = Tp + ih - o.ref / mx * ih; s += `<line class="pace" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${W - R}" y="${yy - 5}" class="ax" text-anchor="end">${esc(o.refLabel ?? "")}</text>`; }
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label ?? "長條圖")}">${s}</svg></div>`;
}

/* ---------------- 流入／流出長條＋淨資產線 ---------------- */
export function comboChart(labels: string[], inn: number[], out: number[], line: number[]) {
  const W = 640, H = 230, L = 44, R = 50, Tp = 14, B = 26, iw = W - L - R, ih = H - Tp - B, n = labels.length, bw = iw / n;
  const bm = niceMax(Math.max(...inn, ...out, 1));
  let lo = Math.min(0, ...line), hi = niceMax(Math.max(...line, 1)); if (hi === lo) hi = lo + 1;
  const y = (v: number) => Tp + ih * (1 - (v - lo) / (hi - lo));
  let s = "";
  for (let i = 0; i <= 4; i++) { const yy = Tp + ih * i / 4; s += `<line class="g" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="ax" x="${L - 6}" y="${yy + 3.5}" text-anchor="end">${short(bm * (1 - i / 4))}</text><text class="ax" x="${W - R + 6}" y="${yy + 3.5}">${short(lo + (hi - lo) * (1 - i / 4))}</text>`; }
  const pts = line.map((v, i) => [L + (i + 0.5) * bw, y(v)]);
  s += `<path class="lnf" d="M${pts[0][0].toFixed(1)},${y(lo).toFixed(1)} ${pts.map((p) => "L" + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")} L${pts[n - 1][0].toFixed(1)},${y(lo).toFixed(1)}Z"/>`;
  inn.forEach((v, i) => {
    const x = L + i * bw + bw * 0.16, w = bw * 0.32, h1 = v / bm * ih, ho = out[i] / bm * ih;
    s += `<rect class="bar inc" x="${x.toFixed(1)}" y="${(Tp + ih - h1).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h1, 1).toFixed(1)}" rx="2"><title>${esc(labels[i])} 流入 ${F(v)}</title></rect><rect class="bar out" x="${(x + w + 2).toFixed(1)}" y="${(Tp + ih - ho).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(ho, 1).toFixed(1)}" rx="2"><title>${esc(labels[i])} 流出 ${F(out[i])}</title></rect>`;
    s += `<text class="ax" x="${(L + (i + 0.5) * bw).toFixed(1)}" y="${H - 6}" text-anchor="middle" ${i === n - 1 ? 'style="fill:var(--tx);font-weight:700"' : ""}>${esc(labels[i])}</text>`;
  });
  s += `<polyline class="line" points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"/><circle class="dot" cx="${pts[n - 1][0].toFixed(1)}" cy="${pts[n - 1][1].toFixed(1)}" r="4.5"/>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每期流入、流出與淨資產走勢">${s}</svg></div>
  <div class="legend"><span><i class="sw-bar" style="background:var(--inc)"></i>流入（左軸）</span><span><i class="sw-bar" style="background:var(--exp)"></i>流出（左軸）</span><span><i class="sw-line" style="border-color:var(--ac)"></i>淨資產（右軸）</span></div>`;
}

/* ---------------- 每月收支（年報） ---------------- */
export function monthBars(labels: string[], inc: number[], exp: number[]) {
  const W = 640, H = 220, L = 40, R = 10, Tp = 16, B = 24, iw = W - L - R, ih = H - Tp - B, n = labels.length, mx = niceMax(Math.max(...inc, ...exp, 1)), bw = iw / n;
  let s = ""; for (let i = 0; i <= 4; i++) { const y = Tp + ih * i / 4; s += `<line class="g" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 6}" y="${y + 3.5}" text-anchor="end">${short(mx * (1 - i / 4))}</text>`; }
  const net: number[][] = [];
  labels.forEach((l, i) => { const x0 = L + i * bw + bw * 0.14, w = bw * 0.34, hi = inc[i] / mx * ih, he = exp[i] / mx * ih; s += `<rect class="bar inc" x="${x0}" y="${Tp + ih - hi}" width="${w}" height="${hi}" rx="1.5"><title>${l} 收入 ${F(inc[i])}</title></rect><rect class="bar out" x="${x0 + w + 2}" y="${Tp + ih - he}" width="${w}" height="${he}" rx="1.5"><title>${l} 支出 ${F(exp[i])}</title></rect><text class="ax" x="${x0 + w}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; net.push([x0 + w + 1, Tp + ih - Math.max(0, inc[i] - exp[i]) / mx * ih]); });
  s += `<polyline class="cum" points="${net.map((p) => p.join(",")).join(" ")}"/>` + net.map((p) => `<circle class="dot wa" cx="${p[0]}" cy="${p[1]}" r="3"/>`).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每月收支">${s}</svg></div><div class="legend"><span><i class="sw-bar" style="background:var(--inc)"></i>收入</span><span><i class="sw-bar" style="background:var(--exp)"></i>支出</span><span><i class="sw-line"></i>淨額（≥0）</span></div>`;
}
export function stackedBars(labels: string[], stacks: { k: string; c: string; vals: number[] }[], hidden: Set<string>) {
  const W = 640, H = 220, L = 40, R = 10, Tp = 16, B = 24, iw = W - L - R, ih = H - Tp - B, n = labels.length, bw = iw / n;
  const tot = labels.map((_, i) => sum(stacks.filter((s) => !hidden.has(s.k)).map((s) => s.vals[i])));
  const sm = niceMax(Math.max(...tot, 1)); let st = "";
  for (let i = 0; i <= 2; i++) { const y = Tp + ih * i / 2; st += `<line class="g" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 6}" y="${y + 3.5}" text-anchor="end">${short(sm * (1 - i / 2))}</text>`; }
  labels.forEach((l, i) => { let y = Tp + ih; stacks.forEach((s) => { if (hidden.has(s.k)) return; const h = s.vals[i] / sm * ih; y -= h; st += `<rect x="${L + i * bw + bw * 0.2}" y="${y}" width="${bw * 0.6}" height="${h}" style="fill:${s.c}"><title>${l} ${s.k} ${F(s.vals[i])}</title></rect>`; }); st += `<text class="ax" x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每月分類堆疊長條">${st}</svg></div>`;
}
