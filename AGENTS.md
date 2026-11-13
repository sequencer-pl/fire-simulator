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
  realnie, domyślnie; `0.0` = zamrożone nominalnie; wartość pośrednia = wolniejsza
  niż inflacja). `threshold_factor(years)` przelicza kwotę wolną, progi, KUP i próg
  daniny; silnik przekazuje lata od startu do `scale_kwargs(years)`. Presety
  „Realne”/„Konserwatywne” mają 1,5%/1%.
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
  → krypto → gotówka, używane przez Asystenta i stare zapisy. IKE/OIPE przyjmują
  zwrot tylko do wysokości rocznego limitu wpłat, reszta leci dalej. Zwrot jest
  dopisywany **na koniec roku** (po wzroście), bo realnie przychodzi po PIT. Brak
  celu w `auto` = ostrzeżenie w wyniku. `SimulationResult` niesie
  `total_tax_refund`, `ikze_refund_allocations`, `exit_tax` i `final_wealth_net`
  (podatek wyjścia: IKZE 10% od całości po 65 r.ż. lub skala przed, IKE 0%,
  broker 19% od zysku) — dzięki temu IKE i IKZE nie wyglądają identycznie przy
  tej samej stopie zwrotu.
- **Wcześniejszy zwrot IKZE**: przed 65 podatek liczony od całości salda (skala),
  ale netto **nie zostaje w IKZE** — jest reinwestowane w konto docelowe wg
  `ikze_refund_target` (auto: IKE/OIPE do limitu, potem broker → lokata → gotówka).
  `SimulationResult` niesie `early_return_total`, `early_return_tax_total` i
  `early_return_allocations`; w przepływach pokazujemy chip „Wcześniejszy zwrot
  IKZE”, a nie wiersz IKZE 0 zł. Konto docelowe jest dodawane do etapu w locie.
- **Polityka wypłat Asystenta**: `withdrawal_policy` = `defer_tier` (IKE/konta
  dostępne najpierw, IKZE później), `early_tier` (wymuszone opodatkowanie całości
  IKZE na starcie realizacji przed 65; netto jest reinwestowane w konto docelowe),
  `defer_roi`/`early_roi` (w ramach progu podatkowego najpierw konta o niższym ROI). Asystent `auto` uruchamia cztery
  warianty i wybiera najwyższą wartość netto (`total_withdrawn + final_wealth_net`);
  wybrany wariant trafia do `input.withdrawal_policy` i do `/sim` przez draft.
- **ZUS obsługuje engine**, nie etap (waloryzacja zamiast ROI, konwersja kapitału na
  rentę zamiast PMT; renta waloryzowana corocznie). Rok emerytury = `start_year` +
  (wiek − wiek startowy); tabela ŚDTŻ jest wtedy przesuwana o wzrost długowieczności.
  Nie powielać `zus` w wielu etapach
  (`_process_stages`, engine.py — guard `zus_handled`). Emerytura netto = brutto − PIT
  (skala) − 9% składki zdrowotnej (`YearResult.health`, `health_paid`); portfel w
  etapie „Dopłata” uzupełnia tylko różnicę do celu netto (`_zus_net_annual`).
  Domyślne realne waloryzacje w presetach: świadczenie **0/1/2%**, składki
  **1/2/2,5%** (Konserwatywne/Realne/Optymistyczne). Historycznie świadczenie rosło
  realnie ~+1,1 pp/rok, składki ~+2–4 pp/rok (baza płacowa), więc 0% to podłoga,
  nie baza.
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
  (routes.py, limits.py); `app/core/` — helpery (tax, pmt, roi, inflation);
  `static/js/` + `static/css/` + `app/templates/` — front (system wizualny: `DESIGN.md`).
- **Walidacja wejścia**: `app/simulation/schemas.py` ma twarde granice (wiek etapów
  0–120, `end_age > start_age`, max 20 etapów, limity kwot/ROI). Symulacja kończy się
  na ostatnim etapie (`end_age - 1`); `max_age` jest tylko pomocniczym horyzontem.
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
  zostają z configu.
