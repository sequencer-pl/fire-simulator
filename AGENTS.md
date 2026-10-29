# AGENTS.md — FIRE Simulator

Polski symulator niezależności finansowej. FastAPI + Jinja2 + vanilla JS (bez npm,
bez TypeScript), SQLite, pytest. Odpowiadaj i pisz UI po polsku.

## Pewniki modelu FIRE (aktualne, nie do zmiany bez uzgodnienia)

- **ROI realne (ponad inflacją), brutto — przed podatkiem — wszędzie.** Silnik nalicza
  podatek według zasad konta: od wypłat (`_apply_tax`), periodycznie na lokacie
  (`tax_periodic`) albo rocznie od aktywów OKI. `ROI` ma jedną definicję na wszystkich
  kontach; lokata nie jest wyjątkiem.
- **Inflacja świadomie pomijana** w większości wyliczeń — wartości realne traktujemy
  jak nominalne. Inflacja występuje w: koncie `gotowka` (ROI = -inflacja, engine.py),
  waloryzacji świadczenia ZUS i indeksacji kapitału (`_accumulate_zus`/`_convert_zus`,
  app/simulation/zus.py), helperach Fisher/deflate (core/inflation.py), nominalnej
  Belce od zysku oraz mechanice lokaty. Nie dodawać inflacji do wzrostu kont ani do
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
  PPE_ZUS_FRACTION, ENGINE_VERSION); `app/simulation/planner.py` — wizard (plan, build_stages,
  solvery); `app/stages/*.py` — implementacje etapów; `app/web/` — FastAPI
  (routes.py, auth.py, simulations.py, limits.py); `app/core/` — helpery (tax, pmt, roi,
  inflation); `static/js/` + `static/css/` + `app/templates/` — front (system wizualny: `DESIGN.md`).
- **Walidacja wejścia**: `app/simulation/schemas.py` ma twarde granice (wiek etapów
  0–120, `end_age > start_age`, max 20 etapów, limity kwot/ROI). Symulacja kończy się
  na ostatnim etapie (`end_age - 1`); `max_age` jest tylko pomocniczym horyzontem.
- **Limity API**: ciężkie endpointy (`/api/simulate`, `/api/wizard/*`, rejestracja)
  przechodzą przez `app/web/limits.py` (sliding window per IP). Nie dodawaj nowego
  kosztownego endpointu bez `check_limit`.
- **Baza**: migracje przez `PRAGMA user_version` w `app/storage/db.py`; zapis symulacji
  zawiera `model_version` (`ENGINE_VERSION`).
- Python: pełne adnotacje typów, pydantic BaseModel dla DTO, bez zbędnych komentarzy.
- JS: bez frameworków, funkcje nazwane, współdzielone helpery przez `window.*`
  (helpers.js: `$`, `show`, `escapeHtml`, `fmtMoney`, `fmtDateTime`, `api`; icons.js: `iconSvg`; controls.js:
  `numControlsHtml`, `initNumControls`; session.js: `refreshSessionBar`). helpers.js
  i icons.js ładowane z base.html przed `{% block scripts %}`, controls.js — w wizard.html
  i simulator.html.

## Konwencje UI — system wizualny opisuje `DESIGN.md`

- **Jedna rodzina komponentów** (`static/css/components.css`): `.card` / `.card-inset`,
  `.metric` + `.metric-grid`, `.banner` (`-info|-warn|-danger|-success`),
  `.segmented` + `.seg-option` (jeden z kilku; radio w środku), `.pill-toggle`
  (ikona + etykieta, `aria-pressed`), `.chip` (`-accum|-real|-warn|-primary`),
  `.num-control` (jedyna kontrolka liczbowa), `.action-bar`, `.toolbar`,
  `.table-wrap` + `table`, `.tip`/`.tooltip`, `.progress`, `.btn`
  (`-primary|-secondary|-ghost|-danger|-accum|-real`, `-sm`, `-icon`). Strona dodaje
  tylko układ w swoim arkuszu (`landing.css`, `library.css`, `sim.css`, `wizard.css`).
- **Warstwy CSS**: `tokens.css` (jedyne miejsce z kolorami i rozmiarami) → `base.css`
  (reset, typografia, topbar, dolny pasek zakładek) → `components.css` → arkusz
  strony. `qa/visual/tokens.spec.js` pilnuje: zero hex/rgba poza `tokens.css`, zero
  emoji w JS, font-size ≥ 12 px, kontrast tekstu ≥ 4,5:1 na `--surface-2`.
  Przezroczystości przez `color-mix()`.
- **Kolor znaczy jedno**: fiolet `--primary` = interakcja (akcja, zaznaczenie,
  fokus, aktywna zakładka); `--stage-accum` (pomarańcz) = akumulacja;
  `--stage-real` (turkus) = realizacja; `--success|--warning|--danger` = stan.
  Liczby domyślnie neutralne; kolor tylko gdy niesie znaczenie (`.metric.is-positive`
  dla ujemnego podatku, `td.best` w porównaniu).
