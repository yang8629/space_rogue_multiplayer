// 基地房間的「乾淨」截圖：只留 WebGL 場景（藏起 2D 畫布的文字、DOM 介面），給 AI 以圖生圖當底圖用
//   用法：node perf/hubclean.mjs <房間 hall> <輸出.png> [寬 1344] [高 768]   （SDXL 適合的尺寸：1344×768、1024×1024）
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const [room = 'hall', out, W = '1344', H = '768'] = process.argv.slice(2);
if (!out) { console.log('用法：node perf/hubclean.mjs <房間> <輸出.png> [寬] [高]'); process.exit(1); }
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: +W, height: +H } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 2500));
await p.evaluate(room => {
  const r = HUB.rooms[room], s = Hub.ship;
  s.x = r.cx || r.x + r.w / 2; s.y = (r.cy || r.y + r.h / 2) + 130; Hub.follow();
  for (const el of document.body.children) if (el.id !== 'glc') el.style.visibility = 'hidden';  // 只留 WebGL 場景
}, room);
await new Promise(r => setTimeout(r, 600));
await p.screenshot({ path: out });
console.log('存好', out);
await b.close();