- **Konfiguracja lokalna**: `fire.config` przechowuje aktywny config i baseline,
  a `fire.presets` — własne presety. Jeśli kluczy nie ma, wczytujemy defaulty
  z `/api/config`, a lista presetów pokazuje same wbudowane. Zapis jest
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
  (`controls.js`), więc wpisanie `1000` nadpisuje domyślne `0`.
- Krok 4 (tytuł wg ścieżki: „Kiedy chcesz przejść na FIRE?” / „Twój cel wypłaty i
  wiek FIRE” / „Wymarzona wypłata i horyzont”): 4 wiersze `.wz-slider` w `.wz-rows`,
  bez hint-podpowiedzi (kontekst w `title` labela). Cel wypłaty tylko dla ścieżek 2/3,
  wiek FIRE tylko dla 1/2. Domyślne wartości **wg płci i wieku**, przeliczane dopóki
  pola nie były edytowane (`wzRetirementTouched`/`wzPlanEndTouched`): wiek emerytury
  ZUS = `RETIREMENT_DEFAULT` (60 k / 65 m); horyzont = wiek + `LIFE_EXPECTANCY`
  (GUS 2024, dane UI w wizard.js) powiększona o
  `longevity.growth_months_per_year` (przybliżenie kohortowe, patrz wyżej).
