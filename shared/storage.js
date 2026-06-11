/**
 * AI Usage Regulator Extension (AIReg)
 * Persistence & State Manager
 * Wraps chrome.storage.local with clean async methods, handles metrics and rules.
 */

export class StorageManager {
  /**
   * Fetch current global extension settings
   */
  static getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {
          firewallEnabled: true,
          autopilotMode: false,
          dailyTokenBudget: 50000,
          customKeywords: []
        });
      });
    });
  }

  /**
   * Save global extension settings
   * @param {object} settings 
   */
  static setSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ settings }, () => resolve());
    });
  }

  /**
   * Get all domain-specific behavior rules
   */
  static getDomainRules() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['domainRules'], (result) => {
        resolve(result.domainRules || {
          "chatgpt.com": "prompt",
          "claude.ai": "prompt",
          "gemini.google.com": "prompt"
        });
      });
    });
  }

  /**
   * Lookup the active enforcement profile for a given domain/hostname
   * Profiles: 'allow' | 'deny' | 'prompt' | 'mask' | 'auto-mask'
   * @param {string} urlString 
   */
  static async getDomainRule(urlString) {
    const rules = await this.getDomainRules();
    
    let hostname = "";
    try {
      if (urlString.startsWith("http://") || urlString.startsWith("https://")) {
        hostname = new URL(urlString).hostname;
      } else {
        // Fallback for relative or raw URL strings
        hostname = urlString.split('/')[0];
      }
    } catch (e) {
      hostname = urlString;
    }

    const host = hostname.toLowerCase();

    // Match exact domain or standard parent domains
    for (const ruleDomain of Object.keys(rules)) {
      const rd = ruleDomain.toLowerCase();
      if (host === rd || host.endsWith('.' + rd)) {
        return rules[ruleDomain];
      }
    }

    return "prompt"; // Default profile is to prompt the user
  }

  /**
   * Update or create a rule for a specific domain
   * @param {string} domain 
   * @param {string} rule 
   */
  static async setDomainRule(domain, rule) {
    const rules = await this.getDomainRules();
    rules[domain.toLowerCase()] = rule;
    return new Promise((resolve) => {
      chrome.storage.local.set({ domainRules: rules }, () => resolve());
    });
  }

  /**
   * Fetch daily usage statistics
   */
  static getUsageStats() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['usageStats'], (result) => {
        resolve(result.usageStats || {
          tokensConsumedToday: 0,
          blockedAttemptsToday: 0,
          redactedMatchesToday: 0,
          dailyLogs: []
        });
      });
    });
  }

  /**
   * Atomically aggregate statistics and chronological activity log
   * @param {object} updates 
   */
  static async updateUsageStats(updates) {
    const stats = await this.getUsageStats();
    
    const updatedStats = {
      tokensConsumedToday: Math.max(0, (stats.tokensConsumedToday || 0) + (updates.tokensConsumed || 0)),
      blockedAttemptsToday: Math.max(0, (stats.blockedAttemptsToday || 0) + (updates.blockedAttempts || 0)),
      redactedMatchesToday: Math.max(0, (stats.redactedMatchesToday || 0) + (updates.redactedMatches || 0)),
      dailyLogs: [
        ...(updates.logEntry ? [updates.logEntry] : []),
        ...(stats.dailyLogs || [])
      ].slice(0, 100) // Caps log stream to prevent Chrome storage overhead
    };

    return new Promise((resolve) => {
      chrome.storage.local.set({ usageStats: updatedStats }, () => resolve(updatedStats));
    });
  }

  /**
   * Character-to-token heuristic estimation (1 token ≈ 4 characters)
   * @param {string} text 
   */
  static estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Append a structured entry to the activity log stream
   * @param {string} type - 'ALLOW' | 'BLOCK' | 'MASK'
   * @param {string} urlString 
   * @param {string} originalPrompt 
   * @param {number} redactedCount 
   */
  static async logActivity(type, urlString, originalPrompt, redactedCount = 0) {
    let domain = "";
    try {
      if (urlString.startsWith("http://") || urlString.startsWith("https://")) {
        domain = new URL(urlString).hostname;
      } else {
        domain = urlString.split('/')[0];
      }
    } catch (e) {
      domain = urlString;
    }

    const tokenCount = this.estimateTokens(originalPrompt);
    const logEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      type,
      domain,
      tokenCount,
      redactedCount,
      snippet: originalPrompt.length > 60 ? originalPrompt.substring(0, 57) + "..." : originalPrompt
    };

    await this.updateUsageStats({
      tokensConsumed: type !== 'BLOCK' ? tokenCount : 0,
      blockedAttempts: type === 'BLOCK' ? 1 : 0,
      redactedMatches: redactedCount,
      logEntry
    });
  }
}
