// 貼圖小工具（AI 生的圖用；不用 python：用 Chrome 的畫布處理）
//   調色：node perf/teximg.mjs adjust <輸入> <輸出.png> [亮度 1] [對比 1] [飽和度 1]   （例如 0.45 0.6 0.8 = 變暗、降對比、降飽和）
//   拼圖：node perf/teximg.mjs sheet <輸出.png> <圖1> <圖2> …   （每張縮成 512，排成一列或 2 列，左上角寫編號：看多張圖只花一張的 token）
//   接縫：node perf/teximg.mjs tile <輸入> <輸出.png>          （2×2 重複鋪，看接縫明不明顯）
//   套色：node perf/teximg.mjs tint <輸入> <輸出.png> <底色 10162a> [紋路強度 0.5]
//     只留 AI 圖的明暗紋路、顏色換成遊戲的底色：灰階 → 每點 = 底色 ×（1 + 強度 ×（亮度 ÷ 平均亮度 − 1））
//     平均剛好等於底色（跟 gl_hub.js 的 HUB_FLOOR 同一個顏色），強度 0 = 純底色、1 = 原圖的明暗差
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const [mode, ...a] = process.argv.slice(2);
const url = f => `data:image/${f.split('.').pop().toLowerCase() === 'jpg' ? 'jpeg' : 'png'};base64,` + fs.readFileSync(f).toString('base64');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const p = await b.newPage();
const run = (fn, ...args) => p.evaluate(fn, ...args);
// 在頁面裡：載入圖 → 畫到畫布 → 回傳 PNG 的 base64
const load = `src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; })`;
let out, png;
if (mode === 'adjust') {
  const [inp, o, br = '1', ct = '1', sa = '1'] = a; out = o;
  png = await run(async (src, f, L) => {
    const i = await eval(L)(src), c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const g = c.getContext('2d'); g.filter = f; g.drawImage(i, 0, 0); return c.toDataURL('image/png');
  }, url(inp), `brightness(${br}) contrast(${ct}) saturate(${sa})`, load);
} else if (mode === 'sheet') {
  const [o, ...imgs] = a; out = o;
  png = await run(async (srcs, L) => {
    // 每格寬 512（寬圖 672）、高照第一張的比例
    const I = [], L0 = eval(L); for (const s of srcs) I.push(await L0(s));
    const n = I.length, wide = I[0].width > I[0].height * 1.2, S = wide ? 672 : 512, SH = Math.round(S * I[0].height / I[0].width);
    const cols = n <= 3 ? n : Math.ceil(n / 2), rows = Math.ceil(n / cols);
    const c = document.createElement('canvas'); c.width = cols * S; c.height = rows * SH; const g = c.getContext('2d');
    for (let k = 0; k < n; k++) {
      const i = I[k], x = (k % cols) * S, y = Math.floor(k / cols) * SH;
      g.drawImage(i, x, y, S, SH);
      g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x, y, 44, 40); g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText(String(k + 1), x + 12, y + 31);
    }
    return c.toDataURL('image/png');
  }, imgs.map(url), load);
} else if (mode === 'tile') {
  const [inp, o] = a; out = o;
  png = await run(async (src, L) => {
    const i = await eval(L)(src), S = 512, c = document.createElement('canvas'); c.width = c.height = S * 2; const g = c.getContext('2d');
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.drawImage(i, x * S, y * S, S, S);
    return c.toDataURL('image/png');
  }, url(inp), load);
} else if (mode === 'tint') {
  const [inp, o, hex = '10162a', k = '0.5'] = a; out = o;
  png = await run(async (src, hex, k, L) => {
    const i = await eval(L)(src), c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    const D = g.getImageData(0, 0, c.width, c.height), d = D.data, n = d.length / 4, lum = new Float32Array(n);
    let sum = 0;
    for (let p = 0; p < n; p++) { lum[p] = 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2]; sum += lum[p]; }
    const avg = sum / n || 1, base = [0, 2, 4].map(s => parseInt(hex.slice(s, s + 2), 16));
    for (let p = 0; p < n; p++) { const m = 1 + k * (lum[p] / avg - 1); for (let ch = 0; ch < 3; ch++) d[p * 4 + ch] = Math.max(0, Math.min(255, base[ch] * m)); d[p * 4 + 3] = 255; }
    g.putImageData(D, 0, 0); return c.toDataURL('image/png');
  }, url(inp), hex, +k, load);
} else { console.log('用法見檔案開頭'); await b.close(); process.exit(1); }
fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log('存好', out);
await b.close();
