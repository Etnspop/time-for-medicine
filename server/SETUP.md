# 背景推播後端部署教學（Cloudflare Workers）

讓「吃藥時間」在 App **完全關閉**時，也能在服藥時間收到通知。
這個後端**只存「裝置推播端點 + 服藥時間 + 時區」**，**不存藥名、劑量、吃了沒**——藥物細節仍只在你手機本機。

整個過程大約 15 分鐘，只需做一次。

---

## 你會用到

- 一個免費的 [Cloudflare](https://dash.cloudflare.com/sign-up) 帳號
- 電腦上的 [Node.js](https://nodejs.org/)（用來跑指令）

---

## 步驟

### 1. 安裝工具並登入

在這個 `server/` 資料夾裡執行：

```bash
cd server
npm install            # 安裝 wrangler（Cloudflare 的命令列工具）
npx wrangler login     # 會開瀏覽器登入你的 Cloudflare 帳號
```

### 2. 產生 VAPID 金鑰（推播的身分憑證）

```bash
npx web-push generate-vapid-keys
```

會印出 **Public Key** 與 **Private Key** 兩串。等等會用到。
（如果說找不到 web-push：先執行 `npm install -g web-push` 或 `npx --yes web-push generate-vapid-keys`。）

### 3. 建立 KV（存放訂閱的小資料庫）

```bash
npx wrangler kv namespace create SUBS
```

它會印出一段像這樣的設定：

```
[[kv_namespaces]]
binding = "SUBS"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

把那串 **id** 複製起來。

### 4. 填好 `wrangler.toml`

打開 `server/wrangler.toml`，填入：
- `id`：上一步的 KV id
- `VAPID_PUBLIC_KEY`：步驟 2 的 **Public Key**
- `VAPID_SUBJECT`：改成你的 email，例如 `mailto:you@example.com`

### 5. 設定私鑰（祕密，不寫進檔案）

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

貼上步驟 2 的 **Private Key**，按 Enter。

### 6. 部署

```bash
npx wrangler deploy
```

成功後會給你一個網址，例如：
`https://time-for-medicine-push.你的帳號.workers.dev`

### 7. 把設定接到前端 App

回到專案根目錄，編輯 `js/push-config.js`：

```js
window.PUSH_CONFIG = {
  workerUrl: "https://time-for-medicine-push.你的帳號.workers.dev",
  vapidPublicKey: "貼上步驟 2 的 Public Key",
};
```

commit 並 push（GitHub Pages 會自動重新發布）。

### 8. 在手機上啟用

1. 用手機開啟你的 App 網址，**先「加入主畫面」**（iPhone 必須，需 iOS 16.4 以上）。
2. 進 App → 「更多」→「背景推播」→ 按 **啟用背景推播**，允許通知。
3. 完成！之後即使關閉 App，到了服藥時間手機也會跳通知。

---

## 運作方式

- App 啟用時，會把「推播端點 + 你所有藥物的服用時間（如 08:00、20:00）+ 時區」送到 Worker 存起來。
- Worker 每分鐘檢查一次，發現某裝置在它的時區到了某個服藥時間，就送出一則「該吃藥囉」通知。
- 通知內容是通用文字，**不含藥名**；點開 App 才看得到今天要吃哪些、勾選完成。
- 你新增/修改/刪除藥物時，App 會自動把最新時間同步到 Worker。

## 隱私

Worker 的 KV 只存：推播端點（一串無意義網址）、服藥時間、時區。
**沒有**藥名、劑量、服藥紀錄——這些永遠只在你手機本機。

## 費用

Cloudflare Workers 免費方案每天 10 萬次請求、Cron 每分鐘觸發都在免費額度內，個人使用幾乎不可能超過。

## 開發者測試

後端的加密與排程邏輯有單元測試（不需部署、不需網路）：

```bash
cd server
node --test
```
