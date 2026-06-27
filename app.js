const { useState, useMemo, useEffect, useCallback, useRef, createElement: h, Fragment } = React;

// ─── FIREBASE SYNC ────────────────────────────────────────────────────────────
// Firebase is loaded via index.html before app.js runs.
// All sync happens through a single Firestore document keyed by the user's
// chosen sync code. Both devices listen to the same document in real time.

var _db = null;
var _unsubscribe = null;
var _syncCode = null;

function firestoreDoc(code) {
  return firebase.firestore().collection("finplan_sync").doc(code);
}

function startSync(code, onRemoteData) {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _syncCode = code;
  localStorage.setItem("finplan-sync-code", code);
  _unsubscribe = firestoreDoc(code).onSnapshot(function(snap) {
    if (snap.exists) {
      var d = snap.data();
      if (d && d.finplanData) {
        try {
          var parsed = JSON.parse(d.finplanData);
          if (parsed && Array.isArray(parsed.income)) onRemoteData(parsed);
        } catch(e) {}
      }
    }
  }, function(err) {
    console.warn("Firestore sync error:", err);
  });
}

function stopSync() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _syncCode = null;
  localStorage.removeItem("finplan-sync-code");
}

function pushToFirestore(data) {
  if (!_syncCode) return;
  firestoreDoc(_syncCode).set({ finplanData: JSON.stringify(data), updatedAt: Date.now() })
    .catch(function(e) { console.warn("Firestore push error:", e); });
}

var _pushTimer = null;
function debouncedPush(data) {
  if (!_syncCode) return;
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(function() { pushToFirestore(data); }, 1500);
}

// ─── APP LOCK (PIN + Face ID / Touch ID via WebAuthn) ─────────────────────────
var LOCK_PIN_KEY = "finplan-lock-pin";
var LOCK_ENABLED_KEY = "finplan-lock-enabled";
var LOCK_CRED_ID_KEY = "finplan-lock-cred-id";

function isLockEnabled() {
  return localStorage.getItem(LOCK_ENABLED_KEY) === "1";
}

function hasBiometricCredential() {
  return !!localStorage.getItem(LOCK_CRED_ID_KEY);
}

// Simple, non-cryptographic hash sufficient for a local casual-access gate.
// This is not protecting against a determined attacker with file access —
// it stops someone picking up an unlocked device from casually opening the app.
function simpleHash(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return String(h);
}

function setPin(pin) {
  localStorage.setItem(LOCK_PIN_KEY, simpleHash(pin));
  localStorage.setItem(LOCK_ENABLED_KEY, "1");
}

function checkPin(pin) {
  return localStorage.getItem(LOCK_PIN_KEY) === simpleHash(pin);
}

function disableLock() {
  localStorage.removeItem(LOCK_PIN_KEY);
  localStorage.removeItem(LOCK_ENABLED_KEY);
  localStorage.removeItem(LOCK_CRED_ID_KEY);
}

function webAuthnSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
}

