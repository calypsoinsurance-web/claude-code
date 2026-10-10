(function () {
  var $ = function (id) { return document.getElementById(id); };
  var vid = null; try { vid = localStorage.getItem('crm_vid'); } catch (e) { /* storage blocked */ }
  var KEY_STORE = 'crm_quote_key';
  function rid() { var a = new Uint8Array(18); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
  var petCount = 0;
  function addPet() {
    petCount += 1; var n = petCount; var box = el('fieldset'); box.appendChild(el('legend', 'Pet ' + n));
    [['Name', 'text', 'pn' + n], ['Breed (optional)', 'text', 'pb' + n], ['Age (optional, e.g. "3 years")', 'text', 'pa' + n]].forEach(function (f) { var l = el('label', f[0]); l.htmlFor = f[2]; var i = el('input'); i.id = f[2]; i.type = f[1]; i.maxLength = 80; box.appendChild(l); box.appendChild(i); });
    var l = el('label', 'Dog or cat'); l.htmlFor = 'ps' + n; var s = el('select'); s.id = 'ps' + n;
    [['', 'Choose…'], ['dog', 'Dog'], ['cat', 'Cat']].forEach(function (o) { var op = el('option', o[1]); op.value = o[0]; s.appendChild(op); });
    box.appendChild(l); box.appendChild(s); $('pets').appendChild(box);
  }
  fetch('/api/public/config').then(function (r) { return r.json(); }).then(function (cfg) {
    if (!cfg.formEnabled) { $('unavailable').hidden = false; return; }
    $('disclosure').textContent = cfg.disclosure; $('form').hidden = false; addPet();
  }).catch(function () { $('unavailable').hidden = false; });
  $('addPet').addEventListener('click', function () { if (petCount < 5) addPet(); });
  $('form').addEventListener('submit', function (e) {
    e.preventDefault(); $('error').textContent = '';
    var pets = []; for (var i = 1; i <= petCount; i++) pets.push({ name: $('pn' + i).value, species: $('ps' + i).value, breed: $('pb' + i).value, age: $('pa' + i).value });
    if (!$('consent').checked) { $('error').textContent = 'Please agree to the notice to continue.'; return; }
    var key; try { key = sessionStorage.getItem(KEY_STORE); } catch (x) { /* ignore */ }
    if (!key) { key = rid(); try { sessionStorage.setItem(KEY_STORE, key); } catch (x) { /* ignore */ } } // same key on retry = no duplicate records
    $('go').disabled = true;
    fetch('/api/public/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      idempotency_key: key, visitor_id: vid, consent: true, website: $('website').value,
      customer: { name: $('name').value, email: $('email').value, phone: $('phone').value, state: $('state').value }, pets: pets }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        $('go').disabled = false;
        if (!x.ok) { $('error').textContent = x.d.error || 'Something went wrong.'; return; }
        var out = $('result'); out.textContent = ''; out.appendChild(el('p', x.d.message));
        (x.d.quotes || []).forEach(function (q) { var b = el('div', null, 'quote'); b.appendChild(el('strong', q.pet)); b.appendChild(el('p', '$' + (q.premium_cents / 100).toFixed(2) + ' per ' + q.payment_frequency)); out.appendChild(b); });
        if (x.d.status === 'completed') { $('form').hidden = true; try { sessionStorage.removeItem(KEY_STORE); } catch (z) { /* ignore */ } }
      }).catch(function () { $('go').disabled = false; $('error').textContent = 'Network problem. Please try again; your details will not be duplicated.'; });
  });
})();
