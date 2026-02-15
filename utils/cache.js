/**
 * cache.js — LLM Result Caching
 * 
 * Caches analysis results by URL to avoid re-triggering API calls
 * on page refresh or interaction.
 */

import { CONFIG } from "../lib/config.js";

/**
 * Normalize URL for cache key (strip fragments, normalize query params)
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    // Remove fragment
    parsed.hash = "";
    // Sort query params for consistency
    const params = new URLSearchParams(parsed.search);
    const sortedParams = new URLSearchParams([...params.entries()].sort());
    parsed.search = sortedParams.toString();
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Get cached analysis result for a URL
 * @param {string} url - Page URL
 * @returns {Promise<object|null>} Cached result or null if not found/expired
 */
export async function getCachedResult(url) {
  const key = normalizeUrl(url);
  
  try {
    const { [CONFIG.cache.storageKey]: cache = {} } = 
      await chrome.storage.local.get(CONFIG.cache.storageKey);
    
    const entry = cache[key];
    if (!entry) return null;
    
    // Check if expired
    if (Date.now() - entry.timestamp > CONFIG.cache.ttl) {
      // Expired - clean up
      delete cache[key];
      await chrome.storage.local.set({ [CONFIG.cache.storageKey]: cache });
      return null;
    }
    
    console.log("[TruthLens Cache] Hit for:", key);
    return entry.result;
  } catch (e) {
    console.error("[TruthLens Cache] Error reading:", e);
    return null;
  }
}

/**
 * Store analysis result in cache
 * @param {string} url - Page URL
 * @param {object} result - Analysis result to cache
 */
export async function setCachedResult(url, result) {
  const key = normalizeUrl(url);
  
  try {
    const { [CONFIG.cache.storageKey]: cache = {} } = 
      await chrome.storage.local.get(CONFIG.cache.storageKey);
    
    // Evict oldest entries if at max capacity
    const keys = Object.keys(cache);
    if (keys.length >= CONFIG.cache.maxEntries) {
      // Sort by timestamp, remove oldest
      const sorted = keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp);
      const toRemove = sorted.slice(0, keys.length - CONFIG.cache.maxEntries + 1);
      toRemove.forEach((k) => delete cache[k]);
    }
    
    cache[key] = {
      result,
      timestamp: Date.now(),
      url: key,
    };
    
    await chrome.storage.local.set({ [CONFIG.cache.storageKey]: cache });
    console.log("[TruthLens Cache] Stored result for:", key);
  } catch (e) {
    console.error("[TruthLens Cache] Error writing:", e);
  }
}

/**
 * Clear all cached results
 */
export async function clearCache() {
  try {
    await chrome.storage.local.remove(CONFIG.cache.storageKey);
    console.log("[TruthLens Cache] Cleared");
  } catch (e) {
    console.error("[TruthLens Cache] Error clearing:", e);
  }
}

/**
 * Get cache statistics
 * @returns {Promise<{entries: number, oldestAge: number}>}
 */
export async function getCacheStats() {
  try {
    const { [CONFIG.cache.storageKey]: cache = {} } = 
      await chrome.storage.local.get(CONFIG.cache.storageKey);
    
    const entries = Object.keys(cache).length;
    const timestamps = Object.values(cache).map((e) => e.timestamp);
    const oldestAge = timestamps.length > 0 
      ? Date.now() - Math.min(...timestamps) 
      : 0;
    
    return { entries, oldestAge };
  } catch {
    return { entries: 0, oldestAge: 0 };
  }
}
