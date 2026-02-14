/**
 * popup.js — TruthLens Dashboard Logic (Urban Noir)
 * Trust score starts null. SSL is binary. Debug panel shows reasoning.
 * Re-scan doesn't refresh page.
 */

const PROTECTION_LABELS = {
  impulseBuyer: "Impulse Buy Shield",
  rageBaitShield: "Rage Bait Shield",
  slowReaderMode: "Slow Reader Mode",
  slopDetector: "Slop Detector",
  hateSpeechFilter: "Hate Speech Filter",
  sensitiveImageGuard: "Image Guard",
  commentGuard: "Comment Guard",
  adBlocker: "Ad Blocker",
};

const CATEGORY_STYLES = {
  Shopping: { bg: "var(--yellow-soft)", border: "rgba(212,168,67,0.3)", color: "var(--gold)" },
  News: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", color: "#5b9bd5" },
  Social: { bg: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.3)", color: "var(--purple)" },
  Blog: { bg: "rgba(20,184,166,0.1)", border: "rgba(20,184,166,0.3)", color: "#14b8a6" },
  Forum: { bg: "var(--green-soft)", border: "rgba(39,174,96,0.3)", color: "var(--green)" },
  Payment: { bg: "var(--red-soft)", border: "rgba(192,57,43,0.3)", color: "var(--red)" },
  General: { bg: "var(--bg-card)", border: "var(--border)", color: "var(--accent)" },
};

// ===== GAUGE =====

function setGaugeScore(score) {
  const circumference = 2 * Math.PI * 52;
  const fill = document.getElementById("gaugeFill");
  const container = document.querySelector(".gauge-container");
  const verdict = document.getElementById("gaugeVerdict");

  if (score === null) {
    document.getElementById("gaugeValue").textContent = "?";
    verdict.textContent = "Insufficient data to judge...";
    return;
  }

  const offset = circumference * (1 - score / 100);
  setTimeout(() => { fill.style.strokeDashoffset = offset; }, 100);

  container.classList.remove("gauge-safe", "gauge-caution", "gauge-danger");
  if (score >= 70) {
    container.classList.add("gauge-safe");
    verdict.textContent = "This joint checks out.";
  } else if (score >= 40) {
    container.classList.add("gauge-caution");
    verdict.textContent = "Something's off. Watch your back.";
  } else {
    container.classList.add("gauge-danger");
    verdict.textContent = "Red flags everywhere. Stay sharp.";
  }

  animateNumber(document.getElementById("gaugeValue"), 0, score, 800);
}

function animateNumber(el, from, to, duration) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * ease);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ===== SSL BAR (binary) =====

function renderSSL(analysis) {
  const bar = document.getElementById("sslBar");
  const icon = document.getElementById("sslIcon");
  const text = document.getElementById("sslStatus");

  const valid = analysis?.domainAnalysis?.ssl?.valid;
  if (valid) {
    bar.className = "ssl-bar ssl-pass";
    icon.textContent = "🔒";
    text.textContent = "HTTPS — Connection encrypted";
  } else {
    bar.className = "ssl-bar ssl-fail";
    icon.textContent = "🔓";
    text.textContent = "HTTP — Connection NOT encrypted";
  }
}

// ===== RENDERS =====

function setCategoryBadge(category) {
  const badge = document.getElementById("categoryBadge");
  const catLabel = document.getElementById("contentCategory");
  badge.textContent = category;
  catLabel.textContent = category;
  const s = CATEGORY_STYLES[category] || CATEGORY_STYLES.General;
  badge.style.background = s.bg;
  badge.style.borderColor = s.border;
  badge.style.color = s.color;
}

function renderDomainInfo(analysis) {
  const da = analysis?.domainAnalysis;

  // Domain Age
  const ageEl = document.getElementById("domainAge");
  if (da?.whois?.domainAge != null) {
    const years = Math.floor(da.whois.domainAge / 365);
    const months = Math.floor((da.whois.domainAge % 365) / 30);
    ageEl.textContent = years > 0 ? `${years}y ${months}m` : `${months} months`;
    ageEl.style.color = da.whois.domainAge > 365 ? "var(--green)" : "var(--gold)";
  } else {
    ageEl.textContent = "Unknown";
  }

  // Registrar
  document.getElementById("registrar").textContent = da?.whois?.registrar || "Unknown";

  // Safety
  const safeEl = document.getElementById("safetyStatus");
  if (da?.safeBrowsing && !da.safeBrowsing.safe) {
    safeEl.textContent = "Threats Found";
    safeEl.style.color = "var(--red)";
  } else {
    safeEl.textContent = "No known threats";
    safeEl.style.color = "var(--green)";
  }
}

