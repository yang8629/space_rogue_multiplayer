// 介面數值圖示：打開 multiplayer/tools/art/ui_icons.html、呼叫 buildIcons()，存成 multiplayer/assets/ui/stat_*.png（64×64）
//   另外截一張預覽 → art_lab/screenshots/數值圖示.png
//   用法：node perf/builduiicons.mjs   （改了 tools/art/art_ui.js 就重跑）
import { ROOT, GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 420, height: 480 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'tools/art/ui_icons.html');
const r = await p.evaluate(() => window.buildIcons());
fs.mkdirSync(ROOT + 'assets/ui', { recursive: true });
for (const [id, d] of Object.entries(r)) fs.writeFileSync(ROOT + `assets/ui/stat_${id}.png`, Buffer.from(d.split(',')[1], 'base64'));
await p.screenshot({ path: SHOTS + '數值圖示.png' });
await b.close();
console.log('圖示', Object.keys(r).length, '張：', Object.keys(r).join('、'));
