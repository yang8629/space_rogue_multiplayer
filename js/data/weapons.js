// 星環電路 多人版 · weapons.js：6 把武器（左鍵＋右鍵）與兩段升級樹、weaponParams / weaponEmit
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// WEAPONS — 一場固定一把，兩段升級（第一段 3 選 1，第二段 2 選 1）
//   base  : 武器基礎參數
//   paths : 第一段路線；每條路線的 next 是第二段的兩個選項
//   apply : 直接修改參數物件 p
// =====================================================================
// 能量刃的右鍵・彈反（原型）：按下開 win 秒格擋，身邊 r 內的敵彈反射回去打最近的敵人（傷害 ×reflect）；
//   成功 → 冷卻只剩 hitCd 秒、keep 秒內的下一刀傷害 ×boost、刃片 ×grow；沒擋到就要等 cd 秒
const PARRY = { win: 0.25, cd: 2, hitCd: 0.5,  // cd：沒擋到的冷卻；hitCd：擋到後剩的冷卻（10-23 使用者：太快。以前 cd 0.9、擋到立刻轉好，子彈多時能一直按）
  r: 55, reflect: 3, keep: 1.5, boost: 2.5, grow: 1.5, stop: 0.18, stopScale: 0.05, shake: 7 };  // stop：成功時頓幀幾秒（遊戲速度 ×stopScale）
// 能量刃的左鍵・三段連段（原型）：同一次揮砍的刃片照角度依序在 sweepT 秒內放出（看起來是一刀揮過去）
//   sweep = 揮的方向（-1 右往左、1 左往右、0 同時）；dmg、grow = 傷害、刃片大小；wide = 刃片排開的角度倍率；
//   lunge = 往前突進的速度；cd = 這一刀之後的出手間隔倍率；reset 秒沒揮就回到第一段
const COMBO = { reset: 0.6, sweepT: 0.09, steps: [
  { name: '橫斬', sweep: -1, dmg: 1, grow: 1, wide: 1, lunge: 0, cd: 1 },
  { name: '反手斬', sweep: 1, dmg: 1.15, grow: 1, wide: 1, lunge: 0, cd: 1 },
  { name: '重斬', sweep: 0, dmg: 2.2, grow: 1.5, wide: 1.6, lunge: 380, cd: 2 }] };
// ===== 武器（2026-10-21）：每把武器左鍵累積、右鍵兌現。這裡只放數值、說明、升級樹；行為在 game/weapon_play.js =====
const pct = v => Math.round(v * 100) + '%';
// 熱能光束（laser）：每發加熱 per，滿了過熱停火 lock 秒；沒開火每秒降 cool；右鍵排熱：熱度 min 以上才能用，熱度換成 n 道衝擊波（射程 r）
const HEAT = { per: 0.03, cool: 0.4, lock: 1.5, min: 0.25, n: 18, dmg: 70, r: 170, cd: 2.5 };  // cd：排熱冷卻（10-23 使用者：0.8 太短 → 2.5）
// 連段（2026-10-22，使用者：其他武器也要有能量刃那種連段回饋）：每把照自己的玩法；收尾不額外觸發武器線
//   光束「四快一慢」：連射第 n 發是重的那發，前後都隔 slow 倍間隔、傷害 ×dmg、大小 ×grow；停火 reset 秒從頭算
const BEAT = { n: 5, slow: 2, dmg: 3, grow: 2, reset: 0.6 };
// 熱能光束的升級：高溫（熱度越高越痛）、散熱（右鍵）、低溫（擊殺降溫、保持涼的越強）
const HOT = { mul: 0.6 };                  // 高溫：傷害 +（熱度 × 60%）
const MELT = { hp: 5 };                    // 熔芯：過熱不停火，熱度滿時開火每秒扣 5 HP（最低剩 1）
const CRIT = { at: 0.9, pierce: 3 };       // 臨界：熱度 90% 以上，光束穿透 +3
const VENT2 = { min: 0.1, range: 1.3, cd: 0.25, slow: 0.5, slowT: 2 };  // 散熱：門檻 10%、射程 ×1.3；分段排熱冷卻 0.25 秒；冷凍衝擊減速 50%、2 秒
const COOL = { kill: 0.1, streak: 2, zero: 0.2, zeroMul: 1.5 };          // 低溫：擊殺降溫 10%；連殺不停火 = 擊殺後 2 秒內開火不加熱；零度 = 熱度 20% 以下傷害 ×1.5

