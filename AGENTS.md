# AGENTS.md — FIRE Simulator

Polski symulator niezależności finansowej. FastAPI + Jinja2 + vanilla JS (bez npm,
bez TypeScript), SQLite, pytest. Odpowiadaj i pisz UI po polsku.

## Pewniki modelu FIRE (aktualne, nie do zmiany bez uzgodnienia)

- **ROI netto wszędzie.** Wszystkie konta rosną według ROI *po* podatkach; podatek
  naliczany jest od wypłat (`_apply_tax`, engine.py). Wyjątek: lokata
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
  odkładać, path 3 = kiedy FIRE. Gwarancja = żaden rok nie spada poniżej targetu.

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
- Panel bez pary „opcja|wartość" (np. Strategia w kroku 4): pigułki `.gender-options`
  rozciągnięte na CAŁĄ szerokość panelu (komórka = panel) — to nie jest slot; do
  niego nie stosuje się reguły `300px 1fr`. Przyciski akcji pod selektorem
  (`.wz-strategy-actions`: „Podziel ręcznie"/„Zaproponuj", `space-between`,
  jedna wysokość `.btn nowrap`). Panele „Podział"/„Dodaj instrument"/„Wpłaty z pensji"
  są **bramkowane trybem** (`wzAllocMode`, auto/manual) — przed wyborem ukryte.
  Podtytuł kroku (`#wzAllocHeader`, subscript „Odkładasz X zł/mies…”/
  „Kliknij Wylicz plan…") jest renderowany przy KAŻDYM wejściu na krok 4
  (`setStep` → `buildAllocationStep`), więc pula oszczędności jest widoczna
  zanim użytkownik wybierze tryb. Podtytuł to `.wz-alloc-head` z dwoma
  wierszami: pula (`.wz-alloc-pool`, kwota `<strong>` w kolorze `--primary`)
  + nota Gotówka (`#wzAllocCashNote`, widoczna gdy pula znana). Emotki przy
  nazwach strategii (🛡️ / ⚖️ / 🚀) — w labelach radio.
  „Zaproponuj" (`.btn-gradient`) = tryb **auto**: stawia sugestię wg
  pojemności limitów (`suggest_allocations`/`STRATEGY_SUGGEST`, planner.py) i pokazuje
  TYLKO sekcję „Podział" w **read-only** (statyczne wiersze `.wz-alloc-readonly`,
  bez suwaków, pigułek i „wpłat z pensji"; przycisk `aria-pressed`). „Podziel ręcznie"
  = tryb **manual**: pełny interaktywny układ (suwaki/pola, wiersz Gotówki, pigułki
  „Dodaj instrument", „Wpłaty z pensji") z zachowanymi wagami sugestii do dostrojenia.
  Układ wiersza podziału: **desktop = etykieta | suwak | % | zł** (% i zł wyrównane do
  prawego brzegu — suwak `flex: 1 1 auto` wypełnia środek); **≤560px (container) =
  etykieta | % | zł w jednej linii przy prawym brzegu, suwak pełnej szerokości pod
  spodem** (`order: 5`); w trybie auto statyczne „%"/„zł" też do prawego brzegu
  (`.wz-alloc-static`/`.wz-alloc-money { margin-left: auto }`).
  Wybór trybu jest **wymagany**: bez niego „Dalej" jest wyłączony
  (`wzNextBtn.disabled`, `.btn:disabled`), a wyjaśnienie jest tylko tooltipem
  (natywny `title` na wrapperze `.wz-next-tip` — na disabled buttonie title się
  nie pokazuje) oraz **dymkiem po kliknięciu** (`.wz-next-pop`, `role=status`,
  klika się wrapper, bo `#wzNextBtn:disabled { pointer-events: none }`; tekst
  współdzielony przez stałą `ALLOC_GATE_MSG`, auto-ukrycie ~4 s) — refresh
  bramki w `updateFooterNav`/`setAllocMode`/`runSuggestAllocation.finally`,
  a `validateStep(4)` to siatka bezpieczeństwa (`allocReady()` =
  `wzAllocMode != null`). Na **≤640px selektor Strategii zmienia się w pionową
  radio-listę** (pełnowymiarowe wiersze z `border`, kontener bez obramowania;
  na >640px zostaje segment).
  Usuwanie instrumentu („Usuń"/pastylka) czyści też wagę
  (`deactivateAllocAccount`/`togglePill` — `delete wzWeights[acc]`), a
  `collectAllocations` pomija wagi nieaktywnych kont
  (`isCapActive(acc) && wzWeights[acc] > 0`) — martwe udziały nigdy nie wracają
  do sumy (inaczej sugerowanie/plan potrafiły błędnie przekroczyć 100%).
- Krok 5 „Cel i horyzont": 4 pełnowymiarowe wiersze `.wz-slider` w kontenerze
  `.wz-rows` (pionowy stack, separatory `1px solid var(--border)` między wierszami
  w każdej szerokości — układ zawsze pionowy; bez hint-podpowiedzi, ewentualny
  kontekst w `title` labela). Domyślne wartości **wg płci i wieku** przeliczane
  automatycznie dopóki pola nie były ręcznie edytowane (flagi `wzRetirementTouched`/
  `wzPlanEndTouched`): „Wiek emerytury" = `RETIREMENT_DEFAULT` (60 k / 65 m, spójne
  z `config.zus.wiek_emerytalny_*`); „Koniec planu" = wiek + `LIFE_EXPECTANCY`
  (średnie dalsze trwanie życia wg płci i wieku — GUS, tablica trwania życia za
  2024 r., dane w wizard.js, to dane UI a nie backendu). Traktuj jak krok 2:
  `.num-control` PRZED range, `bindSliderRange`.

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
  50 000 zł (7 cyfr); 11ch mieści ją z zapasem, bez rośnięcia pola przy wpisie.
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