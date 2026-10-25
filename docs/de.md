# Zonneplan für Gladys Assistant

Diese Integration bringt dein [Zonneplan](https://www.zonneplan.nl)-Konto in Gladys: die
dynamischen Strom- und Gaspreise und die Geräte, die Zonneplan überwacht — P1-Zähler
(Zonneplan Connect), Solaranlage, Heimspeicher (Nexus) und Ladestation.

Sie spricht über das Internet mit den Servern von Zonneplan (**Cloud**): In deinem Netzwerk
muss nichts installiert werden. Sie braucht **Gladys 5.3.0 oder neuer**.

## Anmelden

Zonneplan hat kein Passwort: Es schickt dir einen Einmalcode per E-Mail.

1. Gib unter **Integrationen → Zonneplan → Konfiguration** die E-Mail-Adresse deines
   Zonneplan-Kontos ein und **speichere**.
2. Klicke auf **Anmeldecode senden**. Zonneplan schickt dir einen Code per E-Mail.
3. Gib den Code bei **Mit dem Code anmelden** ein und bestätige. Der Code gilt einige
   Minuten: Ist er abgelaufen, fordere einen neuen an.

Die Antwort unter der Schaltfläche zeigt, was in deinem Konto gefunden wurde. Die Sitzung
erneuert sich danach von selbst; neu anmelden musst du dich nur, wenn sie beendet wurde
(zum Beispiel in der Zonneplan-App). **Verbindung testen** prüft die Sitzung jederzeit,
**Abmelden** löscht sie aus Gladys.

## Einstellungen

| Einstellung                  | Wirkung                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-Mail des Zonneplan-Kontos  | Die Adresse, an die der Anmeldecode geschickt wird.                                                                                                                                         |
| Preisintervalle              | **Stündlich** (Standard) oder **viertelstündlich**: Seit Oktober 2025 legt der Markt alle 15 Minuten einen Preis fest; Zonneplan veröffentlicht auch Stundenmittel.                         |
| Aktualisierungsintervall (s) | Wie oft P1-Zähler, Solaranlage, Batterie und Ladestation gelesen werden (60 bis 3600 s, Standard 300). Zonneplan begrenzt die Anfragen: Bleib bei 300 s, wenn es nicht schneller sein muss. |

## Geräte

Öffne den Tab **Entdecken** der Integration und lege die gewünschten Geräte an. Es gibt ein
Gerät pro Anlage deines Kontos:

| Gerät                       | Funktionen                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Zonneplan electricity price | Preis pro kWh jetzt, Preis des nächsten Intervalls, Tarifgruppe (`low` / `normal` / `high`), nachhaltige Energie (%) |
| Zonneplan gas price         | Preis pro m³ heute, Preis des nächsten Tages (sobald bekannt)                                                        |
| Zonneplan P1 meter          | Leistung aus dem Netz, Leistung ins Netz (W)                                                                         |
| Zonneplan solar panels      | Erzeugungsleistung (W), Gesamterzeugung (kWh)                                                                        |
| Zonneplan home battery      | Ladestand (%), Ladeleistung, Entladeleistung (W)                                                                     |
| Zonneplan charge point      | Ladeleistung (W), Energie der Sitzung (kWh), Schalter **Charge now (boost)**                                         |

Die Preise enthalten Mehrwertsteuer und Abgaben, wie in der Zonneplan-App. Der Strompreis
ändert sich genau zu Beginn jedes Intervalls. P1- und Solarwerte kommen alle paar Minuten
über die Cloud von Zonneplan: Es sind keine sekundengenauen Messungen.

Der Schalter **Charge now** startet ein Sofortladen (volle Leistung sofort, unabhängig vom
Preis); Ausschalten stoppt das Laden. Außerhalb eines Sofortladens lädt Zonneplan selbst zu
günstigen Stunden, und der Schalter steht während eines solchen Ladevorgangs auf EIN.

Jedes Gerät trägt ein **Cloud**-Abzeichen. Ein orangefarbener Punkt darauf bedeutet, dass
Zonneplan für eine Weile um weniger Anfragen gebeten hat; die Daten kommen von selbst zurück.

## Szenen

### Auslöser

| Auslöser                                   | Wann                                                                        | Variablen                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Zonneplan-Tarifgruppe geändert             | Das neue Intervall liegt in einer anderen Gruppe; Filter auf die Gruppe     | neue Gruppe, vorherige Gruppe, Preis                               |
| Zonneplan-Preis unter null                 | Der Strompreis ist gerade unter null gefallen                               | Preis, Ende des Intervalls (HH:mm)                                 |
| Zonneplan-Preise für morgen veröffentlicht | Die Preise von morgen sind bekannt (meist am Nachmittag)                    | Datum, günstigstes und teuerstes Intervall und Preis, Durchschnitt |
| Zonneplan-Ladevorgang gestartet / beendet  | Eine Ladestation beginnt oder beendet das Laden; Filter auf die Ladestation | Leistung, Energie der Sitzung                                      |

### Aktionen

| Aktion                                | Wirkung                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zonneplan-Preis lesen                 | Liefert den Preis jetzt und danach, die Tarifgruppe, den nachhaltigen Anteil und das günstigste Intervall des Tages                                                                        |
| Günstigsten Zonneplan-Zeitraum finden | Die günstigste Folge aufeinanderfolgender Intervalle der gewünschten Dauer (in Stunden) in den nächsten Stunden: Beginn, Ende, Durchschnittspreis, „beginnt in“ (Minuten), „beginnt jetzt“ |
| Zonneplan: jetzt laden                | Sofortladen an der gewählten Ladestation                                                                                                                                                   |
| Zonneplan: Laden stoppen              | Stoppt das Laden der gewählten Ladestation                                                                                                                                                 |

Beispiel — die Spülmaschine in den günstigsten 2 Stunden der Nacht laufen lassen: Eine um
22:00 ausgelöste Szene führt **Günstigsten Zonneplan-Zeitraum finden** aus (Dauer 2,
innerhalb von 10), wartet **beginnt in** Minuten und schaltet dann die Steckdose der
Spülmaschine ein.

Beispiel — das Auto laden, wenn der Preis negativ wird: Auslöser **Zonneplan-Preis unter
null**, Aktion **Zonneplan: jetzt laden**.

Die Uhrzeiten (HH:mm) sind die der Niederlande.

## Widgets

Füge sie über **Dashboard → Bearbeiten → Widget hinzufügen** hinzu:

- **Zonneplan-Preise**: Preis jetzt und danach (nach Tarifgruppe eingefärbt), nachhaltiger
  Anteil, Preiskurve der nächsten Stunden mit dem günstigsten und teuersten Intervall des
  Tages.
- **Zonneplan-Übersicht**: Leistung aus dem und ins Netz, Solarerzeugung, Ladestand und
  Ladeleistung live, die Verbindung und die Schaltflächen **Jetzt laden** / **Laden stoppen**.

## Fehlerbehebung

| Meldung in der Konfiguration         | Was tun                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Nicht angemeldet                     | Folge [Anmelden](#anmelden).                                                                           |
| Die Zonneplan-Sitzung ist abgelaufen | Fordere einen neuen Anmeldecode an: Die Sitzung wurde beendet oder ist zu alt.                         |
| Zonneplan bittet um weniger Anfragen | Nichts: Die Anfragen gehen zur angezeigten Uhrzeit weiter. Erhöhe das Intervall, wenn es oft passiert. |
| Zonneplan ist nicht erreichbar       | Prüfe den Internetzugang von Gladys; die Integration versucht es jede Minute erneut.                   |

Ein Gerät fehlt? Prüfe in der Zonneplan-App, ob sein Vertrag aktiv ist, und klicke dann im
Tab „Entdecken“ auf **Suchen**.

## Datenschutz

Die Integration spricht nur mit `app-api.zonneplan.nl`. Die Sitzungstokens liegen im
privaten Datenvolume der Integration, nur für sie lesbar, und werden nie in die Logs
geschrieben. **Abmelden** löscht sie. Diese Integration stammt nicht von Zonneplan und wird
nicht von Zonneplan unterstützt; sie nutzt dieselbe API wie die Zonneplan-App.
