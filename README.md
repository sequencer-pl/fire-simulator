# FIRE Simulator

Symulator niezależności finansowej (*Financial Independence, Retire Early*) dla polskiego systemu podatkowego i emerytalnego.

**Nie obiecujemy, że będziesz bogaty.** Nie znamy Twojej przyszłości, nie przewidzimy rynku i nie zastąpimy doradcy. Ten projekt ma jedno zadanie: pokazać, co wynika z Twoich liczb — po polsku, po podatkach i bez ściemy. Jeśli po jednej symulacji spojrzysz na oszczędzanie trochę poważniej, uznamy to za sukces.

FIRE Simulator odpowiada na pytanie, które zadaje sobie każdy, kto planuje wcześniejszą emeryturę: **ile dziś oszczędzać, w co, i jak długo inwestować, żeby w wieku X móc przestać pracować i mieć środki do końca życia** — z uwzględnieniem podatków, limitów i reguł wiekowych, które naprawdę obowiązują w Polsce.

Zamiast jednej magicznej liczby ("potrzebujesz 2 mln zł") pokazuje **rozpisane po latach** źródła finansowania: co wypłacasz z rachunku maklerskiego i IKZE, co z IKE i PPK, a co realnie otrzymasz z ZUS — oraz ile z tego oddasz fiskusowi.

## Czym to jest — i czym nie jest

**Jest** modelem, nie wróżbą. Bierze Twoje zarobki, oszczędności, wiek i założenia, a potem pokazuje rok po roku, co z nich wynika. Ma pomóc zrozumieć mechanikę: podatki, limity, kolejność wypłat, ZUS. I ma inspirować — bo czasem jedna dobrze zaprezentowana symulacja robi więcej niż dziesięć artykułów o „wolności finansowej”.

**Nie jest** poradą inwestycyjną, prognozą rynku ani gwarancją. Nie wie, jaka będzie inflacja, stopy procentowe i prawo za 20 lat. Nie uwzględnia Twojej psychiki, nieprzewidzianych wydatków ani tego, że życie lubi pisać własne scenariusze. Jeśli szukasz odpowiedzi „czy warto”, to nie tutaj — tutaj znajdziesz „co się stanie, jeśli”.

## Dla kogo

- **Dla Ciebie, jeśli** chcesz zrozumieć, co robią z Twoimi pieniędzmi podatki, limity i kolejność wypłat.
- **Dla Ciebie, jeśli** lubisz scenariusze „co by było, gdyby” bardziej niż jedną magiczną liczbę.
- **Nie dla Ciebie, jeśli** szukasz rekomendacji „kup X, sprzedaj Y, będziesz wolny w 2035”.

## Od czego zacząć

- **Asystent** — sześć pytań i gotowy plan w trzech scenariuszach rynkowych. Pensję możesz podać miesięcznie albo rocznie. Najlepszy pierwszy krok.
- **Symulator** — pełna kontrola: etapy, konta, wpłaty, wypłaty i tabela rok po roku.
- **Moje symulacje** — zapisane scenariusze i porównanie do czterech naraz.

## Dlaczego powstał

Narzędzia do planowania FIRE są zwykle oparte na rynkach amerykańskich (401k, Roth IRA, stopa wycofania 4%). W Polsce układ jest inny i nieco szerszy: cztery filary (ZUS, PPK, IKE, IKZE) plus nowe konta OKI, inny system podatkowy (skala PIT, Belka, ryczałt od IKZE) i inne progi wiekowe. Chcieliśmy narzędzie, które:

- modeluje **polskie reguły z 2026 r.**: skala PIT 12/32% z kwotą wolną 30 000 zł, Belka 19%, ryczałt IKZE 10%, podatek od aktywów OKI 0,85%;
- rozlicza **podatki przy wypłacie** (nie tylko "Brutto"), bo to one najczęściej psują amerykańskie kalkulatory przeniesione 1:1 do Polski;
- wylicza **emeryturę ZUS z kapitału** wg tablic GUS (kapitał ÷ ŚDTŻ), a nie z życzeniowej kwoty "4000 zł/mies.";
- pozwala budować scenariusze **etapami** — np. ciężki okres oszczędzania do 50., "sabatical" 50–60, właściwa emerytura od 60.

## Jak się z tego korzysta

Symulację układasz z **etapów** (akumulacja i realizacja), a każdy etap to zbiór **kont**:

1. **Akumulacja** — oszczędzasz: wpisujesz saldo startowe, roczne dopłaty, składki (ZUS/PPK/PPE), ROI i wiek początku/końca.
2. **Realizacja** — wypłacasz: silnik liczy roczną wypłatę jako annuitet (PMT), tak by środki starczyły do końca etapu (opcjonalnie zostawiając bufor).

Etapy mogą się nakładać (np. IKE + ZUS jednocześnie), a jedno konto może występować w wielu etapach z różnymi regułami. Wynik to tabela i wykres majątku w każdym roku życia.

## Zanim uwierzysz wynikom

Symulator celowo jest **prostym modelem deterministycznym**, a nie symulacją Monte Carlo. To, czego nie modeluje, jest równie ważne jak to, co modeluje:

> **W skrócie:** liczby są realne i netto, ROI jest stałe, ZUS uproszczony, a rynek, inflacja i prawo siedzą poza modelem. To wystarczy, żeby planować, ale nie wystarczy, żeby traktować wynik jak proroctwo.

1. **Wszystko w dzisiejszych złotych.** Silnik przechowuje i pokazuje wyniki w sile nabywczej (realnie). `ROI` wpisujesz **realne (ponad inflacją), brutto — przed podatkiem**. Inflacja nie jest doliczana do wzrostu kont; wchodzi tylko w:
   - nominalną Belkę od zysku (broker, IKE/PPK/PPE przed progami) i mechanikę lokaty,
   - erozję gotówki (`-2,5%/rok`),
   - waloryzację ZUS (punkt 8).

   Ryczałt IKZE i skala PIT liczą się od realnych kwot. Podatek od aktywów OKI jest w modelu liczony od realnego salda (uproszczenie).

2. **ROI to realna stopa zwrotu (ponad inflacją), brutto, i jest stała w każdym roku.** Dla brokera, krypto, obligacji, IKE, IKZE, PPK, PPE i OIPE to zwrot **przed** podatkiem od wypłat; silnik nalicza go według zasad konta (Belka, ryczałt, skala PIT). Wyjątki:
   - **lokata** — Belka 19% pobierana co okres; silnik przelicza ROI na nominalne brutto i urealnia,
   - **OKI** — ROI przed rocznym podatkiem od aktywów (0,85%),
   - **gotówka** — ROI = `-inflacja`,
   - **ZUS** — waloryzacja, nie ROI.

   Przykład: lokata 5% realnie brutto, inflacja 0% → po Belce 19% zostaje 4,05% realnie. Przy inflacji 2,5% nominalne brutto ≈7,63%, po Belce ≈6,18% nominalnie, czyli ≈3,59% realnie. Nie ma zmienności rynku: 6% średnio nie znaczy 6% co roku.

3. **Emerytura ZUS = kapitał ÷ ŚDTŻ(GUS).** Dla danego wieku emeryturę liczy się jako zgromadzony kapitał podzielony przez tablicę średniego dalszego trwania życia. Tablica jest **wspólna dla obu płci** (GUS publikuje jedną; zróżnicowanie usunął wyrok TK K 1/13) — płeć zmienia jedynie **wiek emerytalny: kobiety 60, mężczyźni 65**. Silnik nie sprawdza warunków stażowych ani nie wyrównuje do emerytury minimalnej — o tym tylko ostrzega.

4. **Wiek emerytalny ZUS to sugestia, nie twarda granica.** Silnik policzy emeryturę z dowolnego wieku (np. 55), bo "przed 60/65 realnie świadczenie nie przysługuje" — dostaniesz ostrzeżenie, ale wynik się pojawi. Traktuj go jako poglądowy.

5. **Wypłaty przed wiekiem uprawniającym** kosztują i nie zawsze da się to zamodelować w 100%:
   - **IKE przed 60** — Belka 19% od zysku (zamodelowane);
   - **IKZE przed 65** — jednorazowy zwrot całości ze skalą PIT, potem wypłaty z kapitału netto (model "wypłata + lokata");
   - **PPK przed 60** — środki pracodawcy i dopłaty państwa przepadają, podatek Belka od zysku tylko na części pracownika;
   - **PPE przed 60** — 30% składek podstawowych pracodawcy trafia do ZUS subkonto.

6. **Bufor to nie "poduszka", tylko wartość końcowa.** PMT wylicza wypłatę tak, by na koniec etapu zostało dokładnie `bufor` złotych. Chcesz zachować kapitał na później → wpisz go w bufor; chcesz przejeść wszystko → 0.

