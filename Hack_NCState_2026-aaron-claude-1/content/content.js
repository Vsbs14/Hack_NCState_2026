/**
 * content.js — TruthLens Content Script
 *
 * Page analysis + DOM interventions. AI detection delegates to Claude API
 * via the background worker. Supports re-scan without page refresh.
 */

(function () {
  "use strict";
  if (!location.protocol.startsWith("http")) return;

  // =========================================================================
  // ANALYSIS LAYER
  // =========================================================================

  const HATE_TERMS = [
    "kill yourself", "kys", "go die", "neck yourself",
  ];

  const RAGE_BAIT_PATTERNS = [
    /\byou won't believe\b/i, /\bshocking\b/i, /\boutrage\b/i,
    /\bdisgusting\b/i, /\binfuriating\b/i, /\bunacceptable\b/i,
    /\bslammed\b/i, /\bdestroyed\b/i, /\bblasted\b/i,
    /\bwake up\b/i, /\bsheeple\b/i, /\bopen your eyes\b/i,
    /\bthey don't want you to know\b/i, /\bthe truth about\b/i,
    /\bwhat they're not telling you\b/i,
    /\b(?:libs|conservatives|leftists|right-wingers)\s+(?:are|want)\b/i,
  ];

  function analyzeToxicity(text) {
    if (!text) return { hateSpeech: false, rageBait: false, inflammatory: false, signals: [] };
    const lower = text.toLowerCase();
    const signals = [];

    const hateHits = HATE_TERMS.filter((t) => lower.includes(t));
    const hateSpeech = hateHits.length > 0;
    if (hateSpeech) signals.push(`hate-speech(${hateHits.length})`);

    const rageHits = RAGE_BAIT_PATTERNS.filter((p) => p.test(text));
    const rageBait = rageHits.length >= 2;
    if (rageBait) signals.push(`rage-bait(${rageHits.length})`);

    let capsCount = (text.match(/[A-Z]{5,}/g) || []).length;
    let exclaimCount = (text.match(/!!+/g) || []).length;
    const inflammatory = capsCount > 3 || exclaimCount > 3;
    if (inflammatory) signals.push("inflammatory-formatting");

    return { hateSpeech, rageBait, inflammatory, signals };
  }

  function computeReadability(text) {
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const words = text.match(/\b\w+\b/g) || [];
    if (sentences.length === 0 || words.length === 0) return { score: 0, grade: 0, readTime: 0, wordCount: 0 };

    const syllables = words.reduce((total, w) => {
      let word = w.toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
      const m = word.match(/[aeiouy]{1,2}/g);
      return total + (m ? m.length : 1);
    }, 0);

    const avgWPS = words.length / sentences.length;
    const avgSPW = syllables / words.length;
    const score = 206.835 - 1.015 * avgWPS - 84.6 * avgSPW;
    const grade = 0.39 * avgWPS + 11.8 * avgSPW - 15.59;

    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      grade: Math.max(0, Math.round(grade * 10) / 10),
      readTime: Math.ceil(words.length / 200),
      wordCount: words.length,
    };
  }

  function extractMainText() {
    const selectors = ["article", "main", "[role='main']", ".post-content", ".entry-content", ".article-body"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.length > 200) return el.innerText;
    }

    // Fallbacks for dynamic single-page apps (YouTube, etc.) — use meta description + title + some visible nodes
    const parts = [];
    const metaDesc = document.querySelector('meta[name="description"]')?.content;
    if (metaDesc) parts.push(metaDesc);
    if (document.title) parts.push(document.title);

    // Collect first few paragraph-like nodes with meaningful text
    const candidates = Array.from(document.querySelectorAll('p, div, span'));
    for (const node of candidates) {
      const txt = (node.innerText || '').trim();
      if (txt.length > 50) {
        parts.push(txt);
      }
      if (parts.join(' ').length > 800) break;
    }

    const joined = parts.join('\n\n').trim();
    if (joined.length > 0) return joined;
    return document.body?.innerText ?? "";
  }

  /** Collect page metadata for Gemini analysis */
  function collectPageData() {
    return {
      url: location.href,
      title: document.title,
      metaDescription: document.querySelector('meta[name="description"]')?.content || "",
      visibleText: extractMainText().substring(0, 1500),
      linkCount: document.querySelectorAll("a").length,
      imageCount: document.querySelectorAll("img").length,
      videoCount: document.querySelectorAll("video, iframe[src*='youtube.com'], iframe[src*='vimeo.com']").length,
      videoUrls: Array.from(document.querySelectorAll("video")).map(v => v.currentSrc || v.src).filter(Boolean).slice(0,5),
      formCount: document.querySelectorAll("form").length,
      hasArticleTag: !!document.querySelector("article"),
      hasComments: !!document.querySelector(".comment, .comments, [class*='comment'], textarea[name*='comment']"),
    };
  }

  // =========================================================================
  // DOM INTERVENTION LAYER
  // =========================================================================

  let currentProfile = null;
  let activeWarning = null;
  let commentGuardActive = false;

  async function loadProfile() {
    try {
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_PROFILE" }, resolve);
      });
      currentProfile = result?.profile ?? null;
    } catch {
      currentProfile = null;
    }
    return currentProfile;
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    children.forEach((c) => {
      if (typeof c === "string") el.appendChild(document.createTextNode(c));
      else if (c) el.appendChild(c);
    });
    return el;
  }

  // --- TOP-OF-PAGE BANNER ---
  function showBanner(trustScore, concerns) {
    if (document.querySelector(".tl-banner")) return;

    let scoreClass = "safe";
    let scoreText = trustScore !== null ? String(trustScore) : "?";
    if (trustScore === null) scoreClass = "unknown";
    else if (trustScore < 40) scoreClass = "danger";
    else if (trustScore < 70) scoreClass = "caution";

    const messages = {
      safe: "This site looks safe",
      caution: "Proceed with caution",
      danger: "Warning — potential risks detected",
      unknown: "Analyzing site...",
    };

    const banner = h("div", { class: "tl-banner" },
      h("div", { class: `tl-banner-score ${scoreClass}` }, scoreText),
      h("div", { class: "tl-banner-text" },
        h("strong", null, `TruthLens: ${messages[scoreClass]}`),
        concerns.length > 0 ? h("div", { class: "tl-banner-concerns" }, concerns.join(" · ")) : null
      ),
      h("button", {
        class: "tl-banner-close",
        onclick: (e) => {
          const b = e.target.closest(".tl-banner");
          b.style.animation = "none";
          b.style.transform = "translateY(-100%)";
          b.style.transition = "transform 0.3s ease";
          setTimeout(() => b?.remove(), 300);
        }
      }, "\u00D7")
    );

    document.body.prepend(banner);
  }

  // --- IMPULSE BUY SHIELD ---
  function applyImpulseBuyShield(sensitivity) {
    const buyPatterns = [
      /buy\s*now/i, /add\s*to\s*cart/i, /add\s*to\s*bag/i,
      /purchase/i, /order\s*now/i, /checkout/i, /subscribe\s*now/i,
      /get\s*it\s*now/i, /shop\s*now/i,
    ];

    const durations = { 1: 5, 2: 10, 3: 15 };
    const duration = durations[sensitivity] || 10;

    const buttons = document.querySelectorAll("button, a[role='button'], input[type='submit'], [class*='btn'], [class*='button']");
    buttons.forEach((btn) => {
      const text = btn.textContent || btn.value || "";
      if (!buyPatterns.some((p) => p.test(text))) return;
      if (btn.dataset.tlShielded) return;
      btn.dataset.tlShielded = "true";

      const wrapper = document.createElement("div");
      wrapper.className = "tl-impulse-overlay";
      wrapper.style.display = getComputedStyle(btn).display === "inline" ? "inline-block" : "block";
      btn.parentNode.insertBefore(wrapper, btn);
      wrapper.appendChild(btn);

      const circumference = 2 * Math.PI * 22;

      const shield = document.createElement("div");
      shield.className = "tl-impulse-shield";
      shield.innerHTML = `
        <div class="tl-shield-icon">🛡</div>
        <div class="tl-shield-text"><strong>TruthLens</strong><br>Take a breath. Do you really need this?</div>
        <div class="tl-impulse-timer">
          <svg viewBox="0 0 48 48">
            <circle class="timer-bg" cx="24" cy="24" r="22"/>
            <circle class="timer-fill" cx="24" cy="24" r="22"
              style="stroke-dasharray:${circumference};stroke-dashoffset:0"/>
          </svg>
          <div class="timer-text">${duration}</div>
        </div>
        <button class="tl-skip-btn">I'm sure — skip</button>
      `;

      wrapper.appendChild(shield);

      let remaining = duration;
      const timerFill = shield.querySelector(".timer-fill");
      const timerText = shield.querySelector(".timer-text");

      const interval = setInterval(() => {
        remaining--;
        timerText.textContent = remaining;
        timerFill.style.strokeDashoffset = circumference * (1 - remaining / duration);
        if (remaining <= 0) {
          clearInterval(interval);
          shield.style.opacity = "0";
          shield.style.transition = "opacity 0.3s ease";
          setTimeout(() => shield.remove(), 300);
        }
      }, 1000);

      shield.querySelector(".tl-skip-btn").addEventListener("click", () => {
        clearInterval(interval);
        shield.style.opacity = "0";
        shield.style.transition = "opacity 0.2s ease";
        setTimeout(() => shield.remove(), 200);
      });
    });
  }

  // --- RAGE BAIT / HATE SPEECH BLUR ---
  function applyRageBaitShield(toxicityResult, sensitivity) {
    if (!toxicityResult.rageBait && !toxicityResult.hateSpeech && !toxicityResult.inflammatory) return;
    // Blur headlines and also inline paragraphs/blocks that show inflammatory signals
    const targets = Array.from(document.querySelectorAll("h1, h2, h3, [class*='title'], [class*='headline'], p, li, blockquote, .comment, .comment p"));
    targets.forEach((el) => {
      if (!el || !el.textContent || el.dataset.tlBlurred) return;
      const localTox = analyzeToxicity(el.textContent);
      const shouldBlur = (sensitivity >= 3 && (localTox.rageBait || localTox.inflammatory))
        || (sensitivity >= 2 && localTox.rageBait)
        || localTox.hateSpeech;
      if (!shouldBlur) return;

      el.dataset.tlBlurred = "true";
      el.classList.add("tl-blurred");
      el.style.position = "relative";

      const label = h("div", { class: "tl-blur-label" },
        localTox.hateSpeech ? "Hate speech detected" : "Flagged as rage bait"
      );
      el.appendChild(label);
      el.addEventListener("click", () => {
        el.classList.toggle("tl-revealed");
        label.style.display = el.classList.contains("tl-revealed") ? "none" : "block";
      });
    });
  }

  function applyHateSpeechFilter() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (node.parentElement?.closest(".tl-banner, .tl-impulse-shield, .tl-comment-warning")) return NodeFilter.FILTER_REJECT;
        return node.textContent.trim().length > 20 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((node) => {
      const text = node.textContent;
      HATE_TERMS.forEach((term) => {
        if (text.toLowerCase().includes(term)) {
          const parent = node.parentElement;
          if (parent && !parent.dataset.tlBlurred) {
            parent.dataset.tlBlurred = "true";
            parent.classList.add("tl-blurred");
            parent.style.position = "relative";
            const label = h("div", { class: "tl-blur-label" }, "Content hidden");
            parent.appendChild(label);
            parent.addEventListener("click", () => {
              parent.classList.toggle("tl-revealed");
              label.style.display = parent.classList.contains("tl-revealed") ? "none" : "block";
            });
          }
        }
      });
    });
  }

  // --- COMMENT GUARD ---
  function applyCommentGuard(sensitivity) {
    if (commentGuardActive) return;
    commentGuardActive = true;

    function monitorInput(el) {
      if (el.dataset.tlGuarded) return;
      el.dataset.tlGuarded = "true";
      let timer = null;

      el.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const text = el.value || el.textContent || "";
          if (text.length < 10) return;
          const tox = analyzeToxicity(text);
          const shouldWarn = (sensitivity >= 3 && (tox.rageBait || tox.inflammatory))
            || (sensitivity >= 2 && (tox.hateSpeech || tox.rageBait))
            || tox.hateSpeech;
          if (shouldWarn && !document.querySelector(".tl-comment-warning")) showCommentWarning(tox);
        }, 500);
      });
    }

    ["textarea", "div[contenteditable='true']", "input[type='text']"].forEach((sel) => {
      document.querySelectorAll(sel).forEach(monitorInput);
    });

    new MutationObserver((mutations) => {
      mutations.forEach((m) => m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        ["textarea", "div[contenteditable='true']", "input[type='text']"].forEach((sel) => {
          if (node.matches?.(sel)) monitorInput(node);
          node.querySelectorAll?.(sel)?.forEach(monitorInput);
        });
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  function showCommentWarning(toxicity) {
    if (activeWarning) activeWarning.remove();
    const warning = h("div", { class: "tl-comment-warning" },
      h("span", { class: "tl-cw-icon" }, "💬"),
      h("div", { class: "tl-cw-text" },
        h("strong", null, "TruthLens: Pause before posting"),
        document.createTextNode(
          toxicity.hateSpeech
            ? "Your comment may contain hurtful language. Take a moment to reconsider."
            : "Your comment seems heated. Would you like to rephrase?"
        )
      ),
      h("button", {
        class: "tl-cw-dismiss",
        onclick: () => {
          warning.style.transform = "translateY(100%)";
          warning.style.transition = "transform 0.3s ease";
          setTimeout(() => { warning.remove(); activeWarning = null; }, 300);
        }
      }, "Dismiss")
    );
    document.body.appendChild(warning);
    activeWarning = warning;
    setTimeout(() => {
      if (activeWarning === warning) {
        warning.style.transform = "translateY(100%)";
        warning.style.transition = "transform 0.3s ease";
        setTimeout(() => { warning.remove(); activeWarning = null; }, 300);
      }
    }, 8000);
  }

  // --- SENSITIVE IMAGE GUARD ---
  function applySensitiveImageGuard(sensitivity) {
    const patterns = [/gore/i, /blood/i, /nsfw/i, /graphic/i, /disturbing/i, /violence/i, /death/i, /murder/i, /accident/i, /shooting/i, /attack/i, /victim/i];

    document.querySelectorAll("img[src], picture img").forEach((img) => {
      if (img.dataset.tlChecked) return;
      img.dataset.tlChecked = "true";

      const context = [img.alt, img.title, img.closest("figure")?.textContent, img.parentElement?.textContent?.substring(0, 200)].filter(Boolean).join(" ");
      const hits = patterns.filter((p) => p.test(context));
      if ((sensitivity >= 3 && hits.length >= 1) || (sensitivity >= 2 && hits.length >= 2) || hits.length >= 3) {
        img.classList.add("tl-image-blurred");
        if (img.parentElement && getComputedStyle(img.parentElement).position === "static") img.parentElement.style.position = "relative";
        const overlay = h("div", { class: "tl-image-overlay" }, h("span", { class: "tl-io-icon" }, "👁"), h("span", { class: "tl-io-text" }, "Click to reveal"));
        overlay.addEventListener("click", () => { img.classList.toggle("tl-revealed"); overlay.style.display = img.classList.contains("tl-revealed") ? "none" : "flex"; });
        img.parentElement.appendChild(overlay);
      }
    });
  }

  function applySlowReaderMode(readability, sensitivity) {
    if (document.querySelector(".tl-read-time")) return;
    const thresholds = { 1: 15, 2: 8, 3: 4 };
    if (readability.readTime >= (thresholds[sensitivity] || 8)) {
      document.body.appendChild(h("div", { class: "tl-read-time" },
        h("span", { class: "tl-rt-icon" }, "⏱"),
        document.createTextNode("~"),
        h("span", { class: "tl-rt-value" }, `${readability.readTime} min`),
        document.createTextNode(" read")
      ));
    }
  }

  function applySlopDetector(aiResult, sensitivity) {
    const thresholds = { 1: 0.7, 2: 0.5, 3: 0.3 };
    const threshold = thresholds[sensitivity] || 0.5;

    // Use Claude result if available, else fall back to local score
    const score = aiResult?.claudeConfidence ?? aiResult?.score ?? 0;
    const isAI = aiResult?.claudeIsAI ?? (score >= threshold);

    if (!isAI && score < threshold) return;

    const heading = document.querySelector("h1, h2, article h1, article h2, [class*='title']");
    if (heading && !heading.querySelector(".tl-ai-badge")) {
      const confidence = Math.round(score * 100);
      const source = aiResult?.claudeIsAI !== undefined ? "Claude" : "heuristic";
      heading.appendChild(h("span", {
        class: "tl-ai-badge",
        title: `AI confidence: ${confidence}% (${source})${aiResult?.claudeReasoning ? " — " + aiResult.claudeReasoning : ""}`,
      }, "🤖 AI Detected"));
    }
  }

  // --- AD BLOCKER (lightweight) ---
  let _adObserver = null;
  function applyAdBlocker(sensitivity) {
    const selectorsBySensitivity = {
      1: ['.ad', '.ads', '[id^="ad-"]', '[class*="-ad"]', '.sponsored', '[data-ad]'],
      2: ['.ad', '.ads', '[id^="ad-"]', '[class*="-ad"]', '.sponsored', '[data-ad]', 'iframe[src*="doubleclick.net"]', 'iframe[src*="ads"]', '.advertisement', '.ad-container'],
      3: ['.ad', '.ads', '[id^="ad-"]', '[class*="-ad"]', '.sponsored', '[data-ad]', 'iframe[src*="doubleclick.net"]', 'iframe[src*="ads"]', '.advertisement', '.ad-container', '[class*="sponsored"]', '[data-sponsored]']
    };

    const selectors = selectorsBySensitivity[sensitivity] || selectorsBySensitivity[2];

    function removeMatches(root=document) {
      try {
        selectors.forEach((sel) => {
          const els = root.querySelectorAll?.(sel) || [];
          els.forEach((el) => {
            try { el.remove(); } catch { el.style && (el.style.display = 'none'); }
          });
        });
      } catch (e) { /* ignore */ }
    }

    // Initial pass
    removeMatches(document);

    // Observe for new nodes and remove ad-like elements
    if (_adObserver) _adObserver.disconnect();
    _adObserver = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          removeMatches(node);
        });
      });
    });
    _adObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  // =========================================================================
  // MAIN PIPELINE
  // =========================================================================

  async function run() {
    const pageContext = resolvePageContext();

    const mainText = extractMainText();
    const toxicity = analyzeToxicity(mainText);
    const readability = computeReadability(mainText);
    const pageData = collectPageData();

    // Attach data for background to use with APIs
    pageContext._contentAnalysis = {
      mainTextSample: mainText.substring(0, 2000),
      aiScore: 0,
      aiSignals: [],
      toxicity: toxicity.signals,
      readability,
    };
    pageContext._pageData = pageData;

    console.group(
      "%c[TruthLens]%c Page Analysis",
      "background:#1a1a2e;color:#c8a96e;padding:2px 6px;border-radius:3px;font-family:Georgia",
      "color:#c8a96e;font-weight:bold;font-family:Georgia"
    );
    console.log("Page Type  :", pageContext.pageType);
    console.log("Confidence :", pageContext.confidence);
    console.log("Toxicity   :", toxicity);
    console.log("Readability:", readability);
    console.log("Risks      :", pageContext.riskSignals);
    console.groupEnd();

    chrome.runtime.sendMessage({ type: "PAGE_CONTEXT_RESOLVED", payload: pageContext }, () => {
      if (chrome.runtime.lastError) console.debug("[TruthLens] Background not ready:", chrome.runtime.lastError.message);
    });

    const profile = await loadProfile();
    if (!profile) return;

    applyInterventions(profile, toxicity, readability, {});
  }

  function applyInterventions(profile, toxicity, readability, aiData) {
    if (profile.impulseBuyer?.enabled) applyImpulseBuyShield(profile.impulseBuyer.sensitivity);
    if (profile.rageBaitShield?.enabled) applyRageBaitShield(toxicity, profile.rageBaitShield.sensitivity);
    if (profile.hateSpeechFilter?.enabled) applyHateSpeechFilter();
    if (profile.commentGuard?.enabled) applyCommentGuard(profile.commentGuard.sensitivity);
    if (profile.sensitiveImageGuard?.enabled) applySensitiveImageGuard(profile.sensitiveImageGuard.sensitivity);
    if (profile.slowReaderMode?.enabled) applySlowReaderMode(readability, profile.slowReaderMode.sensitivity);
    if (profile.slopDetector?.enabled) applySlopDetector(aiData, profile.slopDetector.sensitivity);
    if (profile.adBlocker?.enabled) applyAdBlocker(profile.adBlocker.sensitivity);

    if (toxicity.hateSpeech || toxicity.rageBait || (readability.wordCount > 0 && toxicity.inflammatory)) {
      const concerns = [
        ...(toxicity.hateSpeech ? ["Hate speech detected"] : []),
        ...(toxicity.rageBait ? ["Rage bait detected"] : []),
        ...(toxicity.inflammatory ? ["Inflammatory content"] : []),
      ];
      showBanner(null, concerns);
    }
  }

  // --- Message listeners ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ANALYSIS_COMPLETE" && msg.analysis) {
      // Update banner with real trust score
      const existingBanner = document.querySelector(".tl-banner");
      if (existingBanner) {
        const scoreEl = existingBanner.querySelector(".tl-banner-score");
        if (scoreEl && msg.analysis.trustScore !== null) {
          scoreEl.textContent = msg.analysis.trustScore;
          scoreEl.className = "tl-banner-score " + (msg.analysis.trustScore >= 70 ? "safe" : msg.analysis.trustScore >= 40 ? "caution" : "danger");
        }
      }

      // Apply AI-based slop detection with Claude results
      if (msg.analysis.claudeResult && currentProfile?.slopDetector?.enabled) {
        applySlopDetector({
          claudeIsAI: msg.analysis.claudeResult.isAI,
          claudeConfidence: msg.analysis.claudeResult.confidence,
          claudeReasoning: msg.analysis.claudeResult.reasoning,
        }, currentProfile.slopDetector.sensitivity);
      }
    }

    if (msg.type === "REAPPLY_PROTECTIONS" && msg.profile) {
      currentProfile = msg.profile;
      const mainText = extractMainText();
      const toxicity = analyzeToxicity(mainText);
      const readability = computeReadability(mainText);
      applyInterventions(currentProfile, toxicity, readability, {});
    }

    if (msg.type === "RESCAN") {
      // Re-run the full pipeline without page refresh
      run();
    }
  });

  run();
})();