function randomBytes(len) {
  var arr = new Uint8Array(len);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(arr);
  else for (var i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

function registerBiometric() {
  if (!webAuthnSupported()) return Promise.reject(new Error("WebAuthn not supported on this device/browser."));
  var userId = randomBytes(16);
  var challenge = randomBytes(32);
  return navigator.credentials.create({
    publicKey: {
      challenge: challenge,
      rp: { name: "FinPlan" },
      user: { id: userId, name: "finplan-user", displayName: "FinPlan User" },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    }
  }).then(function(cred) {
    var idStr = Array.from(new Uint8Array(cred.rawId)).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
    localStorage.setItem(LOCK_CRED_ID_KEY, idStr);
    return true;
  });
}

function verifyBiometric() {
  if (!webAuthnSupported() || !hasBiometricCredential()) return Promise.reject(new Error("No biometric credential registered."));
  var idStr = localStorage.getItem(LOCK_CRED_ID_KEY);
  var idBytes = new Uint8Array(idStr.match(/.{1,2}/g).map(function(b) { return parseInt(b, 16); }));
  var challenge = randomBytes(32);
  return navigator.credentials.get({
    publicKey: {
      challenge: challenge,
      allowCredentials: [{ id: idBytes, type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    }
  }).then(function() { return true; });
}

// ─── TOKENS ──────────────────────────────────────────────────────────────────
const C = {
  bg:          "#080C10",
  panel:       "#0E1419",
  panelBright: "#141B24",
  border:      "#1E2A38",
  borderBright:"#263344",
  green:       "#10E5A0",
  greenDim:    "#0A8F63",
  amber:       "#F59E0B",
  red:         "#F43F5E",
  blue:        "#38BDF8",
  purple:      "#A78BFA",
  textHi:      "#F0F6FF",
  textMid:     "#8BA3BE",
  textLo:      "#3D5470",
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => new Date().toISOString().slice(0, 10);

const gbp = (n, compact) => {
  const abs = Math.abs(n);
  const neg = n < 0;
  if (compact) {
    const s = neg ? "-£" : "£";
    if (abs >= 1000000) return s + (abs / 1000000).toFixed(2) + "m";
    if (abs >= 1000) return s + (abs / 1000).toFixed(1) + "k";
    return s + abs.toFixed(0);
  }
  return (neg ? "-" : "") + "£" + abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const futureMonth = (offset) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return MONTHS_SHORT[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
};

// "2026-06" style key for the current calendar month — used to detect when a
// new month has started so we can prompt for the previous month's close-out.
function currentMonthKey(d) {
  d = d || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function monthKeyToLabel(key) {
  var parts = key.split("-");
  var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1;
  return MONTHS_FULL[m] + " " + y;
}

// Days elapsed / total days in the current month, for the live in-month tracker.
function monthProgress() {
  var now = new Date();
  var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  var dayOfMonth = now.getDate();
  return { day: dayOfMonth, total: daysInMonth, frac: dayOfMonth / daysInMonth };
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
const STORAGE_KEY = "finplan-data-v1";

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function saveData(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
}

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const SEED = {
  cashBalance: 4200,
  income: [
    { id: uid(), date: todayStr(), label: "Salary",        amount: 5200, category: "Employment", recur: "monthly" },
    { id: uid(), date: todayStr(), label: "Rental Income", amount: 650,  category: "Property",   recur: "monthly" },
    { id: uid(), date: todayStr(), label: "Freelance",     amount: 900,  category: "Self-Emp",   recur: "once"    },
  ],
  expenses: [
    { id: uid(), date: todayStr(), label: "Mortgage",      amount: 1100, category: "Housing",   recur: "monthly" },
    { id: uid(), date: todayStr(), label: "Groceries",     amount: 380,  category: "Food",      recur: "monthly" },
    { id: uid(), date: todayStr(), label: "Fuel",          amount: 180,  category: "Transport", recur: "monthly" },
    { id: uid(), date: todayStr(), label: "Utilities",     amount: 165,  category: "Bills",     recur: "monthly" },
    { id: uid(), date: todayStr(), label: "Subscriptions", amount: 48,   category: "Lifestyle", recur: "monthly" },
    { id: uid(), date: todayStr(), label: "Insurance",     amount: 120,  category: "Bills",     recur: "monthly" },
    { id: uid(), date: todayStr(), label: "Dining Out",    amount: 210,  category: "Food",      recur: "monthly" },
  ],
  debts: [
    { id: uid(), name: "Credit Card A", balance: 4800,  rate: 21.9, payment: 250 },
    { id: uid(), name: "Personal Loan", balance: 9500,  rate: 6.4,  payment: 320 },
    { id: uid(), name: "Car Finance",   balance: 7200,  rate: 4.9,  payment: 280 },
    { id: uid(), name: "Student Loan",  balance: 22000, rate: 1.5,  payment: 130 },
  ],
  investments: [
    { id: uid(), name: "Global ETF (VWRL)", value: 18500, contrib: 500, returnPct: 8.0,  type: "Stocks"  },
    { id: uid(), name: "Cash ISA",          value: 8000,  contrib: 300, returnPct: 4.5,  type: "Savings" },
    { id: uid(), name: "Pension (SIPP)",    value: 34000, contrib: 600, returnPct: 7.0,  type: "Pension" },
    { id: uid(), name: "Crypto",            value: 2200,  contrib: 100, returnPct: 20.0, type: "Crypto"  },
  ],
  monthlyHistory: [],
  lastClosedMonth: currentMonthKey(),
};

// ─── FORECAST ENGINE ──────────────────────────────────────────────────────────
// Advances debts and investments by exactly one calendar month of real
// growth/payments, using the same math as the forecast engine. Used when
// closing out a month for real (as opposed to projecting future months).
function advanceOneMonth(debts, investments) {
  var newDebts = debts.map(function(x) {
    var int = (x.balance * x.rate / 100) / 12;
    return Object.assign({}, x, { balance: Math.max(0, x.balance + int - x.payment) });
  });
  var newInvs = investments.map(function(x) {
    return Object.assign({}, x, { value: x.value * (1 + x.returnPct / 100 / 12) + x.contrib });
  });
  return { debts: newDebts, investments: newInvs };
}

// How many calendar months have elapsed between two "YYYY-MM" keys.
function monthsBetween(fromKey, toKey) {
  var f = fromKey.split("-").map(Number), t = toKey.split("-").map(Number);
  return (t[0] - f[0]) * 12 + (t[1] - f[1]);
}

function buildForecast(d, months) {
  months = months || 36;
  const mIncome = d.income.filter(t => t.recur === "monthly").reduce((s, t) => s + t.amount, 0);
  const mExpenses = d.expenses.filter(t => t.recur === "monthly").reduce((s, t) => s + t.amount, 0);
  const mDebtPay = d.debts.reduce((s, x) => s + x.payment, 0);
  const mInvest = d.investments.reduce((s, x) => s + x.contrib, 0);
  const mFlow = mIncome - mExpenses - mDebtPay - mInvest;

  let cash = d.cashBalance;
  let debts = d.debts.map(x => Object.assign({}, x));
  let invs = d.investments.map(x => Object.assign({}, x));
  const rows = [];

  for (let m = 0; m <= months; m++) {
    const totalDebt = debts.reduce((s, x) => s + Math.max(0, x.balance), 0);
    const totalInv = invs.reduce((s, x) => s + x.value, 0);
    rows.push({
      label: futureMonth(m),
      cash: Math.round(cash),
      debt: Math.round(totalDebt),
      investments: Math.round(totalInv),
      netWorth: Math.round(cash + totalInv - totalDebt),
    });
    if (m < months) {
      debts = debts.map(x => {
        const int = (x.balance * x.rate / 100) / 12;
        return Object.assign({}, x, { balance: Math.max(0, x.balance + int - x.payment) });
      });
      invs = invs.map(x => Object.assign({}, x, { value: x.value * (1 + x.returnPct / 100 / 12) + x.contrib }));
      cash += mFlow;
    }
  }
  return rows;
}

function buildInvForecast(investments, months) {
  months = months || 120;
  const COLS = [C.green, C.amber, C.blue, C.purple, C.red];
  const rows = [];
  // Scale the sampling step so the chart always has a reasonable number of
  // points (~60) whether the horizon is 1 year or 50 years.
  const step = Math.max(1, Math.round(months / 60));
  for (let m = 0; m <= months; m += step) {
    const row = { label: futureMonth(m) };
    investments.forEach((inv) => {
      let v = inv.value;
      for (let j = 0; j < m; j++) v = v * (1 + inv.returnPct / 100 / 12) + inv.contrib;
      row[inv.name] = Math.round(v);
    });
    rows.push(row);
  }
  // Always include the final month exactly, even if the step skipped past it.
  if (rows.length === 0 || rows[rows.length - 1].label !== futureMonth(months)) {
    const row = { label: futureMonth(months) };
    investments.forEach((inv) => {
      let v = inv.value;
      for (let j = 0; j < months; j++) v = v * (1 + inv.returnPct / 100 / 12) + inv.contrib;
      row[inv.name] = Math.round(v);
    });
    rows.push(row);
  }
  return { rows: rows, colors: COLS };
}

// Per-debt forecast lines, mirroring buildInvForecast — each debt gets its
// own colour and its own line showing its balance shrinking to zero over time.
function buildDebtForecast(debts, months) {
  months = months || 60;
  const COLS = [C.red, C.amber, C.purple, C.blue, C.green, "#F97316", "#EC4899"];
  const rows = [];
  for (let m = 0; m <= months; m++) {
    const row = { label: futureMonth(m) };
    debts.forEach((d) => {
      let bal = d.balance;
      for (let j = 0; j < m; j++) {
        const interest = (bal * d.rate / 100) / 12;
        bal = Math.max(0, bal + interest - d.payment);
      }
      row[d.name] = Math.round(bal);
    });
    rows.push(row);
  }
  return { rows: rows, colors: COLS };
}

// ─── MINI CHART TOOLKIT ────────────────────────────────────────────────────────
function useMeasuredWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width || 320);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceTicks(min, max, count) {
  count = count || 4;
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;
  const step = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step || 1)));
  const norm = step / mag;
  let niceStep;
  if (norm < 1.5) niceStep = 1 * mag;
  else if (norm < 3) niceStep = 2 * mag;
  else if (norm < 7) niceStep = 5 * mag;
  else niceStep = 10 * mag;
  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;
  const ticks = [];
  for (let t = niceMin; t <= niceMax + niceStep * 0.001; t += niceStep) ticks.push(Math.round(t));
  return ticks;
}

function ChartHoverBox(props) {
  const x = props.x, y = props.y, width = props.width, items = props.items;
  const boxW = 150;
  const boxH = 16 + items.length * 16;
  let left = x + 10;
  if (left + boxW > width) left = x - boxW - 10;
  return h("g", { transform: "translate(" + left + "," + y + ")", pointerEvents: "none" },
    h("rect", { width: boxW, height: boxH, rx: 6, fill: C.panelBright, stroke: C.border }),
    items.map((it, i) => h("text", {
      key: i, x: 10, y: 18 + i * 16, fontSize: "11", fontFamily: "monospace", fill: it.color,
    }, it.label + ": " + it.value))
  );
}

function MiniChart(props) {
  const data = props.data, series = props.series, height = props.height || 200;
  const yFormatter = props.yFormatter || (v => v);
  const xLabelEvery = props.xLabelEvery || 1;

  const measured = useMeasuredWidth();
  const containerRef = measured[0], width = measured[1];
  const hoverState = useState(null);
  const hoverIdx = hoverState[0], setHoverIdx = hoverState[1];

  const padding = { top: 10, right: 10, bottom: 24, left: 48 };
  const innerW = Math.max(10, width - padding.left - padding.right);
  const innerH = Math.max(10, height - padding.top - padding.bottom);

  const allVals = [];
  data.forEach(d => series.forEach(s => { if (typeof d[s.key] === "number") allVals.push(d[s.key]); }));
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(1, ...allVals);
  const ticks = niceTicks(minV, maxV, 4);
  const tickMin = ticks[0], tickMax = ticks[ticks.length - 1];

  const xFor = (i) => padding.left + (data.length <= 1 ? 0 : (i / (data.length - 1)) * innerW);
  const yFor = (v) => padding.top + innerH - ((v - tickMin) / (tickMax - tickMin || 1)) * innerH;

  const linePath = (key) => data.map((d, i) => (i === 0 ? "M" : "L") + xFor(i) + "," + yFor(d[key] || 0)).join(" ");
  const areaPath = (key) => linePath(key) + " L" + xFor(data.length - 1) + "," + yFor(tickMin) + " L" + xFor(0) + "," + yFor(tickMin) + " Z";

  const handleMove = (evt) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const rel = (px - padding.left) / (innerW || 1);
    let idx = Math.round(rel * (data.length - 1));
    idx = Math.max(0, Math.min(data.length - 1, idx));
    setHoverIdx(idx);
  };

  const gradId = useRef("g" + uid()).current;

  const defs = h("defs", null,
    series.filter(s => s.type !== "line").map(s =>
      h("linearGradient", { key: s.key, id: gradId + s.key, x1: "0", y1: "0", x2: "0", y2: "1" },
        h("stop", { offset: "0%", stopColor: s.color, stopOpacity: 0.32 }),
        h("stop", { offset: "100%", stopColor: s.color, stopOpacity: 0 })
      )
    )
  );

  const gridLines = ticks.map((t, i) =>
    h("g", { key: i },
      h("line", { x1: padding.left, x2: width - padding.right, y1: yFor(t), y2: yFor(t), stroke: C.border, strokeDasharray: "4 4" }),
      h("text", { x: padding.left - 8, y: yFor(t) + 3, textAnchor: "end", fontSize: "10", fill: C.textLo, fontFamily: "monospace" }, yFormatter(t))
    )
  );

  const xLabels = data.map((d, i) => (i % xLabelEvery === 0) ?
    h("text", { key: i, x: xFor(i), y: height - 6, textAnchor: "middle", fontSize: "9", fill: C.textLo, fontFamily: "monospace" }, d.label) : null
  );

  const areas = series.filter(s => s.type !== "line").map(s =>
    h("path", { key: s.key, d: areaPath(s.key), fill: "url(#" + gradId + s.key + ")", stroke: "none" })
  );

  const lines = series.map(s =>
    h("path", { key: s.key, d: linePath(s.key), fill: "none", stroke: s.color, strokeWidth: 2 })
  );

  let hoverGroup = null;
  if (hoverIdx !== null) {
    const dots = series.map(s => h("circle", { key: s.key, cx: xFor(hoverIdx), cy: yFor(data[hoverIdx][s.key] || 0), r: 3.5, fill: s.color }));
    const items = [{ label: "", value: data[hoverIdx].label, color: C.textMid }].concat(
      series.map(s => ({ label: s.name, value: yFormatter(data[hoverIdx][s.key] || 0), color: s.color }))
    );
    hoverGroup = h("g", null,
      h("line", { x1: xFor(hoverIdx), x2: xFor(hoverIdx), y1: padding.top, y2: padding.top + innerH, stroke: C.borderBright, strokeWidth: 1 }),
      dots,
      h(ChartHoverBox, { x: xFor(hoverIdx), y: padding.top, width: width, items: items })
    );
  }

  return h("div", { ref: containerRef, style: { width: "100%" } },
    h("svg", {
      width: width, height: height,
      onMouseMove: handleMove, onMouseLeave: () => setHoverIdx(null),
      onTouchMove: (e) => { if (e.touches[0]) handleMove({ clientX: e.touches[0].clientX, currentTarget: e.currentTarget }); },
      onTouchEnd: () => setHoverIdx(null),
      style: { display: "block", touchAction: "pan-y" },
    },
      defs, gridLines, xLabels, areas, lines, hoverGroup
    )
  );
}

function MiniBarChart(props) {
  const data = props.data, height = props.height || 200;
  const yFormatter = props.yFormatter || (v => v);

  const measured = useMeasuredWidth();
  const containerRef = measured[0], width = measured[1];
  const hoverState = useState(null);
  const hoverIdx = hoverState[0], setHoverIdx = hoverState[1];

  const padding = { top: 10, right: 10, bottom: 24, left: 48 };
  const innerW = Math.max(10, width - padding.left - padding.right);
  const innerH = Math.max(10, height - padding.top - padding.bottom);
  const maxV = Math.max(1, ...data.map(d => d.value));
  const ticks = niceTicks(0, maxV, 4);
  const tickMax = ticks[ticks.length - 1];
  const yFor = (v) => padding.top + innerH - (v / tickMax) * innerH;
  const bw = innerW / data.length;
  const barW = Math.min(56, bw * 0.55);

  const gridLines = ticks.map((t, i) =>
    h("g", { key: i },
      h("line", { x1: padding.left, x2: width - padding.right, y1: yFor(t), y2: yFor(t), stroke: C.border, strokeDasharray: "4 4" }),
      h("text", { x: padding.left - 8, y: yFor(t) + 3, textAnchor: "end", fontSize: "10", fill: C.textLo, fontFamily: "monospace" }, yFormatter(t))
    )
  );

  const bars = data.map((d, i) => {
    const cx = padding.left + bw * i + bw / 2;
    const y = yFor(d.value);
    const bh = (padding.top + innerH) - y;
    return h("g", {
      key: i,
      onMouseEnter: () => setHoverIdx(i), onMouseLeave: () => setHoverIdx(null), onTouchStart: () => setHoverIdx(i),
    },
      h("rect", { x: cx - barW / 2, y: y, width: barW, height: Math.max(0, bh), rx: 4, fill: d.fill, opacity: hoverIdx === i ? 1 : 0.88 }),
      h("text", { x: cx, y: height - 6, textAnchor: "middle", fontSize: "10", fill: C.textLo, fontFamily: "monospace" }, d.label)
    );
  });

  let hoverBox = null;
  if (hoverIdx !== null) {
    hoverBox = h(ChartHoverBox, {
      x: padding.left + bw * hoverIdx + bw / 2, y: padding.top, width: width,
      items: [{ label: data[hoverIdx].label, value: yFormatter(data[hoverIdx].value), color: data[hoverIdx].fill }],
    });
  }

  return h("div", { ref: containerRef, style: { width: "100%" } },
    h("svg", { width: width, height: height, style: { display: "block" } }, gridLines, bars, hoverBox)
  );
}

function MiniPieChart(props) {
  const data = props.data, height = props.height || 200;
  const measured = useMeasuredWidth();
  const containerRef = measured[0], width = measured[1];
  const hoverState = useState(null);
  const hoverIdx = hoverState[0], setHoverIdx = hoverState[1];

  const size = Math.min(width, height);
  const cx = width / 2, cy = height / 2;
  const outerR = size * 0.34, innerR = size * 0.21;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  let angle = -Math.PI / 2;
  const slices = data.map((d) => {
    const frac = d.value / total;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    return Object.assign({}, d, { start: start, end: end, frac: frac });
  });

  const arcPath = (r0, r1, a0, a1) => {
    const x0o = cx + r1 * Math.cos(a0), y0o = cy + r1 * Math.sin(a0);
    const x1o = cx + r1 * Math.cos(a1), y1o = cy + r1 * Math.sin(a1);
    const x0i = cx + r0 * Math.cos(a1), y0i = cy + r0 * Math.sin(a1);
    const x1i = cx + r0 * Math.cos(a0), y1i = cy + r0 * Math.sin(a0);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    return "M" + x0o + "," + y0o + " A" + r1 + "," + r1 + " 0 " + large + " 1 " + x1o + "," + y1o +
      " L" + x0i + "," + y0i + " A" + r0 + "," + r0 + " 0 " + large + " 0 " + x1i + "," + y1i + " Z";
  };

  const paths = slices.map((s, i) =>
    h("path", {
      key: i, d: arcPath(innerR, hoverIdx === i ? outerR * 1.05 : outerR, s.start, s.end),
      fill: s.color, stroke: C.panel, strokeWidth: 2,
      onMouseEnter: () => setHoverIdx(i), onMouseLeave: () => setHoverIdx(null), onTouchStart: () => setHoverIdx(i),
      style: { cursor: "pointer" },
    })
  );

  const legend = data.map((d, i) =>
    h("div", {
      key: i, style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: hoverIdx === i ? C.textHi : C.textMid },
      onMouseEnter: () => setHoverIdx(i), onMouseLeave: () => setHoverIdx(null),
    },
      h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: d.color, display: "inline-block" } }),
      d.name
    )
  );

  return h("div", { ref: containerRef, style: { width: "100%" } },
    h("svg", { width: width, height: height, style: { display: "block" } },
      paths,
      h("text", { x: cx, y: cy - 3, textAnchor: "middle", fontSize: "11", fill: C.textMid, fontFamily: "monospace" },
        hoverIdx !== null ? data[hoverIdx].name : "Total"),
      h("text", { x: cx, y: cy + 14, textAnchor: "middle", fontSize: "13", fontWeight: "700", fill: C.textHi, fontFamily: "monospace" },
        hoverIdx !== null ? gbp(data[hoverIdx].value, true) : gbp(total, true))
    ),
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px 14px", justifyContent: "center", marginTop: 8 } }, legend)
  );
}

// ─── SHARED PRIMITIVES ────────────────────────────────────────────────────────
function pill(label, color) {
  return h("span", {
    style: {
      background: color + "22", color: color, border: "1px solid " + color + "44",
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600,
      letterSpacing: 0.5, whiteSpace: "nowrap",
    },
  }, label);
}

