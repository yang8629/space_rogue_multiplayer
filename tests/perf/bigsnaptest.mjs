// 很長的同步訊息（真的 PeerJS）：兩個 Chrome 進同一場戰鬥，房主在隊友身邊一次放 600 顆子彈（像散彈＋環繞放開那一刻）
//   PeerJS json 模式一則 ≥16300 位元組會報錯、以前被當成隊友斷線；現在切段送（Net.put），隊友要照樣收到、還連著
//   用法：node perf/bigsnaptest.mjs
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const [bA, bB] = await Promise.all([launch(), launch()]);
const [A, B] = await Promise.all([bA.newPage(), bB.newPage()]);
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
for (const [p, n] of [[A, '房主'], [B, '隊友']]) {
  p.on('pageerror', e => console.log(n, '頁面錯誤', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log(n, 'console', m.text().slice(0, 200)); });
}
const until = async (p, fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn)) return true; await wait(200); } return false; };
await Promise.all([A, B].map(async p => { await p.goto(GAME + 'index.html'); await wait(1500); await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); }); }));
await A.evaluate(() => Net.lobby()); await A.click('[data-act="nethost"]');
ok(await until(A, () => Game.state === 'pick' && Net.code), '房主開房');
const code = await A.evaluate(() => Net.code);
await B.evaluate(() => Net.lobby()); await B.type('#netCode', code); await B.click('[data-act="netjoin"]');
ok(await until(B, () => Game.state === 'pick' && Net.linked) && await until(A, () => Net.peers.some(q => q.linked)), '隊友加入');
await B.evaluate(() => Net.ready('bulwark', 'railgun', null)); await wait(500);
await A.evaluate(() => Net.ready('wraith', 'scatter', null));
ok(await until(A, () => Game.state === 'map') && await until(B, () => Game.state === 'map'), '兩邊到航圖');
await A.evaluate(() => { const r = Game.reachable().find(n => n.type === 'combat') || Game.reachable()[0]; Net.vote(r.id); window.__node = r.id; });
const nid = await A.evaluate(() => window.__node);
await B.evaluate(id => Net.vote(id), nid);
ok(await until(A, () => Game.state === 'play' && Game.inArena, 30000) && await until(B, () => Game.state === 'play' && Game.inArena, 30000), '兩邊進戰鬥');
await wait(1500);
// 隊友那邊數「收到的同步訊息裡最多幾顆子彈」
await B.evaluate(() => { window.__maxB = 0; const f = () => { window.__maxB = Math.max(window.__maxB, Game.bullets.length); requestAnimationFrame(f); }; f(); });
const size = await A.evaluate(() => {
  for (const e of Game.enemies) e.dead = true;
  Game.player.iframe = 1e9; Game.mates[0].iframe = 1e9;
  const M = Game.mates[0];
  for (let i = 0; i < 600; i++) spawnShots([shot({ speed: 20, life: 3 })], M.x, M.y, i / 600 * TAU, 0, null);
  // 這一則同步訊息多大（跟 hostSend 送的一樣：近似 = 子彈那一欄）
  return new TextEncoder().encode(JSON.stringify(Game.bullets.map(b => [Math.round(b.x), Math.round(b.y), 0, 20, 4, 0, 'dot', 0, 0, 3, 0]))).length;
});
await wait(1500);
const r = await B.evaluate(() => ({ max: window.__maxB, linked: Net.linked, state: Game.state }));
const hostSees = await A.evaluate(() => ({ linked: Net.peers.some(q => q.linked && q.conn && q.conn.open), state: Game.state }));
ok(r.max >= 600 && r.linked && r.state === 'play' && hostSees.linked, `房主一次放 600 顆（光子彈就約 ${Math.round(size / 1024)}KB，超過 PeerJS 的 16KB）：隊友收到最多 ${r.max} 顆、隊友還連著 ${r.linked}、房主看隊友還連著 ${hostSees.linked}`);
// 結算畫面時隊友按「離開房間」：房主不跳錯誤、不等重連，結算照看，還能自己回房間
//   （房主離開時隊友那邊的情形在 e2e.js「leaving during results」；直接關掉瀏覽器不會送出關閉通知，要等 WebRTC 自己逾時，這裡不測）
for (const p of [B, A]) await p.evaluate(() => { Game.inArena = false; Game.state = 'victory'; Game.victory = { pick: 'part', boss: Game.bossId }; });  // 兩邊都在旗艦結算（跟真的打完一樣）
await A.evaluate(() => Game.finishRun());
ok(await until(B, () => Game.state === 'ended'), '房主結束遠征：兩邊各自看結算');
await B.evaluate(() => [...Screen.el.querySelectorAll('button')].find(b => b.textContent.trim() === '離開房間').click());
const noticed = await until(A, () => Net.peers.length === 0, 15000);
await wait(500);
const after = await A.evaluate(() => { const o = document.getElementById('netOverlay');
  return { state: Game.state, overlay: !!o && getComputedStyle(o).display !== 'none' && o.textContent.trim() !== '', btns: [...Screen.el.querySelectorAll('button')].map(b => b.textContent.trim()).join('、'), err: Screen.el.textContent.includes('連線中斷') }; });
ok(noticed && after.state === 'ended' && !after.overlay && !after.err && after.btns.includes('回到房間'), `隊友離開後房主：還在結算（${after.state}）、沒有錯誤／等重連畫面（${!after.err && !after.overlay}）、按鈕「${after.btns}」`);
await A.screenshot({ path: SHOTS + '結算_隊友離開後.png' });
await A.evaluate(() => [...Screen.el.querySelectorAll('button')].find(b => b.textContent.trim() === '回到房間').click());
ok(await until(A, () => Game.state === 'pick' && !!Net.code, 5000), '房主自己回到房間（房間還開著）');
await Promise.all([bA.close(), bB.close()]);
console.log(fails ? `${fails} 項沒過` : '全部通過');
