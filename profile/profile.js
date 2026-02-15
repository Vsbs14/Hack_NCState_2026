/**
 * profile.js — Profile Page Logic (with API key management and theme toggle)
 */

const PROTECTION_KEYS = [
  "impulseBuyer", "rageBaitShield", "slowReaderMode", "slopDetector",
  "hateSpeechFilter", "sensitiveImageGuard", "commentGuard",
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

  // Load API keys
  const keys = await TruthLensStorage.getApiKeys();
  if (keys.claude) document.getElementById("claudeKey").value = keys.claude;
  if (keys.gemini) document.getElementById("geminiKey").value = keys.gemini;
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

    // Save API keys
    const keys = {
      claude: document.getElementById("claudeKey").value.trim() || undefined,
      gemini: document.getElementById("geminiKey").value.trim() || undefined,
    };
    await TruthLensStorage.saveApiKeys(keys);

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
