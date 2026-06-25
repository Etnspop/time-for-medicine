import test from "node:test";
import assert from "node:assert";
import { localHM, dueSubscriptions } from "../src/schedule.js";

test("localHM：依時區換算 HH:MM", () => {
  const d = new Date("2026-06-21T00:05:00Z"); // UTC 00:05
  assert.strictEqual(localHM(d, "Asia/Taipei"), "08:05"); // +8
  assert.strictEqual(localHM(d, "UTC"), "00:05");
});

test("localHM：午夜為 00:00（h23）", () => {
  const d = new Date("2026-06-20T16:00:00Z"); // 台北 = 隔天 00:00
  assert.strictEqual(localHM(d, "Asia/Taipei"), "00:00");
});

test("dueSubscriptions：只挑此刻時區到點的訂閱", () => {
  const d = new Date("2026-06-21T00:05:00Z"); // 台北 08:05
  const subs = [
    { endpoint: "a", times: ["08:05", "20:00"], tz: "Asia/Taipei" }, // 到點 → 列
    { endpoint: "b", times: ["09:00"], tz: "Asia/Taipei" },          // 沒到 → 不列
    { endpoint: "c", times: ["00:05"], tz: "UTC" },                  // UTC 到點 → 列
    { endpoint: "d", times: [], tz: "Asia/Taipei" },                 // 沒設時間 → 不列
  ];
  const due = dueSubscriptions(subs, d).map((s) => s.endpoint);
  assert.deepStrictEqual(due.sort(), ["a", "c"]);
});
