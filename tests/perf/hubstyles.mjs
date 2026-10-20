// 基地外觀選項截圖：站體外觀（HUB_HULL_STYLES）每一版拉遠看整個站體，拼成一張給使用者選
//   用法：node perf/hubstyles.mjs → art_lab/screenshots/選項_外觀.png（每格左上角寫風格名）
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const W = 1500, H = 1000;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: W, height: H } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 3000));
await p.evaluate(() => {
  for (const el of document.body.children) if (el.id !== 'glc') el.style.visibility = 'hidden';  // 只留 WebGL 場景
  Hub.follow = function () { const k = this.k = Math.min(VW / HUB.W, VH / HUB.H) * 0.98; this.cam.x = HUB.W / 2 - VW / 2 / k; this.cam.y = HUB.H / 2 - VH / 2 / k; };  // 拉遠：整個站體放進畫面
});
async function shot(style) {
  await p.evaluate(style => { GLHub.hullStyle = style; GLHub.built = false; Hub.follow(); }, style);
  await new Promise(r => setTimeout(r, 600));
  return p.screenshot({ encoding: 'base64' });
}
const STYLES = { skirt: '1 只有裙板（斜切角）', fins: '2 加散熱鰭片', struct: '3 加結構件' }, cells = [];
for (const [k, label] of Object.entries(STYLES)) cells.push([label, await shot(k)]);
const png = await p.evaluate(async (cells, W, H) => {
  const w = W / 2, h = H / 2, c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const g = c.getContext('2d');
  for (let k = 0; k < cells.length; k++) {
    const i = new Image(); i.src = 'data:image/png;base64,' + cells[k][1]; await i.decode();
    const x = (k % 2) * w, y = Math.floor(k / 2) * h; g.drawImage(i, x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(x, y, 300, 40); g.fillStyle = '#fff'; g.font = 'bold 24px sans-serif'; g.fillText(cells[k][0], x + 10, y + 28);
    g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
  }
  return c.toDataURL('image/png');
}, cells, W, H);
fs.writeFileSync(SHOTS + '選項_外觀.png', Buffer.from(png.split(',')[1], 'base64'));
console.log('存好', SHOTS + '選項_外觀.png');
// 單張大圖（看細節）：每一版各存一張
for (const [k, label] of Object.entries(STYLES)) fs.writeFileSync(SHOTS + `選項_外觀_${label.split(' ')[0]}.png`, Buffer.from(cells[Object.keys(STYLES).indexOf(k)][1], 'base64'));
await b.close();
