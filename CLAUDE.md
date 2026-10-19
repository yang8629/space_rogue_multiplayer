# 星環電路 多人版（V2）

GitHub Pages 發佈。測試與模擬在 `tests/`。文件在 `docs/`：`進度.md`（兩台電腦接著做）、`版本紀錄.md`、`模擬.md`、`設計方向.md`。

## 檔案：只讀要改的

`index.html` 只有 HTML 骨架，依序載入 `js/**/*.js`（順序只寫在 index.html）。所有檔案共用同一個全域範圍，**function 宣告只在自己的檔案內提前**：檔案載入時就執行的程式碼不能呼叫後面檔案的函式。新增檔案放進對應資料夾並加到 index.html。

| 檔案 | 內容 |
|---|---|
| `js/core/config.js` | `CFG`（含版號 `VERSION`、`REWARDS` 三選一的種類）、亂數與幾何小工具、`rateTxt` |
| `js/core/events.js` | 事件 `Events.on`／`Events.emit` |
| `js/core/spatial.js` | 空間格子 `SpatialGrid`、`enemiesNear`、`IGrid`（攔截子彈） |
| `js/core/core.js` | 子彈格式 `shot()`、增幅相加、傷害歸屬 |
| `js/core/pipeline.js` | 電路執行 `compileChain`／`runOps`／`analyzeChain` |
| `js/core/main.js` | 啟動與主迴圈 |
| `js/data/weapons.js` | 5 把武器與升級樹 |
| `js/data/simvalue.js` | 武器升級價值表、路線價值表（`tests/exportvalue.js` 產生，不要手改） |
| `js/data/chips.js` | 晶片 `CHIPS`（玩法晶片的 `evo` 進化、`kill` 玩法擊殺、`actRate`、`force`）、組件升級的等級、稀有晶片 id、起始電路 |
| `js/data/parts.js` | 零件 `PARTS`、`mechStats` |
| `js/data/ships.js` | 5 艘飛船：開局零件＋專屬能力（先鋒號相位跳躍 `CFG.PHASE`、堡壘號灰血 `CFG.GRAY`、幻影號殘影 `CFG.DECOY`、星門號傳送門、哨兵號砲台 `CFG.TURRET`） |
| `js/data/chapters.js` | 章節、通關進度 |
| `js/data/unlocks.js` | 局外成長（解鎖）`UNLOCKS`、跨局進度、`isUnlocked`（`CFG.UNLOCK_ALL` 時全開） |
| `js/data/affixes.js` | 精英詞綴 `AFFIX` |
| `js/data/rares.js` | 稀有晶片的詞條 `RARE`（觸發時機、效果；各晶片的反擊寫在 `CHIPS[id].force`） |
| `js/data/map.js` | 航圖產生 |
| `js/game/entities.js` | `Player`、`Bullet`、`ENEMY_TYPES`、`Enemy`（精英詞綴 `setAffixes`／`affixTick`） |
| `js/game/objects.js` | 地圖物件 `Objects` |
| `js/game/arena.js` | 戰鬥場地 `Arena`（方形場地／大地圖、牆、閘門、尋路 `navTo` 只給模擬電腦用） |
| `js/game/game.js` | `Game`：流程、戰鬥、晶片效果、玩法擊殺、稀有詞條（`rareAct`）、零件、飛船能力（`tickMech`、`addDecoy`／`enemyTarget`、`addTurret`／`updateTurrets`）、三選一（`openReward`）、商店、改裝廠、主更新 |
| `js/game/range.js` | 靶場 |
| `js/game/hub.js` | 基地（主畫面，分區太空站）：配置 `hubLayout`（房間 `HUB_ROOMS`、開口、柱子、照飛船和武器數量排；加東西只改資料）、碰撞 `free`、開著飛船走 `Hub.update`、按 E `Hub.interact`、換船 `pick`、裝武器 `equip` |
| `js/game/effects.js` | 特效事件（只發事件；真正的特效在 `js/ui/fx.js`） |
| `js/system/input.js`／`audio.js`／`settings.js` | 輸入；音效、音樂；設定（`Settings`，設定頁是 `Screen.settings`） |
| `js/system/net.js` | 多人連線全部（大廳、同步、投票、重連、多人紀錄） |
| `js/ui/render.js` | HUD、小地圖、搖桿、靶場面板 |
| `js/ui/gl/` | 戰鬥畫面（WebGL／PixiJS）：`gl.js` 核心、`gl_world.js` 場地、`gl_hub.js` 基地（各房間的地板 `HUB_FLOOR`、擺設 `decorBuild`）、`gl_actors.js` 敵人與飛船、`gl_fx.js` 子彈與特效 |
| `js/ui/screens.js` | DOM 畫面（選單、航圖、獎勵、商店、結算、紀錄） |
| `js/ui/base.js` | 基地（主畫面）的 DOM：`Screen.title()`、上方列 `hubView`、說明卡 `hubInfo`、門後的面板 `basePanel`（軍械庫、晶片庫、戰績、發射台）、「新」標記 |
| `js/ui/listeners.js` | 聽事件：音效、畫面切換 |
| `js/ui/fx.js` | `FX`：粒子、浮動數字、光圈、電弧、橫幅、震動 |
| `js/ui/editor.js`／`codex.js`／`mechcheck.js` | 電路編輯器／電路總覽／機制檢查 |
| `css/style.css` | 樣式 |

