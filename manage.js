#!/usr/bin/env node
'use strict';
// Bestandsverwaltung per Kommandozeile. Siehe README.md.
const store = require('./lib/store');

const USAGE = `Verwendung:
  node manage.js list [--json]
  node manage.js set "<Name>" [--qty N] [--price 2.00] [--fach A1] [--category Getränke] [--emoji 🥤]
  node manage.js restock "<Name|Fach>" <Anzahl>      (Menge erhöhen, z. B. "Cola 5 aufgefüllt")
  node manage.js sold "<Name|Fach>" [Anzahl]         (Menge verringern, Standard 1)
  node manage.js empty "<Name|Fach>"                 (auf ausverkauft setzen)
  node manage.js remove "<Name|Fach>"
  node manage.js rename "<Name|Fach>" "<Neuer Name>"
  node manage.js clear-examples                      (alle Beispiel-Artikel entfernen, Beispiel-Hinweis aus)
  node manage.js meta [--name "..."] [--location "..."]`;

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) opt[k] = true; else { opt[k] = n; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}
const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const num = (v, what) => { const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n)) die(`Ungültige Zahl für ${what}: ${v}`); return n; };
function die(m) { console.error('Fehler: ' + m); process.exit(1); }

// Findet Artikel: exakter Fach-Code, exakter Name, sonst eindeutiger Teiltreffer im Namen.
function find(items, q, { required = true } = {}) {
  const n = norm(q);
  let hit = items.filter(i => i.fach && norm(i.fach) === n);
  if (!hit.length) hit = items.filter(i => norm(i.name) === n);
  if (!hit.length) hit = items.filter(i => norm(i.name).includes(n));
  if (hit.length > 1) die(`"${q}" ist mehrdeutig: ${hit.map(i => `${i.name} (${i.fach || '-'})`).join(', ')}`);
  if (!hit.length && required) die(`Kein Artikel gefunden für "${q}". Mit "list" prüfen oder mit "set" anlegen.`);
  return hit[0];
}
const eur = p => Number(p).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const label = { verfuegbar: 'verfügbar', wenige: 'nur noch wenige', ausverkauft: 'ausverkauft' };
const line = i => `${(i.fach || '-').padEnd(4)} ${(i.emoji || ' ')} ${i.name.padEnd(38)} ${eur(i.price || 0).padStart(9)}  ${String(i.quantity).padStart(3)} Stk  ${label[store.status(i.quantity)]}`;

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parse(rest);
  const data = store.load();
  const now = new Date().toISOString();
  const touch = i => { i.updatedAt = now; };

  switch (cmd) {
    case 'list': {
      if (opt.json) return console.log(JSON.stringify(data, null, 2));
      if (data.example) console.log('⚠ Enthält BEISPIELDATEN (example: true)');
      data.items.sort((a, b) => String(a.fach || '').localeCompare(String(b.fach || ''), 'de', { numeric: true })).forEach(i => console.log(line(i)));
      console.log(`Stand: ${new Date(data.updatedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} (Europe/Berlin)`);
      return;
    }
    case 'set': {
      if (!pos[0]) die('Name fehlt.\n' + USAGE);
      let it = find(data.items, pos[0], { required: false });
      const created = !it;
      if (!it) { it = { name: pos[0], fach: null, price: 0, quantity: 0 }; data.items.push(it); }
      if (opt.qty !== undefined) it.quantity = Math.max(0, Math.round(num(opt.qty, 'qty')));
      if (opt.price !== undefined) it.price = Math.round(num(opt.price, 'price') * 100) / 100;
      if (opt.fach !== undefined) {
        const clash = data.items.find(i => i !== it && i.fach && norm(i.fach) === norm(opt.fach));
        if (clash) die(`Fach ${opt.fach} ist schon belegt durch "${clash.name}".`);
        it.fach = String(opt.fach).toUpperCase();
      }
      if (opt.category !== undefined) it.category = opt.category === true ? null : opt.category;
      if (opt.emoji !== undefined) it.emoji = opt.emoji === true ? null : opt.emoji;
      touch(it); store.save(data);
      console.log((created ? 'Angelegt: ' : 'Aktualisiert: ') + line(it));
      return;
    }
    case 'restock': case 'sold': {
      if (!pos[0]) die('Artikel fehlt.\n' + USAGE);
      const it = find(data.items, pos[0]);
      const n = pos[1] !== undefined ? Math.round(num(pos[1], 'Anzahl')) : (cmd === 'sold' ? 1 : die('Anzahl fehlt.'));
      it.quantity = Math.max(0, (Number(it.quantity) || 0) + (cmd === 'restock' ? n : -n));
      touch(it); store.save(data);
      console.log((cmd === 'restock' ? `+${n} aufgefüllt: ` : `-${n} verkauft: `) + line(it));
      return;
    }
    case 'empty': {
      const it = find(data.items, pos[0] || die('Artikel fehlt.'));
      it.quantity = 0; touch(it); store.save(data);
      console.log('Ausverkauft gesetzt: ' + line(it));
      return;
    }
    case 'remove': {
      const it = find(data.items, pos[0] || die('Artikel fehlt.'));
      data.items = data.items.filter(i => i !== it); store.save(data);
      console.log(`Entfernt: ${it.name} (${it.fach || '-'})`);
      return;
    }
    case 'rename': {
      const it = find(data.items, pos[0] || die('Artikel fehlt.'));
      if (!pos[1]) die('Neuer Name fehlt.');
      const old = it.name; it.name = pos[1]; touch(it); store.save(data);
      console.log(`Umbenannt: ${old} → ${it.name}`);
      return;
    }
    case 'clear-examples': {
      const before = data.items.length;
      data.items = data.items.filter(i => !/\(Beispiel\)/.test(i.name));
      data.example = false; delete data.note; store.save(data);
      console.log(`${before - data.items.length} Beispiel-Artikel entfernt. Beispiel-Hinweis deaktiviert.`);
      return;
    }
    case 'meta': {
      if (typeof opt.name === 'string') data.machineName = opt.name;
      if (typeof opt.location === 'string') data.location = opt.location;
      store.save(data);
      console.log(`Automat: ${data.machineName} – ${data.location}`);
      return;
    }
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}
main();
