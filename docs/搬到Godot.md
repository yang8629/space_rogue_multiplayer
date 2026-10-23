# 搬到 Godot（還沒開始，語言還沒定）

設計方向：之後要搬 Godot（不是取消），現在邏輯照「發事件、不直接呼叫畫面」寫，方便搬（`docs/設計方向.md`、`docs/架構.md`）。下面是 10-21 量的參考數字。

## 環境（Mac）

- Godot 4.7.2 一般版（`/Applications/Godot.app`）、.NET 版（`/Applications/Godot_mono.app`）、.NET SDK 10.0.402（`~/.dotnet`，免 sudo 裝的；Homebrew 的 `dotnet-sdk` 要 sudo 密碼裝不了）。
- C# 專案用 Godot 執行時載入的是 Debug 組件：`dotnet build -c Release` 編出來的 Godot 找不到類別，會印錯誤後**不結束**（要自己加逾時；macOS 沒有 `timeout`，用 `perl -e 'alarm 120; exec @ARGV'`）。

## 效能量測（10-21）

同一套簡化運算：子彈移動＋撞邊＋壽命＋敵人 200 隻的空間格子 3×3 碰撞，300 幀平均，三邊命中數一致。

| 子彈數 | JS（node，V8） | GDScript | C#（Optimize 開） |
|---|---|---|---|
| 1000 | 0.053 ms | 0.83 ms | 0.023 ms |
| 5000 | 0.11 ms | 4.07 ms | 0.059 ms |
| 15000 | 0.33 ms | **12.5 ms** | 0.16 ms |

- GDScript 約 JS 的 38 倍慢、C# 約 JS 的一半時間。只量運算，繪圖（MultiMesh）還沒量。量測程式不在 repo（當時的 session scratchpad，要重跑照上面規則重寫）。
- 真實遊戲的負擔（Mac Chrome，沙盒、散彈 A＋舊晶片電路、60 隻不動的標靶；每幀把場上真的子彈複製補到目標數量，命中效果照常跑）：約 940 顆 運算 0.69ms／畫圖 1.59ms；約 4500 顆 2.02／2.44ms（97fps）；約 13800 顆 7.17／6.01ms（47fps）。比簡化版重約 20 倍。
  - 複製子彈要保留原型：`Object.assign(Object.create(Object.getPrototypeOf(b)), b, …)`，Set 欄位各自新建；用 `{...b}` 會丟掉 `update`，主迴圈當掉。
- 推估（**未驗證假設**：把簡化版的倍數直接套到真實邏輯）：GDScript 約 5000 顆就要 70ms 以上；C# 約 1～4ms。結論：子彈層要 C#。
