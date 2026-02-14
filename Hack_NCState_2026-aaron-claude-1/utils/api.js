/**
 * api.js — API Wrapper for external services + AI APIs
 * Used by the background service worker (imported as module).
 */

export const TruthLensAPI = {
  /**
   * Fetch WHOIS data from who-dat.as93.net (free, no key required).
   */
  async fetchWhois(domain) {
    try {
      // Primary WHOIS endpoint (may fail due to CORS or API changes)
      const res = await fetch(`https://who-dat.as93.net/${domain}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        try {
          const data = await res.json();
          const created = data?.domain?.created_date
            || data?.domain?.creation_date
            || data?.created
            || data?.creation_date;
          if (created) {
            const createdDate = new Date(created);
            const ageMs = Date.now() - createdDate.getTime();
            const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
            return {
              domainAge: ageDays,
              createdDate: createdDate.toISOString().split("T")[0],
              registrar: data?.registrar?.name || data?.registrar || null,
            };
          }
        } catch { /* fall through to RDAP fallback */ }
      }

      // Fallback: RDAP lookup (rdap.org) — often available and returns JSON with events
      try {
        const rdap = await fetch(`https://rdap.org/domain/${domain}`, { signal: AbortSignal.timeout(5000) });
        if (rdap.ok) {
          const rdata = await rdap.json();
          const events = rdata.events || rdata.objectClassName ? rdata.events : null;
          // events array may include registration/registration
          let createdDateStr = null;
          if (Array.isArray(rdata.events)) {
            const reg = rdata.events.find((e) => e.eventAction && /regist/i.test(e.eventAction)) || rdata.events.find((e) => e.eventAction === 'registration');
            createdDateStr = reg?.eventDate || null;
          }
          // Some RDAP responses include 'registration' in different fields
          if (!createdDateStr && rdata.registration) createdDateStr = rdata.registration;
          if (createdDateStr) {
            const createdDate = new Date(createdDateStr);
            if (!isNaN(createdDate.getTime())) {
              const ageMs = Date.now() - createdDate.getTime();
              const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
              return {
                domainAge: ageDays,
                createdDate: createdDate.toISOString().split("T")[0],
                registrar: (rdata.registrar && rdata.registrar.name) || rdata.entities?.[0]?.vcardArray || null,
              };
            }
          }
        }
      } catch { /* ignore rdap errors */ }

      // If all lookups failed, return null-ish result
      return { domainAge: null, createdDate: null, registrar: null };
    } catch {
      return { domainAge: null, createdDate: null, registrar: null };
    }
  },

  /**
   * Check SSL — binary pass/fail based on protocol.
   */
  checkSSL(url) {
    try {
      const parsedUrl = new URL(url);
      return { valid: parsedUrl.protocol === "https:" };
    } catch {
      return { valid: false };
    }
  },

  /**
   * Google Safe Browsing Lookup API.
   */
  async checkSafeBrowsing(url, apiKey) {
    if (!apiKey) return { safe: true, threats: [], source: "no-api-key" };

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
      if (!res.ok) return { safe: true, threats: [], source: "api-error" };

      const data = await res.json();
      const matches = data.matches || [];
      return {
        safe: matches.length === 0,
        threats: matches.map((m) => m.threatType),
        source: "google-safe-browsing",
      };
    } catch {
      return { safe: true, threats: [], source: "fetch-error" };
    }
  },

  /**
   * Call Claude API for AI content detection.
   * Returns { isAI: bool, confidence: 0-1, reasoning: string }
   */
  async analyzeWithClaude(text, claudeApiKey) {
    if (!claudeApiKey || !text || text.length < 100) {
      return { isAI: false, confidence: 0, reasoning: "No API key or insufficient text", source: "skipped" };
    }

    // Truncate to ~2000 chars for speed/cost
    const sample = text.substring(0, 2000);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeApiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 300,
          messages: [{
            role: "user",
            content: `Analyze this text and determine if it was likely written by an AI language model. Consider: repetitive phrasing, generic structure, lack of personal voice, overuse of transition words, listicle formatting, and hallmark AI phrases.

Respond in EXACTLY this JSON format, nothing else:
{"isAI": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}

Text to analyze:
"""
${sample}
"""`
          }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { isAI: false, confidence: 0, reasoning: `API error: ${res.status}`, source: "claude-error", _raw: errText };
      }

      const data = await res.json();
      const content = data.content?.[0]?.text || "";

      try {
        const parsed = JSON.parse(content);
        return { ...parsed, source: "claude" };
      } catch {
        return { isAI: false, confidence: 0, reasoning: "Failed to parse Claude response", source: "claude-parse-error", _raw: content };
      }
    } catch (e) {
      return { isAI: false, confidence: 0, reasoning: `Network error: ${e.message}`, source: "claude-network-error" };
    }
  },

  /**
   * Call Gemini API for page context analysis (replaces local heuristics when available).
   * Returns structured page analysis or null on failure.
   */
  async analyzeWithGemini(pageData, geminiApiKey) {
    if (!geminiApiKey) return null;

    const { url, title, metaDescription, visibleText, linkCount, imageCount, formCount, hasArticleTag, hasComments } = pageData;
    const textSample = (visibleText || "").substring(0, 1500);

    try {
      // Try key-based request first
      let res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Analyze this webpage and classify it. Respond in EXACTLY this JSON format, nothing else:\n\n{\n  "pageType": "shopping|news|social|blog|forum|payment|general",\n  "confidence": 0.0-1.0,\n  "intentSignals": ["list of detected intent signals"],\n  "riskSignals": ["list of detected risk signals"],\n  "contentCategory": "Shopping|News|Social|Blog|Forum|Payment|General",\n  "reasoning": "brief explanation of classification"\n}\n\nPage data:\nURL: ${url}\nTitle: ${title || "none"}\nMeta: ${metaDescription || "none"}\nLinks: ${linkCount}, Images: ${imageCount}, Forms: ${formCount}\nHas article tag: ${hasArticleTag}, Has comments: ${hasComments}\n\nText sample:\n"""\n${textSample}\n"""`
              }]
            }],
          }),
        }
      );

      // If key-based fails, try header-based auth (some keys/tokens require Bearer)
      if (!res.ok) {
        try {
          res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0:generateContent`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${geminiApiKey}` },
              signal: AbortSignal.timeout(15000),
              body: JSON.stringify({
                contents: [{ parts: [{ text: `Analyze this webpage and classify it. Respond in EXACTLY this JSON format, nothing else:\n\n{\n  "pageType": "shopping|news|social|blog|forum|payment|general",\n  "confidence": 0.0-1.0,\n  "intentSignals": ["list of detected intent signals"],\n  "riskSignals": ["list of detected risk signals"],\n  "contentCategory": "Shopping|News|Social|Blog|Forum|Payment|General",\n  "reasoning": "brief explanation of classification"\n}\n\nPage data:\nURL: ${url}\nTitle: ${title || "none"}\nMeta: ${metaDescription || "none"}\nLinks: ${linkCount}, Images: ${imageCount}, Forms: ${formCount}\nHas article tag: ${hasArticleTag}, Has comments: ${hasComments}\n\nText sample:\n"""\n${textSample}\n"""` }] }]
              }),
            }
          );
        } catch (e) {
          return { source: "gemini", error: "network-error", details: e.message };
        }
      }

      const text = await res.text();
      // Try to extract JSON payload from response text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // Attempt to parse as JSON body if it's pure JSON
        try {
          const parsedBody = JSON.parse(text);
          // Attempt to find content inside parsedBody
          const content = parsedBody.candidates?.[0]?.content?.parts?.[0]?.text || parsedBody.outputText || null;
          if (content) {
            const m = (content || '').match(/\{[\s\S]*\}/);
            if (m) return { ...JSON.parse(m[0]), source: "gemini" };
          }
        } catch (e) {
          return { source: "gemini", error: "no-json", raw: text };
        }
        return { source: "gemini", error: "no-json", raw: text };
      }

      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return { ...parsed, source: "gemini" };
      } catch (e) {
        return { source: "gemini", error: "parse-error", raw: jsonMatch[0] };
      }
    } catch (e) {
      return { source: "gemini", error: "exception", details: e.message };
    }
  },

  /**
   * Heuristic content categorization (fallback).
   */
  categorizeContent(url, pageContext) {
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

    if (pageContext?.pageType && pageContext.pageType !== "unknown") {
      const typeMap = { shopping: "Shopping", news: "News", social: "Social", forum: "Forum", payment: "Payment" };
      return typeMap[pageContext.pageType] || "General";
    }

    return "General";
  },

  /**
   * Compute trust score (0-100) from signals. Starts at null, returns null if no data.
   * SSL is NOT part of the score — it's binary pass/fail shown separately.
   */
  computeTrustScore({ whois, safeBrowsing, pageContext, geminiAnalysis }) {
    // Base score starts at 0
    let hasData = false;
    let score = 0;

    // Domain age (positive indicates trustworthiness)
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

    // Risk signals from page analysis
    if (pageContext?.riskSignals?.length > 0) {
      hasData = true;
      score -= pageContext.riskSignals.length * 5;
    }

    // Gemini risk signals
    if (geminiAnalysis?.riskSignals?.length > 0) {
      hasData = true;
      score -= geminiAnalysis.riskSignals.length * 5;
    }

    // Intent signals boost
    if (pageContext?.intentSignals?.length > 0) {
      hasData = true;
      score += Math.min(pageContext.intentSignals.length * 2, 10);
    }

    if (!hasData) return null;
    return Math.max(0, Math.min(100, score));
  },

  /**
   * Analyze videos with TwelveLabs (stubbed).
   * If present, callers should provide `pageData.videoUrls`.
   */
  async analyzeWithTwelveLabs(pageData, twApiKey) {
    if (!twApiKey || !pageData || !pageData.videoUrls || pageData.videoUrls.length === 0) {
      return null;
    }

    // Minimal stub implementation: mark that videos exist and the call was attempted.
    // A real integration would upload a clip or send URL(s) to Twelve Labs API and parse response.
    try {
      return {
        source: "twelvelabs",
        detected: false,
        details: `checked ${pageData.videoUrls.length} video(s)`,
      };
    } catch {
      return { source: "twelvelabs", detected: false, error: "request-failed" };
    }
  },
};
