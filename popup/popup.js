/**
 * popup.js — TruthLens Dashboard Logic (Urban Noir)
 * Unified API config, caching, and comprehensive LLM metrics display.
 */

const PROTECTION_LABELS = {
  impulseBuyer: "Impulse Buy Shield",
  rageBaitShield: "Rage Bait Shield",
  slowReaderMode: "Slow Reader Mode",
  slopDetector: "Slop Detector",
  hateSpeechFilter: "Hate Speech Filter",
  sensitiveImageGuard: "Image Guard",
  commentGuard: "Comment Guard",
};

const CATEGORY_STYLES = {
  Shopping: { bg: "var(--yellow-soft)", border: "rgba(212,168,67,0.3)", color: "var(--gold)" },
  News: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", color: "#5b9bd5" },
  Social: { bg: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.3)", color: "var(--purple)" },
  Blog: { bg: "rgba(20,184,166,0.1)", border: "rgba(20,184,166,0.3)", color: "#14b8a6" },
  Forum: { bg: "var(--green-soft)", border: "rgba(39,174,96,0.3)", color: "var(--green)" },
  Payment: { bg: "var(--red-soft)", border: "rgba(192,57,43,0.3)", color: "var(--red)" },
  General: { bg: "var(--bg-card)", border: "var(--border)", color: "var(--accent)" },
  shopping: { bg: "var(--yellow-soft)", border: "rgba(212,168,67,0.3)", color: "var(--gold)" },
  news: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", color: "#5b9bd5" },
  social: { bg: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.3)", color: "var(--purple)" },
  blog: { bg: "rgba(20,184,166,0.1)", border: "rgba(20,184,166,0.3)", color: "#14b8a6" },
  forum: { bg: "var(--green-soft)", border: "rgba(39,174,96,0.3)", color: "var(--green)" },
  payment: { bg: "var(--red-soft)", border: "rgba(192,57,43,0.3)", color: "var(--red)" },
  general: { bg: "var(--bg-card)", border: "var(--border)", color: "var(--accent)" },
};

// ===== GAUGE =====

