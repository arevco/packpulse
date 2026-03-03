var HEAP_SRC_BASE = "https://cdn.us.heap-api.com/config/";

function createStub(name) {
  return function() {
    var args = Array.prototype.slice.call(arguments, 0);
    window.heapReadyCb.push({
      name: name,
      fn: function() {
        if (window.heap && typeof window.heap[name] === "function") {
          window.heap[name].apply(window.heap, args);
        }
      },
    });
  };
}

export function initHeapAnalytics() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__heapLoaded) return;

  var appId = String(import.meta.env.VITE_HEAP_APP_ID || "1724809415").trim();
  if (!appId) return;

  var enableInDev = String(import.meta.env.VITE_HEAP_ENABLE_DEV || "").toLowerCase() === "true";
  if (!import.meta.env.PROD && !enableInDev) return;

  window.heapReadyCb = window.heapReadyCb || [];
  window.heap = window.heap || [];
  window.heap.envId = appId;
  window.heap.clientConfig = { shouldFetchServerConfig: false };
  window.__heapLoaded = true;

  var methods = [
    "init",
    "startTracking",
    "stopTracking",
    "track",
    "resetIdentity",
    "identify",
    "getSessionId",
    "getUserId",
    "getIdentity",
    "addUserProperties",
    "addEventProperties",
    "removeEventProperty",
    "clearEventProperties",
    "addAccountProperties",
    "addAdapter",
    "addTransformer",
    "addTransformerFn",
    "onReady",
    "addPageviewProperties",
    "removePageviewProperty",
    "clearPageviewProperties",
    "trackPageview",
  ];
  for (var i = 0; i < methods.length; i++) {
    if (typeof window.heap[methods[i]] !== "function") {
      window.heap[methods[i]] = createStub(methods[i]);
    }
  }

  var script = document.createElement("script");
  script.type = "text/javascript";
  script.async = true;
  script.src = HEAP_SRC_BASE + appId + "/heap_config.js";
  var firstScript = document.getElementsByTagName("script")[0];
  if (firstScript && firstScript.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  // Emit a guaranteed initial pageview/event so data appears quickly in Heap.
  try {
    if (window.heap && typeof window.heap.trackPageview === "function") {
      window.heap.trackPageview();
    }
    if (window.heap && typeof window.heap.track === "function") {
      window.heap.track("PackPulse Loaded", {
        path: window.location && window.location.pathname ? window.location.pathname : "",
      });
    }
  } catch (_) {}
}
