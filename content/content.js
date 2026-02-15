/**
 * content.js — TruthLens Content Script
 *
 * Page analysis + DOM interventions. Uses centralized config for all settings.
 * Supports inflammatory section highlighting and re-scan without page refresh.
 */

(function () {
  "use strict";
  if (!location.protocol.startsWith("http")) return;

  // =========================================================================
  // CONFIG (inline for content script - can't import ES modules)
  // =========================================================================
  
  const CONFIG = {
    features: {
      impulseBuyShield: {
        delaySeconds: { 1: 5, 2: 10, 3: 15 },
        triggerPatterns: [
          "buy now", "add to cart", "add to bag", "purchase",
          "order now", "checkout", "subscribe now", "get it now", "shop now",
        ],
      },
      rageBaitShield: {
        blurThreshold: { 1: 0.8, 2: 0.6, 3: 0.4 },
        localPatterns: [
          /\byou won't believe\b/i, /\bshocking\b/i, /\boutrage\b/i,
          /\bdisgusting\b/i, /\binfuriating\b/i, /\bunacceptable\b/i,
          /\bslammed\b/i, /\bdestroyed\b/i, /\bblasted\b/i,
          /\bwake up\b/i, /\bsheeple\b/i, /\bopen your eyes\b/i,
          /\bthey don't want you to know\b/i, /\bthe truth about\b/i,
        ],
      },
      hateSpeechFilter: {
        displayMode: "blur",
        localTerms: ["kill yourself", "kys", "go die", "neck yourself"],
      },
      slopDetector: {
        confidenceThreshold: { 1: 0.7, 2: 0.5, 3: 0.3 },
        badgeText: "🤖 AI Detected",
      },
      inflammatoryHighlight: {
        displayMode: "blur",
      },
    },
    ui: {
      fontSize: { base: "16px", large: "18px", xlarge: "22px" },
    },
  };

  // =========================================================================
  // ANALYSIS LAYER
  // =========================================================================

  function analyzeToxicity(text) {
    if (!text) return { hateSpeech: false, rageBait: false, inflammatory: false, signals: [] };
    const lower = text.toLowerCase();
    const signals = [];

    const hateHits = CONFIG.features.hateSpeechFilter.localTerms.filter((t) => lower.includes(t));
    const hateSpeech = hateHits.length > 0;
    if (hateSpeech) signals.push(`hate-speech(${hateHits.length})`);

    const rageHits = CONFIG.features.rageBaitShield.localPatterns.filter((p) => p.test(text));
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
      if (el && el.innerText.length > 200) return el.innerText;
    }
    return document.body?.innerText ?? "";
  }

  function collectPageData() {
    return {
      url: location.href,
      title: document.title,
      metaDescription: document.querySelector('meta[name="description"]')?.content || "",
      visibleText: extractMainText().substring(0, 3000),
      linkCount: document.querySelectorAll("a").length,
      imageCount: document.querySelectorAll("img").length,
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
  let currentAnalysis = null;

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
  function showBanner(trustScore, concerns, summary) {
    // Remove existing banner
    document.querySelector(".tl-banner")?.remove();

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
        summary ? h("div", { class: "tl-banner-summary" }, summary) : null,
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
      }, "×")
    );

    document.body.prepend(banner);
  }

  // --- IMPULSE BUY SHIELD ---
  function applyImpulseBuyShield(sensitivity) {
    const buyPatterns = CONFIG.features.impulseBuyShield.triggerPatterns.map(
      (p) => new RegExp(p.replace(/\s+/g, "\\s*"), "i")
    );
    const duration = CONFIG.features.impulseBuyShield.delaySeconds[sensitivity] || 10;

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

  // --- INFLAMMATORY SECTION HIGHLIGHTING (NEW) ---
  function applyInflammatorySectionHighlight(inflammatorySections, displayMode = "blur") {
    if (!inflammatorySections || inflammatorySections.length === 0) return;

    const bodyText = document.body.innerText;
    
    inflammatorySections.forEach((section) => {
      const searchText = section.text;
      if (!searchText || searchText.length < 10) return;

      // Find text nodes containing this text
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (node.parentElement?.closest(".tl-banner, .tl-impulse-shield, .tl-comment-warning")) {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.textContent.includes(searchText.substring(0, 30))) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      });

      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);

      nodes.forEach((node) => {
        const parent = node.parentElement;
        if (!parent || parent.dataset.tlInflammatory) return;

        parent.dataset.tlInflammatory = "true";
        
        // Apply display mode
        switch (displayMode) {
          case "blur":
            parent.classList.add("tl-inflammatory-blur");
            break;
          case "highlight":
            parent.classList.add("tl-inflammatory-highlight");
            break;
          case "hide":
            parent.classList.add("tl-inflammatory-hide");
            break;
        }

        // Add reveal functionality for blur mode
        if (displayMode === "blur") {
          const label = h("div", { class: "tl-blur-label" }, 
            section.reason || "Inflammatory content"
          );
          parent.style.position = "relative";
          parent.appendChild(label);
          
          parent.addEventListener("click", () => {
            parent.classList.toggle("tl-revealed");
            label.style.display = parent.classList.contains("tl-revealed") ? "none" : "block";
          });
        }
      });
    });
  }

  // --- RAGE BAIT / HATE SPEECH BLUR ---
  function applyRageBaitShield(toxicityResult, sensitivity, llmToxicity = null) {
    // Use LLM toxicity data if available
    const rageBaitConfidence = llmToxicity?.rageBaitConfidence || 0;
    const threshold = CONFIG.features.rageBaitShield.blurThreshold[sensitivity] || 0.6;
    
    const shouldBlurFromLLM = llmToxicity?.rageBait && rageBaitConfidence >= threshold;
    const shouldBlurFromLocal = toxicityResult.rageBait || toxicityResult.hateSpeech;
    
    if (!shouldBlurFromLLM && !shouldBlurFromLocal && !toxicityResult.inflammatory) return;

    const headlines = document.querySelectorAll("h1, h2, h3, [class*='title'], [class*='headline']");
    headlines.forEach((el) => {
      const localTox = analyzeToxicity(el.textContent);
      const shouldBlur = (sensitivity >= 3 && (localTox.rageBait || localTox.inflammatory))
        || (sensitivity >= 2 && localTox.rageBait)
        || localTox.hateSpeech
        || shouldBlurFromLLM;
      if (!shouldBlur || el.dataset.tlBlurred) return;

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

  function applyHateSpeechFilter(llmToxicity = null) {
    const displayMode = CONFIG.features.hateSpeechFilter.displayMode;
    
    // If LLM detected hate speech examples, highlight them
    if (llmToxicity?.hateSpeechExamples?.length > 0) {
      applyInflammatorySectionHighlight(
        llmToxicity.hateSpeechExamples.map((text) => ({ text, reason: "Hate speech detected" })),
        displayMode
      );
    }

    // Also apply local detection
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
      CONFIG.features.hateSpeechFilter.localTerms.forEach((term) => {
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
    const hitsRequired = { 1: 3, 2: 2, 3: 1 };

    document.querySelectorAll("img[src], picture img").forEach((img) => {
      if (img.dataset.tlChecked) return;
      img.dataset.tlChecked = "true";

      const context = [img.alt, img.title, img.closest("figure")?.textContent, img.parentElement?.textContent?.substring(0, 200)].filter(Boolean).join(" ");
      const hits = patterns.filter((p) => p.test(context));
      if (hits.length >= (hitsRequired[sensitivity] || 2)) {
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

  function applySlopDetector(aiData, sensitivity) {
    const threshold = CONFIG.features.slopDetector.confidenceThreshold[sensitivity] || 0.5;

    // Use LLM result
    const aiContent = aiData?.aiContent;
    const isAI = aiContent?.detected;
    const confidence = aiContent?.confidence || 0;

    if (!isAI && confidence < threshold) return;

    const heading = document.querySelector("h1, h2, article h1, article h2, [class*='title']");
    if (heading && !heading.querySelector(".tl-ai-badge")) {
      const confidencePercent = Math.round(confidence * 100);
      heading.appendChild(h("span", {
        class: "tl-ai-badge",
        title: `AI confidence: ${confidencePercent}%${aiContent?.reasoning ? " — " + aiContent.reasoning : ""}`,
      }, CONFIG.features.slopDetector.badgeText));
    }
  }

  // =========================================================================
  // MAIN PIPELINE
  // =========================================================================

  async function run(forceRefresh = false) {
    const pageContext = typeof resolvePageContext === "function" ? resolvePageContext() : {};

    const mainText = extractMainText();
    const toxicity = analyzeToxicity(mainText);
    const readability = computeReadability(mainText);
    const pageData = collectPageData();

    // Attach data for background to use with APIs
    pageContext._contentAnalysis = {
      mainTextSample: mainText.substring(0, 3000),
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
    console.log("Toxicity   :", toxicity);
    console.log("Readability:", readability);
    console.log("Risks      :", pageContext.riskSignals);
    console.groupEnd();

    chrome.runtime.sendMessage({ 
      type: "PAGE_CONTEXT_RESOLVED", 
      payload: pageContext,
      forceRefresh,
    }, () => {
      if (chrome.runtime.lastError) console.debug("[TruthLens] Background not ready:", chrome.runtime.lastError.message);
    });

    const profile = await loadProfile();
    if (!profile) return;

    // Apply local interventions immediately
    applyInterventions(profile, toxicity, readability, {});
  }

  function applyInterventions(profile, toxicity, readability, llmData) {
    const llmAnalysis = llmData?.llmAnalysis || currentAnalysis?.llmAnalysis;
    
    if (profile.impulseBuyer?.enabled && llmAnalysis?.shopping?.isShoppingPage !== false) {
      applyImpulseBuyShield(profile.impulseBuyer.sensitivity);
    }
    
    if (profile.rageBaitShield?.enabled) {
      applyRageBaitShield(toxicity, profile.rageBaitShield.sensitivity, llmAnalysis?.toxicity);
    }
    
    if (profile.hateSpeechFilter?.enabled) {
      applyHateSpeechFilter(llmAnalysis?.toxicity);
    }
    
    if (profile.commentGuard?.enabled) {
      applyCommentGuard(profile.commentGuard.sensitivity);
    }
    
    if (profile.sensitiveImageGuard?.enabled) {
      applySensitiveImageGuard(profile.sensitiveImageGuard.sensitivity);
    }
    
    if (profile.slowReaderMode?.enabled) {
      applySlowReaderMode(readability, profile.slowReaderMode.sensitivity);
    }
    
    if (profile.slopDetector?.enabled) {
      applySlopDetector(llmData, profile.slopDetector.sensitivity);
    }

    // Apply inflammatory section highlighting from LLM
    if (llmAnalysis?.toxicity?.inflammatorySections?.length > 0) {
      applyInflammatorySectionHighlight(
        llmAnalysis.toxicity.inflammatorySections,
        CONFIG.features.inflammatoryHighlight.displayMode
      );
    }

    // Show banner if there are concerns
    const concerns = [];
    if (toxicity.hateSpeech || llmAnalysis?.toxicity?.hateSpeech) concerns.push("Hate speech detected");
    if (toxicity.rageBait || llmAnalysis?.toxicity?.rageBait) concerns.push("Rage bait detected");
    if (toxicity.inflammatory) concerns.push("Inflammatory content");
    if (llmAnalysis?.shopping?.hasUrgencyTactics) concerns.push("Urgency tactics");
    if (llmAnalysis?.aiContent?.detected) concerns.push("AI-generated content");
    
    if (concerns.length > 0 || llmAnalysis?.trustScore < 70) {
      showBanner(
        llmAnalysis?.trustScore ?? null, 
        concerns,
        llmAnalysis?.summary
      );
    }
  }

  // --- Message listeners ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ANALYSIS_COMPLETE" && msg.analysis) {
      currentAnalysis = msg.analysis;
      
      // Update banner with real trust score
      const existingBanner = document.querySelector(".tl-banner");
      if (existingBanner && msg.analysis.trustScore !== null) {
        const scoreEl = existingBanner.querySelector(".tl-banner-score");
        if (scoreEl) {
          scoreEl.textContent = msg.analysis.trustScore;
          scoreEl.className = "tl-banner-score " + 
            (msg.analysis.trustScore >= 70 ? "safe" : msg.analysis.trustScore >= 40 ? "caution" : "danger");
        }
        
        // Update summary if available
        const summaryEl = existingBanner.querySelector(".tl-banner-summary");
        if (msg.analysis.llmAnalysis?.summary) {
          if (summaryEl) {
            summaryEl.textContent = msg.analysis.llmAnalysis.summary;
          } else {
            const textEl = existingBanner.querySelector(".tl-banner-text");
            if (textEl) {
              const newSummary = h("div", { class: "tl-banner-summary" }, msg.analysis.llmAnalysis.summary);
              textEl.insertBefore(newSummary, textEl.querySelector(".tl-banner-concerns"));
            }
          }
        }
      } else if (!existingBanner && msg.analysis.trustScore !== null) {
        // Show banner if we didn't have one
        const concerns = [];
        if (msg.analysis.llmAnalysis?.toxicity?.hateSpeech) concerns.push("Hate speech detected");
        if (msg.analysis.llmAnalysis?.toxicity?.rageBait) concerns.push("Rage bait detected");
        if (msg.analysis.llmAnalysis?.shopping?.hasUrgencyTactics) concerns.push("Urgency tactics");
        if (msg.analysis.llmAnalysis?.aiContent?.detected) concerns.push("AI-generated content");
        if (msg.analysis.llmAnalysis?.risks?.length > 0) {
          concerns.push(...msg.analysis.llmAnalysis.risks.slice(0, 2));
        }
        
        showBanner(msg.analysis.trustScore, concerns, msg.analysis.llmAnalysis?.summary);
      }

      // Apply LLM-based interventions
      if (currentProfile) {
        const mainText = extractMainText();
        const toxicity = analyzeToxicity(mainText);
        const readability = computeReadability(mainText);
        applyInterventions(currentProfile, toxicity, readability, msg.analysis);
      }
    }

    if (msg.type === "REAPPLY_PROTECTIONS" && msg.profile) {
      currentProfile = msg.profile;
      const mainText = extractMainText();
      const toxicity = analyzeToxicity(mainText);
      const readability = computeReadability(mainText);
      applyInterventions(currentProfile, toxicity, readability, currentAnalysis || {});
    }

    if (msg.type === "RESCAN") {
      // Re-run the full pipeline
      run(msg.forceRefresh || false);
    }
  });

  run();
})();
