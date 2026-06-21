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

// ---------- 歷史 / 月曆 ----------

const created = new Date(2026, 5, 10).getTime(); // 2026-06-10
const medsH = [
  { id: "a", name: "血壓藥", dose: 1, unit: "顆", times: ["08:00", "20:00"], createdAt: created },
  { id: "b", name: "維他命C", dose: 1, unit: "錠", times: ["08:00"], createdAt: created },
];

test("scheduledDosesForDate：建立日之前的日期不計入", () => {
  assert.strictEqual(T.scheduledDosesForDate(medsH, "2026-06-09").length, 0); // 早於建立日
  assert.strictEqual(T.scheduledDosesForDate(medsH, "2026-06-10").length, 3); // 當天起算
  assert.strictEqual(T.scheduledDosesForDate(medsH, "2026-06-21").length, 3);
});

test("dayStatus：各種狀態", () => {
  const today = "2026-06-21";
  // 未來
  assert.strictEqual(T.dayStatus(medsH, {}, "2026-06-22", today).status, "future");
  // 建立日前 → empty
  assert.strictEqual(T.dayStatus(medsH, {}, "2026-06-09", today).status, "empty");
  // 過去全沒吃 → missed
  assert.strictEqual(T.dayStatus(medsH, {}, "2026-06-15", today).status, "missed");
  // 過去部分 → partial
  let logs = { "2026-06-15": { "a|08:00": "x" } };
  assert.strictEqual(T.dayStatus(medsH, logs, "2026-06-15", today).status, "partial");
  // 過去全吃 → complete
  logs = { "2026-06-15": { "a|08:00": "x", "a|20:00": "x", "b|08:00": "x" } };
  let r = T.dayStatus(medsH, logs, "2026-06-15", today);
  assert.deepStrictEqual([r.status, r.taken, r.expected], ["complete", 3, 3]);
  // 今天未完成 → today-pending
  assert.strictEqual(T.dayStatus(medsH, {}, today, today).status, "today-pending");
});

test("buildMonth：6 週 42 格、含當月與鄰月", () => {
  const cells = T.buildMonth(2026, 5); // 2026 年 6 月
  assert.strictEqual(cells.length, 42);
  const inMonth = cells.filter((c) => c.inMonth);
  assert.strictEqual(inMonth.length, 30); // 六月 30 天
  assert.strictEqual(inMonth[0].dateKey, "2026-06-01");
  assert.strictEqual(inMonth[29].dateKey, "2026-06-30");
});

// ---------- 慢性處方箋領藥 ----------

test("daysUntil：日期相差天數", () => {
  assert.strictEqual(T.daysUntil("2026-06-21", "2026-06-21"), 0);
  assert.strictEqual(T.daysUntil("2026-06-25", "2026-06-21"), 4);
  assert.strictEqual(T.daysUntil("2026-06-20", "2026-06-21"), -1);
  assert.strictEqual(T.daysUntil(null, "2026-06-21"), null);
});

test("refillStatus：四種領藥狀態", () => {
  const today = "2026-06-10";
  assert.strictEqual(T.refillStatus({ start: "2026-06-15", end: "2026-06-20" }, today), "upcoming");
  assert.strictEqual(T.refillStatus({ start: "2026-06-05", end: "2026-06-15" }, today), "open");
  assert.strictEqual(T.refillStatus({ start: "2026-06-01", end: "2026-06-08" }, today), "missed");
  assert.strictEqual(T.refillStatus({ start: "2026-06-01", end: "2026-06-30", pickedUp: true }, today), "picked");
  // 邊界：剛好開始日 / 結束日都算可領
  assert.strictEqual(T.refillStatus({ start: "2026-06-10", end: "2026-06-20" }, today), "open");
  assert.strictEqual(T.refillStatus({ start: "2026-06-01", end: "2026-06-10" }, today), "open");
});

test("activeRefillAlerts：挑出可領藥中或即將開放且未領的", () => {
  const today = "2026-06-10";
  const rxs = [
    {
      id: "rx1", name: "心臟科",
      refills: [
        { id: "a", start: "2026-06-01", end: "2026-06-08" },           // 已過期 -> 不列
        { id: "b", start: "2026-06-05", end: "2026-06-15" },           // 可領藥中 -> 列
        { id: "c", start: "2026-06-12", end: "2026-06-22" },           // 2 天後開放 -> 列（soon=3）
        { id: "d", start: "2026-06-20", end: "2026-06-30" },           // 10 天後 -> 不列
      ],
    },
    {
      id: "rx2", name: "新陳代謝科",
      refills: [
        { id: "e", start: "2026-06-06", end: "2026-06-16", pickedUp: true }, // 已領 -> 不列
        { id: "f", start: "2026-06-09", end: "2026-06-19" },                 // 可領藥中 -> 列
      ],
    },
  ];
  const alerts = T.activeRefillAlerts(rxs, today, 3);
  const ids = alerts.map((x) => x.refillId);
  assert.deepStrictEqual(ids.sort(), ["b", "c", "f"].sort());
  // 可領藥中（open）要排在即將開放（upcoming）前面
  assert.strictEqual(alerts[alerts.length - 1].refillId, "c");
  assert.strictEqual(alerts[alerts.length - 1].status, "upcoming");
  assert.strictEqual(alerts[alerts.length - 1].daysUntilStart, 2);
});

test("activeRefillAlerts：空資料安全", () => {
  assert.deepStrictEqual(T.activeRefillAlerts([], "2026-06-10", 3), []);
  assert.deepStrictEqual(T.activeRefillAlerts(undefined, "2026-06-10"), []);
  assert.deepStrictEqual(T.activeRefillAlerts([{ id: "x", refills: [] }], "2026-06-10"), []);
});
