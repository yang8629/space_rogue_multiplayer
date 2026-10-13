# 章節框架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「一局固定星區 1～3」改成「章節」：每章自訂星區範圍、各星區的王、敵人強度倍率、開局補償與劇情文字；章節照順序解鎖、進度存在瀏覽器；單人與雙人都能選章。先用現有 3 個星區、3 隻王排出 3 章。

**Architecture:** 新檔 `js/data/chapters.js` 放章節資料與進度存取（純資料＋幾個小函式）。`Game` 多一個 `chapterId`，原本寫死 `CFG.CAMPAIGN_SECTORS` 的地方全部改問 `Game.chapter()`／`Game.lastSector()`；`Game.sector` 照舊是「真正的星區編號」，難度公式（`level = L + (sector − 1) × 7`）、主題小兵、商店價格都不動。第一章的設定必須跟目前的遊戲完全一樣。

**Tech Stack:** 原生 JavaScript（全域腳本，載入順序見 `index.html`）、`localStorage`、PeerJS（雙人）。沒有建置流程，沒有 Node 測試（`mp_tests` 不在這台電腦上）；自動檢查用遊戲內建的機制檢查 `MechCheck`（`js/ui/mechcheck.js`），在瀏覽器裡跑。

**Spec:** 本對話的結論（沒有獨立 spec 檔）：章節制、每章重複使用星區、換王與強度；先做框架，用現有內容排 2～3 章，玩過再決定要不要投資新王。

## Global Constraints

- 所有寫進檔案的文字（註解、畫面文字、README）用繁體中文，跟現有程式碼一樣的口語寫法。
- 第一章 = 星區 1～3、王依序 `boss`／`boss2`／`boss3`、倍率 1、沒有開局補償：玩起來必須跟改之前一模一樣。
- 不改難度公式 `enemyHpMul`、`coopMul`、`pickThemes`、`shopMul`；章節只能「再乘一個倍率」。
- 靶場、沙盒（`Game.freePlay()`）不受章節影響。
- 進度存在 `localStorage` 的 `v2_chapters`，讀寫都包 `try/catch`（跟現有 `RECORDS_KEY` 一樣）；讀不到就當成只開第一章。
- 機制檢查跑的模擬局不能寫入章節進度（`MechCheck.running` 時跳過）。
- 版號：完成後 `CFG.VERSION` 升到 `mp-2.15.0（<日期時間>）`，用獨立的「mp-2.15.0：版號更新」commit（照專案慣例）。
- Commit 訊息用中文，結尾加：
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. **玩家選了第三章之後跑機制檢查**：既有 118 項都假設從星區 1 開始。期望：機制檢查結果跟選第一章時一樣 → Task 1 讓 `MechCheck.setup` 固定用第一章，並在 Task 1 的檢查裡驗證。
2. **舊存檔／壞掉的 `v2_chapters`**（不是 JSON、`cleared` 不是陣列、有不存在的章號）：期望只開第一章、不報錯 → Task 1「章節進度」檢查涵蓋。
3. **第三章從星區 2 開始，開局補償的三選一做到一半就按 Tab／重新整理（雙人）**：期望補償次數不會重複給，也不會卡在獎勵畫面 → Task 2 的檢查涵蓋「選完 3 次回到航圖」；雙人重連照現有重連流程（配裝以房主記住的為準），Task 4 的手動驗證涵蓋。
4. **無盡模式的分界**：第三章最後是星區 3，星區 4 起才是無盡；`endlessK()` 要從章節的最後星區算起 → Task 1「章節設定」涵蓋。
5. **雙人兩邊章節不一致**（隊友收到不存在的章號、舊版隊友沒送章號）：期望一律退回第一章，兩邊以房主為準 → Task 4 的 `cleanChapter` 與手動驗證涵蓋。

---

## 檔案結構

| 檔案 | 動作 | 負責 |
|---|---|---|
| `js/data/chapters.js` | 新增 | `CHAPTERS` 資料、`chapterById`、`chapterProgress`、`chapterUnlocked`、`markChapterCleared` |
| `index.html` | 改 | 在 `js/data/ships.js` 後面載入 `chapters.js` |
| `js/core/config.js` | 改 | 拿掉 `CAMPAIGN_SECTORS`（改由章節決定） |
| `js/game/game.js` | 改 | `chapterId`、`chapter()`、`lastSector()`、`bossFor`、`isEndless`、開局星區與補償、倍率、通關記進度、紀錄欄位 |
| `js/game/entities.js` | 改 | `endlessK()` 從章節最後星區算 |
| `js/ui/screens.js` | 改 | 章節選擇畫面、航圖標題、勝利畫面、開局補償的獎勵標題、紀錄文字 |
| `js/system/net.js` | 改 | 大廳選章、`pick`／`start`／`resume` 帶章號、隊友的開局補償 |
| `js/ui/mechcheck.js` | 改 | `setup` 固定第一章；新增「章節」分組檢查 |
| `js/ui/codex.js` | 改 | 「遠征流程」說明改成章節 |
| `README.md` | 改 | 新增「章節」段落、版本紀錄 |

## 驗證方式（每個 Task 共用）

1. 起本機伺服器（背景跑，整個計劃只要起一次）：
   ```bash
   cd ~/Desktop && python3 -m http.server 8765 --bind 127.0.0.1
   ```
2. 用 chrome-devtools MCP 開 `http://127.0.0.1:8765/space_rogue_multiplayer/index.html`，每次改完先 `navigate_page` 重新整理（`type: "reload"`, `ignoreCache: true`）。
3. 看 console 沒有錯誤：`list_console_messages`，不能有 `error`。
4. 跑機制檢查（`evaluate_script`）：
   ```js
   () => { const r = MechCheck.runAll(); return { total: r.list.length, fail: r.list.filter(x => !x.ok).map(x => `${x.group}/${x.name}：${x.got}`), chapter: r.list.filter(x => x.group === '章節').map(x => `${x.ok ? '✓' : '✗'} ${x.name}：${x.got}`) }; }
   ```

### Task 0：基準線

- [ ] **Step 1：記下改之前的機制檢查結果**

照「驗證方式」起伺服器、開頁面、跑第 4 步。把 `total` 和 `fail` 清單貼進執行紀錄。README 說有幾項偶發失敗（約 1/25～1/30），所以之後每個 Task 的判準是「`fail` 沒有比基準線多出新項目」；同一項偶發失敗就重跑一次確認。

Expected：`total` 118（README 最新版本紀錄的數字），`chapter` 是空陣列。

---

### Task 1：章節資料、Game 介面、拿掉 `CAMPAIGN_SECTORS`