// 迴旋飛輪（scatter）：飛到盡頭停住旋轉 park 秒（每 rehit 秒能再打同一隻），場上最多 max 個；右鍵召回：全部飛回來，回程傷害 ×back
const DISC = { max: 3, park: 4, rehit: 0.25, back: 1.6, backSpeed: 950, cd: 0.4, parkMul: 2 };  // cd：召回冷卻（短：丟、收是飛輪的玩法；10-23 試過 2 秒，使用者改回）  // parkMul：停住旋轉時的傷害倍率（10-22：停住只佔 4% 傷害，等它磨不划算）
const DISC_FAST = { speed: 1.5, dmg: 2 };  // 飛輪「全接快擲」：丟滿後召回、全部接回手上 → 下一個擲出的速度 ×speed、傷害 ×dmg
// 迴旋飛輪的升級：數量、召回、旋轉
const DISC_UP = { max: 1, stackR: 40, stackMax: 3, stackGrow: 1.3, stackDmg: 1.6,  // 疊輪：停在另一個飛輪 40 內就疊上去（最多 3 級，每級大 ×1.3、傷害 ×1.6）
  arc: { every: 0.25, dmg: 8, w: 16, len: 320 },                                    // 連鎖：停住的飛輪之間每 0.25 秒放電弧（320 內才連）
  back: 2, detourR: 250,                                                              // 召回：回程 ×2；回程追蹤 = 先繞去 250 內最近的敵人
  park: 1.5, grind: { grow: 0.3, max: 2 }, boom: { r: 120, dmg: 40 } };              // 旋轉：停留 ×1.5；磨盤每秒大 30%、最多 2 倍；爆輪接住時炸半徑 120

// 重力井（plasma）：飛到盡頭停住 park 秒，把 r 內的敵人往中心拉（旗艦不拉）；最多 max 個（多的擠掉最舊的）；右鍵塌縮：每個井炸半徑 boom，範圍內每多 1 隻 +per
const WELL = { max: 3, park: 3.5, rehit: 0.5, r: 140, pull: 240, boom: 110, dmg: 20, per: 0.25, capN: 8, cd: 0.8 };  // capN：加傷最多算到多 8 隻（不然總傷害跟數量平方成長）
//   10-23 平衡（整局模擬各 100 局，目標 20%）：原本（park 5、dmg 30）40%；基本傷害 5 → 3.7 只到 35%、塌縮 dmg 30 → 15 只到 27%（強在控場不在傷害）；dmg 20＋park 3.5 = 23%
const WELL_STACK = { max: 2, r: 1.3, dmg: 1.5 };  // 重力井「疊井」：新射出的井停在舊井的吸引範圍裡就合併（最多疊 max 次），每疊一次吸引範圍 ×r、塌縮傷害 ×dmg
// 重力井的升級：引力、塌縮、布井
const WELL_UP = { r: 1.4, slow: 0.5, eat: { per: 0.15, max: 10, r: 40 },          // 引力：範圍 ×1.4；事件視界減速 50%；吸彈：每吸 1 顆塌縮 +15%（最多 10 顆）
  per: 0.4, singleCd: 0.15, residue: { t: 2, r: 0.6 },                              // 塌縮：每多 1 隻 +40%；單點引爆冷卻 0.15 秒；殘留小井 2 秒、範圍 ×0.6
  max: 1, flyR: 0.6, drift: 70 };                                                    // 布井：上限 +1；黑洞彈飛行中吸 0.6 倍範圍；漂移井每秒 70

