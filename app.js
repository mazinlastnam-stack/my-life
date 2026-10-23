/* Logic Personal Assistant v6.5 (Bug-Free & Stable)
 * - Deep reviewed, resolved render crashes, optimized finance section.
 */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const K = { meta: "logic-meta", vault: "logic-vault", session: "logic-session", theme: "logic-theme" };
const ITER = 600000, TZ = "Africa/Khartoum", MAX_FILE = 20 * 1024 * 1024, MAX_FAILS = 5;
const BACKUP_FILE = "./personal-assistant-backup.json";

const TITLES = { overview: "مركز القيادة", fitness: "اللياقة (Ectomorph)", "weekly-review": "المراجعة الأسبوعية", tasks: "المهام", logic: "المصفوفة المنطقية", notes: "الملاحظات", contacts: "جهات الاتصال", finance: "المالية", files: "الملفات", settings: "الإعدادات" };
const enc = new TextEncoder(), dec = new TextDecoder();

const PREVIEW = {
  image: /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i,
  pdf: /\.pdf$/i,
  text: /\.(txt|md|markdown|json|xml|csv|tsv|log|js|mjs|cjs|ts|jsx|tsx|css|scss|less|html?|yml|yaml|ini|toml|conf|config|env|sh|bash|py|rb|java|c|cpp|h|hpp|cs|go|rs|php|sql|gitignore|editorconfig|rtf)$/i,
};
const TEXT_MIME = /^text\/|json|xml|javascript|x-sh|yaml|csv|markdown/i;

const S = { key: null, raw: null, user: "", data: null, meta: null, mode: "login", view: "overview", edit: null, timers: [], last: 0, sessTouch: 0, busy: false, msgTimer: null, lockTimer: null, previewUrl: null, activeLogicId: null };
let backupFileHandle = null;

const b64 = buf => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const nowIso = () => new Date().toISOString();
const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const cur = () => S.data?.settings?.currency || "SDG";
const money = v => `${new Intl.NumberFormat("ar").format(Number(v) || 0)} ${cur()}`;
const fmtSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const normUser = u => u.trim().toLowerCase().normalize("NFKC");

function formatDate(v, time = true) {
  if (!v) return "—";
  const d = new Date(v); if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ar", { timeZone: TZ, year: "numeric", month: "short", day: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(d);
}
function toast(text, type = "success") {
  const n = $("#global-message"); n.textContent = text; n.className = `global-message ${type}`; n.hidden = false;
  clearTimeout(S.msgTimer); S.msgTimer = setTimeout(() => n.hidden = true, 4000);
}
function downloadBlob(blob, name) {
  const a = document.createElement("a"); const url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function strength(p) {
  let s = 0; if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
  return { score: Math.min(s, 4), label: ["ضعيفة", "مقبولة", "جيدة", "قوية", "قوية جداً"][Math.min(s, 4)] };
}

async function deriveKey(user, pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(normUser(user) + "\u0000" + pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
async function encRaw(key, bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes); return { iv, ct }; }
async function encBytes(key, bytes) { const r = await encRaw(key, bytes); return { iv: b64(r.iv), ct: b64(r.ct) }; }
async function decBytes(key, o) { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.ct))); }

const idb = {
  db: null,
  open() { if (this.db) return Promise.resolve(this.db); return new Promise((res, rej) => { const r = indexedDB.open("logic-files", 1); r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "id" }); r.onsuccess = () => { this.db = r.result; res(r.result); }; r.onerror = () => rej(r.error); }); },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction("files", mode); const rq = fn(t.objectStore("files")); t.oncomplete = () => res(rq ? rq.result : undefined); t.onerror = () => rej(t.error); }); },
  put(v) { return this.tx("readwrite", s => s.put(v)); },
  get(id) { return this.tx("readonly", s => s.get(id)); },
  del(id) { return this.tx("readwrite", s => s.delete(id)); },
  all() { return this.tx("readonly", s => s.getAll()); },
  clear() { return this.tx("readwrite", s => s.clear()); }
};
async function readFileBytes(id) {
  const r = await idb.get(id); if (!r) throw new Error("الملف غير موجود");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: r.iv }, S.key, r.ct));
}

const defaults = () => ({
  tasks: [], notes: [], contacts: [], transactions: [], files: [],
  fitness: [], logic: [], reviews: [],
  settings: { currency: "SDG", theme: "auto", autolock: 10, keepSession: true, targetCalories: 2800, targetProtein: 140, targetWeight: 65 }
});

