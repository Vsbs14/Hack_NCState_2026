/**
 * heuristics.js — Deterministic Detection Logic
 *
 * Pure functions that inspect the URL + DOM and return signals.
 * No network calls, no AI — just pattern matching.
 *
 * Each detector returns { intentSignals: string[], riskSignals: string[] }
 * The resolver aggregates these to determine pageType and confidence.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Case-insensitive check for text anywhere in the visible page body. */
function bodyContains(text) {
  return document.body?.innerText?.toLowerCase().includes(text.toLowerCase());
}

/** Count how many of the given keywords appear in the page body. */
function countKeywords(keywords) {
  return keywords.filter((kw) => bodyContains(kw)).length;
}

/** Check if any element matching a CSS selector exists. */
function domHas(selector) {
  return document.querySelector(selector) !== null;
}

/** Count elements matching a CSS selector. */
function domCount(selector) {
  return document.querySelectorAll(selector).length;
}

// ---------------------------------------------------------------------------
// URL-based detection
// ---------------------------------------------------------------------------

/**
 * Fast first-pass: match the hostname/path against known patterns.
 * Returns a Set of candidate page types.
 */
function detectFromURL(url) {
  const signals = [];
  const hostname = url.hostname;
  const path = url.pathname + url.search;

  // Shopping sites
  const shoppingSites = [
    "amazon", "ebay", "walmart", "etsy", "shopify", "bestbuy",
    "target", "aliexpress", "wish", "temu",
  ];
  if (shoppingSites.some((s) => hostname.includes(s))) {
    signals.push("url:known-shopping-domain");
  }
  if (/\/(cart|checkout|shop|product|buy|deal)/i.test(path)) {
    signals.push("url:shopping-path");
  }

  // Payment
  if (/\/(pay|checkout|billing|subscribe|donate)/i.test(path)) {
    signals.push("url:payment-path");
  }
  if (["stripe.com", "paypal.com", "square.com"].some((d) => hostname.includes(d))) {
    signals.push("url:payment-domain");
  }

  // News
  const newsSites = [
    "cnn.com", "bbc.com", "reuters.com", "nytimes.com", "foxnews.com",
    "theguardian.com", "apnews.com", "washingtonpost.com",
  ];
  if (newsSites.some((s) => hostname.includes(s))) {
    signals.push("url:known-news-domain");
  }
  if (/\/(article|story|opinion|editorial|breaking)/i.test(path)) {
    signals.push("url:news-path");
  }

  // Social media
  const socialSites = [
    "facebook.com", "twitter.com", "x.com", "instagram.com",
    "tiktok.com", "reddit.com", "linkedin.com", "threads.net",
  ];
  if (socialSites.some((s) => hostname.includes(s))) {
    signals.push("url:known-social-domain");
  }

  // Forums
  const forumSites = ["reddit.com", "stackoverflow.com", "quora.com"];
  if (forumSites.some((s) => hostname.includes(s))) {
    signals.push("url:known-forum-domain");
  }
  if (/\/(forum|thread|discussion|topic|community)/i.test(path)) {
    signals.push("url:forum-path");
  }

  return signals;
}

// ---------------------------------------------------------------------------
// DOM-based detection
// ---------------------------------------------------------------------------

function detectShopping() {
  const intent = [];
  const risk = [];

  // Currency symbols in text (strong shopping signal)
  const pricePattern = /[\$\u20AC\u00A3]\s?\d+[\.,]?\d{0,2}/; // $, EUR, GBP
  if (pricePattern.test(document.body?.innerText ?? "")) {
    intent.push("dom:currency-symbols-present");
  }

  // "Add to cart" / "Buy now" buttons
  const buyKeywords = ["add to cart", "buy now", "add to bag", "purchase"];
  const matchedBuy = countKeywords(buyKeywords);
  if (matchedBuy > 0) {
    intent.push("dom:buy-buttons (" + matchedBuy + " matched)");
  }

  // Product-page patterns: quantity selectors, size pickers
  if (domHas("select[name*='quantity'], input[name*='qty']")) {
    intent.push("dom:quantity-selector");
  }

  // Risk: urgency language (impulse-buy pressure)
  const urgencyPhrases = [
    "limited time", "act now", "only \\d+ left", "hurry",
    "deal ends", "flash sale", "today only", "don't miss",
    "selling fast", "almost gone",
  ];
  const urgencyHits = urgencyPhrases.filter((p) =>
    new RegExp(p, "i").test(document.body?.innerText ?? "")
  );
  if (urgencyHits.length > 0) {
    risk.push("risk:urgency-language (" + urgencyHits.length + " phrases)");
  }

  return { intent, risk };
}