function KPICard(props) {
  var editingState = useState(false);
  var editing = editingState[0], setEditing = editingState[1];
  var draftState = useState("");
  var draft = draftState[0], setDraft = draftState[1];
  var hoverState = useState(false);
  var hovered = hoverState[0], setHovered = hoverState[1];

  var startEdit = function() {
    if (!props.editable) return;
    setDraft(String(props.rawValue));
    setEditing(true);
  };
  var commit = function() {
    var v = parseFloat(draft);
    if (!isNaN(v) && props.onEdit) props.onEdit(v);
    setEditing(false);
  };

  var valueNode = editing
    ? h("input", {
        type: "number", autoFocus: true, value: draft,
        onChange: function(e) { setDraft(e.target.value); },
        onBlur: commit,
        onKeyDown: function(e) { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); },
        onClick: function(e) { e.stopPropagation(); },
        style: { background: C.panelBright, border: "1px solid " + props.accent, borderRadius: 6, color: props.accent, fontSize: 22, fontWeight: 700, fontFamily: "monospace", letterSpacing: -0.5, padding: "2px 6px", width: "100%", boxSizing: "border-box" },
      })
    : h("span", {
        style: { color: props.accent, fontSize: 24, fontWeight: 700, fontFamily: "monospace", letterSpacing: -0.5, cursor: props.editable ? "pointer" : "inherit", borderBottom: props.editable ? "1px dotted " + props.accent : "none" },
        onClick: props.editable ? function(e) { e.stopPropagation(); startEdit(); } : undefined,
        title: props.editable ? "Tap to update" : undefined,
      }, props.value);

  var isLink = !!props.linkTo;
  var isClickable = isLink || !!props.onClick;
  var handleClick = props.onClick ? props.onClick : (isLink ? function() { props.onNavigate(props.linkTo); } : undefined);

  return h("div", {
    onClick: isClickable ? handleClick : undefined,
    onMouseEnter: isClickable ? function() { setHovered(true); } : undefined,
    onMouseLeave: isClickable ? function() { setHovered(false); } : undefined,
    style: {
      background: hovered ? C.panelBright : C.panel,
      border: "1px solid " + (hovered ? props.accent + "66" : C.border),
      borderRadius: 10,
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6,
      borderTop: "2px solid " + props.accent,
      cursor: isClickable ? "pointer" : "default",
      transition: "background 0.12s, border-color 0.12s",
    },
  },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
      h("span", { style: { color: C.textMid, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: "monospace" } }, props.label),
      h("span", { style: { fontSize: 18, opacity: 0.6 } }, props.icon)
    ),
    valueNode,
    props.sub ? h("span", { style: { color: C.textLo, fontSize: 12 } }, props.sub) : null
  );
}

function Panel(props) {
  const style = Object.assign({ background: C.panel, border: "1px solid " + C.border, borderRadius: 10, padding: 20 }, props.style || {});
  return h("div", { style: style }, props.children);
}

function PanelTitle(props) {
  return h("div", { style: { color: C.textMid, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 16, fontWeight: 600 } }, props.children);
}

function AddBtn(props) {
  return h("button", {
    onClick: props.onClick,
    style: {
      background: "transparent", border: "1px solid " + C.green, color: C.green,
      borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700,
      cursor: "pointer", letterSpacing: 0.5, fontFamily: "monospace",
    },
    onMouseEnter: (e) => { e.currentTarget.style.background = C.green + "22"; },
    onMouseLeave: (e) => { e.currentTarget.style.background = "transparent"; },
  }, "+ " + props.label);
}

function DelBtn(props) {
  return h("button", {
    onClick: props.onClick,
    style: { background: "none", border: "none", color: C.textLo, cursor: "pointer", fontSize: 15, padding: "2px 6px", lineHeight: 1 },
    onMouseEnter: (e) => { e.currentTarget.style.color = C.red; },
    onMouseLeave: (e) => { e.currentTarget.style.color = C.textLo; },
  }, "\u2715");
}

function EditBtn(props) {
  return h("button", {
    onClick: props.onClick,
    style: { background: "none", border: "none", color: C.textLo, cursor: "pointer", fontSize: 14, padding: "2px 6px", lineHeight: 1 },
    onMouseEnter: (e) => { e.currentTarget.style.color = C.blue; },
    onMouseLeave: (e) => { e.currentTarget.style.color = C.textLo; },
  }, "\u270E");
}

function Modal(props) {
  return h("div", {
    style: { position: "fixed", inset: 0, background: "#000000CC", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
    onClick: props.onClose,
  },
    h("div", {
      style: { background: C.panelBright, border: "1px solid " + C.borderBright, borderRadius: 14, padding: 28, width: 440, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto" },
      onClick: (e) => e.stopPropagation(),
    },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 } },
        h("span", { style: { color: C.textHi, fontSize: 15, fontWeight: 600 } }, props.title),
        h("button", { onClick: props.onClose, style: { background: "none", border: "none", color: C.textMid, cursor: "pointer", fontSize: 20, lineHeight: 1 } }, "\u2715")
      ),
      props.children
    )
  );
}

// Popup for picking a projection horizon in years. Offers quick presets plus
// a custom number input for anything else, from 1 up to 50 years out.
function YearPickerModal(props) {
  var currentYears = props.years, onPick = props.onPick, onClose = props.onClose;
  var customState = useState(String(currentYears));
  var custom = customState[0], setCustom = customState[1];
  var presets = [5, 10, 15, 20, 25, 30];

  var applyCustom = function() {
    var v = parseInt(custom, 10);
    if (!isNaN(v) && v >= 1 && v <= 50) onPick(v);
  };

  return h(Modal, { title: "Projection horizon", onClose: onClose },
    h("div", { style: { color: C.textMid, fontSize: 13, lineHeight: 1.6, marginBottom: 18 } },
      "Choose how many years ahead to project. Applies to the projection figure, the chart, and the table below."
    ),
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 18 } },
      presets.map(function(y) {
        var active = y === currentYears;
        return h("button", {
          key: y,
          onClick: function() { onPick(y); },
          style: {
            background: active ? C.purple : "transparent",
            border: "1px solid " + (active ? C.purple : C.border),
            color: active ? "#fff" : C.textHi,
            borderRadius: 8, padding: "12px 8px", fontWeight: 700, fontSize: 14, cursor: "pointer",
          },
        }, y + "yr");
      })
    ),
    h(FRow, { label: "Or enter a custom number of years (1\u201350)" },
      h("div", { style: { display: "flex", gap: 10 } },
        h("input", {
          style: Object.assign({}, inp, { flex: 1 }), type: "number", min: 1, max: 50,
          value: custom, onChange: function(e) { setCustom(e.target.value); },
          onKeyDown: function(e) { if (e.key === "Enter") applyCustom(); },
        }),
        h("button", {
          onClick: applyCustom,
          style: { background: C.purple, color: "#fff", border: "none", borderRadius: 7, padding: "10px 18px", fontWeight: 800, cursor: "pointer", fontSize: 13 },
        }, "Use this")
      )
    ),
    props.onUseAuto ? h("button", {
      onClick: props.onUseAuto,
      style: { width: "100%", background: "transparent", border: "1px solid " + C.border, color: C.textMid, borderRadius: 7, padding: "10px", fontSize: 13, cursor: "pointer", marginTop: 14 },
    }, "\u21BA Back to automatic Debt-Free ETA") : null
  );
}

