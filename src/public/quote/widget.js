// Wires Fetch's widget (loaded by the <script> tag in index.html) using the documented calls from the supplied snippet:
// fetchQuoteWidget.on("ready"|"init"|"complete"), .init({tag}), .invoke({...}).
// The widget runs inside Fetch's iframe. Nothing here reads or invents quote data.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var vid = null; try { vid = localStorage.getItem('crm_vid'); } catch (e) { /* storage blocked */ }
  var cfgPromise = fetch('/api/public/config').then(function (r) { return r.json(); });
  function problem() { $('problem').hidden = false; }
  function record(event, payload) {
    cfgPromise.then(function (cfg) {
      if (!cfg.widget || !cfg.widget.capture) return;
      var body; try { body = JSON.stringify({ visitor_id: vid, event: event, page_url: location.origin + location.pathname, payload: payload === undefined ? null : payload }); } catch (e) { return; }
      fetch('/api/public/widget-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    });
  }
  cfgPromise.then(function (cfg) {
    if (!cfg.widget || !cfg.widget.enabled) { $('unavailable').hidden = false; $('quoteForm').hidden = true; return; }
    if (cfg.widgetNotice) { $('notice').textContent = cfg.widgetNotice; $('notice').hidden = false; }
    if (typeof window.fetchQuoteWidget === 'undefined') { problem(); return; }
    var w = window.fetchQuoteWidget;
    w.on('ready', function () { record('ready'); w.init({ tag: 'quoteForm' }); });
    w.on('init', function (response, error) {
      if (response && response.isInitialized) { record('init', { isInitialized: true }); w.invoke(cfg.widget.invoke); }
      else { record('error', { stage: 'init', error: String(error) }); problem(); }
    });
    w.on('complete', function (response, error) {
      if (response) record('complete', response); else record('error', { stage: 'complete', error: String(error) });
    });
  }).catch(problem);
})();
