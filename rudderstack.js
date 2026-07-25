/* ============================================================
   RUDDERSTACK — client-side (browser) event layer
   Loading snippet below is copied verbatim from the RudderStack
   dashboard (Source -> JavaScript -> Setup) -- do not hand-edit
   the IIFE. Write key + data plane URL are baked in as provided
   by RudderStack for this specific source.
   NOTE: this file is loaded via <script src="rudderstack.js">,
   so it must be pure JS -- the <script> wrapper tags RudderStack's
   dashboard gives you (for pasting into an HTML <head> directly)
   are intentionally left out here.
============================================================= */
!function(){"use strict";window.RudderSnippetVersion="3.2.0";var e="rudderanalytics";window[e]||(window[e]=[])
;var rudderanalytics=window[e];if(Array.isArray(rudderanalytics)){
if(true===rudderanalytics.snippetExecuted&&window.console&&console.error){
console.error("RudderStack JavaScript SDK snippet included more than once.")}else{rudderanalytics.snippetExecuted=true,
window.rudderAnalyticsBuildType="legacy";var sdkBaseUrl="https://cdn.rudderlabs.com";var sdkVersion="v3"
;var sdkFileName="rsa.min.js";var scriptLoadingMode="async"
;var r=["setDefaultInstanceKey","load","ready","page","track","identify","alias","group","reset","setAnonymousId","startSession","endSession","consent","addCustomIntegration"]
;for(var n=0;n<r.length;n++){var t=r[n];rudderanalytics[t]=function(r){return function(){var n
;Array.isArray(window[e])?rudderanalytics.push([r].concat(Array.prototype.slice.call(arguments))):null===(n=window[e][r])||void 0===n||n.apply(window[e],arguments)
}}(t)}try{
new Function('class Test{field=()=>{};test({prop=[]}={}){return prop?(prop?.property??[...prop]):import("");}}'),
window.rudderAnalyticsBuildType="modern"}catch(i){}var d=document.head||document.getElementsByTagName("head")[0]
;var o=document.body||document.getElementsByTagName("body")[0];window.rudderAnalyticsAddScript=function(e,r,n){
var t=document.createElement("script");t.src=e,t.setAttribute("data-loader","RS_JS_SDK"),r&&n&&t.setAttribute(r,n),
"async"===scriptLoadingMode?t.async=true:"defer"===scriptLoadingMode&&(t.defer=true),
d?d.insertBefore(t,d.firstChild):o.insertBefore(t,o.firstChild)},window.rudderAnalyticsMount=function(){!function(){
if("undefined"==typeof globalThis){var e;var r=function getGlobal(){
return"undefined"!=typeof self?self:"undefined"!=typeof window?window:null}();r&&Object.defineProperty(r,"globalThis",{
value:r,configurable:true})}
}(),window.rudderAnalyticsAddScript("".concat(sdkBaseUrl,"/").concat(sdkVersion,"/").concat(window.rudderAnalyticsBuildType,"/").concat(sdkFileName),"data-rsa-write-key","3Gm1kin1xBKjQnCJfuCHVDJvNsL")
},
"undefined"==typeof Promise||"undefined"==typeof globalThis?window.rudderAnalyticsAddScript("https://polyfill-fastly.io/v3/polyfill.min.js?version=3.111.0&features=Symbol%2CPromise&callback=rudderAnalyticsMount"):window.rudderAnalyticsMount()
;var loadOptions={};rudderanalytics.load("3Gm1kin1xBKjQnCJfuCHVDJvNsL","https://tifllittlekzei.dataplane.eu.rudderstack.com",loadOptions)}}}();

/* ---------- shared context on every call ---------- */
function rsPageContext() {
  return {
    page_path: window.location.pathname,
    page_location: window.location.href,
    page_title: document.title,
    page_referrer: document.referrer || null
  };
}

/* ============================================================
   ATTRIBUTION — captured once per visit from the URL, persisted
   so it survives navigation across your multi-page site.
   - "first touch" is written once and never overwritten — the
     original campaign that brought this visitor to the site.
   - "last touch" is overwritten every time new UTM params show
     up in the URL — the most recent campaign that referred them.
   Forwarded to the backend on booking/order/signup submissions so
   the Python SDK can attach it to server-side events too, and
   stitched by anonymousId so it's the same person either side.
============================================================= */
function rsCaptureAttribution() {
  const params = new URLSearchParams(window.location.search);
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
  const found = {};
  let hasUtm = false;
  utmKeys.forEach(k => {
    if (params.get(k)) { found[k] = params.get(k); hasUtm = true; }
  });

  const readStored = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  };
  const writeStored = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  };

  if (!readStored("tifl_first_touch")) {
    writeStored("tifl_first_touch", {
      utm_source: found.utm_source || null,
      utm_medium: found.utm_medium || null,
      utm_campaign: found.utm_campaign || null,
      utm_term: found.utm_term || null,
      utm_content: found.utm_content || null,
      gclid: found.gclid || null,
      fbclid: found.fbclid || null,
      referrer: document.referrer || null,
      landing_page: window.location.href,
      captured_at: new Date().toISOString()
    });
  }

  if (hasUtm) {
    writeStored("tifl_last_touch", {
      utm_source: found.utm_source || null,
      utm_medium: found.utm_medium || null,
      utm_campaign: found.utm_campaign || null,
      utm_term: found.utm_term || null,
      utm_content: found.utm_content || null,
      gclid: found.gclid || null,
      fbclid: found.fbclid || null,
      referrer: document.referrer || null,
      landing_page: window.location.href,
      captured_at: new Date().toISOString()
    });
  }
}
rsCaptureAttribution();

// Returns { first_touch: {...}, last_touch: {...} } for attaching to
// any form submission (booking, order, signup) sent to the backend.
function rsGetAttribution() {
  const read = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  };
  const firstTouch = read("tifl_first_touch");
  const lastTouch = read("tifl_last_touch") || firstTouch;
  return { first_touch: firstTouch, last_touch: lastTouch };
}

// The browser-side identity RudderStack already tracks anonymous
// visitors with — send this to the backend so server-side track()/
// identify() calls stitch into the same identity graph instead of
// starting a disconnected trail.
function rsGetAnonymousId() {
  try {
    if (window.rudderanalytics && window.rudderanalytics.getAnonymousId) {
      return window.rudderanalytics.getAnonymousId();
    }
  } catch (e) {}
  return null;
}

/* ---------- public helpers used across script.js ---------- */
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
