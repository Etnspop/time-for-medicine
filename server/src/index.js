/* Cloudflare Worker：吃藥時間的 Web Push 後端
 * - POST /subscribe   存「裝置推播訂閱 + 服藥時間 + 時區」到 KV（不含藥名等個資）
 * - POST /unsubscribe 移除
 * - Cron（每分鐘）：找出此刻該提醒的訂閱並送出推播
 */
import { dueSubscriptions } from "./schedule.js";
import { sendPush } from "./push.js";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}
async function hashEndpoint(ep) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ep));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 所有訂閱集中存在「單一個 KV key」，避免每分鐘用 list()（list 免費上限僅 1000 次/天）。
const SUBS_KEY = "subs";
async function getAll(env) {
  const raw = await env.SUBS.get(SUBS_KEY);
  return raw ? JSON.parse(raw) : {};
}
async function putAll(env, all) {
  await env.SUBS.put(SUBS_KEY, JSON.stringify(all));
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "*";
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });

    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/subscribe") {
      const { subscription, times, tz } = await req.json().catch(() => ({}));
      if (!subscription || !subscription.endpoint) return json({ error: "缺少訂閱資訊" }, 400, origin);
      const id = await hashEndpoint(subscription.endpoint);
      const all = await getAll(env);
      all[id] = { subscription, times: Array.isArray(times) ? times : [], tz: tz || "UTC" };
      await putAll(env, all);
      return json({ ok: true }, 200, origin);
    }

    if (req.method === "POST" && url.pathname === "/unsubscribe") {
      const { endpoint } = await req.json().catch(() => ({}));
      if (endpoint) {
        const id = await hashEndpoint(endpoint);
        const all = await getAll(env);
        if (all[id]) { delete all[id]; await putAll(env, all); }
      }
      return json({ ok: true }, 200, origin);
    }

    return new Response("time-for-medicine push server", { headers: cors(origin) });
  },

  async scheduled(event, env) {
    const now = new Date();
    const all = await getAll(env);                 // 每分鐘只做一次 get（非 list）
    const subs = Object.entries(all).map(([id, v]) => ({ id, ...v }));
    const due = dueSubscriptions(subs, now);
    if (due.length === 0) return;

    const vapid = {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT || "mailto:noreply@example.com",
    };

    let changed = false;
    await Promise.all(due.map(async (s) => {
      try {
        const res = await sendPush(
          s.subscription,
          { title: "💊 該吃藥囉", body: "到吃藥時間了，打開 App 確認今天的藥。" },
          vapid
        );
        if (res.status === 404 || res.status === 410) { delete all[s.id]; changed = true; }
      } catch (e) { /* single failure shouldn't break others */ }
    }));
    if (changed) await putAll(env, all);
  },
};
