# AGENTS.md — FIRE Simulator

Polski symulator niezależności finansowej. FastAPI + Jinja2 + vanilla JS (bez npm,
bez TypeScript), SQLite, pytest. Odpowiadaj i pisz UI po polsku.

## Pewniki modelu FIRE (aktualne, nie do zmiany bez uzgodnienia)

- **ROI netto wszędzie.** Wszystkie konta rosną według ROI *po* podatkach; podatek
  naliczany jest od wypłat (`_apply_tax`, engine.py:1170). Wyjątek: lokata
  (`tax_periodic`) — podatek Belka pobierany w trakcie akumulacji, wzrost już netto
  (engine.py:467, `periodic_net_roi`, core/roi.py).
- **Inflacja świadomie pomijana** w większości wyliczeń — wartości realne traktujemy
  jak nominalne. Inflacja występuje TYLKO w: kontu `gotowka` (ROI = -inflacja,
  engine.py:119/143), waloryzacji świadczenia ZUS i indeksacji kapitału
  (`_accumulate_zus`/`_convert_zus`, engine.py:934/1137) oraz helperach Fisher/deflate
  (core/inflation.py). Nie dodawać inflacji do wzrostu kont ani do PMT bez zgody.
- **Dwa tryby realizacji** (app/stages/realizacja.py):
  - PMT (annuitizacja do zera) — edytor `/sim` bez targetu i legacy;
  - stały cel netto — TYLKO wizard (edytor nigdy). Wypłata = `cel − bieżąca renta ZUS`,
    rozdzielana proporcjonalnie do sald; niewypłacone rośnie `(1+roi)`.
- **„Brydż do emerytury" = etap `realizacja`** (nie akumulacja) od wieku FIRE do końca
  planu; „Realizacja (emerytura)" = osobny etap `realizacja` zawierający tylko `zus`.
- **ZUS obsługuje engine**, nie etap (waloryzacja zamiast ROI, konwersja kapitału na
  rentę zamiast PMT; renta waloryzowana corocznie). Nie powielać `zus` w wielu etapach
  (`_process_stages`, engine.py:366 — guard `zus_handled`).
- Klucze kont są stałe (`broker, gotowka, ike, ikze, krypto, lokata, obligacje, oipe,
  oki_inw, oki_osk, ppe, ppk, zus`) — patrz `ACCOUNT_LABELS` w config.py.
- Wizard: path 1 = maks. stała wypłata netto (bisekcja + gross-up), path 2 = ile
  odkładać, path 3 = kiedy FIRE. Gwarancja = żaden rok nie spada poniżej targetu.

## Architektura i konwencje kodu

- `app/simulation/engine.py` — silnik + schematy; `app/simulation/planner.py` —
  wizard (plan, build_stages, solvery); `app/stages/*.py` — implementacje etapów;
  `app/web/` — FastAPI (routes.py, auth.py, simulations.py); `app/core/` — helpery
  (tax, pmt, roi, inflation); `static/js/` + `app/templates/` — front.
- Python: pełne adnotacje typów, pydantic BaseModel dla DTO, bez zbędnych komentarzy.
- JS: bez frameworków, funkcje nazwane, współdzielone helpery przez `window.*`
  (common.js: `$`, `show`, `api`; session.js: `refreshSessionBar`).

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
  (wizard.js). Nowe pola liczbowe przez `.num-control` + `.stepper`, nie surowe inputy.
- Aktywa wersjonowane przez `?v={{ version }}` (`_asset_version`, routes.py:37) —
  dodaj do każdego nowego pliku JS/CSS w template.

## Weryfikacja przed oddaniem

- `uv run ruff check app/ tests/ scripts/`
- `uv run pytest -q` (suite musi być zielony)
- `node --check static/js/...` dla zmienionych plików JS
- zmiany w wizard.js: harness jsdom `/tmp/opencode/fire-jsdom/repro.mjs`

## Workflow git / deploy

- Commit TYLKO na wyraźną prośbę. Przed: `git status`, `git diff`, spójny styl logu.
  Wiadomości po polsku, conventional (`feat(scope):`, `fix`, `chore`, `refactor`).
- Praca na branch-ach (`wizard`, `..._refactor`); merge do `main` fast-forward.
- Push do `main` = CI + auto-deploy na Render (GH Action `deploy.yml`, hook
  `RENDER_DEPLOY_HOOK`). „Zakomituj i wdróż" = push `main`; „bez deployu" = commit
  lokalnie bez pusha (ew. push tylko brancha). Wdróż tylko na wyraźną prośbę.
- Nie commituj sekretów. `render.yaml`: web service free tier, dysk ephemeryczny.