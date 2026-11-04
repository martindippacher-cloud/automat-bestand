'use strict';
// Admin-Seite: Bestand manuell über die GitHub Contents API pflegen.
const REPO = 'martindippacher-cloud/automat-bestand';
const PATH = 'inventory.json';
const API = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
const LS_KEY = 'automatBestandToken';

// ---------- reine Logik (auch in Node testbar) ----------
const b64decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const b64encode = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const serialize = data => JSON.stringify(data, null, 2) + '\n'; // identisch zu lib/store.js
const keyOf = it => String(it.name) + '|' + String(it.fach);
const parsePrice = v => { const n = Number(String(v).replace(',', '.').trim()); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN; };

// Änderungen (ops) auf frische Daten anwenden. ops: {edits:{key:{price,quantity}}, removes:[key], adds:[item]}
function applyOps(data, ops, now) {
  const out = JSON.parse(JSON.stringify(data));
  const conflicts = [];
  out.items = out.items.filter(it => !ops.removes.includes(keyOf(it)));
  for (const [k, ch] of Object.entries(ops.edits)) {
    const it = out.items.find(i => keyOf(i) === k);
    if (!it) { conflicts.push(k.split('|')[0]); continue; }
    let changed = false;
    for (const f of ['price', 'quantity']) if (f in ch && it[f] !== ch[f]) { it[f] = ch[f]; changed = true; }
    if (changed) it.updatedAt = now; // Feldreihenfolge bleibt erhalten
  }
  for (const a of ops.adds) {
    if (out.items.some(i => keyOf(i) === keyOf(a))) { conflicts.push(a.name); continue; }
    const it = { name: a.name, fach: a.fach, price: a.price, quantity: a.quantity };
    if (a.category) it.category = a.category;
    if (a.emoji) it.emoji = a.emoji;
    it.updatedAt = now;
    out.items.push(it);
  }
  return { data: out, conflicts };
}
const sortItems = items => items.slice().sort((a, b) => (b.price - a.price) || String(a.name).localeCompare(String(b.name), 'de'));

if (typeof module !== 'undefined') module.exports = { applyOps, serialize, b64encode, b64decode, keyOf, parsePrice, sortItems };

