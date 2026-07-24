
/* ============================================================
   RUDDERSTACK — client-side (browser) event layer
   ⚙️ EDIT ME: set your real write key + data plane URL below.
============================================================= */

// ─── CONFIG ───
const RUDDERSTACK_WRITE_KEY = "3Gm1kin1xBKjQnCJfuCHVDJvNsL";
const RUDDERSTACK_DATA_PLANE_URL = "https://tifllittlekzei.dataplane.eu.rudderstack.com";

// ─── v3 LOADING SNIPPET (FIXED) ───
!function() {
    "use strict";
    window.RudderSnippetVersion = "3.0.34";
    var sdkBaseUrl = "https://cdn.rudderlabs.com/v3";
    var sdkFileName = "rsa.min.js";
    
    var e = window;
    var n = window.rudderanalytics = window.rudderanalytics || [];
    
    e.__RudderSnippetVersion = n.RudderSnippetVersion || "3.0.34";
    var o = [];
    var r = {};
    
    n.methods = ["setDefaultInstanceKey","load","ready","page","track","identify","alias","group","reset","setAnonymousId","startSession","endSession","consent"];
    
    n.factory = function(e) {
        return r[e] || (r[e] = function() {
            var n = Array.prototype.slice.call(arguments);
            o.push({t: Date.now(), m: e, a: n});
            return r[e];
        });
    };
    
    for (var t = 0; t < n.methods.length; t++) {
        var s = n.methods[t];
        n[s] = n.factory(s);
    }
    
    n.loadJS = function(url, callback) {
        var script = document.createElement("script");
        script.type = "text/javascript";
        script.async = true;
        script.src = url;
        var firstScript = document.getElementsByTagName("script")[0];
        firstScript.parentNode.insertBefore(script, firstScript);
        if (callback) script.onload = callback;
    };
    
    // ─── FIXED: Pass URL and callback ───
    n.loadJS(sdkBaseUrl + "/" + sdkFileName, function() {
        console.log("[RudderStack] SDK script loaded");
        
        if (RUDDERSTACK_WRITE_KEY && RUDDERSTACK_WRITE_KEY.indexOf("YOUR_") !== 0) {
            n.load(RUDDERSTACK_WRITE_KEY, RUDDERSTACK_DATA_PLANE_URL, {
                logLevel: "DEBUG",
                onLoaded: function() {
                    console.log("[RudderStack] SDK initialized");
                    console.log("[RudderStack] Anonymous ID:", n.getAnonymousId());
                    n.page();  // v3: page() is NOT automatic
                }
            });
        } else {
            console.error("[RudderStack] WRITE_KEY not set! Replace YOUR_JS_WRITE_KEY");
        }
    });
    
    window.rudderAnalyticsBuffer = o;
    console.log("[RudderStack] Loading snippet executed");
}();

/* ---------- shared context on every call ---------- */
function rsPageContext() {
    return {
        page_path: window.location.pathname,
        page_location: window.location.href,
        page_title: document.title,
        page_referrer: document.referrer || null
    };
}

/* ---------- public helpers ---------- */
function rsPage() {
    if (window.rudderanalytics && window.rudderanalytics.page) {
        window.rudderanalytics.page(document.title, rsPageContext());
    }
}

function rsTrack(eventName, properties) {
    if (window.rudderanalytics && window.rudderanalytics.track) {
        window.rudderanalytics.track(eventName, Object.assign({}, rsPageContext(), properties || {}));
    }
}

function rsIdentify(userId, traits) {
    if (window.rudderanalytics && window.rudderanalytics.identify) {
        window.rudderanalytics.identify(userId, Object.assign({}, rsPageContext(), traits || {}));
    }
}