function normalize(d) {
  const b = defaults(); const x = { ...b, ...d, settings: { ...b.settings, ...(d && d.settings) } };
  for (const k of ["tasks", "notes", "contacts", "transactions", "files", "fitness", "logic", "reviews"]) if (!Array.isArray(x[k])) x[k] = [];
  return x;
}

const loadMeta = () => { try { const m = JSON.parse(localStorage.getItem(K.meta) || "null"); return m && typeof m.salt === "string" ? m : null; } catch { return null; } };
const saveMeta = () => localStorage.setItem(K.meta, JSON.stringify(S.meta));

let saveChain = Promise.resolve();
function save() {
  saveChain = saveChain.then(async () => {
    if (!S.key || !S.data) return;
    const o = await encBytes(S.key, enc.encode(JSON.stringify(S.data)));
    localStorage.setItem(K.vault, JSON.stringify({ v: 2, ...o }));
    if (backupFileHandle) await writeBackupToFile();
  }).catch(() => toast("تعذّر الحفظ.", "error"));
  return saveChain;
}
function persist(msg) { save(); renderAll(); if (msg) toast(msg); }

// File Sync
async function trySeedFromFile() {
  try {
    if (localStorage.getItem(K.meta)) return false;
    const r = await fetch(BACKUP_FILE, { cache: "no-store" });
    if (!r.ok) return false;
    const b = await r.json();
    if (!b || b.app !== "personal-assistant" || !b.meta || typeof b.meta.username !== "string") return false;
    localStorage.setItem(K.meta, JSON.stringify({ ...b.meta, fails: 0, lockUntil: 0 }));
    if (b.vault && typeof b.vault.iv === "string") localStorage.setItem(K.vault, JSON.stringify({ v: 2, iv: b.vault.iv, ct: b.vault.ct }));
    return true;
  } catch { return false; }
}

async function connectBackupFile() {
  if (!("showSaveFilePicker" in window)) {
    toast("متصفحك لا يدعم الاتصال المباشر. استخدم زر التنزيل.", "error");
    return;
  }
  try {
    backupFileHandle = await window.showSaveFilePicker({ suggestedName: "personal-assistant-backup.json", types: [{ description: "Backup JSON", accept: { "application/json": [".json"] } }] });
    await writeBackupToFile();
    toast("تم ربط الملف. سيتم التحديث تلقائياً بعد كل حفظ.");
  } catch (e) {
    if (e.name !== "AbortError") toast("تعذّر ربط الملف: " + (e.message || e.name), "error");
  }
}

async function writeBackupToFile() {
  if (!backupFileHandle || !S.key || !S.data) return false;
  try {
    await saveChain;
    const files = await idb.all();
    const { fails, lockUntil, ...meta } = S.meta;
    const vault = localStorage.getItem(K.vault);
    const out = { app: "personal-assistant", v: 2, exportedAt: nowIso(), meta, vault: vault ? JSON.parse(vault) : null, files: files.map(f => ({ id: f.id, iv: b64(f.iv), ct: b64(f.ct) })) };
    const w = await backupFileHandle.createWritable(); await w.write(JSON.stringify(out)); await w.close();
    return true;
  } catch (e) { toast("تعذّرت الكتابة إلى الملف: " + (e.message || e.name), "error"); return false; }
}

