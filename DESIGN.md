# DESIGN.md — system wizualny FIRE Simulator

Jedno źródło decyzji o wyglądzie i interakcjach. Każda reguła ma odpowiednik
w `static/css/tokens.css` / `components.css` i jest pilnowana przez
`qa/visual/tokens.spec.js`. Nowy widok buduj z tych klocków — nie dopisuj
własnych kolorów, rozmiarów ani promieni.

## 1. Zasady

1. **Jedna rodzina komponentów i tokenów.** Wszystkie widoki używają tych samych
   klas i tokenów; strona dokłada tylko układ.
2. **Kolor znaczy jedno.** Fiolet = interakcja, pomarańcz = akumulacja, turkus =
   realizacja, zielony/bursztyn/czerwony = stan. Liczby neutralne, chyba że kolor
   niesie znaczenie.
3. **Trzy tła, cień tylko nad treścią.** `--bg` → `--surface` → `--surface-2`;
   głębię robi obramowanie, cień mają tylko pasek akcji i dymek.
4. **Typografia i siatka.** 12/13/15/18/24 px, nic poniżej 12; odstępy z `--sp-*`
   (4 px), promienie `--r-md`/`--r-lg`, pigułki `--r-pill`.
5. **Jedna kontrolka liczbowa.** `.num-control` wszędzie; suwak to dodatek, nie
   zamiennik. Pole mieści najdłuższą wartość; konfiguracja edytuje w miejscu.
6. **Jeden język ikon.** Liniowe SVG 24×24, `currentColor`, `icons.js`; bez emoji.
7. **Jeden pasek akcji i jeden banner.** `.action-bar` ustawia
   `body.has-action-bar`; ostrzeżenia tylko przez `.banner` z wariantem stanu.
8. **Mobile to ten sam produkt.** Poniżej 640 px dolny tabbar i jedna kolumna,
   tabele mogą być kartami; 641–1024 px nawigacja tylko ikony. Breakpointy:
   640/900/1024/1200. Nic nie powoduje poziomego scrolla strony.
9. **Krótki tekst, szczegółowy tooltip.** Mechanika, przykłady i wyliczenia idą do
   `.tip` przy nagłówku panelu. Tooltip wyjaśnia szczegółowo działanie sekcji,
   przycisku lub mechanizmu; nie powtarza listy opcji widocznych pod spodem.
10. **Kafel dla decyzji, segmented dla oczywistości.** Duże `.wz-path` dla wyboru
    wymagającego wyjaśnienia; mały `.segmented` dla oczywistego. Domyślnie
    zaznaczaj najbardziej prawdopodobną opcję; kolejność opcji od najczęstszej,
    chyba że naturalna kolejność jest inna (np. rosnące stawki).
11. **Jeden słowniczek.** Definicje z sekcji 7 są źródłem prawdy dla kafelków,
    tooltipów i wyników; nowy termin dopisujemy najpierw tutaj.

## 2. Tokeny

| Grupa | Token | Wartość | Użycie |
| --- | --- | --- | --- |
| Tło | `--bg` | `#0f1117` | strona |
| | `--surface` | `#171a24` | karta, pasek akcji, topbar |
| | `--surface-2` | `#1f2331` | kontrolki, insety, wiersze |
| | `--surface-hover` | `#262b3b` | hover kontrolek i wierszy |
| Krawędź | `--border` | `#2a2f40` | obramowania |
| | `--border-strong` | `#3a4156` | hover, fokus bez koloru |
| Tekst | `--text` | `#e7e9f0` | treść |
| | `--text-2` | `#a3a8bb` | tekst pomocniczy |
| | `--text-3` | `#8b93ab` | etykiety, podpisy, ikony nieaktywne |
| Interakcja | `--primary` | `#7b6cf0` | akcja, zaznaczenie, fokus |
| | `--primary-hover` | `#8b7df5` | hover akcji głównej |
| | `--primary-text` | `#9a8cf7` | tekst/linki marki (≥ 4,5:1) |
| | `--on-primary` | `#ffffff` | tekst na fioletowym tle |
| Etapy | `--stage-accum` | `#e8845c` | akumulacja |
| | `--stage-real` | `#27c4bb` | realizacja |
| Stan | `--success` | `#3ccf91` | sukces |
| | `--warning` | `#f0b64b` | ostrzeżenie |
| | `--danger` | `#f26d6d` | błąd |
| Marka | `--brand-flame-*`, `--brand-tile-*` | gradient płomienia i ramki | tylko logo |

