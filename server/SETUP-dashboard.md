# 背景推播部署（純網頁版，不需電腦終端機）

全部在 [Cloudflare 後台](https://dash.cloudflare.com) 用瀏覽器點一點完成，不用裝 Node、不用打指令。
只需做一次，約 10 分鐘。

> 金鑰：
> - VAPID 公鑰（可公開，已幫你填好）：`BL7TBi-jsCi5yXeVaxmV5cC5bowKk1Zd-kTF_DOrDlCN0_JC1ihQfV1oGE0g6Oc59p4CZzEGminB7mW-6HfpCDA`
> - VAPID 私鑰：**請用我在對話中提供給你的那串**（基於安全，不寫進這份公開文件）。
>   或自行用 `npx web-push generate-vapid-keys` 重新產生一組（公鑰記得也同步更新）。

---

## 1. 註冊／登入 Cloudflare
到 <https://dash.cloudflare.com> 註冊或登入（免費）。

## 2. 建立 KV（存訂閱的小資料庫）
左側選 **Storage & Databases → KV**（或 Workers & Pages → KV）→ **Create a namespace**
→ 名稱填 `SUBS` → 建立。

## 3. 建立 Worker
左側 **Workers & Pages → Create → Workers → Create Worker**
→ 取名例如 `time-for-medicine-push` → **Deploy**（先部署預設範本）
→ 再按 **Edit code（編輯程式碼）**
→ 把編輯器內容**全部刪掉**，貼上 `server/worker.bundle.js` 的**全部內容**
→ 右上 **Deploy（部署）**。

> `worker.bundle.js` 可在這裡複製：
> <https://github.com/Etnspop/time-for-medicine/blob/claude/medication-tracker-app-r9s672/server/worker.bundle.js>

## 4. 綁定 KV
回到這個 Worker 的 **Settings（設定）→ Bindings（或 Variables）→ KV Namespace Bindings → Add**
- Variable name（變數名稱）：`SUBS`
- KV namespace：選步驟 2 建立的 `SUBS`
→ 儲存。

## 5. 設定環境變數
同樣在 **Settings → Variables and Secrets**，新增三個：

| 名稱 | 值 | 類型 |
|---|---|---|
| `VAPID_PUBLIC_KEY` | 上面那串公鑰 | Text（一般文字） |
| `VAPID_SUBJECT` | `mailto:你的email` | Text |
| `VAPID_PRIVATE_KEY` | 我在對話中給你的私鑰 | **Secret / Encrypt（加密）** |

→ 儲存並部署。

## 6. 設定每分鐘排程
**Settings → Triggers（觸發器）→ Cron Triggers → Add Cron Trigger**
→ 填 `* * * * *`（每分鐘）→ 儲存。

## 7. 取得 Worker 網址
在 Worker 頁面上方會看到網址，像：
`https://time-for-medicine-push.你的帳號.workers.dev`

👉 **把這個網址貼回來給我**，我幫你填進 App 的 `js/push-config.js` 並推送，GitHub Pages 就會自動更新、App 的「背景推播」就能啟用。

## 8. 手機啟用
1. 手機開 App 網址 →「加入主畫面」（iPhone 必須，iOS 16.4+）
2. 進 App →「更多」→「背景推播」→ 按「啟用背景推播」，允許通知
3. 完成！關閉 App 也會在服藥時間收到通知。

---

### 想換掉對話中出現過的私鑰？
可在 Cloudflare 後台不做特別處理；若你在意，可改用指令版（見 `SETUP.md`）自行用
`npx web-push generate-vapid-keys` 產生新的一組，公鑰告訴我、私鑰填到步驟 5。
（私鑰外洩最多只是別人能對你的裝置發通知，碰不到你的藥物資料。）