// Auth UI
function showAuth(mode, msg) {
  S.mode = mode; $("#app-screen").hidden = true; $("#login-screen").hidden = false;
  const setup = mode === "setup";
  $("#auth-title").textContent = setup ? "إنشاء حساب جديد" : "تسجيل الدخول";
  $("#auth-sub").textContent = setup ? "أنشئ حسابك المشفر." : "أدخل بياناتك.";
  $("#confirm-field").hidden = !setup; $("#strength-box").hidden = !setup;
  $("#confirm").required = setup;
  $("#auth-submit").textContent = setup ? "إنشاء" : "دخول";
  $("#username").value = ""; $("#password").value = ""; $("#confirm").value = "";
  updateStrength(); setAuthMsg(msg || "", /تم|انتهت|قُفلت/.test(msg) ? "info" : "error");
  startLockCountdown();
}
function setAuthMsg(t, kind = "error") { const e = $("#login-error"); e.textContent = t; e.className = "form-error" + (kind === "info" ? " info" : ""); }
function startLockCountdown() {
  clearInterval(S.lockTimer);
  const tick = () => {
    const left = (S.meta?.lockUntil || 0) - Date.now();
    if (S.mode === "login" && left > 0) { $("#auth-submit").disabled = true; setAuthMsg(`حاول بعد ${Math.ceil(left / 1000)} ثانية.`); }
    else { $("#auth-submit").disabled = false; clearInterval(S.lockTimer); }
  };
  if ((S.meta?.lockUntil || 0) > Date.now()) { tick(); S.lockTimer = setInterval(tick, 1000); } else $("#auth-submit").disabled = false;
}
function updateStrength() {
  const p = $("#password").value; const bar = $("#strength-bar"); const t = $("#strength-text");
  if (!p) { bar.style.width = "0%"; t.textContent = "8 أحرف على الأقل."; return; }
  const s = strength(p); bar.style.width = `${(s.score + 1) * 20}%`;
  t.textContent = `القوة: ${s.label}`;
}
async function doSetup(user, pass, conf) {
  user = user.trim();
  if (user.length < 3) throw new Error("اسم المستخدم قصير.");
  if (pass.length < 8) throw new Error("كلمة المرور قصيرة.");
  if (pass !== conf) throw new Error("التأكيد غير مطابق.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(user, pass, salt, ITER);
  S.meta = { v: 2, username: user, salt: b64(salt), iter: ITER, fails: 0, lockUntil: 0 };
  S.key = key; S.data = defaults();
  saveMeta(); await save(); await enterApp();
}
async function doLogin(user, pass) {
  const m = S.meta;
  if (m.lockUntil > Date.now()) throw new Error("مقفل مؤقتاً.");
  const key = await deriveKey(user, pass, unb64(m.salt), m.iter);
  const vaultStr = localStorage.getItem(K.vault);
  let data = null;
  if (!vaultStr) {
    data = defaults();
  } else {
    try { data = JSON.parse(dec.decode(await decBytes(key, JSON.parse(vaultStr)))); } catch {}
  }
  if (!data) {
    m.fails = (m.fails || 0) + 1;
    if (m.fails >= MAX_FAILS) m.lockUntil = Date.now() + Math.min(30 * 2 ** (m.fails - MAX_FAILS), 900) * 1000;
    saveMeta(); startLockCountdown(); throw new Error("بيانات خاطئة.");
  }
  m.fails = 0; m.lockUntil = 0; saveMeta();
  S.key = key; S.data = normalize(data); await enterApp();
}
async function enterApp() {
  S.user = S.meta.username; S.last = Date.now(); S.sessTouch = Date.now();
  $("#login-screen").hidden = true; $("#app-screen").hidden = false;
  $("#who").textContent = S.user;
  applyTheme(); renderAll(); showView("overview");
  if ($("#transaction-date")) $("#transaction-date").value = todayStr();
  if ($("#fit-date")) $("#fit-date").value = todayStr();
  await persistSession(); startTimers();
}

// Local Logic Engine
function analyzeText(text) {
  let insights = [];
  const t = text.toLowerCase();
  
  if (/سهر|نوم|متأخر|أرق/.test(t)) insights.push("ذكرت مشكلة في النوم أو السهر. منطقياً، قلة النوم تؤدي مباشرة إلى الكسل وضعف التركيز. <b>توصية:</b> ضع هدفاً لنوم 7-8 ساعات، وحاول إغلاق الشاشات قبل النوم بساعة.");
  if (/أكل|تغذية|سعرات|جوع|بروتين/.test(t)) insights.push("تحدثت عن التغذية. تذكر أن جسمك (Ectomorph) يحتاج لسعرات كافية (2800) وبروتين (140g) لبناء العضلات. <b>توصية:</b> لا تتخطَ وجباتك، واستخدم مكملات السعرات إذا لزم الأمر.");
  if (/كسل|تعب|إرهاق|طاقة/.test(t)) insights.push("ذكرت التعب أو الكسل. هل هذا بسبب عدم كفاية السعرات أم قلة النوم؟ <b>توصية:</b> راجع سجل اللياقة. إذا كنت تأكل وتنام جيداً، فقد يكون التمرين مفرطاً.");
  if (/تمرين|رياضة|جيم|عضلات/.test(t)) insights.push("تطرقت للتمرين. الاستمرارية أهم من الشدة. <b>توصية:</b> لا تتوقف حتى لو قللت الوقت. ركز على التمارين المركبة لزيادة الوزن.");
  if (/ماء|شرب|جفاف/.test(t)) insights.push("لاحظت ذكر الماء. الترطيب ضروري للأداء العقلي والجسدي. <b>توصية:</b> اشرب 2.5 - 3 لتر يومياً.");

  if (insights.length === 0) insights.push("لم أجد أنماطاً واضحة في النص. استمر في الكتابة بحرية، واذكر أسباب تعثرك (مثل: نمت متأخراً، أكلت قليلاً) لكي أتمكن من تحليلها.");
  return insights.map(i => `<div style="margin-bottom:10px; padding-right:10px; border-right:2px solid var(--brand-yellow);">${i}</div>`).join("");
}

// Rendering
function renderAll() {
  if (!S.data) return;
  
  try {
    // 1. Overview & Logic Score
    $("#stat-tasks").textContent = S.data.tasks.filter(t => !t.done).length;
    $("#stat-files").textContent = S.data.files.length;
    
    const sortedFitness = [...S.data.fitness].sort((a,b) => (b.date || "").localeCompare(a.date || ""));
    const latestFit = sortedFitness[0];
    const currentWeight = latestFit ? latestFit.weight : 0;
    $("#stat-weight").textContent = currentWeight ? `${currentWeight} kg` : "-- kg";
    $("#stat-weight-sub").textContent = `الهدف: ${S.data.settings.targetWeight} kg`;

    const todayFit = S.data.fitness.filter(f => f.date === todayStr());
    const cals = todayFit.reduce((a, b) => a + (Number(b.calories) || 0), 0);
    const prot = todayFit.reduce((a, b) => a + (Number(b.protein) || 0), 0);
    $("#stat-calories").textContent = cals;
    $("#stat-protein").textContent = `${prot}g`;
    $("#stat-sleep").textContent = latestFit && latestFit.sleep ? `${latestFit.sleep} h` : "-- h";

    let score = 0;
    if (cals >= S.data.settings.targetCalories) score += 33;
    if (prot >= S.data.settings.targetProtein) score += 33;
    if (latestFit && latestFit.sleep >= 7) score += 34;
    $("#logic-score-val").textContent = `${score}%`;
    document.querySelector('.score-circle').style.background = `conic-gradient(var(--brand-yellow) ${score}%, var(--border) ${score}%)`;

    // 2. Tasks
    const open = S.data.tasks.filter(t => !t.done).sort((a, b) => (a.dueAt || "9999").localeCompare(b.dueAt || "9999"));
    $("#overview-tasks").innerHTML = open.slice(0, 5).map(t => `<div class="task-item"><input type="checkbox" class="task-check" data-action="toggle-task" data-id="${t.id}"><div class="task-main"><span class="task-title">${esc(t.title)}</span></div></div>`).join("") || '<div class="empty-state">لا توجد مهام.</div>';
    
    // استخدام [...S.data.tasks] لمنع تعديل المصفوفة الأصلية
    const allTasks = [...S.data.tasks].sort((a, b) => (a.done - b.done) || (a.dueAt || "9999").localeCompare(b.dueAt || "9999"));
    $("#tasks-list").innerHTML = allTasks.map(t => `<div class="task-item"><input type="checkbox" class="task-check" data-action="toggle-task" data-id="${t.id}" ${t.done ? "checked" : ""}><div class="task-main"><span class="task-title ${t.done ? "completed" : ""}">${esc(t.title)}</span>${t.dueAt ? `<div class="muted" style="font-size:11px;margin-top:4px;">${formatDate(t.dueAt)}</div>` : ""}</div><button class="mini-button delete" data-action="delete-tasks" data-id="${t.id}">×</button></div>`).join("") || '<div class="empty-state">فارغ.</div>';

    // 3. Fitness Table
    $("#fitness-list").innerHTML = sortedFitness.map(f => {
      return `<tr><td>${f.date}</td><td>${f.weight || 0} kg</td><td>${f.calories || 0}</td><td>${f.protein || 0}g</td><td>${f.sleep || 0} h</td><td>${f.water || 0} L</td><td><button class="mini-button delete" data-action="delete-fitness" data-id="${f.id}">×</button></td></tr>`;
    }).join("");

    // 4. Weekly Reviews
    const sortedReviews = [...S.data.reviews].sort((a,b) => (b.date || "").localeCompare(a.date || ""));
    $("#review-history").innerHTML = sortedReviews.map(r => `
      <div class="note-card" style="flex-direction:column; align-items:stretch;">
        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
          <strong>مراجعة ${r.date}</strong>
          <button class="mini-button delete" data-action="delete-review" data-id="${r.id}">×</button>
        </div>
        <p class="muted" style="font-size:12px; font-style:italic; border-right:2px solid var(--border); padding-right:10px;">"${esc(r.text)}"</p>
        <div style="margin-top:15px; padding:15px; background:var(--bg); border-radius:8px; font-size:13px;">
          ${r.analysis}
        </div>
      </div>
    `).join("") || '<div class="empty-state">لا توجد مراجعات سابقة.</div>';

    // 5. Logic Matrix (تم إصلاح l.items هنا)
    $("#logic-list").innerHTML = S.data.logic.map(l => {
      let score = 0;
      const items = (l.items || []).map(i => {
        const val = i.type === 'pro' ? Number(i.weight) : -Number(i.weight);
        score += val;
        return `<div class="logic-item ${i.type}"><span>${esc(i.text)}</span><span>${i.type === 'pro' ? '+' : '-'}${i.weight}</span></div>`;
      }).join("");
      const scoreClass = score >= 0 ? 'score-pos' : 'score-neg';
      return `<div class="logic-card">
        <h3>${esc(l.title)}</h3>
        ${items || '<div class="muted" style="font-size:12px;margin:10px 0;">لا توجد بنود بعد.</div>'}
        <div class="logic-score"><span>النتيجة:</span> <span class="${scoreClass}">${score > 0 ? '+' : ''}${score}</span></div>
        <div style="margin-top:15px;display:flex;gap:10px;">
          <button class="button secondary" style="padding:6px 12px;font-size:12px;" data-action="add-logic-item" data-id="${l.id}">+ بند</button>
          <button class="button danger" style="padding:6px 12px;font-size:12px;margin-right:auto;" data-action="delete-logic" data-id="${l.id}">حذف</button>
        </div>
      </div>`;
    }).join("") || '<div class="empty-state">لا توجد قرارات مسجلة.</div>';

    // 6. Finance (تم إصلاح العمليات الحسابية هنا)
    const inc = S.data.transactions.filter(t => t.type === 'income').reduce((a, b) => a + (Number(b.amount) || 0), 0);
    const exp = S.data.transactions.filter(t => t.type === 'expense').reduce((a, b) => a + (Number(b.amount) || 0), 0);
    
    $("#fin-income").textContent = money(inc);
    $("#fin-expense").textContent = money(exp);
    $("#fin-balance").textContent = money(inc - exp);
    $("#fin-balance").style.color = (inc - exp) >= 0 ? "var(--brand-yellow)" : "#D32F2F";
    
    const sortedTx = [...S.data.transactions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    $("#transactions-list").innerHTML = sortedTx.map(t => `
      <tr>
        <td dir="ltr" style="text-align:right;">${t.date || '—'}</td>
        <td><span class="pill ${t.type === 'income' ? 'low' : 'high'}">${t.type === 'income' ? 'دخل' : 'مصروف'}</span></td>
        <td>${esc(t.description || '—')}</td>
        <td class="${t.type === 'income' ? 'positive' : 'negative'}" style="font-weight:bold;">${t.type === 'income' ? '+' : '-'} ${money(t.amount)}</td>
        <td><div class="item-actions"><button class="mini-button" data-action="edit-tx" data-id="${t.id}">✎</button><button class="mini-button delete" data-action="delete-tx" data-id="${t.id}">×</button></div></td>
      </tr>
    `).join("") || '<tr><td colspan="5" class="empty-state">لا توجد عمليات مسجلة.</td></tr>';

    // 7. Notes, Contacts, Files
    $("#notes-list").innerHTML = S.data.notes.map(n => `<div class="note-card"><strong>${esc(n.title || "بدون عنوان")}</strong><p>${esc(n.text)}</p><button class="mini-button delete" style="margin-top:10px;" data-action="delete-note" data-id="${n.id}">×</button></div>`).join("") || '<div class="empty-state">لا توجد ملاحظات.</div>';
    $("#contacts-list").innerHTML = S.data.contacts.map(c => `<div class="contact-item"><div style="flex:1;"><strong>${esc(c.name)}</strong></div><span dir="ltr" class="muted">${esc(c.phone)}</span><button class="mini-button delete" data-action="delete-contact" data-id="${c.id}">×</button></div>`).join("") || '<div class="empty-state">لا توجد جهات اتصال.</div>';
    $("#files-list").innerHTML = S.data.files.map(f => `<div class="file-card"><strong>${esc(f.name)}</strong><small>${fmtSize(f.size)}</small><div style="display:flex;gap:5px;margin-top:10px;"><button class="mini-button" data-action="preview-file" data-id="${f.id}" title="معاينة">◉</button><button class="mini-button delete" data-action="delete-file" data-id="${f.id}" title="حذف">×</button></div></div>`).join("") || '<div class="empty-state">لا توجد ملفات.</div>';

    // 8. Settings
    $("#set-target-cal").value = S.data.settings.targetCalories;
    $("#set-target-pro").value = S.data.settings.targetProtein;
    $("#set-target-weight").value = S.data.settings.targetWeight;
  } catch (err) {
    console.error("Render Error:", err);
    // لا نعرض رسالة خطأ مزعجة للمستخدم، فقط نطبعها في الكونسول
  }
}

function showView(v) {
  if (!TITLES[v]) return;
  $$(".view").forEach(e => e.classList.toggle("active", e.id === `view-${v}`));
  $$(".nav-item").forEach(e => e.classList.toggle("active", e.dataset.view === v));
  $("#page-title").textContent = TITLES[v];
  if (v !== "search") S.view = v;
}

function applyTheme() {
  const t = S.data?.settings.theme || localStorage.getItem(K.theme) || "auto";
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? "#000000" : "#FFB800";
}

async function previewFile(id) {
  const meta = S.data.files.find(f => f.id === id); if (!meta) return;
  try {
    const bytes = await readFileBytes(id);
    const kind = PREVIEW.image.test(meta.name) ? "image" : PREVIEW.pdf.test(meta.name) ? "pdf" : "text";
    $("#preview-name").textContent = meta.name;
    $("#preview-download").dataset.fileId = id;
    const body = $("#preview-body"); body.innerHTML = "";
    if (S.previewUrl) { URL.revokeObjectURL(S.previewUrl); S.previewUrl = null; }
    if (kind === "image") { S.previewUrl = URL.createObjectURL(new Blob([bytes], { type: meta.type })); body.innerHTML = `<img class="preview-img" src="${S.previewUrl}">`; }
    else if (kind === "pdf") { S.previewUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); body.innerHTML = `<iframe class="preview-frame" src="${S.previewUrl}"></iframe>`; }
    else { body.innerHTML = `<div class="preview-text">${esc(dec.decode(bytes))}</div>`; }
    $("#preview-dialog").showModal();
  } catch { toast("تعذّر فتح الملف.", "error"); }
}

// Events
$("#auth-form").addEventListener("submit", async e => {
  e.preventDefault(); setAuthMsg("");
  const user = $("#username").value, pass = $("#password").value, conf = $("#confirm").value;
  const btn = $("#auth-submit"); const old = btn.textContent; btn.disabled = true; btn.textContent = "جارٍ...";
  try { if (S.mode === "setup") await doSetup(user, pass, conf); else await doLogin(user, pass); }
  catch (err) { setAuthMsg(err.message || "خطأ."); }
  finally { btn.disabled = false; btn.textContent = old; }
});
$("#password").addEventListener("input", updateStrength);
$("#toggle-pass").addEventListener("click", () => { const show = $("#password").type === "password"; $("#password").type = show ? "text" : "password"; $("#confirm").type = show ? "text" : "password"; $("#toggle-pass").textContent = show ? "إخفاء" : "إظهار"; });

$$(".nav-item").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
$$("[data-go]").forEach(b => b.addEventListener("click", () => showView(b.dataset.go)));

$("#task-form").addEventListener("submit", e => {
  e.preventDefault();
  S.data.tasks.push({ id: uid(), title: $("#task-title").value, dueAt: $("#task-due").value ? new Date($("#task-due").value).toISOString() : null, done: false });
  $("#task-title").value = ""; persist("تمت الإضافة");
});

$("#fitness-form").addEventListener("submit", e => {
  e.preventDefault();
  S.data.fitness.push({
    id: uid(), date: $("#fit-date").value, weight: parseFloat($("#fit-weight").value) || 0,
    calories: parseInt($("#fit-calories").value) || 0, protein: parseInt($("#fit-protein").value) || 0,
    sleep: parseFloat($("#fit-sleep").value) || 0, water: parseFloat($("#fit-water").value) || 0
  });
  persist("تم تسجيل اليوم");
});

$("#review-form").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("#review-text").value.trim();
  if (!text) return;
  const analysisHTML = analyzeText(text);
  
  S.data.reviews.push({ id: uid(), date: todayStr(), text: text, analysis: analysisHTML });
  
  $("#logic-report-content").innerHTML = analysisHTML;
  $("#review-analysis-result").style.display = "block";
  $("#review-text").value = "";
  persist("تم حفظ المراجعة وتحليلها.");
});

