/* ============================================================
   RUDDERSTACK — client-side (browser) event layer
   ⚙️ EDIT ME: set your real write key + data plane URL below.
   Get both from RudderStack dashboard → Sources → Website (JS SDK).
   These are public/client-safe by design (same as a GA measurement ID).
============================================================= */
const RUDDERSTACK_WRITE_KEY = "3Gm1kin1xBKjQnCJfuCHVDJvNsL";
const RUDDERSTACK_DATA_PLANE_URL = "https://tifllittlekzei.dataplane.eu.rudderstack.com";

!function(){"use strict";window.RudderSnippetVersion="3.0.34";var sdkBaseUrl="https://cdn.rudderlabs.com/v3";var sdkFileName="rsa.min.js";var asyncScript=1;
!function(e,n){e.__RudderSnippetVersion=n.RudderSnippetVersion||"3.0.34";var o=[],r={};n.methods=["setDefaultInstanceKey","load","ready","page","track","identify","alias","group","reset","setAnonymousId","startSession","endSession","consent"];n.factory=function(e){return r[e]||(r[e]=function(){var n=Array.prototype.slice.call(arguments);o.push({t:Date.now(),m:e,a:n})}),r[e]};for(var t=0;t<n.methods.length;t++){var s=n.methods[t];n[s]=n.factory(s)}n.loadJS=function(e,n){var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(o,r);if(n)o.onload=n};n.loadJS();n.getStorage=function(){return window.localStorage};window.rudderAnalyticsBuffer=o;window.rudderanalytics=n}(window,n=window.rudderanalytics||[])}();

if(RUDDERSTACK_WRITE_KEY && RUDDERSTACK_WRITE_KEY.indexOf("YOUR_") !== 0){
  window.rudderanalytics.load(RUDDERSTACK_WRITE_KEY, RUDDERSTACK_DATA_PLANE_URL);
}

/* ---------- shared context on every call ---------- */
function rsPageContext(){
  return {
    page_path: window.location.pathname,
    page_location: window.location.href,
    page_title: document.title,
    page_referrer: document.referrer || null
  };
}

/* ---------- public helpers used across script.js ---------- */
function rsPage(){
  window.rudderanalytics.page(document.title, rsPageContext());
}
function rsTrack(eventName, properties){
  window.rudderanalytics.track(eventName, Object.assign({}, rsPageContext(), properties || {}));
}
function rsIdentify(userId, traits){
  window.rudderanalytics.identify(userId, Object.assign({}, rsPageContext(), traits || {}));
}
