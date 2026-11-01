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
  node manage.js meta [--name "..."] [--location "..."]
  node manage.js refill-done [--at "YYYY-MM-DD HH:MM"]  (letzte Befüllung = jetzt bzw. Zeitpunkt in Berliner Zeit)
  node manage.js refill-next "YYYY-MM-DD HH:MM" [--note "Text"]  (nächste Befüllung ankündigen, Berliner Zeit)
  node manage.js refill-next --clear                 (Ankündigung der nächsten Befüllung entfernen)`;

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
// Berliner Ortszeit "YYYY-MM-DD HH:MM" -> ISO-String mit korrektem Offset (z. B. 2026-11-03T08:00:00+01:00).
const TZ = 'Europe/Berlin';
function tzOffsetMin(utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs) / 60000);
}
function berlinIso(str) {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})\s*$/.exec(String(str));
  if (!m) die(`Ungültiges Datum "${str}" – erwartet "YYYY-MM-DD HH:MM" (Berliner Zeit).`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const chk = new Date(wall);
  if (chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d || h > 23) die(`Ungültiges Datum "${str}".`);
  let off = tzOffsetMin(wall);
  off = tzOffsetMin(wall - off * 60000);
  const pad = n => String(n).padStart(2, '0');
  const sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
// Aktueller Zeitpunkt als ISO mit Berliner Offset
function nowBerlinIso() {
  const t = Date.now(), off = tzOffsetMin(t);
  return new Date(t + off * 60000).toISOString().slice(0, 19) + (off >= 0 ? '+' : '-') + String(Math.floor(Math.abs(off) / 60)).padStart(2, '0') + ':' + String(Math.abs(off) % 60).padStart(2, '0');
}
const berlin = iso => new Date(iso).toLocaleString('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
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
      if (data.lastRefill) console.log(`Letzte Befüllung: ${berlin(data.lastRefill)}`);
      if (data.nextRefill) console.log(`Nächste Befüllung: ${berlin(data.nextRefill)}${data.nextRefillNote ? ' – ' + data.nextRefillNote : ''}${new Date(data.nextRefill) <= new Date() ? ' (vorbei, wird nicht angezeigt)' : ''}`);
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
    case 'refill-done': {
      const at = typeof opt.at === 'string' ? berlinIso(opt.at) : (opt.at ? die('--at braucht "YYYY-MM-DD HH:MM".') : nowBerlinIso());
      data.lastRefill = at;
      let cleared = false;
      if (data.nextRefill && (new Date(data.nextRefill) <= new Date(at) || new Date(data.nextRefill) <= new Date())) {
        data.nextRefill = null; delete data.nextRefillNote; cleared = true;
      }
      store.save(data);
      console.log(`Letzte Befüllung gesetzt: ${berlin(at)}` + (cleared ? ' (angekündigte Befüllung erledigt → entfernt)' : ''));
      return;
    }
    case 'refill-next': {
      if (opt.clear) {
        data.nextRefill = null; delete data.nextRefillNote; store.save(data);
        console.log('Nächste Befüllung entfernt.');
        return;
      }
      if (!pos[0]) die('Zeitpunkt fehlt.\n' + USAGE);
      const at = berlinIso(pos[0]);
      if (new Date(at) <= new Date()) console.error('Warnung: Zeitpunkt liegt in der Vergangenheit – wird auf der Seite nicht angezeigt.');
      data.nextRefill = at;
      if (typeof opt.note === 'string' && opt.note.trim()) data.nextRefillNote = opt.note.trim(); else delete data.nextRefillNote;
      store.save(data);
      console.log(`Nächste Befüllung: ${berlin(at)}${data.nextRefillNote ? ' – ' + data.nextRefillNote : ''}`);
      return;
    }
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}
main();
