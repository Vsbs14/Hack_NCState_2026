# Hack_NCState_2026
Team RNW Hackers
---

## TruthLens - Layered Protection Extension

### **LAYER 0: USER PROFILE**
*One-time setup*

User selects protection level:
- [ ] **Minimal** - Information only (for tech-savvy users). {Use gemini key to summarize findings}
- [ ] **Scam Protection** - Block suspicious payments
- [ ] **Impulse Buy Protection** - Cooling-off warnings
- [ ] **Engagement Protection** - Engagement bait warnings

---

### **LAYER 1: QUICK TRUST CHECK**
*< 1 second, runs on every page*

#### Lightweight checks:
- ✓ Domain age lookup (WHOIS API)
- ✓ SSL certificate validation
- ✓ Known scam database check
- ✓ Blacklist comparison (import a database of known trusted websites like Amazon)
- ✓ Basic page structure analysis:
  - Excessive pop-ups?
  - Payment forms present?
  - Comment sections detected?
  - Suspicious keywords ("limited time", "act now")

**OUTPUT:** Trust Score (0-100) [Base trust score is null]

---

### **DECISION POINT**
```
Score ≥ 60 (Trustworthy)     |     Score < 60 (Suspicious)
           ↓                 |                ↓
    ✓ PASS - Show badge      |       TRIGGER LAYER 2
                             |        Deep AI Scan
```

---

### **LAYER 2: DEEP AI SCAN**
*Only triggered if Score < 60*

#### Expensive AI analysis:

**🤖 GOOGLE GEMINI**
- Extract all text from page
- Run AI generation detection
- Output: % AI-generated (0-100%)
- Flag suspicious patterns (urgency, scam language)

**ELEVENLABS**
- Allow the user to listen to an audio render of the summary that Gemini finds.

**RESULT:** Updated Trust Score incorporating AI findings

---

### **LAYER 3: PROTECTION RULES**
*Based on User Profile + Final Score*

#### **IF** User has "Scam Protection" enabled:
- **AND** Final Score < 40
- **AND** Payment forms detected:
  - → **HARD BLOCK** payment submission
  - → Show detailed warning with all red flags
  - → *[Notify trusted contact - out of scope]*

#### **IF** User has "Impulse Buy Protection" enabled:
- **AND** Checkout flow detected:
  - → Show cooling-off prompt
  - → *[24hr delay - mentioned but not built]*

#### **IF** User has "Engagement Protection" enabled:
- **AND** Comment form on low-trust site:
  - → Show context warning before posting
  - → *[Delay submission - mentioned but not built]*

#### **IF** User has "Minimal" protection:
- → Just display trust score badge
- → Show AI detection results if available
- → No blocking, full user autonomy

---

### **LAYER 4: USER INTERFACE**

#### Visual feedback based on final score:

| Score Range | Badge | Status |
|------------|-------|--------|
| 80-100 | 🟢 | **Verified Safe** |
| 60-79 | 🟡 | **Proceed with Caution** |
| 0-59 | 🔴 | **Threat Detected** |

#### Click badge to see full report:
- Trust score breakdown
- AI detection results
- Specific red flags
- Recommended actions
