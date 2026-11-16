/*
  Slice 15a: loads the Cloudflare Web Analytics beacon (first-party, external, so CSP stays script-src 'self' + the
  Cloudflare origin, no inline script). The build adds the tag for this file only when a token is configured.
  The beacon is NOT loaded on /panel/invite/*: that URL carries a secret invite token, which must never be
  sent to analytics. Nothing in the app navigates to such a URL client-side, so a decision at load time is enough.
*/
(function () {
  try {
    var me = document.querySelector("script[data-atlas-beacon]");
    var token = me && me.getAttribute("data-atlas-beacon");
    if (!token || /^\/panel\/invite(\/|$)/.test(location.pathname)) return;
    var s = document.createElement("script");
    s.defer = true;
    s.src = "https://static.cloudflareinsights.com/beacon.min.js";
    s.setAttribute("data-cf-beacon", JSON.stringify({ token: token }));
    document.head.appendChild(s);
  } catch (e) {
    // Analytics must never break the app.
  }
})();
