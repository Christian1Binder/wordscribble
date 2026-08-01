# WordScribble – Datenquellen

Die redaktionell erstellten Ausgangslisten von WordScribble werden in Version 0.12 um offen lizenzierte deutsche Synonym- und Häufigkeitsdaten ergänzt.

## OpenThesaurus

Die zusätzlichen Frage-Begriff-Kombinationen werden aus Synonymgruppen des freien deutschen OpenThesaurus erzeugt. Dabei wird jeweils ein Begriff als Lösung verwendet und ein bedeutungsgleiches Wort als Umschreibung eingesetzt, zum Beispiel in der Form „Anderes Wort für …?“.

- Projekt und sichtbare Quellenangabe: https://www.openthesaurus.de/
- Downloadseite: https://www.openthesaurus.de/about/download
- Datenlizenz: wahlweise **Creative Commons Attribution-ShareAlike 4.0** oder **GNU Lesser General Public License (LGPL)**
- Für die WordScribble-Daten wird die Variante **CC BY-SA 4.0** zugrunde gelegt.

Die erzeugten Synonymfragen sind Bearbeitungen der OpenThesaurus-Daten. Bei einer Weitergabe der erzeugten Wortlisten muss diese Quellen- und Lizenzangabe erhalten bleiben.

## FrequencyWords

Zur Auswahl und Einordnung verbreiteter deutscher Wörter wird die deutsche Frequenzliste aus dem Projekt **FrequencyWords** verwendet.

- Projekt: https://github.com/hermitdave/FrequencyWords
- Inhaltslizenz laut Projekt: **CC BY-SA 4.0**
- Grundlage der verwendeten Liste: OpenSubtitles-Korpus

Die Häufigkeitswerte bestimmen nur Auswahl und Schwierigkeitsstufe; sie werden nicht als Spielinhalt angezeigt.

## Eigene Inhalte

Die ursprünglichen, redaktionell formulierten Fragen sowie sämtliche Programm- und Gestaltungsteile von WordScribble bleiben davon getrennt. Die Datei `tools/build_large_wordbank.py` erstellt die Wortlisten reproduzierbar und validiert, dass genau 15.000 Frage-Begriff-Kombinationen ausgegeben werden.
