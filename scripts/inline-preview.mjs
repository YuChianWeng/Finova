// 把 vite build --mode preview 的輸出合成單一 HTML（JS、CSS 內嵌），方便直接開啟或分享。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "dist-preview";
let html = readFileSync(join(dir, "index.html"), "utf8");
const file = (p) => readFileSync(join(dir, p.replace(/^\/finance\//, "")), "utf8");
html = html.replace(/<link rel="stylesheet"[^>]*href="(\/finance\/assets\/[^"]+\.css)"[^>]*>/g, (_, p) => `<style>${file(p)}</style>`);
html = html.replace(/<script type="module"[^>]*src="(\/finance\/assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, p) => `<script type="module">${file(p).replace(/<\/script>/g, "<\\/script>")}</script>`);
html = html.replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n?/g, "");
writeFileSync(join(dir, "finova-preview.html"), html);
console.log(`dist-preview/finova-preview.html  ${(html.length / 1024).toFixed(0)} KB`);
