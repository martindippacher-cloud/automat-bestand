# Automat-Bestand – statische Version für GitHub Pages

Öffentliche Live-Bestandsanzeige des Verkaufsautomaten – **ohne eigenen Server**.
GitHub Pages liefert nur statische Dateien aus; der Browser lädt `inventory.json` und berechnet alles selbst.

## So funktioniert es

- `index.html`, `style.css`, `app.js` – die Kundenansicht (mobil zuerst, transparenter Hintergrund, iframe-tauglich).
- `inventory.json` – der aktuelle Bestand. **Das ist die einzige Datei, die sich im Alltag ändert.**
- `app.js` lädt `inventory.json?t=<Zeitstempel>` (relativer Pfad, `cache: 'no-store'`), alle **45 Sekunden** neu
  und sofort, wenn der Tab wieder sichtbar wird.
- Der Status wird im Browser genau wie in `lib/store.js` berechnet:
  - Menge `0` (oder leer) → **ausverkauft**
  - Menge `1–3` → **nur noch wenige**
  - Menge `> 3` → **verfügbar**
- „Zuletzt aktualisiert“ wird immer in der Zeitzone **Europe/Berlin** angezeigt (`updatedAt` aus `inventory.json`).
- Hinweis: GitHub Pages/CDN kann Änderungen mit bis zu ca. 1–10 Minuten Verzögerung ausliefern.

## Bestand ändern

`manage.js` und `lib/store.js` arbeiten direkt auf der `inventory.json` in diesem Ordner (Node ≥ 18, keine Abhängigkeiten):

```bash
node manage.js list                                  # Übersicht
node manage.js set "Cola" --qty 8 --price 2.00 --fach 30 --category Getränke --emoji 🥤
node manage.js restock "Wasser" 5                    # +5 aufgefüllt (Name oder Fach)
node manage.js sold 14 2                             # -2 verkauft (Fach 14)
node manage.js empty "Klöße"                         # ausverkauft
node manage.js remove "Salat"                        # Artikel entfernen
node manage.js rename 26 "Bier (Glasflasche)"
node manage.js clear-examples                        # Beispiel-Artikel entfernen
node manage.js meta --name "Snack- & Getränkeautomat" --location "Vor der Gaststätte"
```

### Befüllung (letzte / nächste)

Zeitangaben immer in **Berliner Ortszeit** im Format `"YYYY-MM-DD HH:MM"`; gespeichert wird ISO mit korrektem Offset
(Sommer-/Winterzeit automatisch, z. B. `2026-11-04T08:00:00+01:00`).

```bash
node manage.js refill-done                                   # Befüllung erledigt – jetzt
node manage.js refill-done --at "2026-11-01 09:30"           # Befüllung erledigt – zu diesem Zeitpunkt
node manage.js refill-next "2026-11-04 08:00"                # nächste Befüllung ankündigen
node manage.js refill-next "2026-11-04 08:00" --note "Frische Braten"   # mit Hinweistext
node manage.js refill-next --clear                           # Ankündigung entfernen
```

- In `inventory.json`: `lastRefill`, `nextRefill` (ISO-Zeitstempel oder `null`) und optional `nextRefillNote`.
- Die Seite zeigt unter dem Kopf eine kleine Info-Box:
  - „Letzte Befüllung: …“ nur, wenn `lastRefill` gesetzt ist.
  - „Nächste Befüllung: …“ (plus Hinweis) nur, wenn `nextRefill` gesetzt ist **und noch in der Zukunft** liegt –
    danach blendet sich die Zeile automatisch aus.
- `refill-done` entfernt eine angekündigte Befüllung, die schon vorbei ist bzw. nicht nach der neuen Befüllung liegt.
- Wie alle Befehle setzt auch dies `updatedAt` neu. Danach `./publish.sh` (oder `./update.sh refill-done --publish`).

Kurzform mit `update.sh` (gleiche Befehle, optional gleich veröffentlichen):

```bash
./update.sh restock "Wasser" 5 --publish
```

## Veröffentlichen

```bash
./publish.sh      # git add inventory.json → Commit mit Zeitstempel → git push
```

Einmalig einrichten:

1. Auf GitHub ein (öffentliches) Repository anlegen, z. B. `automat-bestand`.
2. `git remote add origin https://github.com/<user>/<repo>.git && git push -u origin main`
3. Repository → **Settings → Pages** → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
4. Die Seite ist danach unter `https://<user>.github.io/<repo>/` erreichbar.

## Einbinden in MODX (iframe)

In MODX eine Ressource bzw. einen Chunk öffnen (Editor auf HTML/Quelltext umstellen) und einfügen:

```html
<iframe src="https://<user>.github.io/<repo>/" style="width:100%;height:900px;border:0" loading="lazy"></iframe>
```

`<user>` und `<repo>` ersetzen. Die Seite hat einen transparenten Hintergrund und passt sich der Breite an;
die Höhe (`900px`) bei Bedarf an die Anzahl der Artikel anpassen. Falls der TinyMCE-Editor das iframe entfernt,
den Code in einen Chunk legen und mit `[[$chunkName]]` einbinden.

## Lokal testen

```bash
python3 -m http.server 8090   # dann http://localhost:8090/ öffnen
```

## Gewicht, Zutaten & Icons (details.json)
- `details.json` → `products.<schlüssel>`: `weight`, optional `portions`, `ingredients` (wörtlich vom Etikett), `allergens` (`[{ "name": "Milch", "words": ["Sahne"] }]` – die `words` werden in der Zutatenliste fett markiert), `hints`, `icon`, `aliases`.
- Zuordnung zu `inventory.json`: optional `detailKey` am Artikel, sonst Name/Alias (Groß-/Kleinschreibung, Umlaute, Leer-/Bindestriche egal).
- Icons liegen in `icons/*.svg`; ohne Eintrag wird das `emoji` aus inventory.json angezeigt. Ohne `weight`/`ingredients` ist die Karte nicht aufklappbar.
- Test-Link: `index.html#open=Sauerbraten` öffnet die Details direkt.
