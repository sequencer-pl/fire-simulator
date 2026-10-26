# AGENTS.md — FIRE Simulator

Polski symulator niezależności finansowej. FastAPI + Jinja2 + vanilla JS (bez npm,
bez TypeScript), SQLite, pytest. Odpowiadaj i pisz UI po polsku.

## Pewniki modelu FIRE (aktualne, nie do zmiany bez uzgodnienia)

- **ROI realne (ponad inflacją) wszędzie.** Wszystkie konta rosną według ROI *po* podatkach; podatek od zysków naliczany jest od wypłat (`_apply_tax`, engine.py). Wyjątek: lokata
  (`tax_periodic`) — podatek Belka pobierany w trakcie akumulacji, wzrost już netto
  (użycia `_periodic_net_roi`, engine.py; definicja `periodic_net_roi`, core/roi.py).
- **Inflacja świadomie pomijana** w większości wyliczeń — wartości realne traktujemy
  jak nominalne. Inflacja występuje TYLKO w: kontu `gotowka` (ROI = -inflacja,
  engine.py), waloryzacji świadczenia ZUS i indeksacji kapitału
  (`_accumulate_zus`/`_convert_zus`, app/simulation/zus.py) oraz helperach
  Fisher/deflate (core/inflation.py). Nie dodawać inflacji do wzrostu kont ani do
  PMT bez zgody.
- **Dwa tryby realizacji** (app/stages/realizacja.py):
  - PMT (annuitizacja do zera) — edytor `/sim` bez targetu i legacy;
  - stały cel netto — TYLKO wizard (edytor nigdy). Wypłata = `cel − bieżąca renta ZUS`,
    rozdzielana proporcjonalnie do sald; niewypłacone rośnie `(1+roi)`.
- **„Brydż do emerytury" = etap `realizacja`** (nie akumulacja) od wieku FIRE do końca
  planu; „Realizacja (emerytura)" = osobny etap `realizacja` zawierający tylko `zus`.
- **ZUS obsługuje engine**, nie etap (waloryzacja zamiast ROI, konwersja kapitału na
  rentę zamiast PMT; renta waloryzowana corocznie). Nie powielać `zus` w wielu etapach
  (`_process_stages`, engine.py — guard `zus_handled`).
- Klucze kont są stałe (`broker, gotowka, ike, ikze, krypto, lokata, obligacje, oipe,
  oki_inw, oki_osk, ppe, ppk, zus`) — patrz `ACCOUNT_LABELS` w config.py.
- Wizard: path 1 = maks. stała wypłata netto (bisekcja + gross-up), path 2 = ile
  odkładać (procent liczymy od pensji **netto**), path 3 = kiedy FIRE. Gwarancja =
  żaden rok nie spada poniżej targetu. Path 2: górna granica bisekcji nie jest
  dowodem niewykonalności, bo podatek od aktywów OKI rośnie z saldem — przy bardzo
  wysokich oszczędnościach wypłata netto może spaść poniżej targetu; solver schodzi
  wtedy do osiągalnego pułapu i bisekcjonuje od zera (`_solve_savings`).

## Architektura i konwencje kodu

- `app/simulation/engine.py` — silnik + schematy; `app/simulation/zus.py` — klaster
  ZUS (waloryzacja, konwersja kapitału na rentę, wiek emerytalny);
  `app/simulation/constants.py` — stałe liczbowe (DEFAULT_ROI, MONTHS_PER_YEAR,
  PPE_ZUS_FRACTION); `app/simulation/planner.py` — wizard (plan, build_stages,
  solvery); `app/stages/*.py` — implementacje etapów; `app/web/` — FastAPI
  (routes.py, auth.py, simulations.py); `app/core/` — helpery (tax, pmt, roi,
  inflation); `static/js/` + `app/templates/` — front.
- Python: pełne adnotacje typów, pydantic BaseModel dla DTO, bez zbędnych komentarzy.
- JS: bez frameworków, funkcje nazwane, współdzielone helpery przez `window.*`
  (helpers.js: `$`, `show`, `escapeHtml`, `fmtMoney`, `api`; controls.js:
  `numControlsHtml`, `initNumControls`; session.js: `refreshSessionBar`). helpers.js
  ładowany z base.html przed `{% block scripts %}`, controls.js — w wizard.html
  i simulator.html.

## Konwencje UI — wzorcem spójności jest zakładka /sim (edytor)

- Nowy widok = kopia struktury `/sim`: `data-section` w body (base.html),
  `.topnav a[data-nav]`, przełączanie widoków edytora przez `setNavSection`
  (simulator.js:338), 5 pozycji nawigacji + `accountWidget`.
