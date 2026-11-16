# AGENTS.md — FIRE Simulator

Polski symulator niezależności finansowej. FastAPI + Jinja2 + vanilla JS (bez npm,
bez TypeScript), pytest. Odpowiadaj i pisz UI po polsku.

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
- **Indeksacja progów PIT**: `TaxConfig.prog_indexation` (`None` = progi stałe
  realnie; `0.0` = zamrożone nominalnie; wartość pośrednia = wolniejsza niż
  inflacja). Domyślnie **1,5%**; bessa obniża o 0,5 p.p., hossa ustawia pełną
  indeksację (`None`). `threshold_factor(years)` przelicza kwotę wolną, progi,
  KUP i próg daniny; silnik przekazuje lata od startu do `scale_kwargs(years)`.
- **Długowieczność** modelujemy liniowo: `longevity.growth_months_per_year`
  (domyślnie 1,5 mies./rok) wydłuża tabelę ŚDTŻ dla roku emerytury oraz domyślny
  horyzont Asystenta (przybliżenie kohortowe: `lata × (1 + growth/12)`).
  `growth=0` odtwarza tabelę GUS 2026 bez projekcji.
- **Dwa tryby realizacji** (app/stages/realizacja.py):
  - PMT (annuitizacja do zera) — edytor `/sim` bez targetu i legacy;
  - stały cel netto — TYLKO wizard (edytor nigdy). Wypłata = `cel − bieżąca renta ZUS`,
    rozdzielana proporcjonalnie do sald; niewypłacone rośnie `(1+roi)`.
- **„Brydż do emerytury" = etap `realizacja`** (nie akumulacja) od wieku FIRE do końca
  planu; „Realizacja (emerytura)" = osobny etap `realizacja` zawierający tylko `zus`.
- **IKZE**: ulga liczona od dochodu obniża podatek w roku wpłaty. Zwrot trafia
  na konto wybrane w `ikze_refund_target` (w edytorze wybór jest **obowiązkowy**:
  konto albo `none`; wybrane konto jest automatycznie dodawane do etapu z notą
  o wpłatach ze zwrotu). `auto` = IKE → OIPE → broker → OKI → obligacje → lokata
  → OKI oszczędnościowe → gotówka, używane przez Asystenta i stare zapisy.
  Automat **nie wybiera krypto**; krypto można wskazać tylko jawnie. IKE/OIPE przyjmują
  zwrot tylko do wysokości rocznego limitu wpłat, reszta leci dalej. Zwrot jest
  dopisywany **na koniec roku** (po wzroście), bo realnie przychodzi po PIT. Brak
  celu w `auto` = ostrzeżenie w wyniku. `SimulationResult` niesie
  `total_tax_refund`, `ikze_refund_allocations`, `exit_tax` i `final_wealth_net`
  (podatek wyjścia: IKZE 10% od całości po 65 r.ż. lub skala przed, IKE 0%,
  broker 19% od zysku) — dzięki temu IKE i IKZE nie wyglądają identycznie przy
  tej samej stopie zwrotu.
- **Wcześniejszy zwrot IKZE**: przed 65 podatek liczony od całości salda (skala),
  ale netto **nie zostaje w IKZE** — jest reinwestowane w konto docelowe.
  Automatyczna kolejność (`_EARLY_RETURN_REINVEST_ORDER`) to IKE/OIPE **tylko
  jeśli są w etapie** do limitu, potem obligacje → lokata → OKI oszczędnościowe
  → broker → gotówka. **Nigdy nie wybiera krypto** — to była pułapka, w której
  duży zwrot lądował w jedynym wolnym koncie. `SimulationResult` niesie
  `early_return_total`, `early_return_tax_total`, `early_return_age` i
  `early_return_allocations`; wynik pokazuje banner i pionową linię na wykresach,
  a w przepływach chip „Wcześniejszy zwrot IKZE”, nie wiersz IKZE 0 zł. Konto
  docelowe jest dodawane do etapu w locie.
- **Polityka wypłat Asystenta**: `withdrawal_policy` = `defer_tier` (IKE/konta
  dostępne najpierw, IKZE później), `early_tier` (wymuszone opodatkowanie całości
  IKZE na starcie realizacji przed 65; netto jest reinwestowane w konto docelowe),
  `defer_roi`/`early_roi` (w ramach progu podatkowego najpierw konta o niższym ROI)
  oraz `defer_tax`/`early_tax` (w ramach progu najpierw konta najtańsze podatkowo:
  OKI, IKE po 60, potem broker/obligacje itd.). Asystent `auto` uruchamia sześć
  wariantów i wybiera najwyższą wartość netto (`total_withdrawn + final_wealth_net`);
  wybrany wariant trafia do `input.withdrawal_policy` i do `/sim` przez draft.
- **Sugestia a istniejące OKI**: `suggest_allocation_plan` respektuje saldo
  `capital.oki_inw`/`capital.oki_osk`; nowe wpłaty do OKI proponuje tylko w ramach
  pozostałego limitu (100 tys. zł łącznie, 25 tys. zł oszczędności). Po jego
  wykorzystaniu nadwyżka rynkowa idzie do brokera, a bezpieczna do obligacji/lokat.
