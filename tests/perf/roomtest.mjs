// 多人房間（共用的基地）真的連線測試：兩個 Chrome、真的 PeerJS（要有網路）
//   房主開房 → 隊友輸入房號加入 → 用鍵盤開飛船 → 看對方畫面的位置有沒有同步 → 換船、互射 → 到武器架換武器 → 兩邊準備（起始晶片）→ 一起播出發動畫 → 開始
//   截圖 art_lab/screenshots/房間測試_*.png；印出每一步過了沒
//   用法：node perf/roomtest.mjs
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const [bA, bB] = await Promise.all([launch(), launch()]);  // 兩個瀏覽器：各自的存檔、都在前景（畫面不會被節流）
const [A, B] = await Promise.all([bA.newPage(), bB.newPage()]);
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
for (const [p, n] of [[A, '房主'], [B, '隊友']]) {
  p.on('pageerror', e => console.log(n, '頁面錯誤', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log(n, 'console', m.text().slice(0, 200)); });
}
const until = async (p, fn, ms = 20000, arg) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn, arg)) return true; await wait(200); } return false; };
await Promise.all([A, B].map(async p => { await p.goto(GAME + 'index.html'); await wait(1500); await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); }); }));

// 房主：走到「多人連線」終端機按 E → 開房間
await A.evaluate(() => { const z = Hub.zone('coop'), s = Hub.ship; s.x = z.x + 40; s.y = z.y; });
await wait(300); await A.keyboard.press('e'); await wait(300);
ok(await A.evaluate(() => Game.state === 'lobby'), '房主：終端機按 E 打開連線畫面');
await A.click('[data-act="nethost"]');
ok(await until(A, () => Game.state === 'pick' && Net.code && Screen.hubOn), '房主：開好房間，進到基地（房間列有房號）');
const code = await A.evaluate(() => Net.code);
console.log('房號', code);
// 隊友：輸入房號加入
await B.evaluate(() => Net.lobby());
await B.type('#netCode', code); await B.click('[data-act="netjoin"]');
ok(await until(B, () => Game.state === 'pick' && Net.linked && Screen.hubOn), '隊友：加入房間，進到同一個基地');
ok(await until(A, () => Net.peers.some(q => q.linked && q.slot === 2)), '房主：看到 2P 進來');

// 隊友用鍵盤往右開 0.8 秒；房主那邊看到的位置要跟著動
const b0 = await B.evaluate(() => ({ x: Hub.ship.x, y: Hub.ship.y }));
await B.keyboard.down('d'); await wait(800); await B.keyboard.up('d'); await wait(600);
const b1 = await B.evaluate(() => ({ x: Hub.ship.x, y: Hub.ship.y }));
const seen = await A.evaluate(() => { const o = Net.roomShips().find(o => o.slot === 2); return o ? { x: o.x, y: o.y } : null; });
ok(b1.x > b0.x + 100, `隊友：鍵盤移動（x ${Math.round(b0.x)} → ${Math.round(b1.x)}）`);
ok(seen && Math.abs(seen.x - b1.x) < 30 && Math.abs(seen.y - b1.y) < 30, `房主：看到 2P 的位置跟著動（看到 ${seen ? Math.round(seen.x) + ',' + Math.round(seen.y) : '沒有'}，實際 ${Math.round(b1.x)},${Math.round(b1.y)}）`);
ok(await until(B, () => Net.roomShips().some(o => o.slot === 1)), '隊友：看到 1P 的船');
// 順不順（真的網路）：隊友往左開 1 秒，房主畫面上每一幀記 2P 的位置 → 隊友一直在動時，沒動的幀要是 0
//   （以前每秒只同步 12 次、沒有補動作：tests/roomlag.js 量到 8 成的幀不動）
const samp = A.evaluate(() => new Promise(res => { const out = []; let n = 0; const f = () => { const o = Net.roomShips().find(o => o.slot === 2); out.push(o ? [o.x, o.y] : null); if (++n < 75) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); }));
await B.keyboard.down('a'); const pos = await samp; await B.keyboard.up('a');
const mv = pos.slice(16).map((p, i) => p && pos[i + 15] ? Math.hypot(p[0] - pos[i + 15][0], p[1] - pos[i + 15][1]) : NaN).filter(Number.isFinite);  // 前 15 幀是起步（跳過）
const still = mv.filter(m => m < 0.01).length, mx = Math.max(...mv), avg = mv.reduce((a, b) => a + b, 0) / mv.length;
ok(mv.length > 40 && still === 0 && mx < avg * 3, `房主：2P 移動時每幀都在動（沒動 ${still}/${mv.length} 幀、每幀平均 ${avg.toFixed(1)}px、最多 ${mx.toFixed(1)}px）`);
await A.screenshot({ path: SHOTS + '房間測試_房主畫面.png' });
await B.screenshot({ path: SHOTS + '房間測試_隊友畫面.png' });