**Files:**
- Create: `js/data/chapters.js`
- Modify: `index.html:99`（`ships.js` 那一行後面）
- Modify: `js/core/config.js:53`、`js/core/config.js:56` 的註解
- Modify: `js/game/game.js:77`、`:127-128`、`:248`、`:607`、`:627`、`:846`
- Modify: `js/game/entities.js:572`
- Modify: `js/ui/screens.js:377`、`:519`、`:532`、`:607`
- Modify: `js/ui/codex.js:307-308`
- Modify: `js/ui/mechcheck.js:16`（`setup` 開頭）、`CASES` 陣列最後

**Interfaces:**
- Produces（後面的 Task 都用這些名字）：
  - `CHAPTERS`：`[{ id, name, sectors: [first, last], bosses: { [sector]: bossId }, hp, dmg, start: null | { credits, wSock, slots, picks }, intro, outro }]`
  - `chapterById(id) → chapter`（找不到回第一章）
  - `chapterProgress() → number[]`（已通關的章號）
  - `chapterUnlocked(id) → boolean`
  - `markChapterCleared(id) → void`
  - `CHAPTER_KEY = 'v2_chapters'`
  - `Game.chapterId`（number，預設 1）、`Game.chapter()`、`Game.lastSector()`

- [ ] **Step 1：先寫檢查（會失敗）**

在 `js/ui/mechcheck.js` 的 `CASES` 陣列最後一項（`]` 前）加：

```js
    ['章節', '章節設定', '第一章 = 星區 1～3、三隻王照順序、倍率 1（跟改之前一樣）；每章從自己的第一個星區開始、王照章節設定；打完最後一個星區之後才是無盡（無盡強度從那裡開始算）', M => {
      const out = [];
      let ok = true;
      for (const ch of CHAPTERS) {
        Game.chapterId = ch.id;
        Game.newRun('run', 'vanguard', 'laser');
        const [a, b] = ch.sectors, secs = Array.from({ length: b - a + 1 }, (_, i) => a + i);
        const startOk = Game.sector === a && Game.bossId === ch.bosses[a];
        const bossOk = secs.every(s => Game.bossFor(s) === ch.bosses[s]);
        Game.sector = b; const lastOk = !Game.isEndless() && endlessK() === 0;
        Game.sector = b + 1; const endOk = Game.isEndless() && endlessK() === 1 && CFG.BOSS_ORDER.includes(Game.bossFor(b + 1));
        const good = startOk && bossOk && lastOk && endOk;
        ok = ok && good;
        out.push(`${ch.name}${good ? '' : ' ✗'}：星區 ${a}～${b}${startOk ? '' : '（開局星區或王不對）'}${bossOk ? '' : '（各星區的王不對）'}${lastOk && endOk ? '' : '（無盡分界不對）'}`);
      }
      const c1 = chapterById(1);
      const same = c1.sectors[0] === 1 && c1.sectors[1] === 3 && c1.hp === 1 && c1.dmg === 1 && !c1.start &&
        [1, 2, 3].every(s => c1.bosses[s] === CFG.BOSS_ORDER[s - 1]);
      Game.chapterId = 1;
      return { ok: ok && same, got: out.join('；') + (same ? '；第一章跟改之前一樣' : '；第一章跟改之前不一樣（錯誤）') };
    }],
    ['章節', '章節倍率', '敵人血量 × 章節的 hp、飛船受到的傷害 × 章節的 dmg（第一章都是 1）', M => {
      const probe = id => {
        Game.chapterId = id;
        Game.newRun('run', 'vanguard', 'laser');
        Game.bonusPicks = 0;  // 開局補償的三選一不影響這項
        Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.startCombat({ level: 1, wavesTotal: 1, elites: 0 });
        Game.combat.wave = 1; Game.spawnEnemy('swarmer');
        const e = Game.enemies[Game.enemies.length - 1], p = Game.player;
        p.invuln = false; p.iframe = 0; p.shield = 0;
        const hp0 = p.hp; Game.hurtPlayer(10, 'mc');
        return { ehp: e.maxHp, taken: hp0 - p.hp };
      };
      const base = probe(1), out = [];
      let ok = true;
      for (const ch of CHAPTERS.slice(1)) {
        const r = probe(ch.id), hpK = r.ehp / base.ehp, dmgK = r.taken / base.taken;
        const good = near1(hpK, ch.hp) && near1(dmgK, ch.dmg);
        ok = ok && good;
        out.push(`${ch.name}：血量 ×${hpK.toFixed(2)}（應為 ${ch.hp}）、受傷 ×${dmgK.toFixed(2)}（應為 ${ch.dmg}）${good ? '' : ' ✗'}`);
      }
      Game.chapterId = 1;
      return { ok, got: out.join('；') };
    }],
    ['章節', '章節進度', '只開第一章；通關第 N 章開第 N+1 章；存檔壞掉（不是 JSON、cleared 不是陣列、有奇怪的值）當成只開第一章；機制檢查的模擬局不寫進度', M => {
      let saved = null;
      try { saved = localStorage.getItem(CHAPTER_KEY); } catch (e) {}
      const put = v => { try { if (v == null) localStorage.removeItem(CHAPTER_KEY); else localStorage.setItem(CHAPTER_KEY, v); } catch (e) {} };
      const out = [];
      try {
        put(null);
        const fresh = chapterUnlocked(1) && !chapterUnlocked(2);
        out.push(fresh ? '新存檔只開第一章' : '新存檔不對（錯誤）');
        markChapterCleared(1);
        const next = chapterUnlocked(2) && !chapterUnlocked(3) && chapterProgress().join() === '1';
        markChapterCleared(1);
        const once = chapterProgress().length === 1;
        out.push(next && once ? '通關第一章開第二章（重複通關不重複記）' : '通關後解鎖不對（錯誤）');
        const bad = ['{', '{"cleared":5}', '{"cleared":["x",null,2.5]}', 'null'].every(v => { put(v); return chapterProgress().length === 0 && chapterUnlocked(1) && !chapterUnlocked(2); });
        out.push(bad ? '壞掉的存檔當成只開第一章' : '壞掉的存檔處理不對（錯誤）');
        put(null);
        Game.chapterId = 1; Game.newRun('run', 'vanguard', 'laser');
        Game.sector = Game.lastSector(); Game.node = { type: 'boss', L: 6, id: 'mc' }; Game.bossId = Game.bossFor(Game.sector);
        Game.combatWon();
        const noWrite = chapterProgress().length === 0;
        out.push(noWrite ? '模擬局沒有寫進度' : '模擬局寫進了進度（錯誤）');
        return { ok: fresh && next && once && bad && noWrite, got: out.join('；') };
      } finally { put(saved); Game.chapterId = 1; }
    }],
    ['章節', '機制檢查固定第一章', '玩家選了別章再跑機制檢查：setup 一律從第一章的星區 1 開始', M => {
      Game.chapterId = CHAPTERS[CHAPTERS.length - 1].id;
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const ok = Game.chapterId === 1 && Game.sector === 1;
      return { ok, got: `setup 之後：第 ${Game.chapterId} 章、星區 ${Game.sector}` };
    }],
```

