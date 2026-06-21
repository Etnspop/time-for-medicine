/* 純邏輯模組（無 DOM 依賴）
 * 同時支援瀏覽器（掛在 window.TFM）與 Node（module.exports），方便單元測試。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TFM = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const pad = (n) => String(n).padStart(2, "0");

  function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function hm(d = new Date()) {
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function weekdayZh(d = new Date()) {
    return "日一二三四五六"[d.getDay()];
  }

  function fmtDose(m) {
    return `${Number(m.dose)} ${m.unit}`;
  }

  function doseId(d) {
    return `${d.medId}|${d.time}`;
  }

  // 把所有藥物的所有服用時間，攤平並依時間排序成「今日待辦」
  function todaysDoses(meds) {
    const doses = [];
    (meds || []).forEach((m) => {
      (m.times || []).forEach((t) => {
        doses.push({
          medId: m.id,
          name: m.name,
          dose: fmtDose(m),
          note: m.note || "",
          time: t,
        });
      });
    });
    doses.sort((a, b) => a.time.localeCompare(b.time));
    return doses;
  }

  // 找出「已到時間、尚未服用、尚未提醒過」的劑量
  // takenIds / notifiedIds 為 doseId 字串的集合（Set 或陣列）
  function computeDue(doses, now, takenIds, notifiedIds) {
    const taken = takenIds instanceof Set ? takenIds : new Set(takenIds || []);
    const notified = notifiedIds instanceof Set ? notifiedIds : new Set(notifiedIds || []);
    return (doses || []).filter((d) => {
      const id = doseId(d);
      return d.time <= now && !taken.has(id) && !notified.has(id);
    });
  }

  // 今日進度
  function progress(doses, takenIds) {
    const taken = takenIds instanceof Set ? takenIds : new Set(takenIds || []);
    const done = (doses || []).filter((d) => taken.has(doseId(d))).length;
    const total = (doses || []).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- 歷史 / 月曆 ----------

  // 由毫秒時間戳取得當地日期字串 YYYY-MM-DD
  function dateKeyOf(ms) {
    return todayKey(new Date(ms));
  }

  // 某一天「應該服用」的劑量：只計算在該日期（含）之前就已建立的藥物
  function scheduledDosesForDate(meds, dateKey) {
    const eligible = (meds || []).filter(
      (m) => !m.createdAt || dateKeyOf(m.createdAt) <= dateKey
    );
    return todaysDoses(eligible);
  }

  // 某一天的服藥狀態
  // 回傳 { expected, taken, status }
  // status: future / empty / complete / partial / missed / today-pending
  function dayStatus(meds, logs, dateKey, todayStr) {
    if (todayStr && dateKey > todayStr) return { expected: 0, taken: 0, status: "future" };
    const scheduled = scheduledDosesForDate(meds, dateKey);
    const expected = scheduled.length;
    if (expected === 0) return { expected: 0, taken: 0, status: "empty" };
    const dayLog = (logs && logs[dateKey]) || {};
    const taken = scheduled.filter((d) => dayLog[doseId(d)]).length;
    let status;
    if (taken >= expected) status = "complete";
    else if (todayStr && dateKey === todayStr) status = "today-pending";
    else if (taken === 0) status = "missed";
    else status = "partial";
    return { expected, taken, status };
  }

  // 產生月曆格子（固定 6 週 = 42 格，週日起算）
  function buildMonth(year, month /* 0-11 */) {
    const first = new Date(year, month, 1);
    const startDow = first.getDay();
    const cells = [];
    const start = new Date(year, month, 1 - startDow);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      cells.push({
        dateKey: todayKey(d),
        day: d.getDate(),
        inMonth: d.getMonth() === month,
      });
    }
    return cells;
  }

  // ---------- 庫存 / 補藥提醒 ----------

  // 每日消耗量 = 每次劑量 × 一天次數
  function dailyConsumption(med) {
    return Number(med.dose || 0) * ((med.times && med.times.length) || 0);
  }

  // 還能撐幾天（無庫存資料回傳 null）
  function daysLeft(med) {
    if (med.stock == null || med.stock === "") return null;
    const perDay = dailyConsumption(med);
    if (perDay <= 0) return null;
    return Math.floor(Number(med.stock) / perDay);
  }

  // 是否庫存偏低（預設 7 天內）
  function isLowStock(med) {
    const dl = daysLeft(med);
    if (dl == null) return false;
    const threshold = med.lowThreshold != null ? Number(med.lowThreshold) : 7;
    return dl <= threshold;
  }

  return {
    pad, todayKey, hm, weekdayZh, fmtDose, doseId, todaysDoses, computeDue, progress, escapeHtml,
    dateKeyOf, scheduledDosesForDate, dayStatus, buildMonth,
    dailyConsumption, daysLeft, isLowStock,
  };
});
