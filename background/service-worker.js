/**
 * service-worker.js — TruthLens Background Service Worker
 *
 * Handles domain analysis, unified LLM API calls, caching, badge updates,
 * and message routing. Supports re-scan without page refresh.
 */

import { CONFIG } from "../lib/config.js";
import { analyzePage, fetchWhois, checkSSL, checkSafeBrowsing, TruthLensAPI } from "../utils/api.js";
import { getCachedResult, setCachedResult, clearCache } from "../utils/cache.js";

const tabContexts = {};

const DEFAULT_PROFILE = {
  impulseBuyer: { enabled: true, sensitivity: 2 },
  rageBaitShield: { enabled: true, sensitivity: 2 },
  slowReaderMode: { enabled: false, sensitivity: 1 },
  slopDetector: { enabled: true, sensitivity: 2 },
  hateSpeechFilter: { enabled: true, sensitivity: 2 },
  sensitiveImageGuard: { enabled: false, sensitivity: 1 },
  commentGuard: { enabled: true, sensitivity: 2 },
  videoScanning: { enabled: false, sensitivity: 2 },
};

// ---------------------------------------------------------------------------
// API Key & Provider Management
// ---------------------------------------------------------------------------

async function getApiConfig() {
  const { truthlens_api } = await chrome.storage.local.get("truthlens_api");
  return truthlens_api || { provider: CONFIG.api.defaultProvider, apiKey: null };
}

// ---------------------------------------------------------------------------
// Domain Analysis (Non-LLM)
// ---------------------------------------------------------------------------

