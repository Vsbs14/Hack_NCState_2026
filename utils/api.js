/**
 * api.js — Unified API Layer for TruthLens
 * 
 * Single entry point for all LLM providers (Claude, Gemini, OpenAI).
 * Returns comprehensive JSON metrics from a single prompt.
 */

import { CONFIG } from "../lib/config.js";

// ============================================================================
// UNIFIED LLM PROMPT
// ============================================================================

/**
 * Build the unified prompt that returns all metrics in one call
 */
function buildUnifiedPrompt(pageData) {
  const { url, title, metaDescription, visibleText, linkCount, imageCount, formCount, hasArticleTag, hasComments, domain } = pageData;
  
  return `Analyze this webpage comprehensively. Return ONLY a valid JSON object with no additional text.

PAGE DATA:
- URL: ${url}
- Title: ${title || "none"}
- Meta Description: ${metaDescription || "none"}
- Domain: ${domain || "unknown"}
- Links: ${linkCount}, Images: ${imageCount}, Forms: ${formCount}
- Has article tag: ${hasArticleTag}, Has comments section: ${hasComments}

PAGE TEXT (first ${CONFIG.api.maxTextLength} chars):
"""
${(visibleText || "").substring(0, CONFIG.api.maxTextLength)}
"""

Return this exact JSON structure:
{
  "pageType": "shopping|news|social|blog|forum|payment|general",
  "trustScore": 0-100,
  
  "aiContent": {
    "detected": true/false,
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation"
  },
  
  "toxicity": {
    "hateSpeech": true/false,
    "hateSpeechExamples": ["quote1", "quote2"],
    "rageBait": true/false,
    "rageBaitConfidence": 0.0-1.0,
    "inflammatorySections": [
      {"text": "exact inflammatory text", "reason": "why it's inflammatory"}
    ]
  },
  
  "shopping": {
    "isShoppingPage": true/false,
    "hasUrgencyTactics": true/false,
    "urgencyPhrases": ["phrase1", "phrase2"],
    "hasPriceManipulation": true/false,
    "manipulationTactics": ["tactic1"]
  },
  
  "credibility": {
    "hasAuthorAttribution": true/false,
    "hasSources": true/false,
    "hasDateline": true/false,
    "contentQuality": "high|medium|low",
    "factualConcerns": ["concern1"]
  },
  
  "risks": ["risk1", "risk2"],
  "positiveSignals": ["signal1", "signal2"],
  
  "summary": "One sentence summary of the page's trustworthiness"
}

SCORING GUIDELINES:
- 80-100: Highly trustworthy (established source, good attribution, no manipulation)
- 60-79: Generally safe (minor concerns, some missing attribution)
- 40-59: Proceed with caution (manipulation tactics, low quality, or concerning content)
- 0-39: High risk (hate speech, scams, severe manipulation, or dangerous content)`;
}

// ============================================================================
// PROVIDER-SPECIFIC API CALLS
// ============================================================================

