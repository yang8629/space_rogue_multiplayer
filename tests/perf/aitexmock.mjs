// AI 生的地板貼圖試鋪（不改遊戲程式）：截圖時把圖鋪到某間房的地板上，跟原本的並排比較
//   用法：node perf/aitexmock.mjs <圖片> [房間 hangar] [一格板子在圖上幾 px] [一格板子在遊戲裡多大] [輸出名]
//   → art_lab/screenshots/AI地板_<輸出名>.png（左：原本、右：鋪了圖）
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const [img, room = 'hangar', panelPx = '208', panelWorld = '120', name = 'test'] = process.argv.slice(2);
const ext = img.split('.').pop().toLowerCase(), mime = ext === 'jpg' ? 'jpeg' : ext;
const dataUrl = `data:image/${mime};base64,` + fs.readFileSync(img).toString('base64');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const shot = async (withTex) => {
  const p = await b.newPage();
  p.on('pageerror', e => console.log('頁面錯誤', e.message)); p.on('console', m => { if (/貼圖|PIXI|Error|error/.test(m.text())) console.log('頁面：', m.text()); });
  await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(async (withTex, dataUrl, room, k) => {
    const r = HUB.rooms[room], s = Hub.ship;
    s.x = r.cx || r.x + r.w / 2; s.y = (r.cy || r.y + r.h / 2) + 130; Hub.follow();
    if (!withTex) return;
    const tex = await PIXI.Assets.load({ src: dataUrl, loadParser: 'loadTextures' });
    console.log('貼圖大小', tex.width, tex.height, PIXI.VERSION);
    // 這間房的地板磚改畫成貼圖（重複鋪滿；花紋、擺設照樣畫在上面）
    const of = GLHub.floorTiles; GLHub.floorTiles = function (g, rr, F) { if (rr.id !== room) return of.call(this, g, rr, F); const pat = new PIXI.FillPattern(tex, 'repeat'); pat.setTransform(new PIXI.Matrix().scale(k, k).translate(rr.x, rr.y)); g.rect(rr.x, rr.y, rr.w, rr.h).fill(pat); };
    GLHub.built = false;
  }, withTex, dataUrl, room, +panelWorld / +panelPx);
  await new Promise(r => setTimeout(r, 500));
  const buf = await p.screenshot();
  await p.close();
  return buf;
};
const a = await shot(false), c = await shot(true);
// 並排：用一個空白頁把兩張圖放在一起截圖
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 380 });
await p.setContent(`<body style="margin:0;background:#000;display:flex;gap:8px"><div style="flex:1;text-align:center;color:#ccc;font:14px sans-serif">原本<img style="width:100%" src="data:image/png;base64,${a.toString('base64')}"></div><div style="flex:1;text-align:center;color:#ccc;font:14px sans-serif">AI 貼圖<img style="width:100%" src="data:image/png;base64,${c.toString('base64')}"></div></body>`);
await p.screenshot({ path: SHOTS + `AI地板_${name}.png`, fullPage: true });
await b.close();
console.log('存好', SHOTS + `AI地板_${name}.png`);