async function analyzeDomain(url) {
  try {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname.replace(/^www\./, "");

    // Get SSL synchronously
    const ssl = checkSSL(url);
    
    // Run WHOIS lookup
    let whois = null;
    try {
      whois = await fetchWhois(domain);
    } catch (e) {
      console.warn("[TruthLens BG] WHOIS lookup failed:", e);
      whois = { domainAge: null, createdDate: null, registrar: null, error: e.message };
    }

    // Safe Browsing - check both old and new storage formats
    const storage = await chrome.storage.local.get(["truthlens_apikeys", "truthlens_safebrowsing_key"]);
    const safeBrowsingKey = storage.truthlens_apikeys?.safeBrowsing || storage.truthlens_safebrowsing_key || null;
    
    let safeBrowsing = { safe: true, threats: [], source: "no-api-key" };
    if (safeBrowsingKey) {
      try {
        safeBrowsing = await checkSafeBrowsing(url, safeBrowsingKey);
      } catch (e) {
        console.warn("[TruthLens BG] Safe Browsing check failed:", e);
        safeBrowsing = { safe: true, threats: [], source: "error", error: e.message };
      }
    }

    return {
      domain,
      whois,
      ssl,
      safeBrowsing,
      analyzedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error("[TruthLens BG] Domain analysis error:", e);
    return {
      domain: new URL(url).hostname,
      whois: { error: "Analysis failed" },
      ssl: { valid: url.startsWith("https:"), protocol: url.split(":")[0] + ":" },
      safeBrowsing: { safe: true, threats: [], source: "error" },
      error: e.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Video Analysis (YouTube Transcript + LLM Analysis)
// ---------------------------------------------------------------------------

async function analyzeVideo(videoSrc, pageUrl) {
  const apiConfig = await getApiConfig();
  
  if (!apiConfig.apiKey) {
    console.log("[TruthLens BG] No LLM API key configured for video analysis");
    return {
      severity: "none",
      requiresWarning: false,
      summary: "Video analysis unavailable - no LLM API key configured",
      source: "no-api-key"
    };
  }

  try {
    // Check if it's a YouTube video
    const youtubeMatch = videoSrc?.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    
    if (youtubeMatch) {
      const videoId = youtubeMatch[1];
      
      // Try to get YouTube transcript using a free transcript API
      let transcript = null;
      try {
        // Use youtubetranscript.com API (free, no key required)
        const transcriptResponse = await fetch(
          `https://youtubetranscript.com/?server_vid2=${videoId}`
        );
        
        if (transcriptResponse.ok) {
          const transcriptText = await transcriptResponse.text();
          // Parse the XML response
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(transcriptText, "text/xml");
          const textElements = xmlDoc.querySelectorAll("text");
          transcript = Array.from(textElements)
            .map(el => el.textContent)
            .join(" ")
            .substring(0, 3000); // Limit to 3000 chars
        }
      } catch (e) {
        console.warn("[TruthLens BG] Transcript fetch failed:", e);
      }

      // If no transcript, try to get video metadata from page context
      if (!transcript) {
        // Fallback: analyze based on video title and page context
        transcript = `YouTube video ID: ${videoId}. Page URL: ${pageUrl}. Unable to fetch transcript.`;
      }

      // Analyze transcript with LLM
      const analysisPrompt = `Analyze this video transcript for potentially harmful content. Return JSON only:
{
  "severity": "none" | "low" | "medium" | "high",
  "requiresWarning": boolean,
  "summary": "Brief 1-2 sentence summary of the video content",
  "hateSpeech": boolean,
  "aiGenerated": boolean,
  "politicalBias": null | "left" | "right" | "extreme-left" | "extreme-right",
  "misinformation": boolean,
  "adultContent": boolean,
  "violence": boolean
}

Transcript:
${transcript}`;

      // Call LLM API based on provider
      let llmResponse;
      if (apiConfig.provider === "claude") {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiConfig.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 500,
            messages: [{ role: "user", content: analysisPrompt }]
          })
        });
        const data = await response.json();
        llmResponse = data.content?.[0]?.text;
      } else if (apiConfig.provider === "gemini") {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiConfig.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: analysisPrompt }] }]
            })
          }
        );
        const data = await response.json();
        llmResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      } else if (apiConfig.provider === "openai") {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiConfig.apiKey}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: analysisPrompt }],
            max_tokens: 500
          })
        });
        const data = await response.json();
        llmResponse = data.choices?.[0]?.message?.content;
      }

      // Parse LLM response
      if (llmResponse) {
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          return {
            ...analysis,
            source: "llm-transcript"
          };
        }
      }

      return {
        severity: "unknown",
        requiresWarning: false,
        summary: "Could not analyze video content",
        source: "parse-error"
      };
    }

    // For non-YouTube videos, return basic analysis
    return {
      severity: "none",
      requiresWarning: false,
      summary: "Non-YouTube video - analysis not available",
      source: "unsupported"
    };

  } catch (err) {
    console.error("[TruthLens BG] Video analysis error:", err);
    return {
      severity: "none",
      requiresWarning: false,
      summary: "Video analysis failed",
      error: err.message,
      source: "error"
    };
  }
}

// ---------------------------------------------------------------------------
// Text-to-Speech (11Labs API)
// ---------------------------------------------------------------------------