- **ZUS obsługuje engine**, nie etap (waloryzacja zamiast ROI, konwersja kapitału na
  rentę zamiast PMT; renta waloryzowana corocznie). Rok emerytury = `start_year` +
  (wiek − wiek startowy); tabela ŚDTŻ jest wtedy przesuwana o wzrost długowieczności.
  Nie powielać `zus` w wielu etapach
  (`_process_stages`, engine.py — guard `zus_handled`). Emerytura netto = brutto − PIT
  (skala) − 9% składki zdrowotnej (`YearResult.health`, `health_paid`); portfel w
  etapie „Dopłata” uzupełnia tylko różnicę do celu netto (`_zus_net_annual`).
  Waloryzacje: świadczenie **0/1/2%**, składki **1/2/2,5%** (bessa/default/hossa).
  Historycznie świadczenie rosło realnie ~+1,1 pp/rok, składki ~+2–4 pp/rok
  (baza płacowa), więc 0% to podłoga, nie baza.
- Klucze kont są stałe (`broker, gotowka, ike, ikze, krypto, lokata, obligacje, oipe,
  oki_inw, oki_osk, ppe, ppk, zus`) — patrz `ACCOUNT_LABELS` w config.py.
- **Profile ryzyka**: `TaxConfig.risk_profiles` (`spokojny`, `zrownowazony`,
  `dynamiczny`) definiują `max_crypto`, `max_market`, `max_single_taxable`,
  `min_safe` dla **nowych wpłat**. `max_market` i `max_crypto` dotyczą całej puli
  (także rynkowych wariantów IKE/IKZE/OIPE), a `max_single_taxable` tylko kont
  taxable. `min_safe` liczy bezpieczne aktywa w całej puli. Limity są edytowalne
  globalnie w Konfiguracji. Stare configi z `max_taxable_market` są mapowane na
  `max_market` w walidatorze.
- **Rodzaje inwestycji w wrapperach**: `TaxConfig.wrapper_vehicles` definiuje
  `broker` (Maklerskie), `fund` (Funduszowe) i `savings` (Oszczędnościowe) z
  domyślnym realnym ROI i klasą ryzyka. `wrapper_vehicle_options` określa, które
  rodzaje są dostępne dla IKE/IKZE/OIPE. Domyślnie OIPE ma tylko `fund` (Finax,
  portfele ETF, opłata ok. 0,9%/rok), ale można to zmienić w Konfiguracji.
  `WizardAnswers.wrapper_vehicles` niesie wybór per wrapper; `_roi` preferuje
  jawne `roi_overrides`, potem rodzaj inwestycji, potem domyślne ROI konta.
- **Podział nowych wpłat**: seed liczy cel `safe/market/high` z profilu, najpierw
  wypełnia bezpieczne do IKZE (ulga), potem decyduje o roli IKE. IKE dostaje
  bezpieczne, gdy reszta safe jest duża; przy resztce < 5% puli i większym rynku
  IKE idzie na maklerskie. **Dopiero potem** wypełniamy OIPE — nigdy przed IKE,
  gdy IKE jest wolne. OIPE jest dziś funduszowe i obsługuje rynek przed taxable.
  Limity wrapperów są wspólne dla wpłat; nie tworzymy osobnych podkont dla
  rodzajów inwestycji.
- Wizard: path 1 = maks. stała wypłata netto (bisekcja + gross-up), path 2 = ile
  odkładać (procent liczymy od pensji **netto**), path 3 = kiedy FIRE. Gwarancja =
  żaden rok nie spada poniżej targetu. Path 2: górna granica bisekcji nie jest
  dowodem niewykonalności, bo podatek od aktywów OKI rośnie z saldem — przy bardzo
  wysokich oszczędnościach wypłata netto może spaść poniżej targetu; solver schodzi
  wtedy do osiągalnego pułapu i bisekcjonuje od zera (`_solve_savings`).
- **Bequest**: `WizardAnswers.bequest_target` (netto, domyślnie 0) jest dolnym
  ograniczeniem `final_wealth_net` na końcu horyzontu. Solver path 1 najpierw
  wyznacza pułap bez spadku, potem bisekcjonuje wypłatę przy warunku spadku;
  `PlanProjection` niesie `bequest_target` i `bequest_met`. 0.01 zł zamiast 0
  utrzymuje tryb stałego celu (0 przełącza Realizację w PMT).
- **Optymalizator Asystenta** (`app/simulation/optimizer.py`): optymalizuje
  **wszystkie nowe wpłaty** (nie istniejący portfel) w trzech klasach ryzyka:
  safe / market / high. Wrappery IKE/IKZE/OIPE są kontami z capem rocznym, a ich
  klasa wynika z `wrapper_vehicles` (Maklerskie/Funduszowe → market,
  Oszczędnościowe → safe). Seed pochodzi z `suggest_allocation_plan`
  (capacity-aware), potem coordinate descent po udziałach klas i search wieku
  ZUS. Każdy kandydat jest liczony pełnym symulatorem (`_solve_payout` +
  bequest); wynik to best found, nie dowód globalnego optimum.
  `PlanOptimizerResult` niesie `risk_profile`, `asset_mix`, `binding_limits`,
  `baseline`, `recommended`, `best_total` i `break_even_age`; kandydat niesie
  `vehicles` i `asset_mix`.
  `plan_optimized()` uruchamia optymalizator i liczy główny plan z rekomendacją;
  wynik niesie `optimization` (dict). Asystent używa `POST /api/wizard/plan`
  z `optimize: true` tylko na ścieżce 1; `POST /api/wizard/optimize` zostaje
  dla wywołań zaawansowanych. Testy: `tests/test_optimizer.py`; limit
  `wizard_optimize`.

