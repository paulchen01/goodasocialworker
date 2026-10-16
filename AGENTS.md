# AGENTS.md — 考上社工師 PWA 協作規則

本檔是 Claude 與 Codex 共用的唯一規則來源。`CLAUDE.md` 只指向本檔，規則一律改在這裡。

## 專案概要

- 社工師國考練習用的免費 PWA，純靜態網站，部署在 GitHub Pages。
- 主要檔案：
  - `index.html`、`styles.css`：頁面與樣式
  - `app.js`：畫面與互動
  - `app-core.mjs`：抽題、計分、進度等核心邏輯
  - `essay-*.mjs`：申論題練習與 AI 回饋
  - `weak-record-backup.mjs`：錯題紀錄備份
  - `sw.js`：Service Worker 離線快取
  - `data/`：題庫與法規資料（JSON）

## 開始任何工作前

1. 先讀 `HANDOFF.md`，了解目前進度與另一位 AI 留下的交接事項。
2. 從最新的 `main` 開新分支，不要直接改 `main`。

## 分支與 PR（最重要）

- **push 到 `main` 會立刻自動部署上線**（`.github/workflows/pages.yml`），所以任何修改都要走分支 + PR，由陳老師在 GitHub 上合併。
- 分支命名：Claude 用 `claude/<簡短描述>`，Codex 用 `codex/<簡短描述>`。
- 一個 PR 只做一件事，並且只由一個 AI 修改。要接手另一位 AI 的 PR，先在 PR 留言說明，再動手。
- PR 說明須包含：改了什麼、為什麼改、如何驗證、還有哪些沒做。

## 必守規則

- **國考題目原文不得改寫。** 題目、選項、官方答案只能照來源校正；有疑義時記入 `data/manual_review_needed.md` 或對應的 `data/manual_*.json`，不要自行判斷修改。
- **修改任何會被快取的檔案（HTML、CSS、JS、`data/`）後，必須把 `sw.js` 的 `CACHE_NAME` 版號 +1**（例如 `v73` → `v74`），否則使用者手機上會繼續顯示舊版。
- 保持純靜態架構：不新增後端、登入或資料庫；前端不得放 API key、密碼或個資。
- 不放寬 `index.html` 的 Content Security Policy，除非 PR 中說明理由並經陳老師同意。
- 介面文字使用繁體中文（台灣用語）。色系沿用 icon：深藍、橘黃、青草綠、暖白；粉紅或紅色只用於警示與錯題。

## 驗證

- 本 repo 是部署用版本；完整測試與題庫產生腳本放在陳老師電腦的原始專案中，雲端環境無法執行。
- 雲端可做的最低檢查：
  - `node --check app.js` 以及修改過的 `.mjs` 檔
  - 修改過的 JSON 須能正常解析
- 需要在電腦上實測的項目，寫進 PR 說明與 `HANDOFF.md` 的「待人工確認」。

## 完成工作時

- 更新 `HANDOFF.md`，寫清楚完成了什麼、還剩什麼、已知問題，讓另一位 AI 能接手。
- commit 訊息使用簡短英文前綴，例如 `feat:`、`fix:`、`docs:`，內容可寫中文。
