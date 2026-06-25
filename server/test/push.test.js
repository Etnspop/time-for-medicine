/* 驗證 Web Push 加密與 VAPID 簽章的正確性：
 * 在本機用 Node 的 Web Crypto 做「加密 →（模擬瀏覽器端）解密」往返，
 * 以及「簽 VAPID JWT → 用公鑰驗章」。真正的推播投遞需用 Cloudflare 部署後才能測。
 */
import test from "node:test";
import assert from "node:assert";
import { encryptPayload, vapidHeaders, b64urlToBytes, bytesToB64url } from "../src/push.js";

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

function concat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out;
}
async function hkdf(salt, ikm, info, len) {
  const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}

test("Web Push 加密可被對應的私鑰正確解出（RFC 8291 往返）", async () => {
  // 模擬瀏覽器端的訂閱金鑰
  const clientKp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const clientPub = new Uint8Array(await subtle.exportKey("raw", clientKp.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const p256dh = bytesToB64url(clientPub);
  const authB64 = bytesToB64url(auth);

  const message = JSON.stringify({ title: "💊 該吃藥囉", body: "測試" });
  const msg = await encryptPayload(message, p256dh, authB64);

  // ---- 解密（模擬瀏覽器/推播服務端） ----
  const salt = msg.slice(0, 16);
  const idlen = msg[20];
  const serverPub = msg.slice(21, 21 + idlen);
  const ct = msg.slice(21 + idlen);

  const serverKey = await subtle.importKey("raw", serverPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: serverKey }, clientKp.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(te.encode("WebPush: info\0"), clientPub, serverPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ct));
  // 去掉尾端的 0x02 分隔符
  const text = td.decode(plain.slice(0, plain[plain.length - 1] === 2 ? -1 : undefined));
  assert.strictEqual(text, message);
});

test("VAPID Authorization 標頭的 JWT 可被公鑰驗章", async () => {
  // 產生一組 VAPID 金鑰（raw 公鑰 + jwk 私鑰 d）
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pubRaw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  const jwk = await subtle.exportKey("jwk", kp.privateKey);
  const pubB64 = bytesToB64url(pubRaw);
  const privB64 = jwk.d; // 已是 base64url

  const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";
  const exp = 1_700_000_000 + 3600;
  const { Authorization } = await vapidHeaders(endpoint, pubB64, privB64, "mailto:you@example.com", exp);

  assert.match(Authorization, /^vapid t=.+, k=.+$/);
  const jwt = Authorization.slice("vapid t=".length).split(", k=")[0];
  const [h, p, s] = jwt.split(".");

  // 驗章
  const verifyKey = await subtle.importKey("raw", pubRaw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, verifyKey,
    b64urlToBytes(s), te.encode(`${h}.${p}`)
  );
  assert.strictEqual(ok, true, "JWT 簽章應通過驗證");

  // 內容正確
  const payload = JSON.parse(td.decode(b64urlToBytes(p)));
  assert.strictEqual(payload.aud, "https://fcm.googleapis.com");
  assert.strictEqual(payload.sub, "mailto:you@example.com");
  assert.strictEqual(payload.exp, exp);
});
