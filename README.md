# FIRE Simulator

Symulator niezależności finansowej (*Financial Independence, Retire Early*) dla polskiego systemu podatkowego i emerytalnego.

FIRE Simulator odpowiada na pytanie, które zadaje sobie każdy, kto planuje wcześniejszą emeryturę: **ile dziś oszczędzać, w co i jak długo, żeby w wieku X móc przestać pracować i mieć środki do końca życia** — z uwzględnieniem podatków, limitów i reguł wiekowych, które naprawdę obowiązują w Polsce.

Zamiast jednej magicznej liczby ("potrzebujesz 2 mln zł") pokazuje **rozpisane po latach** źródła finansowania: co wypłacasz z rachunku maklerskiego i IKZE, co z IKE i PPK, a co realnie otrzymasz z ZUS — oraz ile z tego oddasz fiskusowi.

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

## Kluczowe założenia — przeczytaj, zanim zaczniesz się martwić wynikami

Symulator celowo jest **prostym modelem deterministycznym**, a nie symulacją Monte Carlo. To, czego nie modeluje, jest równie ważne jak to, co modeluje:

1. **Wszystko w dzisiejszych złotych, inflacja tylko do podatków.** Silnik przechowuje i pokazuje wyniki w sile nabywczej (realnie). `ROI` wpisujesz **realnie netto** (po Belce i po inflacji), a globalna `inflacja` (`Konfiguracja → Skala podatkowa`, domyślnie 2,5% w presetach) służy tylko do wyliczenia nominalnego podatku Belki/OKI i PIT z realnych kwot. Gotówka domyślnie `-2,5%/rok` (erozja = inflacja).

2. **ROI to realna stopa netto i jest stała w każdym roku.** Roczny, płaski zwrot *po opłatach i po Belce/OKI oraz po inflacji* (realny), ale **przed** podatkiem odroczonym od wypłat — ten rozlicza silnik na nominalnym odpowiedniku. Np. lokata 2% realnie + inflacja 2,5% → brutto nominalne ≈5,5% → Belka 19% liczona co okres (3m/12m) i urealniona. Nie ma zmienności rynku: 6% średnio nie znaczy 6% co roku.

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

Wszystkie kwoty w wynikach są **netto (po podatku)**. "Majątek" to suma sald na początek roku.

## Obsługiwane konta

| Konto | Reżim podatkowy | Dostępność | Uwagi |
|-------|-----------------|------------|-------|
| Broker / krypto / lokata | Belka 19% od zysku | dowolna | podstawowe konta inwestycyjne |
| Obligacje | Belka 19% od zysku | dowolna | realna marża ponad inflację |
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
| `FIRE_DB` | nie | ścieżka do pliku SQLite (domyślnie `fire.db` w repo). **W produkcji wskaż katalog trwały** |

Dwa sposoby startu:

- **gunicorn** (rekomendowane, używane na hostingu): `gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 1 --bind 0.0.0.0:$PORT`. Jeden worker — SQLite plikowe jest single-writer.
- **uvicorn**: `make prod` albo `make prod-port` (port z `PORT`).

Endpoint `GET /healthz` zwraca status + dostępność bazy (probe dla hostingu). Backup bazy — `scripts/backup_db.sh` (online backup `sqlite3 .backup`, zachowuje `BACKUP_KEEP` ostatnich snapshotów).

**Deploy na Render** — repo zawiera `render.yaml` (Blueprint: web service + persistent disk `/var/data` + env). `FIRE_DB` musi wskazywać `mountPath` dysku (np. `/var/data/fire.db`), inaczej dane znikną przy redeploy — Render poza podłączonym dyskiem ma filesystem ephemeryczny. CI/CD leci z GitHub Actions (`.github/workflows/ci.yml` + `deploy.yml` na tag `v*`).

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

To narzędzie do planowania i nauki, **nie porada inwestycyjna ani gwarancja**. Wyniki zależą od założeń, które musisz samodzielnie zweryfikować, a model celowo pomija inflację, zmienność rynku i część realnych zasad ZUS. Decyzje finansowe podejmuj po konsultacji z doradcą.

## Autorstwo

Projekt powstał metodą *vibe-coding*: kod napisał asystent AI (opencode, model big-pickle) w trakcie interaktywnych sesji z właścicielem repozytorium (sequencer-pl), który pełnił rolę nadzoru merytorycznego, recenzenta i akceptanta — w jego imieniu i pod jego czujnym okiem. Wszelkie błędy modelowe są efektem wspólnych, czasem zbyt śmiałych, decyzji. :)

## Licencja

MIT