## Architektura i konwencje kodu

- `app/simulation/engine.py` — silnik + schematy; `app/simulation/zus.py` — klaster
  ZUS (waloryzacja, konwersja kapitału na rentę, wiek emerytalny);
  `app/simulation/constants.py` — stałe liczbowe (DEFAULT_ROI, MONTHS_PER_YEAR,
  PPE_ZUS_FRACTION, ENGINE_VERSION); `app/simulation/planner.py` — wizard (plan, build_stages,
  solvery); `app/simulation/optimizer.py` — pełna alokacja nowych wpłat (risk buckets) + wiek ZUS;
  `app/stages/*.py` — implementacje etapów; `app/web/` — FastAPI
  (routes.py, limits.py); `app/core/` — helpery (tax, pmt, roi, inflation);
  `static/js/` + `static/css/` + `app/templates/` — front (system wizualny: `DESIGN.md`).
- **Walidacja wejścia**: `app/simulation/schemas.py` ma twarde granice (wiek etapów
  0–120, `end_age > start_age`, max 20 etapów, limity kwot/ROI). `max_age` jest
  górnym limitem symulacji (włącznie): planner ustawia `plan_end - 1`, ale etapy
  mogą wystawać dalej (ZUS do 100 r.ż.) i służą wtedy tylko do projekcji. Symulacja
  nigdy nie wychodzi poza ostatni etap (`end_age - 1`) ani poza `max_age`.
- **Limity API**: ciężkie endpointy (`/api/simulate`, `/api/wizard/*`)
  przechodzą przez `app/web/limits.py` (sliding window per IP). Nie dodawaj nowego
  kosztownego endpointu bez `check_limit`.
- **Bezstanowość**: brak bazy, logowania i sesji. Konfiguracja i presety żyją
  w `localStorage` (`fire.config`, `fire.presets`), a plany są wymieniane jako
  `.sim.json` / `.config.json`. `FIRE_DB` i `FIRE_SECRET_KEY` nie istnieją.
- **Porównywarka**: `/compare` wczytuje 1–4 pliki `.sim.json` i liczy je przez
  stateless `/api/compare/evaluate`; `/moje-symulacje` i `/login` przekierowują
  na `/compare`. Asystent na ekranie wyniku eksportuje aktywny scenariusz jako
  `.sim.json`; symulator robi to samo, a konfiguracja eksportuje `.config.json`.
- **Pliki**: przyciski mówią „Wczytaj JSON” / „Eksportuj JSON”, a tooltip
  wskazuje format. Filtry `accept` są ostre: `.sim.json` dla planów,
  `.config.json` dla konfiguracji. Import wymaga schema
  `fire-simulation/v1` / `fire-config/v1`; stare gołe JSON-y są odrzucane.
- Python: pełne adnotacje typów, pydantic BaseModel dla DTO, bez zbędnych komentarzy.
- JS: bez frameworków, funkcje nazwane, współdzielone helpery przez `window.*`
  (helpers.js: `$`, `show`, `escapeHtml`, `fmtMoney`, `fmtDateTime`, `api`; icons.js: `iconSvg`; controls.js:
  `numControlsHtml`, `initNumControls`). helpers.js, icons.js i sim-utils.js są
  ładowane z base.html przed `{% block scripts %}`, controls.js — w wizard.html
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
- **Widoczny tekst jest krótki**: etykiety, krótkie instrukcje, statusy i
  ostrzeżenia. Mechanika, przykłady, listy składników, uzasadnienia i wyliczenia
  idą do `.tip` przy nagłówku panelu. Nie powtarzaj listy opcji w nagłówku
  sekcji, jeśli kontrolki są pod spodem. Dotyczy całego projektu, nie tylko
  Asystenta.
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
- **Nawigacja**: topbar z czterema sekcjami (Porównywarka, Asystent, Symulator,
  Konfiguracja); między 641 a 1024 px sekcje pokazują same ikony (pełna nazwa
  w `title` i `aria-label`); poniżej 640 px przenoszą się do `.tabbar`
  (base.html). `data-section` w body steruje stanem aktywnym; przełączanie
  edytor/konfiguracja bez przeładowania przez `setNavSection` (simulator.js).
- **Konfiguracja edytuje w miejscu**: `configFieldShell` renderuje kontrolkę od
  razu (bez przycisku „Zmień”); kropka `.config-override-indicator` i aktywny
  `.config-restore-btn` oznaczają wartość inną niż w presecie
  (`qa/visual/config-interactions.spec.js`). Wszystkie sekcje i karty kont są
  `<details>` domyślnie zwinięte; badge `.config-section-modified` pokazuje
  liczbę zmienionych pól, a `#configExpandBtn` rozwija/zwija sekcje. Pierwsza
  ręczna zmiana ustawia `CONFIG_IS_CUSTOM` i pokazuje w `#presetSelect`
  „Własna konfiguracja”; `CONFIG_BASELINE_NAME` nadal wskazuje preset bazowy
  do przywracania.