function detectPayment() {
  const intent = [];
  const risk = [];

  // Credit card input fields
  const ccSelectors = [
    "input[name*='card']", "input[name*='cc-']", "input[autocomplete*='cc-']",
    "input[name*='credit']", "input[placeholder*='card number']",
  ];
  if (ccSelectors.some((s) => domHas(s))) {
    intent.push("dom:credit-card-fields");
  }

  // Stripe or PayPal iframes
  if (domHas("iframe[src*='stripe.com'], iframe[src*='paypal.com']")) {
    intent.push("dom:payment-processor-embed");
  }

  // Generic payment forms
  if (domHas("form[action*='pay'], form[action*='checkout']")) {
    intent.push("dom:payment-form");
  }

  // Risk: unsecured form action (http://)
  const forms = document.querySelectorAll("form[action]");
  forms.forEach((f) => {
    if (f.action.startsWith("http://")) {
      risk.push("risk:insecure-form-action");
    }
  });

  return { intent, risk };
}

function detectNews() {
  const intent = [];

  // Article semantic tags
  if (domHas("article") || domHas("[itemtype*='Article']")) {
    intent.push("dom:article-tag");
  }

  // Byline / dateline
  if (domHas(".byline, .author, [rel='author'], time[datetime]")) {
    intent.push("dom:byline-or-dateline");
  }

  // High text-to-link ratio (articles have long prose, low link density)
  const textLen = (document.body?.innerText ?? "").length;
  const linkCount = domCount("a");
  if (textLen > 3000 && linkCount > 0 && textLen / linkCount > 200) {
    intent.push("dom:high-text-to-link-ratio");
  }

  return { intent, risk: [] };
}

function detectSocial() {
  const intent = [];

  // Feed-like structures (many repeated card elements)
  const feedSelectors = [
    "[role='feed']", ".feed", ".timeline",
    "[data-testid='tweet']", "[data-testid='post']",
  ];
  if (feedSelectors.some((s) => domHas(s))) {
    intent.push("dom:feed-structure");
  }

  // Like/share/retweet buttons
  const socialKeywords = ["like", "share", "retweet", "repost", "upvote"];
  if (countKeywords(socialKeywords) >= 2) {
    intent.push("dom:social-action-buttons");
  }

  return { intent, risk: [] };
}

function detectForum() {
  const intent = [];

  // Comment / reply boxes
  if (domHas("textarea[name*='comment'], textarea[name*='reply'], .comment-box")) {
    intent.push("dom:comment-reply-box");
  }

  // Thread-like structure
  if (domCount(".comment, .reply, [data-testid='comment']") > 3) {
    intent.push("dom:threaded-comments");
  }

  return { intent, risk: [] };
}

// ---------------------------------------------------------------------------
// General risk signals (apply to any page type)
// ---------------------------------------------------------------------------

function detectGeneralRisks() {
  const risk = [];

  // Excessive popups / modals
  if (domCount("[role='dialog'], .modal, .popup, [class*='overlay']") > 2) {
    risk.push("risk:excessive-popups");
  }

  // Fake countdown timers
  if (domHas(".countdown, .timer, [class*='countdown']")) {
    risk.push("risk:countdown-timer");
  }

  // External form actions pointing to a different origin
  const currentOrigin = location.origin;
  document.querySelectorAll("form[action]").forEach((f) => {
    try {
      const actionOrigin = new URL(f.action, location.href).origin;
      if (actionOrigin !== currentOrigin && !f.action.startsWith("javascript")) {
        risk.push("risk:cross-origin-form (" + actionOrigin + ")");
      }
    } catch { /* malformed URL, ignore */ }
  });

  // Mock domain-age check: flag if the domain looks suspiciously random
  // (Real implementation would call a WHOIS API — stubbed here for hackathon)
  const hostname = location.hostname.replace("www.", "");
  if (/^[a-z0-9]{15,}\.(com|net|org|xyz|top|info)$/.test(hostname)) {
    risk.push("risk:suspicious-domain-name (possible typosquat)");
  }

  return risk;
}
