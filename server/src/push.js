/* Web Push 加密與 VAPID 簽章（純 Web Crypto，可在 Cloudflare Workers 與 Node 22+ 執行）
 * 實作 RFC 8291（aes128gcm 內容加密）與 VAPID（RFC 8292，ES256 JWT）。
 * 之所以自己實作，是為了不依賴特定平台的套件，並能在本機做加解密往返測試。
 */

const te = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  s += "=".repeat(pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(buf) {
  const arr = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8
  );
  return new Uint8Array(bits);
}

// 依 RFC 8291 加密 payload，回傳完整的 aes128gcm 訊息（header + 密文）
export async function encryptPayload(plaintext, p256dhB64u, authB64u) {
  const clientPub = b64urlToBytes(p256dhB64u); // 65 bytes 未壓縮公鑰
  const auth = b64urlToBytes(authB64u);        // 16 bytes

  const clientKey = await subtle.importKey(
    "raw", clientPub, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const serverKp = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  const serverPub = new Uint8Array(await subtle.exportKey("raw", serverKp.publicKey));
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: clientKey }, serverKp.privateKey, 256)
  );

  const keyInfo = concat(te.encode("WebPush: info\0"), clientPub, serverPub);
  const ikm = await hkdf(auth, shared, keyInfo, 32);

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);

  const data = typeof plaintext === "string" ? te.encode(plaintext) : plaintext;
  const padded = concat(data, new Uint8Array([2])); // 單一 record，分隔符 0x02

  const aesKey = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded)
  );

  // header: salt(16) | rs(4=4096) | idlen(1) | keyid(serverPub)
  const rs = new Uint8Array([0, 0, 0x10, 0x00]);
  const idlen = new Uint8Array([serverPub.length]);
  return concat(salt, rs, idlen, serverPub, ct);
}

// 由 VAPID 公私鑰（base64url raw）組出 Authorization 標頭
export async function vapidHeaders(endpoint, pubB64u, privB64u, subject, expSeconds) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(expSeconds != null ? expSeconds : Date.now() / 1000 + 12 * 3600);

  const pub = b64urlToBytes(pubB64u); // 65
  const d = b64urlToBytes(privB64u);  // 32
  const jwk = {
    kty: "EC", crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(d),
    ext: true,
  };
  const key = await subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );

  const seg = (o) => bytesToB64url(te.encode(JSON.stringify(o)));
  const signingInput = `${seg({ typ: "JWT", alg: "ES256" })}.${seg({ aud, exp, sub: subject })}`;
  const sig = new Uint8Array(
    await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(signingInput))
  );
  const jwt = `${signingInput}.${bytesToB64url(sig)}`;
  return { Authorization: `vapid t=${jwt}, k=${pubB64u}` };
}

// 對單一訂閱送出推播
export async function sendPush(subscription, payloadObj, vapid) {
  const body = await encryptPayload(
    JSON.stringify(payloadObj), subscription.keys.p256dh, subscription.keys.auth
  );
  const headers = await vapidHeaders(
    subscription.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject
  );
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "2419200",
    },
    body,
  });
}
