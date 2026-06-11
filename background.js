/**
 * AI Usage Regulator Extension (AIReg)
 * Background Service Worker (Orchestrator)
 * Implements recursive Deep JSON Traversal, FormData text scanning, and priority rules routing.
 */

import { Redactor } from './shared/redactor.js';
import { StorageManager } from './shared/storage.js';

// Initialize extension settings on installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("🛡️ AIReg: Extension Installed. Initializing default states...", details);

  // Set up initial storage states
  const defaultSettings = {
    firewallEnabled: true,
    autopilotMode: false,
    dailyTokenBudget: 50000,
    customKeywords: []
  };

  const defaultDomainRules = {
    "chatgpt.com": "prompt",
    "claude.ai": "prompt",
    "gemini.google.com": "prompt"
  };

  const defaultUsageStats = {
    tokensConsumedToday: 0,
    blockedAttemptsToday: 0,
    redactedMatchesToday: 0,
    dailyLogs: []
  };

  chrome.storage.local.set({
    settings: defaultSettings,
    domainRules: defaultDomainRules,
    usageStats: defaultUsageStats
  }, () => {
    console.log("🛡️ AIReg: Default states successfully persisted.");
  });
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("🛡️ AIReg: Error setting side panel behavior:", error));

// Message routing hub
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("🛡️ AIReg Background: Message received:", message.action, "from:", sender.tab ? `Tab: ${sender.tab.url}` : "Extension Context");

  if (message.action === "PING") {
    sendResponse({ status: "PONG", version: "1.0.0" });
    return false;
  }

  if (message.action === "INSPECT_PROMPT") {
    const { requestId, url, bodyText, isFormData } = message;
    console.log(`🛡️ AIReg Background: Inspecting prompt ID ${requestId} going to ${url}`);

    handleInspection(requestId, url, bodyText, isFormData, sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.action === "UPDATE_DOMAIN_RULE") {
    const { domain, rule } = message;
    console.log(`🛡️ AIReg Background: Updating domain rule for ${domain} to ${rule}`);
    StorageManager.setDomainRule(domain, rule).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  return false;
});

/**
 * Recursively walks an object or array tree, applying the redactor to string values.
 * Collects and deduplicates all matching leak results.
 */
function traverseAndRedact(obj, redactor, collectedMatches) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    const { cleanText, matches } = redactor.redact(obj);
    matches.forEach(m => {
      if (!collectedMatches.some(item => item.original === m.original)) {
        collectedMatches.push(m);
      }
    });
    return cleanText;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => traverseAndRedact(item, redactor, collectedMatches));
  }

  if (typeof obj === 'object') {
    const newObj = {};
    for (const [key, value] of Object.entries(obj)) {
      newObj[key] = traverseAndRedact(value, redactor, collectedMatches);
    }
    return newObj;
  }

  return obj;
}

/**
 * Handles rule processing, token budgeting, deep parsing, logging, and response routing.
 */
async function handleInspection(requestId, url, bodyText, isFormData, sendResponse) {
  try {
    const settings = await StorageManager.getSettings();

    // 1. Check if firewall is globally enabled
    if (!settings.firewallEnabled) {
      console.log(`🛡️ AIReg Background: Firewall disabled. Automatically allowing prompt ID ${requestId}`);
      sendResponse({ action: "ALLOW" });
      return;
    }

    // 2. Determine active domain rule
    const rule = await StorageManager.getDomainRule(url);
    console.log(`🛡️ AIReg Background: Active profile rule for domain: "${rule}"`);

    // 3. Compute prompt token cost and run budget gatekeeper
    const tokenCost = StorageManager.estimateTokens(bodyText);
    const stats = await StorageManager.getUsageStats();

    if (stats.tokensConsumedToday + tokenCost > settings.dailyTokenBudget) {
      console.warn(`🛡️ AIReg Background: Budget Exceeded! BLOCKING prompt ID ${requestId}`);
      await StorageManager.logActivity("BLOCK", url, bodyText, 0);
      sendResponse({ action: "BLOCK" });
      return;
    }

    // 4. Backward-compatible explicit block check
    if (bodyText.includes("block-me")) {
      console.warn(`🛡️ AIReg Background: Explicit block detected. BLOCKING.`);
      await StorageManager.logActivity("BLOCK", url, bodyText, 0);
      sendResponse({ action: "BLOCK" });
      return;
    }

    // 5. Run Redactor using Deep Traversal or fallback string replacement
    const redactor = new Redactor(settings.customKeywords || []);
    let cleanText = bodyText;
    const matches = [];
    let isJson = false;

    // Check if the payload is a structured JSON string or explicitly sent as a FormData text map
    if (isFormData || bodyText.trim().startsWith("{") || bodyText.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(bodyText);
        isJson = true;
        const traversed = traverseAndRedact(parsed, redactor, matches);
        cleanText = JSON.stringify(traversed);
      } catch (e) {
        // Fall back to plain string replacement if JSON parsing fails
        isJson = false;
      }
    }

    // Flat fallback string replacement if payload is raw text
    if (!isJson) {
      const result = redactor.redact(bodyText);
      cleanText = result.cleanText;
      result.matches.forEach(m => matches.push(m));
    }

    // 6. Enforce rule based on active profile
    if (rule === "deny") {
      console.warn(`🛡️ AIReg Background: Host is blacklisted. BLOCKING.`);
      await StorageManager.logActivity("BLOCK", url, bodyText, 0);
      sendResponse({ action: "BLOCK" });
      
    } else if (rule === "allow") {
      console.log(`🛡️ AIReg Background: Host is whitelisted. ALLOWING.`);
      await StorageManager.logActivity("ALLOW", url, bodyText, 0);
      sendResponse({ action: "ALLOW" });
      
    } else if (rule === "mask" || rule === "auto-mask" || settings.autopilotMode) {
      const hasLeaks = matches.length > 0;
      const finalAction = hasLeaks ? "MASK" : "ALLOW";
      
      console.log(`🛡️ AIReg Background: Autopilot/Mask active. Action: ${finalAction}`);
      await StorageManager.logActivity(finalAction, url, bodyText, matches.length);
      sendResponse({ action: finalAction, modifiedBody: hasLeaks ? cleanText : null, matches: hasLeaks ? matches : null });
      
    } else {
      // rule === "prompt"
      const hasLeaks = matches.length > 0;
      const finalAction = hasLeaks ? "MASK" : "ALLOW";
      
      console.log(`🛡️ AIReg Background: Prompt mode active. Action: ${finalAction}`);
      await StorageManager.logActivity(finalAction, url, bodyText, matches.length);
      sendResponse({ action: finalAction, modifiedBody: hasLeaks ? cleanText : null, matches: hasLeaks ? matches : null });
    }

  } catch (error) {
    console.error("🛡️ AIReg Background: Exception during inspection:", error);
    sendResponse({ action: "ALLOW" });
  }
}
