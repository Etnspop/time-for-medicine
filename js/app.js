/* 吃藥時間 Time for Medicine
 * 純前端 PWA：所有資料只存在裝置本機 localStorage，不上傳任何伺服器。
 */
(function () {
  "use strict";

  // ---------- 儲存層（本機 localStorage） ----------
  const KEY_MEDS = "tfm.meds.v1";
  const KEY_LOGS = "tfm.logs.v1";        // { "YYYY-MM-DD": { "<medId>|<HH:MM>": ISOtime } }
  const KEY_RX = "tfm.rx.v1";            // 慢性處方箋 [{id,name,note,refills:[{id,start,end,pickedUp}]}]
  const KEY_NOTIFIED = "tfm.notified.v1"; // { "YYYY-MM-DD": { "<doseId>": 上次提醒毫秒, "rx|<id>": true } }
  const KEY_SETTINGS = "tfm.settings.v1"; // { repeatReminders: bool }
  const REPEAT_MS = 4 * 60 * 60 * 1000;   // 每 4 小時重複提醒

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
  let prescriptions = store.read(KEY_RX, []);
  let settings = store.read(KEY_SETTINGS, { repeatReminders: true });

  function saveMeds() { store.write(KEY_MEDS, meds); }
  function saveLogs() { store.write(KEY_LOGS, logs); }
  function saveRx() { store.write(KEY_RX, prescriptions); }
  function saveSettings() { store.write(KEY_SETTINGS, settings); }

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

  // 月曆狀態
  const _now = new Date();
  let calYear = _now.getFullYear();
  let calMonth = _now.getMonth();
  let selectedDay = null;

  function fmtDateZh(key) {
    const [y, m, dd] = key.split("-").map(Number);
    return `${m} 月 ${dd} 日（週${weekdayZh(new Date(y, m - 1, dd))}）`;
  }

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
  // 寫入/取消某一天的服用紀錄（可補登過去日期）
  function setTakenForDate(d, dateKey, taken) {
    if (!logs[dateKey]) logs[dateKey] = {};
    if (taken) logs[dateKey][doseId(d)] = new Date().toISOString();
    else delete logs[dateKey][doseId(d)];
    saveLogs();
  }
  function setTaken(d, taken) {
    setTakenForDate(d, todayKey(), taken);
  }

  // 把 "YYYY-MM-DD" 顯示成 "M/D"
  function fmtMD(key) {
    if (!key) return "—";
    const [, m, d] = key.split("-");
    return `${Number(m)}/${Number(d)}`;
  }

  // ---------- 畫面：今日領藥提醒橫幅 ----------
  function renderRxBanner() {
    const banner = $("#refillBanner");
    const alerts = T.activeRefillAlerts(prescriptions, todayKey(), 3);
    if (alerts.length === 0) { banner.hidden = true; return; }
    const open = banner.classList;
    const hasOpen = alerts.some((a) => a.status === "open");
    open.toggle("banner-open", hasOpen);
    const items = alerts.map((a) => {
      const range = `${fmtMD(a.refill.start)}–${fmtMD(a.refill.end)}`;
      if (a.status === "open") {
        const left = a.daysUntilEnd;
        const tail = left === 0 ? "（今天最後一天）" : left > 0 ? `（剩 ${left} 天）` : "";
        return `<b>${escapeHtml(a.rxName)}</b> 可領藥中 ${range}${tail}`;
      }
      return `<b>${escapeHtml(a.rxName)}</b> ${a.daysUntilStart} 天後開放領藥（${fmtMD(a.refill.start)} 起）`;
    }).join("<br>");
    const title = hasOpen ? "💊 可以去領藥囉" : "🔔 即將可領藥";
    banner.innerHTML = `<span class="banner-title">${title}</span>${items}`;
    banner.hidden = false;
  }

  // ---------- 畫面：今日 ----------
  function renderToday() {
    const d = new Date();
    $("#todayLabel").textContent =
      `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（週${weekdayZh(d)}）`;

    renderRxBanner();
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

  // ---------- 畫面：紀錄（月曆） ----------
  function renderCalendar() {
    $("#calTitle").textContent = `${calYear} 年 ${calMonth + 1} 月`;
    const grid = $("#calGrid");
    grid.innerHTML = "";
    const today = todayKey();
    T.buildMonth(calYear, calMonth).forEach((c) => {
      const div = document.createElement("div");
      if (!c.inMonth) { div.className = "cal-cell out"; grid.appendChild(div); return; }
      const st = T.dayStatus(meds, logs, c.dateKey, today);
      const dotClass = ["complete", "partial", "missed", "today-pending"].includes(st.status)
        ? st.status : "";
      div.className = "cal-cell" +
        (c.dateKey === today ? " today" : "") +
        (c.dateKey === selectedDay ? " selected" : "");
      div.innerHTML = `<span>${c.day}</span><span class="cdot ${dotClass}"></span>`;
      div.addEventListener("click", () => {
        selectedDay = c.dateKey;
        renderCalendar();
        renderDayDetail(c.dateKey);
      });
      grid.appendChild(div);
    });
  }

  function renderDayDetail(dateKey) {
    const box = $("#dayDetail");
    const scheduled = T.scheduledDosesForDate(meds, dateKey);
    box.hidden = false;
    if (scheduled.length === 0) {
      box.innerHTML = `<h4>${fmtDateZh(dateKey)}</h4><p class="muted small">這天沒有排定服藥。</p>`;
      return;
    }
    // 今天（含）以前可以補勾／取消；未來日期唯讀
    const editable = dateKey <= todayKey();
    const dayLog = logs[dateKey] || {};
    const rows = scheduled.map((d) => {
      const id = doseId(d);
      const taken = !!dayLog[id];
      const mark = editable
        ? `<button type="button" class="d-check${taken ? " on" : ""}" data-id="${escapeHtml(id)}" aria-label="切換已服用">✓</button>`
        : (taken ? `<span class="d-mark yes">✓</span>` : `<span class="d-mark no">○</span>`);
      return `<div class="d-row${taken ? " taken" : ""}">
        <span class="d-time">${d.time}</span>
        <span class="d-name">${escapeHtml(d.name)}（${escapeHtml(d.dose)}）</span>
        ${mark}</div>`;
    }).join("");
    const hint = editable
      ? `<p class="muted small detail-hint">忘了勾選嗎？點右邊的圈圈就能補登。</p>`
      : "";
    box.innerHTML = `<h4>${fmtDateZh(dateKey)}</h4>${hint}${rows}`;

    if (editable) {
      box.querySelectorAll(".d-check").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          const d = scheduled.find((x) => doseId(x) === id);
          if (!d) return;
          const willTake = !(logs[dateKey] && logs[dateKey][id]);
          setTakenForDate(d, dateKey, willTake);
          renderCalendar();
          renderDayDetail(dateKey);
          if (dateKey === todayKey()) renderToday();
          toast(willTake ? "已補登完成" : "已取消");
        });
      });
    }
  }

  function renderHistory() {
    renderCalendar();
    if (selectedDay) renderDayDetail(selectedDay);
  }

  // ---------- 畫面：處方箋 ----------
  const RX_STATUS_LABEL = {
    open: "可領藥中",
    upcoming: "尚未開放",
    missed: "已過期未領",
    picked: "已領藥 ✓",
  };

  function renderRx() {
    const list = $("#rxList");
    const empty = $("#rxEmpty");
    list.innerHTML = "";

    if (prescriptions.length === 0) { empty.hidden = false; return; }
    empty.hidden = true;

    const today = todayKey();
    prescriptions.forEach((rx) => {
      const li = document.createElement("li");
      li.className = "rx-card";

      const refills = (rx.refills || []).slice().sort((a, b) =>
        (a.start || "").localeCompare(b.start || ""));

      const rowsHtml = refills.length
        ? refills.map((r) => {
            const st = T.refillStatus(r, today);
            let info = RX_STATUS_LABEL[st];
            if (st === "upcoming") {
              const d = T.daysUntil(r.start, today);
              info = `${d} 天後開放（${fmtMD(r.start)} 起）`;
            } else if (st === "open") {
              const left = T.daysUntil(r.end, today);
              info = left === 0 ? "可領藥中（今天最後一天）" : `可領藥中（剩 ${left} 天）`;
            }
            const btn = st === "picked" ? "取消領藥" : "標記已領";
            return `<li class="refill-row status-${st}" data-rid="${r.id}">
              <span class="rf-range">${fmtMD(r.start)}–${fmtMD(r.end)}</span>
              <span class="rf-status">${info}</span>
              <button type="button" class="rf-toggle">${btn}</button>
            </li>`;
          }).join("")
        : `<li class="refill-row"><span class="rf-status muted">尚未設定領藥區間</span></li>`;

      const noteHtml = rx.note ? `<div class="rx-note muted small">${escapeHtml(rx.note)}</div>` : "";
      li.innerHTML = `
        <div class="rx-head">
          <span class="rx-title">${escapeHtml(rx.name || "處方箋")}</span>
          <button type="button" class="rx-edit">編輯</button>
        </div>
        ${noteHtml}
        <ul class="refill-rows">${rowsHtml}</ul>`;

      li.querySelector(".rx-edit").addEventListener("click", () => openRxModal(rx.id));
      li.querySelectorAll(".rf-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
          const rid = btn.closest(".refill-row").dataset.rid;
          toggleRefillPicked(rx.id, rid);
        });
      });
      list.appendChild(li);
    });
  }

  function toggleRefillPicked(rxId, refillId) {
    const rx = prescriptions.find((x) => x.id === rxId);
    if (!rx) return;
    const r = (rx.refills || []).find((x) => x.id === refillId);
    if (!r) return;
    r.pickedUp = !r.pickedUp;
    r.pickedUpAt = r.pickedUp ? new Date().toISOString() : null;
    saveRx();
    renderRx();
    renderToday();
    toast(r.pickedUp ? "已標記領藥 ✓" : "已取消");
  }

  function renderAll() { renderToday(); renderMeds(); renderHistory(); renderRx(); }

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
    syncPush();
  }

  function deleteMed() {
    if (!editingId) return;
    const m = meds.find((x) => x.id === editingId);
    if (!confirm(`確定要刪除「${m ? m.name : ""}」嗎？`)) return;
    meds = meds.filter((x) => x.id !== editingId);
    saveMeds();
    closeModal();
    renderAll();
    syncPush();
    toast("已刪除");
  }

  // ---------- 處方箋的新增 / 編輯彈窗 ----------
  let editingRxId = null;

  // 預設新領藥區間：開始=今天、結束=今天+13 天（慢箋一段約 14 天領藥彈性，使用者可改）
  function defaultRefillRange() {
    const start = todayKey();
    const end = todayKey(new Date(Date.now() + 13 * 86400000));
    return { start, end };
  }

  function addRefillRow(refill) {
    const wrap = $("#refillsWrap");
    const r = refill || defaultRefillRange();
    const row = document.createElement("div");
    row.className = "refill-edit";
    row.innerHTML = `
      <input type="date" class="rf-start" value="${r.start || ""}" />
      <span class="sep">～</span>
      <input type="date" class="rf-end" value="${r.end || ""}" />
      <button type="button" class="rf-rm" aria-label="移除這次領藥">×</button>`;
    row.querySelector(".rf-rm").addEventListener("click", () => row.remove());
    wrap.appendChild(row);
  }

  function collectRefills(existing) {
    // existing：原處方箋的 refills，用來保留 pickedUp 狀態（依序對應）
    const rows = [...$("#refillsWrap").querySelectorAll(".refill-edit")];
    const prev = existing || [];
    return rows.map((row, i) => {
      const start = row.querySelector(".rf-start").value;
      const end = row.querySelector(".rf-end").value;
      const old = prev[i] || {};
      return {
        id: old.id || uid(),
        start,
        end,
        pickedUp: !!old.pickedUp,
        pickedUpAt: old.pickedUpAt || null,
      };
    }).filter((r) => r.start || r.end);
  }

  function openRxModal(id) {
    editingRxId = id || null;
    $("#rxForm").reset();
    $("#refillsWrap").innerHTML = "";

    if (id) {
      const rx = prescriptions.find((x) => x.id === id);
      if (!rx) return;
      $("#rxModalTitle").textContent = "編輯處方箋";
      $("#rxName").value = rx.name || "";
      $("#rxNote").value = rx.note || "";
      const refills = (rx.refills || []).slice().sort((a, b) =>
        (a.start || "").localeCompare(b.start || ""));
      (refills.length ? refills : [defaultRefillRange()]).forEach(addRefillRow);
      $("#deleteRxBtn").hidden = false;
    } else {
      $("#rxModalTitle").textContent = "新增處方箋";
      addRefillRow();
      $("#deleteRxBtn").hidden = true;
    }
    $("#rxModal").hidden = false;
  }

  function closeRxModal() { $("#rxModal").hidden = true; editingRxId = null; }

  function submitRx(e) {
    e.preventDefault();
    const name = $("#rxName").value.trim();
    const note = $("#rxNote").value.trim();

    if (!name) { toast("請輸入處方箋名稱"); return; }

    const existing = editingRxId
      ? ((prescriptions.find((x) => x.id === editingRxId) || {}).refills || [])
      : [];
    const sortedExisting = existing.slice().sort((a, b) =>
      (a.start || "").localeCompare(b.start || ""));
    const refills = collectRefills(sortedExisting);

    if (refills.length === 0) { toast("請至少設定一次領藥區間"); return; }
    if (refills.some((r) => !r.start || !r.end)) { toast("每次領藥都要填開始與結束日期"); return; }
    if (refills.some((r) => r.end < r.start)) { toast("結束日期不能早於開始日期"); return; }

    if (editingRxId) {
      const rx = prescriptions.find((x) => x.id === editingRxId);
      Object.assign(rx, { name, note, refills });
      toast("已更新處方箋");
    } else {
      prescriptions.push({ id: uid(), name, note, refills, createdAt: Date.now() });
      toast("已新增處方箋");
    }
    saveRx();
    closeRxModal();
    renderRx();
    renderToday();
  }

  function deleteRx() {
    if (!editingRxId) return;
    const rx = prescriptions.find((x) => x.id === editingRxId);
    if (!confirm(`確定要刪除「${rx ? rx.name : ""}」嗎？`)) return;
    prescriptions = prescriptions.filter((x) => x.id !== editingRxId);
    saveRx();
    closeRxModal();
    renderRx();
    renderToday();
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

  // ---------- 背景推播（Web Push，需搭配 server/ 的 Cloudflare Worker） ----------
  const PUSH_CFG = window.PUSH_CONFIG || {};

  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }
  function pushConfigured() {
    return !!(PUSH_CFG.workerUrl && PUSH_CFG.vapidPublicKey);
  }
  function deviceTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
    catch (_) { return "UTC"; }
  }
  function urlB64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function getPushSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  function postToWorker(path, payload) {
    return fetch(PUSH_CFG.workerUrl.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
  async function enablePush() {
    if (!pushSupported()) { toast("此裝置/瀏覽器不支援背景推播"); return; }
    if (!pushConfigured()) { toast("尚未設定推播伺服器（見 server/SETUP.md）"); return; }
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast("需要允許通知才能啟用"); return; }
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(PUSH_CFG.vapidPublicKey),
      });
      const res = await postToWorker("/subscribe", {
        subscription: sub.toJSON(), times: T.uniqueDoseTimes(meds), tz: deviceTz(),
      });
      if (!res.ok) throw new Error("server");
      toast("已啟用背景推播！");
    } catch (e) {
      toast("啟用失敗，請確認伺服器設定");
    }
    updatePushUI();
  }
  async function disablePush() {
    try {
      const sub = await getPushSub();
      if (sub) {
        if (pushConfigured()) await postToWorker("/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      toast("已關閉背景推播");
    } catch (e) { /* ignore */ }
    updatePushUI();
  }
  // 藥物時間有變動時，更新伺服器上的排程（若已訂閱）
  async function syncPush() {
    if (!pushSupported() || !pushConfigured()) return;
    try {
      const sub = await getPushSub();
      if (sub) postToWorker("/subscribe", {
        subscription: sub.toJSON(), times: T.uniqueDoseTimes(meds), tz: deviceTz(),
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }
  async function updatePushUI() {
    const group = $("#pushGroup");
    if (!group) return;
    // 尚未設定推播伺服器 → 整個區塊先隱藏，等填好 push-config.js 才顯示
    if (!pushConfigured()) { group.hidden = true; return; }
    group.hidden = false;
    const btn = $("#pushBtn");
    const status = $("#pushStatus");
    if (!pushSupported()) {
      status.textContent = "此裝置或瀏覽器不支援背景推播（App 內提醒仍可使用）。";
      btn.disabled = true; btn.textContent = "無法使用"; btn.onclick = null;
      return;
    }
    btn.disabled = false;
    const sub = await getPushSub();
    if (sub) {
      status.textContent = "背景推播已啟用：關閉 App 也會在服藥時間提醒你。";
      btn.textContent = "關閉背景推播"; btn.onclick = disablePush;
    } else {
      status.textContent = "尚未啟用。";
      btn.textContent = "啟用背景推播"; btn.onclick = enablePush;
    }
  }

  // 提醒紀錄：每天一個物件 { "<doseId>": 上次提醒毫秒, "rx|<id>": true }
  function getRemindMap() {
    const all = store.read(KEY_NOTIFIED, {});
    const day = all[todayKey()];
    return day && !Array.isArray(day) ? day : {};
  }
  function saveRemindMap(map) {
    const all = store.read(KEY_NOTIFIED, {});
    const k = todayKey();
    all[k] = map;
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
    const nowEpoch = Date.now();
    const doses = todaysDoses();
    const dayLog = logs[tk] || {};
    const takenIds = Object.keys(dayLog);
    const map = getRemindMap();
    let changed = false;

    // 服藥提醒：到時間未服用就提醒；若開啟重複提醒，每 4 小時再提醒一次，直到勾選或今天結束
    const repeat = settings.repeatReminders !== false;
    const toRemind = T.computeReminders(doses, now, nowEpoch, map, takenIds, { repeat, repeatMs: REPEAT_MS });
    toRemind.forEach((d) => { map[doseId(d)] = nowEpoch; changed = true; });

    if (toRemind.length === 1) {
      const d = toRemind[0];
      showNotification("💊 該吃藥囉", `${d.time} ${d.name}（${d.dose}）${d.note ? " · " + d.note : ""}`);
    } else if (toRemind.length > 1) {
      showNotification("💊 該吃藥囉", `你有 ${toRemind.length} 項藥還沒服用，快打開確認吧。`);
    }

    // 領藥提醒：每張處方箋每次領藥，開放當天提醒一次
    const alerts = T.activeRefillAlerts(prescriptions, tk, 0); // 只在「可領藥中」才通知
    alerts.forEach((a) => {
      const key = "rx|" + a.refillId;
      if (a.status === "open" && !map[key]) {
        map[key] = true;
        changed = true;
        const left = a.daysUntilEnd;
        const tail = left === 0 ? "（今天最後一天）" : left > 0 ? `，領藥期限到 ${fmtMD(a.refill.end)}` : "";
        showNotification("💊 可以去領藥囉", `${a.rxName} 現在可以領藥了${tail}。`);
      }
    });

    if (changed) saveRemindMap(map);
  }

  // ---------- 匯出 / 匯入備份 ----------
  function exportData() {
    const data = {
      app: "time-for-medicine", version: 2,
      exportedAt: new Date().toISOString(), meds, logs, prescriptions, settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `吃藥時間-備份-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("已匯出備份檔");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.meds)) throw new Error("格式不符");
        const rxCount = Array.isArray(data.prescriptions) ? data.prescriptions.length : 0;
        if (!confirm(`這會以備份內容「取代」目前資料（${data.meds.length} 種藥物、${rxCount} 張處方箋）。確定還原嗎？`)) return;
        meds = data.meds;
        logs = data.logs && typeof data.logs === "object" ? data.logs : {};
        prescriptions = Array.isArray(data.prescriptions) ? data.prescriptions : [];
        if (data.settings && typeof data.settings === "object") {
          settings = data.settings;
          saveSettings();
          $("#repeatToggle").checked = settings.repeatReminders !== false;
        }
        saveMeds();
        saveLogs();
        saveRx();
        selectedDay = null;
        $("#dayDetail").hidden = true;
        renderAll();
        toast("已從備份還原");
      } catch (e) {
        toast("無法讀取此備份檔");
      }
    };
    reader.readAsText(file);
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

    // 處方箋表單
    $("#addRxBtn").addEventListener("click", () => openRxModal());
    $("#addRefillBtn").addEventListener("click", () => addRefillRow());
    $("#rxCancelBtn").addEventListener("click", closeRxModal);
    $("#deleteRxBtn").addEventListener("click", deleteRx);
    $("#rxForm").addEventListener("submit", submitRx);
    $("#rxModal").addEventListener("click", (e) => {
      if (e.target.id === "rxModal") closeRxModal();
    });

    // 月曆切換月份
    $("#calPrev").addEventListener("click", () => {
      if (--calMonth < 0) { calMonth = 11; calYear--; }
      selectedDay = null; $("#dayDetail").hidden = true; renderCalendar();
    });
    $("#calNext").addEventListener("click", () => {
      if (++calMonth > 11) { calMonth = 0; calYear++; }
      selectedDay = null; $("#dayDetail").hidden = true; renderCalendar();
    });

    // 更多：備份與通知
    $("#exportBtn").addEventListener("click", exportData);
    $("#importBtn").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) importData(f);
      e.target.value = "";
    });
    $("#moreNotifyBtn").addEventListener("click", toggleNotify);

    // 重複提醒設定
    const repeatToggle = $("#repeatToggle");
    repeatToggle.checked = settings.repeatReminders !== false;
    repeatToggle.addEventListener("change", () => {
      settings.repeatReminders = repeatToggle.checked;
      saveSettings();
      toast(repeatToggle.checked ? "已開啟：未服藥每 4 小時提醒" : "已關閉重複提醒");
    });

    // 通知
    $("#notifyBtn").addEventListener("click", toggleNotify);
    refreshNotifyBtn();
    updatePushUI();

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