// ---------- UI ----------
if (typeof document !== 'undefined') (function () {
  const $ = id => document.getElementById(id);
  let base = null, sha = null, ops = null;
  const token = () => localStorage.getItem(LS_KEY);
  const resetOps = () => { ops = { edits: {}, removes: [], adds: [] }; };
  const msg = (t, cls) => { const m = $('msg'); m.textContent = t; m.className = cls || ''; };
  const hdr = () => ({ Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  const dirty = () => Object.keys(ops.edits).length || ops.removes.length || ops.adds.length;

  async function load() {
    msg('Lade Bestand …', 'info');
    const r = await fetch(API + '?ref=main&t=' + Date.now(), { headers: hdr(), cache: 'no-store' });
    if (r.status === 401 || r.status === 403) throw new Error('Token ungültig oder ohne Berechtigung (HTTP ' + r.status + ').');
    if (!r.ok) throw new Error('Laden fehlgeschlagen (HTTP ' + r.status + ').');
    const j = await r.json();
    sha = j.sha; base = JSON.parse(b64decode(j.content));
  }

  function current() { return applyOps(base, ops, null).data; }

  function render() {
    const view = current();
    const list = $('list'); list.innerHTML = '';
    const addedKeys = ops.adds.map(keyOf);
    for (const it of sortItems(view.items)) {
      const k = keyOf(it), isNew = addedKeys.includes(k), isChanged = !!ops.edits[k];
      const c = document.createElement('div');
      c.className = 'card' + (isNew ? ' new' : isChanged ? ' changed' : '');
      c.innerHTML = `<div class="name"></div><small></small>
        <div class="row"><span>Preis €</span><input class="price" inputmode="decimal">
        <span class="qty"><button data-d="-1">−</button><input type="number" min="0" class="q"><button data-d="1">+</button></span>
        <button class="danger del">Entfernen</button></div>`;
      c.querySelector('.name').textContent = (it.emoji ? it.emoji + ' ' : '') + it.name + (isNew ? ' (neu)' : isChanged ? ' (geändert)' : '');
      c.querySelector('small').textContent = 'Fach ' + it.fach + (it.category ? ' · ' + it.category : '');
      const p = c.querySelector('.price'), q = c.querySelector('.q');
      p.value = String(it.price).replace('.', ','); q.value = it.quantity;
      const set = (field, val) => {
        if (isNew) { ops.adds.find(a => keyOf(a) === k)[field] = val; }
        else {
          const orig = base.items.find(i => keyOf(i) === k);
          const e = ops.edits[k] || {}; e[field] = val;
          for (const f of Object.keys(e)) if (e[f] === orig[f]) delete e[f];
          if (Object.keys(e).length) ops.edits[k] = e; else delete ops.edits[k];
        }
        render();
      };
      p.addEventListener('change', () => { const v = parsePrice(p.value); if (isNaN(v)) { msg('Ungültiger Preis: ' + p.value, 'err'); render(); } else set('price', v); });
      q.addEventListener('change', () => { const v = Math.max(0, parseInt(q.value, 10) || 0); set('quantity', v); });
      c.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => set('quantity', Math.max(0, (Number(it.quantity) || 0) + Number(b.dataset.d)))));
      c.querySelector('.del').addEventListener('click', () => {
        if (!confirm(`„${it.name}“ (Fach ${it.fach}) wirklich entfernen?`)) return;
        if (isNew) ops.adds = ops.adds.filter(a => keyOf(a) !== k);
        else { ops.removes.push(k); delete ops.edits[k]; }
        render();
      });
      list.appendChild(c);
    }
    $('cats').innerHTML = [...new Set(base.items.map(i => i.category).filter(Boolean))].map(c => `<option value="${c.replace(/"/g, '&quot;')}">`).join('');
    $('saveBtn').textContent = dirty() ? 'Speichern (' + (Object.keys(ops.edits).length + ops.removes.length + ops.adds.length) + ')' : 'Speichern';
  }

  async function save() {
    if (!dirty()) { msg('Keine Änderungen.', 'info'); return; }
    $('saveBtn').disabled = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, conflicts } = applyOps(base, ops, new Date().toISOString());
        if (conflicts.length) { msg('Konflikt: Folgende Artikel wurden zwischenzeitlich geändert/entfernt/angelegt: ' + conflicts.join(', ') + '. Bitte prüfen und erneut speichern.', 'err'); resetOps(); render(); return; }
        const r = await fetch(API, { method: 'PUT', headers: { ...hdr(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Bestand manuell aktualisiert (admin)', content: b64encode(serialize(data)), sha, branch: 'main' }) });
        if (r.ok) { const j = await r.json(); sha = j.content.sha; base = data; resetOps(); render(); msg('✔ Gespeichert. Die öffentliche Seite zeigt es nach 1–10 Minuten.', 'ok'); return; }
        if ((r.status === 409 || r.status === 422) && attempt === 0) { msg('Datei wurde zwischenzeitlich geändert – lade neu und wende Änderungen erneut an …', 'info'); await load(); continue; }
        if (r.status === 401 || r.status === 403) throw new Error('Keine Schreibberechtigung (HTTP ' + r.status + '). Token prüfen: Contents „Read and write“.');
        throw new Error('Speichern fehlgeschlagen (HTTP ' + r.status + ').');
      }
      msg('Speichern nach erneutem Laden fehlgeschlagen. Bitte nochmal versuchen.', 'err');
    } catch (e) { msg('Fehler: ' + e.message, 'err'); }
    finally { $('saveBtn').disabled = false; }
  }

  async function start() {
    if (!token()) { $('tokenBox').classList.remove('hidden'); $('main').classList.add('hidden'); return; }
    $('tokenBox').classList.add('hidden'); $('main').classList.remove('hidden');
    resetOps();
    try { await load(); render(); msg('Bestand geladen.', 'ok'); } catch (e) { msg('Fehler: ' + e.message, 'err'); }
  }

  $('tokenSave').onclick = () => { const t = $('tokenInput').value.trim(); if (!t) return; localStorage.setItem(LS_KEY, t); $('tokenInput').value = ''; start(); };
  $('tokenRemove').onclick = () => { if (confirm('Token aus diesem Browser entfernen?')) { localStorage.removeItem(LS_KEY); msg('Token entfernt.', 'info'); start(); } };
  $('reload').onclick = () => { if (!dirty() || confirm('Ungespeicherte Änderungen verwerfen und neu laden?')) start(); };
  $('discard').onclick = () => { if (dirty() && confirm('Alle ungespeicherten Änderungen verwerfen?')) { resetOps(); render(); msg('Änderungen verworfen.', 'info'); } };
  $('saveBtn').onclick = save;
  $('addBtn').onclick = () => {
    const name = $('nName').value.trim(), fach = $('nFach').value.trim(), price = parsePrice($('nPrice').value), quantity = Math.max(0, parseInt($('nQty').value, 10) || 0);
    if (!name || !fach || isNaN(price)) { msg('Bitte Name, Fach und gültigen Preis angeben.', 'err'); return; }
    const a = { name, fach, price, quantity, category: $('nCat').value.trim(), emoji: $('nEmoji').value.trim() };
    if (current().items.some(i => keyOf(i) === keyOf(a))) { msg('Artikel mit diesem Namen und Fach existiert schon.', 'err'); return; }
    ops.adds.push(a); ['nName', 'nFach', 'nPrice', 'nCat', 'nEmoji'].forEach(id => $(id).value = ''); $('nQty').value = 0;
    render(); msg('„' + name + '“ hinzugefügt – noch nicht gespeichert.', 'info');
  };
  window.addEventListener('beforeunload', e => { if (ops && dirty()) { e.preventDefault(); e.returnValue = ''; } });
  start();
})();
