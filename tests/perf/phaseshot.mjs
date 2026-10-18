// 先鋒號・相位跳躍的截圖 → art_lab/screenshots/
//   選飛船畫面（先鋒號的能力說明）、瞬移穿過小行星（跳之前／剛跳完）
//   用法：node perf/phaseshot.mjs
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Screen.title(); document.body.classList.add('detail'); });
await wait(500);
await p.screenshot({ path: SHOTS + '選飛船畫面_相位跳躍.png' });
// 小行星擋在前面：跳之前、剛跳完（兩端的光點）
await p.evaluate(() => {
  Game.newRun('sandbox', 'vanguard', 'laser');
  Game.node = { type: 'combat', L: 1, id: 'shot' };
  Game.startCombat({ level: 1, wavesTotal: 99, elites: 0, sandbox: true });
  Game.combat.pending = []; Game.enemies = []; Game.combat.waveTimer = 1e9; Input.autoFire = false;
  const P = Game.player; P.hp = P.maxHp = 1e9;
  Game.objs = [{ type: 'rock', x: P.x + 75, y: P.y, r: 40, hp: 999, maxHp: 999 }];
  window.__x0 = P.x;
});
await wait(600);
const clip = await p.evaluate(() => { const P = Game.player; return { x: Math.max(0, (P.x - Game.cam.x) * ZOOM - 200), y: Math.max(0, (P.y - Game.cam.y) * ZOOM - 150), width: 560, height: 300 }; });
await p.screenshot({ path: SHOTS + '相位跳躍_跳之前.png', clip });
await p.evaluate(() => { Input.keys.add('d'); Input.dash = true; setTimeout(() => Input.keys.delete('d'), 30); });
await wait(60);
await p.screenshot({ path: SHOTS + '相位跳躍_剛跳完.png', clip });
console.log('跳了', await p.evaluate(() => Math.round(Game.player.x - window.__x0)));
// 落地後的無敵（iframe，0.14 秒）：船身閃爍；停住遊戲更新，照閃爍的暗、亮兩格各拍一張
const frozen = async (dim, name) => {
  await p.evaluate(d => { if (!window.__upd) { window.__upd = Game.update; Game.update = () => {}; } const P = Game.player; P.iframe = 0.08; Game.time = (2 * Math.floor(Game.time * 10) + (d ? 1 : 0) + 0.5) / 20; }, dim);
  await wait(120);
  await p.screenshot({ path: SHOTS + name, clip });
  console.log(name, await p.evaluate(() => ({ iframe: Game.player.iframe, 暗: Math.floor(Game.time * 20) % 2 === 1 })));
};
await frozen(true, '相位跳躍_無敵閃爍_暗.png');
await frozen(false, '相位跳躍_無敵閃爍_亮.png');
await b.close();
console.log('done');