function renderThreats(analysis) {
  const container = document.getElementById("threatPills");
  container.innerHTML = "";
  const threats = [];
  const ctx = analysis?.pageContext;

  if (ctx?.riskSignals?.length) {
    ctx.riskSignals.forEach((r) => {
      if (r.includes("urgency")) threats.push({ label: "Urgency Tactics", type: "warning" });
      else if (r.includes("insecure")) threats.push({ label: "Insecure Form", type: "danger" });
      else if (r.includes("popup")) threats.push({ label: "Excessive Popups", type: "warning" });
      else if (r.includes("countdown")) threats.push({ label: "Fake Timer", type: "warning" });
      else if (r.includes("cross-origin")) threats.push({ label: "Cross-Origin Form", type: "warning" });
      else if (r.includes("suspicious")) threats.push({ label: "Suspicious Domain", type: "danger" });
      else threats.push({ label: r.replace(/^risk:/, ""), type: "warning" });
    });
  }

  const sb = analysis?.domainAnalysis?.safeBrowsing;
  if (sb && !sb.safe) sb.threats.forEach((t) => threats.push({ label: t, type: "danger" }));

  // Claude AI result
  if (analysis?.claudeResult?.isAI) {
    threats.push({ label: `AI Content (${Math.round((analysis.claudeResult.confidence || 0) * 100)}%)`, type: "info" });
  }

  // Gemini risk signals
  if (analysis?.geminiResult?.riskSignals?.length) {
    analysis.geminiResult.riskSignals.forEach((r) => threats.push({ label: r, type: "warning" }));
  }

  if (threats.length === 0) {
    container.innerHTML = '<span class="pill pill-clear">Streets are clean</span>';
    return;
  }

  threats.forEach(({ label, type }) => {
    const pill = document.createElement("span");
    pill.className = `pill pill-${type}`;
    pill.textContent = label;
    container.appendChild(pill);
  });
}

function renderProtections(profile) {
  const list = document.getElementById("protectionsList");
  list.innerHTML = "";
  Object.entries(PROTECTION_LABELS).forEach(([key, label]) => {
    const enabled = profile?.[key]?.enabled ?? false;
    const item = document.createElement("div");
    item.className = "protection-item";
    item.innerHTML = `<span class="prot-name">${label}</span><span class="prot-status ${enabled ? "on" : "off"}">${enabled ? "Active" : "Off"}</span>`;
    list.appendChild(item);
  });
}

// ===== DEBUG PANEL =====

