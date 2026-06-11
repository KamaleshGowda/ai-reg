/**
 * AI Usage Regulator Extension (AIReg)
 * Text Parsing & Redaction Engine
 * Handles pattern detection for PII, API Keys, and Custom User Keywords.
 * Implements interval-based collision filtering to prevent overlapping redactions.
 */

export class Redactor {
  /**
   * Initialize Redactor with optional custom keywords
   * @param {Array<string>} customKeywords 
   */
  constructor(customKeywords = []) {
    this.customKeywords = customKeywords;

    // Built-in standard regular expression rules for high-value leaks
    this.rules = {
      email: {
        // Negative lookbehind (?<!\\) prevents the regex from consuming 'n', 'r', 't' if they are part of a JSON escape sequence like \n
        pattern: /(?<!\\)[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        placeholder: "*********"
      },
      phone: {
        // Require standard formatting (e.g. spaces, dashes, parens) or a leading plus sign to avoid catching 13-digit Unix timestamps
        pattern: /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b\+\d{10,14}\b/g,
        placeholder: "*********"
      },
      credit_card: {
        pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
        placeholder: "****-****-****-****"
      },
      openai_key: {
        pattern: /\bsk-(?:proj-)?[a-zA-Z0-9_-]{32,100}\b/g,
        placeholder: "[MASKED_OPENAI_KEY]"
      },
      aws_key_id: {
        pattern: /\bAKIA[0-9A-Z]{16}\b/g,
        placeholder: "[MASKED_AWS_KEY]"
      },
      github_token: {
        pattern: /\bghp_[a-zA-Z0-9]{36}\b/g,
        placeholder: "[MASKED_GITHUB_TOKEN]"
      }
    };
  }

  /**
   * Redacts standard PII patterns and custom keywords from target text.
   * Utilizes range mapping, priority sorting (entropy-first), and stable right-to-left replacements.
   * @param {string} text 
   * @returns { { cleanText: string, matches: Array<{ rule: string, original: string, redacted: string }> } }
   */
  redact(text) {
    if (!text || typeof text !== 'string') {
      return { cleanText: text, matches: [] };
    }

    const allMatches = [];

    // 1. Gather all matches for built-in regex rules
    for (const [ruleName, rule] of Object.entries(this.rules)) {
      rule.pattern.lastIndex = 0;
      
      const occurrences = [...text.matchAll(rule.pattern)];
      occurrences.forEach(occ => {
        const val = occ[0];
        const start = occ.index;
        const end = start + val.length;

        // Establish priorities: keys, credit cards (high-entropy) get Priority 1
        let priority = 2; // standard PII (email, phone)
        if (ruleName.includes("key") || ruleName.includes("token") || ruleName === "credit_card") {
          priority = 1;
        }

        allMatches.push({
          rule: ruleName,
          original: val,
          placeholder: rule.placeholder,
          start,
          end,
          priority
        });
      });
    }

    // 2. Gather all matches for custom user-defined keywords
    if (this.customKeywords && this.customKeywords.length > 0) {
      this.customKeywords.forEach(keyword => {
        if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') return;

        // Escape regex special chars to match literally
        const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');

        const occurrences = [...text.matchAll(pattern)];
        occurrences.forEach(occ => {
          const val = occ[0];
          const start = occ.index;
          const end = start + val.length;

          allMatches.push({
            rule: "custom_keyword",
            original: val,
            placeholder: "[REDACTED_KEYWORD]",
            start,
            end,
            priority: 3 // Dynamic keywords get lowest priority
          });
        });
      });
    }

    // 3. Sort all matches: Priority ascending (1 first), then length descending (longer match first)
    allMatches.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return b.original.length - a.original.length;
    });

    // 4. Filter out overlapping matches (Deduplication)
    const acceptedMatches = [];
    const acceptedRanges = []; // list of {start, end}

    allMatches.forEach(match => {
      // Check if this match overlaps with any previously accepted range
      const overlaps = acceptedRanges.some(range => {
        return !(match.end <= range.start || match.start >= range.end);
      });

      if (!overlaps) {
        acceptedMatches.push(match);
        acceptedRanges.push({ start: match.start, end: match.end });
      }
    });

    // 5. Reconstruct clean text from right-to-left to keep start indices stable
    acceptedMatches.sort((a, b) => b.start - a.start);

    let cleanText = text;
    const finalReportMatches = [];
    const loggedValues = new Set();

    acceptedMatches.forEach(match => {
      const before = cleanText.substring(0, match.start);
      const after = cleanText.substring(match.end);
      cleanText = before + match.placeholder + after;

      if (!loggedValues.has(match.original)) {
        loggedValues.add(match.original);
        finalReportMatches.push({
          rule: match.rule,
          original: match.original,
          redacted: match.placeholder
        });
      }
    });

    // Report matches in logical order of appearance (left-to-right)
    finalReportMatches.reverse();

    return { cleanText, matches: finalReportMatches };
  }
}
