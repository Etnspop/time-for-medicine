/* 吃藥時間 Time for Medicine
 * 純前端 PWA：所有資料只存在裝置本機 localStorage，不上傳任何伺服器。
 */
(function () {
  "use strict";

  // ---------- 儲存層（本機 localStorage） ----------
  const KEY_MEDS = "tfm.meds.v1";
  const KEY_LOGS = "tfm.logs.v1";        // { "YYYY-MM-DD": { "<medId>|<HH:MM>": ISOtime } }
  const KEY_NOTIFIED = "tfm.notified.v1"; // { "YYYY-MM-DD": ["<medId>|<HH:MM>", ...] }

  const store = {
    read(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
      catch (e) { return fallback; }
    },
    write(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); }
      catch (e) { toast("儲存失敗，裝置空間可能已滿"); }
    },
  };

  let meds = store.read(KEY_MEDS, []);
  let logs = store.read(KEY_LOGS, {});

  function saveMeds() { store.write(KEY_MEDS, meds); }
  function saveLogs() { store.write(KEY_LOGS, logs); }

  // ---------- 小工具（純邏輯共用自 js/logic.js 的 TFM） ----------
  const T = window.TFM;
  const $ = (sel) => document.querySelector(sel);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const todayKey = T.todayKey;
  const nowHM = T.hm;
  const fmtDose = T.fmtDose;
  const weekdayZh = T.weekdayZh;
  const escapeHtml = T.escapeHtml;
  const doseId = T.doseId;

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // ---------- 今日劑量計算 ----------
  const todaysDoses = () => T.todaysDoses(meds);

  function isTaken(d, dayKey = todayKey()) {
    return !!(logs[dayKey] && logs[dayKey][doseId(d)]);
  }
  function setTaken(d, taken) {
    const k = todayKey();
    if (!logs[k]) logs[k] = {};
    if (taken) logs[k][doseId(d)] = new Date().toISOString();
    else delete logs[k][doseId(d)];
    saveLogs();
  }

  // ---------- 畫面：今日 ----------
  function renderToday() {
    const d = new Date();
    $("#todayLabel").textContent =
      `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（週${weekdayZh(d)}）`;

    const doses = todaysDoses();
    const list = $("#todayList");
    const empty = $("#todayEmpty");
    list.innerHTML = "";

    if (doses.length === 0) {
      empty.hidden = false;
      $("#progressWrap").hidden = true;
      return;
    }
    empty.hidden = true;

    let doneCount = 0;
    const now = nowHM();

    doses.forEach((d0) => {
      const taken = isTaken(d0);
      if (taken) doneCount++;
      const overdue = !taken && d0.time <= now;

      const li = document.createElement("li");
      li.className = "dose-card" + (taken ? " done" : overdue ? " overdue" : "");

      const badge = overdue ? `<span class="badge">該吃了</span>` : "";
      const noteHtml = d0.note ? ` · ${escapeHtml(d0.note)}` : "";
      li.innerHTML = `
        <div class="time">${d0.time}</div>
        <div class="info">
          <div class="name">${escapeHtml(d0.name)}${badge}</div>
          <div class="sub">${escapeHtml(d0.dose)}${noteHtml}</div>
        </div>
        <button class="check" aria-label="標記為已服用">✓</button>`;

      li.querySelector(".check").addEventListener("click", () => {
        const willTake = !taken;
        setTaken(d0, willTake);
        renderAll();
        toast(willTake ? `已服用：${d0.name} ${d0.time}` : "已取消勾選");
      });
      list.appendChild(li);
    });

    // 進度條
    $("#progressWrap").hidden = false;
    const pct = Math.round((doneCount / doses.length) * 100);
    $("#progressFill").style.width = pct + "%";
    $("#progressText").textContent = `${doneCount}/${doses.length} 已服用`;
  }

  // ---------- 畫面：我的藥物 ----------
  function renderMeds() {
    const list = $("#medList");
    const empty = $("#medsEmpty");
    list.innerHTML = "";

    if (meds.length === 0) { empty.hidden = false; return; }
    empty.hidden = true;

    meds.forEach((m) => {
      const li = document.createElement("li");
      li.className = "med-card";
      const times = (m.times || []).slice().sort().join("、") || "未設定時間";
      const noteHtml = m.note ? ` · ${escapeHtml(m.note)}` : "";
      li.innerHTML = `
        <span class="pill-dot"></span>
        <div class="m-info">
          <div class="m-name">${escapeHtml(m.name)}</div>
          <div class="m-sub">${escapeHtml(fmtDose(m))} · 每日 ${m.times.length} 次（${escapeHtml(times)}）${noteHtml}</div>
        </div>
        <span class="chev">›</span>`;
      li.addEventListener("click", () => openModal(m.id));
      list.appendChild(li);
    });
  }

  function renderAll() { renderToday(); renderMeds(); }

  // ---------- 新增 / 編輯彈窗 ----------
  let editingId = null;

  function addTimeChip(value) {
    const wrap = $("#timesWrap");
    const chip = document.createElement("div");
    chip.className = "time-chip";
    chip.innerHTML = `<input type="time" value="${value || "08:00"}" />
                      <button type="button" class="rm" aria-label="移除時間">×</button>`;
    chip.querySelector(".rm").addEventListener("click", () => chip.remove());
    wrap.appendChild(chip);
  }

  function openModal(id) {
    editingId = id || null;
    const form = $("#medForm");
    form.reset();
    $("#timesWrap").innerHTML = "";

    if (id) {
      const m = meds.find((x) => x.id === id);
      if (!m) return;
      $("#modalTitle").textContent = "編輯藥物";
      $("#medName").value = m.name;
      $("#medDose").value = m.dose;
      $("#medUnit").value = m.unit;
      $("#medNote").value = m.note || "";
      (m.times.length ? m.times : ["08:00"]).forEach(addTimeChip);
      $("#deleteMedBtn").hidden = false;
    } else {
      $("#modalTitle").textContent = "新增藥物";
      addTimeChip("08:00");
      $("#deleteMedBtn").hidden = true;
    }
    $("#medModal").hidden = false;
  }

  function closeModal() { $("#medModal").hidden = true; editingId = null; }

  function collectTimes() {
    const inputs = [...$("#timesWrap").querySelectorAll('input[type="time"]')];
    const set = new Set();
    inputs.forEach((i) => { if (i.value) set.add(i.value); });
    return [...set].sort();
  }

  function submitMed(e) {
    e.preventDefault();
    const name = $("#medName").value.trim();
    const dose = $("#medDose").value;
    const unit = $("#medUnit").value;
    const note = $("#medNote").value.trim();
    const times = collectTimes();

    if (!name) { toast("請輸入藥物名稱"); return; }
    if (times.length === 0) { toast("請至少設定一個服用時間"); return; }

    if (editingId) {
      const m = meds.find((x) => x.id === editingId);
      Object.assign(m, { name, dose, unit, note, times });
      toast("已更新藥物");
    } else {
      meds.push({ id: uid(), name, dose, unit, note, times, createdAt: Date.now() });
      toast("已新增藥物");
    }
    saveMeds();
    closeModal();
    renderAll();
  }

  function deleteMed() {
    if (!editingId) return;
    const m = meds.find((x) => x.id === editingId);
    if (!confirm(`確定要刪除「${m ? m.name : ""}」嗎？`)) return;
    meds = meds.filter((x) => x.id !== editingId);
    saveMeds();
    closeModal();
    renderAll();
    toast("已刪除");
  }

  // ---------- 分頁切換 ----------
  function switchView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $(`#view-${name}`).classList.add("active");
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.view === name));
  }

  // ---------- 通知 / 提醒 ----------
  let swReg = null;

  function refreshNotifyBtn() {
    const btn = $("#notifyBtn");
    if (!("Notification" in window)) { btn.style.display = "none"; return; }
    const on = Notification.permission === "granted";
    btn.classList.toggle("on", on);
    btn.title = on ? "提醒通知已開啟" : "開啟提醒通知";
  }

  async function toggleNotify() {
    if (!("Notification" in window)) { toast("此裝置不支援通知"); return; }
    if (Notification.permission === "granted") {
      toast("提醒通知已開啟，到時間會主動提醒你");
      showNotification("吃藥提醒測試", "通知運作正常，到服用時間我會提醒你 👍");
      return;
    }
    if (Notification.permission === "denied") {
      toast("通知被瀏覽器封鎖，請到瀏覽器設定中開啟");
      return;
    }
    const perm = await Notification.requestPermission();
    refreshNotifyBtn();
    if (perm === "granted") {
      toast("已開啟提醒通知！");
      showNotification("吃藥提醒已開啟", "到了服用時間，我會在這裡提醒你 🔔");
    } else {
      toast("尚未開啟通知");
    }
  }

  function showNotification(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = {
      body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "tfm-reminder",
      renotify: true,
      vibrate: [120, 60, 120],
    };
    try {
      if (swReg && swReg.showNotification) swReg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch (e) {
      try { new Notification(title, opts); } catch (_) {}
    }
  }

  // 提醒排程：App 開著時，每分鐘檢查是否有「已到時間、尚未服用、尚未提醒過」的劑量
  function getNotified() {
    const all = store.read(KEY_NOTIFIED, {});
    return all[todayKey()] || [];
  }
  function markNotified(id) {
    const all = store.read(KEY_NOTIFIED, {});
    const k = todayKey();
    if (!all[k]) all[k] = [];
    if (!all[k].includes(id)) all[k].push(id);
    // 清掉舊日期，避免無限增長
    Object.keys(all).forEach((day) => { if (day !== k) delete all[day]; });
    store.write(KEY_NOTIFIED, all);
  }

  let lastCheckedDay = todayKey();

  function checkReminders() {
    // 跨日：重新整理畫面
    const tk = todayKey();
    if (tk !== lastCheckedDay) { lastCheckedDay = tk; renderAll(); }

    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const now = nowHM();
    const notified = getNotified();
    const doses = todaysDoses();
    const dayLog = logs[todayKey()] || {};
    const takenIds = Object.keys(dayLog);

    const due = T.computeDue(doses, now, takenIds, notified);
    due.forEach((d) => markNotified(doseId(d)));

    if (due.length === 1) {
      const d = due[0];
      showNotification("💊 該吃藥囉", `${d.time} ${d.name}（${d.dose}）${d.note ? " · " + d.note : ""}`);
    } else if (due.length > 1) {
      showNotification("💊 該吃藥囉", `你有 ${due.length} 項藥物到了服用時間，快打開確認吧。`);
    }
  }

  // ---------- 啟動 ----------
  function init() {
    // 分頁
    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => switchView(t.dataset.view)));

    // 藥物表單
    $("#addMedBtn").addEventListener("click", () => openModal());
    $("#addTimeBtn").addEventListener("click", () => addTimeChip("12:00"));
    $("#cancelBtn").addEventListener("click", closeModal);
    $("#deleteMedBtn").addEventListener("click", deleteMed);
    $("#medForm").addEventListener("submit", submitMed);
    $("#medModal").addEventListener("click", (e) => {
      if (e.target.id === "medModal") closeModal();
    });

    // 通知
    $("#notifyBtn").addEventListener("click", toggleNotify);
    refreshNotifyBtn();

    renderAll();

    // 排程：每 30 秒檢查一次；回到前景時也立即檢查
    setInterval(checkReminders, 30 * 1000);
    setTimeout(checkReminders, 1500);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { renderAll(); checkReminders(); }
    });

    // 註冊 Service Worker（離線可用 + 顯示通知）
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js")
        .then((reg) => { swReg = reg; })
        .catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
