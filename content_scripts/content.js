/**
 * AI Usage Regulator Extension (AIReg)
 * Content Script Bridge & Overlay Manager
 * Runs in isolated extension content script context.
 * Acts as the message bridge between the page context and the background service worker,
 * and renders the premium glassmorphic Just-In-Time Firewall Overlay.
 */

(function() {
  console.warn("🛡️ [AIReg Content Script Bridge] ACTIVE!");

  // Listen for messages from the page context interceptor
  window.addEventListener("message", function(event) {
    // Only trust messages from our own window context
    if (event.source !== window) return;

    const message = event.data;
    if (message && message.source === 'aireg-page-context' && message.type === 'REQUEST_INTERCEPTED') {
      const { requestId, url, bodyText } = message;
      console.log(`🛡️ AIReg Bridge: Intercepted prompt for ${url} (ID: ${requestId}). Routing to background...`);

      // Forward request details to background worker for parsing/rule execution
      chrome.runtime.sendMessage({
        action: "INSPECT_PROMPT",
        requestId,
        url,
        bodyText
      }, function(response) {
        // Fallback safety
        if (chrome.runtime.lastError || !response) {
          console.warn("🛡️ AIReg Bridge: Background worker connection failed or empty. Defaulting to ALLOW.");
          sendDecisionToPage(requestId, "ALLOW");
          return;
        }

        console.log(`🛡️ AIReg Bridge: Received response from background for ${requestId}:`, response);

        // If the background script identified sensitive matches (action: "MASK") and we are in
        // prompt mode, we present the Just-In-Time Firewall Overlay Dialog instead of auto-redacting.
        if (response.action === "MASK" && response.matches && response.matches.length > 0) {
          // Check if autopilot mode was active or domain is set to auto-redact (in which case we bypass overlay)
          chrome.storage.local.get(['settings', 'domainRules'], (result) => {
            const settings = result.settings || {};
            const domainRules = result.domainRules || {};
            
            let host = window.location.hostname.toLowerCase();
            let matchedRule = "prompt";
            for (const ruleDomain of Object.keys(domainRules)) {
              const rd = ruleDomain.toLowerCase();
              if (host === rd || host.endsWith('.' + rd)) {
                matchedRule = domainRules[ruleDomain];
                break;
              }
            }

            // If domain rule is auto-mask or global settings autopilot is enabled, bypass overlay and auto-mask
            if (matchedRule === "mask" || matchedRule === "auto-mask" || settings.autopilotMode) {
              console.log("🛡️ AIReg Bridge: Auto-Mask active for this domain. Bypassing JIT prompt overlay.");
              sendDecisionToPage(requestId, "MASK", response.modifiedBody);
            } else {
              // Otherwise, show the premium glassmorphic overlay for manual authorization!
              console.log("🛡️ AIReg Bridge: Showing manual JIT Firewall Overlay dialog.");
              showFirewallOverlay(requestId, url, bodyText, response.modifiedBody, response.matches, (finalAction, finalBody) => {
                sendDecisionToPage(requestId, finalAction, finalBody);
              });
            }
          });
        } else {
          // Whitelisted host, blocked host, budget exceeded, or no PII leaks -> run immediately
          sendDecisionToPage(requestId, response.action, response.modifiedBody);
        }
      });
    }
  });

  // Listen for Worker/postMessage intercepts from the deep thread interceptor
  window.addEventListener('AIREG_INTERCEPT_WORKER', function(event) {
    const { requestId, bodyText } = event.detail;
    console.log(`🛡️ AIReg Bridge: Intercepted Worker thread payload (ID: ${requestId}). Routing to background...`);

    chrome.runtime.sendMessage({
      action: "INSPECT_PROMPT",
      requestId,
      url: "worker-postMessage", // Fake URL since it's an internal payload transfer
      bodyText,
      isFormData: false
    }, function(response) {
      if (chrome.runtime.lastError || !response) {
        sendDecisionToPage(requestId, "ALLOW");
        return;
      }

      console.log(`🛡️ AIReg Bridge: Received response from background for worker payload ${requestId}:`, response);

      if (response.action === "MASK" && response.matches && response.matches.length > 0) {
        chrome.storage.local.get(['settings', 'domainRules'], (result) => {
          const settings = result.settings || {};
          const domainRules = result.domainRules || {};
          
          let host = window.location.hostname.toLowerCase();
          let matchedRule = "prompt";
          for (const ruleDomain of Object.keys(domainRules)) {
            const rd = ruleDomain.toLowerCase();
            if (host === rd || host.endsWith('.' + rd)) {
              matchedRule = domainRules[ruleDomain];
              break;
            }
          }

          if (matchedRule === "mask" || matchedRule === "auto-mask" || settings.autopilotMode) {
            sendDecisionToPage(requestId, "MASK", response.modifiedBody);
          } else {
            showFirewallOverlay(requestId, "worker-postMessage", bodyText, response.modifiedBody, response.matches, (finalAction, finalBody) => {
              sendDecisionToPage(requestId, finalAction, finalBody);
            });
          }
        });
      } else {
        sendDecisionToPage(requestId, response.action, response.modifiedBody);
      }
    });
  });

  // Helper to send decision back to page context
  function sendDecisionToPage(requestId, action, modifiedBody = null) {
    window.postMessage({
      source: 'aireg-content-script',
      type: 'RESPONSE_DECISION',
      requestId,
      action,
      modifiedBody
    }, '*');
  }

  // Render and wire up the Just-In-Time Glassmorphic Firewall Overlay inside the Shadow DOM
  function showFirewallOverlay(requestId, url, bodyText, cleanText, matches, callback) {
    // Avoid double modal rendering
    if (document.getElementById('aireg-overlay-root')) return;

    const overlayContainer = document.createElement('div');
    overlayContainer.id = 'aireg-overlay-root';
    
    // Closed Shadow DOM completely isolates visual styling to avoid web page style collision
    const shadow = overlayContainer.attachShadow({ mode: 'closed' });

    // Inject stylesheet via extension URL
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content_scripts/overlay.css');
    shadow.appendChild(link);

    const backdrop = document.createElement('div');
    backdrop.className = 'firewall-backdrop';

    // Build markup lists for leaks detected
    let matchesHtml = '';
    matches.forEach(m => {
      let displayRule = m.rule.replace(/_/g, ' ');
      matchesHtml += `
        <div class="match-item">
          <span class="rule-badge">${displayRule}</span>
          <span class="leak-value">${escapeHtml(m.original)}</span>
        </div>
      `;
    });

    backdrop.innerHTML = `
      <div class="firewall-card">
        <div class="card-header">
          <div class="warning-icon-container">🛡️</div>
          <div class="header-text">
            <h2>AI Firewall Interception</h2>
            <p>Sensitive data leak matched in outbound payload</p>
          </div>
        </div>

        <div class="intercept-details">
          ${matchesHtml}
        </div>

        <div class="choices-grid">
          <button class="choice-btn primary" id="btn-mask">
            <span class="btn-title">Mask & Send</span>
            <span class="btn-desc">Redact PII with placeholders and transmit safely</span>
          </button>
          
          <button class="choice-btn" id="btn-allow-once">
            <span class="btn-title">Allow Once</span>
            <span class="btn-desc">Let this single request pass completely raw</span>
          </button>
          
          <button class="choice-btn" id="btn-allow-always">
            <span class="btn-title">Allow Always</span>
            <span class="btn-desc">Whitelist domain; autopass all future prompts</span>
          </button>
          
          <button class="choice-btn" id="btn-mask-always">
            <span class="btn-title">Always Mask</span>
            <span class="btn-desc">Autopilot redaction silently on this domain</span>
          </button>
          
          <button class="choice-btn" id="btn-block-always">
            <span class="btn-title">Block Always</span>
            <span class="btn-desc">Blacklist domain; physically drop requests</span>
          </button>
        </div>

        <div class="cancel-row">
          <button class="cancel-btn" id="btn-cancel">Block Once & Cancel</button>
        </div>
      </div>
    `;

    shadow.appendChild(backdrop);
    document.body.appendChild(overlayContainer);

    // Fade-in animation hook
    setTimeout(() => backdrop.classList.add('show'), 20);

    // Escape Helper
    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // Dismiss transition helper
    function dismiss(action, modifiedBody = null) {
      backdrop.classList.remove('show');
      setTimeout(() => {
        overlayContainer.remove();
        callback(action, modifiedBody);
      }, 300);
    }

    // Wire up events
    shadow.getElementById('btn-mask').addEventListener('click', () => dismiss('MASK', cleanText));
    shadow.getElementById('btn-allow-once').addEventListener('click', () => dismiss('ALLOW'));
    
    shadow.getElementById('btn-allow-always').addEventListener('click', () => {
      const domain = window.location.hostname;
      chrome.runtime.sendMessage({ action: "UPDATE_DOMAIN_RULE", domain, rule: "allow" });
      dismiss('ALLOW');
    });

    shadow.getElementById('btn-mask-always').addEventListener('click', () => {
      const domain = window.location.hostname;
      chrome.runtime.sendMessage({ action: "UPDATE_DOMAIN_RULE", domain, rule: "mask" });
      dismiss('MASK', cleanText);
    });

    shadow.getElementById('btn-block-always').addEventListener('click', () => {
      const domain = window.location.hostname;
      chrome.runtime.sendMessage({ action: "UPDATE_DOMAIN_RULE", domain, rule: "deny" });
      dismiss('BLOCK');
    });

    shadow.getElementById('btn-cancel').addEventListener('click', () => dismiss('BLOCK'));
  }

  // Handle direct ping message from extension context
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "PING") {
      sendResponse({ status: "ACTIVE" });
    }
    return true;
  });

})();