// 牽引鉤（railgun）：鉤爪打中就勾住，拉到飛船前方 hold 處（最多 t 秒）；右鍵甩擊：朝準星甩出去（速度 fling、飛 flyT 秒），撞到的受 dmg、被甩的受 self 倍
//   旗艦勾不動：鉤爪釘住 t 秒、每秒撕扯 tear；右鍵用力一扯 rip 後收回。持續傷害每 tick 秒結算一次（不要每幀跳數字）
const HOOK = { hold: 70, t: 3, fling: 1500, flyT: 0.5, dmg: 45, self: 0.5, cd: 0.5, tear: 20, rip: 80, tick: 0.25 };
const YANK = { n: 3, slam: 3, r: 60, every: 0.2 };  // 牽引鉤「扯」：勾住時左鍵改成扯（每 every 秒一下，不照射速：照射速 0.6 秒一扯，電腦勾到就甩反而比較強，10-22 整局 20% vs 0%），第 n 扯重摔在身前：傷害 ×slam、r 內的敵人一起吃
// 牽引鉤的升級：勾、甩、拉
const HOOK_UP = { t: 1.5, speed: 1.3, multi: 3,                                   // 勾：多勾 1.5 秒、鉤爪 ×1.3 快；群鉤最多 3 隻
  grapple: { speed: 1100, stop: 30, dmg: 30, maxT: 1.5 },                                     // 鉤索：每秒 1100 拉過去、停在 30 前，撞到的受 30
  fling: 1.5, boom: { r: 90, dmg: 40 }, bounceR: 300,                              // 甩：甩擊 ×1.5；爆裂甩落地炸半徑 90；彈跳甩找 300 內下一隻
  dps: 15, shock: { every: 0.3, r: 130, dmg: 12, n: 3 }, reflect: 1.5 };           // 拉：勾住每秒 15；電擊鉤每 0.3 秒電 130 內 3 隻；反射盾：擋下的敵彈彈回去 ×1.5

// 無人機蜂群（drone）：按住射擊時飛到準星附近、各打 range 內最近的敵人，放開回到身邊；右鍵收攏：shield 秒內貼身轉成護盾、最多擋 blockN 顆、不攻擊
//   牽繩：離飛船最多 leash；飛出去時被敵彈打 hp 下就壞，respawn 秒後在飛船旁重生（收攏擋子彈不扣）
const DRONE = { n: 4, orbit: 46, speed: 560, spread: 50, range: 260, shield: 2.5, guard: 34, block: 14, blockN: 8, cd: 5,
  leash: 300, hp: 3, hitR: 9, respawn: 4, turn: 10 };  // turn：機頭轉向的速度（弧度／秒；有目標朝目標，沒有朝移動方向）
// 無人機的升級：數量、火力、護衛
const DRONE_UP = { n: 2, kami: { dmg: 60, r: 70, speed: 900, seek: 400 },       // 數量：+2 架；自爆撞 400 內最近的敵人
  dmg: 1.4, focus: { per: 0.1, max: 10 }, missile: { homing: 3, r: 40, ratio: 0.6, speed: 0.7 },  // 火力：×1.4；集火每次 +10%（最多 10 層）；飛彈追蹤＋小爆炸
  block: 4, counter: { per: 12, r: 300 }, repair: 3 };                             // 護衛：多擋 4 顆；反擊每擋 1 顆 +12 傷害；修復每秒 3 HP

// 能量刃（blade）的升級：連段、彈反、狂戰
const COMBO4 = [COMBO.steps[0], COMBO.steps[1], { name: '迴斬', sweep: -1, dmg: 1.3, grow: 1.1, wide: 1.2, lunge: 0, cd: 1 }, COMBO.steps[2]];  // 四段連段
const ENDLESS = { per: 0.08, max: 10 };    // 無盡連段：每刀 +8%（最多 10 層），疊滿後每刀都是重斬；0.6 秒沒揮或被打中歸零
const PERFECT = { early: 0.08, r: 200 };   // 完美彈反：按下後 0.08 秒內擋到 → 200 內的敵彈全部反彈
const FURY = { per: 0.6 };                 // 狂戰：傷害 +（缺血比例 × 60%）：剩 20% 血 = +48%
const LEECH = { heal: 0.4, cap: 0.5 };     // 吸能刃：每次命中回 0.4，最多回到最大 HP 的 50%
const BLOOD = { cost: 0.06, mul: 2, floor: 0.2, kill: 0.03 };  // 血祭重斬：重斬扣最大 HP 的 6%（不會低於 20%），傷害 ×2；重斬打死敵人回 3%（付血換傷害、靠擊殺賺回來：10-23 整局 20 局只扣不回 0% 通關，同一段的吸能刃 45%）

