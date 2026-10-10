// Tracking snippet. Embed on your website pages:  <script src="https://YOUR-CRM-HOST/t.js" async></script>
// It does nothing unless the server has TRACKING_ENABLED=true. It stores a random visitor id in first-party storage and
// reports the page's UTM parameters, supported click IDs and referrer. It collects no names, emails or form contents.
(function () {
  var script = document.currentScript;
  var base = script && script.src ? new URL(script.src).origin : '';
  var KEY = 'crm_vid';
  function rid() { var a = new Uint8Array(18); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function getId() {
    try { var v = localStorage.getItem(KEY); if (v) return v; v = rid(); localStorage.setItem(KEY, v); return v; } catch (e) { return null; }
  }
  fetch(base + '/api/public/config').then(function (r) { return r.json(); }).then(function (cfg) {
    if (!cfg.trackingEnabled) return;
    var id = getId(); if (!id) return;
    var p = new URL(location.href).searchParams;
    var click = {}; ['fbclid', 'gclid', 'wbraid', 'gbraid', 'ttclid', 'li_fat_id', 'msclkid'].forEach(function (k) { if (p.get(k)) click[k] = p.get(k); });
    fetch(base + '/api/public/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({
      visitor_id: id, landing_url: location.origin + location.pathname, referrer: document.referrer || '',
      utm_source: p.get('utm_source'), utm_medium: p.get('utm_medium'), utm_campaign: p.get('utm_campaign'), utm_content: p.get('utm_content'), utm_term: p.get('utm_term'), utm_id: p.get('utm_id'), click_ids: click }) }).catch(function () {});
  }).catch(function () {});
})();
