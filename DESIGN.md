# DESIGN.md — system wizualny FIRE Simulator

Jedno źródło decyzji o wyglądzie. Każda reguła poniżej ma odpowiednik w kodzie
(`static/css/tokens.css`, `static/css/components.css`) i jest pilnowana przez
`qa/visual/tokens.spec.js`. Nowy widok lub komponent buduje się z tych klocków,
nie dopisuje własnych kolorów, rozmiarów ani promieni.

## 1. Zasady

1. **Jedna rodzina komponentów dla całej aplikacji.** Asystent, edytor, lista
   symulacji i porównanie używają tych samych klas: `.card`, `.metric`,
   `.banner`, `.segmented`, `.pill-toggle`, `.chip`, `.num-control`,
   `.action-bar`, `.btn`. Strona dokłada tylko układ (siatki, odstępy).
2. **Kolor znaczy jedno.** Fiolet = interakcja (akcja główna, zaznaczenie,
   fokus, aktywna zakładka). Pomarańcz = etap akumulacji. Turkus = etap
   realizacji. Zielony / bursztyn / czerwony = stan (sukces, ostrzeżenie,
   błąd). Liczby są domyślnie neutralne; kolor dostają tylko wtedy, gdy niesie
   znaczenie (ujemny podatek = oszczędność, najlepsza wartość w porównaniu).
3. **Trzy poziomy tła, nic więcej.** Strona (`--bg`), karta (`--surface`),
   wkład na karcie: kontrolka, inset, wiersz (`--surface-2`). Głębię robi
   obramowanie, nie cień. Cień ma tylko to, co pływa nad treścią: pasek akcji
   i dymek.
4. **Pięć rozmiarów tekstu.** `--fs-xs` 12 px (etykiety wersalikami,
   podpisy), `--fs-sm` 13 px (tekst pomocniczy, chipy), `--fs-md` 15 px
   (tekst bazowy, kontrolki), `--fs-lg` 18 px (tytuły sekcji), `--fs-xl`
   24 px (tytuły stron, kluczowa odpowiedź). Nic poniżej 12 px.
5. **Siatka 4 px, dwa promienie.** Odstępy z `--sp-*`. Promień `--r-md`
   10 px dla kontrolek i wkładów, `--r-lg` 14 px dla kart. Pigułki
   `--r-pill`.
6. **Jedna kontrolka liczbowa.** `.num-control` (minus / pole / plus)
    wszędzie: edytor, konfiguracja, asystent. Suwak jest dodatkiem w asystencie
    dla zakresów, nigdy zamiennikiem. Pole zawsze mieści najdłuższą prawidłową
    wartość wraz z przyciskami krokowymi; nie obcinamy kwot przez stałą szerokość.
    Konfiguracja edytuje w miejscu, bez trybu podglądu.
7. **Jeden język ikon.** Liniowe SVG, 24 × 24, `stroke-width` 1.8,
   `currentColor`. Zestaw w `static/js/icons.js` (`ICONS`, `iconSvg(name)`).
   Emoji nie są ikonami.
8. **Jeden pasek akcji.** `.action-bar` przyklejony do dołu, ten sam układ
   (lewo: akcje drugorzędne, środek: status, prawo: akcja główna). Strona,
   która go ma, dostaje `body.has-action-bar`, więc treść ma dolny margines i
   nic nie chowa się pod paskiem.
9. **Jedno ostrzeżenie.** `.banner` z wariantem `info | warn | danger |
   success`, ikona po lewej, tekst po prawej. Listy ostrzeżeń to kilka
   banerów albo jeden baner z listą, nigdy luźne akapity w kolorze.
10. **Mobile to ten sam produkt.** Poniżej 640 px nawigacja staje się dolnym
    paskiem zakładek z etykietami, siatki schodzą do jednej kolumny, tabele
    danych zamieniają się w karty wierszy. Między 641 a 1024 px nawigacja
    pokazuje same ikony. Segmenty formularzy i przyciski zawijają etykiety,
    zamiast powodować poziome przewijanie całej strony. Punkty łamania: 640,
    900, 1024 (nawigacja), 1200.
11. **Widoczny tekst jest krótki.** Na stronie zostają etykiety, krótkie
    instrukcje, statusy i ostrzeżenia. Mechanika, przykłady, listy składników,
    uzasadnienia i wyliczenia idą do `.tip` przy nagłówku panelu. Nie
    powtarzamy listy opcji w nagłówku sekcji, jeśli kontrolki są pod spodem.
    Dotyczy całego projektu, nie tylko Asystenta.