> `endlessK`（`entities.js:572`）、`near1`（`mechcheck.js` 底部）是現有的全域函式。

- [ ] **Step 2：跑檢查，確認失敗**

照「驗證方式」重新整理並跑第 4 步。
Expected：`chapter` 4 項都是 `✗`，`got` 是「執行錯誤：CHAPTERS is not defined」之類。

- [ ] **Step 3：新增 `js/data/chapters.js`**

```js
// 星環電路 雙人版 · chapters.js：章節（每章重複使用星區，換王、換強度）與章節進度
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// CHAPTERS — 一章 = 一趟遠征：從 sectors[0] 打到 sectors[1]，打完可以繼續無盡模式
//   sector 是真正的星區編號（難度、主題小兵、商店價格都照它算），章節只決定從哪打到哪、每個星區的王
//   hp：敵人血量再 ×；dmg：飛船受到的傷害再 ×（都乘在原本的難度上）
//   start：從星區 2 以後開始的章節，補上前面星區大概會拿到的東西（晶體、武器插座、電路格、幾次三選一）
//   ponytail: 章節內容先用現有 3 個星區、3 隻王排；有新星區、新王再加進來
// =====================================================================
const CHAPTERS = [
  { id: 1, name: '第一章　突破封鎖', sectors: [1, 3], bosses: { 1: 'boss', 2: 'boss2', 3: 'boss3' }, hp: 1, dmg: 1, start: null,
    intro: '星環邊境被封鎖了。一路往內打，找出封鎖的源頭。',
    outro: '終焉核心停止運轉，封鎖解除了。但獵艦的殘骸不見了——它們還會回來。' },
  { id: 2, name: '第二章　獵艦反撲', sectors: [1, 3], bosses: { 1: 'boss2', 2: 'boss', 3: 'boss3' }, hp: 1.15, dmg: 1.1, start: null,
    intro: '裂界獵艦帶著更強的艦隊回來了，這次它們搶先一步守在入口。',
    outro: '核心再次被擊沉。殘骸裡的訊號指向星環更深處。' },
  { id: 3, name: '第三章　深入星環', sectors: [2, 3], bosses: { 2: 'boss', 3: 'boss3' }, hp: 1.25, dmg: 1.15,
    start: { credits: 60, wSock: 1, slots: 1, picks: 3 },
    intro: '直接跳進星環內側。外圍已經打通，沒有時間慢慢準備了。',
    outro: '訊號的源頭就在更深處……（待續）' },
];
const CHAPTER_KEY = 'v2_chapters';  // 章節進度存在瀏覽器的名稱：{ cleared: [已通關的章號] }

function chapterById(id) { return CHAPTERS.find(c => c.id === id) || CHAPTERS[0]; }
// 已通關的章號；存檔壞掉（不是 JSON、格式不對）就當成都沒通關
function chapterProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(CHAPTER_KEY) || '{}');
    return p && Array.isArray(p.cleared) ? p.cleared.filter(n => CHAPTERS.some(c => c.id === n)) : [];
  } catch (e) { return []; }
}
// 第一章一開始就能玩；之後每章要先通關前一章
function chapterUnlocked(id) { return id === CHAPTERS[0].id || chapterProgress().includes(id - 1); }
function markChapterCleared(id) {
  const c = chapterProgress();
  if (c.includes(id)) return;
  c.push(id);
  try { localStorage.setItem(CHAPTER_KEY, JSON.stringify({ cleared: c })); } catch (e) {}
}
```

- [ ] **Step 4：`index.html` 載入**

`index.html` 第 99 行 `<script src="js/data/ships.js"></script>` 後面加一行：

```html
<script src="js/data/chapters.js"></script>
```

- [ ] **Step 5：`config.js` 拿掉 `CAMPAIGN_SECTORS`**

刪掉第 53 行：
```js
  CAMPAIGN_SECTORS: 3,     // 固定三關；打完可選擇繼續無盡模式
```
第 56 行註解改成：
```js
  BOSS_ORDER: ['boss', 'boss2', 'boss3'],  // 全部的旗艦（沙盒輪流、無盡模式隨機抽）；各章每個星區的王見 chapters.js
```

- [ ] **Step 6：`game.js` 的章節介面**

`game.js:77` 原本：
```js
    this.node = null; this.visited = []; this.sector = 1; this.bossId = this.bossFor(1);
```
改成：
```js
    this.chapterId = this.chapterId || 1;  // 選章畫面（或雙人的房主）先設好；靶場、沙盒也照設，但用不到
    this.node = null; this.visited = []; this.sector = this.freePlay() ? 1 : this.chapter().sectors[0]; this.bossId = this.bossFor(this.sector);
```

`game.js:126-128` 原本：
```js
  // 前三關依序打三隻不同的旗艦；無盡模式（第 4 關起）隨機抽
  bossFor(sector) { return sector <= CFG.CAMPAIGN_SECTORS ? CFG.BOSS_ORDER[sector - 1] : pick(CFG.BOSS_ORDER); },
  isEndless() { return this.sector > CFG.CAMPAIGN_SECTORS; },
```
改成：
```js
  // 章節：這一局從哪個星區打到哪個星區、每個星區的王（見 chapters.js）；打完最後一個星區之後是無盡模式，王隨機抽
  chapter() { return chapterById(this.chapterId); },
  lastSector() { return this.chapter().sectors[1]; },
  bossFor(sector) { return this.chapter().bosses[sector] || pick(CFG.BOSS_ORDER); },
  isEndless() { return this.sector > this.lastSector(); },
```

`game.js:248`（`spawnEnemy` 的 `scale`）原本最後一段：
```js
      (this.isEndless() ? Math.pow(CFG.ENDLESS_HP, this.sector - CFG.CAMPAIGN_SECTORS) : 1);  // 無盡：每個星區血量再 ×1.2（乘算）
```
改成：
```js
      (this.isEndless() ? Math.pow(CFG.ENDLESS_HP, this.sector - this.lastSector()) : 1) *  // 無盡：每個星區血量再 ×1.2（乘算）
      (C.sandbox ? 1 : this.chapter().hp);  // 章節：敵人血量再 ×（第一章 1）
```

`game.js:607-609` 原本：
```js
    this.showMap(this.sector === CFG.CAMPAIGN_SECTORS + 1
```
改成：
```js
    this.showMap(this.sector === this.lastSector() + 1
```

`game.js:627` 原本：
```js
    this.saveRecord(this.sector >= CFG.CAMPAIGN_SECTORS ? 'cleared' : 'retired');
```
改成：
```js
    this.saveRecord(this.sector >= this.lastSector() ? 'cleared' : 'retired');
```

`game.js:846` 原本：
```js
    if (this.isEndless()) dmg *= Math.pow(CFG.ENDLESS_DMG, this.sector - CFG.CAMPAIGN_SECTORS);  // 無盡：每過一個星區，受到的傷害 ×1.25（乘算）
```
改成：
```js
    if (this.isEndless()) dmg *= Math.pow(CFG.ENDLESS_DMG, this.sector - this.lastSector());  // 無盡：每過一個星區，受到的傷害 ×1.25（乘算）
    if (!this.freePlay()) dmg *= this.chapter().dmg;  // 章節：受到的傷害再 ×（第一章 1）
```

