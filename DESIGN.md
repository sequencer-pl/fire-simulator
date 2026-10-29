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
   dla zakresów, nigdy zamiennikiem. Konfiguracja edytuje w miejscu, bez trybu
   podglądu.
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
    pokazuje same ikony. Punkty łamania: 640, 900, 1024 (nawigacja), 1200.

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
- `.pill-toggle` (ikona + etykieta, `aria-pressed`), `.pill-grid`.
- `.chip` (mała etykieta konta), `.chip-accum | .chip-real` dla etapów.
- `.num-control` (`.stepper` + `.acc-field`), `.range` dla suwaków.
- `.field` (etykieta `.field-label` nad kontrolką), `.field-hint`.
- `.action-bar` (+ `.action-bar-left | -center | -right`).
- `.table-wrap` + `table` (nagłówki `--fs-xs` wersalikami, `--text-3`).
- `.tip` + `.tooltip` (dymek, jedyny element z cieniem poza paskiem akcji).
- `.stage-dot`, `.stage-label` z `.accum | .real` do oznaczania etapów.
- `.progress` (pasek postępu, kolor `--primary`).

## 4. Nawigacja

Topbar: marka po lewej, cztery sekcje (Moje symulacje, Asystent, Symulator,
Konfiguracja) i konto po prawej. Aktywna sekcja: tekst `--text`, tło
`--primary` 12 %. Między 641 a 1024 px sekcje pokazują tylko ikony (pełna
nazwa w `title` i `aria-label`). Poniżej 640 px cztery sekcje przenoszą się do
dolnego paska zakładek (ikona + etykieta), w topbarze zostaje marka i konto.
Między 360 a 640 px marka zachowuje podtytuł w jednej linii (z elipsis); poniżej
360 px podtytuł znika. Do 480 px przycisk logowania zostaje samą ikoną.
