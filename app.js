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
    machineName: d.machineName, location: d.location, example: !!d.example, note: d.note || null, updatedAt: d.updatedAt,
    lastRefill: d.lastRefill || null, nextRefill: d.nextRefill || null, nextRefillNote: d.nextRefillNote || null,
    items: (Array.isArray(d.items) ? d.items : [])
      .map(i => ({ name: i.name, fach: i.fach || null, price: Number(i.price) || 0, quantity: Math.max(0, Number(i.quantity) || 0), category: i.category || null, emoji: i.emoji || null, updatedAt: i.updatedAt || d.updatedAt, status: status(Number(i.quantity)) }))
      .sort((a, b) => String(a.fach || '').localeCompare(String(b.fach || ''), 'de', { numeric: true }))
  });
  const $ = id => document.getElementById(id);
  const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const fmtTime = iso => new Date(iso).toLocaleString('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  const fmtDate = iso => new Date(iso).toLocaleString('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  const validDate = iso => iso && !isNaN(new Date(iso));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let data = null, filter = 'Alle';

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

    const rel = relative(data.updatedAt);
    $('updated').textContent = data.updatedAt ? fmtTime(data.updatedAt) + (rel ? ` (${rel})` : '') : '–';

    const counts = { verfuegbar: 0, wenige: 0, ausverkauft: 0 };
    data.items.forEach(i => counts[i.status]++);
    $('summary').innerHTML = Object.keys(counts).filter(k => counts[k]).map(k => `<span class="pill ${k}">${counts[k]} ${LABEL[k]}</span>`).join('');

    const cats = ['Alle', ...new Set(data.items.map(i => i.category).filter(Boolean)), 'Verfügbar'];
    if (!cats.includes(filter)) filter = 'Alle';
    filter = 'Alle';
    $('filters').hidden = true;
    $('filters').innerHTML = '';

    const items = data.items.filter(i => filter === 'Alle' || (filter === 'Verfügbar' ? i.status !== 'ausverkauft' : i.category === filter));
    const list = $('list');
    list.setAttribute('aria-busy', 'false');
    list.innerHTML = items.length ? items.map(i => `
      <li class="item ${i.status}">
        <div class="emoji" aria-hidden="true">${esc(i.emoji || '🛒')}</div>
        <div class="info">
          <p class="name">${esc(i.name)}</p>
          <p class="meta">${i.fach ? 'Fach ' + esc(i.fach) : ''}</p>
          <span class="pill ${i.status}">${LABEL[i.status]}</span>
        </div>
        <div class="right">
          <span class="price">${eur.format(i.price)}</span>
          <span class="qty">${i.quantity > 0 ? i.quantity + ' Stk.' : '–'}</span>
        </div>
      </li>`).join('') : '<li class="empty">Keine Artikel in dieser Auswahl.</li>';
  }

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

  $('filters').addEventListener('click', e => {
    const b = e.target.closest('button[data-cat]');
    if (b) { filter = b.dataset.cat; render(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  load();
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  setInterval(render, 30000); // "vor X Min." aktuell halten
})();