const inp = {
  width: "100%", background: C.panel, border: "1px solid " + C.border,
  borderRadius: 7, padding: "10px 13px", color: C.textHi, fontSize: 14,
  outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
const sel = Object.assign({}, inp);

function FRow(props) {
  return h("div", { style: { marginBottom: 14 } },
    h("div", { style: { color: C.textMid, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 5 } }, props.label),
    props.children
  );
}

function SaveBtn(props) {
  return h("button", {
    onClick: props.onClick,
    style: { width: "100%", background: C.green, color: "#040810", border: "none", borderRadius: 7, padding: "11px", fontSize: 14, fontWeight: 800, cursor: "pointer", marginTop: 8, letterSpacing: 0.3 },
  }, props.label || "Save");
}

// Monthly close-out: appears automatically when the app detects the calendar
// month has changed since it was last opened. Asks one question — how much
// cash was actually saved last month — and logs it to permanent history.
function MonthCloseModal(props) {
  var monthKey = props.monthKey, onSubmit = props.onClose;
  var savedState = useState("");
  var saved = savedState[0], setSaved = savedState[1];

  var submit = function() {
    var v = parseFloat(saved);
    if (isNaN(v)) { alert("Enter a number (use 0 if you didn't save anything, or a negative number if you went over)."); return; }
    onSubmit(v);
  };

  return h(Modal, { title: "How did " + monthKeyToLabel(monthKey) + " go?", onClose: function() { onSubmit(null); } },
    h("div", { style: { color: C.textMid, fontSize: 13, lineHeight: 1.7, marginBottom: 16 } },
      "A new month has started. How much cash did you actually save from your salary in ", monthKeyToLabel(monthKey), "? This gets added to your cash balance and logged in your history. Your investments and debts will also move forward by one month \u2014 growth and contributions applied to investments, payments and interest applied to debts."
    ),
    h(FRow, { label: "Cash actually saved (\u00A3) \u2014 use a negative number if you overspent" },
      h("input", { style: inp, type: "number", placeholder: "e.g. 850", value: saved, onChange: e => setSaved(e.target.value), autoFocus: true })
    ),
    h(SaveBtn, { onClick: submit, label: "Log it" }),
    h("button", {
      onClick: function() { onSubmit(null); },
      style: { width: "100%", background: "transparent", border: "none", color: C.textLo, padding: "10px", fontSize: 12, cursor: "pointer", marginTop: 4 },
    }, "Skip for now \u2014 ask me later")
  );
}

// ─── PAGE: DASHBOARD ─────────────────────────────────────────────────────────
function Dashboard(props) {
  const data = props.data, setData = props.setData, onNavigate = props.onNavigate;
  const fc36 = useMemo(() => buildForecast(data, 36), [data]);

  const mIncome = data.income.filter(t => t.recur === "monthly").reduce((s, t) => s + t.amount, 0);
  const mExpenses = data.expenses.filter(t => t.recur === "monthly").reduce((s, t) => s + t.amount, 0);
  const mDebtPay = data.debts.reduce((s, x) => s + x.payment, 0);
  const mInvest = data.investments.reduce((s, x) => s + x.contrib, 0);
  const mFlow = mIncome - mExpenses - mDebtPay - mInvest;
  const totalDebt = data.debts.reduce((s, x) => s + x.balance, 0);
  const totalInv = data.investments.reduce((s, x) => s + x.value, 0);
  const netWorth = data.cashBalance + totalInv - totalDebt;

  const catMap = {};
  data.expenses.forEach(e => { catMap[e.category] = (catMap[e.category] || 0) + e.amount; });
  const pieData = Object.keys(catMap).map(name => ({ name: name, value: catMap[name] }));
  const PIE_C = [C.green, C.amber, C.blue, C.purple, C.red, "#34D399", "#FB923C"];

  const flowBar = [
    { label: "Income", value: mIncome, fill: C.green },
    { label: "Expenses", value: mExpenses, fill: C.red },
    { label: "Debt Pay", value: mDebtPay, fill: C.amber },
    { label: "Investing", value: mInvest, fill: C.blue },
    { label: "Spare", value: Math.max(0, mFlow), fill: C.purple },
  ];

  const fc12end = fc36[12];

  // This Month — simple, honest "so far" summary. No projections: the real
  // answer for how the month went comes from the monthly close-out prompt,
  // where you tell the app directly how much you saved. Trying to predict
  // that here via daily-rate extrapolation produced misleading "over budget"
  // warnings that ignored your actual monthly surplus, so this just shows
  // what's actually been logged so far, plain and simple.
  //
  // A "monthly" recurring entry represents something that happens every month
  // from its start date onward (rent, salary, subscriptions) — it should count
  // toward every month's totals, not just the one date it was originally
  // entered on. A one-off/weekly/annual entry only counts for its specific
  // dated month.
  const mp = monthProgress();
  const thisMonthKey = currentMonthKey();
  const countsTowardThisMonth = (t) => {
    if (t.recur === "monthly") return (t.date || "") <= thisMonthKey + "-31"; // started on or before this month
    return (t.date || "").slice(0, 7) === thisMonthKey;
  };
  const loggedInThisMonth = data.income.filter(countsTowardThisMonth).reduce((s, t) => s + t.amount, 0);
  const loggedOutThisMonth = data.expenses.filter(countsTowardThisMonth).reduce((s, t) => s + t.amount, 0);
  const netSoFar = loggedInThisMonth - loggedOutThisMonth;

  const catActualThisMonth = {};
  data.expenses.filter(countsTowardThisMonth).forEach(e => { catActualThisMonth[e.category] = (catActualThisMonth[e.category] || 0) + e.amount; });
  const catRows = Object.keys(catActualThisMonth)
    .map(cat => ({ cat, amount: catActualThisMonth[cat] }))
    .sort((a, b) => b.amount - a.amount);
  const catTotal = catRows.reduce((s, r) => s + r.amount, 0);

  const history = (data.monthlyHistory || []).slice(-12);

  return h("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 } },
      h(KPICard, { label: "Net Worth", value: gbp(netWorth, true), sub: (fc12end.netWorth >= netWorth ? "+" : "") + gbp(fc12end.netWorth - netWorth, true) + " in 12mo", accent: C.green, icon: "\u25C8" }),
      h(KPICard, { label: "Cash", value: gbp(data.cashBalance, true), rawValue: data.cashBalance, editable: true, onEdit: function(v) { setData(d => Object.assign({}, d, { cashBalance: v })); }, sub: "Liquid now \u2014 tap to update", accent: C.blue, icon: "\u25CE" }),
      h(KPICard, { label: "Investments", value: gbp(totalInv, true), sub: "+" + gbp(fc12end.investments - totalInv, true) + " in 12mo \u2014 tap to view", accent: C.amber, icon: "\u2197", linkTo: "investments", onNavigate: onNavigate }),
      h(KPICard, { label: "Total Debt", value: gbp(totalDebt, true), sub: gbp(Math.max(0, totalDebt - fc12end.debt), true) + " cleared in 12mo \u2014 tap to view", accent: C.red, icon: "\u2198", linkTo: "debt", onNavigate: onNavigate }),
      h(KPICard, { label: "Monthly Surplus", value: gbp(mFlow, true), sub: (mFlow >= 0 ? "After all commitments" : "Shortfall \u2014 review expenses") + " \u2014 tap to view", accent: mFlow >= 0 ? C.green : C.red, icon: "\u2192", linkTo: "transactions", onNavigate: onNavigate })
    ),

    h(Panel, null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
        h(PanelTitle, null, "This Month So Far \u2014 " + monthKeyToLabel(thisMonthKey)),
        h("span", { style: { color: C.textLo, fontSize: 11, fontFamily: "monospace" } }, "Day " + mp.day + " of " + mp.total)
      ),

      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 14, marginBottom: catRows.length ? 18 : 0 } },
        h("div", null,
          h("div", { style: { color: C.textLo, fontSize: 11, fontFamily: "monospace", marginBottom: 4 } }, "LOGGED IN"),
          h("div", { style: { color: C.green, fontSize: 20, fontWeight: 700, fontFamily: "monospace" } }, gbp(loggedInThisMonth, true))
        ),
        h("div", null,
          h("div", { style: { color: C.textLo, fontSize: 11, fontFamily: "monospace", marginBottom: 4 } }, "LOGGED OUT"),
          h("div", { style: { color: C.red, fontSize: 20, fontWeight: 700, fontFamily: "monospace" } }, gbp(loggedOutThisMonth, true))
        ),
        h("div", null,
          h("div", { style: { color: C.textLo, fontSize: 11, fontFamily: "monospace", marginBottom: 4 } }, "NET SO FAR"),
          h("div", { style: { color: netSoFar >= 0 ? C.green : C.red, fontSize: 20, fontWeight: 700, fontFamily: "monospace" } }, (netSoFar >= 0 ? "+" : "") + gbp(netSoFar, true))
        )
      ),

      h("div", { style: { color: C.textLo, fontSize: 11, marginBottom: catRows.length ? 14 : 0, paddingTop: catRows.length ? 14 : 0, borderTop: catRows.length ? "1px solid " + C.border : "none" } },
        "This is what's been logged in Transactions so far this month \u2014 it doesn't try to predict how the month finishes. At month-end you'll be asked how much you actually saved, which is what really updates your cash balance and history."
      ),

      catRows.length > 0 ? h("div", null,
        h("div", { style: { color: C.textLo, fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 } }, "Spending logged so far, by category"),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 9 } },
          catRows.map((r, i) => {
            const frac = catTotal > 0 ? r.amount / catTotal : 0;
            return h("div", { key: i },
              h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 } },
                h("span", { style: { color: C.textHi } }, r.cat),
                h("span", { style: { fontFamily: "monospace", color: C.textMid } }, gbp(r.amount, true))
              ),
              h("div", { style: { background: C.panelBright, borderRadius: 6, height: 6, overflow: "hidden" } },
                h("div", { style: { height: "100%", width: Math.max(2, frac * 100) + "%", background: C.blue } })
              )
            );
          })
        )
      ) : h("div", { style: { color: C.textLo, fontSize: 12 } }, "Nothing logged yet this month \u2014 add income or expenses on the Transactions page as the month goes.")
    ),

    h(Panel, null,
      h(PanelTitle, null, "Net Worth \u2014 36-month forecast"),
      h(MiniChart, { data: fc36, height: 240, xLabelEvery: 5, yFormatter: v => gbp(v, true), series: [{ key: "netWorth", color: C.green, type: "area", name: "Net Worth" }] })
    ),
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 } },
      h(Panel, null,
        h(PanelTitle, null, "Investments"),
        h(MiniChart, { data: fc36, height: 160, xLabelEvery: 8, yFormatter: v => gbp(v, true), series: [{ key: "investments", color: C.amber, type: "area", name: "Investments" }] })
      ),
      h(Panel, null,
        h(PanelTitle, null, "Debt Paydown"),
        h(MiniChart, { data: fc36, height: 160, xLabelEvery: 8, yFormatter: v => gbp(v, true), series: [{ key: "debt", color: C.red, type: "area", name: "Debt" }] })
      ),
      h(Panel, null,
        h(PanelTitle, null, "Cash Balance"),
        h(MiniChart, { data: fc36, height: 160, xLabelEvery: 8, yFormatter: v => gbp(v, true), series: [{ key: "cash", color: C.blue, type: "line", name: "Cash" }] })
      )
    ),
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 } },
      h(Panel, null,
        h(PanelTitle, null, "Spending breakdown"),
        h(MiniPieChart, { height: 200, data: pieData.map((d, i) => ({ name: d.name, value: d.value, color: PIE_C[i % PIE_C.length] })) })
      ),
      h(Panel, null,
        h(PanelTitle, null, "Monthly money flow"),
        h(MiniBarChart, { data: flowBar, height: 200, yFormatter: v => gbp(v, true) })
      )
    ),
    history.length > 0 ? h(Panel, null,
      h(PanelTitle, null, "Monthly history \u2014 actual cash saved"),
      h(MiniBarChart, {
        data: history.map(function(m) { return { label: monthKeyToLabel(m.month).slice(0, 3) + " '" + monthKeyToLabel(m.month).slice(-2), value: m.savedAmount, fill: m.savedAmount >= 0 ? C.green : C.red }; }),
        height: 180, yFormatter: v => gbp(v, true),
      })
    ) : null
  );
}

// ─── PAGE: TRANSACTIONS ───────────────────────────────────────────────────────
function Transactions(props) {
  const data = props.data, setData = props.setData;
  const modalState = useState(null); // "income" | "expense" (add mode)
  const modal = modalState[0], setModal = modalState[1];
  const editState = useState(null); // { type, id } when editing an existing entry
  const editing = editState[0], setEditing = editState[1];
  const formState = useState({});
  const form = formState[0], setForm = formState[1];

  const openAddModal = (type) => {
    setEditing(null);
    setForm({ type: type, date: todayStr(), label: "", amount: "", category: "", recur: "monthly" });
    setModal(type);
  };

  const openEditModal = (type, entry) => {
    setEditing({ type: type, id: entry.id });
    setForm({ type: type, date: entry.date, label: entry.label, amount: String(entry.amount), category: entry.category, recur: entry.recur });
    setModal(type);
  };

  const save = () => {
    if (!form.label || !form.amount) return;
    const key = form.type === "income" ? "income" : "expenses";
    if (editing) {
      setData(d => {
        const nd = Object.assign({}, d);
        nd[key] = d[key].map(x => x.id === editing.id
          ? Object.assign({}, x, { date: form.date, label: form.label, amount: parseFloat(form.amount), category: form.category || "Other", recur: form.recur })
          : x
        );
        return nd;
      });
    } else {
      const entry = { id: uid(), date: form.date, label: form.label, amount: parseFloat(form.amount), category: form.category || "Other", recur: form.recur };
      setData(d => { const nd = Object.assign({}, d); nd[key] = d[key].concat([entry]); return nd; });
    }
    setModal(null);
    setEditing(null);
  };

  const del = (key, id) => setData(d => { const nd = Object.assign({}, d); nd[key] = d[key].filter(x => x.id !== id); return nd; });

  const totalIn = data.income.reduce((s, t) => s + t.amount, 0);
  const totalOut = data.expenses.reduce((s, t) => s + t.amount, 0);
  const recurIn = data.income.filter(t => t.recur === "monthly").reduce((s, t) => s + t.amount, 0);
  const recurOut = data.expenses.filter(t => t.recur === "monthly").reduce((s, t) => s + t.amount, 0);

  function recurPill(r) {
    const label = r === "monthly" ? "Monthly" : r === "weekly" ? "Weekly" : r === "annual" ? "Annual" : "One-off";
    const color = r === "monthly" ? C.green : r === "weekly" ? C.blue : r === "annual" ? C.amber : C.textMid;
    return pill(label, color);
  }

  function TH(ch, right) {
    return h("th", {
      style: { padding: "8px 8px", color: C.textLo, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "monospace", fontWeight: 500, textAlign: right ? "right" : "left", borderBottom: "1px solid " + C.border },
    }, ch);
  }

  function Row(t, colorAmt, type, onDel) {
    return h("tr", { key: t.id },
      h("td", { style: { padding: "10px 8px", color: C.textMid, fontSize: 12, fontFamily: "monospace" } }, t.date),
      h("td", { style: { padding: "10px 8px", color: C.textHi } }, t.label),
      h("td", { style: { padding: "10px 8px" } }, pill(t.category, C.blue)),
      h("td", { style: { padding: "10px 8px" } }, recurPill(t.recur)),
      h("td", { style: { padding: "10px 8px", color: colorAmt, fontFamily: "monospace", fontWeight: 600, textAlign: "right" } }, gbp(t.amount)),
      h("td", { style: { padding: "10px 4px", textAlign: "right", whiteSpace: "nowrap" } },
        h(EditBtn, { onClick: () => openEditModal(type, t) }),
        h(DelBtn, { onClick: onDel })
      )
    );
  }

  function table(rows, colorAmt, keyName, type, emptyMsg) {
    return h("div", { style: { overflowX: "auto" } },
      h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 } },
        h("thead", null, h("tr", null, TH("Date"), TH("Description"), TH("Category"), TH("Recurs"), TH("Amount", true), TH(""))),
        h("tbody", null,
          rows.length === 0 ? h("tr", null, h("td", { colSpan: 6, style: { color: C.textLo, padding: "20px 8px", textAlign: "center" } }, emptyMsg)) : null,
          rows.map(t => Row(t, colorAmt, type, () => del(keyName, t.id)))
        )
      )
    );
  }

  const isIncome = form.type === "income";
  const modalContent = modal ? h(Modal, { title: (editing ? "Edit " : "Add ") + (isIncome ? "Income Entry" : "Expense"), onClose: () => { setModal(null); setEditing(null); } },
    h(FRow, { label: "Date" }, h("input", { style: inp, type: "date", value: form.date, onChange: e => setForm(f => Object.assign({}, f, { date: e.target.value })) })),
    h(FRow, { label: "Description" }, h("input", { style: inp, placeholder: isIncome ? "e.g. Salary, Bonus\u2026" : "e.g. Groceries, Rent\u2026", value: form.label, onChange: e => setForm(f => Object.assign({}, f, { label: e.target.value })) })),
    h(FRow, { label: "Amount (\u00A3)" }, h("input", { style: inp, type: "number", placeholder: "0.00", value: form.amount, onChange: e => setForm(f => Object.assign({}, f, { amount: e.target.value })) })),
    h(FRow, { label: "Category" }, h("input", { style: inp, placeholder: isIncome ? "Employment, Freelance, Rental\u2026" : "Housing, Food, Bills\u2026", value: form.category, onChange: e => setForm(f => Object.assign({}, f, { category: e.target.value })) })),
    h(FRow, { label: "Recurrence" },
      h("select", { style: sel, value: form.recur, onChange: e => setForm(f => Object.assign({}, f, { recur: e.target.value })) },
        h("option", { value: "monthly" }, "Monthly"),
        h("option", { value: "weekly" }, "Weekly"),
        h("option", { value: "annual" }, "Annual"),
        h("option", { value: "once" }, "One-off")
      )
    ),
    h(SaveBtn, { onClick: save, label: editing ? "Save changes" : "Save" })
  ) : null;

  return h("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 } },
      h(KPICard, { label: "Total Logged In", value: gbp(totalIn, true), sub: "All income entries", accent: C.green, icon: "\u2191" }),
      h(KPICard, { label: "Total Logged Out", value: gbp(totalOut, true), sub: "All expense entries", accent: C.red, icon: "\u2193" }),
      h(KPICard, { label: "Monthly Recurring \u2191", value: gbp(recurIn, true), sub: "Regular income", accent: C.blue, icon: "\u221E" }),
      h(KPICard, { label: "Monthly Recurring \u2193", value: gbp(recurOut, true), sub: "Regular expenses", accent: C.amber, icon: "\u221E" })
    ),
    h(Panel, null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } },
        h(PanelTitle, null, "Income"),
        h(AddBtn, { label: "Add Income", onClick: () => openAddModal("income") })
      ),
      table(data.income, C.green, "income", "income", "No income entries yet.")
    ),
    h(Panel, null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } },
        h(PanelTitle, null, "Expenses"),
        h(AddBtn, { label: "Add Expense", onClick: () => openAddModal("expense") })
      ),
      table(data.expenses, C.red, "expenses", "expense", "No expenses yet.")
    ),
    modalContent
  );
}

