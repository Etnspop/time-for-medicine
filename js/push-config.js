/* 背景推播設定（Web Push）
 *
 * 預設為空 → App 仍可正常使用，只是「背景推播（關閉也能提醒）」功能停用。
 * 等你依照 server/SETUP.md 部署好 Cloudflare Worker 後，把下面兩個值填上即可啟用：
 *   - workerUrl：你的 Worker 網址，例如 https://time-for-medicine-push.你的帳號.workers.dev
 *   - vapidPublicKey：你產生的 VAPID 公鑰（base64url）
 */
window.PUSH_CONFIG = {
  workerUrl: "",
  vapidPublicKey: "",
};
