// 基地風格選項截圖：門（HUB_DOOR_STYLES）、大廳中間（HUB_CENTER_STYLES）每一版各截一塊，拼成一張給使用者選
//   用法：node perf/hubstyles.mjs → art_lab/screenshots/選項_門.png、選項_大廳中間.png（每格左上角寫風格名）
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 3000));
await p.evaluate(() => { for (const el of document.body.children) if (el.id !== 'glc') el.style.visibility = 'hidden'; });  // 只留 WebGL 場景
// 飛船停在 (x, y)、照這一版重畫，截畫面正中間 w × h
async function shot(set, at, w, h) {
  await p.evaluate((set, at) => {
    Object.assign(GLHub, set); GLHub.built = false;
    const [x, y] = new Function(at)(), s = Hub.ship; s.x = x; s.y = y; s.vx = s.vy = 0; Hub.follow();
  }, set, at);
  await new Promise(r => setTimeout(r, 500));
  return p.screenshot({ clip: { x: 640 - w / 2, y: 360 - h / 2, width: w, height: h }, encoding: 'base64' });
}
async function sheet(name, cells, w, h) {
  const png = await p.evaluate(async (cells, w, h) => {
    const cols = Math.min(cells.length, 2), rows = Math.ceil(cells.length / cols), c = document.createElement('canvas');
    c.width = cols * w; c.height = rows * h; const g = c.getContext('2d');
    for (let k = 0; k < cells.length; k++) {
      const i = new Image(); i.src = 'data:image/png;base64,' + cells[k][1]; await i.decode();
      const x = (k % cols) * w, y = Math.floor(k / cols) * h; g.drawImage(i, x, y);
      g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(x, y, 150, 40); g.fillStyle = '#fff'; g.font = 'bold 24px sans-serif'; g.fillText(cells[k][0], x + 10, y + 28);
      g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
    }
    return c.toDataURL('image/png');
  }, cells, w, h);
  fs.writeFileSync(SHOTS + name, Buffer.from(png.split(',')[1], 'base64'));
  console.log('存好', SHOTS + name);
}
// 門：大廳 ↔ 機庫（左右相通）
const DOOR_AT = 'const d = HUB.doors[0]; return [d.x + d.w / 2, d.y + d.h / 2];';
const DOORS = { rail: '1 細門框', blast: '2 防爆門', energy: '3 能量門', bulkhead: '4 隔艙門' }, dc = [];
for (const [k, label] of Object.entries(DOORS)) dc.push([label, await shot({ doorStyle: k }, DOOR_AT, 520, 340)]);
await sheet('選項_門.png', dc, 520, 340);
// 大廳中間
const HALL_AT = 'const r = HUB.rooms.hall; return [r.x + r.w / 2, r.y + r.h / 2 + 150];';
const CENTERS = { none: '1 空的', holo: '2 全像投影台', lift: '3 升降平台', core: '4 能量核心' }, cc = [];
for (const [k, label] of Object.entries(CENTERS)) cc.push([label, await shot({ doorStyle: 'rail', centerStyle: k }, HALL_AT, 620, 520)]);
await sheet('選項_大廳中間.png', cc, 620, 520);
await b.close();