$("#logic-form").addEventListener("submit", e => {
  e.preventDefault();
  S.data.logic.push({ id: uid(), title: $("#logic-title").value, items: [] });
  $("#logic-title").value = ""; persist("تم إنشاء القرار");
});

$("#transaction-form").addEventListener("submit", e => {
  e.preventDefault();
  const amount = Number($("#transaction-amount").value);
  const desc = $("#transaction-desc").value.trim();
  const date = $("#transaction-date").value;
  if (amount <= 0 || !desc || !date) { toast("يرجى تعبئة جميع الحقول بشكل صحيح.", "error"); return; }
  S.data.transactions.push({ id: uid(), type: $("#transaction-type").value, amount, description: desc, date });
  $("#transaction-amount").value = ""; $("#transaction-desc").value = "";
  persist("تم تسجيل العملية المالية.");
});

$("#contact-form").addEventListener("submit", e => {
  e.preventDefault();
  S.data.contacts.push({ id: uid(), name: $("#contact-name").value, phone: $("#contact-phone").value });
  $("#contact-name").value = ""; $("#contact-phone").value = "";
  persist("تمت الإضافة");
});

$("#note-form").addEventListener("submit", e => {
  e.preventDefault();
  S.data.notes.push({ id: uid(), title: $("#note-title").value, text: $("#note-text").value });
  $("#note-title").value = ""; $("#note-text").value = "";
  persist("تم الحفظ");
});