- **Trzy tła**: strona `--bg`, karta `--surface`, wkład/kontrolka `--surface-2`.
  Cień tylko na `.action-bar` i `.tooltip`.
- **Ikony** wyłącznie z `static/js/icons.js` (`iconSvg(name)`, liniowe SVG 24×24,
  `currentColor`); `ACCOUNT_ICONS` w sim-metadata.js to SVG z tego zestawu.
  Emoji nie są ikonami. icons.js ładuje base.html zaraz po helpers.js (harness
  jsdom też go wczytuje).
- **Pasek akcji**: każdy widok z akcjami na dole używa `.action-bar`
  (lewo: drugorzędne, środek: status, prawo: akcja główna) i ustawia
  `body.has-action-bar` (block `body_class` w szablonie, albo JS jak w liście
  symulacji, gdzie pasek pojawia się dopiero po zaznaczeniu). Nigdy osobnych
  pływających pasków per strona.
- **Nawigacja**: topbar z czterema sekcjami + `#accountWidget`; między 641 a
  1024 px sekcje pokazują same ikony (pełna nazwa w `title` i `aria-label`);
  poniżej 640 px przenoszą się do `.tabbar` (base.html), w topbarze zostaje
  marka i konto. `data-section` w body steruje stanem aktywnym; przełączanie
  edytor/konfiguracja bez przeładowania przez `setNavSection` (simulator.js).
- **Konfiguracja edytuje w miejscu**: `configFieldShell` renderuje kontrolkę od
  razu (bez przycisku „Zmień”); kropka `.config-override-indicator` i aktywny
  `.config-restore-btn` oznaczają wartość inną niż w presecie
  (`qa/visual/config-interactions.spec.js`).
- Nowe pola liczbowe przez `numControlsHtml`/`initNumControls` (controls.js), nie
  surowe inputy. Pola kwotowe: `tabular-nums`, w asystencie `.wz-slider .num-control`
  ma stałe 150 px i stoi PRZED `input[type="range"]` (na mobile liczba nad suwakiem).
- Daty bez sekund (`fmtDateTime` w helpers.js); `fmtMoney` normalizuje `-0`.
- Aktywa wersjonowane przez `?v={{ version }}` (`_asset_version`, routes.py) —
  dodaj do każdego nowego pliku JS/CSS w template.
- Po zmianie wyglądu: `make visual-baseline` (serwer na :8000), a przed oddaniem
  `make visual` i `make harness-jsdom`.

### Asystent — zachowanie kroków (fakty produktowe, nie układ)

- Krok 2 „Twoje dane": 3 panele `.wz-panel` w kolejności „Ty" | „Praca i dochód" |
  „Odkładasz miesięcznie" (tytuły w `.wz-panel-title`). Pensja ma segment
  **Brutto / Netto** (`#wzSalaryMode`) **tylko dla etatu**; B2B zostaje przy brutto
  z podpowiedzią (netto zależy od formy opodatkowania), „Nie pracuję" chowa pole.
  Segment siedzi w `.wz-choice-row` obok segmentu formy zatrudnienia. Obok labela
  pensji `#wzSalaryHint` pokazuje kwotę odwrotną („≈ netto" / „≈ brutto") z
  `POST /api/wizard/salary` (`app/simulation/salary.py`: ZUS pracownika 13,71%,
  zdrowotna 9%, PIT wg skali + danina; z PPK doliczana składka pracownika, jeśli PPK
  włączone w kroku 3). Pensję można podać **miesięcznie lub rocznie**
  (`#wzSalaryPeriod`); tryb roczny jest tylko prezentacją — `collectAnswers()` dzieli
  kwotę przez 12 i backend zawsze dostaje `gross_monthly`, a label/suwak zmieniają
  zakres (100 000 zł/mies. lub 1 200 000 zł/rok). W trybie rocznym pod polem widać
  `#wzSalaryPeriodHint` („Rocznie = pensja + premie + nadgodziny…”). Podgląd netto
  jest debounce'owany (350 ms) i cache'owany po kwocie/trybie/PPK, żeby suwak nie
  dobijał limitu 60 zapytań/min; przy 429 zostaje ostatnia dobra kwota i jedno
  ponowienie po `Retry-After`, bez komunikatu o błędzie. `salaryPeriod`
  jest zapisywany w stanie kreatora i odtwarzany przez `restore`. Oszczędności są **tylko kwotowe**:
  `#wzSavings` domyślnie **1000 zł/mies.**, suwak `#wzSavingsAmtRange` 0–netto, bez
  trybu procentowego. `#wzSavingsHint` pokazuje „`kwota` = `%` pensji netto",
  `#wzSavingsWarn` ostrzega tylko przy kwocie > pensja netto (w trybie rocznym
  porównanie używa miesięcznego odpowiednika). `collectAnswers()` wysyła
  `salary_mode` i `savings`; backend normalizuje netto→brutto **raz** na wejściu
  `plan()`/`estimate_pool_monthly()`.
