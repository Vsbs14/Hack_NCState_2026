/**
 * config.js — Centralized Configuration for TruthLens
 * 
 * All calibration settings in one place. Modify this file to adjust
 * thresholds, feature toggles, and behavior without touching other code.
 */

export const CONFIG = {
  // =========================================================================
  // API SETTINGS
  // =========================================================================
  api: {
    // Supported providers: "claude" | "gemini" | "openai"
    defaultProvider: "claude",
    
    // Request timeout in milliseconds
    timeout: 15000,
    
    // Max characters to send to LLM (balance cost vs accuracy)
    maxTextLength: 3000,
    
    // Provider-specific model names
    models: {
      claude: "claude-sonnet-4-5-20250929",
      gemini: "gemini-2.0-flash",
      openai: "gpt-4o-mini",
    },
    
    // API endpoints
    endpoints: {
      claude: "https://api.anthropic.com/v1/messages",
      gemini: "https://generativelanguage.googleapis.com/v1beta/models",
      openai: "https://api.openai.com/v1/chat/completions",
    },
  },

  // =========================================================================
  // CACHING
  // =========================================================================
  cache: {
    // Time-to-live for cached LLM results (milliseconds)
    ttl: 30 * 60 * 1000, // 30 minutes
    
    // Max number of cached pages (oldest evicted first)
    maxEntries: 100,
    
    // Storage key prefix
    storageKey: "truthlens_cache",
  },

  // =========================================================================
  // TRUST SCORE THRESHOLDS
  // =========================================================================
  // Trust score is derived entirely from LLM analysis (no base score)
  thresholds: {
    safe: 70,      // >= 70 = green/safe
    caution: 40,   // >= 40 = yellow/caution
    danger: 0,     // < 40 = red/danger
  },

  // =========================================================================
  // DOMAIN ANALYSIS
  // =========================================================================
  domain: {
    // Flag domains younger than this (days)
    minAgeDays: 90,
    
    // WHOIS API timeout
    whoisTimeout: 5000,
    
    // Domains to always trust (skip some checks)
    trustedDomains: [
      "google.com", "github.com", "stackoverflow.com", "wikipedia.org",
      "microsoft.com", "apple.com", "amazon.com", "youtube.com",
    ],
  },

  // =========================================================================
  // FEATURE SETTINGS
  // =========================================================================
  features: {
    // --- Impulse Buy Shield ---
    impulseBuyShield: {
      enabled: true,
      // Delay in seconds before buy button becomes active
      delaySeconds: {
        1: 5,   // Low sensitivity
        2: 10,  // Medium sensitivity
        3: 15,  // High sensitivity
      },
      // Patterns to match buy buttons (case-insensitive)
      triggerPatterns: [
        "buy now", "add to cart", "add to bag", "purchase",
        "order now", "checkout", "subscribe now", "get it now", "shop now",
      ],
    },

    // --- Engagement Bait Shield ---
    rageBaitShield: {
      enabled: true,
      // LLM confidence threshold to trigger blur
      blurThreshold: {
        1: 0.8,  // Low sensitivity - only high confidence
        2: 0.6,  // Medium
        3: 0.4,  // High sensitivity - more aggressive
      },
      // Patterns for local detection (fallback)
      localPatterns: [
        "you won't believe", "shocking", "outrage", "disgusting",
        "infuriating", "unacceptable", "slammed", "destroyed", "blasted",
        "wake up", "sheeple", "open your eyes", "they don't want you to know",
      ],
    },

    // --- Hate Speech Filter ---
    hateSpeechFilter: {
      enabled: true,
      // How to handle detected hate speech: "blur" | "highlight" | "hide"
      displayMode: "blur",
      // Local detection terms (always filtered regardless of LLM)
      localTerms: [
        "kill yourself", "kys", "go die", "neck yourself",
      ],
    },

    // --- AI Content Detector ---
    slopDetector: {
      enabled: true,
      // LLM confidence threshold to show AI badge
      confidenceThreshold: {
        1: 0.7,  // Low - only obvious AI
        2: 0.5,  // Medium
        3: 0.3,  // High - more aggressive
      },
      // Badge text
      badgeText: "🤖 AI Detected",
    },

    // --- Comment Guard ---
    commentGuard: {
      enabled: true,
      // Minimum text length before checking
      minLength: 10,
      // Debounce delay (ms) after typing stops
      debounceMs: 500,
    },

    // --- Sensitive Image Guard ---
    sensitiveImageGuard: {
      enabled: false, // Off by default
      // Keywords in image context that trigger blur
      triggerKeywords: [
        "gore", "blood", "nsfw", "graphic", "disturbing",
        "violence", "death", "murder", "accident", "shooting",
        "attack", "victim",
      ],
      // Hits required to trigger at each sensitivity
      hitsRequired: {
        1: 3,
        2: 2,
        3: 1,
      },
    },

    // --- Slow Reader Mode ---
    slowReaderMode: {
      enabled: false, // Off by default
      // Show read time indicator if article is longer than X minutes
      minReadTimeMinutes: {
        1: 15,
        2: 8,
        3: 4,
      },
      // Words per minute for calculation
      wordsPerMinute: 200,
    },

    // --- Inflammatory Section Highlighting ---
    inflammatoryHighlight: {
      enabled: true,
      // How to display: "blur" | "highlight" | "hide"
      displayMode: "blur",
      // CSS classes for each mode
      cssClasses: {
        blur: "tl-inflammatory-blur",
        highlight: "tl-inflammatory-highlight",
        hide: "tl-inflammatory-hide",
      },
    },
  },

  // =========================================================================
  // UI SETTINGS
  // =========================================================================
  ui: {
    // Base font sizes (CSS custom properties)
    fontSize: {
      base: "16px",
      large: "18px",
      xlarge: "22px",
      small: "14px",
    },
    
    // Banner auto-dismiss (0 = never)
    bannerAutoDismissMs: 0,
    
    // Badge colors
    badgeColors: {
      safe: "#10b981",
      caution: "#f59e0b",
      danger: "#ef4444",
      loading: "#78716c",
    },
  },

  // =========================================================================
  // DEBUG
  // =========================================================================
  debug: {
    // Log analysis results to console
    logAnalysis: true,
    
    // Show debug panel in popup
    showDebugPanel: true,
  },
};

// Helper to get feature setting with sensitivity
export function getFeatureSetting(featureName, settingName, sensitivity = 2) {
  const feature = CONFIG.features[featureName];
  if (!feature) return null;
  
  const setting = feature[settingName];
  if (typeof setting === "object" && setting !== null && !Array.isArray(setting)) {
    // It's a sensitivity-keyed object
    return setting[sensitivity] ?? setting[2]; // Default to medium
  }
  return setting;
}

// Helper to check if domain is trusted
export function isDomainTrusted(hostname) {
  const domain = hostname.replace(/^www\./, "").toLowerCase();
  return CONFIG.domain.trustedDomains.some(
    (trusted) => domain === trusted || domain.endsWith("." + trusted)
  );
}
