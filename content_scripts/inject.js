/**
 * AI Usage Regulator Extension (AIReg)
 * Content Script Injector
 * Runs in isolated extension content script context at document_start.
 */

(function() {
  console.warn("🛡️ [AIReg Content Script Injector] ACTIVE and injecting page_context.js...");

  try {
    // Determine document root or head to insert script
    const container = document.head || document.documentElement;
    if (container) {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('page_contexts/page_context.js');
      script.type = 'text/javascript';
      script.async = false; // run synchronously relative to document loading
      
      // Inject at the very beginning of the tag so it runs before page scripts
      container.insertBefore(script, container.firstChild);
      
      // Tidy up after execution
      script.onload = function() {
        script.remove();
      };
      
      console.log("🛡️ AIReg: page_context.js injected successfully into web page context.");
    } else {
      console.error("🛡️ AIReg: No injection container found. Failed to inject interceptor.");
    }
  } catch (err) {
    console.error("🛡️ AIReg: Error during page_context injection:", err);
  }
})();