7. **OKI (od 2027 r.)** — zamiast Belki coroczny podatek od wartości aktywów (0,85%) od średniego stanu ponad **wspólny limit 100 000 zł** dla wszystkich kont OKI, z czego max 25 000 zł na część oszczędnościową (lokaty/obligacje). Podatek płacisz niezależnie od zysku lub straty. Wypłaty nie podlegają Belce. Zamodelowane wprost.

8. **ZUS w akumulacji rośnie przez waloryzację (domyślnie 1%/rok), nie przez ROI** — plus składka 19,52% od podstawy do limitu 30× przeciętnego wynagrodzenia. Członkowie OFE mają rozdzielany strumień: 2,92 pkt do OFE (rośnie z ROI), reszta waloryzowana w ZUS.

9. **Limity wpłat (2026):** IKE 28 260 zł, IKZE 11 304 zł (16 956 zł samozatrudnieni), OIPE 28 260 zł, składka dodatkowa PPE 42 390 zł. Przekroczenie to ostrzeżenie, nie automatyczne obcięcie — dopłaty ponad limit po prostu "wchodzą" i tracą sens podatkowy.

10. **Nakładające się etapy** — dla danego konta wygrywa pierwszy z nich; konta nieobsługiwane w danym roku rosną pasywnie z ostatnim znanym ROI (domyślnie 2%).

Wszystkie **wypłaty** w wynikach są netto (po podatku). Majątek pokazujemy
**brutto** oraz **netto po podatku wyjścia** (gdyby zlikwidować konta na koniec
planu: IKZE 10% po 65 r.ż. lub skala przed, IKE 0%, broker 19% od zysku).
Ulga IKZE obniża podatek w roku wpłaty; zwrot można reinwestować na wybranym
koncie (w edytorze wybór jest obowiązkowy; Asystent robi to automatycznie:
broker → OKI → obligacje → lokata → krypto → gotówka) albo zostawić jako samą ulgę.

## Obsługiwane konta

| Konto | Reżim podatkowy | Dostępność | Uwagi |
|-------|-----------------|------------|-------|
| Broker / krypto | Belka 19% od zysku przy wypłacie | dowolna | ROI brutto |
| Lokata | Belka 19% co okres | dowolna | ROI brutto; podatek rozliczany w trakcie |
| Obligacje | Belka 19% od zysku | dowolna | ROI brutto, realna marża ponad inflację |
| Gotówka | brak | dowolna | domyślnie −2,5%/rok (inflacja) |
| IKE | 0% po 60. r.ż. | od 60 | przed 60: Belka 19% od zysku |
| IKZE | ryczałt 10% po 65. | od 65 | przed 65: skala PIT od całości zwrotu |
| PPK | 0% po 60. r.ż. | od 60 | dopłaty państwa: 250 + 240 zł/rok |
| PPE | 0% po 60. r.ż. | od 60 | składka podstawowa pracodawcy do 7% |
| OIPE | 0% po 60. r.ż. | od 60 | limit wpłat jak IKE |
| OKI (inw./osk.) | podatek od aktywów 0,85% | dowolna | wspólny limit 100 000 zł / 25 000 zł |
| ZUS | skala PIT przy wypłacie | od 60/65 | emerytura = kapitał ÷ ŚDTŻ(GUS) |

## Wiek emerytalny i płeć