- **Asystent a konfiguracja**: endpointy `/api/wizard/plan`,
  `/api/wizard/suggest` i `/api/wizard/salary` używają configu przekazanego przez
  klienta jako `WizardAnswers.base_config` / `SalaryPreviewRequest.base_config`.
  `realne` używa go w całości, a `konserwatywne`/`optymistyczne` nakładają tylko
  inflację, `default_roi` kont i waloryzację ZUS; podatki, limity i zasady kont
  zostają z configu. Globalny config = Realne: akcje **3,5%**, fundusze/PPK/PPE/
  OKI inw. **+3%**, krypto **0%**, obligacje **+1,5%**, lokaty/OKI oszcz./
  nieruchomość **+1%**, ZUS/OFE **+3%**. Bessa i hossa to **delty** w
  `TaxConfig.scenarios`, nie osobne presety: bessa daje akcje **0%**, krypto
  **−8%**, obligacje **+0,5%**, lokaty **0%**, ZUS **+1%**; hossa akcje **6,5%**,
  krypto **+8%**, obligacje **+2,5%**, lokaty **+2,2%**, ZUS **+5%**. Nie
  schodzimy z akcjami poniżej zera — stały ujemny zwrot przez cały horyzont to
  już „stracone półwiecze”, a nie bessa. Wbudowane presety to wyłącznie
  `Domyślny 2026` i `Domyślny 2027` (progi 130/150 tys., limity 2027).
- **Konfiguracja lokalna**: `fire.config` przechowuje aktywny config i baseline,
  a `fire.presets` — własne presety. Jeśli kluczy nie ma, wczytujemy defaulty
  z `/api/config`, a pełne configi presetów z `/api/presets`. Lista pokazuje
  dwie wbudowane bazy (2026/2027) oraz własne presety. Zapis jest
  natychmiastowy (bez serwera); `fire.config.anonymous` jest tylko legacy fallbackiem.
- Nowe pola liczbowe przez `numControlsHtml`/`initNumControls` (controls.js), nie
  surowe inputy. Pola kwotowe używają `tabular-nums`. W suwakach pole liczbowe musi
  mieścić najdłuższą dopuszczalną kwotę razem z przyciskami krokowymi — nie ustalaj
  jego szerokości na 150 px bez sprawdzenia wartości granicznej. Na mobile liczba
  zajmuje pełną szerokość nad suwakiem.
- Daty bez sekund (`fmtDateTime` w helpers.js); `fmtMoney` normalizuje `-0`.
- Aktywa wersjonowane przez `?v={{ version }}` (`_asset_version`, routes.py) —
  dodaj do każdego nowego pliku JS/CSS w template.
- Po zmianie wyglądu: `make visual-baseline` (serwer na :8000), a przed oddaniem
  `make visual` i `make harness-jsdom`.

### Asystent v1 — zachowanie kroków (fakty produktowe, nie układ)

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
  w `#wzCapitalPicker`, ale **siatka `#wzCapitalGrid` jest nad pickerem** (picker
  „Dodaj kolejne konto” pod spodem), żeby po wpisaniu kwoty kolejne konto było
  tuż nad panelem dodawania. Wybrane konto dodaje `.wz-capital-item` do siatki
  (ponowne kliknięcie / `.wz-pill-remove` je zabiera). Do odpowiedzi trafiają tylko
  kwoty > 0. Pola liczbowe (wszędzie) zaznaczają całą wartość przy focusie
  (`controls.js`), więc wpisanie `1000` nadpisuje domyślne `0`. Dla IKE/IKZE/OIPE
  ROI zależy od rodzaju inwestycji wybranego w kroku planowania; ręczna zmiana
  ROI w wierszu kapitału nadpisuje rodzaj i jest wysyłana jako `roi_overrides`.
- Krok 4 (tytuł wg ścieżki: „Kiedy chcesz przejść na FIRE?” / „Twój cel wypłaty i
  wiek FIRE” / „Wymarzona wypłata i horyzont”): 5 wierszy `.wz-slider` w `.wz-rows`,
  bez hint-podpowiedzi (kontekst w `title` labela). Cel wypłaty tylko dla ścieżek 2/3,
  wiek FIRE tylko dla 1/2. Domyślne wartości **wg płci i wieku**, przeliczane dopóki
  pola nie były edytowane (`wzRetirementTouched`/`wzPlanEndTouched`): wiek emerytury
  ZUS = `RETIREMENT_DEFAULT` (60 k / 65 m); horyzont = wiek + `LIFE_EXPECTANCY`
  (GUS 2024, dane UI w wizard.js) powiększona o
  `longevity.growth_months_per_year` (przybliżenie kohortowe, patrz wyżej).
  Piąty suwak to `wzBequest` — minimalny majątek netto na koniec horyzontu
  (0 = wydać wszystko); trafia do `answers.bequest_target`.
- Krok „FIRE”: typ FIRE, pola zależne (Coast/Barista), wiek pełnego FIRE,
  horyzont i bufor/spadek; dla ścieżek 2/3 także cel wypłaty. Bez profilu
  ryzyka, trybu i wieku ZUS — te decyzje są w następnym kroku.
