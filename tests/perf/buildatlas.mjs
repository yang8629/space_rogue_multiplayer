// 產生圖集：用瀏覽器打開 multiplayer/tools/art/build.html、呼叫 buildAtlas()，存成
//   multiplayer/assets/atlas_N.png（每頁 2048×2048）、atlas.json（每張貼圖在哪一頁、位置、錨點、每單位幾像素）、
//   atlas_data.js（同樣的內容，圖片內嵌成 data URL：用 file:// 打開遊戲時 WebGL 不能讀本機圖片檔，要靠這個）
// 用法：node perf/buildatlas.mjs   （改了 tools/art/*.js 的美術就重跑）
import { ROOT, GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
await p.goto(GAME + 'tools/art/build.html');
const r = await p.evaluate(() => window.buildAtlas());
await b.close();
fs.mkdirSync(ROOT + 'assets', { recursive: true });
for (const f of fs.readdirSync(ROOT + 'assets')) if (/^atlas_\d+\.png$/.test(f)) fs.unlinkSync(ROOT + 'assets/' + f);
r.pages.forEach((d, i) => fs.writeFileSync(ROOT + `assets/atlas_${i}.png`, Buffer.from(d.split(',')[1], 'base64')));
const meta = { scaleNote: '每張貼圖的 res = 每個世界單位幾像素；ax/ay = 錨點（0～1）', pages: r.pages.map((_, i) => `atlas_${i}.png`), frames: r.frames };
fs.writeFileSync(ROOT + 'assets/atlas.json', JSON.stringify(meta));
fs.writeFileSync(ROOT + 'assets/atlas_data.js', `// 自動產生（mp_tests/perf/buildatlas.mjs），不要手改\nwindow.ATLAS = ${JSON.stringify({ pages: r.pages, frames: r.frames })};\n`);
const kb = f => Math.round(fs.statSync(ROOT + 'assets/' + f).size / 1024);
console.log(`貼圖 ${r.count} 張、圖集 ${r.pages.length} 頁（${r.pages.map((_, i) => kb(`atlas_${i}.png`) + 'KB').join('、')}）、atlas_data.js ${kb('atlas_data.js')}KB`);
