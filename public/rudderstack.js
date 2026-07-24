(function() {
    'use strict';

    // ─── CONFIG ───
    // Replace these with your actual values from RudderStack dashboard
    const WRITE_KEY = "3Gm1kin1xBKjQnCJfuCHVDJvNsL";
    const DATA_PLANE_URL = "https://tifllittlekzei.dataplane.eu.rudderstack.com";

    // ─── v3 LOADING SNIPPET ───
    // Creates window.rudderanalytics queue BEFORE the SDK loads
    var rudderanalytics = window.rudderanalytics = window.rudderanalytics || [];

    // Define all methods that can be called before SDK loads
    var methods = [
        'load', 'page', 'track', 'identify', 'alias', 'group',
        'ready', 'reset', 'getAnonymousId', 'setAnonymousId',
        'startSession', 'endSession'
    ];

    // Factory: queues method calls until SDK is ready
    for (var i = 0; i < methods.length; i++) {
        var method = methods[i];
        rudderanalytics[method] = (function(methodName) {
            return function() {
                rudderanalytics.push([methodName].concat(Array.prototype.slice.call(arguments)));
            };
        })(method);
    }

    // ─── LOAD SDK FROM CDN ───
    // v3 uses rsa.min.js, NOT rudder-analytics.min.js citeweb_search:6#5
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = 'https://cdn.rudderlabs.com/v3/modern/rsa.min.js';  // ← v3 modern bundle

    script.onload = function() {
        console.log('[RudderStack] SDK script loaded from CDN');

        // Initialize with your credentials
        rudderanalytics.load(WRITE_KEY, DATA_PLANE_URL, {
            logLevel: 'DEBUG',  // Change to 'ERROR' in production
            onLoaded: function() {
                console.log('[RudderStack] SDK initialized successfully');
                console.log('[RudderStack] Anonymous ID:', rudderanalytics.getAnonymousId());

                // v3: page() is NOT automatic — must call explicitly citeweb_search:6#1
                rudderanalytics.page();
                console.log('[RudderStack] Initial page() call sent');
            },
            ready: function() {
                console.log('[RudderStack] All destinations ready');
            }
        });
    };

    script.onerror = function() {
        console.error('[RudderStack] FAILED to load SDK from CDN');
    };

    // Insert before first existing script
    var firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(script, firstScript);

    console.log('[RudderStack] Loading snippet executed');
})();