`combatWon` 裡旗艦分支，`game.js:340` `if (this.runStats) this.runStats.bosses.push(...)` 後面加：
```js
      if (this.sector === this.lastSector() && !MechCheck.running) markChapterCleared(this.chapterId);  // 打完這章最後一隻王：記下通關、開下一章（雙人兩邊各自記）
```

- [ ] **Step 7：`entities.js:572`**

原本：
```js
const endlessK = () => Game.mode === 'run' || Game.mode === 'coop' ? Math.max(0, Game.sector - CFG.CAMPAIGN_SECTORS) : 0;
```
改成：
```js
const endlessK = () => Game.mode === 'run' || Game.mode === 'coop' ? Math.max(0, Game.sector - Game.lastSector()) : 0;
```

- [ ] **Step 8：`screens.js` 換掉 `CAMPAIGN_SECTORS`**

`screens.js:377`：
```js
      <div class="between"><div><h2>${Game.isEndless() ? `無盡模式 · 星區 ${Game.sector}` : `星區 ${Game.sector} / ${CFG.CAMPAIGN_SECTORS}`} · 航圖</h2>
```
改成：
```js
      <div class="between"><div><h2>${Game.isEndless() ? `無盡模式 · 星區 ${Game.sector}` : `${Game.chapter().name} · 星區 ${Game.sector} / ${Game.lastSector()}`} · 航圖</h2>
```

`screens.js:519`：
```js
    const cleared = Game.sector === CFG.CAMPAIGN_SECTORS;  // 剛打完第三關：遠征完成
```
改成：
```js
    const cleared = Game.sector === Game.lastSector();  // 剛打完這章最後一個星區：章節完成
```

`screens.js:531-533` 的 `cleared` 分支原本：
```js
      ? `<h1 style="color:#ffd166;text-shadow:0 0 18px #ffd166">遠征完成！</h1>
        <div class="sub">${boss.name}已被擊沉，${CFG.CAMPAIGN_SECTORS} 個星區全部突破。<br>${reward}<br>
```
改成：
```js
      ? `<h1 style="color:#ffd166;text-shadow:0 0 18px #ffd166">${Game.chapter().name}　完成！</h1>
        <div class="sub">${boss.name}已被擊沉。<br><i style="color:#c8d4ff">${Game.chapter().outro}</i><br>${reward}<br>
```

`screens.js:607`：
```js
    const result = Game.state === 'dead' ? 'dead' : Game.sector >= CFG.CAMPAIGN_SECTORS ? 'cleared' : 'in_progress';
```
改成：
```js
    const result = Game.state === 'dead' ? 'dead' : Game.sector >= Game.lastSector() ? 'cleared' : 'in_progress';
```

- [ ] **Step 9：`codex.js:307-308` 說明文字**

原本兩行：
```js
      ${R('遠征流程', `遠征共 ${CFG.CAMPAIGN_SECTORS} 關（星區），每關 7 層，最後一層是守關旗艦，每關的旗艦都不同：<br>${bosses}<br>
        打完第 ${CFG.CAMPAIGN_SECTORS} 關算遠征完成，可以選擇結束（存下通關紀錄），或帶著目前的電路繼續<b>無盡模式</b>：星區一直往下，敵人持續變強，旗艦從三隻裡隨機出現。<br>
