/**
 * storage.js — Chrome Storage Helpers
 */

const TruthLensStorage = {
  DEFAULT_PROFILE: {
    impulseBuyer: { enabled: true, sensitivity: 2 },
    rageBaitShield: { enabled: true, sensitivity: 2 },
    slowReaderMode: { enabled: false, sensitivity: 1 },
    slopDetector: { enabled: true, sensitivity: 2 },
    hateSpeechFilter: { enabled: true, sensitivity: 2 },
    sensitiveImageGuard: { enabled: false, sensitivity: 1 },
    commentGuard: { enabled: true, sensitivity: 2 },
  },

  async getProfile() {
    try {
      const { truthlens_profile } = await chrome.storage.local.get("truthlens_profile");
      return truthlens_profile ?? { ...this.DEFAULT_PROFILE };
    } catch {
      return { ...this.DEFAULT_PROFILE };
    }
  },

  async saveProfile(profile) {
    await chrome.storage.local.set({ truthlens_profile: profile });
  },

  async getApiKeys() {
    try {
      const { truthlens_apikeys } = await chrome.storage.local.get("truthlens_apikeys");
      return truthlens_apikeys ?? {};
    } catch {
      return {};
    }
  },

  async saveApiKeys(keys) {
    await chrome.storage.local.set({ truthlens_apikeys: keys });
  },

  async getTheme() {
    try {
      const { truthlens_theme } = await chrome.storage.local.get("truthlens_theme");
      return truthlens_theme ?? "dark";
    } catch {
      return "dark";
    }
  },

  async saveTheme(theme) {
    await chrome.storage.local.set({ truthlens_theme: theme });
  },
};
