# 考上社工師 PWA

這是第一版 GitHub Pages PWA 原型。APP 名稱與 iOS 桌面顯示名稱皆為 `考上社工師`。

## 本機預覽

在本資料夾執行：

```powershell
& "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" serve-static.mjs
```

開啟：

- APP 首頁：`http://127.0.0.1:8787/index.html`
- UI 模擬頁：`http://127.0.0.1:8787/design-mockups.html`
- 待人工校對清單：`http://127.0.0.1:8787/data/manual_review_needed.md`

## 題庫資料

資料由下列腳本產生：

```powershell
& "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\build_kaoshang_social_worker_app_data.py --root "C:\Users\user\Documents\New project" --output "apps\kaoshang-social-worker"
```

目前狀態：

- 已配對來源：152 組
- 已進入 APP 題庫：152 組
- 待人工校對：0 組
- 模擬考：已可單科跨年度抽 40 題、60 分鐘倒數、暫停後繼續

國考題目原文不得改寫。若 PDF 抽字或切題不穩，先列入 `data/manual_review_needed.md`，人工補正後再核對。

## 開發與測試

```powershell
& "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m unittest tests.test_kaoshang_question_parser -v
& "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test apps\kaoshang-social-worker\app.test.mjs
& "C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --check apps\kaoshang-social-worker\app.js
```

## Icon 與色系

正式 icon 來源：

`C:\Users\user\Downloads\a098274d-bd27-44dc-a23e-935f49ef3793.jfif`

APP 色系以 icon 為基準：深藍、橘黃、青草綠、暖白，少量粉紅/紅色只用於警示或錯題。

## 安全與穩定性

本 APP 以 GitHub Pages 靜態部署為主，前端不放 API key、後台密碼、個資或可被濫用的伺服器權限。`index.html` 已加入 Content Security Policy，限制頁面只載入本站腳本、樣式、圖片與資料，降低被插入惡意程式碼的風險。

大量流量攻擊或惡意請求無法只靠前端程式完全阻擋。正式上線後若需要更高防護，建議使用 GitHub Pages 搭配自訂網域與 CDN 防護，例如 Cloudflare，並保留純靜態架構，避免新增容易被攻擊的登入、資料庫或伺服器端 API。
