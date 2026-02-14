/**
 * profile.js — User Profile (Base Layer)
 *
 * Stores user preferences in chrome.storage.local.
 * These preferences control how aggressively TruthLens responds:
 *   - "inform"    → passive badges/console output only
 *   - "suggest"   → surface warnings in UI
 *   - "intervene" → block/delay risky actions (future Layer 2+)
 */

const DEFAULT_PROFILE = {
  autonomyLevel: "inform", // start passive — least intrusive for demo
  protectionsEnabled: {
    scamProtection: true,
    impulseBuyProtection: true,
    engagementProtection: true,
    contentFiltering: false, // off by default — opt-in
    adBlocker: false,
  },
};

/**
 * Get the current profile, falling back to defaults.
 * @returns {Promise<object>}
 */
async function getProfile() {
  const { profile } = await chrome.storage.local.get("profile");
  return profile ?? { ...DEFAULT_PROFILE };
}

/**
 * Merge partial updates into the stored profile.
 * Usage: await updateProfile({ autonomyLevel: "suggest" })
 * @param {object} partial - fields to merge
 */
async function updateProfile(partial) {
  const current = await getProfile();
  const updated = {
    ...current,
    ...partial,
    // deep-merge the protections object so callers can update one flag
    protectionsEnabled: {
      ...current.protectionsEnabled,
      ...(partial.protectionsEnabled ?? {}),
    },
  };
  await chrome.storage.local.set({ profile: updated });
  return updated;
}

/**
 * Reset profile back to defaults.
 */
async function resetProfile() {
  await chrome.storage.local.set({ profile: { ...DEFAULT_PROFILE } });
  return { ...DEFAULT_PROFILE };
}
