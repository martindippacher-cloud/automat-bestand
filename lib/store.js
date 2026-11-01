'use strict';
// Gemeinsame Lese-/Schreiblogik für inventory.json (atomar schreiben).
// Statische Version: arbeitet immer auf ../inventory.json in DIESEM Repo (GitHub Pages liefert die Datei aus).
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'inventory.json');
const LOW_STOCK = 2; // <= LOW_STOCK => "nur noch wenige" (muss mit app.js übereinstimmen)

function load() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!Array.isArray(data.items)) data.items = [];
  return data;
}

function save(data) {
  data.updatedAt = new Date().toISOString();
  data.checkedAt = data.updatedAt;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
}

function status(qty) {
  if (!qty || qty <= 0) return 'ausverkauft';
  if (qty <= LOW_STOCK) return 'wenige';
  return 'verfuegbar';
}

function heartbeat() {
  // Nur 'zuletzt geprüft' setzen (Bestand unverändert).
  const data = load();
  data.checkedAt = new Date().toISOString();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
}

module.exports = { heartbeat, FILE, LOW_STOCK, load, save, status };
