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

  // 找出「此刻該（再次）提醒」的劑量，支援未服藥時每隔一段時間重複提醒。
  // - doses：今日劑量；nowHM：現在 HH:MM；nowEpoch：現在毫秒
  // - remindMap：{ doseId: 上次提醒的毫秒時間 }
  // - takenIds：已服用的 doseId 集合
  // - opts.repeat：是否開啟重複提醒；opts.repeatMs：重複間隔（毫秒）
  // 規則：到時間且未服用 → 第一次一定提醒；之後每隔 repeatMs 再提醒一次，
  //       已服用或跨日（remindMap 每日重置）即停止。
  function computeReminders(doses, nowHM, nowEpoch, remindMap, takenIds, opts) {
    const taken = takenIds instanceof Set ? takenIds : new Set(takenIds || []);
    const map = remindMap || {};
    const repeat = !opts || opts.repeat !== false;
    const repeatMs = (opts && opts.repeatMs) || 4 * 3600 * 1000;
    return (doses || []).filter((d) => {
      const id = doseId(d);
      if (taken.has(id)) return false;
      if (d.time > nowHM) return false;
      const last = map[id];
      if (last == null) return true;
      return repeat && nowEpoch - last >= repeatMs;
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

  // 彙整所有藥物的服用時間，去重並排序（給背景推播排程用）
  function uniqueDoseTimes(meds) {
    const set = new Set();
    (meds || []).forEach((m) => (m.times || []).forEach((t) => { if (t) set.add(t); }));
    return [...set].sort();
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

  // ---------- 慢性處方箋領藥 ----------

  // 兩個日期字串相差幾天（target - today），正數代表未來
  function daysUntil(targetKey, todayStr) {
    if (!targetKey || !todayStr) return null;
    const a = new Date(targetKey + "T00:00:00");
    const b = new Date(todayStr + "T00:00:00");
    return Math.round((a - b) / 86400000);
  }

  // 單次領藥的狀態
  // status: picked（已領）/ upcoming（尚未開放）/ open（可領藥中）/ missed（已過期未領）
  function refillStatus(refill, todayStr) {
    if (!refill) return "upcoming";
    if (refill.pickedUp) return "picked";
    if (refill.start && todayStr < refill.start) return "upcoming";
    if (refill.end && todayStr > refill.end) return "missed";
    return "open";
  }

  // 找出需要提醒的領藥：正在可領藥中、或將在 soonDays 內開放，且尚未領取
  // 回傳已排序的提醒清單（可領藥中優先、其次依開始日）
  function activeRefillAlerts(prescriptions, todayStr, soonDays) {
    const soon = soonDays == null ? 3 : soonDays;
    const alerts = [];
    (prescriptions || []).forEach((rx) => {
      (rx.refills || []).forEach((r) => {
        const status = refillStatus(r, todayStr);
        if (status === "picked" || status === "missed") return;
        const dStart = daysUntil(r.start, todayStr);
        if (status === "open" || (status === "upcoming" && dStart != null && dStart <= soon)) {
          alerts.push({
            rxId: rx.id,
            rxName: rx.name || "處方箋",
            refillId: r.id,
            refill: r,
            status,
            daysUntilStart: dStart,
            daysUntilEnd: daysUntil(r.end, todayStr),
          });
        }
      });
    });
    alerts.sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return (a.refill.start || "").localeCompare(b.refill.start || "");
    });
    return alerts;
  }

  return {
    pad, todayKey, hm, weekdayZh, fmtDose, doseId, todaysDoses, computeDue, computeReminders, progress, escapeHtml, uniqueDoseTimes,
    dateKeyOf, scheduledDosesForDate, dayStatus, buildMonth,
    daysUntil, refillStatus, activeRefillAlerts,
  };
});
