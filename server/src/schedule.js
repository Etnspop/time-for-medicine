/* 排程判斷（純函式，無依賴，可在 Workers 與 Node 執行）
 * 判斷某訂閱在「現在」這個時刻，於它自己的時區是否到了某個服藥時間。
 */

// 取得某時刻在指定時區的 "HH:MM"（24 小時制）
export function localHM(date, timeZone) {
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

// 從訂閱清單挑出「此刻該提醒」的（它的某個服藥時間 == 它時區的現在時刻）
export function dueSubscriptions(subs, date) {
  return (subs || []).filter((s) => {
    const hm = localHM(date, s.tz || "UTC");
    return (s.times || []).includes(hm);
  });
}
