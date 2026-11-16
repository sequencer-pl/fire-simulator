# AGENTS.md — FIRE Simulator

Polski symulator niezależności finansowej. FastAPI + Jinja2 + vanilla JS
(bez npm i TypeScript), pytest. UI i komunikaty po polsku; identyfikatory
w kodzie po angielsku, komentarze i docstringi po polsku.

Ten plik zawiera **globalne zasady pracy z projektem**. Konkretne zachowania,
aktualne limity i wartości podatkowe są w `README.md`, `app/simulation/config.py`
i testach. Nie dokumentujemy tutaj pojedynczych tooltipów, ID elementów ani copy.

## 1. Współpraca

- Gdy intencja, zakres albo trade-off są niejasne — pytaj w fazie planowania,
  zanim zaczniesz zmieniać kod. Nie zgaduj.
- Jeśli pomysł użytkownika jest gorszy niż alternatywa — powiedz to wprost
  i zaproponuj lepsze rozwiązanie.
- Większe zmiany planuj przed implementacją; plan zatwierdza użytkownik.
- Commit, push i deploy tylko na wyraźną prośbę.

## 2. Workflow i testy

Trzy poziomy:

1. **Proste / kosmetyczne** — copy, tooltipy, domyślne wartości, CSS bez zmiany
   logiki. Bez testów. Wystarczy:
   - `node --check` dla zmienionego JS,
   - `git diff --check`,
   - ręczny screenshot lub kliknięcie, jeśli zmiana jest wizualna.
2. **Większe** — logika, feature, refactor, API, symulacja, podatki, migracje,
   współdzielone komponenty CSS. Uruchom `make check-fast` (lint, mypy, jsdom,
   szybki pytest).
3. **Przed push/deploy** — zawsze `make check` (pełny pytest + jsdom + visual).
   Jeśli zmiana jest świadomie wizualna: `make visual-baseline`, przejrzyj diff
   baseline'ów, potem `make check`.

CI na pushu jest backstopem, nie zamiennikiem lokalnego gate'u. Testy planera
używają `plan(..., scenarios=False)`; integracje solvera/API/scenariusze są
oznaczone `@pytest.mark.slow`; optymalizator ma osobne `tests/test_optimizer.py`.
W visualach nie testuj dokładnego copy ani każdej mikrointerakcji.

Wymagania: `uv`, Python 3.12+.

| Cel | Komenda |
| --- | --- |
| setup | `make setup` |
| dev | `make dev` |
| test | `make test` |
| test-fast | `make test-fast` |
| check-fast | `make check-fast` |
| check | `make check` |
| visual | `make visual` |
| visual-baseline | `make visual-baseline` |
| lint | `make lint` |
| typecheck | `make typecheck` |
| format | `make format` |
| clean | `make clean` |

## 3. Architektura

- `app/simulation/` — model: `engine.py` (silnik, podatki, ZUS), `planner.py`
  (wizard, budowa etapów, solvery), `optimizer.py` (alokacja i wiek ZUS),
  `config.py` (globalny config, presety, scenariusze, limity), `schemas.py`
  (walidacja wejścia), `zus.py`, `constants.py`.
- `app/stages/` — implementacje etapów (akumulacja, realizacja).
- `app/web/` — FastAPI: `routes.py`, `limits.py`.
- `app/core/` — helpery: podatki, PMT, ROI, inflacja.
- `static/js`, `static/css`, `app/templates/` — front; system wizualny w `DESIGN.md`.
- `qa/jsdom`, `qa/visual` — harness JS i Playwright.

Zasady:

- Aplikacja jest **bezstanowa**: brak bazy, logowania i sesji. Konfiguracja
  i presety żyją w `localStorage` (`fire.config`, `fire.presets`); plany to
  `.sim.json`, konfiguracje `.config.json`.
- `app/simulation/schemas.py` jest źródłem twardych granic wejścia (wiek, etapy,
  kwoty, ROI). Nowe pole waliduj tam, nie w route'ach.
- Ciężkie endpointy przechodzą przez `app/web/limits.py` (`check_limit`).
- Nowe pliki JS/CSS dodawaj z `?v={{ version }}` (`_asset_version`).
- Import/eksport: plany używają schema `fire-simulation/v1`, konfiguracje
  `fire-config/v1`; stare gołe JSON-y są odrzucane.