async function generateTTS(text) {
  const storage = await chrome.storage.local.get("truthlens_apikeys");
  const elevenLabsKey = storage.truthlens_apikeys?.elevenLabs;
  
  if (!elevenLabsKey) {
    console.log("[TruthLens BG] No 11Labs API key configured");
    return { audioUrl: null, error: "No API key configured" };
  }

  try {
    // Use 11Labs text-to-speech API
    const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": elevenLabsKey
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      })
    });

    if (!response.ok) {
      throw new Error(`11Labs API error: ${response.status}`);
    }

    // Convert audio blob to data URL
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    
    return { audioUrl };

  } catch (err) {
    console.error("[TruthLens BG] 11Labs API error:", err);
    return { audioUrl: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Full Analysis Pipeline
// ---------------------------------------------------------------------------

async function runFullAnalysis(tabId, tabUrl, pageContext, forceRefresh = false) {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await getCachedResult(tabUrl);
    if (cached) {
      console.log(`[TruthLens BG] Using cached result for tab ${tabId}`);
      tabContexts[tabId] = cached;
      updateBadge(tabId, cached.llmAnalysis?.trustScore, cached.hasRisks);
      return cached;
    }
  }

  // Get API configuration
  const apiConfig = await getApiConfig();
  
  // Run domain analysis
  const domainAnalysis = await analyzeDomain(tabUrl);

  // Run LLM analysis if API key is configured
  let llmAnalysis = null;
  if (apiConfig.apiKey && pageContext?._pageData) {
    // Add domain info to page data
    const pageData = {
      ...pageContext._pageData,
      domain: domainAnalysis?.domain,
    };
    
    llmAnalysis = await analyzePage(pageData, apiConfig.apiKey, apiConfig.provider);
    
    if (CONFIG.debug.logAnalysis) {
      console.log("[TruthLens BG] LLM Analysis:", llmAnalysis);
    }
  }

  // Determine trust score
  const trustScore = llmAnalysis?.trustScore ?? 
    TruthLensAPI.computeTrustScore({
      whois: domainAnalysis?.whois,
      safeBrowsing: domainAnalysis?.safeBrowsing,
      pageContext,
      llmAnalysis,
    });

  // Determine category
  const category = llmAnalysis?.pageType || 
    TruthLensAPI.categorizeContent(tabUrl, pageContext);

  // Check for risks
  const hasRisks = (llmAnalysis?.risks?.length > 0)
    || (llmAnalysis?.toxicity?.hateSpeech)
    || (llmAnalysis?.toxicity?.rageBait)
    || (domainAnalysis?.safeBrowsing && !domainAnalysis.safeBrowsing.safe)
    || (pageContext?.riskSignals?.length > 0);

  const fullAnalysis = {
    pageContext,
    domainAnalysis,
    llmAnalysis,
    trustScore,
    category,
    hasRisks,
    url: tabUrl,
    analyzedAt: new Date().toISOString(),
    source: llmAnalysis?.source || "heuristics",
    
    // Debug data
    _debug: {
      provider: apiConfig.provider,
      hasApiKey: !!apiConfig.apiKey,
      domainAge: domainAnalysis?.whois?.domainAge,
      domainCreated: domainAnalysis?.whois?.createdDate,
      domainError: domainAnalysis?.whois?.error,
      registrar: domainAnalysis?.whois?.registrar,
      sslValid: domainAnalysis?.ssl?.valid,
      sslProtocol: domainAnalysis?.ssl?.protocol,
      safeBrowsingSource: domainAnalysis?.safeBrowsing?.source,
      safeBrowsingThreats: domainAnalysis?.safeBrowsing?.threats,
      safeBrowsingError: domainAnalysis?.safeBrowsing?.error,
      llmSource: llmAnalysis?.source,
      llmError: llmAnalysis?.error,
    },
  };

  // Store in tab context
  tabContexts[tabId] = fullAnalysis;

  // Cache the result
  await setCachedResult(tabUrl, fullAnalysis);

  // Update badge
  updateBadge(tabId, trustScore, hasRisks);

  console.log(`[TruthLens BG] Tab ${tabId}: score=${trustScore}, type=${category}, source=${fullAnalysis.source}`);

  return fullAnalysis;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function updateBadge(tabId, trustScore, hasRisks) {
  let color, text;

  if (trustScore === null || trustScore === undefined) {
    color = CONFIG.ui.badgeColors.loading;
    text = "...";
  } else if (trustScore >= CONFIG.thresholds.safe) {
    color = CONFIG.ui.badgeColors.safe;
    text = "OK";
  } else if (trustScore >= CONFIG.thresholds.caution) {
    color = CONFIG.ui.badgeColors.caution;
    text = "!";
  } else {
    color = CONFIG.ui.badgeColors.danger;
    text = "X";
  }

  if (hasRisks) color = CONFIG.ui.badgeColors.danger;

  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
}

// ---------------------------------------------------------------------------
// Message Router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "PAGE_CONTEXT_RESOLVED": {
      const tabId = sender.tab?.id;
      const tabUrl = sender.tab?.url;
      if (tabId == null) break;

      runFullAnalysis(tabId, tabUrl, message.payload).then((analysis) => {
        // Send results back to content script for interventions
        chrome.tabs.sendMessage(tabId, {
          type: "ANALYSIS_COMPLETE",
          analysis: {
            trustScore: analysis.trustScore,
            llmAnalysis: analysis.llmAnalysis,
            category: analysis.category,
            hasRisks: analysis.hasRisks,
            domainAnalysis: analysis.domainAnalysis,
          },
        }).catch(() => {});
      });

      sendResponse({ ok: true });
      break;
    }

    case "GET_FULL_ANALYSIS": {
      const analysis = tabContexts[message.tabId] ?? null;
      sendResponse({ analysis });
      break;
    }

    case "GET_PROFILE": {
      chrome.storage.local.get("truthlens_profile").then(({ truthlens_profile }) => {
        sendResponse({ profile: truthlens_profile ?? DEFAULT_PROFILE });
      });
      return true;
    }

    case "PROFILE_UPDATED": {
      chrome.tabs.query({ active: true }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: "REAPPLY_PROTECTIONS",
              profile: message.payload,
            }).catch(() => {});
          }
        });
      });
      sendResponse({ ok: true });
      break;
    }

    case "GET_API_CONFIG": {
      getApiConfig().then((config) => {
        sendResponse({ config });
      });
      return true;
    }

    case "SET_API_CONFIG": {
      chrome.storage.local.set({ truthlens_api: message.payload }).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    case "CLEAR_CACHE": {
      clearCache().then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    // Re-scan: force refresh analysis
    case "RESCAN": {
      const tabId = message.tabId;
      if (tabId) {
        // Clear cached analysis for this tab
        delete tabContexts[tabId];
        chrome.action.setBadgeText({ text: "...", tabId });
        chrome.action.setBadgeBackgroundColor({ color: CONFIG.ui.badgeColors.loading, tabId });

        // Tell content script to re-analyze
        chrome.tabs.sendMessage(tabId, { type: "RESCAN", forceRefresh: true }).catch(() => {});
      }
      sendResponse({ ok: true });
      break;
    }

    // Video analysis with 12Labs
    case "ANALYZE_VIDEO": {
      analyzeVideo(message.videoSrc, message.pageUrl).then((analysis) => {
        sendResponse({ analysis });
      }).catch((err) => {
        console.error("[TruthLens BG] Video analysis error:", err);
        sendResponse({ analysis: null, error: err.message });
      });
      return true;
    }

    // Text-to-speech with 11Labs
    case "TTS_REQUEST": {
      generateTTS(message.text).then((result) => {
        sendResponse(result);
      }).catch((err) => {
        console.error("[TruthLens BG] TTS error:", err);
        sendResponse({ audioUrl: null, error: err.message });
      });
      return true;
    }

    default:
      sendResponse({ error: "unknown message type" });
  }
});

// ---------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabContexts[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    delete tabContexts[tabId];
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const { truthlens_profile } = await chrome.storage.local.get("truthlens_profile");
  if (!truthlens_profile) {
    await chrome.storage.local.set({ truthlens_profile: DEFAULT_PROFILE });
    console.log("[TruthLens BG] Default profile initialized.");
  }
  
  // Initialize API config if not set
  const { truthlens_api } = await chrome.storage.local.get("truthlens_api");
  if (!truthlens_api) {
    await chrome.storage.local.set({ 
      truthlens_api: { 
        provider: CONFIG.api.defaultProvider, 
        apiKey: null 
      } 
    });
    console.log("[TruthLens BG] Default API config initialized.");
  }
});