// ─── PAGE: DEBT ───────────────────────────────────────────────────────────────
function Debt(props) {
  const data = props.data, setData = props.setData;
  const modalState = useState(false);
  const modal = modalState[0], setModal = modalState[1];
  const editIdState = useState(null);
  const editId = editIdState[0], setEditId = editIdState[1];
  const formState = useState({ name: "", balance: "", rate: "", payment: "" });
  const form = formState[0], setForm = formState[1];
  const debtCardModeState = useState("eta"); // "eta" | "atYear"
  const debtCardMode = debtCardModeState[0], setDebtCardMode = debtCardModeState[1];
  const debtCardYearState = useState(5);
  const debtCardYear = debtCardYearState[0], setDebtCardYear = debtCardYearState[1];
  const showDebtYearPickerState = useState(false);
  const showDebtYearPicker = showDebtYearPickerState[0], setShowDebtYearPicker = showDebtYearPickerState[1];

  const openAdd = () => {
    setEditId(null);
    setForm({ name: "", balance: "", rate: "", payment: "" });
    setModal(true);
  };

  const openEdit = (d) => {
    setEditId(d.id);
    setForm({ name: d.name, balance: String(d.balance), rate: String(d.rate), payment: String(d.payment) });
    setModal(true);
  };

  const save = () => {
    if (!form.name || !form.balance) return;
    if (editId) {
      setData(d => Object.assign({}, d, {
        debts: d.debts.map(x => x.id === editId
          ? Object.assign({}, x, { name: form.name, balance: parseFloat(form.balance), rate: parseFloat(form.rate) || 0, payment: parseFloat(form.payment) || 0 })
          : x
        ),
      }));
    } else {
      setData(d => Object.assign({}, d, {
        debts: d.debts.concat([{ id: uid(), name: form.name, balance: parseFloat(form.balance), rate: parseFloat(form.rate) || 0, payment: parseFloat(form.payment) || 0 }]),
      }));
    }
    setModal(false);
    setEditId(null);
    setForm({ name: "", balance: "", rate: "", payment: "" });
  };
  const del = (id) => setData(d => Object.assign({}, d, { debts: d.debts.filter(x => x.id !== id) }));

  const totalDebt = data.debts.reduce((s, x) => s + x.balance, 0);
  const totalPay = data.debts.reduce((s, x) => s + x.payment, 0);
  const debtHorizonMonths = Math.max(60, debtCardYear * 12);
  const fc60 = useMemo(() => buildForecast(data, debtHorizonMonths), [data, debtHorizonMonths]);
  const debtFc = useMemo(() => buildDebtForecast(data.debts, debtHorizonMonths), [data.debts, debtHorizonMonths]);

  const payoffETA = (d) => {
    let bal = d.balance, m = 0;
    while (bal > 0.5 && m < 720) { bal += bal * d.rate / 100 / 12; bal -= d.payment; m++; }
    if (m >= 720) return "\u2014";
    return m < 12 ? m + "mo" : (m / 12).toFixed(1) + "yr";
  };

  const totalInterest = (d) => {
    let bal = d.balance, tot = 0, m = 0;
    while (bal > 0.5 && m < 720) { const i = bal * d.rate / 100 / 12; tot += i; bal += i - d.payment; m++; }
    return tot;
  };

  const debtFreeRow = fc60.find(r => r.debt < 100);
  const debtFreeLabel = debtFreeRow ? debtFreeRow.label : debtHorizonMonths + "mo+";
  const balanceAtYear = (fc60[debtCardYear * 12] || {}).debt;
  const balanceAtYearLabel = balanceAtYear === undefined ? "\u2014" : gbp(balanceAtYear, true);

  const rows = data.debts.map(d =>
    h("tr", { key: d.id },
      h("td", { style: { padding: "11px 10px", color: C.textHi, fontWeight: 500 } }, d.name),
      h("td", { style: { padding: "11px 10px", color: C.red, fontFamily: "monospace", fontWeight: 700, textAlign: "right" } }, gbp(d.balance)),
      h("td", { style: { padding: "11px 10px", color: C.textMid, fontFamily: "monospace", textAlign: "right" } }, d.rate + "%"),
      h("td", { style: { padding: "11px 10px", color: C.amber, fontFamily: "monospace", textAlign: "right" } }, gbp(d.payment)),
      h("td", { style: { padding: "11px 10px", color: C.textMid, fontFamily: "monospace", fontSize: 12, textAlign: "right" } }, gbp(totalInterest(d), true)),
      h("td", { style: { padding: "11px 10px", textAlign: "right" } }, pill(payoffETA(d), C.green)),
      h("td", { style: { padding: "11px 4px", textAlign: "right", whiteSpace: "nowrap" } },
        h(EditBtn, { onClick: () => openEdit(d) }),
        h(DelBtn, { onClick: () => del(d.id) })
      )
    )
  );

  const headers = ["Debt", "Balance", "APR", "Monthly Payment", "Total Interest", "Payoff ETA", ""];
  const headerRow = h("tr", null, headers.map((hd, i) =>
    h("th", { key: i, style: { padding: "8px 10px", color: C.textLo, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "monospace", fontWeight: 500, textAlign: (i >= 1 && i <= 5) ? "right" : "left", borderBottom: "1px solid " + C.border } }, hd)
  ));

  const modalContent = modal ? h(Modal, { title: editId ? "Edit Debt" : "Add Debt", onClose: () => { setModal(false); setEditId(null); } },
    h(FRow, { label: "Name" }, h("input", { style: inp, placeholder: "e.g. Credit Card, Car Finance", value: form.name, onChange: e => setForm(f => Object.assign({}, f, { name: e.target.value })) })),
    h(FRow, { label: "Current Balance (\u00A3)" }, h("input", { style: inp, type: "number", placeholder: "5000", value: form.balance, onChange: e => setForm(f => Object.assign({}, f, { balance: e.target.value })) })),
    h(FRow, { label: "Annual Interest Rate (%)" }, h("input", { style: inp, type: "number", placeholder: "19.9", value: form.rate, onChange: e => setForm(f => Object.assign({}, f, { rate: e.target.value })) })),
    h(FRow, { label: "Monthly Payment (\u00A3)" }, h("input", { style: inp, type: "number", placeholder: "150", value: form.payment, onChange: e => setForm(f => Object.assign({}, f, { payment: e.target.value })) })),
    h(SaveBtn, { onClick: save, label: editId ? "Save changes" : "Save" })
  ) : null;

  return h("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 } },
      h(KPICard, { label: "Total Debt", value: gbp(totalDebt, true), sub: data.debts.length + " debts tracked", accent: C.red, icon: "\u25BC" }),
      h(KPICard, { label: "Monthly Payments", value: gbp(totalPay, true), sub: "Combined outgoing", accent: C.amber, icon: "\u2193" }),
      debtCardMode === "eta"
        ? h(KPICard, {
            label: "Debt-Free ETA", value: debtFreeLabel,
            sub: "At current payment rates \u2014 tap to view a chosen year instead", accent: C.green, icon: "\u2713",
            onClick: () => setShowDebtYearPicker(true),
          })
        : h(KPICard, {
            label: "Balance in " + debtCardYear + "yr", value: balanceAtYearLabel,
            sub: "Tap to change \u2014 or pick \"Back to auto ETA\" in the picker", accent: C.green, icon: "\u25C8",
            onClick: () => setShowDebtYearPicker(true),
          })
    ),
    h(Panel, null,
      h(PanelTitle, null, "Debt paydown \u2014 60-month projection (total)"),
      h(MiniChart, { data: fc60, height: 220, xLabelEvery: 8, yFormatter: v => gbp(v, true), series: [{ key: "debt", color: C.red, type: "area", name: "Total Debt" }] })
    ),
    data.debts.length > 0 ? h(Panel, null,
      h(PanelTitle, null, "Debt paydown \u2014 by debt"),
      h(MiniChart, { data: debtFc.rows, height: 240, xLabelEvery: 8, yFormatter: v => gbp(v, true), series: data.debts.map((d, i) => ({ key: d.name, color: debtFc.colors[i % debtFc.colors.length], type: "line", name: d.name })) }),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px 16px", justifyContent: "center", marginTop: 10 } },
        data.debts.map((d, i) =>
          h("div", { key: d.id, style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textMid } },
            h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: debtFc.colors[i % debtFc.colors.length], display: "inline-block" } }),
            d.name
          )
        )
      )
    ) : null,
    h(Panel, null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } },
        h(PanelTitle, null, "Debts"),
        h(AddBtn, { label: "Add Debt", onClick: openAdd })
      ),
      h("div", { style: { overflowX: "auto" } },
        h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 } },
          h("thead", null, headerRow),
          h("tbody", null, data.debts.length === 0 ? h("tr", null, h("td", { colSpan: 7, style: { color: C.textLo, padding: "20px 10px", textAlign: "center" } }, "No debts tracked.")) : null, rows)
        )
      )
    ),
    modalContent,
    showDebtYearPicker ? h(YearPickerModal, {
      years: debtCardYear,
      onPick: (y) => { setDebtCardYear(y); setDebtCardMode("atYear"); setShowDebtYearPicker(false); },
      onClose: () => setShowDebtYearPicker(false),
      onUseAuto: () => { setDebtCardMode("eta"); setShowDebtYearPicker(false); },
    }) : null
  );
}

