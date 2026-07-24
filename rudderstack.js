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