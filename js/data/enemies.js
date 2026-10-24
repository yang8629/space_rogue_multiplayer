// 星環電路 多人版 · enemies.js：敵人種類 ENEMY_TYPES（數值、外形、旗艦的招式清單、說明）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   行為在 game/entities.js（Enemy）和 game/enemy_ai.js（各種敵人、精英、旗艦移動、砲塔的招式）
'use strict';

const ENEMY_TYPES = {
  swarmer: { name: '蟲群', hp: 18, speed: 150, radius: 10, dmg: 10, color: '#ff4d6d', credits: 1, shape: 3 },
  brute:   { name: '刺殼', brake: 0.8, hp: 130, speed: 65, radius: 22, dmg: 25, color: '#ff9f1c', credits: 4, shape: 6 },  // 靠近時縮成球滾過來（見 updateBrute）
  spitter: { name: '噴吐者', hp: 40, speed: 110, radius: 13, dmg: 10, color: '#f72585', credits: 2, shape: 4, syncCd: true,
    ranged: { range: 380, cd: 1.8, speed: 260, dmg: 12 } },
  // 精英（elite: true，行為在 ELITE_AI；出現機率 CFG.ELITE_POOL）：face = 畫面上船頭朝目標；noAffix = 不會抽到的詞綴
  elite:   { name: '虛空獵手', hp: 800, speed: 95, radius: 26, dmg: 30, color: '#ffd400', credits: 12, shape: 5, elite: true, face: true,
    desc: '蓄力衝鋒（有預警線）和兩圈錯開的環形彈輪流放。' },
  // 砲艦不抽護盾：牠會逃、被逼到牆邊就背貼牆，盾一直對著你又繞不到背後，只能慢慢磨（2026-10-19 使用者實玩）
  // 也不抽隱形：牠一直保持 420 以上的距離，隱形要靠近 200 內才現形 → 幾乎整場看不見、自動瞄準鎖不到
  artillery: { name: '砲艦', hp: 700, speed: 90, radius: 24, dmg: 25, color: '#ff8c42', credits: 12, shape: 6, elite: true, face: true, noAffix: ['shield', 'cloak'],   // 保持距離砲擊（CFG.ARTILLERY）
    desc: `跟你保持 ${CFG.ARTILLERY.keep[0]}～${CFG.ARTILLERY.keep[1]} 的距離，靠近就逃；每 ${CFG.ARTILLERY.cd} 秒砲擊 ${CFG.ARTILLERY.n} 個落點（紅圈 ${CFG.ARTILLERY.delay} 秒後爆炸，第一個瞄準你前進的方向）；被追到身邊會近身散射。不會抽到護盾、隱形詞綴。` },
  tractor: { name: '拖曳艦', hp: 850, speed: 85, radius: 25, dmg: 30, color: '#3fe0c5', credits: 12, shape: 4, elite: true, face: true,   // 牽引光束把你拉過去（CFG.TRACTOR）
    desc: `鎖定你 ${CFG.TRACTOR.aim} 秒（紅色預警線）後用牽引光束把你往牠拉 ${CFG.TRACTOR.pull} 秒；拉的時候衝刺就能掙脫（牠會暈 ${CFG.TRACTOR.stun} 秒），沒掙脫被拉到身邊就吃近身散射。` },
  // 三艦編隊：一次出 fleet 艘、共用一個編隊（CFG.WING）；晶體、亂入獎勵照艘數分；分裂（變 6 艘）、召喚（×3）、閃現（離隊）不抽
  wing:    { name: '編隊艦', group: '三艦編隊', hp: 300, speed: 0, radius: 15, dmg: 20, color: '#ff5ec4', credits: 4, shape: 3, elite: true, face: true, fleet: 3, idleAct: true,
    noAffix: ['split', 'summon', 'blink'],
    desc: `3 艘小艦繞著同一個中心轉、輪流朝你開火，每 ${CFG.WING.crossCd} 秒交叉齊射（預警線）；打掉一艘，剩下的重新排隊形、轉得更快、開火更密。詞綴三艘都有（不會抽到分裂、召喚、閃現）。` },
  // 主題小兵（每場隨機抽幾種，越後面越多，見 Game.pickThemes）
  gunboat:  { name: '彈幕艇', brake: 0.9, hp: 60, speed: 70, radius: 16, dmg: 10, color: '#ff6b9d', credits: 3, shape: 8 },    // 停在 420～520 外，每 3 秒放一圈 8 發慢速彈（先閃 0.6 秒；從 8 根砲管射出，砲塔慢慢轉）
  worm:     { name: '列隊蟲', hp: 35, speed: 130, radius: 9, dmg: 8, color: '#c0ff4d', credits: 1, shape: 4 },    // 6 節排成一列蛇行，後面的跟著前一節；頭死了下一節變成頭
  shield:   { name: '盾衛', hp: 110, speed: 55, radius: 20, dmg: 20, color: '#5ec8ff', credits: 4, shape: 6 },    // 出生時隨機決定盾的方向（120°），之後不轉；打到盾的子彈反彈回去（傷害 ×0.5，最多 25）
  splitter: { name: '分裂體', hp: 70, speed: 80, radius: 18, dmg: 15, color: '#ffb347', credits: 0, shape: 5 },   // 死掉時分成 3 隻碎裂體（本體不掉晶體，晶體都在碎裂體身上）
  splitling:{ name: '碎裂體', hp: 30, speed: 140, radius: 10, dmg: 8, color: '#ffb347', credits: 1, shape: 3 },  // 每隻掉 1 顆（一隻分裂體總共 3 顆，跟以前一樣）
  lurker:   { name: '潛伏者', brake: 0.8, hp: 40, speed: 120, radius: 12, dmg: 18, color: '#9d8cff', credits: 3, shape: 3 },   // 平常幾乎透明（有殘影），離 140 內現形 0.4 秒後撲過去
  hive:     { name: '母巢', hp: 300, speed: 0, radius: 30, dmg: 15, color: '#e05d2e', credits: 8, shape: 9, anchored: true, idleAct: true, syncCd: true },  // 不會動（anchored：不吃擊退、吸引拉不動，2026-10-10），每 4 秒生 2 隻蟲群（最多 8 隻；不掉晶體、不算玩法擊殺）；待機時也照生（生出來的在旁邊晃，idleAct）
  // 寶藏無人機（CFG.TREASURE）：不攻擊、沒有撞擊傷害、不掉晶體，往離玩家的反方向逃；打掉這場的三選一保證稀有晶片
  //   awake：沒有待機（出場就逃，見 CFG.ALERT）
  treasure:{ name: '寶藏無人機', hp: 156, speed: 230, radius: 18, dmg: 0, color: '#ffd166', credits: 0, shape: 4, treasure: true, awake: true },
  // 警報艇（CFG.ALARM）：不攻擊、沒有撞擊傷害，平常在出生點附近晃；被打到開始響、往遠離玩家的方向逃，邊逃邊叫醒身邊待機的敵人
  //   idleAct：待機時也照自己的行為（THEME_AI）動
  alarm:   { name: '警報艇', hp: 54, speed: 60, radius: 15, dmg: 0, color: '#ff3b3b', credits: 3, shape: 4, alarm: true, idleAct: true },
  // 靶場標靶：不會動、不攻擊、打不死（血量歸零就補滿），被擊退後會慢慢回到原位
  dummy:   { name: '標靶', hp: 5000, speed: 0, radius: 18, dmg: 0, color: '#9fb4ff', credits: 0, shape: 8, dummy: true },
  // 三隻旗艦：第 1～3 關依序出現，無盡模式隨機抽
  boss:    { name: '星噬母艦', hp: 2000, speed: 45, radius: 50, dmg: 35, color: '#ff4d6d', credits: 40, shape: 8, boss: true,
    knockResist: 1.5, shotMul: 0.85, rage: '母艦核心暴走', skills: ['spiral', 'fan', 'summon', 'ring', 'gather', 'share'],
    desc: '螺旋彈幕、扇形齊射、召喚蟲群、環形彈。' },
  boss2:   { name: '裂界獵艦', hp: 2800, speed: 80, radius: 42, dmg: 35, color: '#b388ff', credits: 40, shape: 3, boss: true, face: true,
    knockResist: 2.5, rage: '獵艦推進器過載', skills: ['charge', 'cross', 'snipe', 'charge', 'deploy', 'gather', 'share'], shotMul: 0.85,
    desc: '高速衝鋒（有預警線，衝鋒時往兩側灑彈）、旋轉十字彈流、三連狙擊、部署噴吐者。' },
  boss3:   { name: '終焉核心', hp: 3000, speed: 35, radius: 56, dmg: 40, color: '#2ee6a6', credits: 40, shape: 6, boss: true,
    knockResist: 3.5, rage: '核心臨界', skills: ['nova', 'twin', 'bomb', 'wall', 'guard', 'gather', 'share'], shotMul: 1.15,
    desc: '連續缺口環形波、雙向螺旋、落點轟炸、慢速彈牆、召喚刺殼護衛。' },
  // 章節專屬的王：twin = 一次出兩艘、共用一條血（CFG.TWIN）；beams = 旋轉光束、turrets = 身邊的砲塔（CFG.WARDEN）；center = 出現在場地正中間
  boss4:   { name: '雙子獵艦', hp: 3000, speed: 80, radius: 34, dmg: 30, color: '#7c9cff', credits: 40, shape: 3, boss: true, face: true, twin: true,
    knockResist: 2.5, rage: '雙子同步過載', skills: ['charge', 'fan', 'snipe', 'deploy', 'gather', 'share'], shotMul: 1.6,  // 子彈 ×1.6：10-20 整局模擬（第二章 3-7，66 場）加強光束、出招後陣亡 14%（終焉核心 26%），扣血主要來自子彈；×1.2 → 17%、×1.6 → 21%
    desc: `兩艘共用一條血，繞著同一個中心轉，中間連著光束（碰到受傷；一艘衝鋒時光束斷掉）；輪流衝鋒、兩艘一起扇形齊射、狙擊、部署噴吐者。` },
  boss5:   { name: '星環守門者', hp: 3200, speed: 0, radius: 54, dmg: 40, color: '#ffb86b', credits: 40, shape: 8, boss: true, anchored: true, center: true, beams: true,
    syncCd: true, knockResist: 99, rage: '守門者全開', skills: ['pulse', 'gather', 'share'], shotMul: 1, turrets: ['wt_aim', 'wt_ring', 'wt_bomb', 'wt_call'],
    desc: `待在場地正中間不動：旋轉光束掃過全場（開之前有細的預警線；暴走後 3 條），核心定時放環形彈；身邊 4 座砲塔各管一招（瞄準射擊、環形彈、轟炸、召喚蟲群），打掉一座那招就沒了。` },
  // 星環守門者的砲塔：跟著核心轉（anchored，不吃擊退）；turret = 出招間隔 cd 秒（出什麼招在 game/enemy_ai.js 的 TURRET_FIRE）
  wt_aim:  { name: '瞄準砲塔', hp: 450, speed: 0, radius: 20, dmg: 20, color: '#ff8a5c', credits: 0, shape: 6, anchored: true,
    turret: { cd: 1.8 } },
  wt_ring: { name: '環形砲塔', hp: 450, speed: 0, radius: 20, dmg: 20, color: '#ffd166', credits: 0, shape: 6, anchored: true,
    turret: { cd: 3 } },
  wt_bomb: { name: '轟炸砲塔', hp: 450, speed: 0, radius: 20, dmg: 20, color: '#ff5a5a', credits: 0, shape: 6, anchored: true,
    turret: { cd: 3.4 } },
  wt_call: { name: '召喚砲塔', hp: 450, speed: 0, radius: 20, dmg: 20, color: '#c77dff', credits: 0, shape: 6, anchored: true,
    turret: { cd: 6 } },
};
