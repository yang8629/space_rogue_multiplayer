// 圖集貼圖有沒有被框切到：每張貼圖畫在 3 倍大的畫布上，數框外面不透明的像素（alpha > 10），列出有超出的
//   用法：node perf/clipcheck.mjs [前綴，例如 e/]
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const url = GAME + 'tools/art/build.html';
const pre = process.argv[2] || '';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 800));
const out = await p.evaluate(pre => {
  if (!ENTRIES.length) { enemyFrames(); shipFrames(); fxFrames(); objFrames(); wallFrames(); }
  const res = [], seen = new Set();
  for (const e of ENTRIES) {
    if (!e.name.startsWith(pre)) continue;
    const W = Math.ceil(e.w * e.res), H = Math.ceil(e.h * e.res), cv = document.createElement('canvas');
    cv.width = W * 3; cv.height = H * 3;
    const c = cv.getContext('2d'); c.save(); c.translate(W + e.ox * e.res, H + e.oy * e.res); c.scale(e.res, e.res); e.draw(c); c.restore();
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, far = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      if (x >= W && x < 2 * W && y >= H && y < 2 * H) continue;
      if (d[(y * cv.width + x) * 4 + 3] > 10) { n++; far = Math.max(far, Math.max(W - x, x - 2 * W + 1, H - y, y - 2 * H + 1)); }
    }
    const key = e.name.replace(/\/\d+$/, '');
    if (n) res.push({ name: e.name, key, n, far: Math.round(far / e.res * 10) / 10, half: Math.round(e.w / 2 * 10) / 10 });
    seen.add(key);
  }
  // 每組動畫只列超出最多的那格
  const best = new Map();
  for (const r of res) if (!best.has(r.key) || best.get(r.key).far < r.far) best.set(r.key, r);
  return { total: seen.size, bad: [...best.values()] };
}, pre);
console.log(`檢查 ${out.total} 組貼圖，有 ${out.bad.length} 組超出框：`);
for (const r of out.bad.sort((a, b) => b.far - a.far)) console.log(`  ${r.name.padEnd(28)} 框半徑 ${r.half}，超出 ${r.far}（世界單位）、${r.n} 個像素`);
await b.close();
