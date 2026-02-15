/**
 * resolver.js — Page Context Resolver (Layer 1)
 *
 * Orchestrates all heuristic detectors and produces a single
 * structured PageContext object. This is the main pipeline entry point.
 *
 * Architecture note:
 *   The resolver is intentionally a pure pipeline: gather signals → score →
 *   pick winner. This makes it easy to drop in an AI re-ranker at Layer 2
 *   without changing the content script or messaging plumbing.
 *
 * Output shape:
 *   {
 *     pageType:      "shopping" | "news" | "social" | "payment" | "forum" | "unknown",
 *     intentSignals: string[],
 *     riskSignals:   string[],
 *     confidence:    number (0–1)
 *   }
 */

function resolvePageContext() {
  const url = new URL(location.href);

  // -----------------------------------------------------------------------
  // Step 1: Collect all signals
  // -----------------------------------------------------------------------
  const urlSignals = detectFromURL(url);

  const shopping = detectShopping();
  const payment  = detectPayment();
  const news     = detectNews();
  const social   = detectSocial();
  const forum    = detectForum();
  const generalRisks = detectGeneralRisks();

  // -----------------------------------------------------------------------
  // Step 2: Score each page type
  //
  // Each signal is worth 1 point. URL signals count for the type they
  // belong to. DOM signals are already bucketed by detector.
  // -----------------------------------------------------------------------
  const scores = {
    shopping: 0,
    payment:  0,
    news:     0,
    social:   0,
    forum:    0,
  };

  // Tally URL signals
  urlSignals.forEach((s) => {
    if (s.includes("shopping")) scores.shopping++;
    if (s.includes("payment"))  scores.payment++;
    if (s.includes("news"))     scores.news++;
    if (s.includes("social"))   scores.social++;
    if (s.includes("forum"))    scores.forum++;
  });

  // Tally DOM intent signals
  scores.shopping += shopping.intent.length;
  scores.payment  += payment.intent.length;
  scores.news     += news.intent.length;
  scores.social   += social.intent.length;
  scores.forum    += forum.intent.length;

  // -----------------------------------------------------------------------
  // Step 3: Pick the winner
  // -----------------------------------------------------------------------
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topType, topScore] = sorted[0];
  const totalSignals = Object.values(scores).reduce((a, b) => a + b, 0);

  // Confidence = (winner's signals) / (winner's signals + 2)
  // The +2 acts as a dampener so a single signal doesn't yield 100%.
  // More aligned signals → higher confidence, caps near 1.0.
  const confidence = totalSignals > 0
    ? Math.round((topScore / (topScore + 2)) * 100) / 100
    : 0;

  const pageType = topScore > 0 ? topType : "unknown";

  // -----------------------------------------------------------------------
  // Step 4: Merge all intent & risk signals for the output
  // -----------------------------------------------------------------------
  const allIntent = [
    ...urlSignals,
    ...shopping.intent,
    ...payment.intent,
    ...news.intent,
    ...social.intent,
    ...forum.intent,
  ];

  const allRisk = [
    ...shopping.risk,
    ...payment.risk,
    ...generalRisks,
  ];

  return {
    pageType,
    intentSignals: allIntent,
    riskSignals: allRisk,
    confidence,
    // Extra metadata useful for debugging / future layers
    _debug: {
      url: location.href,
      scores,
      resolvedAt: new Date().toISOString(),
    },
  };
}