function setGaugeScore(score) {
  const circumference = 2 * Math.PI * 52;
  const fill = document.getElementById("gaugeFill");
  const container = document.querySelector(".gauge-container");
  const verdict = document.getElementById("gaugeVerdict");

  if (score === null || score === undefined) {
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

  const ssl = analysis?.domainAnalysis?.ssl;
  const valid = ssl?.valid;
  
  if (valid) {
    bar.className = "ssl-bar ssl-pass";
    icon.textContent = "🔒";
    text.textContent = "HTTPS — Connection encrypted";
  } else {
    bar.className = "ssl-bar ssl-fail";
    icon.textContent = "🔓";
    text.textContent = ssl?.protocol === "http:" 
      ? "HTTP — Connection NOT encrypted" 
      : "SSL status unknown";
  }
}

// ===== RENDERS =====

function setCategoryBadge(category) {
  const badge = document.getElementById("categoryBadge");
  const catLabel = document.getElementById("contentCategory");
  const displayCategory = category ? category.charAt(0).toUpperCase() + category.slice(1) : "General";
  badge.textContent = displayCategory;
  catLabel.textContent = displayCategory;
  const s = CATEGORY_STYLES[category] || CATEGORY_STYLES.General;
  badge.style.background = s.bg;
  badge.style.borderColor = s.border;
  badge.style.color = s.color;
}

function renderDomainInfo(analysis) {
  const da = analysis?.domainAnalysis;

  // Domain Age
  const ageEl = document.getElementById("domainAge");
  if (da?.whois?.domainAge != null && da.whois.domainAge > 0) {
    const years = Math.floor(da.whois.domainAge / 365);
    const months = Math.floor((da.whois.domainAge % 365) / 30);
    ageEl.textContent = years > 0 ? `${years}y ${months}m` : `${months} months`;
    ageEl.style.color = da.whois.domainAge > 365 ? "var(--green)" : "var(--gold)";
    ageEl.title = da.whois.createdDate ? `Created: ${da.whois.createdDate}` : "";
  } else if (da?.whois?.error) {
    ageEl.textContent = "Not available";
    ageEl.style.color = "var(--text-muted)";
    ageEl.title = `WHOIS lookup: ${da.whois.error}`;
  } else {
    ageEl.textContent = "Unknown";
    ageEl.style.color = "var(--text-muted)";
    ageEl.title = "WHOIS data not available for this domain";
  }

  // Registrar
  const regEl = document.getElementById("registrar");
  regEl.textContent = da?.whois?.registrar || "Unknown";
  regEl.style.color = da?.whois?.registrar ? "var(--text)" : "var(--text-muted)";

  // Safety
  const safeEl = document.getElementById("safetyStatus");
  const sb = da?.safeBrowsing;
  if (sb?.error) {
    safeEl.textContent = "Check failed";
    safeEl.style.color = "var(--text-muted)";
    safeEl.title = sb.error;
  } else if (sb && !sb.safe) {
    safeEl.textContent = "⚠️ Threats Found";
    safeEl.style.color = "var(--red)";
    safeEl.title = sb.threats?.join(", ") || "Threat detected";
  } else if (sb?.source === "no-api-key") {
    safeEl.textContent = "Not configured";
    safeEl.style.color = "var(--text-muted)";
    safeEl.title = "Google Safe Browsing API key not set";
  } else if (sb?.source === "google-safe-browsing") {
    safeEl.textContent = "✓ Verified safe";
    safeEl.style.color = "var(--green)";
    safeEl.title = "Checked via Google Safe Browsing";
  } else {
    safeEl.textContent = "No threats";
    safeEl.style.color = "var(--green)";
  }
}

function renderThreats(analysis) {
  const container = document.getElementById("threatPills");
  container.innerHTML = "";
  const threats = [];
  
  // LLM analysis risks
  const llm = analysis?.llmAnalysis;
  if (llm?.risks?.length) {
    llm.risks.forEach((r) => threats.push({ label: r, type: "warning" }));
  }
  
  // Toxicity
  if (llm?.toxicity?.hateSpeech) {
    threats.push({ label: "Hate Speech Detected", type: "danger" });
  }
  if (llm?.toxicity?.rageBait) {
    const conf = llm.toxicity.rageBaitConfidence;
    threats.push({ label: `Rage Bait${conf ? ` (${Math.round(conf * 100)}%)` : ""}`, type: "warning" });
  }
  
  // AI Content
  if (llm?.aiContent?.detected) {
    const conf = llm.aiContent.confidence;
    threats.push({ label: `AI Content (${Math.round((conf || 0) * 100)}%)`, type: "info" });
  }
  
  // Shopping tactics
  if (llm?.shopping?.hasUrgencyTactics) {
    threats.push({ label: "Urgency Tactics", type: "warning" });
  }
  if (llm?.shopping?.hasPriceManipulation) {
    threats.push({ label: "Price Manipulation", type: "danger" });
  }
  
  // Credibility concerns
  if (llm?.credibility?.factualConcerns?.length) {
    llm.credibility.factualConcerns.forEach((c) => threats.push({ label: c, type: "warning" }));
  }

  // Legacy: page context risks
  const ctx = analysis?.pageContext;
  if (ctx?.riskSignals?.length) {
    ctx.riskSignals.forEach((r) => {
      if (r.includes("urgency")) threats.push({ label: "Urgency Tactics", type: "warning" });
      else if (r.includes("insecure")) threats.push({ label: "Insecure Form", type: "danger" });
      else if (r.includes("popup")) threats.push({ label: "Excessive Popups", type: "warning" });
      else if (r.includes("countdown")) threats.push({ label: "Fake Timer", type: "warning" });
      else if (r.includes("cross-origin")) threats.push({ label: "Cross-Origin Form", type: "warning" });
      else if (r.includes("suspicious")) threats.push({ label: "Suspicious Domain", type: "danger" });
    });
  }

  // Safe Browsing threats
  const sb = analysis?.domainAnalysis?.safeBrowsing;
  if (sb && !sb.safe) sb.threats.forEach((t) => threats.push({ label: t, type: "danger" }));

  // Deduplicate
  const seen = new Set();
  const uniqueThreats = threats.filter((t) => {
    const key = t.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueThreats.length === 0) {
    container.innerHTML = '<span class="pill pill-clear">Streets are clean</span>';
    return;
  }

  uniqueThreats.forEach(({ label, type }) => {
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
  if (!analysis) {
    pre.textContent = "No analysis data available.";
    return;
  }

  const d = analysis._debug || {};
  const llm = analysis.llmAnalysis || {};
  
  const lines = [
    `=== ANALYSIS SOURCE ===`,
    `Provider:             ${d.provider || "none"}`,
    `Has API Key:          ${d.hasApiKey ? "yes" : "no"}`,
    `Source:               ${analysis.source || "unknown"}`,
    `Analyzed At:          ${analysis.analyzedAt || "n/a"}`,
    ``,
    `=== TRUST SCORE ===`,
    `Final Score:          ${analysis.trustScore ?? "null"}`,
    `Page Type:            ${llm.pageType || analysis.category || "unknown"}`,
    ``,
    `=== DOMAIN INTEL ===`,
    `Domain age (days):    ${d.domainAge ?? "unknown"}`,
    `Created:              ${d.domainCreated ?? "unknown"}`,
    `Registrar:            ${d.registrar ?? "unknown"}`,
    `Domain Error:         ${d.domainError || "none"}`,
    `SSL valid:            ${d.sslValid ?? "unknown"}`,
    `SSL protocol:         ${d.sslProtocol ?? "unknown"}`,
    `Safe Browsing src:    ${d.safeBrowsingSource ?? "none"}`,
    `Safe Browsing error:  ${d.safeBrowsingError || "none"}`,
    `Safe Browsing threats:${d.safeBrowsingThreats?.length ? " " + d.safeBrowsingThreats.join(", ") : " none"}`,
    ``,
    `=== LLM ANALYSIS ===`,
    `Source:               ${llm.source || "not called"}`,
    `Error:                ${llm.error || d.llmError || "none"}`,
    ``,
    `AI Content Detected:  ${llm.aiContent?.detected ?? "n/a"}`,
    `AI Confidence:        ${llm.aiContent?.confidence ?? "n/a"}`,
    `AI Reasoning:         ${llm.aiContent?.reasoning ?? "n/a"}`,
    ``,
    `Hate Speech:          ${llm.toxicity?.hateSpeech ?? "n/a"}`,
    `Rage Bait:            ${llm.toxicity?.rageBait ?? "n/a"}`,
    `Rage Bait Confidence: ${llm.toxicity?.rageBaitConfidence ?? "n/a"}`,
    `Inflammatory Sections:${llm.toxicity?.inflammatorySections?.length || 0}`,
    ``,
    `Is Shopping Page:     ${llm.shopping?.isShoppingPage ?? "n/a"}`,
    `Urgency Tactics:      ${llm.shopping?.hasUrgencyTactics ?? "n/a"}`,
    `Urgency Phrases:      ${llm.shopping?.urgencyPhrases?.join(", ") || "none"}`,
    ``,
    `Content Quality:      ${llm.credibility?.contentQuality ?? "n/a"}`,
    `Has Author:           ${llm.credibility?.hasAuthorAttribution ?? "n/a"}`,
    `Has Sources:          ${llm.credibility?.hasSources ?? "n/a"}`,
    ``,
    `Risks:                ${llm.risks?.join(", ") || "none"}`,
    `Positive Signals:     ${llm.positiveSignals?.join(", ") || "none"}`,
    ``,
    `Summary:              ${llm.summary || "n/a"}`,
  ];

  pre.textContent = lines.join("\n");
}

// ===== API CONFIGURATION =====

async function loadApiConfig() {
  try {
    const res = await new Promise((r) => chrome.runtime.sendMessage({ type: "GET_API_CONFIG" }, r));
    const config = res?.config || { provider: "claude", apiKey: null };
    
    document.getElementById("apiProvider").value = config.provider || "claude";
    document.getElementById("apiKey").value = config.apiKey || "";
    
    // Load Safe Browsing key
    const { truthlens_safebrowsing_key } = await chrome.storage.local.get("truthlens_safebrowsing_key");
    document.getElementById("safeBrowsingKey").value = truthlens_safebrowsing_key || "";
  } catch (e) {
    console.error("Failed to load API config:", e);
  }
}

async function saveApiConfig() {
  const provider = document.getElementById("apiProvider").value;
  const apiKey = document.getElementById("apiKey").value.trim();
  const status = document.getElementById("apiStatus");
  
  try {
    await new Promise((r) => chrome.runtime.sendMessage({ 
      type: "SET_API_CONFIG", 
      payload: { provider, apiKey: apiKey || null }
    }, r));
    
    status.textContent = "✓ Saved! Re-scan to use new settings.";
    status.className = "api-status success";
    setTimeout(() => { status.textContent = ""; status.className = "api-status"; }, 3000);
  } catch (e) {
    status.textContent = "✗ Failed to save";
    status.className = "api-status error";
  }
}

document.getElementById("saveApiConfig")?.addEventListener("click", saveApiConfig);

document.getElementById("toggleApiKey")?.addEventListener("click", () => {
  const input = document.getElementById("apiKey");
  input.type = input.type === "password" ? "text" : "password";
});

document.getElementById("toggleSBKey")?.addEventListener("click", () => {
  const input = document.getElementById("safeBrowsingKey");
  input.type = input.type === "password" ? "text" : "password";
});

document.getElementById("saveSBKey")?.addEventListener("click", async () => {
  const key = document.getElementById("safeBrowsingKey").value.trim();
  const status = document.getElementById("apiStatus");
  
  try {
    await chrome.storage.local.set({ truthlens_safebrowsing_key: key || null });
    status.textContent = "✓ Safe Browsing key saved!";
    status.className = "api-status success";
    setTimeout(() => { status.textContent = ""; status.className = "api-status"; }, 3000);
  } catch (e) {
    status.textContent = "✗ Failed to save";
    status.className = "api-status error";
  }
});

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
  await loadApiConfig();

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
  setCategoryBadge(analysis.category ?? analysis.llmAnalysis?.pageType ?? "General");
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

// Clear cache
document.getElementById("btnClearCache")?.addEventListener("click", async () => {
  const status = document.getElementById("apiStatus");
  try {
    await new Promise((r) => chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, r));
    status.textContent = "✓ Cache cleared";
    status.className = "api-status success";
    setTimeout(() => { status.textContent = ""; status.className = "api-status"; }, 2000);
  } catch (e) {
    status.textContent = "✗ Failed to clear cache";
    status.className = "api-status error";
  }
});

init();
