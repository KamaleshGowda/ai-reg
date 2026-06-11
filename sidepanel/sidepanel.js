/**
 * AI Usage Regulator Extension (AIReg)
 * Sidepanel Dashboard Script
 * Manages stats visualization, whitelists/blacklists, keyword lists, and real-time log rendering.
 */

document.addEventListener("DOMContentLoaded", () => {
  // 1. DOM Elements Selection
  const toggleFirewall = document.getElementById("toggle-firewall");
  const firewallStatusLabel = document.getElementById("firewall-status-label");
  
  // Telemetry Grid
  const statTokensUsed = document.getElementById("stat-tokens-used");
  const statTokensLimit = document.getElementById("stat-tokens-limit");
  const budgetProgress = document.getElementById("budget-progress");
  const statRedacted = document.getElementById("stat-redacted");
  const statBlocked = document.getElementById("stat-blocked");

  // Tabs Navigation
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  // Logs Tab
  const logTerminal = document.getElementById("log-terminal");
  const btnClearLogs = document.getElementById("btn-clear-logs");

  // Domains Tab
  const inputNewDomain = document.getElementById("input-new-domain");
  const btnAddDomain = document.getElementById("btn-add-domain");
  const domainRulesList = document.getElementById("domain-rules-list");

  // Keywords Tab
  const inputNewKeyword = document.getElementById("input-new-keyword");
  const btnAddKeyword = document.getElementById("btn-add-keyword");
  const keywordsList = document.getElementById("keywords-list");

  // Settings Tab
  const inputTokenBudget = document.getElementById("input-token-budget");
  const toggleAutopilot = document.getElementById("toggle-autopilot");
  const btnSaveConfig = document.getElementById("btn-save-config");

  // 2. Tab Navigation System
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      // Toggle button active classes
      tabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // Toggle content active classes
      const targetTab = btn.getAttribute("data-tab");
      tabContents.forEach(content => {
        content.classList.remove("active");
        if (content.id === targetTab) {
          content.classList.add("active");
        }
      });
    });
  });

  // 3. Core Initializers & Storage Synchronizers
  async function init() {
    await updateDashboardMetrics();
    await renderDomainRules();
    await renderKeywords();
    await syncSettingsForm();

    // Listen to real-time storage changes to update statistics dynamically
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local") {
        if (changes.usageStats || changes.settings || changes.domainRules) {
          console.log("🛡️ AIReg Dashboard: Local storage changes detected. Updating visuals...");
          updateDashboardMetrics();
          
          if (changes.settings) {
            syncSettingsForm();
            renderKeywords();
          }
          if (changes.domainRules) {
            renderDomainRules();
          }
        }
      }
    });
  }

  // 4. Update Dashboard Metrics & Terminal Log Stream
  async function updateDashboardMetrics() {
    chrome.storage.local.get(["settings", "usageStats"], (result) => {
      const settings = result.settings || { firewallEnabled: true, dailyTokenBudget: 50000, autopilotMode: false };
      const usageStats = result.usageStats || { tokensConsumedToday: 0, redactedMatchesToday: 0, blockedAttemptsToday: 0, dailyLogs: [] };

      // Firewall Toggle Button Sync
      toggleFirewall.checked = settings.firewallEnabled;
      if (settings.firewallEnabled) {
        firewallStatusLabel.textContent = "Active";
        firewallStatusLabel.style.color = "var(--accent-green)";
      } else {
        firewallStatusLabel.textContent = "Disabled";
        firewallStatusLabel.style.color = "var(--text-muted)";
      }

      // Daily Budget Telemetry Widget
      const tokensUsed = usageStats.tokensConsumedToday || 0;
      const budgetLimit = settings.dailyTokenBudget || 50000;
      statTokensUsed.textContent = formatNumber(tokensUsed);
      statTokensLimit.textContent = formatLimit(budgetLimit);

      const progressPercent = Math.min(100, (tokensUsed / budgetLimit) * 100);
      budgetProgress.style.width = `${progressPercent}%`;

      if (progressPercent >= 90) {
        budgetProgress.style.background = "linear-gradient(90deg, var(--accent-orange) 0%, var(--accent-red) 100%)";
      } else {
        budgetProgress.style.background = "linear-gradient(90deg, var(--accent-blue) 0%, #a5d6ff 100%)";
      }

      // Statistics Redacted / Blocked counters
      statRedacted.textContent = formatNumber(usageStats.redactedMatchesToday || 0);
      statBlocked.textContent = formatNumber(usageStats.blockedAttemptsToday || 0);

      // Terminal Logs Rendering
      renderTerminalLogs(usageStats.dailyLogs || []);
    });
  }

  // 5. Render Chronological Terminal Logs
  function renderTerminalLogs(logs) {
    if (!logs || logs.length === 0) {
      logTerminal.innerHTML = `<div class="terminal-placeholder">Awaiting intercepted traffic streams...</div>`;
      return;
    }

    logTerminal.innerHTML = "";
    logs.forEach(log => {
      const logLine = document.createElement("div");
      logLine.className = `log-line ${log.type.toLowerCase()}`;

      // Formatting Date Time
      const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      let badgeClass = log.type.toLowerCase();
      let typeLabel = log.type;
      
      let detailsText = "";
      if (log.type === "MASK") {
        detailsText = `[Masked ${log.redactedCount} elements]`;
      } else if (log.type === "ALLOW") {
        detailsText = "[Pass Unmodified]";
      } else {
        detailsText = "[Request Dropped]";
      }

      logLine.innerHTML = `
        <span class="log-time">[${timeStr}]</span>
        <span class="log-type ${badgeClass}">${typeLabel}</span>
        <span class="log-domain">${escapeHtml(log.domain)}</span>
        <span class="log-meta">(${log.tokenCount} tokens) - ${escapeHtml(detailsText)}</span>
      `;
      
      logTerminal.appendChild(logLine);
    });
  }

  // 6. Whitelist / Blacklist Policy Rules Table Manager
  async function renderDomainRules() {
    chrome.storage.local.get(["domainRules"], (result) => {
      const rules = result.domainRules || {};
      
      domainRulesList.innerHTML = "";
      
      const domains = Object.keys(rules);
      if (domains.length === 0) {
        domainRulesList.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No domain behavior rules defined.</td></tr>`;
        return;
      }

      // Sort alphabetically for clean order
      domains.sort().forEach(domain => {
        const ruleVal = rules[domain];
        const row = document.createElement("tr");

        row.innerHTML = `
          <td style="font-weight: 500;">${escapeHtml(domain)}</td>
          <td>
            <select class="select-rule-policy" data-domain="${escapeHtml(domain)}">
              <option value="prompt" ${ruleVal === 'prompt' ? 'selected' : ''}>Prompt JIT Overlay</option>
              <option value="mask" ${ruleVal === 'mask' || ruleVal === 'auto-mask' ? 'selected' : ''}>Auto-Redact Mask</option>
              <option value="allow" ${ruleVal === 'allow' ? 'selected' : ''}>Allow Always</option>
              <option value="deny" ${ruleVal === 'deny' ? 'selected' : ''}>Block Always</option>
            </select>
          </td>
          <td>
            <button class="btn-icon-delete delete-domain-btn" data-domain="${escapeHtml(domain)}">×</button>
          </td>
        `;

        domainRulesList.appendChild(row);
      });

      // Wire up Select policy dropdown changers
      document.querySelectorAll(".select-rule-policy").forEach(select => {
        select.addEventListener("change", (e) => {
          const dom = e.target.getAttribute("data-domain");
          const val = e.target.value;
          updateDomainRuleInStorage(dom, val);
        });
      });

      // Wire up Delete buttons
      document.querySelectorAll(".delete-domain-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const dom = e.target.getAttribute("data-domain");
          deleteDomainRuleInStorage(dom);
        });
      });
    });
  }

  // Helper storage writers for Domains Rules
  function updateDomainRuleInStorage(domain, policy) {
    chrome.storage.local.get(["domainRules"], (result) => {
      const rules = result.domainRules || {};
      rules[domain.toLowerCase()] = policy;
      chrome.storage.local.set({ domainRules: rules }, () => {
        console.log(`🛡️ AIReg Dashboard: Policy updated for ${domain} -> ${policy}`);
      });
    });
  }

  function deleteDomainRuleInStorage(domain) {
    chrome.storage.local.get(["domainRules"], (result) => {
      const rules = result.domainRules || {};
      delete rules[domain.toLowerCase()];
      chrome.storage.local.set({ domainRules: rules }, () => {
        console.log(`🛡️ AIReg Dashboard: Deleted behavior rule for ${domain}`);
        renderDomainRules();
      });
    });
  }

  // Add Host/Domain Policy Handlers
  btnAddDomain.addEventListener("click", () => {
    const val = inputNewDomain.value.trim();
    if (!val) return;

    // Fast normalization to clean hostname
    let host = val;
    try {
      if (val.startsWith("http://") || val.startsWith("https://")) {
        host = new URL(val).hostname;
      }
    } catch(e) {}
    host = host.toLowerCase();

    chrome.storage.local.get(["domainRules"], (result) => {
      const rules = result.domainRules || {};
      if (rules[host]) {
        alert("Rule already exists for this domain.");
        return;
      }
      
      // Default to prompting the user
      rules[host] = "prompt";
      chrome.storage.local.set({ domainRules: rules }, () => {
        inputNewDomain.value = "";
        renderDomainRules();
      });
    });
  });

  // 7. Custom Keyword Regulator
  async function renderKeywords() {
    chrome.storage.local.get(["settings"], (result) => {
      const settings = result.settings || { customKeywords: [] };
      const keywords = settings.customKeywords || [];

      keywordsList.innerHTML = "";
      if (keywords.length === 0) {
        keywordsList.innerHTML = `<span style="color: var(--text-muted); font-size: 0.75rem; width: 100%; text-align: center; padding: 20px 0;">No custom keywords defined.</span>`;
        return;
      }

      keywords.forEach(kw => {
        const pill = document.createElement("span");
        pill.className = "keyword-pill";
        pill.innerHTML = `
          <span>${escapeHtml(kw)}</span>
          <button class="keyword-pill-remove" data-keyword="${escapeHtml(kw)}">×</button>
        `;
        keywordsList.appendChild(pill);
      });

      // Wire up keyword deletion pills
      document.querySelectorAll(".keyword-pill-remove").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const kw = e.target.getAttribute("data-keyword");
          deleteKeywordInStorage(kw);
        });
      });
    });
  }

  function deleteKeywordInStorage(kw) {
    chrome.storage.local.get(["settings"], (result) => {
      const settings = result.settings || { customKeywords: [] };
      const keywords = settings.customKeywords || [];
      const updatedKeywords = keywords.filter(item => item !== kw);
      
      settings.customKeywords = updatedKeywords;
      chrome.storage.local.set({ settings }, () => {
        console.log(`🛡️ AIReg Dashboard: Custom keyword removed: "${kw}"`);
        renderKeywords();
      });
    });
  }

  btnAddKeyword.addEventListener("click", () => {
    const val = inputNewKeyword.value.trim();
    if (!val) return;

    chrome.storage.local.get(["settings"], (result) => {
      const settings = result.settings || { customKeywords: [] };
      const keywords = settings.customKeywords || [];

      if (keywords.includes(val)) {
        alert("Keyword already exists.");
        return;
      }

      keywords.push(val);
      settings.customKeywords = keywords;

      chrome.storage.local.set({ settings }, () => {
        inputNewKeyword.value = "";
        renderKeywords();
      });
    });
  });

  // 8. Global System Configurations Sync
  async function syncSettingsForm() {
    chrome.storage.local.get(["settings"], (result) => {
      const settings = result.settings || { dailyTokenBudget: 50000, autopilotMode: false };
      inputTokenBudget.value = settings.dailyTokenBudget || 50000;
      toggleAutopilot.checked = settings.autopilotMode || false;
    });
  }

  btnSaveConfig.addEventListener("click", () => {
    const budgetVal = parseInt(inputTokenBudget.value, 10);
    const autopilotVal = toggleAutopilot.checked;

    if (isNaN(budgetVal) || budgetVal < 1000) {
      alert("Please provide a valid token budget limit (minimum 1,000).");
      return;
    }

    chrome.storage.local.get(["settings"], (result) => {
      const settings = result.settings || {};
      settings.dailyTokenBudget = budgetVal;
      settings.autopilotMode = autopilotVal;

      chrome.storage.local.set({ settings }, () => {
        alert("Global configurations successfully applied!");
        updateDashboardMetrics();
      });
    });
  });

  // 9. Global Switch: Master Firewall Status
  toggleFirewall.addEventListener("change", () => {
    const active = toggleFirewall.checked;
    
    chrome.storage.local.get(["settings"], (result) => {
      const settings = result.settings || {};
      settings.firewallEnabled = active;
      
      chrome.storage.local.set({ settings }, () => {
        console.log(`🛡️ AIReg Dashboard: Master firewall state toggled -> ${active}`);
      });
    });
  });

  // 10. Clear Logs Button Action
  btnClearLogs.addEventListener("click", () => {
    if (!confirm("Are you sure you want to clear the activity terminal logs?")) return;

    chrome.storage.local.get(["usageStats"], (result) => {
      const stats = result.usageStats || {};
      stats.dailyLogs = [];
      
      chrome.storage.local.set({ usageStats: stats }, () => {
        console.log("🛡️ AIReg Dashboard: Cleared terminal logs.");
        updateDashboardMetrics();
      });
    });
  });

  // Helper text utility functions
  function formatNumber(num) {
    return num.toLocaleString();
  }

  function formatLimit(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(0) + "k";
    return num.toString();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // Bootstrapping Core Run
  init();
});