12. **Duży kafel czy mały przełącznik?** Wybór, który trzeba wytłumaczyć
    (profil ryzyka, priorytet wypłat, typ FIRE, sposób planowania), dostaje
    duże kafle `.wz-path`: tytuł i jednozdaniowy opis prostym językiem.
    Wybór oczywisty (płeć, brutto/netto, rok/miesiąc) zostaje małym
    `.segmented`. Kafel jest dla decyzji, nie dla dekoracji — nie zamieniamy
    w kafle listy równorzędnych, samotłumaczących się opcji. Akcja
    jednorazowa („Zacznij od propozycji”) może użyć wyglądu kafla, ale jest
    `<button>`, nie radio: nie udaje trwałego zaznaczenia.
13. **Jeden słowniczek, jedno znaczenie pojęć.** Definicje z sekcji 5 są
    źródłem prawdy dla kafelków, tooltipów i wyników. Nie wymyślamy
    synonimów („auto przygotuje podział”) ani skrótów, których nie ma
    w słowniczku; nowy termin dopisujemy najpierw tutaj, potem używamy
    w interfejsie.

## 2. Tokeny

| Grupa | Token | Wartość | Użycie |
| --- | --- | --- | --- |
| Tło | `--bg` | `#0f1117` | strona |
| | `--surface` | `#171a24` | karta, pasek akcji, topbar |
| | `--surface-2` | `#1f2331` | kontrolki, insety, wiersze na karcie |
| | `--surface-hover` | `#262b3b` | hover kontrolek i wierszy |
| Krawędź | `--border` | `#2a2f40` | wszystkie obramowania |
| | `--border-strong` | `#3a4156` | hover, fokus bez koloru |
| Tekst | `--text` | `#e7e9f0` | treść |
| | `--text-2` | `#a3a8bb` | tekst pomocniczy |
| | `--text-3` | `#8b93ab` | etykiety, podpisy, ikony nieaktywne |
| Interakcja | `--primary` | `#7b6cf0` | przycisk główny, zaznaczenie, fokus |
| | `--primary-hover` | `#8b7df5` | |
| | `--primary-text` | `#9a8cf7` | tekst i linki w kolorze marki (≥ 4,5:1 na `--surface-2`) |
| | `--on-primary` | `#ffffff` | |
| Etapy | `--stage-accum` | `#e8845c` | akumulacja |
| | `--stage-real` | `#27c4bb` | realizacja |
| Stan | `--success` | `#3ccf91` | |
| | `--warning` | `#f0b64b` | |
| | `--danger` | `#f26d6d` | |
| Marka | `--brand-flame-*`, `--brand-tile-*` | gradient płomienia i ramki | tylko logo |

Serie kont na wykresach Asystenta mają stałe tokeny `--acct-*`
(`--acct-zus`, `--acct-ike`, `--acct-broker` itd.). Kolor identyfikuje konto
w obu wykresach, a nie stan ani interakcję; legenda i tooltip są jedynym
miejscem, gdzie ta tożsamość jest opisana. Wypełnienie area to pionowy
gradient od 64% do 12% krycia z cienką krawędzią w kolorze konta — bez
płaskich, w pełni kryjących plam. Próbki legendy używają mocniejszego
gradientu 82% → 32%, żeby pozostały czytelne w małym rozmiarze. Tooltip
wykresów ma kartę totalu zbudowaną z `.metric`: etykieta, duża kwota
i podpis z drugą jednostką lub kontekstem.

Przezroczyste warianty robimy przez `color-mix(in srgb, var(--x) 12%,
transparent)`; nie wpisujemy `rgba()` z liczbami.

Kontrast: `--text`, `--text-2`, `--text-3` i `--primary-text` muszą mieć
co najmniej 4,5:1 na `--surface-2` (najciemniejsze tło tekstu). `--primary`
służy do wypełnień, obramowań i fokusu — jako kolor tekstu jest za ciemny.

## 3. Komponenty

- `.btn` + `.btn-primary | .btn-secondary | .btn-ghost | .btn-danger`,
  rozmiar `.btn-sm`, ikona `.btn-icon` (kwadratowy). Przyciski nie mają
  własnych marginesów; odstępy daje kontener (`.btn-row`).
- `.card` (tło `--surface`, obramowanie, `--r-lg`, padding `--sp-5`),
  `.card-head` / `.card-title` / `.card-sub`, `.card-inset` (wkład na karcie:
  `--surface-2`, `--r-md`).
- `.metric` (etykieta nad wartością, wartość `tabular-nums`), `.metric-grid`
  (auto-fit, min 150 px), modyfikatory stanu `.is-positive | .is-negative`.
- `.banner` + wariant, `.banner-list` dla kilku punktów.
- `.segmented` + `.seg-option` (radio w środku), pełna szerokość w formularzu,
  `.segmented-stack` na mobile.
- `.wz-paths` + `.wz-path` (duży kafel wyboru: tytuł i opis; radio albo
  przycisk-akcja), `.wz-choice-cards` dla siatki kafli.