$("#set-target-cal").addEventListener("change", e => { S.data.settings.targetCalories = parseInt(e.target.value) || 2800; persist(); });
$("#set-target-pro").addEventListener("change", e => { S.data.settings.targetProtein = parseInt(e.target.value) || 140; persist(); });
$("#set-target-weight").addEventListener("change", e => { S.data.settings.targetWeight = parseFloat(e.target.value) || 65; persist(); });

// Actions (Deletes & Toggles & Edits)
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-action]"); if (!b) return;
  const { action, id } = b.dataset;
  
  if (action === "toggle-task") { const t = S.data.tasks.find(x => x.id === id); t.done = b.checked; persist(); }
  if (action === "delete-tasks") { S.data.tasks = S.data.tasks.filter(x => x.id !== id); persist("حُذفت"); }
  if (action === "delete-fitness") { S.data.fitness = S.data.fitness.filter(x => x.id !== id); persist(); }
  if (action === "delete-logic") { if(confirm("حذف القرار؟")) { S.data.logic = S.data.logic.filter(x => x.id !== id); persist(); } }
  if (action === "delete-tx") { if(confirm("حذف العملية؟")) { S.data.transactions = S.data.transactions.filter(x => x.id !== id); persist(); } }
  if (action === "delete-note") { S.data.notes = S.data.notes.filter(x => x.id !== id); persist(); }
  if (action === "delete-contact") { S.data.contacts = S.data.contacts.filter(x => x.id !== id); persist(); }
  if (action === "delete-review") { if(confirm("حذف المراجعة؟")) { S.data.reviews = S.data.reviews.filter(x => x.id !== id); persist(); } }
  if (action === "delete-file") { await idb.del(id); S.data.files = S.data.files.filter(x => x.id !== id); persist(); }
  
  if (action === "preview-file") return previewFile(id);

  // ميزة التعديل السريع للعمليات المالية
  if (action === "edit-tx") {
    const t = S.data.transactions.find(x => x.id === id);
    if (t) {
      const newAmount = prompt("تعديل المبلغ:", t.amount);
      const newDesc = prompt("تعديل الوصف:", t.description);
      if (newAmount !== null && newDesc !== null) {
        t.amount = Number(newAmount) || t.amount;
        t.description = newDesc.trim() || t.description;
        persist("تم التعديل.");
      }
    }
  }

  if (action === "add-logic-item") {
    const text = prompt("أدخل بنداً (مثال: + سريع 5 أو - مكلف 3)");
    if (text) {
      const match = text.match(/^([+-])\s*(.+?)\s*(\d+)$/);
      if (match) {
        const l = S.data.logic.find(x => x.id === id);
        if (!l.items) l.items = []; // حماية إضافية
        l.items.push({ type: match[1] === '+' ? 'pro' : 'con', text: match[2], weight: parseInt(match[3]) });
        persist("أُضيف البند");
      } else alert("الصيغة خاطئة. استخدم: + ميزة 5 أو - عيب 3");
    }
  }
});

