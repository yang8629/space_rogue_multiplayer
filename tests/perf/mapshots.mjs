// 地圖形狀一覽：幾個種子的一般地圖（3 區）＋三種王場地，畫成黑白小圖（白 = 空地）拼成一張
//   用法：node perf/mapshots.mjs <檔名後綴>   → art_lab/screenshots/地圖形狀_<後綴>.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const tag = process.argv[2] || '現在';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1500));
const out = await p.evaluate(() => {
  const maps = [];
  const draw = (label) => {
    const NX = Arena.NX, NY = Arena.NY, cv = document.createElement('canvas'); cv.width = NX + 1; cv.height = NY + 1;
    const c = cv.getContext('2d'), im = c.createImageData(NX + 1, NY + 1);
    for (let k = 0; k < Arena.val.length; k++) { const v = Arena.val[k] > 0 ? 235 : 25; im.data[k * 4] = im.data[k * 4 + 1] = im.data[k * 4 + 2] = v; im.data[k * 4 + 3] = 255; }
    c.putImageData(im, 0, 0);
    maps.push({ label, url: cv.toDataURL(), w: NX + 1, h: NY + 1 });
  };
  for (const seed of [11, 222, 3333, 44444, 555555, 6666666]) { Arena.gen(seed, 3); draw(`種子 ${seed}`); }
  for (const id of ['boss', 'boss2', 'boss3']) { Arena.genBoss(7, id); draw(id); }
  Arena.reset();
  return maps;
});
const html = `<body style="margin:0;background:#111;color:#ddd;font:14px sans-serif;display:flex;flex-wrap:wrap;gap:10px;padding:10px">${out.map(m => `<div><img src="${m.url}" style="height:300px;image-rendering:pixelated;display:block"><div>${m.label}</div></div>`).join('')}</body>`;
await p.setContent(html); await new Promise(r => setTimeout(r, 300));
await p.screenshot({ path: `${OUT}地圖形狀_${tag}.png`, fullPage: true });
await b.close();
console.log('done', out.map(m => `${m.label} ${m.w}x${m.h}`).join('、'));