// ─── PAGE: INVESTMENTS ────────────────────────────────────────────────────────
function Investments(props) {
  const data = props.data, setData = props.setData;
  const modalState = useState(false);
  const modal = modalState[0], setModal = modalState[1];
  const editIdState = useState(null);
  const editId = editIdState[0], setEditId = editIdState[1];
  const formState = useState({ name: "", value: "", contrib: "", returnPct: "", type: "Stocks" });
  const form = formState[0], setForm = formState[1];
  const projYearsState = useState(10);
  const projYears = projYearsState[0], setProjYears = projYearsState[1];
  const yearPickerState = useState(false);
  const showYearPicker = yearPickerState[0], setShowYearPicker = yearPickerState[1];

  const openAdd = () => {
    setEditId(null);
    setForm({ name: "", value: "", contrib: "", returnPct: "", type: "Stocks" });
    setModal(true);
  };

  const openEdit = (inv) => {
    setEditId(inv.id);
    setForm({ name: inv.name, value: String(inv.value), contrib: String(inv.contrib), returnPct: String(inv.returnPct), type: inv.type });
    setModal(true);
  };

  const save = () => {
    if (!form.name || !form.value) return;
    if (editId) {
      setData(d => Object.assign({}, d, {
        investments: d.investments.map(x => x.id === editId
          ? Object.assign({}, x, { name: form.name, value: parseFloat(form.value), contrib: parseFloat(form.contrib) || 0, returnPct: parseFloat(form.returnPct) || 0, type: form.type })
          : x
        ),
      }));
    } else {
      setData(d => Object.assign({}, d, {
        investments: d.investments.concat([{ id: uid(), name: form.name, value: parseFloat(form.value), contrib: parseFloat(form.contrib) || 0, returnPct: parseFloat(form.returnPct) || 0, type: form.type }]),
      }));
    }
    setModal(false);
    setEditId(null);
    setForm({ name: "", value: "", contrib: "", returnPct: "", type: "Stocks" });
  };
  const del = (id) => setData(d => Object.assign({}, d, { investments: d.investments.filter(x => x.id !== id) }));

  const totalVal = data.investments.reduce((s, x) => s + x.value, 0);
  const totalContrib = data.investments.reduce((s, x) => s + x.contrib, 0);
  const projMonths = projYears * 12;

  const fcResult = useMemo(() => buildInvForecast(data.investments, projMonths), [data.investments, projMonths]);
  const invChartRows = fcResult.rows, invColors = fcResult.colors;

  const projVal = (inv) => {
    let v = inv.value;
    for (let i = 0; i < projMonths; i++) v = v * (1 + inv.returnPct / 100 / 12) + inv.contrib;
    return v;
  };

  const TYPE_COLORS = { Stocks: C.green, Savings: C.blue, Pension: C.amber, Crypto: C.purple, Bonds: C.textMid, Property: "#F97316", Other: C.red };

  const headers = ["Holding", "Type", "Current Value", "Monthly Add", "Exp. Return", projYears + "yr Projection", ""];
  const headerRow = h("tr", null, headers.map((hd, i) =>
    h("th", { key: i, style: { padding: "8px 10px", color: C.textLo, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "monospace", fontWeight: 500, textAlign: (i >= 2 && i <= 5) ? "right" : "left", borderBottom: "1px solid " + C.border } }, hd)
  ));

  const rows = data.investments.map((inv) =>
    h("tr", { key: inv.id },
      h("td", { style: { padding: "11px 10px", color: C.textHi, fontWeight: 500 } }, inv.name),
      h("td", { style: { padding: "11px 10px" } }, pill(inv.type, TYPE_COLORS[inv.type] || C.textMid)),
      h("td", { style: { padding: "11px 10px", color: C.amber, fontFamily: "monospace", fontWeight: 700, textAlign: "right" } }, gbp(inv.value)),
      h("td", { style: { padding: "11px 10px", color: C.green, fontFamily: "monospace", textAlign: "right" } }, gbp(inv.contrib)),
      h("td", { style: { padding: "11px 10px", color: C.textMid, fontFamily: "monospace", textAlign: "right" } }, inv.returnPct + "%"),
      h("td", { style: { padding: "11px 10px", color: C.purple, fontFamily: "monospace", fontWeight: 700, textAlign: "right" } }, gbp(projVal(inv), true)),
      h("td", { style: { padding: "11px 4px", textAlign: "right", whiteSpace: "nowrap" } },
        h(EditBtn, { onClick: () => openEdit(inv) }),
        h(DelBtn, { onClick: () => del(inv.id) })
      )
    )
  );

  const legend = data.investments.map((inv, i) =>
    h("div", { key: inv.id, style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textMid } },
      h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: invColors[i % invColors.length], display: "inline-block" } }),
      inv.name
    )
  );

  const modalContent = modal ? h(Modal, { title: editId ? "Edit Investment Holding" : "Add Investment Holding", onClose: () => { setModal(false); setEditId(null); } },
    h(FRow, { label: "Name" }, h("input", { style: inp, placeholder: "e.g. S&P 500 ETF, Cash ISA", value: form.name, onChange: e => setForm(f => Object.assign({}, f, { name: e.target.value })) })),
    h(FRow, { label: "Current Value (\u00A3)" }, h("input", { style: inp, type: "number", placeholder: "5000", value: form.value, onChange: e => setForm(f => Object.assign({}, f, { value: e.target.value })) })),
    h(FRow, { label: "Monthly Contribution (\u00A3)" }, h("input", { style: inp, type: "number", placeholder: "200", value: form.contrib, onChange: e => setForm(f => Object.assign({}, f, { contrib: e.target.value })) })),
    h(FRow, { label: "Expected Annual Return (%)" }, h("input", { style: inp, type: "number", placeholder: "7", value: form.returnPct, onChange: e => setForm(f => Object.assign({}, f, { returnPct: e.target.value })) })),
    h(FRow, { label: "Type" },
      h("select", { style: sel, value: form.type, onChange: e => setForm(f => Object.assign({}, f, { type: e.target.value })) },
        ["Stocks", "Bonds", "Crypto", "Savings", "Pension", "Property", "Other"].map(t => h("option", { key: t }, t))
      )
    ),
    h(SaveBtn, { onClick: save, label: editId ? "Save changes" : "Save" })
  ) : null;

  return h("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 } },
      h(KPICard, { label: "Portfolio Value", value: gbp(totalVal, true), sub: "Current total", accent: C.amber, icon: "\u25B2" }),
      h(KPICard, { label: "Monthly Investing", value: gbp(totalContrib, true), sub: "Regular contributions", accent: C.green, icon: "+" }),
      h(KPICard, {
        label: projYears + "-yr Projection", value: gbp(data.investments.reduce((s, i) => s + projVal(i), 0), true),
        sub: "At stated returns \u2014 tap to change years", accent: C.purple, icon: "\u25C8",
        onClick: () => setShowYearPicker(true),
      })
    ),
    h(Panel, null,
      h(PanelTitle, null, projYears + "-year investment forecast \u2014 by holding"),
      h(MiniChart, { data: invChartRows, height: 250, xLabelEvery: Math.max(1, Math.round(invChartRows.length / 8)), yFormatter: v => gbp(v, true), series: data.investments.map((inv, i) => ({ key: inv.name, color: invColors[i % invColors.length], type: "line", name: inv.name })) }),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px 16px", justifyContent: "center", marginTop: 10 } }, legend)
    ),
    h(Panel, null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } },
        h(PanelTitle, null, "Holdings"),
        h(AddBtn, { label: "Add Holding", onClick: openAdd })
      ),
      h("div", { style: { overflowX: "auto" } },
        h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 } },
          h("thead", null, headerRow),
          h("tbody", null, data.investments.length === 0 ? h("tr", null, h("td", { colSpan: 7, style: { color: C.textLo, padding: "20px 10px", textAlign: "center" } }, "No holdings yet.")) : null, rows)
        )
      )
    ),
    modalContent,
    showYearPicker ? h(YearPickerModal, {
      years: projYears,
      onPick: (y) => { setProjYears(y); setShowYearPicker(false); },
      onClose: () => setShowYearPicker(false),
    }) : null
  );
}