- Krok „Jak zaplanować wpłaty?” (`data-step-id="strategia"`, wspólny dla
  ścieżek 1–3): dwa duże kafle `wzOptimizeMode` — „Asystent dobierze” / „Sam
  ustawię podział”. Auto pokazuje `wzRiskProfile` (limity nowych wpłat) i
  `wzPriority` (`payout`/`total`) jako duże kafle z opisami; manual pokazuje
  wiek ZUS, edytor podziału i kafle-akcje „Zacznij od propozycji”
  (`data-profile-seed`; profil tylko wypełnia seed, nie jest constraintem).
  Manual startuje od 0 % na kontach i 100 % w gotówce. Suwak konta ma maksimum
  `min(limit konta, obecny udział + wolna gotówka)` — zwiększanie jednego
  konta nie zabiera środków innemu. „Wylicz plan” jest zablokowane przy sumie
  udziałów 0, bo cała pula trafiłaby do gotówki. Ścieżki 2/3 nie mają auto —
  zawsze manual. `wzCollectAnswers` wysyła `risk_profile`,
  `optimization_objective` oraz `wrapper_vehicles` w trybie manual;
  `wzPlanBody` — `optimize` tylko dla auto path 1. W manualu każdy wrapper ma
  select rodzaju inwestycji (OIPE domyślnie tylko Funduszowe), a zmiana typu
  aktualizuje ROI i mix. Stare karty strategii usunięto; `strategy` pozostaje
  tylko jako zgodność wstecz.
- **Kafle czy segmented:** duże `.wz-path` z tytułem i opisem stosujemy, gdy
  wybór wymaga wyjaśnienia (profil ryzyka, priorytet, typ FIRE, sposób
  planowania); mały `.segmented` — gdy wybór jest oczywisty (płeć,
  brutto/netto). Zasada i wspólny słowniczek pojęć: `DESIGN.md` §1 pkt 12–13
  i §5.
