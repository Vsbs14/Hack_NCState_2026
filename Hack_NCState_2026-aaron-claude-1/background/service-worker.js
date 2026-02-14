/**
 * service-worker.js — TruthLens Background Service Worker
 *
 * Handles domain analysis, AI API calls, trust scoring, badge updates,
 * message routing, and re-scan without page refresh.
 */

import { TruthLensAPI } from "../utils/api.js";

const tabContexts = {};
const domainCache = {};

const DEFAULT_PROFILE = {
  impulseBuyer: { enabled: true, sensitivity: 2 },
  rageBaitShield: { enabled: true, sensitivity: 2 },
  slowReaderMode: { enabled: false, sensitivity: 1 },
  slopDetector: { enabled: true, sensitivity: 2 },
  hateSpeechFilter: { enabled: true, sensitivity: 2 },
  sensitiveImageGuard: { enabled: false, sensitivity: 1 },
  commentGuard: { enabled: true, sensitivity: 2 },
  adBlocker: { enabled: false, sensitivity: 1 },
};

// ---------------------------------------------------------------------------
// Domain Analysis Pipeline
// ---------------------------------------------------------------------------

async function analyzeDomain(url) {
  try {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname.replace(/^www\./, "");

    if (domainCache[domain] && Date.now() - domainCache[domain]._ts < 30 * 60 * 1000) {
      return domainCache[domain];
    }

    const { truthlens_apikeys } = await chrome.storage.local.get("truthlens_apikeys");
    const apiKeys = truthlens_apikeys || {};

    const [whois, safeBrowsing] = await Promise.all([
      TruthLensAPI.fetchWhois(domain),
      TruthLensAPI.checkSafeBrowsing(url, apiKeys.safeBrowsing || null),
    ]);

    const ssl = TruthLensAPI.checkSSL(url);

    const result = {
      domain,
      whois,
      ssl,
      safeBrowsing,
      analyzedAt: new Date().toISOString(),
      _ts: Date.now(),
    };

    domainCache[domain] = result;
    return result;
  } catch (e) {
    console.error("[TruthLens BG] Domain analysis error:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Full Analysis Pipeline (called on page context or re-scan)
// ---------------------------------------------------------------------------

async function runFullAnalysis(tabId, tabUrl, pageContext) {
  const { truthlens_apikeys } = await chrome.storage.local.get("truthlens_apikeys");
  const apiKeys = truthlens_apikeys || {};

  const domainAnalysis = await analyzeDomain(tabUrl);

  // AI content detection: support either or both providers
  let claudeResult = null;
  let geminiResult = null;
  let twelveLabsResult = null;

  if (apiKeys.claude && pageContext?._contentAnalysis?.mainTextSample) {
    claudeResult = await TruthLensAPI.analyzeWithClaude(
      pageContext._contentAnalysis.mainTextSample,
      apiKeys.claude
    );
  }

  if (apiKeys.gemini && pageContext?._pageData) {
    geminiResult = await TruthLensAPI.analyzeWithGemini(
      pageContext._pageData,
      apiKeys.gemini
    );
  }

  // If user provided Twelve Labs key and page has videos, run a video check (stubbed)
  try {
    if (apiKeys.twelvelabs && pageContext?._pageData?.videoUrls?.length) {
      twelveLabsResult = await TruthLensAPI.analyzeWithTwelveLabs(pageContext._pageData, apiKeys.twelvelabs);
    }
  } catch (e) { console.warn("[TruthLens BG] TwelveLabs check failed", e); }

  // Category: prefer Gemini, fall back to heuristic
  const category = geminiResult?.contentCategory
    || TruthLensAPI.categorizeContent(tabUrl, pageContext);

  // Trust score: null until real data
  const trustScore = TruthLensAPI.computeTrustScore({
    whois: domainAnalysis?.whois,
    safeBrowsing: domainAnalysis?.safeBrowsing,
    pageContext,
    geminiAnalysis: geminiResult,
  });

  const fullAnalysis = {
    pageContext,
    domainAnalysis,
    claudeResult,
    geminiResult,
    trustScore,
    category,
    url: tabUrl,
    analyzedAt: new Date().toISOString(),
    // Debug data for the debug panel
    _debug: {
      domainAge: domainAnalysis?.whois?.domainAge,
      domainCreated: domainAnalysis?.whois?.createdDate,
      registrar: domainAnalysis?.whois?.registrar,
      sslValid: domainAnalysis?.ssl?.valid,
      safeBrowsingSource: domainAnalysis?.safeBrowsing?.source,
      safeBrowsingThreats: domainAnalysis?.safeBrowsing?.threats,
      claudeSource: claudeResult?.source,
      claudeConfidence: claudeResult?.confidence,
      claudeIsAI: claudeResult?.isAI,
      claudeReasoning: claudeResult?.reasoning,
      geminiSource: geminiResult?.source,
      geminiPageType: geminiResult?.pageType,
      geminiConfidence: geminiResult?.confidence,
      geminiReasoning: geminiResult?.reasoning,
      geminiRiskSignals: geminiResult?.riskSignals,
      twelveLabsSource: twelveLabsResult?.source,
      twelveLabsDetails: twelveLabsResult?.details,
      heuristicPageType: pageContext?.pageType,
      heuristicConfidence: pageContext?.confidence,
      riskSignals: pageContext?.riskSignals,
      intentSignals: pageContext?.intentSignals,
      aiScore: pageContext?._contentAnalysis?.aiScore,
      toxicity: pageContext?._contentAnalysis?.toxicity,
      readability: pageContext?._contentAnalysis?.readability,
      scoreBreakdown: {
        base: 0,
        domainAgeAdj: domainAnalysis?.whois?.domainAge != null
          ? (domainAnalysis.whois.domainAge > 365 * 5 ? "+25" : domainAnalysis.whois.domainAge > 365 ? "+15" : domainAnalysis.whois.domainAge > 90 ? "+5" : "-20")
          : "n/a",
        safeBrowsingAdj: domainAnalysis?.safeBrowsing?.source === "google-safe-browsing"
          ? (domainAnalysis.safeBrowsing.safe ? "+10" : "-40")
          : "n/a",
        riskAdj: pageContext?.riskSignals?.length > 0 ? `-${pageContext.riskSignals.length * 5}` : "0",
        intentAdj: pageContext?.intentSignals?.length > 0 ? `+${Math.min(pageContext.intentSignals.length * 2, 10)}` : "0",
        final: trustScore,
      },
    },
  };

  tabContexts[tabId] = fullAnalysis;

  // Persist AI results and the analysis to local history so user's popup/profile can show last AI outputs
  try {
    const key = `truthlens_history`;
    const store = await chrome.storage.local.get(key);
    const hist = (store && store.truthlens_history) || [];
    // Keep small capped history — store latest per-URL with timestamp
    const entry = { url: tabUrl, analyzedAt: fullAnalysis.analyzedAt, analysis: fullAnalysis };
    hist.unshift(entry);
    // Deduplicate for same url (keep newest first)
    const seen = new Set();
    const dedup = [];
    for (const e of hist) {
      if (seen.has(e.url)) continue;
      seen.add(e.url);
      dedup.push(e);
      if (dedup.length >= 100) break;
    }
    await chrome.storage.local.set({ truthlens_history: dedup });
  } catch (e) {
    console.warn('[TruthLens BG] Failed to persist analysis', e);
  }

  const hasRisks = (pageContext?.riskSignals?.length > 0)
    || (domainAnalysis?.safeBrowsing && !domainAnalysis.safeBrowsing.safe)
    || (geminiResult?.riskSignals?.length > 0);

  updateBadge(tabId, trustScore, hasRisks);

  console.log(`[TruthLens BG] Tab ${tabId}: score=${trustScore}, type=${category}`);

  return fullAnalysis;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function updateBadge(tabId, trustScore, hasRisks) {
  let color, text;

  if (trustScore === null) {
    color = "#78716c";
    text = "...";
  } else if (trustScore >= 70) {
    color = "#10b981";
    text = "OK";
  } else if (trustScore >= 40) {
    color = "#f59e0b";
    text = "!";
  } else {
    color = "#ef4444";
    text = "X";
  }

  if (hasRisks) color = "#ef4444";

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
            claudeResult: analysis.claudeResult,
            geminiResult: analysis.geminiResult,
            category: analysis.category,
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

    // Re-scan: tell content script to re-analyze WITHOUT refreshing
    case "RESCAN": {
      const tabId = message.tabId;
      if (tabId) {
        // Clear cached analysis
        delete tabContexts[tabId];
        chrome.action.setBadgeText({ text: "...", tabId });
        chrome.action.setBadgeBackgroundColor({ color: "#78716c", tabId });

        chrome.tabs.sendMessage(tabId, { type: "RESCAN" }).catch(() => {});
      }
      sendResponse({ ok: true });
      break;
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
});