// ─── PAGE: SETTINGS ───────────────────────────────────────────────────────────
function Settings(props) {
  const data = props.data, setData = props.setData;
  const onReset = props.onReset, onExport = props.onExport, onImport = props.onImport;
  const syncCode = props.syncCode, setSyncCode = props.setSyncCode;
  const syncStatus = props.syncStatus, setSyncStatus = props.setSyncStatus;
  const setDataRaw = props.setDataRaw, ignoreRemoteRef = props.ignoreRemoteRef;

  const cashState = useState(String(data.cashBalance));
  const cash = cashState[0], setCash = cashState[1];
  const codeInputState = useState(syncCode || "");
  const codeInput = codeInputState[0], setCodeInput = codeInputState[1];

  const saveCash = () => {
    const v = parseFloat(cash);
    if (!isNaN(v)) setData(d => Object.assign({}, d, { cashBalance: v }));
  };

  const connectSync = () => {
    var code = codeInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!code) { alert("Enter a sync code first."); return; }
    setSyncCode(code);
    setSyncStatus("connecting");
    startSync(code, function(remoteData) {
      if (ignoreRemoteRef && ignoreRemoteRef.current) return;
      setDataRaw(remoteData);
      setSyncStatus("connected");
    });
    setSyncStatus("connected");
  };

  const disconnectSync = () => {
    stopSync();
    setSyncCode("");
    setCodeInput("");
    setSyncStatus("off");
  };

  // ── App lock setup ──
  const lockEnabledState = useState(isLockEnabled());
  const lockEnabled = lockEnabledState[0], setLockEnabled = lockEnabledState[1];
  const bioRegisteredState = useState(hasBiometricCredential());
  const bioRegistered = bioRegisteredState[0], setBioRegistered = bioRegisteredState[1];
  const newPinState = useState("");
  const newPin = newPinState[0], setNewPin = newPinState[1];
  const lockMsgState = useState("");
  const lockMsg = lockMsgState[0], setLockMsg = lockMsgState[1];

  const enableLock = () => {
    if (!newPin || newPin.length < 4) { setLockMsg("Choose a PIN of at least 4 digits."); return; }
    setPin(newPin);
    setLockEnabled(true);
    setNewPin("");
    setLockMsg("PIN set. App will lock next time you open it.");
  };

  const turnOffLock = () => {
    if (window.confirm("Turn off the lock screen for this app?")) {
      disableLock();
      setLockEnabled(false);
      setBioRegistered(false);
      setLockMsg("");
    }
  };

  const setupBiometric = () => {
    registerBiometric().then(() => {
      setBioRegistered(true);
      setLockMsg("Face ID / Touch ID registered.");
    }).catch((e) => {
      setLockMsg("Couldn't set up Face ID / Touch ID: " + e.message);
    });
  };

  const statusColor = syncStatus === "connected" ? C.green : syncStatus === "connecting" ? C.amber : C.textLo;
  const statusLabel = syncStatus === "connected" ? "Connected — syncing" : syncStatus === "connecting" ? "Connecting..." : "Not connected";

  const mIncome = data.income.filter(t => t.recur === "monthly").reduce((s, t) => s + t.amount, 0);
  const mExpenses = data.expenses.filter(t => t.recur === "monthly").reduce((s, t) => s + t.amount, 0);
  const mDebtPay = data.debts.reduce((s, x) => s + x.payment, 0);
  const mInvest = data.investments.reduce((s, x) => s + x.contrib, 0);
  const net = mIncome - mExpenses - mDebtPay - mInvest;

  const rows = [
    { label: "Monthly income", value: gbp(mIncome), color: C.green },
    { label: "Monthly expenses", value: gbp(mExpenses), color: C.red },
    { label: "Monthly debt payments", value: gbp(mDebtPay), color: C.amber },
    { label: "Monthly investing", value: gbp(mInvest), color: C.blue },
    { label: "Net monthly surplus", value: gbp(net), color: net >= 0 ? C.green : C.red },
  ];

  const summaryRows = rows.map((r, i) =>
    h("div", { key: i, style: { display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: i < rows.length - 1 ? "1px solid " + C.border : "" } },
      h("span", { style: { color: C.textMid, fontSize: 13 } }, r.label),
      h("span", { style: { color: r.color, fontFamily: "monospace", fontWeight: 600, fontSize: 13 } }, r.value)
    )
  );

  const fileInputRef = useRef(null);

  return h("div", { style: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 } },

    // ── Sync panel ──
    h(Panel, null,
      h(PanelTitle, null, "\u21C4 Device Sync"),
      h("div", { style: { color: C.textMid, fontSize: 13, lineHeight: 1.7, marginBottom: 14 } },
        "Enter the same sync code on all your devices (iPhone, iPad, etc.) to keep your data in sync automatically. Pick any word or phrase you like — it acts as a shared key."
      ),
      h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 } },
        h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: statusColor, display: "inline-block" } }),
        h("span", { style: { color: statusColor, fontSize: 12, fontFamily: "monospace" } }, statusLabel)
      ),
      syncStatus !== "connected"
        ? h("div", null,
            h(FRow, { label: "Sync code (e.g. james-finplan-2026)" },
              h("input", { style: inp, placeholder: "choose-any-code", value: codeInput, onChange: e => setCodeInput(e.target.value) })
            ),
            h("button", {
              onClick: connectSync,
              style: { background: C.green, color: "#040810", border: "none", borderRadius: 7, padding: "10px 20px", fontWeight: 800, cursor: "pointer", fontSize: 13 },
            }, "Connect & Sync")
          )
        : h("div", null,
            h("div", { style: { background: C.panelBright, borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontFamily: "monospace", fontSize: 13, color: C.textHi } },
              "Code: ", h("strong", null, syncCode)
            ),
            h("div", { style: { color: C.textLo, fontSize: 12, marginBottom: 12 } },
              "Enter this same code in Settings on your other devices to connect them."
            ),
            h("button", {
              onClick: disconnectSync,
              style: { background: "transparent", border: "1px solid " + C.red, color: C.red, borderRadius: 7, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 },
            }, "Disconnect sync")
          )
    ),

    // ── Lock panel ──
    h(Panel, null,
      h(PanelTitle, null, "\u25C9 App Lock"),
      h("div", { style: { color: C.textMid, fontSize: 13, lineHeight: 1.7, marginBottom: 14 } },
        "Lock the app with Face ID, Touch ID, or a PIN so it can't be opened by anyone who picks up your device."
      ),
      lockMsg ? h("div", { style: { color: C.green, fontSize: 12, marginBottom: 12 } }, lockMsg) : null,
      !lockEnabled
        ? h("div", null,
            h(FRow, { label: "Set a PIN (4+ digits)" },
              h("input", { style: Object.assign({}, inp, { textAlign: "center", letterSpacing: 4 }), type: "password", inputMode: "numeric", placeholder: "\u2022\u2022\u2022\u2022", value: newPin, onChange: e => setNewPin(e.target.value) })
            ),
            h("button", {
              onClick: enableLock,
              style: { background: C.green, color: "#040810", border: "none", borderRadius: 7, padding: "10px 20px", fontWeight: 800, cursor: "pointer", fontSize: 13 },
            }, "Enable Lock")
          )
        : h("div", null,
            h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 } },
              h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: C.green, display: "inline-block" } }),
              h("span", { style: { color: C.green, fontSize: 12, fontFamily: "monospace" } }, "Lock enabled \u2014 PIN set")
            ),
            webAuthnSupported()
              ? (bioRegistered
                  ? h("div", { style: { color: C.textMid, fontSize: 13, marginBottom: 14 } }, "\u2713 Face ID / Touch ID is set up on this device.")
                  : h("button", {
                      onClick: setupBiometric,
                      style: { background: "transparent", border: "1px solid " + C.blue, color: C.blue, borderRadius: 7, padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13, marginBottom: 14 },
                    }, "Set up Face ID / Touch ID on this device")
                )
              : h("div", { style: { color: C.textLo, fontSize: 12, marginBottom: 14 } }, "Face ID / Touch ID isn't available in this browser \u2014 PIN only."),
            h("div", null,
              h("button", {
                onClick: turnOffLock,
                style: { background: "transparent", border: "1px solid " + C.red, color: C.red, borderRadius: 7, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 },
              }, "Turn off lock")
            )
          )
    ),

    h(Panel, null,
      h(PanelTitle, null, "Cash balance"),
      h(FRow, { label: "Current cash / bank balance (\u00A3)" },
        h("div", { style: { display: "flex", gap: 10 } },
          h("input", { style: Object.assign({}, inp, { flex: 1 }), type: "number", value: cash, onChange: e => setCash(e.target.value) }),
          h("button", { onClick: saveCash, style: { background: C.green, color: "#040810", border: "none", borderRadius: 7, padding: "10px 18px", fontWeight: 800, cursor: "pointer", fontSize: 13 } }, "Update")
        )
      )
    ),
    h(Panel, null, h(PanelTitle, null, "Monthly summary"), summaryRows),
    h(Panel, null,
      h(PanelTitle, null, "Your data"),
      h("div", { style: { color: C.textMid, fontSize: 13, lineHeight: 1.7, marginBottom: 16 } },
        "Back up your data as a file, or restore it on a new device."),
      h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
        h("button", { onClick: onExport, style: { background: "transparent", border: "1px solid " + C.blue, color: C.blue, borderRadius: 7, padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 } }, "Export backup"),
        h("button", { onClick: () => fileInputRef.current && fileInputRef.current.click(), style: { background: "transparent", border: "1px solid " + C.textMid, color: C.textMid, borderRadius: 7, padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 } }, "Import backup"),
        h("input", { ref: fileInputRef, type: "file", accept: "application/json", style: { display: "none" }, onChange: onImport }),
        h("button", { onClick: onReset, style: { background: "transparent", border: "1px solid " + C.red, color: C.red, borderRadius: 7, padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 } }, "Reset all data")
      )
    ),
    h(Panel, null,
      h(PanelTitle, null, "How forecasts work"),
      h("div", { style: { color: C.textMid, fontSize: 13, lineHeight: 1.8 } },
        h("p", { style: { margin: "0 0 10px" } }, "All projections use the data you've entered across Transactions, Debt, and Investments."),
        h("ul", { style: { margin: 0, paddingLeft: 18, color: C.textLo } },
          h("li", null, h("span", { style: { color: C.textMid } }, "Cash flow"), " = monthly income \u2212 expenses \u2212 debt payments \u2212 investment contributions"),
          h("li", null, h("span", { style: { color: C.textMid } }, "Investments"), " grow at monthly compounding using your stated annual return, plus contributions each month"),
          h("li", null, h("span", { style: { color: C.textMid } }, "Debt"), " is amortised with APR\u00F712 interest added each month, then your payment deducted"),
          h("li", null, h("span", { style: { color: C.textMid } }, "Net worth"), " = cash + investments \u2212 debt")
        )
      )
    )
  );
}


// ─── LOCK SCREEN ──────────────────────────────────────────────────────────────
function LockScreen(props) {
  var onUnlock = props.onUnlock;
  var pinState = useState("");
  var pinInput = pinState[0], setPinInput = pinState[1];
  var errState = useState("");
  var err = errState[0], setErr = errState[1];
  var triedBioState = useState(false);
  var triedBio = triedBioState[0], setTriedBio = triedBioState[1];

  var canBio = webAuthnSupported() && hasBiometricCredential();

  useEffect(function() {
    if (canBio && !triedBio) {
      setTriedBio(true);
      verifyBiometric().then(function() {
        onUnlock();
      }).catch(function() {
        // Fall back to PIN silently — no error shown, this just means
        // biometric was cancelled or unavailable this time.
      });
    }
  }, []);

  var tryPin = function() {
    if (checkPin(pinInput)) {
      onUnlock();
    } else {
      setErr("Incorrect PIN");
      setPinInput("");
    }
  };

  var tryBioAgain = function() {
    setErr("");
    verifyBiometric().then(function() { onUnlock(); }).catch(function() {
      setErr("Face ID / Touch ID didn't match. Enter your PIN instead.");
    });
  };

  return h("div", {
    style: {
      minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 24, padding: 24,
    }
  },
    h("div", { style: { width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg," + C.green + "," + C.blue + ")", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#040810", fontWeight: 900 } }, "\u00A3"),
    h("div", { style: { color: C.textHi, fontSize: 16, fontWeight: 600 } }, "FinPlan is locked"),
    canBio ? h("button", {
      onClick: tryBioAgain,
      style: { background: "transparent", border: "1px solid " + C.green, color: C.green, borderRadius: 10, padding: "12px 22px", fontWeight: 700, cursor: "pointer", fontSize: 14 },
    }, "\u25C9 Use Face ID / Touch ID") : null,
    h("div", { style: { width: 240, display: "flex", flexDirection: "column", gap: 10 } },
      h("input", {
        style: Object.assign({}, inp, { textAlign: "center", fontSize: 20, letterSpacing: 4 }),
        type: "password", inputMode: "numeric", placeholder: "Enter PIN",
        value: pinInput, onChange: function(e) { setPinInput(e.target.value); setErr(""); },
        onKeyDown: function(e) { if (e.key === "Enter") tryPin(); },
      }),
      err ? h("div", { style: { color: C.red, fontSize: 12, textAlign: "center" } }, err) : null,
      h("button", {
        onClick: tryPin,
        style: { background: C.green, color: "#040810", border: "none", borderRadius: 8, padding: "11px", fontWeight: 800, cursor: "pointer", fontSize: 14 },
      }, "Unlock")
    )
  );
}