- Krok „Wynik” („Twój plan FIRE”): loader `#wzPlanLoader` jest indeterministyczny
  (losowe teksty o cierpliwości, wpłatach i ryzyku, zmieniane co 6 s, bez cyklu 1/3–3/3).
  Tip loadera jest kartą `#wzLoaderTip` z gradientem, ikoną i etykietą
  „Warto wiedzieć”; przed nowym planem `resetPlanResult()` czyści stary wynik
  i `wzPlan`. Hierarchia wyniku:
  1. `#wzHeroAnswer` — odpowiedź na pytanie użytkownika + krótki kontekst,
  2. `#wzScenariosBox` + `#wzWarnings` — 3 klikalne karty, a bezpośrednio
     pod nimi ostrzeżenia zależne od scenariusza (bez dodatkowego nagłówka),
  3. `#wzMetrics` — 3 metryki zależne od ścieżki,
  4. **`#wzTimeline` + `#wzFlowsWrap`/`#wzFlowsGantt`** — etapy życia i konta
     w jednym bloku „Twój plan w czasie”, zawsze widoczne; nagłówek
     „Etapy życia” jest tylko dla czytników ekranu, a sekcja wypłat nosi tytuł
     „Z czego żyjesz w kolejnych latach”. Pod Ganttem jest zwijana
     `#wzFlowsTableDetails` z tabelą przepływów (domyślnie zamknięta),
  5. `#wzDetails` — zwijane „Dane szczegółowe”: majątek, ulgi/podatki
     i „Jak czytać ten plan?”,
  6. `#wzOptimizer` — zwijane „Jak dobraliśmy plan?” na samym dole, z
     rekomendacją, profilem, limitami i tabelą wariantów. Widoczne tylko w auto
     na ścieżce 1 i dla scenariusza Realne; domyślnie zamknięte, bez „Zastosuj”,
     bo główny plan jest już rekomendacją. W manualu ukryte.
  **Nie ma `#wzPhaseTable` ani `#wzStageSummaryList`** — ich rolę przejmuje
  oś czasu i panel szczegółów etapu. Gantt jest widokiem głównym, nie schowanym
  w `<details>`. Klik segmentu osi czasu lub paska konta otwiera wspólny panel
  `#wzGanttTip`; pokazuje okres, wypłatę netto, portfel/ZUS, PIT, składkę
  zdrowotną i podatek jednorazowy IKZE w osobnych wierszach. Na mobile Gantt
  przewija się w poziomie, a hint jest widoczny tylko tam. Tabela przepływów
  jest pod Ganttem w zwijanym `<details>` i ma trzy sekcje: **Akumulacja**
  (wpłata/mies., wpłaty łącznie, wzrost, saldo), **Transfery kapitału**
  (wiek, z/na konto, kwota netto) i **Wypłaty** (kolumna „Faza” z literami
  A/B/C zgodnymi z paskami Gantta). Chipy `Ulga IKZE` / `Wcześniejszy zwrot
  IKZE` są w „Danych szczegółowych”.
  Stary blok „Jak liczymy ten plan?” zastępuje „Jak czytać ten plan?” —
  wyjaśnia znaczenie kwot na ekranie, a nie założenia modelu.
  Po gotowym planie przycisk kroku 6 zmienia się na `btn-real`
  „Dostosuj w symulatorze”; `finishWizard` zapisuje draft i przechodzi do
  `/sim?wizard=1`. Na ekranie wyniku w lewej części belki jest też
  „Eksportuj JSON” (na mobile sama ikona; licznik kroku jest wtedy ukryty,
  żeby przyciski się nie nachodziły). Symulator **automatycznie uruchamia**
  `/api/simulate` i pokazuje wynik (bez drugiego kliknięcia „Symuluj”).
  W widoku wyników pasek
  akcji ma eksport po lewej, a `#backToWizardBtn` (`/wizard?restore=1`)
  i „Edytuj etapy” po prawej; w trybie edycji powrót jest w banerze, bo pasek
  jest zbyt wąski na dodatkowy przycisk. Gotowy plan jest cache'owany w
  `fire.wizardPlan`; `restore=1` wraca na krok 6 bez ponownego `/api/wizard/plan`,
  jeśli answers i ścieżka się zgadzają.
  Przepływy per konto
  (`YearResult.withdrawals/taxes/health/ending_balances`) planner grupuje w
  `AccountPhase` (`PlanProjection.account_phases`), a etapy wpłat w
  `AccumulationPhase` (`PlanProjection.accumulation_phases`). Transfery
  między kontami (np. wcześniejszy zwrot IKZE → IKE/Obligacje) są w
  `CapitalTransfer` (`PlanProjection.capital_transfers`). `AccountPhase` grupuje
  kolejne lata z wypłatami,
  podział przy progu wieku konta i istotnej zmianie kwoty (>20% i >100 zł/mies.),
  ZUS jako „emerytura” (kapitał ZUS na starcie, bez salda końcowego), jednorazowy
  podatek IKZE osobno. `AccountPhase.accumulation_*` niesie start/koniec wpłat,
  roczną składkę, sumę wpłat i wzrost — koniec liczony z `ending_balances` roku
  `end_age - 1`, żeby nie łapać podatku/przepadku z pierwszego roku realizacji.
  Kolumna „Podatki i składki” pokazuje PIT + 9% zdrowotnej
  ZUS; rozbicie (PIT/zdrowotna/jednorazowo) siedzi w klasycznym tooltipie „?”
  obok kwoty (`.wz-flow-tax-cell .tip`), a główna kwota pozostaje widoczna. „Razem netto” jest już po obu obciążeniach.
  Tooltip Gantta na hover pojawia się po ~0,9 s (`GANTT_TIP_HOVER_DELAY`),
  żeby nie wyskakiwał podczas przejeżdżania myszą; klik/tap pokazuje od razu.
  Gantt pokazuje cienkie pomarańczowe paski akumulacji dla wszystkich kont
  (także tych, które później znikają, np. IKZE), wiersz **„Transfery”** ze
  znacznikiem źródła i wieku (np. „IKZE →” w 55 r.ż.) oraz wiersz „Razem”
  z sumą wypłat po okresach. Pod nim jest tylko
  „Łączna suma wypłat z portfela prywatnego FIRE: … zł netto”. Sumy ZUS nie
  pokazujemy — zależy od długości życia i nie jest obietnicą planu. Na mobile
  jest przewijany w poziomie ze
  sticky etykietami kont. Pod Ganttem są dwa wykresy: „Wypłaty netto w czasie”
  (stack miesięcznych wypłat netto per konto, z ZUS; roczna tylko w tooltipie)
  i „Kapitał prywatny FIRE” (stack sald na koniec roku, bez ZUS/OFE). Wykresy
  są dorysowywane do 100 r.ż. (ZUS + pasywny wzrost portfela), nawet gdy horyzont
  planu jest krótszy; metryki, final wealth i podatek wyjścia nadal liczą się
  do horyzontu. `plan(..., extend_chart=False)` wyłącza dogrywkę w testach.
  Pod drugim wykresem, nad opisem, jest jedna wspólna, zawsze widoczna legenda
  adnotacji z etykietą „Kamienie milowe:” (FIRE, zwrot IKZE, ZUS, horyzont),
  domyślnie wyszarzona. Kliknięcie pastylki pokazuje jedną pionową linię na
  obu wykresach i krótki opis pod legendą; kliknięcie innej przełącza
  adnotację, a kliknięcie aktywnej ją wyłącza. Nie ma ikony-toggle ani
  osobnych legend/opisów per wykres. Długi opis wcześniejszego zwrotu IKZE
  nie jest wyświetlany na głównej stronie.
  Serie liczy planner w `PlanProjection.chart` (`ages`, `withdrawals_net`, `balances`);
  kolory kont to stałe tokeny `--acct-*`, a szczegóły pokazuje wspólny tooltip
  `#wzChartTip` z kartą totalu (`.metric`), udziałami i rozbiciem kont
  wielokrotnych. Klik karty
  scenariusza ustawia `wzSelectedScenario` i przerenderowuje cały wynik
  (`renderScenarioResult`). Wybór scenariusza zapisywany
  w `localStorage`, odtwarzany przez `/wizard?restore=1`. Wejście z kroku 5 od razu
  uruchamia `runPlan()`.

### Asystent — zachowanie kroków i spójność UI

- Jest jeden Asystent pod `/wizard`; `/wizard-v1` i `/wizard-v2` przekierowują
  na `/wizard`. Link powrotu z symulatora zawsze prowadzi do `/wizard?restore=1`.
