(() => {
  'use strict';
  const REFRESH_MS = 45000;
  const TZ = 'Europe/Berlin';
  const LABEL = { verfuegbar: 'verfügbar', wenige: 'nur noch wenige', ausverkauft: 'ausverkauft' };
  const LOW_STOCK = 2; // identisch zu lib/store.js
  // Statuslogik exakt wie lib/store.js -> status(qty)
  const status = qty => (!qty || qty <= 0) ? 'ausverkauft' : (qty <= LOW_STOCK ? 'wenige' : 'verfuegbar');
  // Rohdaten aus inventory.json so aufbereiten wie früher server.js (/api/bestand)
  const normalize = d => ({
    machineName: d.machineName, location: d.location, example: !!d.example, note: d.note || null, updatedAt: d.updatedAt, checkedAt: d.checkedAt,
    lastRefill: d.lastRefill || null, nextRefill: d.nextRefill || null, nextRefillNote: d.nextRefillNote || null,
    items: (Array.isArray(d.items) ? d.items : [])
      .map(i => ({ name: i.name, fach: i.fach || null, price: Number(i.price) || 0, quantity: Math.max(0, Number(i.quantity) || 0), category: i.category || null, emoji: i.emoji || null, detailKey: i.detailKey || null, updatedAt: i.updatedAt || d.updatedAt, status: status(Number(i.quantity)) }))
      .sort((a, b) => (b.price - a.price) || String(a.name).localeCompare(String(b.name), 'de'))
  });
  const $ = id => document.getElementById(id);
  const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const fmtTime = iso => new Date(iso).toLocaleString('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  const fmtDate = iso => new Date(iso).toLocaleString('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  const validDate = iso => iso && !isNaN(new Date(iso));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let data = null, filter = 'Alle', details = null;
  const open = new Set();
  // Namen vergleichbar machen: klein, Umlaute aufgelöst, nur Buchstaben/Ziffern
  const key = s => String(s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
  const slug = s => 'd-' + key(s);
  function detailFor(item) {
    const P = details && details.products;
    if (!P) return null;
    if (item.detailKey && P[item.detailKey]) return P[item.detailKey];
    const n = key(item.name);
    for (const k in P) if (key(k) === n || (P[k].aliases || []).some(a => key(a) === n)) return P[k];
    return null;
  }
  const hasInfo = d => !!(d && (d.ingredients || d.weight));
  // Allergen-Wörter aus der Zutatenliste fett hervorheben (Text wird vorher escaped)
  function markIngredients(text, allergens) {
    let h = esc(text);
    const words = [...new Set((allergens || []).flatMap(a => a.words || []))].sort((a, b) => b.length - a.length);
    if (words.length) {
      const re = new RegExp('(?<![\\p{L}])(' + words.map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}])', 'gu');
      h = h.replace(re, '<strong>$1</strong>');
    }
    return h;
  }
  function panel(i, d) {
    const al = (d.allergens || []).filter(a => a.name);
    return `<div class="details" id="${slug(i.name)}" role="region" aria-label="Details zu ${esc(i.name)}"${open.has(i.name) ? '' : ' hidden'}>
        <div class="d-top">
          ${d.weight ? `<div class="d-weight"><span class="muted">${/liter|ml/i.test(d.weight) ? 'Inhalt' : 'Gewicht'}</span><strong>${esc(d.weight)}</strong></div>` : ''}
          ${d.portions ? `<div class="d-portions">${esc(d.portions)}</div>` : ''}
        </div>
        ${d.ingredients ? `<h3>Zutaten</h3><p class="d-ingr">${markIngredients(d.ingredients, al)}</p>` : ''}
        ${al.length ? `<p class="d-allerg"><span>Laut Zutatenliste enthalten:</span> ${al.map(a => '<strong>' + esc(a.name) + '</strong>' + (a.words && a.words.length && key(a.words.join()) !== key(a.name) ? ' (' + a.words.map(esc).join(', ') + ')' : '')).join(', ')}</p>` : ''}
        ${(d.hints || []).length ? `<h3>Hinweise</h3><ul class="d-hints">${d.hints.map(h => '<li>' + esc(h) + '</li>').join('')}</ul>` : ''}
        <p class="d-small">${esc(details.hinweis || 'Angaben laut Etikett, maßgeblich ist das Etikett auf der Packung.')}</p>
        ${details.hersteller ? `<p class="d-small">Hergestellt von ${esc(details.hersteller)}</p>` : ''}
      </div>`;
  }

  function relative(iso) {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'gerade eben';
    if (m < 60) return `vor ${m} Min.`;
    const h = Math.round(m / 60);
    if (h < 24) return `vor ${h} Std.`;
    return null;
  }

  function render() {
    if (!data) return;
    $('machine').textContent = data.machineName || 'Unser Automat';
    $('location').textContent = data.location || '';
    const ex = $('example');
    ex.hidden = !data.example;
    if (data.example) ex.textContent = '⚠ ' + (data.note || 'Beispieldaten – nicht der echte Bestand.');

    // Befüllungs-Info: letzte nur wenn bekannt, nächste nur wenn angekündigt und noch in der Zukunft
    const last = validDate(data.lastRefill), next = validDate(data.nextRefill) && new Date(data.nextRefill) > Date.now();
    $('refill-last').hidden = !last;
    if (last) $('refill-last-val').textContent = fmtDate(data.lastRefill);
    $('refill-next').hidden = !next;
    if (next) {
      $('refill-next-val').textContent = fmtDate(data.nextRefill);
      $('refill-next-note').textContent = data.nextRefillNote ? ' – ' + data.nextRefillNote : '';
    }
    $('refill').hidden = !last && !next;

    const stamp = data.checkedAt || data.updatedAt;
    const rel = relative(stamp);
    $('updated').textContent = stamp ? fmtTime(stamp) + (rel ? ` (${rel})` : '') : '–';

    const counts = { verfuegbar: 0, wenige: 0, ausverkauft: 0 };
    data.items.forEach(i => counts[i.status]++);
    $('summary').innerHTML = Object.keys(counts).filter(k => counts[k]).map(k => `<span class="pill ${k}">${counts[k]} ${LABEL[k]}</span>`).join('');

    const cats = ['Alle', ...new Set(data.items.map(i => i.category).filter(Boolean)), 'Verfügbar'];
    if (!cats.includes(filter)) filter = 'Alle';
    filter = 'Alle';
    if ($('filters')) $('filters').hidden = true;
    

    const items = data.items.filter(i => filter === 'Alle' || (filter === 'Verfügbar' ? i.status !== 'ausverkauft' : i.category === filter));
    const list = $('list');
    list.setAttribute('aria-busy', 'false');
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.name : null;
    list.innerHTML = items.length ? items.map(i => {
      const d = detailFor(i), info = hasInfo(d), isOpen = info && open.has(i.name);
      const icon = d && d.icon ? `<img src="${esc(d.icon)}" alt="" width="52" height="52" decoding="async">` : esc(i.emoji || '🛒');
      const meta = [i.fach ? 'Fach ' + esc(i.fach) : '', d && d.weight ? esc(d.weight) : ''].filter(Boolean).join(' · ');
      const row = `
        <div class="emoji${d && d.icon ? ' has-icon' : ''}" aria-hidden="true">${icon}</div>
        <span class="info">
          <span class="name">${esc(i.name)}</span>
          <span class="meta">${meta}</span>
          ${d && d.age ? `<span class="age">Erst ab ${esc(d.age)} Jahren – Alterskontrolle folgt am Automaten</span>` : ''}
          <span class="tags"><span class="pill ${i.status}">${LABEL[i.status]}</span>${info ? '<span class="more">Zutaten &amp; Gewicht<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : ''}</span>
        </span>
        <span class="right">
          <span class="qty"><b>${i.quantity > 0 ? i.quantity : 0}</b> Stk.</span>
          <span class="price">${eur.format(i.price)}</span>
        </span>`;
      return `
      <li class="item ${i.status}${isOpen ? ' open' : ''}">
        ${info ? `<button type="button" class="row" data-name="${esc(i.name)}" aria-expanded="${isOpen}" aria-controls="${slug(i.name)}">${row}</button>${panel(i, d)}` : `<div class="row">${row}</div>`}
      </li>`;
    }).join('') : '<li class="empty">Keine Artikel in dieser Auswahl.</li>';
    if (focused) { const b = list.querySelector(`button.row[data-name="${CSS.escape(focused)}"]`); if (b) b.focus({ preventScroll: true }); }
  }

  async function loadDetails() {
    try {
      const r = await fetch('details.json?v=8', { cache: 'no-cache' });
      if (r.ok) details = await r.json();
    } catch (e) { /* ohne Details weiter mit Emojis */ }
  }

  // #open=Name (oder Schlüssel aus details.json) öffnet ein Panel beim Laden
  function openFromHash() {
    const m = /(?:^#|&)open=([^&]+)/.exec(location.hash);
    if (!m || !data) return;
    const want = key(decodeURIComponent(m[1]));
    const it = data.items.find(i => key(i.name) === want || (details && details.products && details.products[decodeURIComponent(m[1])] === detailFor(i) && detailFor(i)));
    if (it && hasInfo(detailFor(it))) {
      open.add(it.name); render();
      const b = $('list').querySelector(`button.row[data-name="${CSS.escape(it.name)}"]`);
      if (b && b.getBoundingClientRect().top > window.innerHeight - 80) b.scrollIntoView({ block: 'nearest' });
    }
  }

  $('list').addEventListener('click', e => {
    const b = e.target.closest('button.row');
    if (!b) return;
    const n = b.dataset.name, li = b.closest('.item'), p = document.getElementById(b.getAttribute('aria-controls'));
    const now = !open.has(n);
    if (now) open.add(n); else open.delete(n);
    b.setAttribute('aria-expanded', String(now));
    li.classList.toggle('open', now);
    if (p) p.hidden = !now;
  });

  async function load() {
    try {
      // relativer Pfad -> funktioniert unter https://<user>.github.io/<repo>/ und lokal
      const r = await fetch('inventory.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      data = normalize(await r.json());
      $('error').hidden = true;
      render();
    } catch (e) {
      $('error').hidden = false;
    }
  }

  if ($('filters')) $('filters').addEventListener('click', e => {
    const b = e.target.closest('button[data-cat]');
    if (b) { filter = b.dataset.cat; render(); }
  });
  window.addEventListener('hashchange', openFromHash);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  Promise.all([loadDetails(), load()]).then(() => { render(); openFromHash(); });
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  setInterval(render, 30000); // "vor X Min." aktuell halten
})();

// Optional: Hoehe an die einbettende Seite melden (nur wenn dort ein passender Listener steht)
(function(){
  if (window.self === window.top) return;
  var last = 0;
  function post(){
    var h = Math.ceil(document.documentElement.scrollHeight);
    if (h !== last) { last = h; try { window.parent.postMessage({ type: 'automat-height', height: h }, '*'); } catch (e) {} }
  }
  window.addEventListener('load', post);
  window.addEventListener('resize', post);
  if (window.ResizeObserver) new ResizeObserver(post).observe(document.body);
  setInterval(post, 1500);
})();