Serie kont na wykresach mają stałe tokeny `--acct-*`: kolor identyfikuje konto
w obu wykresach, a nie stan ani interakcję. Wypełnienia area używają gradientu
64% → 12% krycia z cienką krawędzią; próbki legendy są mocniejsze (82% → 32%).
Przezroczystości robimy przez `color-mix()`, nie `rgba()`. Kontrast `--text`,
`--text-2`, `--text-3`, `--primary-text` ≥ 4,5:1 na `--surface-2`;
`--primary` służy do wypełnień, obramowań i fokusu, nie do tekstu.

## 3. Komponenty

- `.btn` (+ `-primary | -secondary | -ghost | -danger`, `.btn-sm`, `.btn-icon`);
  odstępy daje `.btn-row`.
- `.card`, `.card-head`, `.card-title`, `.card-sub`, `.card-inset`.
- `.metric`, `.metric-grid`, `.is-positive | .is-negative`; `.banner` + wariant.
- `.segmented`, `.seg-option`, `.segmented-stack`; `.wz-paths`, `.wz-path`,
  `.wz-choice-cards`.
- `.pill-toggle`, `.pill-grid`, `.chip` (+ `-accum | -real | -warn | -primary`).
- `.num-control`, `.range`, `.field`, `.field-label`, `.field-hint`.
- `.action-bar` (+ `-left | -center | -right`).
- `.table-wrap` + `table`; `.tip` + `.tooltip`; `.stage-dot`, `.stage-label`,
  `.progress`.
- Wspólne klocki wyników: `ResultsMetrics` (`.metric-grid`), `ResultsBanners`
  (`.banner`), `ResultsSection` (`.res-section-head`), `ResultsPlanTime`
  (timeline + Etapy + Gantt), `ResultsTable` (rok po roku). Ekrany komponują
  je w swoich układach.

## 4. Layout i responsywność

- Porównywalne pola mają równe kolumny. `.wz-grid-choice` stosuj tylko dla
  celowego zestawu „wybór + powiązana kontrolka”.
- Długie etykiety wyboru nie mogą być wciskane w wąską kolumnę: użyj
  `.wz-grid-single` albo stackowania segmentu. Kontrolki nie mogą nachodzić
  na siebie ani wychodzić poza kartę.
- Pojedyncze pole wypełnia wiersz. Karty kont w kroku kapitału mają maksymalnie
  3 kolumny (tablet 2, mobile 1).
- Szerokie tabele i Gantt przewijają się w poziomie we własnym wrapperze
  (`.table-wrap`, `.wz-flows-gantt-scroll`), nigdy cała strona. Część tabel
  na mobile może zamienić się w karty wierszy.
- Nawigacja: topbar z czterema sekcjami; 641–1024 px tylko ikony (nazwa
  w `title` i `aria-label`); poniżej 640 px dolny `.tabbar`.
- Pasek akcji jest jeden; widok bez niego nie dodaje własnego pływającego paska.

## 5. Wzorce interakcji

- **Tooltipy.** `.tip` przy nagłówku panelu; treść wyjaśnia mechanikę, przykłady,
  limity i wyliczenia. Nie dziedziczy `text-transform` ani `letter-spacing`
  z nagłówków. Działa na hover i focus; na mobile tap. Nie powtarza listy opcji
  widocznych pod spodem.