- `max_age` to górny limit symulacji. Etapy mogą wystawać dalej (np. ZUS do
  100 r.ż.), ale symulacja nie wychodzi poza ostatni etap ani `max_age`.

## 4. Niezmienniki modelu

Nie zmieniaj ich bez uzgodnienia. Wartości liczbowe pochodzą z `config.py`,
`README.md` i testów — nie duplikuj ich w tym pliku.

- **ROI jest realne, brutto, przed podatkiem, wszędzie.** Podatek nalicza silnik
  według `AccountRules`: od wypłat, periodycznie (lokata) albo rocznie od aktywów
  (OKI). `gotowka` ma ROI = `-inflacja`.
- **Inflacja wchodzi tylko w miejsca modelu:** Belka/lokata, erozja gotówki,
  waloryzacja ZUS, indeksacja progów PIT, helpery Fisher/deflate. Nie dodawaj
  jej do wzrostu kont ani PMT bez zgody.
- **`prog_indexation`**: `None` = progi stałe realnie, `0.0` = zamrożone
  nominalnie; domyślną wartość bierze z `default_config()`. Bessa i hossa
  modyfikują ją jako deltę.
- **Długowieczność** modelujemy liniowo: `longevity.growth_months_per_year`
  wydłuża tabelę ŚDTŻ i domyślny horyzont Asystenta.
- **Etapy:** `akumulacja` i `realizacja`; „Brydż do emerytury” to realizacja.
  Edytor/legacy używa PMT, Asystent — stałego celu netto; nie mieszaj trybów.
  ZUS liczy engine (waloryzacja, ŚDTŻ, renta netto po PIT i 9% zdrowotnej),
  a etap ZUS zawiera tylko `zus` — nie powielaj go w wielu etapach.
- **IKZE:** ulga obniża podatek w roku wpłaty; zwrot trafia na
  `ikze_refund_target` (auto: IKE/OIPE do limitu → obligacje → lokata →
  OKI oszcz. → broker → gotówka; **nigdy krypto**). Wcześniejszy zwrot przed 65:
  podatek skalą od całości, netto reinwestowane tą samą kolejnością, bez
  pozostawiania w IKZE.
- **Polityki wypłat:** `defer_tier`, `early_tier`, `defer_roi`, `early_roi`,
  `defer_tax`, `early_tax`. `auto` porównuje warianty i wybiera najwyższą
  wartość netto (`total_withdrawn + final_wealth_net`).
- **OKI:** podatek od aktywów od średniego stanu ponad wspólny limit (100 tys. zł,
  w tym 25 tys. zł oszczędności); wypłaty bez Belki. Sugestia alokacji respektuje
  istniejące saldo OKI.
- **Opakowania:** IKE/IKZE/OIPE to wrapper podatkowy; rodzaj inwestycji
  (maklerskie/funduszowe/oszczędnościowe) ustala ROI i klasę ryzyka. OIPE jest
  domyślnie tylko funduszowe. Profile ryzyka ograniczają **nowe wpłaty**, nie
  istniejący portfel.
- **Scenariusze:** „Realne” = globalny config; bessa i hossa to delty w
  `TaxConfig.scenarios`. Wbudowane presety to tylko `Domyślny 2026` i
  `Domyślny 2027`.
- **Klucze kont** są stałe (`broker`, `gotowka`, `ike`, ...); dla instancji
  (`lokata:2`) używaj `base_account_key`.
- **Limity i stawki** pobieraj z `Limits`/`AccountRules`/`TaxConfig`, nie
  hardcoduj ich w logice ani dokumentacji.

## 5. Konwencje kodu

- Python: pełne adnotacje typów, pydantic dla DTO, walidacja w schematach,
  bez zbędnych komentarzy.
- JS: bez frameworków, nazwane funkcje, wspólne helpery przez `window.*`
  (`helpers.js`, `icons.js`, `controls.js`, `sim-utils.js`).
- CSS: `tokens.css` (jedyne kolory i rozmiary) → `base.css` → `components.css`
  → arkusz strony. Nowe kolory tylko jako token; przezroczystości przez
  `color-mix()`, nie `rgba()`.
- Nowe pola liczbowe: `numControlsHtml` + `initNumControls`; zaznaczanie całej
  wartości przy focusie; pole musi mieścić najdłuższą dopuszczalną kwotę.
