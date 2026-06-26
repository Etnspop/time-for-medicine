/* 吃藥時間 — Web Push 後端（單檔版，給 Cloudflare 網頁後台直接貼上用）
 * 與 src/ 內的多檔版邏輯相同，只是合併成一個檔，方便在 Dashboard 線上編輯器部署。
 * 部署步驟見 server/SETUP-dashboard.md
 */

/* ===================== 排程 ===================== */
function localHM(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "UTC",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour").value;
  const m = parts.find((p) => p.type === "minute").value;
  return `${h}:${m}`;
}
function dueSubscriptions(subs, date) {
  return (subs || []).filter((s) => {
    const hm = localHM(date, s.tz || "UTC");
    return (s.times || []).includes(hm);
  });
}

/* ===================== Web Push 加密 / VAPID ===================== */
const te = new TextEncoder();
const subtle = globalThis.crypto.subtle;

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  s += "=".repeat(pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(buf) {
  const arr = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}
async function encryptPayload(plaintext, p256dhB64u, authB64u) {
  const clientPub = b64urlToBytes(p256dhB64u);
  const auth = b64urlToBytes(authB64u);
  const clientKey = await subtle.importKey("raw", clientPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const serverKp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPub = new Uint8Array(await subtle.exportKey("raw", serverKp.publicKey));
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: clientKey }, serverKp.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(te.encode("WebPush: info\0"), clientPub, serverPub), 32);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const data = typeof plaintext === "string" ? te.encode(plaintext) : plaintext;
  const padded = concat(data, new Uint8Array([2]));
  const aesKey = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));
  const rs = new Uint8Array([0, 0, 0x10, 0x00]);
  const idlen = new Uint8Array([serverPub.length]);
  return concat(salt, rs, idlen, serverPub, ct);
}
async function vapidHeaders(endpoint, pubB64u, privB64u, subject, expSeconds) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(expSeconds != null ? expSeconds : Date.now() / 1000 + 12 * 3600);
  const pub = b64urlToBytes(pubB64u);
  const d = b64urlToBytes(privB64u);
  const jwk = {
    kty: "EC", crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(d),
    ext: true,
  };
  const key = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const seg = (o) => bytesToB64url(te.encode(JSON.stringify(o)));
  const signingInput = `${seg({ typ: "JWT", alg: "ES256" })}.${seg({ aud, exp, sub: subject })}`;
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(signingInput)));
  const jwt = `${signingInput}.${bytesToB64url(sig)}`;
  return { Authorization: `vapid t=${jwt}, k=${pubB64u}` };
}
async function sendPush(subscription, payloadObj, vapid) {
  const body = await encryptPayload(JSON.stringify(payloadObj), subscription.keys.p256dh, subscription.keys.auth);
  const headers = await vapidHeaders(subscription.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: { ...headers, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "2419200" },
    body,
  });
}

/* ===================== Worker ===================== */
function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
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
        const res = await sendPush(s.subscription, { title: "💊 該吃藥囉", body: "到吃藥時間了，打開 App 確認今天的藥。" }, vapid);
        if (res.status === 404 || res.status === 410) await env.SUBS.delete(s.id);
      } catch (e) { /* ignore single failure */ }
    }));
  },
};
