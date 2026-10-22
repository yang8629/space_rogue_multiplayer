// 裂界獵艦「裂縫改淡紫、變細」的預覽：在圖集工具頁重畫 boss2 的 4 格（不改檔案），換進新畫面的貼圖再截圖、拼成比較圖
//   用法：node perf/boss2slit.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const ROOT = GAME;
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));

// 1. 圖集工具頁：換掉裂縫那段，重畫 4 格
await p.goto(ROOT + 'tools/art/build.html'); await wait(800);
const frames = await p.evaluate(() => {
  const src = drawBoss2.toString()
    .replace("rgba('#e0c8ff', 0.35 * p); ctx.lineWidth = 7", "rgba('#e0c8ff', 0.25 * p); ctx.lineWidth = 5")
    .replace("'rgba(255,240,255,0.95)'; ctx.lineWidth = 1.6", "'rgba(240,220,255,0.9)'; ctx.lineWidth = 1.2");
  if (src === drawBoss2.toString()) return 'replace failed';
  const fn = new Function('return ' + src)();
  const e = ENEMIES.find(q => q.id === 'boss2'), half = e.r * 1.75, R = 2, out = [];
  for (let k = 0; k < 4; k++) {
    const cv = document.createElement('canvas'); cv.width = cv.height = Math.ceil(half * 2 * R);
    const c = cv.getContext('2d'); c.translate(half * R, half * R); c.scale(R, R); fn(c, e.col, e.r, k / 4 * TAU / 7, k / 4);
    out.push(cv.toDataURL());
  }
  return out;
});
if (typeof frames === 'string') { console.log(frames); process.exit(1); }

// 2. 遊戲頁：現在的樣子、換貼圖後（＋淺染色）
const shot = async (swap, tint) => {
  await p.goto(ROOT + 'index.html');
  await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
  await p.reload(); await wait(2500);
  if (swap) await p.evaluate(async fr => { for (let k = 0; k < fr.length; k++) { const img = new Image(); img.src = fr[k]; await img.decode(); const t = PIXI.Texture.from(img); t.defaultAnchor = { x: 0.5, y: 0.5 }; GLR.tex[`e/boss2/${k}`] = t; } }, frames);
  await p.evaluate(`(() => { SFX.setMuted && SFX.setMuted(true);
    Game.newRun('sandbox', 'vanguard', 'laser'); const q = Game.player; q.hp = q.maxHp = 1e9; Game.enemies = []; Game.objs = [];
    const e = new Enemy('boss2', q.x, q.y - 160, 1); e.spawnT = 0; e.frozen = true; e.hx = e.x; e.hy = e.y; e.t = { ...e.t, dmg: 0 }; e.rot = -Math.PI / 2; e.chargeA = -Math.PI / 2; Game.enemies.push(e);
    const T = ${tint || 0};
    if (T) { const A = GLActors, en = A.enemy, sp = A.spr; let on = false;
      A.spr = function (...a) { const s = sp.apply(this, a); if (on) { s.tint = T; on = false; } return s; };
      A.enemy = function (e) { on = e.type === 'boss2'; const r = en.call(this, e); on = false; return r; }; } })()`);
  await wait(900);
  const pos = await p.evaluate(() => { const e = Game.enemies[0]; return { x: (e.x - Game.cam.x) * ZOOM, y: (e.y - Game.cam.y) * ZOOM }; });
  return p.screenshot({ clip: { x: pos.x - 110, y: pos.y - 110, width: 220, height: 220 }, encoding: 'base64' });
};
const imgs = [['新畫面 現在', await shot(false)], ['裂縫淡紫、變細', await shot(true)], ['裂縫淡紫＋染色 dcd6ec', await shot(true, 0xdcd6ec)]];
await p.setContent(`<body style="margin:0;background:#05070f;display:flex;gap:8px;padding:8px;font:16px sans-serif;color:#dde">${imgs.map(([l, d]) => `<div style="text-align:center"><img src="data:image/png;base64,${d}" style="width:220px;height:220px;display:block"><div style="padding:4px">${l}</div></div>`).join('')}</body>`);
await p.setViewport({ width: 8 + imgs.length * 228, height: 270, deviceScaleFactor: 2 });
await p.screenshot({ path: `${OUT}裂界獵艦_裂縫比較.png` });
await b.close();
console.log('done');