const WEAPONS = {
  laser: { name: '熱能光束', short: '光束', color: '#5ef2ff', desc: [
      `高射速光束，每發加熱 ${pct(HEAT.per)}`,
      `<b>過熱</b>：熱度滿了停火 ${HEAT.lock} 秒；沒開火時慢慢降溫`,
      `<b>四快一慢</b>：第 ${BEAT.n} 發前後各停一拍，傷害 ×${BEAT.dmg}、大小 ×${BEAT.grow}`,
      `右鍵<b>排熱</b>（熱度 ${pct(HEAT.min)} 以上）：熱度噴成一圈衝擊波（熱度越高越痛），清掉身邊的敵彈`,
    ],
    // 射程 950 × 0.55 ≈ 520，留在畫面內（1280 寬時飛船到邊緣約 640）
    trig: 0.5,  // 10-24 1/3 → 0.5：接線表（chiplink --weapons）第一格每秒觸發只有飛輪、蜂群的一半（0.7 比 1.4）
    base: { interval: 0.16, count: 1, spread: 0, damage: 8, speed: 950, radius: 3, life: 0.55, shape: 'line', knock: 0.6 },
    alt: { name: '排熱', cd: HEAT.cd },  // 右鍵（行為在 game/weapon_play.js）
    paths: {
      A: { name: '高溫', desc: `熱度越高越痛：傷害 +（熱度 × ${pct(HOT.mul)}）。`, apply: p => { p.hot = true; },
        next: [{ name: '熔芯', desc: `過熱不再停火：熱度滿時繼續開火，每秒扣 ${MELT.hp} HP（最低剩 1）。`, apply: p => { p.melt = true; } },
          { name: '臨界', desc: `熱度 ${pct(CRIT.at)} 以上射出的光束穿透 +${CRIT.pierce}。`, apply: p => { p.crit = true; } }] },
      B: { name: '散熱', desc: `排熱門檻 ${pct(HEAT.min)} → ${pct(VENT2.min)}，衝擊波射程 ×${VENT2.range}。`, apply: p => { p.ventMin = VENT2.min; p.ventRange = VENT2.range; },
        next: [{ name: '分段排熱', desc: `每次排熱只用掉一半熱度，排完第一下 ${VENT2.cd} 秒就能排第二下（之後照正常冷卻）。`, apply: p => { p.ventSplit = true; } },
          { name: '冷凍衝擊', desc: `排熱的衝擊波讓敵人減速 ${pct(VENT2.slow)}（${VENT2.slowT} 秒）。`, apply: p => { p.ventSlow = true; } }] },
      C: { name: '低溫', desc: `每擊殺一隻，熱度 −${pct(COOL.kill)}。`, apply: p => { p.killCool = COOL.kill; },
        next: [{ name: '連殺不停火', desc: `擊殺後 ${COOL.streak} 秒內開火不加熱。`, apply: p => { p.streak = true; } },
          { name: '零度', desc: `熱度低於 ${pct(COOL.zero)} 時傷害 ×${COOL.zeroMul}。`, apply: p => { p.zero = true; } }] },
    } },

  scatter: { name: '迴旋飛輪', short: '飛輪', color: '#ffb347', desc: [
      `擲出飛輪，飛到盡頭停在原地旋轉 ${DISC.park} 秒，碰到的敵人每 ${DISC.rehit} 秒受傷一次（傷害 ×${DISC.parkMul}）`,
      `時間到自己飛回手上（回程也打得到），也可以開過去撿起來`,
      `場上最多 ${DISC.max} 個，滿了不能再擲`,
      `右鍵<b>召回</b>：全部直線飛回手上，回程傷害 ×${DISC.back}、無限穿透`,
      `<b>全接</b>：丟滿再召回、全部接回手上 → 下一擲速度 ×${DISC_FAST.speed}、傷害 ×${DISC_FAST.dmg}`,
    ],
    trig: 0.25,
    base: { interval: 0.35, count: 1, spread: 0, damage: 6, speed: 700, radius: 11, pierce: 99, life: 0.45, shape: 'orb', knock: 0.6, park: 'disc' },
    alt: { name: '召回', cd: DISC.cd },  // 右鍵（行為在 game/weapon_play.js）
    paths: {
      A: { name: '數量', desc: `飛輪上限 +${DISC_UP.max}。`, apply: p => { p.discMax = DISC_UP.max; },
        next: [{ name: '疊輪', desc: `飛輪停在另一個停住的飛輪 ${DISC_UP.stackR} 內就疊上去：每疊一級大 ×${DISC_UP.stackGrow}、傷害 ×${DISC_UP.stackDmg}（最多 ${DISC_UP.stackMax} 級）。`, apply: p => { p.discStack = true; } },
          { name: '連鎖', desc: `停住的飛輪之間每 ${DISC_UP.arc.every} 秒放一道電弧（${DISC_UP.arc.len} 內才連），碰到的敵人受到 ${DISC_UP.arc.dmg}。`, apply: p => { p.discArc = true; } }] },
      B: { name: '召回', desc: `回程傷害 ×${DISC.back} → ×${DISC_UP.back}。`, apply: p => { p.discBack = DISC_UP.back; },
        next: [{ name: '回程追蹤', desc: `召回時每個飛輪先繞去 ${DISC_UP.detourR} 內最近的敵人，再飛回手上。`, apply: p => { p.discDetour = true; } },
          { name: '自動再擲', desc: '飛輪回到手上立刻朝準星再擲出去。', apply: p => { p.rethrow = true; } }] },
      C: { name: '旋轉', desc: `飛輪停留時間 ×${DISC_UP.park}。`, apply: p => { p.parkMul = DISC_UP.park; },
        next: [{ name: '磨盤', desc: `停住的飛輪每秒變大 ${pct(DISC_UP.grind.grow)}，最多 ${DISC_UP.grind.max} 倍。`, apply: p => { p.grind = true; } },
          { name: '爆輪', desc: `飛輪回到手上時在身邊爆炸（半徑 ${DISC_UP.boom.r}、${DISC_UP.boom.dmg} 傷害）。`, apply: p => { p.discBoom = true; } }] },
    } },

  plasma: { name: '重力井', short: '重力', color: '#c77dff', desc: [
      `射出重力彈，飛到盡頭變成重力井 ${WELL.park} 秒，把 ${WELL.r} 內的敵人往中心吸（旗艦不受影響）`,
      `最多 ${WELL.max} 個（停住的才算），多的擠掉最舊的`,
      `<b>疊井</b>：新的井停在舊井範圍裡（最多疊 ${WELL_STACK.max} 次）→ 吸引範圍 ×${WELL_STACK.r}、塌縮傷害 ×${WELL_STACK.dmg}`,
      `右鍵<b>塌縮</b>：所有井同時爆炸（半徑 ${WELL.boom}、${WELL.dmg} 傷害）`,
      `範圍內每多 1 隻敵人，塌縮傷害 +${pct(WELL.per)}（最多算 ${WELL.capN} 隻；旗艦半徑每 ${CFG.HIT_PT.per} 算 1 隻）`,
    ],
    trig: 0.25,
    base: { interval: 0.55, count: 1, spread: 0, damage: 5, speed: 420, radius: 10, pierce: 99, life: 0.75, shape: 'orb', knock: 0.3, park: 'well' },
    alt: { name: '塌縮', cd: WELL.cd },  // 右鍵（行為在 game/weapon_play.js）
    paths: {
      A: { name: '引力', desc: `吸引範圍 ×${WELL_UP.r}。`, apply: p => { p.wellR = WELL_UP.r; },
        next: [{ name: '事件視界', desc: `被吸住的敵人減速 ${pct(WELL_UP.slow)}。`, apply: p => { p.horizon = true; } },
          { name: '吸彈', desc: `重力井吸收靠近的敵彈；塌縮時每吸過 1 顆傷害 +${pct(WELL_UP.eat.per)}（最多 ${WELL_UP.eat.max} 顆）。`, apply: p => { p.eat = true; } }] },
      B: { name: '塌縮', desc: `範圍內每多 1 隻敵人，傷害 +${pct(WELL.per)} → +${pct(WELL_UP.per)}。`, apply: p => { p.wellPer = WELL_UP.per; },
        next: [{ name: '單點引爆', desc: `右鍵只引爆離準星最近的重力井，冷卻 ${WELL_UP.singleCd} 秒。`, apply: p => { p.single = true; } },
          { name: '殘留', desc: `塌縮後原地留一個小重力井（${WELL_UP.residue.t} 秒、範圍 ×${WELL_UP.residue.r}）。`, apply: p => { p.residue = true; } }] },
      C: { name: '布井', desc: `重力井上限 +${WELL_UP.max}。`, apply: p => { p.wellMax = WELL_UP.max; },
        next: [{ name: '黑洞彈', desc: `重力彈飛行中就會吸引路徑旁的敵人（範圍 ×${WELL_UP.flyR}）。`, apply: p => { p.flyPull = true; } },
          { name: '漂移井', desc: `停住的重力井每秒朝準星飄 ${WELL_UP.drift}。`, apply: p => { p.drift = true; } }] },
    } },

  railgun: { name: '牽引鉤', short: '鉤爪', color: '#ffd166', desc: [
      `射出鉤爪，勾住敵人拉到飛船前方（最多 ${HOOK.t} 秒）`,
      `勾住時左鍵改成<b>扯</b>：第 ${YANK.n} 扯重摔，傷害 ×${YANK.slam}、${YANK.r} 內的敵人一起吃`,
      `右鍵<b>甩擊</b>：朝準星甩出去，撞到的受 ${HOOK.dmg} 傷害，被甩的那隻也受 ${pct(HOOK.self)}`,
      `勾住的、甩出去還在飛的敵人會擋下碰到牠的敵彈（牠照樣扣血）`,
      `<b>旗艦</b>勾不動：鉤爪釘在牠身上（最多 ${HOOK.t} 秒）每秒撕扯 ${HOOK.tear}，右鍵用力一扯造成 ${HOOK.rip} 後收回`,
      `<b>精英</b>勾 ${CFG.CC.elite.hook.t} 秒就掙脫，之後 ${CFG.CC.elite.hook.immune} 秒勾不住`,
      `<b>多人</b>：勾得到隊友（戰鬥、房間都行，倒下的也行），拉到你前方、他衝刺就掙脫；右鍵把他甩去撞敵人（飛行中無敵）；被勾住的人不能勾隊友`,
    ],
    trig: 1,
    base: { interval: 0.6, count: 1, spread: 0, damage: 8, speed: 1300, radius: 6, pierce: 0, life: 0.28, shape: 'rail', knock: 0.2, hook: true },
    alt: { name: '甩擊', cd: HOOK.cd },  // 右鍵（行為在 game/weapon_play.js）
    paths: {
      A: { name: '勾', desc: `勾住多 ${HOOK_UP.t} 秒，鉤爪速度 ×${HOOK_UP.speed}。`, apply: p => { p.hookT = HOOK_UP.t; p.speed *= HOOK_UP.speed; },
        next: [{ name: '群鉤', desc: `鉤爪穿過一整排，最多勾住 ${HOOK_UP.multi} 隻綁成一串，甩擊時一起甩出去。`, apply: p => { p.multi = true; p.pierce = HOOK_UP.multi - 1; } },
          { name: '鉤索', desc: `鉤爪打到牆就把你拉過去（每秒 ${HOOK_UP.grapple.speed}），路上撞到的敵人受到 ${HOOK_UP.grapple.dmg}。`, apply: p => { p.grapple = true; } }] },
      B: { name: '甩', desc: `甩擊傷害 ×${HOOK_UP.fling}。`, apply: p => { p.flingMul = HOOK_UP.fling; },
        next: [{ name: '爆裂甩', desc: `被甩的敵人飛完時爆炸（半徑 ${HOOK_UP.boom.r}、${HOOK_UP.boom.dmg} 傷害）。`, apply: p => { p.flingBoom = true; } },
          { name: '彈跳甩', desc: `被甩的敵人撞到第一隻後，轉向 ${HOOK_UP.bounceR} 內的下一隻再飛一次。`, apply: p => { p.flingBounce = true; } }] },
      C: { name: '拉', desc: `勾住的敵人每秒受到 ${HOOK_UP.dps}。`, apply: p => { p.hookDps = true; },
        next: [{ name: '電擊鉤', desc: `勾住時每 ${HOOK_UP.shock.every} 秒電擊附近 ${HOOK_UP.shock.r} 內最多 ${HOOK_UP.shock.n} 隻（各 ${HOOK_UP.shock.dmg}）。`, apply: p => { p.shockHook = true; } },
          { name: '反射盾', desc: `勾住的敵人擋下的敵彈反彈回去，打最近的敵人（傷害 ×${HOOK_UP.reflect}）。`, apply: p => { p.hookReflect = true; } }] },  // 10-22：擋子彈改成基本玩法，原本的「肉盾」改成反彈
    } },

  blade: { name: '能量刃', short: '能刃', color: '#ff8fd8', desc: [
      `近戰三段連段：${COMBO.steps.map(s => s.name).join(' → ')}，刃片無限穿透`,
      `第三刀傷害 ×${COMBO.steps[2].dmg}、往前突進，之後收刀比較久；${COMBO.reset} 秒沒揮就從頭開始`,
      `右鍵<b>彈反</b>：${PARRY.win} 秒內碰到身邊的敵彈就反射回去（傷害 ×${PARRY.reflect}）`,
      `擋到：${PARRY.hitCd} 秒就能再用，${PARRY.keep} 秒內的下一刀傷害 ×${PARRY.boost}；沒擋到要等 ${PARRY.cd} 秒`,
    ],
    // 4 片排成 1.1 弧度的扇形（連段一刀一刀揮過去）
    trig: 0.25,  // 10-24 0.15 → 0.25：同光束（第一格每秒觸發 0.7）
    base: { interval: 0.3, count: 4, spread: 1.1, damage: 3, speed: 650, radius: 8, pierce: 99, life: 0.2, shape: 'blade', knock: 0.8 },  // 傷害 5 → 3（10-23 整局模擬各 100 局：5 = 44%、3.5 = 27%、3 = 18%，目標 20%；數值只用整數或 .5）
    alt: { name: '彈反', cd: PARRY.cd },  // 右鍵（行為在 game/weapon_play.js）
  // parryN：這次擋下幾顆（0 = 落空，見 Player.tickAlt）
  // 無盡連段：被打中歸零
    paths: {
      A: { name: '連段', desc: `連段多一刀：${COMBO4.map(s => s.name).join(' → ')}。`, apply: p => { p.combo4 = true; },
        next: [{ name: '無盡連段', desc: `每揮一刀傷害 +${pct(ENDLESS.per)}（最多 ${ENDLESS.max} 層）；疊滿後每一刀都是重斬（照樣突進）；${COMBO.reset} 秒沒揮或被打中就歸零。`, apply: p => { p.endless = true; } },
          { name: '旋風重斬', desc: '重斬變成 360 度環形斬擊。', apply: p => { p.whirl = true; } }] },
      B: { name: '彈反', desc: `格擋時間 ${PARRY.win} → ${PARRY.win + 0.1} 秒。`, apply: p => { p.parryWin = 0.1; },
        next: [{ name: '追蹤反射', desc: '反射回去的子彈會追蹤敵人。', apply: p => { p.reflectHome = true; } },
          { name: '完美彈反', desc: `按下後 ${PERFECT.early} 秒內就擋到：身邊 ${PERFECT.r} 內的敵彈全部反彈。`, apply: p => { p.perfect = true; } }] },
      C: { name: '狂戰', desc: `血越少越痛：傷害 +（缺血比例 × ${pct(FURY.per)}），剩 20% 血時 +${pct(FURY.per * 0.8)}。`, apply: p => { p.fury = true; },
        next: [{ name: '吸能刃', desc: `每次命中回 ${LEECH.heal} HP，最多回到最大 HP 的 ${pct(LEECH.cap)}。`, apply: p => { p.leech = true; } },
          { name: '血祭重斬', desc: `重斬扣最大 HP 的 ${pct(BLOOD.cost)}（不會低於 ${pct(BLOOD.floor)}），傷害 ×${BLOOD.mul}；到 ${pct(BLOOD.floor)} 後不再扣血、照樣 ×${BLOOD.mul}。重斬打死敵人回最大 HP 的 ${pct(BLOOD.kill)}。`, apply: p => { p.blood = true; } }] },
    } },

  drone: { name: '無人機蜂群', short: '蜂群', color: '#7cf5c8', desc: [
      `${DRONE.n} 架無人機：按住射擊時飛到準星附近（離飛船最多 ${DRONE.leash}），各自打 ${DRONE.range} 內最近的敵人；放開就回到身邊`,
      `飛出去時被敵彈打 ${DRONE.hp} 下會壞，${DRONE.respawn} 秒後重生`,
      `右鍵<b>收攏</b>：${DRONE.shield} 秒內貼著飛船轉成一圈護盾，最多擋 ${DRONE.blockN} 顆敵彈，這段時間不攻擊`,
    ],
    trig: 0.2,
    base: { interval: 0.3, count: 1, spread: 0, damage: 4, speed: 800, radius: 3, life: 0.4, shape: 'dot', knock: 0.4, drones: DRONE.n },  // 傷害 6 → 4（10-23 整局模擬各 100 局：6 = 53%、4.5 = 38%、4 = 24%，目標 20%）
    alt: { name: '收攏', cd: DRONE.cd },  // 右鍵（行為在 game/weapon_play.js）
    paths: {
      A: { name: '數量', desc: `無人機 +${DRONE_UP.n} 架。`, apply: p => { p.drones += DRONE_UP.n; },
        next: [{ name: '分工', desc: '一半的無人機留在身邊打靠近的敵人，另一半跟著準星。', apply: p => { p.split = true; } },
          { name: '自爆', desc: `右鍵改成：每架無人機衝向 ${DRONE_UP.kami.seek} 內最近的敵人自爆（半徑 ${DRONE_UP.kami.r}、${DRONE_UP.kami.dmg} 傷害），之後等重生。`, apply: p => { p.kami = true; } }] },
      B: { name: '火力', desc: `傷害 ×${DRONE_UP.dmg}。`, apply: p => { p.damage *= DRONE_UP.dmg; },
        next: [{ name: '集火', desc: `全部打離準星最近的那隻；連續打同一隻每次 +${pct(DRONE_UP.focus.per)}（最多 ${DRONE_UP.focus.max} 層），換目標歸零。`, apply: p => { p.focusD = true; } },
          { name: '飛彈無人機', desc: `改射追蹤小飛彈，命中小範圍爆炸（半徑 ${DRONE_UP.missile.r}、${pct(DRONE_UP.missile.ratio)}）。`, apply: p => { p.missile = true; } }] },
      C: { name: '護衛', desc: `收攏多擋 ${DRONE_UP.block} 顆。`, apply: p => { p.blockN = DRONE_UP.block; },
        next: [{ name: '反擊', desc: `收攏結束時每架無人機電擊 ${DRONE_UP.counter.r} 內最近的敵人，每擋下 1 顆 +${DRONE_UP.counter.per} 傷害。`, apply: p => { p.counter = true; } },
          { name: '修復', desc: `收攏中每秒回 ${DRONE_UP.repair} HP。`, apply: p => { p.repair = true; } }] },
    } },
};

