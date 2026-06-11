/**
 * AI Usage Regulator Extension (AIReg)
 * Page Context Interceptor Script
 * Executed directly inside the target web page's context.
 * Patches window.fetch and window.XMLHttpRequest to pause and inspect both JSON and FormData text payloads.
 */

(function () {
  console.warn("🛡️ [AIReg Page Interceptor Hooks] ACTIVE!");

  // Map to hold pending requests waiting for extension approval
  window.pendingRequests = window.pendingRequests || new Map();

  // Helper to extract text fields from FormData, isolating binary files
  function extractFormDataText(formData) {
    const textEntries = {};
    const fileEntries = [];

    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        textEntries[key] = value;
      } else {
        fileEntries.push({
          key,
          value,
          filename: value.name || undefined
        });
      }
    }
    return { textEntries, fileEntries };
  }

  // Helper to reconstruct FormData with redacted text entries
  function reconstructFormData(fileEntries, redactedTextEntries) {
    const newFormData = new FormData();
    // 1. Re-append original binary blobs/files unchanged
    fileEntries.forEach(item => {
      if (item.filename) {
        newFormData.append(item.key, item.value, item.filename);
      } else {
        newFormData.append(item.key, item.value);
      }
    });
    // 2. Append the sanitized text values
    for (const [key, val] of Object.entries(redactedTextEntries)) {
      newFormData.append(key, val);
    }
    return newFormData;
  }

  // 0. Iframe Stealing Trap
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName) {
    if (tagName && tagName.toLowerCase() === 'iframe') {
      console.warn("🛡️ [AIReg Debug] Iframe created! They might be stealing fetch().");
    }
    return originalCreateElement.apply(this, arguments);
  };

  // 1. Monkey-patch window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    let [resource, config] = args;

    // Determine target URL string
    let urlString = "";
    let fetchMethod = 'GET';
    let hasBody = false;

    if (typeof resource === 'string') {
      urlString = resource;
    } else if (resource instanceof Request) {
      urlString = resource.url;
      fetchMethod = resource.method.toUpperCase();
      // In a Request object, the body is readable via text() or body
      hasBody = true; // Assume it might have a body for filtering
    } else if (resource && typeof resource.toString === 'function') {
      urlString = resource.toString();
    }

    if (config && config.method) {
      fetchMethod = config.method.toUpperCase();
    }
    
    if (config && config.body) {
      hasBody = true;
    }

    console.warn(`🛡️ [AIReg Debug] fetch() called: ${fetchMethod} ${urlString}`);

    const isPost = fetchMethod === 'POST';

    // Filter requests: POST requests containing body to standard AI domain endpoints
    const isAIRequest = isPost && hasBody && (
      urlString.includes('/v1/chat') ||
      urlString.includes('/conversation') ||
      urlString.includes('/api/v0/conversations') ||
      urlString.includes('/_/') ||
      urlString.includes('mock') ||
      urlString.includes('/api/organizations') ||
      urlString.includes('graphql')
    );

    if (!isAIRequest) {
      return originalFetch.apply(this, args);
    }

    console.warn(`🛡️ [AIReg Interceptor] AI Fetch request intercepted to: ${urlString}`);

    // ... continue with interception logic, update config.body reference
    const fetchBody = (config && config.body) ? config.body : null;
    const isFormData = fetchBody instanceof FormData;
    let payloadText = '';
    let textEntries = null;
    let fileEntries = null;

    if (resource instanceof Request && !fetchBody) {
      // If the body is inside the Request object, we must clone and read it
      try {
        const clonedReq = resource.clone();
        payloadText = await clonedReq.text();
      } catch(e) {
        payloadText = "[Unparseable Request Body]";
      }
    } else if (isFormData) {
      // FormData: Extract only string parts, bypassing files
      const result = extractFormDataText(fetchBody);
      textEntries = result.textEntries;
      fileEntries = result.fileEntries;

      // If there are no text entries, let request pass immediately
      if (Object.keys(textEntries).length === 0) {
        return originalFetch.apply(this, args);
      }
      payloadText = JSON.stringify(textEntries);
    } else {
      // Standard JSON/Text body
      try {
        let rawText = "";
        if (typeof fetchBody === 'string') {
          rawText = fetchBody;
        } else if (fetchBody instanceof ArrayBuffer || ArrayBuffer.isView(fetchBody)) {
          rawText = new TextDecoder().decode(fetchBody);
        } else if (fetchBody instanceof Blob) {
          rawText = await fetchBody.text();
        } else if (fetchBody instanceof URLSearchParams) {
          rawText = fetchBody.toString();
        } else {
          rawText = String(fetchBody);
        }

        // Gemini uses batchexecute which is URL-encoded. We must decode it for the Redactor to see the PII.
        const isUrlEncodedFormat = typeof rawText === 'string' && rawText.includes('=') && !rawText.includes(' ') && !rawText.startsWith('{') && !rawText.startsWith('[');
        if (fetchBody instanceof URLSearchParams || isUrlEncodedFormat) {
          const params = new URLSearchParams(rawText);
          const obj = Object.fromEntries(params.entries());
          payloadText = JSON.stringify(obj);
          config._isUrlEncoded = true; // Store flag for reconstruction
        } else {
          payloadText = rawText;
        }

      } catch (e) {
        console.warn("🛡️ AIReg: Failed to parse fetch body, running flat fallback", e);
        payloadText = "[Unparseable Body]";
      }
    }

    const requestId = Math.random().toString(36).substring(2, 15);

    const decisionPromise = new Promise((resolve, reject) => {
      window.pendingRequests.set(requestId, { resolve, reject });
    });

    // Send payload to content script messaging bridge
    window.postMessage({
      source: 'aireg-page-context',
      type: 'REQUEST_INTERCEPTED',
      requestId,
      url: urlString,
      isFormData,
      bodyText: payloadText
    }, '*');

    try {
      const response = await decisionPromise;
      console.log(`🛡️ AIReg: Request ${requestId} processed with action: ${response.action}`);

      if (response.action === 'ALLOW') {
        return originalFetch.apply(this, args);
      } else if (response.action === 'MASK') {
        const newConfig = config ? { ...config } : {};

        if (isFormData) {
          // Reconstruct redacted FormData object
          const redactedText = JSON.parse(response.modifiedBody);
          newConfig.body = reconstructFormData(fileEntries, redactedText);
        } else if (newConfig._isUrlEncoded) {
          // Reconstruct URL-encoded body
          const redactedObj = JSON.parse(response.modifiedBody);
          const newParams = new URLSearchParams();
          for (const [key, val] of Object.entries(redactedObj)) {
            newParams.append(key, val);
          }
          newConfig.body = newParams.toString();
          delete newConfig._isUrlEncoded;
        } else {
          // Reconstruct plain text/JSON body
          const modifiedBody = response.modifiedBody;
          if (typeof fetchBody === 'string') {
            newConfig.body = modifiedBody;
          } else if (fetchBody instanceof ArrayBuffer || ArrayBuffer.isView(fetchBody)) {
            newConfig.body = new TextEncoder().encode(modifiedBody);
          } else if (fetchBody instanceof Blob) {
            newConfig.body = new Blob([modifiedBody], { type: fetchBody.type });
          } else {
            newConfig.body = modifiedBody;
          }
        }

        if (resource instanceof Request) {
          if (fetchMethod === 'POST') newConfig.method = 'POST';
          return originalFetch(new Request(resource, newConfig));
        }
        return originalFetch(resource, newConfig);

      } else if (response.action === 'BLOCK') {
        throw new TypeError('Request blocked by AI Usage Regulator (AIReg) firewall');
      }
    } catch (err) {
      console.error("🛡️ AIReg blocked or failed request:", err);
      throw err;
    }
  };

  // 2. Monkey-patch window.XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this._method = method;
    this._url = url;
    return originalOpen.apply(this, [method, url, ...args]);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const isPost = this._method && this._method.toUpperCase() === 'POST';
    const urlString = this._url || '';

    console.log(`🛡️ [AIReg Debug] XMLHttpRequest called: ${this._method} ${urlString}`);

    const isAIRequest = isPost && body && (
      urlString.includes('/v1/chat') ||
      urlString.includes('/conversation') ||
      urlString.includes('/api/v0/conversations') ||
      urlString.includes('/_/') ||
      urlString.includes('mock') ||
      urlString.includes('/api/organizations') ||
      urlString.includes('graphql')
    );

    if (!isAIRequest) {
      return originalSend.apply(this, arguments);
    }

    console.log(`🛡️ AIReg: XMLHttpRequest intercepted to ${urlString}`);

    const xhr = this;
    const isFormData = body instanceof FormData;

    const handleIntercept = (bodyText, fileEntries = null, isUrlEncoded = false) => {
      const requestId = Math.random().toString(36).substring(2, 15);

      window.pendingRequests.set(requestId, {
        resolve: (response) => {
          if (response.action === 'ALLOW') {
            originalSend.call(xhr, body);
          } else if (response.action === 'MASK') {
            if (isFormData) {
              const redactedText = JSON.parse(response.modifiedBody);
              const newFormData = reconstructFormData(fileEntries, redactedText);
              originalSend.call(xhr, newFormData);
            } else if (isUrlEncoded) {
              const redactedObj = JSON.parse(response.modifiedBody);
              const newParams = new URLSearchParams();
              for (const [key, val] of Object.entries(redactedObj)) {
                newParams.append(key, val);
              }
              originalSend.call(xhr, newParams.toString());
            } else {
              const modifiedBody = response.modifiedBody;
              if (typeof body === 'string') {
                originalSend.call(xhr, modifiedBody);
              } else if (body instanceof ArrayBuffer || body.isView) {
                originalSend.call(xhr, new TextEncoder().encode(modifiedBody));
              } else if (body instanceof Blob) {
                originalSend.call(xhr, new Blob([modifiedBody], { type: body.type }));
              } else {
                originalSend.call(xhr, modifiedBody);
              }
            }
          } else if (response.action === 'BLOCK') {
            console.warn(`🛡️ AIReg: Blocking XHR request ${requestId}`);
            xhr.abort();
          }
        },
        reject: () => {
          xhr.abort();
        }
      });

      window.postMessage({
        source: 'aireg-page-context',
        type: 'REQUEST_INTERCEPTED',
        requestId,
        url: urlString,
        isFormData,
        bodyText: bodyText
      }, '*');
    };

    try {
      if (isFormData) {
        const { textEntries, fileEntries } = extractFormDataText(body);
        if (Object.keys(textEntries).length === 0) {
          return originalSend.apply(this, arguments);
        }
        handleIntercept(JSON.stringify(textEntries), fileEntries, false);
      } else {
        let rawText = "";
        if (typeof body === 'string') {
          rawText = body;
        } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
          rawText = new TextDecoder().decode(body);
        } else if (body instanceof Blob) {
          // We cannot use await here because xhr.send is not an async function.
          // Since blobs in XHR send are rare for chat payloads, we fall back to a placeholder.
          // The actual text parsing would require making send async, which breaks XHR semantics.
          rawText = "[Blob Data]";
        } else {
          rawText = String(body);
        }

        const isUrlEncodedFormat = typeof rawText === 'string' && rawText.includes('=') && !rawText.includes(' ') && !rawText.startsWith('{') && !rawText.startsWith('[');
        if (isUrlEncodedFormat) {
          const params = new URLSearchParams(rawText);
          const obj = Object.fromEntries(params.entries());
          handleIntercept(JSON.stringify(obj), null, true);
        } else {
          handleIntercept(rawText, null, false);
        }
      }
    } catch (e) {
      console.warn("🛡️ AIReg: Failed to parse XMLHttpRequest body", e);
      handleIntercept("[Unparseable Body]", null, false);
    }
  };

  // 3. Monkey-patch window.WebSocket
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    console.log(`🛡️ [AIReg Debug] WebSocket created: ${url}`);
    const ws = new OriginalWebSocket(url, protocols);

    const isAIWebSocket = typeof url === 'string' && (
      url.includes('sydney.bing.com') ||
      url.includes('copilot.microsoft.com') ||
      url.includes('chatgpt.com')
    );

    const originalSend = ws.send;
    ws.send = async function (data) {
      console.log(`🛡️ [AIReg Debug] WebSocket message sent to ${ws.url}`);
      
      if (!isAIWebSocket) {
        return originalSend.apply(this, arguments);
      }

      // Try to parse the websocket frame
      let bodyText = "";
      try {
        if (typeof data === 'string') {
          bodyText = data;
        } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
          bodyText = new TextDecoder().decode(data);
        } else if (data instanceof Blob) {
          bodyText = await data.text();
        } else {
          bodyText = String(data);
        }
      } catch (e) {
        bodyText = "[Unparseable WS Frame]";
      }

      // Copilot specifically sends tiny ping/pong chunks that are safe
      if (bodyText === '{"type":6}' || bodyText.length < 10) {
        return originalSend.apply(this, arguments);
      }

      console.warn(`🛡️ AIReg: Intercepting WebSocket message to ${ws.url}`);

      const requestId = Math.random().toString(36).substring(2, 15);
      const decisionPromise = new Promise((resolve) => {
        window.pendingRequests.set(requestId, { resolve, reject: resolve });
      });

      window.postMessage({
        source: 'aireg-page-context',
        type: 'REQUEST_INTERCEPTED',
        requestId,
        url: ws.url,
        isFormData: false,
        bodyText: bodyText
      }, '*');

      try {
        const response = await decisionPromise;
        if (response.action === 'ALLOW') {
          return originalSend.apply(this, arguments);
        } else if (response.action === 'MASK') {
          let modifiedBody = response.modifiedBody;
          if (typeof data === 'string') {
            return originalSend.call(this, modifiedBody);
          } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            return originalSend.call(this, new TextEncoder().encode(modifiedBody));
          } else if (data instanceof Blob) {
            return originalSend.call(this, new Blob([modifiedBody], { type: data.type }));
          } else {
            return originalSend.call(this, modifiedBody);
          }
        } else if (response.action === 'BLOCK') {
          console.warn(`🛡️ AIReg: Blocking WebSocket message ${requestId}`);
          return; // Drop the message
        }
      } catch(e) {
        return originalSend.apply(this, arguments);
      }
    };
    return ws;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  // 4. Monkey-patch Web Workers
  const OriginalWorker = window.Worker;
  window.Worker = function (scriptURL, options) {
    console.log(`🛡️ [AIReg Debug] Web Worker spawned: ${scriptURL}`);
    return new OriginalWorker(scriptURL, options);
  };
  if (OriginalWorker) window.Worker.prototype = OriginalWorker.prototype;

  // 5. Monkey-patch sendBeacon
  if (navigator.sendBeacon) {
    const originalSendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
      console.log(`🛡️ [AIReg Debug] sendBeacon called: ${url}`);
      return originalSendBeacon.apply(this, arguments);
    };
  }

  // 6. Deep Thread Interception: Monkey-patch postMessage APIs
  function inspectAndForwardMessage(originalPostMessage, context, args) {
    const [messageData, transferables] = args;
    
    let stringifiedData = "";
    try {
      if (typeof messageData === 'string') {
        stringifiedData = messageData;
      } else if (typeof messageData === 'object' && messageData !== null) {
        stringifiedData = JSON.stringify(messageData);
      }
    } catch (e) {
      stringifiedData = "[Unstringifyable]";
    }

    // Diagnostic logging: What is being sent to workers?
    if (stringifiedData.length > 5 && !stringifiedData.includes("react-devtools")) {
      console.warn(`🛡️ [AIReg Debug] postMessage intercept:`, stringifiedData.substring(0, 150));
      
      // Let's see if the text "block-me" is in ANY postMessage
      if (stringifiedData.toLowerCase().includes("block me") || stringifiedData.toLowerCase().includes("block-me")) {
         console.warn("🛡️ AIReg: FOUND THE ESCAPE ROUTE!", stringifiedData);
      }
    }

    // For now, let all messages pass without pausing so we can safely observe
    return originalPostMessage.apply(context, args);
  }

  if (window.MessagePort) {
    const originalPortPostMessage = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (...args) {
      return inspectAndForwardMessage(originalPortPostMessage, this, args);
    };
  }

  if (navigator.serviceWorker && ServiceWorker.prototype) {
    const originalSWPostMessage = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (...args) {
      return inspectAndForwardMessage(originalSWPostMessage, this, args);
    };
  }

  const originalWindowPostMessage = window.postMessage;
  window.postMessage = function (...args) {
    return inspectAndForwardMessage(originalWindowPostMessage, this, args);
  };

  // 7. Listen for responses from the extension content script
  // We use window.addEventListener("message") for our bridge, so we must be careful not to infinite loop.
  // We added 'AIREG_INTERCEPT_WORKER' custom event to avoid using postMessage for the initial trigger.
  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg && msg.source === 'aireg-content-script' && msg.type === 'RESPONSE_DECISION') {
      const { requestId, action, modifiedBody } = msg;

      if (window.pendingRequests.has(requestId)) {
        const { resolve } = window.pendingRequests.get(requestId);
        window.pendingRequests.delete(requestId);
        resolve({ action, modifiedBody });
      }
    }
  });

})();