- Kolory/typo wyłącznie z CSS variables `style.css`
  (`--primary --surface --border --text --text-dim --danger --success --bg
  --card-bg --accent --orange`). Zero hardkodu kolorów (hex/rgba) w CSS, JS i HTML.
  Zamiast `var(--x, #yyyyyy)` używaj samej zmiennej.
- Karty/insety: `background: var(--card-bg)` + `border: 1px solid var(--border)`,
  radius 10–12px — nie wymyślaj nowych borderów/cieni.
- Ostrzeżenia, overalokacje, „nadwyżka" = **`--orange`**. Błędy = `--danger`.
- Semantyka kolorów etapów jak `/sim`: **akumulacja = `--orange`, realizacja = `--accent`**
  (dotyczy kropek, etykiet i osi czasu — np. gradient timeline w asystencie).
- Kontrolki standardowe: `.btn (primary/secondary/danger)`, `.field-group` +
  label + input, `.form-msg (.ok/.err)`, `.tab-btn(.active)`, bloki etapów przez
  `createStageBlock`/`.stage-block` (sim-stages.js).
- **Wybór jednej z kilku opcji = radio pills `.gender-option`** (jak „Forma
  zatrudnienia"), a nie natywny `<select>`. Wartość czytaj przez `radioChecked(name)`
  (wizard.js). Nowe pola liczbowe przez `numControlsHtml`/`initNumControls`
  (controls.js — jedyny punkt obsługi stepperów → `.num-control` + `.stepper`),
  nie surowe inputy.

### Układ wierszowy formularza (wzór: krok 2 asystenta, wizard.css)

- Pole w panelu = `.wz-grid`: **≥821px dwie kolumny `300px 1fr`** (lewy slot opcji
  wyboru | prawa wartość) — sloty i kontrolki wyrównane w całym widoku; **<821px
  jedna kolumna** ze separatorami `1px solid var(--border)` między polami
  (`.wz-grid > * + *:not(.form-msg)`).
- Selektory pigułkowe `.gender-options` **zawsze `width: 100%`** swojej komórki,
  segmenty `.gender-option { flex: 1 0 auto }` + `white-space: nowrap` (proporcjonalne
  od naturalnej szerokości, nigdy się nie ściskają → tekst zawsze w jednej linii,
  slot min. 300px mieści najszerszą grupę); etykieta nad pigułkami (`.wz-inline-field`
  w układzie kolumnowym). Na ≤480px bokowy padding pigułek `.8rem → .5rem` (miejsce
  dla 3-segmentowej Formy w wąskich widokach).
- Suwak z wartością `.wz-slider`: **`.num-control` zawsze PRZED `input[type="range"]`**
  — na desktopie liczba po lewej, suwak po prawej (wartość nie zasłaniana);
  **≤480px** num-control na górnej linii, range pełnej szerokości pod nim
  (`flex: 1 1 100%`, bez `order`).
- **Pole kwotowe (pensja, salda, cel, kwota oszczędności, limity): `width/min-width: 11ch`,
  `flex-shrink: 0`, `font-variant-numeric: tabular-nums`** — input KWOTOWY nigdy nie
  kompresuje się w wierszu i mieści 7-cyfrową kwotę w całości. To się powtarza —
  nie dodawaj pola kwotowego bez tej reguły (11ch = baza; większe wartości wymagają
  więcej).
- Ostrzeżenia `.form-msg.warn` — pełna szerokość (`grid-column: 1 / -1`).
- Krok 2 „Twoje dane": 3 panele w kolejności „Ty" | „Praca i dochód" |
  „Odkładasz miesięcznie". Pensja ma segment **Brutto / Netto** (`#wzSalaryMode`)
  **tylko dla etatu**; B2B zostaje przy brutto z tooltipem (netto zależy od formy
  opodatkowania), a „Nie pracuję" chowa pole. Segment siedzi w `.wz-choice-row`
  obok pastylek formy zatrudnienia (obie grupy mieszczą się w lewej kolumnie
  300 px; na węższym ekranie Brutto/Netto zawija się pod spód). Obok labela
  pensji `#wzSalaryHint` pokazuje kwotę odwrotną („≈ netto" / „≈ brutto")
  z `POST /api/wizard/salary`
  (`app/simulation/salary.py`: ZUS pracownika 13,71%, zdrowotna 9%, PIT wg skali
  + danina; przy planie doliczana jest składka pracownika PPK, jeśli PPK jest
  włączone w kroku 3). Oszczędności są **tylko kwotowe**: `#wzSavings` domyślnie
  **1000 zł/mies.**, suwak `#wzSavingsAmtRange` 0–netto, bez trybu procentowego.
  `#wzSavingsHint` pokazuje „`kwota` = `%` pensji netto", a `#wzSavingsWarn`
  ostrzega tylko przy kwocie > pensja netto. `collectAnswers()` wysyła
  `salary_mode` i `savings`; backend normalizuje netto→brutto **raz** na wejściu
  `plan()`/`estimate_pool_monthly()`, więc solvery nie powtarzają konwersji.
- Krok 3 „Kapitał": **wszystkie 14 kont** (w tym `zus:ofe`) jako pastylki wyboru
  w `#wzCapitalPicker`; wybrane konto dodaje pole kwotowe do `#wzCapitalGrid`
  (ponowne kliknięcie pastylki / „Usuń” je zabiera). Do odpowiedzi trafiają tylko
  kwoty > 0.
- Krok 4 („Kiedy chcesz przejść na FIRE?” / „Twój cel wypłaty i wiek FIRE” /
  „Wymarzona wypłata i horyzont” wg ścieżki): 4 pełnowymiarowe wiersze `.wz-slider`
  w kontenerze `.wz-rows` (pionowy stack, separatory `1px solid var(--border)`
  między wierszami w każdej szerokości — układ zawsze pionowy; bez hint-podpowiedzi,
  ewentualny kontekst w `title` labela). Pola są ukrywane zależnie od ścieżki:
  cel wypłaty tylko dla 2/3, wiek FIRE tylko dla 1/2. Domyślne wartości **wg płci
  i wieku** przeliczane automatycznie dopóki pola nie były ręcznie edytowane (flagi
  `wzRetirementTouched`/`wzPlanEndTouched`): „Wiek emerytury ZUS" = `RETIREMENT_DEFAULT`
  (60 k / 65 m, spójne z `config.zus.wiek_emerytalny_*`); „Horyzont czasowy wypłat" =
  wiek + `LIFE_EXPECTANCY` (średnie dalsze trwanie życia wg płci i wieku — GUS, tablica
  trwania życia za 2024 r., dane w wizard.js, to dane UI a nie backendu). Traktuj jak
  krok 2: `.num-control` PRZED range, `bindSliderRange`.
- Krok 5 „Strategia i założenia" ma 5 paneli: „Założenia rynkowe (koniunktura)",
  „Strategia podziału oszczędności", „Podział", „Dodaj instrument", „Wpłaty z pensji".
  **Założenia i strategia to dwa niezależne wybory.** Założenia (3 pigułki:
  🌧️ Konserwatywne / 🌤️ Realne / ☀️ Optymistyczne) sterują ROI, inflacją i waloryzacją
  ZUS w backendzie (`planner.py`); strategia (4 pigułki: 🛡️ Konserwatywna,
  ⚖️ Zrównoważona, 🚀 Agresywna, 🎛️ Manualna) tylko rozdziela oszczędności między konta.
- Pigułki paneli bez pary „opcja|wartość" rozciągają się na CAŁĄ szerokość panelu
  (`.gender-options`, komórka = panel) — nie stosuje się do nich slotu `300px 1fr`.
  Na **≤640px selektor strategii zmienia się w pionową radio-listę** (pełnowymiarowe
  wiersze z `border`, kontener bez obramowania; na >640px zostaje segment).
- Wybór strategii jest **wymagany**; na starcie kroku 5 żaden tryb nie jest aktywny.
  Automatyczne strategie ustawiają `wzAllocMode = "auto"`: wołają `/api/wizard/suggest`
  (w ścieżce 2 z celem wypłaty z kroku 4 i szacowaną pulą `pool_monthly`) i pokazują
  TYLKO sekcję „Podział" w **read-only** (statyczne wiersze `.wz-alloc-readonly`, bez
  suwaków, pigułek i „wpłat z pensji"). „Manualna" ustawia `"manual"`: pełny
  interaktywny układ (suwaki/pola, wiersz Gotówki, pigułki „Dodaj instrument",
  „Wpłaty z pensji") z zachowanymi wagami sugestii do dostrojenia.
  Podtytuł/pula (`#wzAllocHeader`) i nota Gotówka (`#wzAllocCashNote`) są renderowane
  przy KAŻDYM wejściu na krok 5 (`setStep` → `buildAllocationStep`) i przy zmianie
  trybu. **Wiersz podziału jest kwotowy (rocznie), a nie procentowy:** etykieta |
  pogrubione pole `zł/rok` | suwak roczny | wyszarzone `≈zł/mies.` | najmniejsze
  pochodne `≈%`. Procenty są wyłącznie prezentacyjne (zaokrąglone do pełnych liczb,
  `<1%` dla niezerowych ułamków) — backend nadal dostaje `WizardAnswers.allocations`
  jako udziały procentowe. Konta z limitem pokazują spokojną notę `limit roczny:
  X zł` / `limit roczny osiągnięty`, a suwak i pole mają maksimum
  `min(pozostała pula, limit roczny)` — ręcznie nie da się przekroczyć limitu.
  Układ: **szeroka karta = jedna linia + nota limitu pod spodem**; **≤820px
  (container)** etykieta, kwota, `≈zł/mies.` i `≈%` zawijają się w naturalny
  sposób, a suwak zajmuje pełną szerokość (`order: 5`), nota limitu idzie pod
  nim (`order: 6`). Próg jest większy niż mobile, bo przy ok. 560–800px pełny
  wiersz nie mieści już prawej pary `≈zł/mies.` + `≈%` i procent spadałby
  samotnie do nowej linii.
  **Ścieżki 1/3:** kanoniczne są kwoty roczne (`wzAmounts`); wzrost puli zostawia
  kwoty, a różnica trafia do Gotówki; spadek puli proporcjonalnie przycina kwoty
  (`wzReconcileAmounts`). **Ścieżka 2:** kanoniczne są wagi procentowe
  (`wzWeights`); kwoty są pochodne i przeliczają się po zmianie/solved puli
  (`wzSyncAmountsFromWeights`), z notą „Podział proporcjonalny…”. Ręczna edycja
  kwoty w ścieżce 2 ustawia wagę `kwota / pula × 100`. Noty o nadwyżce ponad limit
  pokazują się tylko, gdy po zaokrągleniu do pełnych złotych nadwyżka miesięczna
  wynosi ≥ 1 zł (mikronadwyżki z zaokrągleń są ukryte).
- Bez wybranej strategii „Wylicz plan" jest wyłączony (`wzNextBtn.disabled`,
  `.btn:disabled`), a wyjaśnienie jest tylko tooltipem (natywny `title` na wrapperze
  `.wz-next-tip` — na disabled buttonie title się nie pokazuje) oraz **dymkiem po
  kliknięciu** (`.wz-next-pop`, `role=status`, klika się wrapper, bo
  `#wzNextBtn:disabled { pointer-events: none }`; tekst współdzielony przez stałą
  `ALLOC_GATE_MSG`, auto-ukrycie ~4 s) — refresh bramki w
  `updateFooterNav`/`setAllocMode`/`runSuggestAllocation.finally`, a `validateStep(5)`
  to siatka bezpieczeństwa (`allocReady()` = `wzAllocMode != null`).
- Usuwanie instrumentu („Usuń"/pastylka) czyści też kwotę i wagę
  (`deactivateAllocAccount`/`togglePill` — `delete wzWeights[acc]` i
  `delete wzAmounts[acc]`), a `collectAllocations` pomija wagi nieaktywnych kont
  (`isCapActive(acc) && wzWeights[acc] > 0`) — martwe udziały nigdy nie wracają
  do sumy (inaczej sugerowanie/plan potrafiły błędnie przekroczyć 100%).
- Krok 6 „Twój plan FIRE": loader `#wzPlanLoader` (3 etapy) na czas `runPlan()`,
  potem Hero Answer (`#wzHeroAnswer`, odpowiedź zależna od ścieżki), 3 karty
  scenariuszy (`#wzScenariosBox`), metryki (`#wzMetrics`), solved (`#wzSolved`),
  ostrzeżenia (`#wzWarnings`), oś czasu (`#wzTimeline`), podsumowanie etapów
  (`#wzStageSummaryList`) i notatka o wypłatach netto. **Nie ma `#wzStagePreview`.**
  Klik karty ustawia `wzSelectedScenario` i przerenderowuje CAŁY wynik z
  `scenario_projections`/`scenario_solved`/`scenario_inputs` przez
  `renderScenarioResult()` (hero, metryki, solved, ostrzeżenia, oś czasu, etapy).
  Lista etapów pokazuje przybliżone kwoty miesięczne z
  `PlanProjection.stage_metrics` (akumulacja = średnie wpłaty do portfela bez
  ZUS; realizacja = średnia wypłata netto). W nakładających się etapach
  „Dopłata do emerytury” i „Emerytura ZUS” wiersze pokazują składniki
  (portfel / ZUS), które się sumują — pod listą jest przypis.
  Wybór scenariusza jest zapisywany w `localStorage` i odtwarzany przez
  `/wizard?restore=1`. Wejście z kroku 5 od razu uruchamia `runPlan()`.

### Założenia projektowe układu wierszowego (dlaczego tak — stosuj przy innych widokach)

- **Slot opcji = stała szerokość**, wspólna dla wszystkich paneli widoku — wyrównuje
  lewe brzegi wartości i prawych kontrolek. Wartość dobierana z pomiaru: suma
  naturalnych szerokości najszerszej grupy pigułek + zapas na fonty (~8%, mierzone w
  Chromium na systemowej czcionce; Forma naturalnie 276.5px → slot 300px).
- **Pigułki zawsze rozciągnięte do swojej komórki** — duży, jednoznaczny cel
  kliknięcia i spójny wygląd. Segmenty **proporcjonalne (`flex: 1 0 auto`)**, NIE
  równe (`flex: 1 1 0%`) — równe ściskałyby najdłuższą etykietę poniżej szerokości
  tekstu i wymuszały łamanie linii.
- **Tekst pigułki zawsze w jednej linii** (`white-space: nowrap`) — selektor o
  innej wysokości niż sąsiednie kontrolki wygląda jak błąd. Koszt: slot musi mieć
  szerokość najszerszej etykiety (a na ≤480px redukujemy padding pigułek, by zmieścić
  grupy 3-segmentowe w wąskich widokach).
- **Wartość przed suwakiem** (`.num-control` PRZED `input[type="range"]`) — na
  mobile liczba jest nad suwakiem i kciuk jej nie zasłania; na desktopie z tej samej
  zasady liczba po lewej, suwak po prawej.
- **Inputy kwot `11ch` (+`min-width: 11ch`)** — największa kwota w widoku to pensja
  100 000 zł (7 cyfr); 11ch mieści ją z zapasem, bez rośnięcia pola przy wpisie.
- **Separator między polami tylko w układzie pionowym (<821px)** — w 2-kolumnowym
  siatka wystarczająco oddziela; bez separatora w pionowym wiersze się zlewają.
- **Ostrzeżenia na pełną szerokość** — nie łamią siatki 2-kolumnowej i mają miejsce
  na pełny komunikat.
- Klasy wielokrotnego użytku: `.wz-grid`, `.wz-inline-field`, `.wz-field-block`,
  `.wz-slider` (wizard.css).
- Aktywa wersjonowane przez `?v={{ version }}` (`_asset_version`, routes.py:37) —
  dodaj do każdego nowego pliku JS/CSS w template.

## Współpraca z użytkownikiem

- Gdy masz jakiekolwiek pytanie lub wątpliwość co do intencji, zakresu albo
  trade-offów — zadaj je w fazie planowania, ZANIM zaczniesz wprowadzać zmiany.
  Nie zgaduj. Użytkownik oczekuje pytań i sam o nie prosi.
- Jeśli uważasz, że pomysł użytkownika jest zły albo da się zrobić lepiej —
  mów o tym na głos i proponuj własne (lepsze lub alternatywne) rozwiązanie.
  Użytkownik woli usłyszeć Twoją opinię niż ślepe wykonanie.

## Weryfikacja przed oddaniem

- `uv run ruff check app/ tests/ scripts/`
- `uv run pytest -q` (suite musi być zielony)
- `uv run mypy app/` (make typecheck) — typy muszą być czyste
- `node --check static/js/...` dla zmienionych plików JS
- zmiany w wizard.js / sim-stages.js / simulator.js (binding): `make harness-jsdom`
  (qa/jsdom/repro.mjs)
- zmiany wizualne: `make visual` (qa/visual, Playwright + baseline'y)

## Workflow git / deploy

- Commit TYLKO na wyraźną prośbę. Przed: `git status`, `git diff`, spójny styl logu.
  Wiadomości po polsku, conventional (`feat(scope):`, `fix`, `chore`, `refactor`).
- Praca na branch-ach (`wizard`, `..._refactor`); merge do `main` fast-forward.
- Push do `main` = CI + auto-deploy na Render (GH Action `deploy.yml`, hook
  `RENDER_DEPLOY_HOOK`). „Zakomituj i wdróż" = push `main`; „bez deployu" = commit
  lokalnie bez pusha (ew. push tylko brancha). Wdróż tylko na wyraźną prośbę.
- Nie commituj sekretów. `render.yaml`: web service free tier, dysk ephemeryczny.