- Asystent zapisuje pełny stan formularza (`fire.wizardState`) i cache planu
  (`fire.wizardPlan`) razem z body odpowiedzi; stare klucze `fire.wizardV2*`
  są odczytywane jako fallback migracyjny. `?restore=1` odtwarza pola,
  dynamiczne wiersze kapitału, sugestię podziału i krok; plan pokazujemy tylko
  wtedy, gdy jego body nadal odpowiada bieżącym odpowiedziom. Samo `?restore=1`
  bez stanu może odtworzyć starszy cache planu (fallback kompatybilności).
- Asystent ma drzewo kroków zależne od zatrudnienia (etat / B2B / brak pracy); liczba
  kroków i `aria-valuemax` muszą wynikać z aktualnej ścieżki, nie być stałą.
  Domyślny wiek w formularzu to 40 lat; wiek emerytury ZUS dostosowuje się do
  płci, a domyślny horyzont to tablica GUS 2024 + `longevity.growth_months_per_year`
  z konfiguracji. Ręczna zmiana horyzontu (`wzPlanEndTouched`) wyłącza
  przeliczanie domyślnej wartości.
- Wynagrodzenie etatu domyślnie podajemy jako brutto rocznie. Wartość startowa
  wynika z limitów: `limits.oipe_annual / 3 * 12` (2026 → 113 000 zł/rok), bez
  osobnego pola w konfiguracji. Przełączniki Brutto/Netto i Rocznie/Miesięcznie
  przeliczają kwotę; `wzSalaryTouched` blokuje nadpisanie ręcznej wartości.
  Pod polem jest karta brutto ↔ netto. Wyróżniona (bold + akcent) jest kwota
  w przeciwnym okresie: przy „Rocznie” — miesięczna, przy „Miesięcznie” —
  roczna. Wpisana kwota zostaje normalną wagą i kolorem `--text-2`.
- PPK i PPE są niezależne: w kroku etatu zaznaczamy tylko bieżące wpłaty, a salda
  (także z byłej pracy) wpisujemy w kroku kapitału. `ppk_contributions` /
  `ppe_contributions` decydują o nowych składkach; konto z samym saldem rośnie
  tylko z ROI. OFE ma osobne, niezależne od kapitału ZUS segmented
  `wzHasOfe` (Nie / Tak) i pole salda.
- Każdy krok używa wspólnych komponentów z `components.css`. Na desktopie
  opisy kroków mają wykorzystywać dostępną szerokość; na mobile teksty segmentów,
  przyciski i suwaki nie mogą powodować poziomego przewijania całej strony.
  Porównywalne pola w `.wz-grid` mają równe kolumny; tylko układy „wybór po lewej,
  kontrolka po prawej” używają wariantu `.wz-grid-choice`. Pojedyncze pole wypełnia
  wiersz. Karty kont w kroku kapitału mają maksymalnie 3 kolumny (tablet 2,
  mobile 1), żeby nie rozciągały się i nie „skakały” przy dodawaniu kont.
  W kroku „Jak chcesz przejść na FIRE?” wszystkie pola idą jedno pod drugim;
  nie dodawaj nagłówka sekcji, jeśli pytania pod spodem są już jednoznaczne.
- PPK/PPE w kroku etatu to niezależne trzystanowe segmenty: „obecnie wpłacam”,
  „mam konto, ale nie wpłacam”, „nigdy nie miałem”. Domyślnie „nigdy”, więc
  salda są ukryte; dla B2B/niepracujących panel sald pozostaje dostępny.
  Stawki PPK (pracownik/pracodawca) i PPE (pracodawca) są widoczne pod
  ołówkiem, domyślnie z konfiguracji: PPK 2,0%/1,5%, PPE 3,5%. ZUS i OFE to
  dwie osobne sekcje, a OFE używa segmentu `wzHasOfe`. Kontrolka kwotowa
  w suwaku mieści maksymalną dozwoloną wartość — nie wystarczy, że nie
  powoduje poziomego scrolla strony.
- Krok „Podział wpłat” (tylko manual / ścieżki 2/3) oferuje udziały ręczne. Są one
  procentami miesięcznej puli; każdy wiersz ma pole i suwak. Maksimum suwaka
  wynika z limitu konta i wolnej gotówki: `min(limit, obecny udział + 100 − suma
  pozostałych)`. Zwiększanie jednego konta nie zabiera środków innemu — tylko
  zmniejsza gotówkę; gdy gotówki nie ma, można wyłącznie zmniejszać. Suma nadal
  nie przekracza 100%.
  Suma udziałów jest osobnym statusem: zielony `chip-success` przy 100%.
  Drobna reszta po limitach/zaokrągleniach (≤ `WZ_TINY_CASH_ANNUAL`, 120 zł/rok)
  jest doliczana do największego konta bez limitu, tak samo jak w backendowym
  `_resolve_allocation`; dopiero większa nadwyżka pokazuje żółty wiersz gotówki.
  Przy ścieżce 2 wymaganą pulę oszczędności przeliczamy z uwzględnieniem
  udziałów ręcznych.
- **Profil ryzyka to nie strategia alokacji**: ogranicza łączny udział klas
  aktywów w nowych wpłatach, nie zmienia ROI. Stare karty
  „konserwatywna/zbilansowana/agresywna” usunięto z UI; `strategy` pozostaje
  tylko jako zgodność wstecz. Limity profili są globalnie edytowalne
  w Konfiguracji („Profile ryzyka”). IKE/IKZE/OIPE są wrapperami podatkowymi,
  ale ich zawartość (rodzaj inwestycji) wchodzi do miksu ryzyka. PPK/PPE
  pozostają poza podziałem nowych wpłat. OIPE jest dziś funduszowe; przyszłe
  rodzaje włącza się w Konfiguracji.

