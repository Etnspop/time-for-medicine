/* 核心邏輯單元測試：node --test test/logic.test.js */
const test = require("node:test");
const assert = require("node:assert");
const T = require("../js/logic.js");

const meds = [
  { id: "a", name: "血壓藥", dose: 1, unit: "顆", note: "飯後", times: ["20:00", "08:00"] },
  { id: "b", name: "維他命C", dose: 2, unit: "錠", note: "", times: ["08:00"] },
];

test("todayKey 補零格式 YYYY-MM-DD", () => {
  assert.strictEqual(T.todayKey(new Date(2026, 0, 5)), "2026-01-05");
});

test("hm 補零格式 HH:MM", () => {
  assert.strictEqual(T.hm(new Date(2026, 5, 21, 7, 3)), "07:03");
});

test("weekdayZh 回傳中文星期", () => {
  assert.strictEqual(T.weekdayZh(new Date(2026, 5, 21)), "日"); // 2026-06-21 是週日
});

test("fmtDose 組合劑量與單位", () => {
  assert.strictEqual(T.fmtDose(meds[0]), "1 顆");
});

test("todaysDoses 攤平所有時間並依時間排序", () => {
  const doses = T.todaysDoses(meds);
  assert.strictEqual(doses.length, 3);
  assert.deepStrictEqual(doses.map((d) => d.time), ["08:00", "08:00", "20:00"]);
  assert.strictEqual(doses[2].name, "血壓藥");
});

test("doseId 由 medId 與時間組成且唯一", () => {
  const doses = T.todaysDoses(meds);
  const ids = new Set(doses.map(T.doseId));
  assert.strictEqual(ids.size, 3);
  assert.strictEqual(T.doseId(doses[2]), "a|20:00");
});

test("computeDue：只挑已到時間、未服用、未提醒過的", () => {
  const doses = T.todaysDoses(meds);
  // 現在 09:00：兩個 08:00 已到時間，20:00 還沒
  let due = T.computeDue(doses, "09:00", [], []);
  assert.strictEqual(due.length, 2);

  // 其中一個已服用 -> 只剩一個
  const taken = ["a|08:00"];
  due = T.computeDue(doses, "09:00", taken, []);
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].medId, "b");

  // 已提醒過 -> 不再列入
  due = T.computeDue(doses, "09:00", taken, ["b|08:00"]);
  assert.strictEqual(due.length, 0);

  // 時間未到 -> 不列入
  due = T.computeDue(doses, "07:00", [], []);
  assert.strictEqual(due.length, 0);

  // 剛好到點（邊界）-> 列入
  due = T.computeDue(doses, "08:00", [], []);
  assert.strictEqual(due.length, 2);
});

test("progress 計算已服用比例", () => {
  const doses = T.todaysDoses(meds); // 3 項
  assert.deepStrictEqual(T.progress(doses, []), { done: 0, total: 3, pct: 0 });
  assert.deepStrictEqual(T.progress(doses, ["a|08:00"]), { done: 1, total: 3, pct: 33 });
  assert.deepStrictEqual(
    T.progress(doses, ["a|08:00", "b|08:00", "a|20:00"]),
    { done: 3, total: 3, pct: 100 }
  );
  assert.deepStrictEqual(T.progress([], []), { done: 0, total: 0, pct: 0 });
});

test("escapeHtml 防止 HTML 注入", () => {
  assert.strictEqual(
    T.escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
  );
});

test("空資料不會出錯", () => {
  assert.deepStrictEqual(T.todaysDoses([]), []);
  assert.deepStrictEqual(T.todaysDoses(undefined), []);
  assert.deepStrictEqual(T.computeDue([], "10:00", [], []), []);
});