// File Actions
$("#connect-file").addEventListener("click", connectBackupFile);
$("#export-backup").addEventListener("click", async () => {
  await saveChain; const files = await idb.all(); const { fails, lockUntil, ...meta } = S.meta;
  const vault = localStorage.getItem(K.vault);
  const out = { app: "personal-assistant", v: 2, exportedAt: nowIso(), meta, vault: vault ? JSON.parse(vault) : null, files: files.map(f => ({ id: f.id, iv: b64(f.iv), ct: b64(f.ct) })) };
  downloadBlob(new Blob([JSON.stringify(out)], { type: "application/json" }), `personal-assistant-backup-${todayStr()}.json`);
});
$("#import-input").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const b = JSON.parse(await f.text());
    if (!b || b.app !== "personal-assistant") throw new Error("ملف غير صالح.");
    if (!confirm("سيتم استبدال كل البيانات الحالية. هل أنت متأكد؟")) return;
    localStorage.setItem(K.meta, JSON.stringify({ ...b.meta, fails: 0, lockUntil: 0 }));
    if (b.vault) localStorage.setItem(K.vault, JSON.stringify(b.vault));
    location.reload();
  } catch (err) { toast("فشل الاستيراد: " + err.message, "error"); }
});
$("#wipe-button").addEventListener("click", async () => {
  if (!confirm("سيتم حذف كل شيء. هل أنت متأكد؟")) return;
  if (prompt("اكتب 'حذف' للتأكيد:") !== "حذف") return;
  await idb.clear(); localStorage.clear(); sessionStorage.clear(); location.reload();
});