- Krok 3 „Kapitał": **wszystkie 14 kont** (w tym `zus:ofe`) jako `.pill-toggle.wz-pill`
  w `#wzCapitalPicker`; wybrane konto dodaje `.wz-capital-item` do `#wzCapitalGrid`
  (ponowne kliknięcie / `.wz-pill-remove` je zabiera). Do odpowiedzi trafiają tylko
  kwoty > 0.
- Krok 4 (tytuł wg ścieżki: „Kiedy chcesz przejść na FIRE?” / „Twój cel wypłaty i
  wiek FIRE” / „Wymarzona wypłata i horyzont”): 4 wiersze `.wz-slider` w `.wz-rows`,
  bez hint-podpowiedzi (kontekst w `title` labela). Cel wypłaty tylko dla ścieżek 2/3,
  wiek FIRE tylko dla 1/2. Domyślne wartości **wg płci i wieku**, przeliczane dopóki
  pola nie były edytowane (`wzRetirementTouched`/`wzPlanEndTouched`): wiek emerytury
  ZUS = `RETIREMENT_DEFAULT` (60 k / 65 m); horyzont = wiek + `LIFE_EXPECTANCY`
  (GUS 2024, dane UI w wizard.js).
- Krok 5 „Strategia i założenia": 5 paneli `.wz-alloc-panel` — „Założenia rynkowe
  (koniunktura)", „Strategia podziału oszczędności", „Podział", „Dodaj instrument",
  „Wpłaty z pensji". **Założenia i strategia to dwa niezależne wybory** (`.segmented`
  z 3 i 4 `.seg-option`; na ≤640 px `.segmented-stack` układa je pionowo).
  Założenia sterują ROI, inflacją i waloryzacją ZUS (`planner.py`); strategia tylko
  rozdziela oszczędności. Wybór strategii jest **wymagany** (na starcie żaden tryb).
  Strategie automatyczne: `wzAllocMode = "auto"`, `/api/wizard/suggest` (w ścieżce 2
  z celem i `pool_monthly`), sekcja „Podział" **read-only** (`.wz-alloc-readonly`).
  „Manualna": `"manual"`, pełny układ (pola `zł/rok` + suwaki, wiersz Gotówki,
  „Dodaj instrument", „Wpłaty z pensji"). **Wiersz podziału jest kwotowy (rocznie)**:
  etykieta | pole `zł/rok` | suwak | `≈zł/mies.` | `≈%` (procenty tylko
  prezentacyjne; backend dostaje `allocations` jako udziały). Konta z limitem:
  nota `limit roczny: X zł` / `limit roczny osiągnięty`, maksimum pola i suwaka =
  `min(pozostała pula, limit)`. Ścieżki 1/3: kanoniczne kwoty (`wzAmounts`),
  wzrost puli → różnica do Gotówki, spadek → proporcjonalne przycięcie
  (`wzReconcileAmounts`). Ścieżka 2: kanoniczne wagi (`wzWeights`), kwoty pochodne
  (`wzSyncAmountsFromWeights`). Nota o nadwyżce tylko gdy ≥ 1 zł/mies.
  Bez strategii „Wylicz plan" jest wyłączony; wyjaśnienie w `title` wrappera
  `.wz-next-tip` i w dymku `.wz-next-pop` po kliknięciu (`ALLOC_GATE_MSG`,
  auto-ukrycie ~4 s); `validateStep(5)` to siatka bezpieczeństwa.
  Usunięcie instrumentu czyści kwotę i wagę (`deactivateAllocAccount`/`togglePill`),
  `collectAllocations` pomija nieaktywne konta.
- Krok 6 „Twój plan FIRE": loader `#wzPlanLoader`, potem `#wzHeroAnswer`,
  3 karty `#wzScenariosBox`, metryki `#wzMetrics` (`.metric-grid`), `#wzSolved`
  (baner info), `#wzWarnings` (baner warn z listą), oś czasu `#wzTimeline`,
  tabela faz `#wzPhaseTable` (na mobile ukryta, bo karty osi czasu niosą te same
  dane), `#wzStageSummaryList` w `<details>` i nota o kwotach netto. **Nie ma
  `#wzStagePreview`.** Klik karty scenariusza ustawia `wzSelectedScenario` i
  przerenderowuje cały wynik (`renderScenarioResult`). Wybór scenariusza zapisywany
  w `localStorage`, odtwarzany przez `/wizard?restore=1`. Wejście z kroku 5 od razu
  uruchamia `runPlan()`.

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