- Przy podziale z IKZE pod listą pojawia się nota, że ulga wraca co roku
  i jest reinwestowana; tooltip podaje kolejność IKE → OIPE → Broker → …
  i zastrzeżenie, że bez konta docelowego zwrot tylko obniża podatek.
  Nota zbiorcza „Pula: … / Wpłaty na IKZE…” siedzi bezpośrednio pod
  przełącznikiem Automatyczny/Ręczny w ramce `.wz-suggest-note`, nie pod listą.
- Przy dodawaniu aktywów tekst „Dodaj” nie jest widoczny. Pastylki kont
  wielokrotnych (`Lokata`, `Obligacje`, `Gotówka`, `Broker`, `Krypto`) są
  neutralne i pokazują ikonę „+” dopiero po nazwie, gdy istnieje już co najmniej
  jedna pozycja (przy dwóch i więcej dodatkowo licznik w badge'u). Usunięcie
  ostatniej pozycji chowa „+”. Konta pojedyncze (IKE, IKZE, OIPE, OKI) zaznaczają
  się na fioletowo, bez „+”. Nazwa początkowa wynika z etykiety konta, a jej
  edycja odbywa się w miejscu. Domyślne ROI pochodzi z efektywnej konfiguracji;
  w wierszu nie ma powtarzanej notatki „Domyślna wartość z Konfiguracji” —
  wyjaśnienie jest w tooltipie panelu, a po ręcznej zmianie pojawia się ikona
  przywracania domyślnego ROI. Do `roi_overrides` wysyłamy tylko wartość różną
  od domyślnej.
- Wynik Asystenta eksponuje odpowiedź, scenariusze, 3 metryki i plan w czasie
  (oś etapów + Gantt). Tabela przepływów jest pod Ganttem, a majątek, ulgi
  i „Jak czytać ten plan?” są w zwijanych „Danych szczegółowych”. „Jak
  dobraliśmy plan?” jest na samym dole, domyślnie zamknięte. Loader pokazuje
  „Wyliczam Twój plan…”,
  animowany pasek aktywności i rotujące teksty z v1 w karcie z gradientem;
  nie dodajemy banera „Czy wiesz, że…” ani nowych ciekawostek. Loader nie może
  sugerować, że symulacja jest prognozą ani rekomendacją.
- `PlanProjection.phase_metrics` zachowuje wszystkie kolejne etapy akumulacji;
  średnia wypłata dla fazy obejmuje wyłącznie lata tej fazy, nigdy lata dalszego
  oszczędzania z zerową wypłatą. Przywrócony wynik musi odkryć `#wzResult` bez
  ponownego wywołania `/api/wizard/plan`.
- Testy przeglądarkowe obejmują mobile, tablet i desktop oraz kluczowe warianty
  zatrudnienia, kapitału, częściowego FIRE i odtwarzania wyniku.

## Współpraca z użytkownikiem

- Gdy masz jakiekolwiek pytanie lub wątpliwość co do intencji, zakresu albo
  trade-offów — zadaj je w fazie planowania, ZANIM zaczniesz wprowadzać zmiany.
  Nie zgaduj. Użytkownik oczekuje pytań i sam o nie prosi.
- Jeśli uważasz, że pomysł użytkownika jest zły albo da się zrobić lepiej —
  mów o tym na głos i proponuj własne (lepsze lub alternatywne) rozwiązanie.
  Użytkownik woli usłyszeć Twoją opinię niż ślepe wykonanie.

## Weryfikacja przed oddaniem

- `uv run ruff check app/ tests/ scripts/`
- `uv run pytest -q -n auto --dist worksteal` (suite musi być zielony; xdist jest w dev-deps)
- `make test` robi to samo przez `pytest -n auto --dist worksteal`
- **Dev-loop:** `make test-fast` (`-m "not slow"`) + `make harness-jsdom`;
  `make check-fast` zbiera lint, typy, jsdom i szybkie testy bez Playwrighta.
- **Przed pushem:** `make check` (pełny pytest + jsdom + visual).
- Wszystkie ścieżki mają teraz 9 kroków (wspólny krok „Jak zaplanować wpłaty?”).
  Testy jsdom/visual muszą używać `wzStepOrder()` albo aktualnego licznika, nie
  stałej liczby; nie testuj dokładnego copy ani każdej mikrointerakcji.
- Testy planera: `plan(..., scenarios=False)` pomija 3 scenariusze rynkowe;
  `tests/test_planner.py` cache'uje identyczne plany i domyślnie używa
  `scenarios=False` (scenariusze tylko w testach kart). Pełne integracje
  solvera/API i scenariusze są oznaczone `@pytest.mark.slow`.
  Optymalizator ma osobne `tests/test_optimizer.py`: clampy profili i bequest
  są testowane jednostkowo (fast), a tylko 3 integracje pełnego searchu są
  `@pytest.mark.slow`. Nie wywołuj optymalizatora w testach sliderów.
  Visual jest smoke’em (ok. 54 uruchomienia); nie testuj w nim każdej
  mikrointerakcji ani dokładnego copy.
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
