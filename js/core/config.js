// 星環電路 多人版 · config.js：設定值 CFG 與共用小工具（亂數、距離、角度）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// CONFIG
// =====================================================================
const CFG = {
  WORLD_W: 2400, WORLD_H: 1600,
  IFRAME: 0.7,               // 船體 HP / 速度 / 衝刺冷卻改由 SHIPS 定義
  DASH_SPEED: 900, DASH_TIME: 0.14,
  COMET_SHARD_DMG: 10,      // 彗星打爆後的碎片打到飛船的傷害（每片）
  // 攔截回射：第一顆擋下的位置開一個集氣池，win 秒內 join 以內擋下的都合進去，時間到回射一次（每多 1 顆傷害 +per，最多 ×max）；離所有集結點太遠就另開一個池
  COUNTER: { win: 0.2, per: 0.3, max: 4, join: 300 },
  BOSS_BOMB: { n: 4, nRage: 6, r: 110, delay: 1.2, dmg: 25 },  // 終焉核心的落點轟炸：紅圈數（暴走後）、半徑、幾秒後爆炸、傷害  // 星噬核心（模組）：每 6 秒朝 6 個方向各用電路開一槍
  START_SLOTS: 3, MAX_SLOTS: 8, INV_SLOTS: 6,  // START_SLOTS 含武器格：開局 2 格晶片
  MECH_SLOT_EVERY: 0,       // 機體強化（零件每 1 層）每拿幾個，電路格 +1（0 = 關閉；10-08 關掉：旗艦改成電路插槽／零件格二選一，零件不再間接給電路格）
  RARE: { chance: 0.04, shop: 0.15, price: 2 },  // 稀有晶片：三選一每格晶片 chance、商店每件 shop 機率是稀有版，價錢 ×price；精英戰、寶藏的三選一保證一張
  MAX_CHIP_LV: 3,           // 玩法晶片等級上限（同種合成）；倍率見 LV_MUL
  GRAY: { share: 0.4, cap: 0.25, delay: 4, rate: 6 },  // 堡壘號・灰血：受傷的 40% 變成灰血（最多最大 HP 的 25%），4 秒沒被打開始回每秒 6；戰鬥結束時剩下的回滿
  DECOY: { t: 1.5, r: 400 },  // 幻影號・殘影：衝刺起點留殘影 1.5 秒，附近 400 內的敵人改打殘影
  UNLOCK_ALL: false,  // 局外成長（js/data/unlocks.js）：true = 全部開放（測試用，進度照樣記）；遊戲裡由設定頁「測試：全部解鎖」開關（Settings.unlockAll）；模擬預設 true，--locked 才上鎖（tests/load_game.js）
  TURRET: { t: 3, dmg: 0.5 },  // 哨兵號・砲台：衝刺起點留一座砲台 t 秒（每人同時一座），用那個人的整條電路朝射程內最近的敵人開火，傷害 ×dmg、射速跟飛船一樣
  PHASE: { dist: 150, t: 0.05 },  // 先鋒號・相位跳躍：衝刺改成瞬移 dist（穿牆、穿小行星，不落在裡面、不跳到別區）；瞬移後停 t 秒（算衝刺中，衝刺結束的效果照常）；無敵時間跟一般衝刺一樣是 DASH_TIME（以前只有 t：電腦用衝刺躲子彈，第 2 星區多死，整局模擬 2026-10-18）
  WORM_FAST: 0.8,  // 列隊蟲越短越快：只剩頭時速度 ×(1 ＋ 0.8)
  WORM_CUT: { gap: 66, t: 1 },  // 列隊蟲的身體離前一節超過 gap、中間被小行星或牆擋住 t 秒：斷開，自己當頭（頭會尋路，身體只會直線跟）
  WAVE_MUL: 1.4,            // 一波的敵人預算倍數（主題小兵加入後調）
  // 三選一的種類：同一個畫面、同一套程式（Game.openReward），差別只寫在這張表
  //   reroll／rerollUp：刷新第一次的價格、之後每次多多少（都照星區漲價）；slotCard：多一張「電路擴充（插槽 +1）」
  //   rare：保證幾格稀有晶片（刷新也保證）；after：選完之後回到哪個畫面（旗艦：勝利畫面的二選一；沒寫 = 航圖）
  REWARDS: {
    start:  { reroll: 15, rerollUp: 10, slotCard: false, rare: 0 },  // 從後面星區開始的章節：出發前的三選一
    combat: { reroll: 15, rerollUp: 10, slotCard: false, rare: 0 },
    elite:  { reroll: 30, rerollUp: 20, slotCard: true, rare: 1 },
    boss:   { reroll: 30, rerollUp: 20, slotCard: false, rare: 1, after: 'victory' },  // 擊沉旗艦：先三選一，再到勝利畫面
    event:  { reroll: 15, rerollUp: 10, slotCard: false, rare: 0 },  // ？事件節點給的三選一（漂流殘骸、黑市）
    eventPart: { reroll: 15, rerollUp: 10, slotCard: false, rare: 0, parts: true },  // 黑市的走私零件：三格都是零件
  },
  ELITE_ESCORT: 0.3,         // 精英戰最後一區（精英的場子）的護衛：一般一波預算的幾倍
  // 精英池（精英戰、精英亂入、沙盒從這裡抽）：from = 第幾星區開始出現、w = 權重；章節的 eliteW 再乘上去（CHAPTERS）
  ELITE_POOL: { elite: { from: 1, w: 1 }, artillery: { from: 1, w: 1 }, tractor: { from: 2, w: 1 }, wing: { from: 2, w: 1 } },
  // 砲艦：保持 keep[0]～keep[1] 的距離（比 flee 近就逃）；每 cd 秒蓄力 windup 秒後砲擊：n 發落點（第一發瞄準玩家前進的方向 lead 秒後的位置，其他散在 spread 內），
  //   delay 秒後爆炸（半徑 r、傷害 dmg）；被追到 near 以內每 shotCd 秒近身散射 shot 發（扇形 arc、速度 speed、傷害 sdmg）
  ARTILLERY: { keep: [420, 600], flee: 380, cd: 3, windup: 0.5, n: 3, lead: 0.5, spread: 150, delay: 1.2, r: 75, dmg: 22,
    near: 220, shotCd: 1.5, shot: 5, arc: 0.7, speed: 260, sdmg: 12 },
  // 拖曳艦：在 range[0]～range[1] 內、看得到目標時，鎖定 aim 秒（預警線）後用牽引光束拉 pull 秒（每秒把目標往牠拉 speed，拉到 stop 以內停）；
  //   目標衝刺、被擋住、離開 lose 以外就斷掉，自己暈 stun 秒；每 cd 秒一次。近身 near 以內每 shotCd 秒散射 shot 發
  TRACTOR: { stunBrake: 0.9, range: [140, 480], aim: 0.7, pull: 1.8, speed: 230, stop: 90, lose: 700, stun: 1, cd: 4.5,
    near: 200, shotCd: 1.6, shot: 7, arc: 0.9, bspeed: 260, bdmg: 12 },
  // 三艦編隊：3 艘繞著同一個中心轉（半徑 radius、每秒 spin 弧度；每少一艘轉速再 +lost），中心跟玩家保持 keep[0]～keep[1]、速度 speed；
  //   每 fireCd 秒每艘朝玩家射一發（速度 bspeed、傷害 bdmg；剩越少間隔越短：× (1 − fireLost × 少幾艘)）；
  //   每 crossCd 秒蓄力 windup 秒後交叉齊射：每艘朝玩家射一排 line 發（速度 lineSpd[0]～[1]）
  WING: { radius: 75, spin: 1.1, lost: 0.35, keep: [260, 380], speed: 75, fireCd: 1.5, fireLost: 0.2, bspeed: 240, bdmg: 12,
    crossCd: 5, windup: 0.6, line: 5, lineSpd: [200, 320] },
  // 寶藏無人機（ENEMY_TYPES.treasure）：一般戰鬥 chance 機率在隨機一區出現；不攻擊、往離玩家的反方向逃，life 秒沒打掉就躍遷離開
  //   離最近的玩家超過 near 時速度 ×farMul（跑太遠追不到）；blink：剩幾秒開始閃（快逃走了）；打掉的獎勵見 BONUS.treasure
  TREASURE: { chance: 0.2, life: 15, near: 450, farMul: 0.55, blink: 3 },
  // 蟲潮：一般戰鬥 chance 機率有一區全是蟲群：數量 ×count（照一般一波的預算）、血量 ×hp；每 clump 隻從同一個地方湧出（散開 jitter），間隔 gap 秒
  SWARM: { chance: 0.15, count: 1.6, hp: 0.5, gap: 0.05, clump: 8, jitter: 70 },
  // 精英亂入：3 區的一般戰鬥 chance 機率在第 2 區以後的隨機一區，敵人剩 at 以下（照這一區出場的數量）時闖進一隻帶詞綴的精英；打掉的獎勵見 BONUS.intrude
  INTRUDE: { chance: 0.15, at: 0.5 },
  // 警戒（分區的一般戰、精英戰）：敵人出場後在出生點附近 wander 內慢慢晃（速度 ×slow），不追、不開火；
  //   離最近的玩家 see 以內、或被打到就開始追，並叫醒身邊 call 以內還在待機的同伴（被叫醒的不再往外叫）；
  //   mark：剛發現玩家時頭上「!」顯示幾秒。不待機的：表上 awake（寶藏無人機）、精英亂入、旗艦戰、沙盒、靶場
  ALERT: { see: 450, call: 250, wander: 70, slow: 0.35, mark: 1 },
  // 警報艇（ENEMY_TYPES.alarm）：分區的戰鬥第 from 區以後每一區 chance 機率放 1 隻；被打到開始響、往遠離玩家的方向逃（速度 flee），
  //   delay 秒後開始每 every 秒叫醒身邊 r 以內待機的敵人（邊逃邊叫），一直響到被打掉；倒數內打掉就完全不會叫
  ALARM: { chance: 0.3, from: 2, delay: 1.5, every: 0.5, r: 400, flee: 170 },
  // 戰鬥中額外打到的稀有晶片保證：這場的三選一多保證 rare 格（同一場可以疊），note 寫在三選一上
  BONUS: { treasure: { again: 1, note: '寶藏到手' }, intrude: { again: 1, note: '擊敗亂入的精英' }, sos: { again: 1, note: '回應求救訊號' } },  // 戰鬥中拿到的額外獎勵：打贏後多 again 次三選一
  // ？事件節點（EVENTS，見 data/events.js）的數字：每張航圖 count 個（第 2～5 層；最少 count[0]、最多 count[1]，產生時優先挑有 2 個以上的；每條路線還是要有 3 場戰鬥）
  //   wreck 漂流殘骸：搜刮扣最大 HP 的 hp 換晶片三選一；core 拆反應爐 chance 機率三選一 1 ＋ again 次，不然扣 hp
  //   market 黑市（價格都隨星區上漲）：◆price 換三選一 1 ＋ again 次，這一局最大 HP ×(1 − hpCut)；◆part 零件三選一；
  //     box 神祕包裹 ◆price：chip 機率一個晶片，其他空包
  //   sos 下一場一般戰鬥或精英戰變難（全隊）：敵人數量 ×mul；打贏 bonus（CFG.BONUS）或 again 多幾次三選一（每個人照自己選的）
  //     full 全力救援、escort 只護送（求救訊號）、caught 被發現（星圖情報強行破解失敗，沒有獎勵）
  //   ward 終焉護殼：裝上 = 這一局一次受到致命傷害時留 1 HP、無敵 iframe 秒，受到的傷害 +taken；拆下核心 = 回復最大 HP 的 heal
  //   chart 星圖情報：強行破解 chance 機率標出 2 個寶藏星域
  EVENT: { count: [1, 3],
    wreck: { hp: 0.15, core: { chance: 0.5, again: 1, hp: 0.25 } },
    market: { price: 60, again: 1, hpCut: 0.1, part: 40, box: { price: 30, chip: 0.8 } },
    sos: { full: { mul: 1.3, bonus: 'sos' }, escort: { mul: 1.15, again: 1 }, caught: { mul: 1.3 } },
    ward: { taken: 0.1, iframe: 2, heal: 0.4 },
    chart: { chance: 0.6 } },
  // 雙人（隊友在線時）：敵人數量、血量的倍數隨難度增加（[難度 0, 難度 20]，中間線性，無盡模式停在最後的值）——兩個人的配裝一起疊，後期成長比單人快
  COOP_COUNT: [2, 2.5], COOP_HP: [1, 1.3],
  COOP_EXTRA: 0.6,  // 三、四人：在線的人每多一個（超過 2 人），敵人數量的倍數再 +0.6（血量不變；2026-10-18 使用者定，實際玩過再調）
  MEASURE_MIN: 10,  // 電路編輯器的實測 DPS：晶片裝上後戰鬥滿這麼多秒才顯示（太短的數字會亂跳）
  WEAPON_SOCKETS: 3, START_WSOCK: 1, MAX_SOCKETS: 3,  // 武器插座開局 1 個（第一次拿組件就有地方插）、每打完一隻王 +1、最多 3 個（沙盒、靶場直接 3 個）；掉落的晶片 1～3 個（見 rollSockets）
  MAX_TRIGGERS_PER_FRAME: 200,  // 同一幀最多處理的觸發次數（防止無限連鎖卡住）；子彈數量本身沒有上限
  HIT_PT: { per: 10, ring: 0.5 },  // 旗艦命中點（hitPts）：半徑每 per 一點，排在 ring 倍半徑的圓上、單數時中心多一點；重力井塌縮照罩到幾點算幾隻（使用者 10-22 定：照體型、只算數量不重複扣血）
  DEBUG_HIT: false,  // 除錯畫面：true = 畫出敵人、玩家的身體命中範圍和旗艦命中點（console 打 CFG.DEBUG_HIT = true）
  PROD_CAP: 300,  // 每個玩家場上最多幾個晶片的產物；超過的不再多放，改成讓這一批變大變痛（見 LINE_FX、lineShots；多人 4 人也撐得住）
  MIN_INTERVAL: 0.06,
  // 能量容量（2026-10-10 改成供電制，見 compileChain）：以前超過容量每 1 點射速 ×0.85，相刃不怕慢（整局 ×0.85 時相刃 40%、其他 8～25%）
  CAP_SINK: 2,              // 散熱片每層容量 +2
  MAGNET_RANGE: 140,
  PICKUP_DRAG: 0.92,  // 晶體飛向飛船時每幀（照 60fps）剩下的速度比例：像摩擦力，太大會繞著飛船轉、太小飛得慢（見 stepPickup）
  // 控制抗性（Enemy.ccDur／ccImmune／ccEnd）：CC[等級][控制種類] = { t: 控制最多幾秒（沒寫 = 照控制本身）, immune: 結束後幾秒不能再被同種控制 }
  //   等級：normal 一般、elite 精英、boss 旗艦（看 ENEMY_TYPES 的 elite／boss）。新的控制（暈眩、減速、吸引…）要有抗性就在這裡加一欄、呼叫同樣的方法
  CC: { elite: { hook: { t: 1.2, immune: 3 } } },  // hook：牽引鉤勾住（升級的勾住時間另外加）；10-23 精英以前可以一直被拎著
  //   控制抗性只套「讓敵人不能動、不能攻擊」的控制（會被一直連著鎖死的）；吸引（重力井、漩渦）、減速不套：敵人還能攻擊，吸怪是重力井的玩法（使用者 10-23 同意）
  //   現在的暈眩都在牽引鉤這條（拉在身前、甩出去飛行中），放開時開始 hook 的免疫，所以只需要 hook 一項
  ROOM_HIT: { push: 320, t: 0.2 },  // 多人房間：別人的子彈打到自己 → 往子彈方向推（速度 push、t 秒不吃操控）、閃白；不扣血（使用者 10-23 要加回來）
  BRAKE: 0.85,  // 敵人起手、蓄力時停下來的快慢：每幀（照 60fps）剩下的速度比例，越小停得越急；ENEMY_TYPES 的 brake 可以各自改（見 Enemy.brake）
  BULLET_CAP: { mine: 15000, enemy: 2000 },  // 子彈上限（防呆）：超過就刪最舊的，免得爆量卡死；碰到會記進遊玩紀錄。
  //   我方是實測（tests/perf/bulletcap.mjs，RTX 3070）：15000 顆一幀 26～28ms（雷射＋攔截最重），20000 顆掉到 30fps 以下；
  //   敵方照實際最多：旗艦戰站著挨打 90 秒最多 168 顆（第 6 星區終焉核心），2000 留給盾衛反彈我方子彈爆量（敵彈很便宜：40000 顆還有 19ms）
  AUTO_RANGE: 560,          // 手機自動攻擊的索敵距離
  ARC_RANGE: 260,           // 電弧（電擊線圈）找附近敵人的距離
  // 刺殼：距離 range 內開始縮球 windup 秒（最後 lock 秒鎖定方向）→ 以 rollSpeed 滾 rollT 秒 → 暈眩 stunT 秒 → 冷卻 cooldown 秒
  CHARGE: { elite: { speed: 800, t: 0.45 }, boss2: { speed: 760, t: 0.6 }, boss4: { speed: 700, t: 0.5 }, lurker: { speed: 520, t: 0.4 } },  // 衝鋒：速度、時間（預警線長度也照這個算，見 telegraphLen）
  BRUTE: { range: 350, windup: 0.7, lock: 0.3, rollSpeed: 520, rollT: 0.9, stunT: 1, cooldown: 1.5 },
  BOSS_KNOCK: 30,          // 推王：每超過抗擊退 1 點，每次命中推 30（王會慢慢拉回自己的速度）
  REPAIR_RATIO: 0.5,        // 維修站修復 50% 最大 HP
  SHOP_REPAIR: { price: 40, ratio: 0.2 },  // 補給站補血：回復最大 HP 的 20%，每間只能補一次
  SHOP_PRICE_UP: 0.35,      // 所有花晶體的價格 ×（1 ＋ 0.35 ×（星區 − 1）²），跟晶體收入的成長一樣（整局模擬實測）：第 2 星區 ×1.35、第 3 ×2.4、第 4 ×4.15；補給站、刷新獎勵、換零件
  SHOP_SLOT: 70,            // 補給站購買電路擴充（插槽 +1）
  ARMORY_BONUS: { credits: 30, hp: 20 },  // 武器已升滿時，軍械台改給的補償
  PLAYER_COLORS: ['#4cc9f0', '#ff9dbd', '#ffd166', '#9dff6b'],  // 雙人：1P～4P 各自的顏色（號碼標籤、船底光暈、隊友血條、小地圖、傷害結算；航圖投票標記見 style.css 的 .vote.v1～v4）
  REVIVE: { range: 70, time: 2, iframe: 1.5 },  // 雙人救援：活著的隊友待在倒下位置 70 內滿 2 秒；救起後無敵 1.5 秒
  VERSION: 'v0.1.3（2026-10-24 00:04）',  // 版號：標題、大廳、遊玩紀錄都會顯示；兩邊版號不同不讓連線
  // 無盡模式：每過一個星區（乘算）敵人攻擊 ×1.25、攻擊頻率 ×1.1、移動速度 ×1.05、血量 ×1.2（另外還有本來的每層血量成長）
  ENDLESS_DMG: 1.25, ENDLESS_ATK: 1.1, ENDLESS_SPD: 1.05, ENDLESS_HP: 1.2,
  BOSS_ORDER: ['boss', 'boss2', 'boss3', 'boss4', 'boss5'],  // 全部的旗艦（沙盒輪流、無盡模式隨機抽）；各章每個星區的王見 chapters.js
  // 雙子獵艦（boss4）：兩艘共用一條血，繞著同一個中心轉（半徑 orbit、每秒 spin 弧度，暴走 spinRage），中心每秒往最近的玩家飄 drift；
  //   兩艘都在隊形上（沒在衝鋒）時中間連著光束（寬 beamW，碰到受 beamDmg）；衝鋒見 CHARGE.boss4
  TWIN: { orbit: 230, spin: 0.65, spinRage: 1, drift: 45, beamW: 14, beamDmg: 24 },  // 10-19 加強（模擬比終焉核心不致命、拖比較久）：轉速 0.55／0.85、光束 18
  // 星環守門者（boss5）：核心在場地正中間不動；光束 beam 秒（2 條，暴走 3 條）、停 rest 秒，停的最後 warn 秒先畫細的預警線；
  //   光束跟著核心轉（每秒 spin 弧度，暴走 spinRage），寬 beamW、碰到受 beamDmg；核心每 ringCd 秒（暴走 ringCdRage）放一圈 ring 發
  //   4 座砲塔（WARDEN_TURRETS）繞在核心旁 turretR、各管一招，打掉那招就沒了；暴走時砲塔出招間隔 × rageCd
  WARDEN: { beam: 5, rest: 2, warn: 0.9, spin: 0.38, spinRage: 0.55, beamW: 16, beamDmg: 24, ringCd: 4, ringCdRage: 3, ring: 20, turretR: 110, rageCd: 0.7 },  // 10-19 加強：停 2.5、光束 20、環形彈 5／3.5 秒
  MAX_RECORDS: 50,          // 瀏覽器保留的遊玩紀錄筆數
};