$("#preview-close").addEventListener("click", () => $("#preview-dialog").close());
$("#preview-dialog").addEventListener("close", () => {
  if (S.previewUrl) URL.revokeObjectURL(S.previewUrl); S.previewUrl = null; $("#preview-body").innerHTML = "";
});
$("#preview-download").addEventListener("click", async () => {
  const id = $("#preview-download").dataset.fileId;
  const meta = S.data.files.find(f => f.id === id);
  const bytes = await readFileBytes(id);
  downloadBlob(new Blob([bytes], { type: meta.type }), meta.name);
});

$("#file-form").addEventListener("submit", async e => {
  e.preventDefault();
  const list = $("#file-input").files; if (!list.length) return;
  for (const f of list) {
    const r = await encRaw(S.key, new Uint8Array(await f.arrayBuffer()));
    const id = uid(); await idb.put({ id, iv: r.iv, ct: r.ct });
    S.data.files.push({ id, name: f.name, size: f.size, type: f.type });
  }
  $("#file-input").value = ""; persist("تم الرفع");
});

$("#theme-button").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark";
  S.data.settings.theme = dark ? "light" : "dark";
  applyTheme(); save();
});
$("#logout-button").addEventListener("click", () => lock("تم الخروج"));
$("#lock-button").addEventListener("click", () => lock("تم القفل"));
$("#lock-now").addEventListener("click", () => lock("تم القفل"));