// ─── PAGE: FUTURE ──────────────────────────────────────────────────────────────
function Future(props) {
  const data = props.data;
  const yearAState = useState(10);
  const yearA = yearAState[0], setYearA = yearAState[1];
  const yearBState = useState(30);
  const yearB = yearBState[0], setYearB = yearBState[1];
  const pickerForState = useState(null); // "A" | "B" | null
  const pickerFor = pickerForState[0], setPickerFor = pickerForState[1];

  // Build a forecast covering at least the larger of the two chosen projection
  // years (plus the fixed 30-year milestone table/charts below), sampled yearly
  // for a readable long-horizon chart — showing every individual month would be
  // unreadable on a chart this wide.
  const horizonYears = Math.max(30, yearA, yearB);
  const fc360 = useMemo(() => buildForecast(data, horizonYears * 12), [data, horizonYears]);
  const yearly = useMemo(() => {
    const rows = [];
    for (let y = 0; y <= horizonYears; y++) {
      const row = fc360[y * 12];
      if (row) rows.push(Object.assign({}, row, { label: y === 0 ? "Now" : y + "yr" }));
    }
    return rows;
  }, [fc360, horizonYears]);

  const milestoneYears = Array.from(new Set([1, 2, 3, 5, 10, 15, 20, 25, 30, yearA, yearB].filter(y => y <= horizonYears))).sort((a, b) => a - b);
  const milestones = milestoneYears.map(y => ({ year: y, row: fc360[y * 12] })).filter(m => m.row);

  const totalDebt = data.debts.reduce((s, x) => s + x.balance, 0);
  const totalInv = data.investments.reduce((s, x) => s + x.value, 0);
  const netWorthNow = data.cashBalance + totalInv - totalDebt;

  const debtFreeRow = fc360.find(r => r.debt < 100);
  const debtFreeLabel = debtFreeRow ? (fc360.indexOf(debtFreeRow) < 12 ? fc360.indexOf(debtFreeRow) + "mo" : (fc360.indexOf(debtFreeRow) / 12).toFixed(1) + "yr") : horizonYears + "yr+";

  return h("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 } },
      h(KPICard, { label: "Net Worth Now", value: gbp(netWorthNow, true), sub: "Starting point", accent: C.green, icon: "\u25C8" }),
      h(KPICard, {
        label: "Projected in " + yearA + "yr", value: gbp((fc360[yearA * 12] || {}).netWorth || 0, true),
        sub: "At current rates \u2014 tap to change", accent: C.amber, icon: "\u2197",
        onClick: () => setPickerFor("A"),
      }),
      h(KPICard, {
        label: "Projected in " + yearB + "yr", value: gbp((fc360[yearB * 12] || {}).netWorth || 0, true),
        sub: "Tap to change horizon", accent: C.purple, icon: "\u25C6",
        onClick: () => setPickerFor("B"),
      }),
      h(KPICard, { label: "Debt-Free", value: debtFreeLabel, sub: "At current payment rates", accent: C.red, icon: "\u2713" })
    ),

    h(Panel, null,
      h(PanelTitle, null, "Net worth \u2014 " + horizonYears + "-year projection"),
      h("div", { style: { color: C.textLo, fontSize: 12, marginBottom: 14 } },
        "Assumes your current income, expenses, debt payments, and investment contributions and returns stay constant. Real life won't be this smooth \u2014 use this as a directional guide, not a guarantee."
      ),
      h(MiniChart, { data: yearly, height: 280, xLabelEvery: Math.max(1, Math.round(yearly.length / 15)), yFormatter: v => gbp(v, true), series: [{ key: "netWorth", color: C.green, type: "area", name: "Net Worth" }] })
    ),

    h(Panel, null,
      h(PanelTitle, null, "Milestones"),
      h("div", { style: { overflowX: "auto" } },
        h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 } },
          h("thead", null,
            h("tr", null,
              ["In", "Net Worth", "Cash", "Investments", "Debt"].map((hd, i) =>
                h("th", { key: i, style: { padding: "8px 10px", color: C.textLo, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "monospace", fontWeight: 500, textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid " + C.border } }, hd)
              )
            )
          ),
          h("tbody", null,
            milestones.map((m, i) =>
              h("tr", { key: i },
                h("td", { style: { padding: "10px 10px", color: C.textHi, fontWeight: 600 } }, m.year + (m.year === 1 ? " year" : " years")),
                h("td", { style: { padding: "10px 10px", color: C.green, fontFamily: "monospace", fontWeight: 700, textAlign: "right" } }, gbp(m.row.netWorth, true)),
                h("td", { style: { padding: "10px 10px", color: C.blue, fontFamily: "monospace", textAlign: "right" } }, gbp(m.row.cash, true)),
                h("td", { style: { padding: "10px 10px", color: C.amber, fontFamily: "monospace", textAlign: "right" } }, gbp(m.row.investments, true)),
                h("td", { style: { padding: "10px 10px", color: C.red, fontFamily: "monospace", textAlign: "right" } }, gbp(m.row.debt, true))
              )
            )
          )
        )
      )
    ),

    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14 } },
      h(Panel, null,
        h(PanelTitle, null, "Investments \u2014 " + horizonYears + "-year growth"),
        h(MiniChart, { data: yearly, height: 200, xLabelEvery: Math.max(1, Math.round(yearly.length / 10)), yFormatter: v => gbp(v, true), series: [{ key: "investments", color: C.amber, type: "area", name: "Investments" }] })
      ),
      h(Panel, null,
        h(PanelTitle, null, "Debt \u2014 " + horizonYears + "-year payoff"),
        h(MiniChart, { data: yearly, height: 200, xLabelEvery: Math.max(1, Math.round(yearly.length / 10)), yFormatter: v => gbp(v, true), series: [{ key: "debt", color: C.red, type: "area", name: "Debt" }] })
      ),
      h(Panel, null,
        h(PanelTitle, null, "Cash \u2014 " + horizonYears + "-year balance"),
        h(MiniChart, { data: yearly, height: 200, xLabelEvery: Math.max(1, Math.round(yearly.length / 10)), yFormatter: v => gbp(v, true), series: [{ key: "cash", color: C.blue, type: "line", name: "Cash" }] })
      )
    ),
    pickerFor ? h(YearPickerModal, {
      years: pickerFor === "A" ? yearA : yearB,
      onPick: (y) => { if (pickerFor === "A") setYearA(y); else setYearB(y); setPickerFor(null); },
      onClose: () => setPickerFor(null),
    }) : null
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: "\u25C8" },
  { id: "transactions", label: "Transactions", icon: "\u21C5" },
  { id: "debt", label: "Debt", icon: "\u2198" },
  { id: "investments", label: "Investments", icon: "\u2197" },
  { id: "future", label: "Future", icon: "\u2606" },
  { id: "settings", label: "Settings", icon: "\u2699" },
];

// Small inline editor for the CASH figure shown in the top bar — tap it,
// type a new number, tap away or hit Enter to save. No need to go to Settings.
function EditableCash(props) {
  var value = props.value, onSave = props.onSave;
  var editingState = useState(false);
  var editing = editingState[0], setEditing = editingState[1];
  var draftState = useState(String(value));
  var draft = draftState[0], setDraft = draftState[1];

  var commit = function() {
    var v = parseFloat(draft);
    if (!isNaN(v)) onSave(v);
    setEditing(false);
  };

  if (editing) {
    return h("input", {
      type: "number",
      autoFocus: true,
      value: draft,
      onChange: function(e) { setDraft(e.target.value); },
      onBlur: commit,
      onKeyDown: function(e) { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); },
      style: {
        width: 80, background: C.panelBright, border: "1px solid " + C.blue, borderRadius: 4,
        color: C.blue, fontWeight: 700, fontFamily: "monospace", fontSize: 11, padding: "2px 4px",
      },
    });
  }

  return h("span", {
    onClick: function() { setDraft(String(value)); setEditing(true); },
    style: { color: C.blue, fontWeight: 700, cursor: "pointer", borderBottom: "1px dotted " + C.blue },
    title: "Tap to update your cash balance",
  }, gbp(value, true));
}

function App() {
  const dataState = useState(() => loadData() || SEED);
  const data = dataState[0], setDataRaw = dataState[1];
  const pageState = useState("dashboard");
  const page = pageState[0], setPage = pageState[1];
  const syncCodeState = useState(localStorage.getItem("finplan-sync-code") || "");
  const syncCode = syncCodeState[0], setSyncCode = syncCodeState[1];
  const syncStatusState = useState(localStorage.getItem("finplan-sync-code") ? "connected" : "off");
  const syncStatus = syncStatusState[0], setSyncStatus = syncStatusState[1];
  const ignoreRemoteRef = useRef(false);
  const unlockedState = useState(!isLockEnabled());
  const unlocked = unlockedState[0], setUnlocked = unlockedState[1];
  const pendingCloseState = useState(null); // month key awaiting close-out, or null
  const pendingClose = pendingCloseState[0], setPendingClose = pendingCloseState[1];

  // Detect a new calendar month has started since we last recorded a "lastClosedMonth".
  // If so, prompt to close out the previous month once the app has unlocked.
  useEffect(() => {
    if (!unlocked) return;
    var nowKey = currentMonthKey();
    var lastClosed = data.lastClosedMonth || nowKey;
    if (lastClosed !== nowKey) {
      setPendingClose(lastClosed);
    }
  }, [unlocked]);

  const closeMonth = (savedAmount) => {
    var monthKey = pendingClose;
    setPendingClose(null);
    if (savedAmount === null) {
      // "Skip for now" — don't advance lastClosedMonth, so we ask again next open.
      return;
    }
    setData(d => {
      var entry = { month: monthKey, savedAmount: savedAmount, loggedAt: todayStr() };
      var history = (d.monthlyHistory || []).filter(h => h.month !== monthKey).concat([entry]);
      history.sort((a, b) => a.month < b.month ? -1 : 1);

      var nowKey = currentMonthKey();
      var elapsed = Math.max(1, monthsBetween(monthKey, nowKey));
      var debts = d.debts.map(x => Object.assign({}, x));
      var investments = d.investments.map(x => Object.assign({}, x));
      for (var i = 0; i < elapsed; i++) {
        var advanced = advanceOneMonth(debts, investments);
        debts = advanced.debts;
        investments = advanced.investments;
      }

      return Object.assign({}, d, {
        cashBalance: d.cashBalance + savedAmount,
        debts: debts,
        investments: investments,
        monthlyHistory: history,
        lastClosedMonth: nowKey,
      });
    });
  };

  // Save locally on every change
  useEffect(() => { saveData(data); }, [data]);

  // Push to Firestore on every change (debounced)
  useEffect(() => {
    if (syncCode) debouncedPush(data);
  }, [data, syncCode]);

  // Resume sync on startup if a code was previously saved
  useEffect(() => {
    var saved = localStorage.getItem("finplan-sync-code");
    if (saved) {
      setSyncCode(saved);
      setSyncStatus("connected");
      startSync(saved, function(remoteData) {
        if (ignoreRemoteRef.current) return;
        setDataRaw(remoteData);
      });
    }
    return function() { if (_unsubscribe) _unsubscribe(); };
  }, []);

  const setData = useCallback((updater) => {
    ignoreRemoteRef.current = true;
    setDataRaw(function(prev) {
      var next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
    setTimeout(function() { ignoreRemoteRef.current = false; }, 2000);
  }, []);

  const onReset = () => {
    if (window.confirm("Reset all data? This clears everything stored on this device and cannot be undone.")) {
      setDataRaw(SEED);
    }
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "finplan-backup-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.income)) {
          setDataRaw(parsed);
        } else {
          alert("That file doesn't look like a valid FinPlan backup.");
        }
      } catch (err) {
        alert("Couldn't read that file. Make sure it's a FinPlan backup JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const totalInv = data.investments.reduce((s, x) => s + x.value, 0);
  const totalDebt = data.debts.reduce((s, x) => s + x.balance, 0);
  const netWorth = data.cashBalance + totalInv - totalDebt;

  const navButtons = PAGES.map(p =>
    h("button", {
      key: p.id, onClick: () => setPage(p.id),
      style: {
        background: "none", border: "none",
        color: page === p.id ? C.green : C.textMid,
        borderBottom: page === p.id ? "2px solid " + C.green : "2px solid transparent",
        padding: "16px 16px", fontSize: 13, fontWeight: page === p.id ? 700 : 400,
        cursor: "pointer", letterSpacing: 0.2,
        display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
      },
    },
      h("span", { style: { fontSize: 11, opacity: 0.7 } }, p.icon), p.label
    )
  );

  let pageContent = null;
  if (page === "dashboard") pageContent = h(Dashboard, { data: data, setData: setData, onNavigate: setPage });
  else if (page === "transactions") pageContent = h(Transactions, { data: data, setData: setData });
  else if (page === "debt") pageContent = h(Debt, { data: data, setData: setData });
  else if (page === "investments") pageContent = h(Investments, { data: data, setData: setData });
  else if (page === "future") pageContent = h(Future, { data: data });
  else if (page === "settings") pageContent = h(Settings, { data: data, setData: setData, onReset: onReset, onExport: onExport, onImport: onImport, syncCode: syncCode, setSyncCode: setSyncCode, syncStatus: syncStatus, setSyncStatus: setSyncStatus, setDataRaw: setDataRaw, ignoreRemoteRef: ignoreRemoteRef });

  if (!unlocked) {
    return h(LockScreen, { onUnlock: function() { setUnlocked(true); } });
  }

  return h("div", { style: { minHeight: "100vh", background: C.bg, color: C.textHi, fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" } },
    h("div", { style: { background: C.panel, borderBottom: "1px solid " + C.border, position: "sticky", top: 0, zIndex: 100 } },
      h("div", { style: { maxWidth: 1200, margin: "0 auto", padding: "0 16px", display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "14px 8px 14px 0", marginRight: 8 } },
          h("div", { style: { width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg," + C.green + "," + C.blue + ")", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#040810", fontWeight: 900 } }, "\u00A3"),
          h("span", { style: { color: C.textHi, fontSize: 14, fontWeight: 700, letterSpacing: 0.5 } }, "FinPlan")
        ),
        h("div", { style: { display: "flex", flex: 1, overflowX: "auto" } }, navButtons),
        h("div", { style: { display: "flex", gap: 16, fontSize: 11, fontFamily: "monospace", padding: "8px 0", whiteSpace: "nowrap" } },
          h("span", { style: { color: C.textLo } }, "NET ", h("span", { style: { color: netWorth >= 0 ? C.green : C.red, fontWeight: 700 } }, gbp(netWorth, true))),
          h("span", { style: { color: C.textLo } }, "CASH ", h(EditableCash, { value: data.cashBalance, onSave: function(v) { setData(d => Object.assign({}, d, { cashBalance: v })); } }))
        )
      )
    ),
    h("div", { style: { maxWidth: 1200, margin: "0 auto", padding: "24px 16px 60px" } }, pageContent),
    pendingClose ? h(MonthCloseModal, { monthKey: pendingClose, onClose: closeMonth }) : null
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));