- `.pill-toggle` (ikona + etykieta, `aria-pressed`), `.pill-grid`.
- `.chip` (mała etykieta konta), `.chip-accum | .chip-real` dla etapów.
- `.num-control` (`.stepper` + `.acc-field`), `.range` dla suwaków.
- `.field` (etykieta `.field-label` nad kontrolką), `.field-hint`.
- **Siatki pól:** porównywalne pola mają równe kolumny; układ asymetryczny stosuj
  tylko dla celowego zestawu wyboru i powiązanej kontrolki. Każda kontrolka
  liczbowa musi mieścić największą dozwoloną wartość.
- `.action-bar` (+ `.action-bar-left | -center | -right`).
- `.table-wrap` + `table` (nagłówki `--fs-xs` wersalikami, `--text-3`).
- `.tip` + `.tooltip` (dymek, jedyny element z cieniem poza paskiem akcji).
- `.stage-dot`, `.stage-label` z `.accum | .real` do oznaczania etapów.
- `.progress` (pasek postępu, kolor `--primary`).

## 4. Nawigacja

Topbar: marka po lewej i cztery sekcje (Porównywarka, Asystent, Symulator,
Konfiguracja). Aktywna sekcja: tekst `--text`, tło `--primary` 12 %. Między
641 a 1024 px sekcje pokazują tylko ikony (pełna nazwa w `title` i
`aria-label`). Poniżej 640 px cztery sekcje przenoszą się do dolnego paska
zakładek (ikona + etykieta), w topbarze zostaje marka. Między 360 a 640 px
marka zachowuje podtytuł w jednej linii (z elipsis); poniżej 360 px podtytuł
znika.

## 5. Słowniczek pojęć

Ten sam termin ma wszędzie to samo znaczenie — w kafelkach, tooltipach,
wynikach i eksporcie. Definicje są krótkie i pisane językiem użytkownika,
bez skrótów myślowych.

- **FIRE** — niezależność finansowa i możliwość wcześniejszego zakończenia
  pracy zarobkowej.
- **Full FIRE** — całkowite zakończenie pracy w wybranym wieku.
- **Coast FIRE** — przejście na część etatu; pensja pokrywa bieżące życie,
  a oszczędności nadal rosną bez nowych wpłat.
- **Barista FIRE** — praca na część etatu z pensją mniejszą niż potrzeby;
  różnicę pokrywa portfel.
- **Horyzont planu** — wiek, do którego liczymy wypłaty, metryki i kapitał
  końcowy. Wykresy wyniku dorysowują ZUS do 100 r.ż., ale metryki kończą się
  na horyzoncie.
- **Wypłata netto** — kwota, którą realnie dostajesz co miesiąc po podatkach
  i składkach.
- **Suma wypłat** — łączna kwota wypłacona w całym horyzoncie, bez kapitału
  zostawionego na koniec.
- **Profil ryzyka** — limity koncentracji **nowych wpłat** (krypto, aktywa
  rynkowe, aktywa bezpieczne). Działa na całą pulę, także na zawartość
  IKE/IKZE/OIPE; nie zmienia istniejącego portfela.
- **Pula wpłat** — miesięczna kwota, którą dzielisz między konta i gotówkę.
- **Udział konta** — część puli wpłat przypisana do jednego konta; suma
  udziałów nie przekracza 100 %.
- **Gotówka (reszta)** — część puli, której nie przypisano do żadnego konta;
  leży bezczynnie i nie zarabia.
- **IKE / IKZE / OIPE** — opakowania podatkowe z limitem rocznym i ulgą;
  limit dotyczy wpłat, nie wypłat. Nie są klasą ryzyka — ryzyko wynika
  z rodzaju inwestycji w środku.
- **Rodzaj inwestycji (wrapper)** — Maklerskie (akcje/ETF), Funduszowe
  (fundusze/portfel zarządzany) albo Oszczędnościowe (lokaty, obligacje,
  fundusze obligacji). Rodzaj ustala domyślne ROI i klasę ryzyka. Jeden
  wrapper ma jeden dominujący rodzaj; mieszany rachunek modelujemy własnym ROI.
- **Dostępność rodzajów** — konfigurowalna per wrapper. Domyślnie OIPE ma
  tylko Funduszowe (Finax), a IKE/IKZE wszystkie trzy.
- **ZUS / wiek ZUS** — publiczna emerytura i wiek, od którego ją pobierasz.
- **ROI** — średnioroczny zwrot przyjęty w symulacji; założenie scenariuszowe,
  nie prognoza. Zmienisz je w Konfiguracji.
- **Bufor / spadek** — minimalny majątek netto, który ma zostać na koniec
  horyzontu (0 = wydać wszystko).