- **Domyślne wartości.** Najbardziej prawdopodobna opcja jest zaznaczona; opcje
  szeregujemy od najczęstszej, chyba że naturalna kolejność jest inna.
- **Suwaki.** Suwak = typowy zakres; pole liczbowe = wyższy limit manualny.
  Pole ma zapas na najdłuższą wartość; na mobile liczba jest nad suwakiem.
  Wartość wpisana ręcznie nie jest przycinana do maksimum suwaka.
- **Konfiguracja w miejscu.** Bez przycisku „Zmień”; kropka
  `.config-override-indicator`, aktywny `.config-restore-btn` i badge
  `.config-section-modified` pokazują odstępstwo od presetu.
- **Loading, błędy, empty states.** Pasek postępu + krótki kontekst; bez
  spinnera, jeśli pasek już jest. Błędy i ostrzeżenia przez banery, empty state
  mówi, co zrobić dalej. Komunikaty nie sugerują prognozy ani rekomendacji.
- **Tabele i Gantt.** Sticky etykiety, własny scroll poziomy, czytelne nagłówki;
  na mobile tabela może zamienić się w karty wierszy.

## 6. Dostępność

- Kontrast tekstu ≥ 4,5:1 na `--surface-2`.
- Widoczny focus (`:focus-visible`); nie usuwaj outline bez zamiennika.
- Każda kontrolka ma `aria-label` lub powiązany label; ikony dekoracyjne są
  ukryte przed czytnikiem.
- Nie komunikuj stanu wyłącznie kolorem; dodaj tekst, ikonę lub `aria`.
- Emoji nie są ikonami ani nośnikiem znaczenia.
- Respektuj `prefers-reduced-motion`.

## 7. Słowniczek pojęć

Ten sam termin ma wszędzie to samo znaczenie — w kafelkach, tooltipach,
wynikach i eksporcie. Definicje są krótkie i pisane językiem użytkownika.

- **FIRE** — niezależność finansowa i możliwość wcześniejszego zakończenia pracy.
- **Full FIRE** — całkowite zakończenie pracy w wybranym wieku.
- **Coast FIRE** — część etatu; pensja pokrywa życie, oszczędności rosną bez wpłat.
- **Barista FIRE** — część etatu z pensją mniejszą niż potrzeby; różnicę pokrywa portfel.
- **Horyzont planu** — wiek, do którego liczymy wypłaty, metryki i kapitał końcowy.
  Wykresy dorysowują ZUS do 100 r.ż., ale metryki kończą się na horyzoncie.
- **Profil ryzyka** — limity koncentracji **nowych wpłat** (krypto, rynkowe,
  bezpieczne); działa na całą pulę, także we wrapperach, nie zmienia istniejącego portfela.
- **Scenariusz rynkowy** — bessa, realne lub hossa; globalny config plus delty.
  Nie jest prognozą.
- **Pula wpłat** — miesięczna kwota dzielona między konta i gotówkę.
- **Udział konta** — część puli przypisana do konta; suma ≤ 100%.
- **IKE / IKZE / OIPE** — opakowania podatkowe z limitem wpłat; nie są klasą
  ryzyka — ryzyko wynika z rodzaju inwestycji w środku.
- **Rodzaj inwestycji (wrapper)** — Maklerskie (akcje/ETF), Funduszowe
  (fundusze/portfel zarządzany) albo Oszczędnościowe (lokaty, obligacje,
  fundusze obligacji); ustala ROI i klasę ryzyka. Jeden wrapper ma jeden
  dominujący rodzaj; mieszany rachunek modelujemy własnym ROI. Dostępność
  rodzajów jest konfigurowalna per wrapper (OIPE domyślnie tylko Funduszowe).
- **ZUS / wiek ZUS** — publiczna emerytura i wiek, od którego ją pobierasz.
- **ROI** — średnioroczny zwrot przyjęty w symulacji; założenie scenariuszowe,
  nie prognoza.
- **Bufor / spadek** — minimalny majątek netto na koniec horyzontu (0 = wydać wszystko).