const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const pickN = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const SHIELD_OUT = 13;  // 盾衛的盾外緣比身體多多少（畫面上的盾在 r+6～r+13）：子彈從盾那一側碰到這裡就反彈、飛船撞到就被彈開
const angleDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const mod = (v, m) => ((v % m) + m) % m;
// 射擊間隔倍率 → 說明文字：間隔 ×0.7 寫成「射速加快 1.43 倍」（紅），×1.3 寫成「射速變慢 1.3 倍」（綠）
const rateTxt = (m, pre = '') => m < 1
  ? `<span style='color:#ff6b6b'>射速${pre}加快 ${+(1 / m).toFixed(2)} 倍</span>`
  : `<span style='color:#7dff8a'>射速${pre}變慢 ${+m.toFixed(2)} 倍</span>`;
// 點 (px,py) 到線段 A→B 的最短距離平方：用來判定子彈「整段飛行路徑」有沒有碰到敵人
function segDist2(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return dist2(ax + dx * t, ay + dy * t, px, py);
}
// 顏色往白色混 k（0～1）；只認 #rgb／#rrggbb，其他格式原樣傳回
function mixWhite(c, k) {
  if (typeof c !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return c;
  const h = c.length === 4 ? c.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : c;
  let o = '#';
  for (let i = 1; i < 7; i += 2) o += Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, '0');
  return o;
}
function mixBlack(c, k) {  // 顏色往黑色混 k（0～1）；只認 #rgb／#rrggbb，其他格式原樣傳回
  const w = mixWhite(c, 0);
  if (!/^#[0-9a-f]{6}$/i.test(w)) return c;
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(w.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join('');
}

// 敵人血量倍率（難度 ＝ 層數 ＋（星區 − 1）× 7）：二次成長，後面的星區越來越硬，跟得上玩家疊起來的傷害
//   1 ＋ 0.1×難度 ＋ 0.01×難度² ＋（波次 − 1）× 0.08：第 1 星區 ×1.0～1.96、第 2 星區到 ×3.64、第 3 星區到 ×7.0
function enemyHpMul(level, wave = 1) { return 1 + level * 0.1 + level * level * 0.01 + (wave - 1) * 0.08; }
// 雙人倍數：[開頭, 第 3 星區最後（難度 20）] 之間照難度線性，超過 20（無盡）停在最後的值
function coopMul(pair, level) { return pair[0] + (pair[1] - pair[0]) * clamp(level / 20, 0, 1); }
// 多人的敵人數量倍數：n = 在線的人數（含房主）；2 人照 COOP_COUNT，每多 1 人 +COOP_EXTRA
function coopCount(level, n) { return coopMul(CFG.COOP_COUNT, level) + CFG.COOP_EXTRA * Math.max(0, n - 2); }
