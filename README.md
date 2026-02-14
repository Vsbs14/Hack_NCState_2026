# Hack_NCState_2026
Team RNW Hackers

┌─────────────────────────────────────────────────────────┐
│ LAYER 0: USER PROFILE (One-time setup)                  │ 
│                                                         │
│ User selects protection level:                          │
│  □ Minimal (Info only - for tech-savvy users)           │
│  □ Scam Protection (Block suspicious payments)          │
│  □ Impulse Buy Protection (Cooling-off warnings)        │
│  □ Engagement Protection (Ragebait warnings)            │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ LAYER 1: QUICK TRUST CHECK (< 1 second, every page)     │
│                                                         │
│ Lightweight checks:                                     │
│  ✓ Domain age lookup (WHOIS API)                        │
│  ✓ SSL certificate validation                           │
│  ✓ Known scam database check                            │
│  ✓ Blacklist comparison                                 │
│  ✓ Basic page structure analysis:                       │ 
│    - Excessive pop-ups?                                 │
│    - Payment forms present?                             │
│    - Comment sections detected?                         │
│    - Suspicious keywords ("limited time", "act now")    │
│                                                         │
│ OUTPUT: Trust Score (0-100)                             │
└─────────────────────────────────────────────────────────┘
                         ↓
                    DECISION POINT
                         ↓
        ┌────────────────┴────────────────┐
        ↓                                  ↓
   Score ≥ 60                         Score < 60
   (Trustworthy)                      (Suspicious)
        ↓                                  ↓
   ┌─────────┐                  ┌──────────────────┐
   │ PASS    │                  │ TRIGGER LAYER 2  │
   │ Show ✓  │                  │ Deep AI Scan     │
   └─────────┘                  └──────────────────┘
                                         ↓
┌─────────────────────────────────────────────────────────┐
│ LAYER 2: DEEP AI SCAN (Only if Score < 60)              │
│                                                         │
│ Expensive AI analysis:                                  │
│                                                         │
│  🤖 GEMINI:                                             │
│     - Extract all text from page                        │
│     - Run AI generation detection                       │
│     - Output: % AI-generated (0-100%)                   │
│     - Flag suspicious patterns (urgency, scam lang)     │ 
│                                                         │
│  📹 TWELVE LABS:                                        │
│     - Detect embedded videos                            │
│     - Scan for deepfake indicators                      │
│     - Check for stock footage misuse                    │
│     - Output: Deepfake probability                      │
│                                                         │
│  🔊 ELEVENLABS:                                         │
│     - Detect audio/video with voice                     │
│     - Analyze for voice cloning patterns                │
│     - Check for synthetic speech markers                │
│     - Output: Synthetic voice probability               │
│                                                         │
│ UPDATED Trust Score incorporating AI findings           │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ LAYER 3: PROTECTION RULES (Based on Profile + Score)    │
│                                                         │
│ IF User has "Scam Protection" enabled:                  │
│   AND Final Score < 40                                  │
│   AND Payment forms detected:                           │
│     → HARD BLOCK payment submission                     │
│     → Show detailed warning with all red flags          │
│     → [Notify trusted contact - out of scope]           │
│                                                         │
│ IF User has "Impulse Buy Protection" enabled:           │
│   AND Checkout flow detected:                           │
│     → Show cooling-off prompt                           │
│     → [24hr delay - mentioned but not built]            │
│                                                         │
│ IF User has "Engagement Protection" enabled:            │
│   AND Comment form on low-trust site:                   │
│     → Show context warning before posting               │
│     → [Delay submission - mentioned but not built]      │
│                                                         │
│ IF User has "Minimal" protection:                       │
│     → Just display trust score badge                    │
│     → Show AI detection results if available            │
│     → No blocking, full user autonomy                   │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ LAYER 4: USER INTERFACE                                 │
│                                                         │
│ Visual feedback based on final score:                   │
│                                                         │
│  🟢 Score 80-100: Green badge "Verified Safe"           │
│  🟡 Score 60-79:  Yellow badge "Proceed with Caution"   │
│  🔴 Score 0-59:   Red badge "Threat Detected"           │
│                                                         │
│ Click badge to see full report:                         │
│  - Trust score breakdown                                │
│  - AI detection results                                 │
│  - Specific red flags                                   │
│  - Recommended actions                                  │
└─────────────────────────────────────────────────────────┘