用 Grep 找符號所在的檔案，再只讀那一段。

## 程式碼規則

1. **同類東西的差別寫在資料表，流程只查表**
   - 表裡放數值，行為不同就放函式（`CHIPS[id].apply`、`THEME_AI[type]`）。
   - 流程不寫 `if (kind === 'elite')`；新增一種只改表。
   - 現有的表：`CHIPS`、`PARTS`、`SHIPS`、`ENEMY_TYPES`、`AFFIX`、`CHAPTERS`、`CFG.REWARDS`。
2. **數字放 `CFG` 或資料檔，說明文字從數字產生**（畫面、總覽不寫死數字）。
3. **遊戲邏輯只發事件**，不直接呼叫音效、畫面。
4. **隊友那邊的敵人、子彈是同步來的資料**：畫面和房主隊友共用的程式只讀欄位，不呼叫方法。
5. **拿掉功能要拿乾淨**：說明、畫面、多人同步、模擬電腦、測試一起改，不留空殼函式。
6. **新機制要有機制檢查，並確認修之前會失敗。**
7. **有方向性的小工具在定義旁寫清楚方向**（`angleDiff(a, b)` = 從 a 轉到 b）。
8. **改了遊戲的名稱或欄位，同一個提交裡改好 `tests/`**，`node release.js` 全過才提交。
9. **註解用中文，寫為什麼**；說明文字（畫面、README）只寫現在的規則，舊的寫進 `docs/版本紀錄.md`。

## 跟使用者合作

- 跑模擬、判斷強弱之前先讀 `docs/模擬.md`；改玩法、設計新東西之前先讀 `docs/設計方向.md`。
- 一律用繁體中文；腳本用中文稱呼（chipmatrix → 晶片模擬表、runsim → 整局模擬、coopsim → 多人整局模擬、botsim --build → 自動對戰模擬）；遊戲叫「多人版」。
- 直接做，做完回報（選了哪些數字）；只有需要使用者決定的才先問（沒看過的新核心機制、改變遊戲感覺的取捨、拿掉功能、上傳）。一句話定的大機制先複述確認。
- 問問題時每個名稱都要說明（效果、在哪、跟什麼比）；只列自己推薦的選項。文字精簡，舉例用程式裡找得到的名字。
- 說「誤差範圍」，不說雜訊。比較表要寫每組幾局、數字是什麼。
- 檢查沒過：先查遊戲，證明遊戲對了才改檢查；回報寫出哪一項、內容是什麼（看 `tests/release_last.log`）。
- 改到畫面：用真的 Chrome（WebGL）截圖看過再回報；截圖放 `art_lab/screenshots/`（中文檔名，只留最新）。
- 每做完一步更新 `docs/進度.md`。

## 改完之後

1. 測試：在 `tests/` 跑 `node release.js`（所有測試＋機制檢查＋名字檢查＋私人資訊掃描＋版號／README，只印摘要、每項幾秒；同時跑最多 4 個，約 20 秒；完整結果在 `tests/release_last.log`）。第一次要先在 `tests/` 跑 `npm install`。
   - 名字檢查：`node undefcheck.js`（用了不存在的函式、變數；`--selftest` 測掃描本身）。個別：`smoke.js`、`range.js`、`e2e.js`（兩份遊戲互連）。
   - 看某幾項機制檢查：`node mc.js 迴旋 黏著`（不給關鍵字 = 只印沒過的）；偶發失敗：`node mcloop.js 名稱 --n=200`。
   - 模擬（整局、價值表、晶片模擬表…）的指令和規則：`docs/模擬.md`。
2. 規則改了就更新 `README.md`；還沒上傳的改動記在 `docs/版本紀錄.md` 的「（下一版）」那一行，版號先不動。
3. 平常只在本機提交，**不主動上傳**。git 不在 PATH 時，`release.js` 會去找 Program Files 裡的 git。
4. 上傳：`node release.js <新版號> --push`（例如 `2.16.0`）：改 `VERSION`、把「（下一版）」改名，全部檢查通過才提交並推上 GitHub。
5. 私人資訊掃描的額外字詞放本機 `tests/private_words.txt`（一行一個，不上傳）。