```
改成：
```js
      ${R('遠征流程', `遠征分成章節，每章打一段星區（每個星區 7 層，最後一層是守關旗艦）。通關一章開下一章；後面的章節會換王、敵人更強，有的從比較後面的星區開始（開局先補晶體、插座和幾次三選一）：<br>
        ${CHAPTERS.map(c => `<b>${c.name}</b>：星區 ${c.sectors[0]}～${c.sectors[1]}，${Object.entries(c.bosses).map(([s, id]) => `星區 ${s} ${ENEMY_TYPES[id].name}`).join('、')}${c.hp !== 1 ? `，敵人血量 ×${c.hp}、受到的傷害 ×${c.dmg}` : ''}`).join('<br>')}<br>
        打完一章可以選擇結束（存下通關紀錄），或帶著目前的電路繼續<b>無盡模式</b>：星區一直往下，敵人持續變強，旗艦從三隻裡隨機出現。<br>
```
`codex.js:305` 的 `const bosses = ...` 這時候沒人用了，刪掉。`codex.js:236` 的 `CFG.BOSS_ORDER[pt.s - 1]` 不動（那是數值圖表照星區畫的旗艦，跟章節無關）。

- [ ] **Step 10：`MechCheck.setup` 固定第一章**

`mechcheck.js` `setup(mode, ship, weapon, ...)` 的第一行 `Game.newRun(mode, ship, weapon);` 前面加：
```js
    Game.chapterId = 1;  // 既有檢查都假設從第一章的星區 1 開始（玩家選了別章也一樣）
```

- [ ] **Step 11：確認沒有漏掉的 `CAMPAIGN_SECTORS`**

Run: `grep -rn CAMPAIGN_SECTORS js index.html`
Expected：沒有輸出。

- [ ] **Step 12：跑檢查，確認通過**

照「驗證方式」重新整理、看 console、跑第 4 步。
Expected：`chapter` 4 項全 `✓`（「章節倍率」那項的第三章會顯示「血量 ×1.25、受傷 ×1.15」）；`fail` 跟 Task 0 的基準線一樣；console 沒有 error。

- [ ] **Step 13：手動看第一章跟以前一樣**

用 chrome-devtools 點「開始遠征」→ 選飛船 → 武器 → 起始晶片。航圖標題顯示「第一章　突破封鎖 · 星區 1 / 3 · 航圖」，守關旗艦是星噬母艦。`take_screenshot` 存證。

- [ ] **Step 14：Commit**

```bash
git add js/data/chapters.js index.html js/core/config.js js/game/game.js js/game/entities.js js/ui/screens.js js/ui/codex.js js/ui/mechcheck.js
git commit -m "$(cat <<'EOF'
章節框架：章節資料與進度、星區範圍與王照章節、章節倍率；拿掉 CAMPAIGN_SECTORS；機制檢查加「章節」4 項

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2：開局補償（從星區 2 以後開始的章節）

**Files:**
- Modify: `js/game/game.js`（`newRun` 結尾、`showMap` 開頭、新增 `applyChapterStart`、`openStartPick`）
- Modify: `js/ui/screens.js:406-407`（獎勵畫面標題）
- Modify: `js/ui/mechcheck.js`（`CASES` 最後加一項）

**Interfaces:**
- Consumes：`Game.chapter()`、`CHAPTERS[i].start`（Task 1）
- Produces：
  - `applyChapterStart(L, start)`：全域函式，`L` 是有 `chain`、`wSock` 的物件（`Game` 自己或雙人的隊友配裝），只加電路格和武器插座
  - `Game.bonusPicks`（number）：還剩幾次開局三選一
  - `Game.reward.kind === 'start'`：開局三選一

- [ ] **Step 1：先寫檢查（會失敗）**

`mechcheck.js` `CASES` 最後加：

```js
    ['章節', '開局補償', '有開局補償的章節：開局晶體、武器插座、電路格照設定加上去；先連續選完幾次三選一（跳過也算一次）才到航圖；第一章沒有補償', M => {
      const out = [];
      Game.chapterId = 1; Game.newRun('run', 'vanguard', 'laser');
      const plain = Game.state === 'map' && Game.credits === 0 && Game.wSock === CFG.START_WSOCK && Game.chain.length === CFG.START_SLOTS;
      out.push(plain ? '第一章：直接到航圖、沒有補償' : `第一章不對（錯誤）：${Game.state}、◆${Game.credits}、插座 ${Game.wSock}、電路 ${Game.chain.length}`);
      const ch = CHAPTERS.find(c => c.start);
      if (!ch) return { ok: false, got: '沒有任何章節有開局補償（錯誤）' };
      const S = ch.start;
      Game.chapterId = ch.id; Game.newRun('run', 'vanguard', 'laser');
      const given = Game.credits === S.credits && Game.wSock === CFG.START_WSOCK + S.wSock && Game.chain.length === CFG.START_SLOTS + S.slots;
      out.push(given ? `${ch.name}：◆${S.credits}、插座 +${S.wSock}、電路 +${S.slots}` : `${ch.name} 補償不對（錯誤）：◆${Game.credits}、插座 ${Game.wSock}、電路 ${Game.chain.length}`);
      let screens = 0;
      for (let i = 0; i < S.picks + 2 && Game.state === 'reward'; i++) {
        if (Game.reward.kind !== 'start') break;
        screens++;
        Game.takeReward(null);  // 跳過（◆ +10）也算用掉一次
        if (Game.state === 'editor') Game.toggleEditor();
      }
      const picksOk = screens === S.picks && Game.state === 'map' && Game.bonusPicks === 0;
      out.push(picksOk ? `連續 ${screens} 次三選一後到航圖` : `三選一次數不對（錯誤）：出現 ${screens} 次，最後在 ${Game.state}`);
      Game.chapterId = 1;
      return { ok: plain && given && picksOk, got: out.join('；') };
    }],
```

- [ ] **Step 2：跑檢查，確認失敗**

Expected：「開局補償」✗（第三章的晶體、插座、電路都是初始值，三選一出現 0 次）。

- [ ] **Step 3：實作**

`game.js` 在 `const Game = {` 之前（檔案前段、其他全域小函式旁邊）加：

```js
// 章節的開局補償：電路格、武器插座（晶體和三選一另外給，見 newRun）；L 是 Game 自己或雙人隊友的配裝
function applyChapterStart(L, S) {
  if (!S) return;
  for (let i = 0; i < (S.slots || 0) && L.chain.length < CFG.MAX_SLOTS; i++) L.chain.push(null);
  L.wSock = Math.min(CFG.WEAPON_SOCKETS, (L.wSock || CFG.START_WSOCK) + (S.wSock || 0));
}
```

`newRun` 裡 `this.refreshWeapon();  // 內含 recalc()` 這一行的**前面**加：

```js
    const ST = this.freePlay() ? null : this.chapter().start;  // 章節的開局補償（從星區 2 以後開始的章節）
    applyChapterStart(this, ST);
    this.credits += ST ? ST.credits || 0 : 0;
    this.bonusPicks = ST ? ST.picks || 0 : 0;  // 開局先連續三選一幾次（到航圖之前，見 showMap）
```

`showMap(toast = '')` 開頭（`this.inArena = false; this.state = 'map';` 之前）加：

```js
    if (this.bonusPicks > 0) { this.bonusPicks--; this.openStartPick(); return; }  // 章節的開局補償：先選完三選一才到航圖
```

`showMap` 後面新增方法：

```js
  // 章節的開局補償：一般戰鬥的三選一（晶片或零件），選完（或跳過）回到 showMap，次數用完才真的到航圖
  openStartPick() {
    this.inArena = false;
    this.reward = { kind: 'start', options: this.rewardOptions(), bonus: 0, reroll: this.shopPrice(15), slot: false };
    this.state = 'reward';
    this.view();
  },
```

`screens.js:406` 標題原本：
```js
      <div class="between"><div><h2>${R.kind === 'elite' ? '☠ 精英擊破：背包模組' : '⚔ 戰鬥勝利：三選一（晶片或零件）'}</h2>
```
改成：
```js
      <div class="between"><div><h2>${R.kind === 'elite' ? '☠ 精英擊破：背包模組' : R.kind === 'start' ? `🚀 出發準備：三選一（還有 ${Game.bonusPicks} 次）` : '⚔ 戰鬥勝利：三選一（晶片或零件）'}</h2>
```

- [ ] **Step 4：跑檢查，確認通過**

Expected：「開局補償」✓，got 類似「第一章：直接到航圖、沒有補償；第三章　深入星環：◆60、插座 +1、電路 +1；連續 3 次三選一後到航圖」；其他項跟 Task 1 結束時一樣。

- [ ] **Step 5：手動看一次**

console 先執行 `Game.chapterId = 3`（這時候選章畫面還沒做），再點「開始遠征」走到起始晶片。Expected：先出現 3 次「🚀 出發準備」三選一，標題的剩餘次數從 2 數到 0，之後到航圖，標題「第三章　深入星環 · 星區 2 / 3」。`take_screenshot` 存證。

- [ ] **Step 6：Commit**

```bash
git add js/game/game.js js/ui/screens.js js/ui/mechcheck.js
git commit -m "$(cat <<'EOF'
章節：從星區 2 以後開始的章節有開局補償（晶體、武器插座、電路格、連續三選一）；機制檢查加「開局補償」

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3：單人選章畫面、章節開場文字、紀錄帶章節

**Files:**
- Modify: `js/ui/screens.js:308`（標題按鈕）、`:74-103`（`data-act` 分派）、新增 `chapterSelect()`
- Modify: `js/game/game.js:668`（`buildRecord` 的欄位）、`newRun` 的 `this.showMap()`（單人開場文字）
- Modify: `js/ui/screens.js:654`（`recordText` 第 1 行）

**Interfaces:**
- Consumes：`CHAPTERS`、`chapterUnlocked`、`chapterProgress`、`Game.chapterId`（Task 1）
- Produces：`Screen.chapterSelect()`；`data-act="chapter"`；遊玩紀錄多 `chapter` 欄位（number）

- [ ] **Step 1：標題按鈕改去選章**

`screens.js:308`：
```js
        <button class="big" data-act="select" data-arg="run">開始遠征</button>
```
改成：
```js
        <button class="big" data-act="chapters">開始遠征</button>
```

- [ ] **Step 2：`data-act` 分派**

`screens.js` 的 `switch (a)` 裡，`case 'select': Screen.select(arg); break;` 前面加：

```js
      case 'chapters': Screen.chapterSelect(); break;
      case 'chapter': if (chapterUnlocked(+arg)) { Game.chapterId = +arg; Screen.select('run'); } break;
```

- [ ] **Step 3：選章畫面**

`screens.js` 在 `select(mode) {` 前面加：

```js
  // 開始遠征 → 先選章節（沒解鎖的灰掉、寫解鎖條件；通關過的打勾）
  chapterSelect() {
    const done = chapterProgress();
    const cards = CHAPTERS.map(c => {
      const open = chapterUnlocked(c.id), cleared = done.includes(c.id);
      const bosses = Object.entries(c.bosses).map(([s, id]) => `<span style="color:${ENEMY_TYPES[id].color}">♛ ${ENEMY_TYPES[id].name}</span>`).join('　');
      return `<div class="card" style="border-color:${open ? '#4cc9f0' : '#2a3460'};${open ? '' : 'opacity:.5'}">
        <div class="ttl">${c.name}${cleared ? ' <span style="color:#9dff6b">✓ 已通關</span>' : ''}</div>
        <div class="ty">星區 ${c.sectors[0]}～${c.sectors[1]}${c.hp !== 1 ? `　·　敵人血量 ×${c.hp}、受到的傷害 ×${c.dmg}` : ''}</div>
        <div class="ds">${open ? c.intro : `通關「${chapterById(c.id - 1).name}」後解鎖`}<br>${bosses}${c.start ? `<br><span style="color:#ffd166">開局補償：◆${c.start.credits}、武器插座 +${c.start.wSock}、電路 +${c.start.slots}、三選一 ×${c.start.picks}</span>` : ''}</div>
        <button data-act="chapter" data-arg="${c.id}" ${open ? '' : 'disabled'}>${open ? '選這章' : '未解鎖'}</button></div>`;
    }).join('');
    this.show(`<div class="scr pick">
      <div class="between"><div><h2>選擇章節</h2>
        <div class="sub">每章打一段星區，最後一個星區的旗艦擊沉就算通關，開啟下一章。打完可以繼續無盡模式。</div></div>
        <button data-act="title" data-back>返回 (Esc)</button></div>
      <div class="cards left">${cards}</div></div>`);
  },
```

選飛船畫面的「返回」目前回標題（`data-act="title"`），保留不改：從選飛船按返回就回標題，不用回到選章。

- [ ] **Step 4：單人開場文字**

`newRun` 最後一行：
```js
    else this.showMap();
```
改成：
```js
    else this.showMap(`${this.chapter().name}：${this.chapter().intro}`);
```
（有開局補償時，這個提示會在三選一選完、真的到航圖時才出現：`showMap` 遞迴回來時 `toast` 已經是空字串。這是可以接受的：開局補償的標題已經講了章節。）

- [ ] **Step 5：紀錄帶章節**

`game.js:668` 原本：
```js
      sector: this.sector, layer: this.node ? this.node.L + 1 : 0, endless: this.isEndless(),
```
改成：
```js
      chapter: this.chapterId, sector: this.sector, layer: this.node ? this.node.L + 1 : 0, endless: this.isEndless(),
```

`screens.js:654`（`recordText` 第 1 行）裡的
```js
${r.endless ? '無盡' : ''}${r.sector}-${r.layer}
```
改成：
```js
${r.chapter > 1 ? `第${r.chapter}章 ` : ''}${r.endless ? '無盡' : ''}${r.sector}-${r.layer}
```
（舊紀錄沒有 `chapter`，`undefined > 1` 是 false，照舊顯示。）

雙人的紀錄由 `Net.buildRecord` 組（`net.js:787` 一帶 `...base`），`base` 來自 `Game.buildRecord`，會自動帶到，不用另外改；Step 7 驗證。

- [ ] **Step 6：跑檢查**

照「驗證方式」第 1～4 步。Expected：`chapter` 5 項全 ✓、`fail` 跟基準線一樣、console 沒有 error。

- [ ] **Step 7：手動走一次選章流程**

先在 console 清進度：`localStorage.removeItem('v2_chapters')`，重新整理。
1. 標題按「開始遠征」→ 選章畫面：第一章可選，第二、三章灰掉、寫「通關『…』後解鎖」。截圖。
2. console 執行 `markChapterCleared(1); Screen.chapterSelect()` → 第一章打勾、第二章可選。截圖。
3. 選第二章 → 飛船 → 武器 → 起始晶片 → 航圖標題「第二章　獵艦反撲 · 星區 1 / 3」、守關旗艦是裂界獵艦、畫面有開場文字提示。截圖。
4. 在航圖按 Esc／選單離開（或 console 執行 `Game.quitRun()`）→ 標題「📜 遊玩紀錄」最上面那筆的複製文字開頭有「第2章 1-0」。
5. 結束後 console 執行 `localStorage.removeItem('v2_chapters')` 還原。

- [ ] **Step 8：Commit**

```bash
git add js/ui/screens.js js/game/game.js
git commit -m "$(cat <<'EOF'
章節：開始遠征先選章（照通關進度解鎖）、開場與通關文字、遊玩紀錄記章節

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4：雙人選章

**Files:**
- Modify: `js/system/net.js`：`lobbyStatus`（`:183-191`）、`beginPick`（`:551`）、`case 'pick'`（`:464`）、`startHost`（`:610`）、`startClient`（`:613`）、`makeLoadout`（`:589`）、`resumePayload`（`:345`）、`applyResume`（`:381`）、新增 `chapter`、`cleanChapter`
- Modify: `js/ui/screens.js` 的 `switch (a)`（加 `netchapter`）

**Interfaces:**
- Consumes：`CHAPTERS`、`chapterById`、`chapterUnlocked`、`applyChapterStart`、`Game.chapterId`（Task 1、2）
- Produces：`Net.chapter`（房主選的章號，預設 1）；`Net.cleanChapter(n) → number`；`pick`／`start`／`resume` 訊息多 `chapter` 欄位

- [ ] **Step 1：`Net` 的章號與驗證**

`net.js` 的 `const Net = {` 物件裡（`cleanPick(m) {` 前面）加：

```js
  chapter: 1,  // 房主在大廳選的章節（隊友照房主的）
  cleanChapter(n) { return CHAPTERS.some(c => c.id === n) ? n : 1; },  // 對方傳來的章號：不認得的（或舊版沒送）當第一章
```

- [ ] **Step 2：大廳讓房主選章**

`lobbyStatus` 裡房主那段原本：
```js
         <div class="row"><button class="big" data-act="netstart" ${this.mateInRoom ? '' : 'disabled'}>開始（選擇配裝）</button></div>`
```
改成：
```js
         <div class="row">${CHAPTERS.map(c => chapterUnlocked(c.id)
           ? `<button data-act="netchapter" data-arg="${c.id}" style="${this.chapter === c.id ? 'border-color:#ffd166;color:#ffd166' : ''}">${c.name}</button>`
           : `<button disabled title="通關「${chapterById(c.id - 1).name}」後解鎖">${c.name}</button>`).join('')}</div>
         <div class="row"><button class="big" data-act="netstart" ${this.mateInRoom ? '' : 'disabled'}>開始（選擇配裝）</button></div>`
```
（章節照**房主**的進度解鎖。）

`screens.js` 的 `switch (a)` 裡 `case 'netstart': Net.beginPick(); break;` 後面加：

```js
      case 'netchapter': if (chapterUnlocked(+arg)) { Net.chapter = +arg; Net.lobbyStatus(); } break;
```

- [ ] **Step 3：選配裝時送章號**

`beginPick()` 原本：
```js
    this.send({ t: 'pick' });
    this.enterPick();
```
改成：
```js
    Game.chapterId = this.chapter;
    this.send({ t: 'pick', chapter: this.chapter });
    this.enterPick();
```

`net.js:464` 原本：
```js
      case 'pick': if (this.role === 'client' && Game.state === 'lobby') this.enterPick(); break;
```
改成：
```js
      case 'pick': if (this.role === 'client' && Game.state === 'lobby') { Game.chapterId = this.cleanChapter(m.chapter); this.enterPick(); } break;
```

`startHost()` 裡：
```js
    this.send({ t: 'start', ...me, map: this.packMap(Game.map), bossId: Game.bossId, runId: this.runId });
```
改成：
```js
    this.send({ t: 'start', ...me, map: this.packMap(Game.map), bossId: Game.bossId, runId: this.runId, chapter: Game.chapterId });
```

`startClient(m)` 裡 `Game.newRun('coop', me.ship, me.weapon, me.chip);` 前面加：
```js
    Game.chapterId = this.cleanChapter(m.chapter);  // 以房主為準（pick 時已經設過，這裡再保險一次）
```

- [ ] **Step 4：房主那邊的隊友配裝也給開局補償**

`makeLoadout(p)` 裡 `L.wp = weaponParams(L.weapon);` 前面加：
```js
    applyChapterStart(L, Game.chapter().start);  // 章節的開局補償（電路格、武器插座）；隊友自己的晶體和三選一在隊友那邊給，回到航圖時配裝會同步過來
```

- [ ] **Step 5：斷線重連帶章號**

`resumePayload()` 的
```js
      map: this.packMap(G.map), sector: G.sector, bossId: G.bossId, node: G.node ? G.node.id : null, visited: G.visited,
```
改成：
```js
      map: this.packMap(G.map), chapter: G.chapterId, sector: G.sector, bossId: G.bossId, node: G.node ? G.node.id : null, visited: G.visited,
```

`applyResume(m)` 的 `if (!soft) {` 區塊裡，原本：
```js
      G.newRun('coop', this.myPick.ship, this.myPick.weapon, null);
```
改成：
```js
      G.chapterId = this.cleanChapter(m.chapter);
      G.newRun('coop', this.myPick.ship, this.myPick.weapon, null);
      G.bonusPicks = 0;  // 重新連線回到進行中的一局：開局補償已經在房主記住的配裝裡，不再給一次（newRun 會重設，所以放在它後面）
```

`applyResume` 的 `G.map = map; G.sector = clamp(num(m.sector, 1), 1, 99); G.bossId = m.bossId;` 那行前面加：
```js
    G.chapterId = this.cleanChapter(m.chapter);
```

- [ ] **Step 6：跑檢查**

照「驗證方式」第 1～4 步。Expected：跟 Task 3 結束時一樣（雙人沒有自動檢查）。

- [ ] **Step 7：手動驗證雙人（兩個分頁）**

需要網路（PeerJS 連線伺服器）。先在 console 執行 `markChapterCleared(1); markChapterCleared(2)` 讓第三章可選。
1. 分頁 A 開房，分頁 B 加入。A 的大廳出現三個章節按鈕，選「第三章」（按鈕變金色），截圖。
2. A 按開始 → 兩邊各自選飛船、武器、起始晶片。Expected：兩邊都先出現 3 次「🚀 出發準備」三選一，選完到航圖，標題都是「第三章　深入星環 · 星區 2 / 3」，守關旗艦都是星噬母艦。兩邊各截圖。
3. 兩邊都到航圖後，用 `evaluate_script` 比對：B 的 `Game.chain.length`、A 的 `Game.mate.L.chain.length` 都等於 `CFG.START_SLOTS + 1`；B 的 `Game.wSock`、A 的 `Game.mate.L.wSock` 都等於 `CFG.START_WSOCK + 1`。
4. 另開一局，讓 A 先選完開局三選一、B 還停在三選一：A 在航圖投票。Expected：跟一般戰鬥後「一人還在選獎勵」的情況一樣（B 畫面最上面出現提醒、投票照現有規則），不會卡住或讓 B 跳過剩下的三選一。截圖。
5. B 重新整理，選「雙人連線」輸入同一房號回來 → 直接回到航圖（不會再出現開局三選一），標題還是第三章。截圖。
6. 結束後兩個分頁都執行 `localStorage.removeItem('v2_chapters')` 還原。

做不到（沒網路、PeerJS 連不上）就照實記錄「雙人未驗證」，不要寫成完成。

- [ ] **Step 8：Commit**

```bash
git add js/system/net.js js/ui/screens.js
git commit -m "$(cat <<'EOF'
章節：雙人由房主在大廳選章（照房主進度解鎖），開局、重新連線都帶章號；隊友配裝也給開局補償

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5：README、版號

**Files:**
- Modify: `README.md`（「模式」表、新增「章節」段落、「版本紀錄」、「接下來」）
- Modify: `js/core/config.js`（`VERSION`）

- [ ] **Step 1：README**

1. 「模式」表的「開始遠征」改成：`單人：先選章節（照通關進度解鎖），每章打一段星區，打完可選無盡模式`。
2. 在「## 航圖與獎勵」前面新增：

```markdown
## 章節

開始遠征先選章節。每章打一段星區（每個星區 7 層，最後一層是旗艦），擊沉最後一個星區的旗艦就算通關，開啟下一章。通關進度存在這台裝置的瀏覽器（`v2_chapters`）。

| 章節 | 星區 | 旗艦 | 敵人血量 | 受到的傷害 | 開局補償 |
|---|---|---|---|---|---|
| 第一章　突破封鎖 | 1～3 | 星噬母艦 → 裂界獵艦 → 終焉核心 | ×1 | ×1 | 無 |
| 第二章　獵艦反撲 | 1～3 | 裂界獵艦 → 星噬母艦 → 終焉核心 | ×1.15 | ×1.1 | 無 |
| 第三章　深入星環 | 2～3 | 星噬母艦 → 終焉核心 | ×1.25 | ×1.15 | ◆60、武器插座 +1、電路 +1、出發前三選一 ×3 |

- 星區編號照舊決定難度、主題小兵和商店價格；章節的倍率再乘上去。
- 打完一章可以繼續無盡模式（從這章最後一個星區之後算起）。
- 雙人：房主在大廳選章（照房主的通關進度），兩人一起通關時各自記進度。
```

3. 「版本紀錄」表最上面加一列 `| mp-2.15.0 | **章節**：…（照上面寫一句摘要）；機制檢查 118 → 123 項（加「章節」5 項）。 |`（實際項數以 Task 4 結束時 `total` 為準）。
4. 「接下來」加一行：`- 章節：玩過再決定章數、倍率和開局補償；之後加新星區、新王排第四章以後。`
5. README 開頭「目前版本」改成新版號。

- [ ] **Step 2：版號**

`config.js` 的 `VERSION` 改成 `'mp-2.15.0（<今天日期 時間，例 2026-10-13 18:00>）'`，README「目前版本」用同一個字串。

- [ ] **Step 3：最後跑一次全部檢查**

照「驗證方式」第 1～4 步。Expected：`total` = 基準線 + 5、`fail` 跟基準線一樣、console 沒有 error；標題畫面最下方顯示新版號（截圖）。

- [ ] **Step 4：Commit（兩個）**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
README：章節

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
git add js/core/config.js README.md
git commit -m "$(cat <<'EOF'
mp-2.15.0：版號更新

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

不 push（push 會更新 GitHub Pages 上的線上版，要另外問過）。

---

## 執行紀錄（2026-10-13）

- Task 0～3 完成（commit `5a67b15`、`bbcfa07`、`531fd9d`）：機制檢查 118 → 123 項，0 項失敗，console 沒有 error；選章、第二章、第三章開局補償都實際點過一次。Task 4（雙人）、Task 5（README、版號）當時還沒做。
- **2026-10-13 18:21 全部完成並上線**：Task 4 `f1bcb54`（照下方「雙人的決定與結果」）；之後多人改成 2～4 人（`5aefeaa`、`b353920`、`6f44553`，章節解鎖改成「所有人都解鎖」）；Task 5 `a562591`（README 章節段落、版本紀錄）、`cc82505`（mp-2.15.0 版號）；已 push，GitHub Pages 部署完成。這份計劃結案。
- 還沒做（不屬於這份計劃）：章節的數值（倍率、第三章的開局補償夠不夠）要實際玩過再調。
- 跟計劃不一樣的地方：
  - 「章節倍率」檢查：`p.invuln` 是 getter，改成設 `p.iframe = 0; p.dashT = 0`。
  - `Game` 物件宣告 `chapterId: 1`、`bonusPicks: 0`：機制檢查的 `runAll` 只還原原本就有的欄位，沒宣告的話跑完檢查，玩家選的章會被洗成 1。
  - `newRun`：`mode !== 'run'` 就固定第一章（雙人選章還沒做；靶場、沙盒本來就用不到章節）。
  - 開局三選一：上一次的結果（第一次是章節開場文字）顯示在下一個三選一的標題下面（`reward.note`），計劃原本會把這段文字吞掉。
  - 圖鑑「遠征流程」：保留三隻王的說明（計劃原本整段刪掉）。
  - 遊玩紀錄列表（不只是複製文字）也顯示「第 N 章」。

## 雙人的決定與結果（2026-10-13）

yang 的決定：
1. **兩人都解鎖的章節才能選**：隊友在 `welcome`、每局回到房間（`backToRoom`）時送 `prog`（自己的通關進度），房主存在 `Net.mateCleared`；章節按鈕用 `chapterOk`，灰掉的寫是誰沒解鎖。
2. **只記這一章**（`markChapterCleared(id)` 不改）：兩人都解鎖才能選，所以不會跳章。
3. **重新整理時完整保留剩下的開局三選一**：隊友每開一次開局三選一就送 `lo`（多 `bp` = 剩下幾次，含正在選的那次），房主存在 `mate.L.bonusPicks`，resume 時傳回去。`makeLoadout` 一開始就替隊友記上補償的晶體和次數。順便修了沒重新整理的斷線重連：原本會呼叫 `showMap`，跳到下一次三選一而少選一次。
4. **隊友在大廳看得到房主選的章**：房主切章或收到 `prog` 時送 `chap`。

實測（兩個 headless 分頁，`127.0.0.1` 當房主、`localhost` 當隊友，localStorage 分開；PeerJS 實際連線）：上面 4 項，加上「房主選完投票、隊友還在選 → 房主等待、倒數沒開始」、隊友重新整理重連、隊友沒重新整理的斷線重連、兩人投票後一起出發、第一章雙人直接到航圖，都照預期。**沒測**：雙人實際打完最後一隻王記進度（`combatWon` 兩邊都會跑，單人已驗證寫入）。

## 雙人待處理（2026-10-13 先做單人，Task 4 延後；已照上面的決定處理）

單人（Task 0～3）先做；雙人在 Task 4 做之前**一律固定第一章**（`newRun` 裡 `mode !== 'run'` 就把 `chapterId` 設成 1），以免玩家單人選過別章、再開雙人時房主和隊友的章節不一樣。做 Task 4 時要一起處理：

1. **重新整理會吃掉剩下的開局三選一**：`applyResume` 走非 soft 的路徑時設 `G.bonusPicks = 0`，所以隊友選到一半重新整理，剩下的次數就沒了；房主還沒收到隊友配裝同步的話，60 晶體和已經選的東西也可能不見（重連時晶體以房主記的 `Y.credits` 為準）。要嘛把這寫成可以接受的取捨，要嘛把 `bonusPicks` 也放進 resume payload。
2. **隊友跳章記進度**：隊友沒通關第二章，但跟房主一起通關第三章，`cleared` 會變成 `[3]`。`chapterUnlocked` 只看 `id - 1`，所以隊友的第二章還是鎖著。`markChapterCleared(id)` 要改成把 `1..id` 全部記上。
3. **一人選完開局三選一、另一人還在選時投票**：這是唯一新增的狀態組合，雙人沒有自動檢查，Step 7.4 要最優先手動驗證。
4. **隊友的開局補償晶體**：`makeLoadout` 只補電路格和插座；房主那邊記住的 `L.credits` 不含隊友的 60 晶體，要靠隊友的配裝同步帶過去。這件事要驗證。

## 不在這份計劃裡（之後再做）

- 新星區、新王（第四章以後）、章節專屬的主題小兵比例或地圖物件。
- 局外貨幣、母艦、局間劇情事件。
- 章節內的星區二選一。
- 整局模擬（`mp_tests`，不在這台電腦上）照章節跑通關率：倍率先用估的，實際玩過或有模擬再調。