async function callClaude(prompt, apiKey) {
  const res = await fetch(CONFIG.api.endpoints.claude, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    signal: AbortSignal.timeout(CONFIG.api.timeout),
    body: JSON.stringify({
      model: CONFIG.api.models.claude,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text || "";
  return parseJsonResponse(content);
}

async function callGemini(prompt, apiKey) {
  const url = `${CONFIG.api.endpoints.gemini}/${CONFIG.api.models.gemini}:generateContent?key=${apiKey}`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(CONFIG.api.timeout),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseJsonResponse(content);
}

async function callOpenAI(prompt, apiKey) {
  const res = await fetch(CONFIG.api.endpoints.openai, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(CONFIG.api.timeout),
    body: JSON.stringify({
      model: CONFIG.api.models.openai,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  return parseJsonResponse(content);
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
function parseJsonResponse(content) {
  // Try to extract JSON from markdown code blocks
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || 
                    content.match(/(\{[\s\S]*\})/);
  
  if (!jsonMatch) {
    throw new Error("No JSON found in response");
  }
  
  return JSON.parse(jsonMatch[1]);
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Analyze a page using the configured LLM provider
 * @param {object} pageData - Page data collected from content script
 * @param {string} apiKey - API key for the provider
 * @param {string} provider - Provider name: "claude" | "gemini" | "openai"
 * @returns {Promise<object>} Comprehensive analysis result
 */
export async function analyzePage(pageData, apiKey, provider = CONFIG.api.defaultProvider) {
  if (!apiKey) {
    return { error: "No API key configured", source: "no-key" };
  }

  const prompt = buildUnifiedPrompt(pageData);
  
  try {
    let result;
    switch (provider) {
      case "claude":
        result = await callClaude(prompt, apiKey);
        break;
      case "gemini":
        result = await callGemini(prompt, apiKey);
        break;
      case "openai":
        result = await callOpenAI(prompt, apiKey);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
    
    return {
      ...result,
      source: provider,
      analyzedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error(`[TruthLens API] ${provider} error:`, e);
    return {
      error: e.message,
      source: `${provider}-error`,
    };
  }
}

// ============================================================================
// DOMAIN ANALYSIS (Non-LLM)
// ============================================================================

/**
 * Fetch WHOIS data for domain age
 */
export async function fetchWhois(domain) {
  // Cache WHOIS results in chrome.storage.local to reduce network calls
  const CACHE_KEY = "truthlens_whois_cache";
  const TTL = 24 * 60 * 60 * 1000; // 24 hours

  try {
    // Normalize domain
    const host = domain.replace(/^www\./, "").toLowerCase();

    // Try cache first
    try {
      const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
      const entry = cache[host];
      if (entry && (Date.now() - entry._ts) < TTL) {
        return entry.value;
      }
    } catch (e) {
      // ignore cache read errors
    }

    // Helper to store cache
    async function storeCache(val) {
      try {
        const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
        cache[host] = { value: val, _ts: Date.now() };
        await chrome.storage.local.set({ [CACHE_KEY]: cache });
      } catch (e) {
        // ignore cache write errors
      }
    }

    // Primary WHOIS endpoint
    try {
      const res = await fetch(`https://who-dat.as93.net/${host}`, {
        signal: AbortSignal.timeout(CONFIG.domain.whoisTimeout),
      });

      if (res.ok) {
        const data = await res.json();
        const created = data?.domain?.created_date
          || data?.domain?.creation_date
          || data?.created
          || data?.creation_date
          || data?.creationDate;

        const registrar = data?.registrar?.name || data?.registrar || data?.registrar_name || null;

        if (created) {
          const createdDate = new Date(created);
          if (!isNaN(createdDate.getTime())) {
            const ageMs = Date.now() - createdDate.getTime();
            const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
            const out = { domainAge: ageDays, createdDate: createdDate.toISOString().split("T")[0], registrar };
            await storeCache(out);
            return out;
          }
        } else {
          // If no created date, still return registrar if present
          if (registrar) {
            const out = { domainAge: null, createdDate: null, registrar };
            await storeCache(out);
            return out;
          }
        }
      }
    } catch (e) {
      // who-dat may be down or CORS blocked; continue to RDAP fallback
      console.debug("[TruthLens WHOIS] who-dat lookup failed, falling back to RDAP:", e?.message);
    }

    // RDAP fallback (rdap.org) — parse events or entities
    try {
      const rdap = await fetch(`https://rdap.org/domain/${host}`, { signal: AbortSignal.timeout(CONFIG.domain.whoisTimeout) });
      if (rdap.ok) {
        const rdata = await rdap.json();

        // Try multiple places for created/registration date
        let createdDateStr = null;
        if (Array.isArray(rdata.events)) {
          const reg = rdata.events.find((e) => e.eventAction && /regist/i.test(e.eventAction)) || rdata.events.find((e) => /create|registration/i.test(e.eventAction || e.eventType || ""));
          createdDateStr = reg?.eventDate || reg?.eventDateTime || null;
        }
        if (!createdDateStr && rdata.registration) createdDateStr = rdata.registration;
        if (!createdDateStr && rdata.created) createdDateStr = rdata.created;

        // Registrar extraction: try rdata.registrar, entities vcardArray
        let registrar = null;
        if (rdata.registrar) registrar = rdata.registrar.name || rdata.registrar;
        if (!registrar && Array.isArray(rdata.entities) && rdata.entities.length > 0) {
          for (const ent of rdata.entities) {
            // vcardArray structure: ["vcard", [["fn", {}, "text", "Name"] ...]]
            const v = ent.vcardArray || ent.vcard || null;
            if (Array.isArray(v) && v.length >= 2) {
              const props = v[1];
              const fn = props.find((p) => p[0] === "fn") || props.find((p) => p[0] === "org");
              if (fn && fn[3]) { registrar = fn[3]; break; }
            }
            if (ent.roles && ent.roles.includes && ent.roles.includes("registrar") && ent.handle) {
              registrar = ent.handle; break;
            }
          }
        }

        if (createdDateStr) {
          const createdDate = new Date(createdDateStr);
          if (!isNaN(createdDate.getTime())) {
            const ageMs = Date.now() - createdDate.getTime();
            const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
            const out = { domainAge: ageDays, createdDate: createdDate.toISOString().split("T")[0], registrar };
            await storeCache(out);
            return out;
          }
        }

        // If RDAP didn't give creation but gave registrar, return that
        if (registrar) {
          const out = { domainAge: null, createdDate: null, registrar };
          await storeCache(out);
          return out;
        }
      }
    } catch (e) {
      console.debug("[TruthLens WHOIS] RDAP lookup failed:", e?.message);
    }

    // All lookups failed — store a negative cache to avoid repeated attempts
    const negative = { domainAge: null, createdDate: null, registrar: null };
    try { await storeCache(negative); } catch {}
    return negative;
  } catch (e) {
    console.error(`[TruthLens WHOIS] Error for ${domain}:`, e);
    return { domainAge: null, createdDate: null, registrar: null, error: e?.message };
  }
}

/**
 * Check SSL - simple protocol check
 */
export function checkSSL(url) {
  try {
    const parsed = new URL(url);
    return { 
      valid: parsed.protocol === "https:",
      protocol: parsed.protocol,
    };
  } catch {
    return { valid: false, protocol: "unknown" };
  }
}

/**
 * Google Safe Browsing API check
 */
export async function checkSafeBrowsing(url, apiKey) {
  if (!apiKey) {
    return { safe: true, threats: [], source: "no-api-key" };
  }

  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          client: { clientId: "truthlens", clientVersion: "2.0.0" },
          threatInfo: {
            threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
      }
    );
    
    if (!res.ok) {
      return { safe: true, threats: [], source: "api-error", error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const matches = data.matches || [];
    
    return {
      safe: matches.length === 0,
      threats: matches.map((m) => m.threatType),
      source: "google-safe-browsing",
    };
  } catch (e) {
    return { safe: true, threats: [], source: "fetch-error", error: e.message };
  }
}

// ============================================================================
// LEGACY EXPORTS (for backward compatibility during migration)
// ============================================================================

export const TruthLensAPI = {
  fetchWhois,
  checkSSL,
  checkSafeBrowsing,
  analyzePage,
  
  // Legacy methods - redirect to new unified approach
  async analyzeWithClaude(text, apiKey) {
    console.warn("[TruthLens] analyzeWithClaude is deprecated, use analyzePage instead");
    return analyzePage({ visibleText: text }, apiKey, "claude");
  },
  
  async analyzeWithGemini(pageData, apiKey) {
    console.warn("[TruthLens] analyzeWithGemini is deprecated, use analyzePage instead");
    return analyzePage(pageData, apiKey, "gemini");
  },
  
  // Keep these for now
  categorizeContent(url, pageContext) {
    // Fallback heuristic categorization
    const hostname = new URL(url).hostname.toLowerCase();
    const path = new URL(url).pathname.toLowerCase();

    const shoppingDomains = ["amazon", "ebay", "walmart", "etsy", "shopify", "bestbuy", "target", "aliexpress", "temu", "wish"];
    if (shoppingDomains.some(d => hostname.includes(d)) || /\/(shop|product|cart|checkout|buy|deal)/i.test(path)) return "Shopping";

    const newsDomains = ["cnn", "bbc", "reuters", "nytimes", "foxnews", "theguardian", "apnews", "washingtonpost"];
    if (newsDomains.some(d => hostname.includes(d)) || /\/(article|story|news|opinion|editorial)/i.test(path)) return "News";

    const socialDomains = ["facebook", "twitter", "x.com", "instagram", "tiktok", "reddit", "linkedin", "threads"];
    if (socialDomains.some(d => hostname.includes(d))) return "Social";

    if (/\/(blog|post)/i.test(path) || hostname.includes("medium") || hostname.includes("substack")) return "Blog";
    if (hostname.includes("stackoverflow") || hostname.includes("quora") || /\/(forum|thread)/i.test(path)) return "Forum";

    return "General";
  },
  
  computeTrustScore({ whois, safeBrowsing, pageContext, llmAnalysis }) {
    // If we have LLM analysis, use its trust score directly
    if (llmAnalysis?.trustScore != null) {
      return llmAnalysis.trustScore;
    }
    
    // Fallback: compute from available signals (no base score)
    let score = 50; // Starting point, but adjusted heavily
    let hasData = false;

    // Domain age
    if (whois?.domainAge != null) {
      hasData = true;
      if (whois.domainAge > 365 * 5) score += 25;
      else if (whois.domainAge > 365) score += 15;
      else if (whois.domainAge > 90) score += 5;
      else score -= 20;
    }

    // Safe Browsing
    if (safeBrowsing?.source === "google-safe-browsing") {
      hasData = true;
      if (!safeBrowsing.safe) score -= 40;
      else score += 10;
    }

    // Risk signals
    if (pageContext?.riskSignals?.length > 0) {
      hasData = true;
      score -= pageContext.riskSignals.length * 5;
    }

    if (!hasData) return null;
    return Math.max(0, Math.min(100, score));
  },
};
