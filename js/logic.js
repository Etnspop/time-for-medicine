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

  return { pad, todayKey, hm, weekdayZh, fmtDose, doseId, todaysDoses, computeDue, progress, escapeHtml };
});
