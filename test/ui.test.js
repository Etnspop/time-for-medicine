/* 介面 + 功能整合測試：用 jsdom 載入真實的 index.html + logic.js + app.js，
 * 模擬使用者操作（開 App、新增藥物、勾選、處方箋…）。
 * 執行：node --test test/ui.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const htmlSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const logicSrc = fs.readFileSync(path.join(ROOT, "js/logic.js"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");

// 啟動一個乾淨的 App 實例
function boot() {
  const dom = new JSDOM(htmlSrc, {
    url: "https://example.org/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  // 避免背景計時器讓測試 process 卡住
  window.setInterval = () => 0;
  window.setTimeout = () => 0;
  window.confirm = () => true; // 刪除確認一律同意
  window.localStorage.clear();
  window.eval(logicSrc);
  window.eval(appSrc);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return window;
}

const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => [...w.document.querySelectorAll(sel)];
function fire(w, el, type) { el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true })); }

function addMed(w, { name, dose = "1", unit = "顆", time = "08:00" }) {
  $(w, "#addMedBtn").click();
  $(w, "#medName").value = name;
  $(w, "#medDose").value = dose;
  $(w, "#medUnit").value = unit;
  const timeInput = $(w, "#timesWrap input[type=time]");
  if (timeInput) timeInput.value = time;
  fire(w, $(w, "#medForm"), "submit");
}

// ---------- 開啟畫面 ----------

test("開 App：彈窗預設隱藏、停在今日、顯示空狀態", () => {
  const w = boot();
  assert.strictEqual($(w, "#medModal").hidden, true, "藥物彈窗應隱藏");
  assert.strictEqual($(w, "#rxModal").hidden, true, "處方箋彈窗應隱藏");
  assert.strictEqual($(w, "#view-today").classList.contains("active"), true);
  assert.strictEqual($(w, "#todayEmpty").hidden, false, "無藥物時應顯示今日空狀態");
  assert.strictEqual($(w, "#medsEmpty").hidden, false);
});

// ---------- 新增藥物 ----------

test("點新增藥物：彈窗打開、標題正確、預設一個時間", () => {
  const w = boot();
  $(w, "#addMedBtn").click();
  assert.strictEqual($(w, "#medModal").hidden, false, "點擊後彈窗應顯示");
  assert.strictEqual($(w, "#modalTitle").textContent, "新增藥物");
  assert.strictEqual($$(w, "#timesWrap input[type=time]").length, 1);
});

test("新增藥物後：彈窗關閉、出現在清單與今日（回報的 bug）", () => {
  const w = boot();
  addMed(w, { name: "血壓藥", dose: "1", unit: "顆", time: "08:00" });

  // 關鍵：存檔後彈窗必須關閉，不能停留在新增畫面
  assert.strictEqual($(w, "#medModal").hidden, true, "存檔後彈窗應關閉");
  assert.strictEqual($$(w, "#medList .med-card").length, 1, "藥物清單應有 1 筆");
  assert.strictEqual($(w, "#medsEmpty").hidden, true);
  assert.strictEqual($$(w, "#todayList .dose-card").length, 1, "今日應出現該劑量");
  assert.match($(w, "#todayList .dose-card .name").textContent, /血壓藥/);
});

test("一天多次：兩個時間 → 今日出現兩筆並依時間排序", () => {
  const w = boot();
  $(w, "#addMedBtn").click();
  $(w, "#medName").value = "甲狀腺素";
  $(w, "#medDose").value = "1";
  $(w, "#timesWrap input[type=time]").value = "20:00";
  $(w, "#addTimeBtn").click();
  $$(w, "#timesWrap input[type=time]")[1].value = "08:00";
  fire(w, $(w, "#medForm"), "submit");

  const times = $$(w, "#todayList .dose-card .time").map((e) => e.textContent);
  assert.deepStrictEqual(times, ["08:00", "20:00"], "今日劑量應依時間排序");
});

test("驗證：沒填名稱不會新增、彈窗保持開啟", () => {
  const w = boot();
  $(w, "#addMedBtn").click();
  $(w, "#medDose").value = "1";
  fire(w, $(w, "#medForm"), "submit");
  assert.strictEqual($(w, "#medModal").hidden, false, "驗證失敗時彈窗應仍開著");
  assert.strictEqual($$(w, "#medList .med-card").length, 0, "不應新增任何藥物");
});

// ---------- 今日勾選 ----------

test("勾選今日劑量：標記完成、進度條更新", () => {
  const w = boot();
  addMed(w, { name: "維他命C" });
  assert.strictEqual($(w, "#progressText").textContent, "0/1 已服用");

  $(w, "#todayList .dose-card .check").click();
  assert.strictEqual($(w, "#todayList .dose-card").classList.contains("done"), true);
  assert.strictEqual($(w, "#progressText").textContent, "1/1 已服用");

  // 再點一次取消
  $(w, "#todayList .dose-card .check").click();
  assert.strictEqual($(w, "#progressText").textContent, "0/1 已服用");
});

// ---------- 編輯 / 刪除藥物 ----------

test("點藥物卡 → 編輯彈窗帶入資料；刪除後清單清空", () => {
  const w = boot();
  addMed(w, { name: "鈣片", dose: "2", unit: "錠" });

  $(w, "#medList .med-card").click();
  assert.strictEqual($(w, "#medModal").hidden, false);
  assert.strictEqual($(w, "#modalTitle").textContent, "編輯藥物");
  assert.strictEqual($(w, "#medName").value, "鈣片");
  assert.strictEqual($(w, "#deleteMedBtn").hidden, false);

  $(w, "#deleteMedBtn").click(); // confirm 已 stub 為 true
  assert.strictEqual($(w, "#medModal").hidden, true);
  assert.strictEqual($$(w, "#medList .med-card").length, 0);
  assert.strictEqual($(w, "#medsEmpty").hidden, false);
});

// ---------- 分頁切換 ----------

test("分頁切換：點處方箋分頁會切換 view 與 tab", () => {
  const w = boot();
  $$(w, ".tab").find((t) => t.dataset.view === "rx").click();
  assert.strictEqual($(w, "#view-rx").classList.contains("active"), true);
  assert.strictEqual($(w, "#view-today").classList.contains("active"), false);
  assert.strictEqual($(w, "#rxEmpty").hidden, false);
});

// ---------- 處方箋 ----------

function addRx(w, { name, start, end, note = "" }) {
  $(w, "#addRxBtn").click();
  $(w, "#rxName").value = name;
  if (note) $(w, "#rxNote").value = note;
  const row = $(w, "#refillsWrap .refill-edit");
  row.querySelector(".rf-start").value = start;
  row.querySelector(".rf-end").value = end;
  fire(w, $(w, "#rxForm"), "submit");
}

test("新增處方箋：彈窗關閉、清單出現、預設帶一個領藥區間", () => {
  const w = boot();
  $(w, "#addRxBtn").click();
  assert.strictEqual($(w, "#rxModal").hidden, false);
  assert.strictEqual($$(w, "#refillsWrap .refill-edit").length, 1, "預設應有一段領藥區間");

  $(w, "#rxName").value = "心臟科 王醫師";
  fire(w, $(w, "#rxForm"), "submit");

  assert.strictEqual($(w, "#rxModal").hidden, true, "存檔後彈窗應關閉");
  assert.strictEqual($$(w, "#rxList .rx-card").length, 1);
  assert.match($(w, "#rxList .rx-title").textContent, /心臟科/);
});

test("處方箋多次領藥：可加入多段區間", () => {
  const w = boot();
  $(w, "#addRxBtn").click();
  $(w, "#rxName").value = "新陳代謝科";
  $(w, "#addRefillBtn").click();
  $(w, "#addRefillBtn").click();
  assert.strictEqual($$(w, "#refillsWrap .refill-edit").length, 3, "可加到三段");
  fire(w, $(w, "#rxForm"), "submit");
  assert.strictEqual($$(w, "#rxList .refill-rows .refill-row").length, 3);
});

test("可領藥中：今日頁跳出領藥提醒橫幅", () => {
  const w = boot();
  const today = w.TFM.todayKey();
  const later = w.TFM.todayKey(new Date(Date.now() + 10 * 86400000));
  addRx(w, { name: "降血壓藥", start: today, end: later });

  assert.strictEqual($(w, "#refillBanner").hidden, false, "可領藥中應顯示橫幅");
  assert.match($(w, "#refillBanner").textContent, /可以去領藥|可領藥中/);
});

test("標記已領藥：狀態變為已領、橫幅消失", () => {
  const w = boot();
  const today = w.TFM.todayKey();
  const later = w.TFM.todayKey(new Date(Date.now() + 10 * 86400000));
  addRx(w, { name: "甲狀腺藥", start: today, end: later });

  const toggle = $(w, "#rxList .refill-row .rf-toggle");
  assert.strictEqual(toggle.textContent, "標記已領");
  toggle.click();

  assert.strictEqual($(w, "#rxList .refill-row").classList.contains("status-picked"), true);
  assert.strictEqual($(w, "#refillBanner").hidden, true, "全部已領後橫幅應消失");
});

// ---------- 本機儲存 ----------

test("資料寫入 localStorage（只存本機）", () => {
  const w = boot();
  addMed(w, { name: "鐵劑" });
  const saved = JSON.parse(w.localStorage.getItem("tfm.meds.v1"));
  assert.strictEqual(Array.isArray(saved), true);
  assert.strictEqual(saved[0].name, "鐵劑");

  // 重新啟動（沿用同一份 localStorage 內容）後資料仍在
  // 注意：boot() 會 clear，故這裡改為直接驗證 reload 行為由 store.read 決定
});

test("重新開啟 App：先前存在本機的資料會自動載入", () => {
  const dom = new JSDOM(htmlSrc, {
    url: "https://example.org/", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const w = dom.window;
  w.setInterval = () => 0; w.setTimeout = () => 0; w.confirm = () => true;
  w.localStorage.setItem("tfm.meds.v1", JSON.stringify([
    { id: "m1", name: "舊藥", dose: 1, unit: "顆", note: "", times: ["08:00"], createdAt: Date.now() },
  ]));
  w.localStorage.setItem("tfm.rx.v1", JSON.stringify([
    { id: "r1", name: "舊處方", note: "", refills: [{ id: "f1", start: "2026-06-01", end: "2026-06-15" }], createdAt: Date.now() },
  ]));
  w.eval(logicSrc); w.eval(appSrc);
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));

  assert.strictEqual($$(w, "#medList .med-card").length, 1, "應載回先前的藥物");
  assert.match($(w, "#medList .m-name").textContent, /舊藥/);
  $$(w, ".tab").find((t) => t.dataset.view === "rx").click();
  assert.strictEqual($$(w, "#rxList .rx-card").length, 1, "應載回先前的處方箋");
});

// ---------- CSS 回歸：hidden 一定隱藏 ----------

test("CSS：存在 [hidden] display:none !important 規則（修正彈窗常駐 bug）", () => {
  const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
  const normalized = css.replace(/\s+/g, " ");
  assert.match(
    normalized,
    /\[hidden\]\s*{\s*display:\s*none\s*!important;?\s*}/,
    "需有 [hidden]{display:none!important} 以蓋過 .modal/.progress-wrap 的 display"
  );
});
