/**
 * profile.js — Profile Page Logic (with API key management and theme toggle)
 */

const PROTECTION_KEYS = [
  "impulseBuyer", "rageBaitShield", "slowReaderMode", "slopDetector",
  "hateSpeechFilter", "sensitiveImageGuard", "commentGuard", "videoScanning",
];

async function loadProfile() {
  const profile = await TruthLensStorage.getProfile();

  PROTECTION_KEYS.forEach((key) => {
    const prot = profile[key] || { enabled: false, sensitivity: 1 };
    const toggle = document.querySelector(`input[data-toggle="${key}"]`);
    if (toggle) { toggle.checked = prot.enabled; updateCardState(key, prot.enabled); }
    document.querySelectorAll(`button[data-key="${key}"]`).forEach((btn) => {
      btn.classList.toggle("active", parseInt(btn.dataset.sens) === prot.sensitivity);
    });
  });

  // Load API config (unified LLM provider)
  const { truthlens_api } = await chrome.storage.local.get("truthlens_api");
  if (truthlens_api) {
    document.getElementById("llmProvider").value = truthlens_api.provider || "claude";
    if (truthlens_api.apiKey) document.getElementById("llmApiKey").value = truthlens_api.apiKey;
  }

  // Load additional API keys
  const { truthlens_apikeys } = await chrome.storage.local.get("truthlens_apikeys");
  if (truthlens_apikeys) {
    if (truthlens_apikeys.safeBrowsing) document.getElementById("safeBrowsingKey").value = truthlens_apikeys.safeBrowsing;
    if (truthlens_apikeys.twelveLabs) document.getElementById("twelveLabsKey").value = truthlens_apikeys.twelveLabs;
    if (truthlens_apikeys.elevenLabs) document.getElementById("elevenLabsKey").value = truthlens_apikeys.elevenLabs;
  }
}

function updateCardState(key, enabled) {
  const card = document.querySelector(`.card[data-key="${key}"]`);
  if (card) card.classList.toggle("disabled", !enabled);
}

function collectProfile() {
  const profile = {};
  PROTECTION_KEYS.forEach((key) => {
    const toggle = document.querySelector(`input[data-toggle="${key}"]`);
    const activeBtn = document.querySelector(`button[data-key="${key}"].active`);
    profile[key] = {
      enabled: toggle?.checked ?? false,
      sensitivity: activeBtn ? parseInt(activeBtn.dataset.sens) : 2,
    };
  });
  return profile;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

async function initTheme() {
  const theme = await TruthLensStorage.getTheme();
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("themeIcon").textContent = theme === "dark" ? "☾" : "☀";
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  loadProfile();

  // Theme toggle
  document.getElementById("themeToggle").addEventListener("click", async () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    document.getElementById("themeIcon").textContent = next === "dark" ? "☾" : "☀";
    await TruthLensStorage.saveTheme(next);
  });

  // Toggles
  document.querySelectorAll("input[data-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", () => updateCardState(toggle.dataset.toggle, toggle.checked));
  });

  // Sensitivity buttons
  document.querySelectorAll(".sens-buttons button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(`button[data-key="${btn.dataset.key}"]`).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Save
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const profile = collectProfile();
    await TruthLensStorage.saveProfile(profile);

    // Save unified LLM API config
    const llmConfig = {
      provider: document.getElementById("llmProvider").value,
      apiKey: document.getElementById("llmApiKey").value.trim() || null,
    };
    await chrome.storage.local.set({ truthlens_api: llmConfig });

    // Save additional API keys
    const apiKeys = {
      safeBrowsing: document.getElementById("safeBrowsingKey").value.trim() || null,
      twelveLabs: document.getElementById("twelveLabsKey").value.trim() || null,
      elevenLabs: document.getElementById("elevenLabsKey").value.trim() || null,
    };
    await chrome.storage.local.set({ truthlens_apikeys: apiKeys });

    showToast("Configuration saved!");
    chrome.runtime.sendMessage({ type: "PROFILE_UPDATED", payload: profile });
  });

  // Reset
  document.getElementById("resetBtn").addEventListener("click", async () => {
    await TruthLensStorage.saveProfile({ ...TruthLensStorage.DEFAULT_PROFILE });
    loadProfile();
    showToast("Reset to defaults");
  });
});