// 隊友換船：開到堡壘號的停機坪按 E
await B.evaluate(() => { const z = Hub.zone('pad:bulwark'), s = Hub.ship; s.x = z.x; s.y = z.y; });
await wait(300); await B.keyboard.press('e'); await wait(500);
ok(await until(A, () => (Net.roomShips().find(o => o.slot === 2) || {}).s === 'bulwark', 5000), '隊友換成堡壘號，房主看得到');

// 互射：隊友停在大廳，房主在他左邊朝右開火 → 隊友那邊被打中、被往右推
await B.evaluate(() => { const P = HUB.spawn, s = Hub.ship; s.x = P.x + 120; s.y = P.y; s.vx = s.vy = 0; Hub.hitN = 0; });
await wait(400);
await A.evaluate(() => { const P = HUB.spawn, s = Hub.ship; s.x = P.x - 120; s.y = P.y; s.aim = 0; Input.mouseMoved = false; Input.down = true; });
await wait(600); await A.evaluate(() => { Input.down = false; });
ok(await until(B, () => Hub.hitN > 0, 4000), '互射：房主開火，隊友那邊被打中（被推開、閃白）');
await A.screenshot({ path: SHOTS + '房間測試_互射.png' });

// 隊友準備：發射台按 E → 準備 → 選武器 → 起始晶片
const prepare = async (p, wpn) => {
  if (wpn !== await p.evaluate(() => Hub.weaponId)) {  // 武器架：開過去按 E 裝備
    await p.evaluate(w => { const z = Hub.zone('rack:' + w), s = Hub.ship; s.x = z.x; s.y = z.y; }, wpn);
    await wait(300); await p.keyboard.press('e'); await wait(300);
  }
  await p.evaluate(() => { const z = Hub.zone('launch'), s = Hub.ship; s.x = z.x; s.y = z.y; Hub.kick = { x: 0, y: 0 }; });  // 推力歸零（互射剛被打中）
  await wait(300); await p.keyboard.press('e'); await wait(300);
  await p.click('[data-act="depart"]'); await wait(300);
  await p.click('[data-act="startchip"]'); await wait(500);
};
await prepare(B, 'laser');
ok(await B.evaluate(() => Game.state === 'pick' && Net.meReady && Screen.hubOn), '隊友：準備好，回到基地等');
ok(await until(A, () => Net.peers[0].ready && document.querySelector('.hub-coop') && document.querySelector('.hub-coop').textContent.includes('✓')), '房主：房間列看到 2P ✓');
await A.screenshot({ path: SHOTS + '房間測試_隊友準備好.png' });
await prepare(A, 'scatter');
ok(await until(B, () => !!Hub.seq, 3000), '全員準備好：隊友也播出發動畫');
ok(await A.evaluate(() => Game.state === 'pick' && !!Hub.seq), '房主：出發動畫播完才開始');
ok(await until(A, () => Game.state === 'map' && Game.mode === 'coop'), '房主準備 → 開始，房主到航圖');
ok(await until(B, () => Game.state === 'map' && Game.mode === 'coop'), '隊友也到航圖');
ok(await B.evaluate(() => Game.shipId === 'bulwark' && Game.weapon.id === 'laser'), '隊友用的是自己選的堡壘號＋雷射');
// 船頭畫的武器：隊友那邊看房主的（開局選的 weaponId）、房主那邊看隊友的（配裝 L.weapon）
ok(await B.evaluate(() => (Game.mates.find(m => m.slot === 1) || {}).weaponId === 'scatter') && await A.evaluate(() => Game.mates[0].L.weapon.id === 'laser'), '兩邊都知道對方裝的武器（戰鬥中畫在船頭）');
await B.screenshot({ path: SHOTS + '房間測試_開始.png' });

// 一局結束回到房間：兩邊都按「離開」不算，這裡直接回房間（backToRoom）
await A.evaluate(() => Net.backToRoom()); await B.evaluate(() => Net.backToRoom());
ok(await until(A, () => Game.state === 'pick' && Net.peers[0].inRoom) && await until(B, () => Game.state === 'pick'), '回到房間：兩邊都在共用的基地');
ok(await A.evaluate(() => !Net.meReady && !Net.peers[0].ready), '回到房間要重新準備');
ok(await B.evaluate(() => !Hub.seq && Hub.free(Hub.ship.x, Hub.ship.y, Hub.ship.r)), '回到房間：飛船回到基地裡（不是停在飛出去的地方）');
await Promise.all([bA.close(), bB.close()]);
console.log(fails ? `${fails} 項沒過` : '全部通過');
process.exitCode = fails ? 1 : 0;
