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

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "*";
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });

    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/subscribe") {
      const { subscription, times, tz } = await req.json().catch(() => ({}));
      if (!subscription || !subscription.endpoint) return json({ error: "缺少訂閱資訊" }, 400, origin);
      const id = await hashEndpoint(subscription.endpoint);
      await env.SUBS.put(id, JSON.stringify({
        subscription,
        times: Array.isArray(times) ? times : [],
        tz: tz || "UTC",
      }));
      return json({ ok: true }, 200, origin);
    }

    if (req.method === "POST" && url.pathname === "/unsubscribe") {
      const { endpoint } = await req.json().catch(() => ({}));
      if (endpoint) await env.SUBS.delete(await hashEndpoint(endpoint));
      return json({ ok: true }, 200, origin);
    }

    return new Response("time-for-medicine push server", { headers: cors(origin) });
  },

  async scheduled(event, env) {
    const now = new Date();
    const subs = [];
    let cursor;
    do {
      const page = await env.SUBS.list({ cursor });
      for (const k of page.keys) {
        const v = await env.SUBS.get(k.name);
        if (v) subs.push({ id: k.name, ...JSON.parse(v) });
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    const due = dueSubscriptions(subs, now);
    const vapid = {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT || "mailto:noreply@example.com",
    };

    await Promise.all(due.map(async (s) => {
      try {
        const res = await sendPush(
          s.subscription,
          { title: "💊 該吃藥囉", body: "到吃藥時間了，打開 App 確認今天的藥。" },
          vapid
        );
        // 訂閱已失效就清掉
        if (res.status === 404 || res.status === 410) await env.SUBS.delete(s.id);
      } catch (e) { /* single failure shouldn't break others */ }
    }));
  },
};
