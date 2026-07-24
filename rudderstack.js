const RUDDERSTACK_WRITE_KEY = "3Gm1kin1xBKjQnCJfuCHVDJvNsL";
const RUDDERSTACK_DATA_PLANE_URL = "https://tifllittlekzei.dataplane.eu.rudderstack.com";

/* ---------- loading snippet ----------
   Uses the stable, non-versioned loader URL (cdn.rudderlabs.com/v1.1/...)
   instead of a hardcoded SDK version path -- that URL always resolves to
   the current supported build server-side, so there's no version number
   here to go stale or typo. The track/page/identify API is unchanged
   across SDK versions, so nothing else in this file needs to change. */
!function(){
  var e = window.rudderanalytics = window.rudderanalytics || [];
  e.methods = ["load","page","track","identify","alias","group","ready","reset",
    "getAnonymousId","setAnonymousId","getUserId","getUserTraits","getGroupId",
    "getGroupTraits","startSession","endSession","consent"];
  e.factory = function(t){
    return function(){
      var r = Array.prototype.slice.call(arguments);
      r.unshift(t);
      e.push(r);
      return e;
    };
  };
  for (var t = 0; t < e.methods.length; t++) {
    var r = e.methods[t];
    e[r] = e.factory(r);
  }
  e.loadJS = function(){
    var script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = "https://cdn.rudderlabs.com/v1.1/rudder-analytics.min.js";
    var firstScript = document.getElementsByTagName("script")[0];
    firstScript.parentNode.insertBefore(script, firstScript);
  };
  e.loadJS();

  if (RUDDERSTACK_WRITE_KEY && RUDDERSTACK_WRITE_KEY.indexOf("YOUR_") !== 0) {
    e.load(RUDDERSTACK_WRITE_KEY, RUDDERSTACK_DATA_PLANE_URL);
    e.page();
  } else {
    console.error("[RudderStack] WRITE_KEY not set!");
  }
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