- Daty bez sekund (`fmtDateTime`), kwoty przez `fmtMoney`; normalizuj `-0`.
- Zmienione pliki JS sprawdzaj `node --check`.

## 6. UI/UX — zasady globalne

System wizualny, tokeny i słowniczek: `DESIGN.md`. Tutaj tylko reguły dotyczące
każdego ekranu:

- Używaj istniejących komponentów i tokenów. Nie dodawaj własnych kolorów,
  rozmiarów, promieni ani ikon.
- Widoczny tekst jest krótki. Mechanika, przykłady, listy składników,
  uzasadnienia i wyliczenia idą do `.tip` przy nagłówku panelu. Tooltip
  wyjaśnia **szczegółowo** działanie sekcji, przycisku lub mechanizmu; nie
  powtarza listy opcji, które są pod spodem.
- Duży kafel `.wz-path` dla decyzji wymagającej wyjaśnienia; `.segmented` dla
  wyboru oczywistego. Domyślnie zaznaczaj najbardziej prawdopodobną opcję;
  kolejność opcji od najczęstszej, chyba że naturalna kolejność jest inna
  (np. rosnące stawki).
- Suwak pokazuje realistyczny, typowy zakres; pole liczbowe pozwala wpisać
  więcej ręcznie. Pole musi mieścić maksymalną wartość; na mobile liczba jest
  nad suwakiem.
- Mobile to ten sam produkt: breakpointy 640/900/1024/1200, siatki schodzą do
  jednej kolumny, tabele i Gantt przewijają się we własnym wrapperze, nigdy
  cała strona. Długie segmented stackują się, zamiast nachodzić na siebie.
- Jeden pasek akcji, jeden styl ostrzeżeń (`.banner`), jeden język ikon
  (SVG, bez emoji), widoczny focus i kontrast ≥ 4,5:1.
- Copy po polsku, zgodne ze słowniczkiem; bez synonimów i skrótów spoza
  słowniczka.
- Loader pokazuje postęp i kontekst; bez dekoracyjnego spinnera, jeśli jest
  pasek postępu.

## 7. Dokumentacja i źródła prawdy

- `AGENTS.md` — globalne zasady pracy, architektury, testów i UI.
- `DESIGN.md` — system wizualny, tokeny, komponenty, wzorce interakcji,
  dostępność, słowniczek.
- `README.md` — wizytówka projektu dla użytkownika GitHuba: czym jest, po co
  powstał, główne założenia, szybki start. Bez workflow agentów i bez
  szczegółowych komend testowych.
- `docs/model.md` — pełne założenia, wyjątki i ograniczenia modelu; tutaj
  trafiają szczegóły, których nie chcemy w README.
- `app/simulation/config.py` — źródło prawdy dla stawek, limitów, ROI, profili
  ryzyka, wrapperów i scenariuszy.
- Testy — źródło prawdy dla konkretnego zachowania. Jeśli coś jest ważne,
  pokryj to testem zamiast opisywać w `AGENTS.md`.

Nie duplikuj w `AGENTS.md`/`DESIGN.md` wartości, które żyją w configu/README/
`docs/model.md`.
Zmiana globalnej reguły → `AGENTS.md`/`DESIGN.md`; zmiana konkretnego
zachowania → kod/testy/README.

## 8. Git i deploy

- Commit tylko na wyraźną prośbę; przed commitem `git status`, `git diff`,
  `git diff --check`.
- Conventional commits po polsku: `feat(scope):`, `fix(scope):`,
  `refactor(scope):`, `docs(scope):`.
- Praca na branchach; merge do `main` fast-forward.
- Push `main` = CI + auto-deploy (Render). „Zakomituj i wdróż” = push `main`;
  „bez deployu” = commit lokalnie bez pusha.
- Nie commituj sekretów.

**Produkcja:** FastAPI + gunicorn/uvicorn, bez bazy i sekretu sesji.
`FIRE_ENV=production` wyłącza `/docs` i `/openapi.json`; `GET /healthz`
zwraca `{"status": "ok"}`. Start: `make prod` / `make prod-port` albo
`gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 1 --bind 0.0.0.0:$PORT`.
Render korzysta z `render.yaml` (web service, build przez
`pip install -r requirements.txt`, start przez gunicorn, probe `/healthz`).
CI/CD: `ci.yml` przy pushu/PR, `deploy.yml` po pushu do `main`.