// 選武器卡片的一行精簡說明
const WEAPON_BRIEF = {
  laser: '高射速光束，會過熱；右鍵把熱度噴成衝擊波。',
  scatter: '擲出飛輪停在場上旋轉；右鍵全部召回，回程更痛。',
  plasma: '布下重力井把怪吸成一團；右鍵一起塌縮引爆。',
  railgun: '鉤爪勾住敵人拉過來；右鍵甩出去砸別隻。',
  drone: '無人機飛去準星附近自動開火；右鍵收攏擋子彈。最好上手。',
  blade: '近戰斬擊；右鍵抓準時機彈反敵彈，成功後下一刀超痛。' };

// trig：武器命中幾次觸發一次武器線（每次命中 +trig，滿 1 觸發；命中頻率不同的武器觸發次數差不多）
function weaponParams(state) {
  const W = WEAPONS[state.id];
  const p = Object.assign({ rate: 1, jitter: 0, speedVar: false, pierce: 0, bounce: 0, homing: 0,
    explode: null, burn: null, arcs: null, slow: 0, slowDur: 0, knock: 1, lifesteal: 0, color: W.color }, W.base);
  if (state.path) {
    W.paths[state.path].apply(p);
    if (state.final != null) W.paths[state.path].next[state.final].apply(p);
  }
  return p;
}
function weaponEmit(p, pw) {
  const out = [], sm = statDmgMul();
  for (let k = 0; k < p.count; k++) {
    const a = (p.count > 1 ? -p.spread / 2 + p.spread * k / (p.count - 1) : 0) + (p.jitter ? rand(-p.jitter, p.jitter) : 0);
    out.push(shot({ angle: a, speed: p.speed * (p.speedVar ? rand(0.92, 1.08) : 1), damage: p.damage * pw * sm,
      park: p.park || null, hook: !!p.hook,  // 停在場上（飛輪、重力井）、鉤爪
      radius: p.radius, pierce: p.pierce, bounce: p.bounce, homing: p.homing, life: p.life, color: p.color, shape: p.shape,
      explode: p.explode, burn: p.burn, arcs: p.arcs, slow: p.slow, slowDur: p.slowDur || 0, knock: p.knock, lifesteal: p.lifesteal }));
  }
  return out;
}
// 開火的人（雙人：隊友的電路在 withLoadout 裡開火時是隊友）
const shooterNow = () => Game.shipOf(Game.shooter);
// 無傷連殺（輕裝甲 4 層：沒被打中的連續擊殺）；照開火的人現在的機體算（雙人開房時隊友的機體還沒算好）
function statDmgMul() {
  if (!Game.mech || !Game.mech.traits.streak) return 1;
  const P = shooterNow();
  return 1 + (P ? (P.streak || 0) * STREAK.per : 0);
}
function weaponTitle(state) {
  const W = WEAPONS[state.id], P = state.path && W.paths[state.path];
  return [W.name, P && P.name, P && state.final != null && P.next[state.final].name].filter(Boolean).join('・');
}