- Krok 5 „Strategia i podział": 4 panele `.wz-alloc-panel` — „Strategia podziału
  oszczędności", „Podział", „Dodaj instrument", „Wpłaty z pensji". **Bez wyboru
  założeń rynkowych** — te są wybierane w kroku 6 przez karty scenariuszy.
  Wybór strategii jest **wymagany** (na starcie żaden tryb); po jego wyborze
  widok przewija się do `#wzAllocPanel` (manual od razu, auto po sugestii).
  Strategie automatyczne: `wzAllocMode = "auto"`, `/api/wizard/suggest` (w ścieżce 2
  z celem i `pool_monthly`), sekcja „Podział" **read-only** (`.wz-alloc-readonly`).
  Sugestia najpierw wypełnia ulgi (IKZE, gdy średnia ulga PIT > 10,5%, inaczej IKE;
  potem drugi shelter i OIPE), a **nadwyżkę ponad limity** dzieli wg miksu strategii
  (`STRATEGY_MIX`: broker/obligacje/OKI/lokata/krypto; krypto 5% zrównoważona, 15%
  agresywna, 0% konserwatywna). Poniżej `MIX_MIN_ANNUAL` (20 tys. zł/rok) nadwyżka
  idzie do pierwszego konta miksu. Krok 5 pokazuje, gdzie trafi zwrot IKZE
  (`#wzAllocRefundNote`), a krok 6 — kwoty po kontach (`ikze_refund_allocations`).
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
- Krok 6 „Twój plan FIRE": loader `#wzPlanLoader` jest indeterministyczny
  (losowe teksty o cierpliwości, wpłatach i ryzyku, zmieniane co 6 s, bez cyklu 1/3–3/3).
  Tip loadera jest kartą `#wzLoaderTip` z gradientem, ikoną i etykietą
  „Warto wiedzieć”; przed nowym planem `resetPlanResult()` czyści stary wynik
  i `wzPlan`. Hierarchia wyniku:
  1. `#wzHeroAnswer` — odpowiedź na pytanie użytkownika + krótki kontekst,
  2. `#wzScenariosBox` — 3 klikalne karty z widocznym hintem,
  3. `#wzMetrics` — 3 metryki zależne od ścieżki,
  4. **`#wzTimeline` + `#wzFlowsWrap`/`#wzFlowsGantt`** — etapy życia i konta
     w jednym bloku „Twój plan w czasie”, zawsze widoczne,
  5. `#wzDetails` — zwijane „Dane szczegółowe”: majątek, ulgi/podatki,
     tabela przepływów i „Jak czytać ten plan?”.
  **Nie ma `#wzPhaseTable` ani `#wzStageSummaryList`** — ich rolę przejmuje
  oś czasu i panel szczegółów etapu. Gantt jest widokiem głównym, nie schowanym
  w `<details>`. Klik segmentu osi czasu lub paska konta otwiera wspólny panel
  `#wzGanttTip`; pokazuje okres, wypłatę netto, portfel/ZUS, PIT, składkę
  zdrowotną i podatek jednorazowy IKZE w osobnych wierszach. Na mobile Gantt
  przewija się w poziomie, a hint jest widoczny tylko tam. Tabela przepływów
  i chipy `Ulga IKZE` / `Wcześniejszy zwrot IKZE` są w „Danych szczegółowych”.
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
  `AccountPhase` (`PlanProjection.account_phases`): kolejne lata z wypłatami,
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
  Gantt ma wiersz „Razem” z sumą wypłat po okresach, podpis
  „Łącznie wypłacono netto”, a na mobile jest przewijany w poziomie ze sticky
  etykietami kont. Klik karty scenariusza ustawia `wzSelectedScenario` i
  przerenderowuje cały wynik (`renderScenarioResult`). Wybór scenariusza zapisywany
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
- Krok strategii wpłat oferuje tryb automatyczny i ręczny. Udziały ręczne są
  procentami miesięcznej puli; każdy wiersz ma pole i suwak. Maksimum suwaka
  wynika z limitu konta (IKE/IKZE/OIPE), a nie tylko z sumy 100%: np. IKZE
  11 304 zł przy puli 4 600 zł/mies. kończy się na 20,5% i 11 304 zł/rok.
  Zwiększanie jednego suwaka zdejmuje nadwyżkę z innych kont (najpierw
  największe bez limitu), więc można dojść do maksimum konta bez ręcznego
  zmniejszania sąsiadów. Suma nadal nie przekracza 100%.
  Suma udziałów jest osobnym statusem: zielony `chip-success` przy 100%.
  Drobna reszta po limitach/zaokrągleniach (≤ `WZ_TINY_CASH_ANNUAL`, 120 zł/rok)
  jest doliczana do największego konta bez limitu, tak samo jak w backendowym
  `_resolve_allocation`; dopiero większa nadwyżka pokazuje żółty wiersz gotówki.
  Przy ścieżce 2 wymaganą pulę oszczędności przeliczamy z uwzględnieniem
  udziałów ręcznych.
- Strategia = sposób dzielenia wpłat, nie profil ryzyka. `STRATEGY_ROI`
  jest usunięty; ROI pochodzi z konfiguracji i scenariuszy. `/api/wizard/suggest`
  zwraca `strategy_previews` (kwoty) i `strategy_priorities` (kolejność kont).
  Karta pokazuje 5 pierwszych priorytetów + „…i N dalsze” z pełną kolejnością
  w tooltipie, bez procentów i kwot — te zostają w „Proponowanym podziale”.
  Jeśli wszystkie strategie dają identyczny podział, UI pokazuje jedną kartę
  i „Pokaż inne strategie”. Decyzja i przyszły model dwuwarstwowy:
  `docs/adr/0001-strategy-vs-scenario.md`.
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
  (oś etapów + Gantt). Tabela przepływów, majątek, ulgi i „Jak czytać ten plan?”
  są w zwijanych „Danych szczegółowych”. Loader pokazuje „Wyliczam Twój plan…”,
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
- Testy planera: `plan(..., scenarios=False)` pomija 3 scenariusze rynkowe;
  `tests/test_planner.py` cache'uje identyczne plany i domyślnie używa
  `scenarios=False` (scenariusze tylko w testach kart). Pełne integracje
  solvera/API i scenariusze są oznaczone `@pytest.mark.slow`.
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