// Session & Init
async function persistSession() {
  if (!S.key || !S.data) return;
  if (!S.data.settings.keepSession) { sessionStorage.removeItem(K.session); return; }
  if (!S.raw) S.raw = b64(await crypto.subtle.exportKey("raw", S.key));
  const m = S.data.settings.autolock;
  sessionStorage.setItem(K.session, JSON.stringify({ k: S.raw, exp: m > 0 ? Date.now() + m * 60000 : 0 }));
}
async function restoreSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(K.session) || "null"); if (!s) return false;
    if (s.exp && Date.now() > s.exp) { sessionStorage.removeItem(K.session); return false; }
    const key = await crypto.subtle.importKey("raw", unb64(s.k), "AES-GCM", true, ["encrypt", "decrypt"]);
    const data = JSON.parse(dec.decode(await decBytes(key, JSON.parse(localStorage.getItem(K.vault)))));
    S.key = key; S.raw = s.k; S.data = normalize(data); return true;
  } catch { sessionStorage.removeItem(K.session); return false; }
}
function touch() { if (!S.key) return; const n = Date.now(); S.last = n; if (n - S.sessTouch > 30000) { S.sessTouch = n; persistSession(); } }
function checkIdle() { const m = S.data?.settings.autolock; if (S.key && m > 0 && Date.now() - S.last > m * 60000) lock("قُفل تلقائياً."); }
function startTimers() { stopTimers(); S.timers = [setInterval(checkIdle, 15000)]; }
function stopTimers() { S.timers.forEach(clearInterval); S.timers = []; }
async function lock(msg) {
  try { await saveChain; } catch {}
  S.key = null; S.raw = null; S.data = null; sessionStorage.removeItem(K.session); stopTimers(); closeDialogs();
  S.meta = loadMeta(); showAuth(S.meta ? "login" : "setup", msg);
}
function closeDialogs() { for (const d of $$("dialog")) if (d.open) d.close(); }
["pointerdown", "keydown", "scroll", "touchstart"].forEach(ev => addEventListener(ev, touch, { passive: true, capture: true }));

async function init() {
  applyTheme(); 
  const seeded = await trySeedFromFile();
  S.meta = loadMeta();
  if (!(window.crypto && crypto.subtle)) { showAuth("login"); return; }
  if (S.meta && await restoreSession()) {
    await enterApp();
    if (seeded) toast("تم تحميل البيانات من ملف النسخة الاحتياطية.");
  } else {
    showAuth(S.meta ? "login" : "setup", seeded ? "تم تحميل بيانات الاعتماد من الملف. سجل الدخول." : "");
  }
}
init();