Przełącznik płci (K/M) w pasku akcji dotyczy **wyłącznie ZUS** — ustawia powszechny wiek emerytalny (60 dla kobiet, 65 dla mężczyzn), od którego znika ostrzeżenie o wcześniejszej wypłacie. Nie zmienia ani wysokości emerytury (tablica ŚDTŻ jest wspólna), ani zasad innych kont. Wartości można edytować w Konfiguracji („Wiek emerytalny — kobiety/mężczyźni").

## Jak pracować z projektem

Wymagania: [uv](https://docs.astral.sh/uv/), Python 3.12+.

```bash
make setup      # pierwszy raz: tworzy .venv i instaluje zależności
make dev        # serwer deweloperski z auto-reload na http://localhost:8000
```

Typowy cykl: edytujesz kod → serwer sam się przeładuje → odświeżasz stronę → `make test` → `make lint`. Statyczne pliki (CSS/JS) są serwowane z cache-bustingiem, więc zmiany widać od razu.

| Cel | Opis |
|-----|------|
| `make setup` | Instaluje zależności (`uv sync`) |
| `make dev` | Serwer deweloperski z auto-reload |
| `make dev-port` | Serwer dev z auto-reload na `0.0.0.0`, port z env `PORT` (domyślnie 8000) |
| `make prod` | Serwer na `0.0.0.0:8000` (gunicorn + uvicorn worker) |
| `make prod-port` | Jak `prod`, ale port z env `PORT` (np. Render) |
| `make test` | Testy jednostkowe (pytest) |
| `make lint` | Linter (ruff check) |
| `make format` | Formatowanie kodu (ruff format + fix) |
| `make clean` | Usuwa cache i artefakty |

Zapisane symulacje trzymane są lokalnie w SQLite (konto e-mail + hasło wystarczą). Z poziomu strony głównej można je porównywać (do 4 naraz).

## Uruchamianie produkcyjne

Produkcja to FastAPI + gunicorn/uvicorn + SQLite. Wymagane zmienne środowiskowe:

| Zmienna | Obowiązkowa | Opis |
|---------|-------------|------|
| `FIRE_ENV` | w produkcji | `production` — wyłącza `/docs`, wymusza `https_only`, wymaga `FIRE_SECRET_KEY` z env |
| `FIRE_SECRET_KEY` | w produkcji | klucz sesji. W `production` **musi** pochodzić z env (nie jest zapisywany na dysk) |
| `FIRE_DB` | nie | ścieżka do pliku SQLite (domyślnie `fire.db` w repo). **Na free tier Render dysk jest ephemeryczny — dane giną przy spin-down/redeploy** |

Dwa sposoby startu:

- **gunicorn** (rekomendowane, używane na hostingu): `gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 1 --bind 0.0.0.0:$PORT`. Jeden worker — SQLite plikowe jest single-writer.
- **uvicorn**: `make prod` albo `make prod-port` (port z `PORT`).

Endpoint `GET /healthz` zwraca status + dostępność bazy (probe dla hostingu). Backup bazy — `scripts/backup_db.sh` (online backup `sqlite3 .backup`, zachowuje `BACKUP_KEEP` ostatnich snapshotów).

**Deploy na Render** — repo zawiera `render.yaml` (Blueprint: web service + env, build przez `pip install -r requirements.txt`, start przez gunicorn, `/healthz`). CI/CD leci z GitHub Actions: `ci.yml` przy pushu/PR, a `deploy.yml` po każdym pushu do `main` (Render buduje linkowany branch).

> **Uwaga o free tier Render.** Free web service NIE wspiera persistent disk — filesystem jest ephemeryczny, więc lokalne dane (konta, symulacje) giną przy każdym *spin-down* (po ~15 min bezczynności) i przy każdym redeployu. To celowy wybór na **wstępne "demo"** — nie trzymamy tu trwałych kont. Plan na trwałość (w kolejnych krokach): baza zewnętrzna (np. Render Postgres / Turso libSQL) wraz z **export/import symulacji do JSON**.

## Struktura

```
app/
├── core/          # PMT (annuitet) i podatki (skala PIT, ryczałt)
├── stages/        # etapy akumulacji i realizacji + metadane formularza
├── simulation/    # silnik symulacji, schematy, tablica ŚDTŻ, parametry (2026)
├── web/           # trasy FastAPI i autoryzacja
├── storage/       # SQLite
├── templates/     # szablony (symulator, lista symulacji, porównanie)
└── main.py        # aplikacja FastAPI
static/js/         # frontend (vanilla JS)
tests/             # testy pytest (silnik, podatki, ZUS, OKI, ...)
```

## Zastrzeżenie

To narzędzie do myślenia, nie do wróżenia. **Nie jest poradą inwestycyjną ani gwarancją.** Wyniki zależą od założeń, które musisz samodzielnie zweryfikować. Model celowo upraszcza rzeczywistość: zakłada stałe ROI, uproszczony ZUS i pomija zmienność rynku oraz część realnych zasad. Decyzje finansowe podejmuj z głową — najlepiej z doradcą, który zna Twoją sytuację.

## Autorstwo

Projekt powstał metodą *vibe-coding*: kod napisał asystent AI (opencode, model big-pickle) w trakcie interaktywnych sesji z właścicielem repozytorium (sequencer-pl), który pełnił rolę nadzoru merytorycznego, recenzenta i akceptanta — w jego imieniu i pod jego czujnym okiem. Wszelkie błędy modelowe są efektem wspólnych, czasem zbyt śmiałych, decyzji. :)

## Licencja

MIT