function renderDebug(analysis) {
  const pre = document.getElementById("debugPre");
  if (!analysis?._debug) {
    pre.textContent = "No debug data available.";
    return;
  }

  const d = analysis._debug;
  const baseVal = d.scoreBreakdown?.base ?? 0;
  const lines = [
    `=== SCORE BREAKDOWN ===`,
    `Base score:           ${baseVal}`,
    `Domain age adj:       ${d.scoreBreakdown?.domainAgeAdj ?? "n/a"}`,
    `Safe Browsing adj:    ${d.scoreBreakdown?.safeBrowsingAdj ?? "n/a"}`,
    `Risk signals adj:     ${d.scoreBreakdown?.riskAdj ?? "0"}`,
    `Intent signals adj:   ${d.scoreBreakdown?.intentAdj ?? "0"}`,
    `FINAL SCORE:          ${d.scoreBreakdown?.final ?? "null"}`,
    ``,
    `=== DOMAIN INTEL ===`,
    `Domain age (days):    ${d.domainAge ?? "unknown"}`,
    `Created:              ${d.domainCreated ?? "unknown"}`,
    `Registrar:            ${d.registrar ?? "unknown"}`,
    `SSL valid:            ${d.sslValid ?? "unknown"}`,
    `Safe Browsing src:    ${d.safeBrowsingSource ?? "none"}`,
    `Safe Browsing threats:${d.safeBrowsingThreats?.length ? " " + d.safeBrowsingThreats.join(", ") : " none"}`,
    ``,
    `=== HEURISTIC ANALYSIS ===`,
    `Page type:            ${d.heuristicPageType ?? "unknown"}`,
    `Confidence:           ${d.heuristicConfidence ?? 0}`,
    `Risk signals:         ${d.riskSignals?.join(", ") || "none"}`,
    `Intent signals:       ${d.intentSignals?.join(", ") || "none"}`,
    ``,
    `=== AI ANALYSIS ===`,
    `Claude source:        ${d.claudeSource ?? "not called"}`,
    `Claude is AI:         ${d.claudeIsAI ?? "n/a"}`,
    `Claude confidence:    ${d.claudeConfidence ?? "n/a"}`,
    `Claude reasoning:     ${d.claudeReasoning ?? "n/a"}`,
    ``,
    `Gemini source:        ${d.geminiSource ?? "not called"}`,
    `Gemini page type:     ${d.geminiPageType ?? "n/a"}`,
    `Gemini confidence:    ${d.geminiConfidence ?? "n/a"}`,
    `Gemini reasoning:     ${d.geminiReasoning ?? "n/a"}`,
    `Gemini risks:         ${d.geminiRiskSignals?.join(", ") || "n/a"}`,
    ``,
    `=== CONTENT METRICS ===`,
    `Local AI score:       ${d.aiScore ?? 0}`,
    `Toxicity signals:     ${d.toxicitySignals?.join(", ") || "none"}`,
    `Readability score:    ${d.readability?.score ?? "n/a"}`,
    `Flesch-Kincaid grade: ${d.readability?.grade ?? "n/a"}`,
    `Word count:           ${d.readability?.wordCount ?? "n/a"}`,
    `Read time:            ${d.readability?.readTime ?? "n/a"} min`,
  ];

  pre.textContent = lines.join("\n");
}

// ===== THEME TOGGLE =====

async function initTheme() {
  try {
    const { truthlens_theme } = await chrome.storage.local.get("truthlens_theme");
    const theme = truthlens_theme || "dark";
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("themeIcon").textContent = theme === "dark" ? "☾" : "☀";
  } catch {}
}

document.getElementById("themeToggle")?.addEventListener("click", async () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  document.getElementById("themeIcon").textContent = next === "dark" ? "☾" : "☀";
  try { await chrome.storage.local.set({ truthlens_theme: next }); } catch {}
});

// ===== INIT =====

async function init() {
  await initTheme();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const [analysisRes, profileRes] = await Promise.all([
    new Promise((r) => chrome.runtime.sendMessage({ type: "GET_FULL_ANALYSIS", tabId: tab.id }, r)),
    new Promise((r) => chrome.runtime.sendMessage({ type: "GET_PROFILE" }, r)),
  ]);

  const analysis = analysisRes?.analysis;
  const profile = profileRes?.profile;

  document.getElementById("loading").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  if (!analysis) {
    document.getElementById("gaugeValue").textContent = "?";
    document.getElementById("gaugeVerdict").textContent = "No intel gathered yet. Navigate to a page.";
    document.getElementById("categoryBadge").textContent = "Unknown";
    renderProtections(profile);
    return;
  }

  setGaugeScore(analysis.trustScore);
  setCategoryBadge(analysis.category ?? "General");
  renderSSL(analysis);
  renderDomainInfo(analysis);
  renderThreats(analysis);
  renderProtections(profile);
  renderDebug(analysis);
}

// ===== ACTIONS =====

document.getElementById("btnProfile")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("profile/profile.html") });
});

// Re-scan WITHOUT page refresh
document.getElementById("btnRefresh")?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Tell background to clear cache and tell content script to re-run
  chrome.runtime.sendMessage({ type: "RESCAN", tabId: tab.id });

  // Show loading state briefly
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("loading").style.display = "flex";
  document.querySelector(".loading-text").textContent = "Re-investigating...";

  // Poll for new results
  let attempts = 0;
  const poll = setInterval(async () => {
    attempts++;
    const res = await new Promise((r) => chrome.runtime.sendMessage({ type: "GET_FULL_ANALYSIS", tabId: tab.id }, r));
    if (res?.analysis || attempts > 20) {
      clearInterval(poll);
      init();
    }
  }, 500);
});

init();
