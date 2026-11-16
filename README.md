# FIRE Simulator

Polski symulator niezależności finansowej (*Financial Independence, Retire Early*):
ile oszczędzać, w co inwestować i jak długo, żeby móc przestać pracować w wieku X —
z podatkami, limitami i ZUS.

## Czym jest

**Modelem, nie wróżbą.** Bierze Twoje zarobki, oszczędności, wiek i założenia,
a potem pokazuje rok po roku, co z nich wynika: wpłaty, podatki, wypłaty z kont
i ZUS. Ma pomóc zrozumieć mechanikę, a nie zastąpić doradcy.

**Jest** modelem deterministycznym: pokazuje „co się stanie, jeśli”, a nie
„co będzie”. **Nie jest** poradą inwestycyjną, prognozą rynku ani gwarancją.
Nie zna przyszłej inflacji, stóp procentowych, prawa ani Twojej psychiki.
Jeśli szukasz rekomendacji „kup X, sprzedaj Y” — to nie tutaj.

## Po co powstał

Narzędzia do planowania FIRE są zwykle oparte na rynkach amerykańskich
(401k, Roth IRA, stopa wycofania 4%). W Polsce układ jest inny: ZUS, PPK, PPE,
IKE, IKZE, OIPE i OKI, skala PIT, Belka, ryczałt IKZE oraz inne progi wiekowe.
Ten projekt modeluje właśnie tę układankę:

- **polskie podatki i limity** — PIT, Belka, ryczałt IKZE, podatek od aktywów OKI;
- **ZUS liczony z kapitału** — emerytura = kapitał ÷ ŚDTŻ (tablica GUS), a nie
  „życzeniowa” kwota;
- **etapy życia** — akumulacja, sabatical, wcześniejsza emerytura, dopłata z ZUS;
- **trzy scenariusze rynkowe** — bessa, realne i hossa — zamiast jednej magicznej
  liczby.

## Główne założenia

- **Wszystko w dzisiejszych złotych.** Wyniki są realne i netto; `ROI` podajesz
  realne, brutto, przed podatkiem.
- **Model deterministyczny.** Stałe ROI, bez Monte Carlo i zmienności rynku.
  „6% średnio” nie znaczy „6% co roku”.
- **Podatki per konto.** Belka, ryczałt IKZE, skala PIT i podatek od aktywów OKI
  są liczone według zasad konta, a nie ukryte w jednej stopie zwrotu.
- **ZUS to kapitał ÷ ŚDTŻ.** Wiek emerytalny jest sugestią, nie twardą granicą;
  silnik policzy emeryturę także z wcześniejszego wieku (z ostrzeżeniem).
- **Scenariusze to delty.** „Realne” to globalny config, a bessa i hossa to
  modyfikatory względem niego — nie osobne, ukryte presety.
- **Bezstanowość.** Brak bazy, logowania i sesji; dane żyją w `localStorage`
  i plikach `.sim.json` / `.config.json`.

Pełne założenia, wyjątki i ograniczenia: [`docs/model.md`](docs/model.md).

## Co dostajesz

- **Asystent** — krok po kroku dopasowuje pytania do Twojej sytuacji i tworzy
  plan w trzech scenariuszach. Pokazuje oś czasu, etapy, Gantt wypłat i wyniki
  per konto.
- **Symulator** — pełna kontrola: etapy, konta, wpłaty, wypłaty i tabela rok
  po roku. Plany importujesz i eksportujesz jako `.sim.json`.
- **Porównywarka** — wczytaj od 1 do 4 plików `.sim.json` i porównaj wypłaty,
  podatki, majątek i strukturę etapów. Nic nie zapisujemy na serwerze.

## Obsługiwane konta

| Konto | Podatki | Uwagi |
|---|---|---|
| Broker / krypto | Belka 19% od zysku przy wypłacie | ROI brutto |
| Lokata / obligacje | Belka 19% (lokata: co okres) | ROI brutto |
| Gotówka | brak | domyślnie traci tyle, ile wynosi inflacja |
| IKE | 0% po 60 r.ż.; przed 60 Belka 19% od zysku | limit wpłat |
| IKZE | 10% po 65 r.ż.; przed 65 skala PIT od całości | ulga w roku wpłaty |
| PPK / PPE | 0% po 60 r.ż.; przed 60 ograniczenia | składki pracodawcy i państwa |
| OIPE | 0% po 60 r.ż. | limit wpłat jak IKE; dziś funduszowe |
| OKI (inw./osk.) | podatek od aktywów 0,85% | wspólny limit 100 tys. zł / 25 tys. zł |
| ZUS | skala PIT przy wypłacie | kapitał ÷ ŚDTŻ (projekcja GUS) |

## Szybki start

Wymagania: [uv](https://docs.astral.sh/uv/) i Python 3.12+.

```bash
make setup
make dev
```

Otwórz [http://localhost:8000/wizard](http://localhost:8000/wizard).
Produkcja: `make prod` albo `PORT=... make prod-port`.
Szczegóły pracy z kodem, testów i deployu: [`AGENTS.md`](AGENTS.md).

## Dokumentacja

- [`AGENTS.md`](AGENTS.md) — praca z kodem, testy, architektura, deploy.
- [`DESIGN.md`](DESIGN.md) — system wizualny, komponenty i słowniczek.
- [`docs/model.md`](docs/model.md) — pełne założenia i ograniczenia modelu.
- `app/simulation/config.py` — źródło prawdy dla stawek, limitów, ROI i presetów.

## Zastrzeżenie

To narzędzie do myślenia, nie do wróżenia. **Nie jest poradą inwestycyjną ani
gwarancją.** Wyniki zależą od założeń, które musisz samodzielnie zweryfikować.
Model celowo upraszcza rzeczywistość: zakłada stałe ROI, uproszczony ZUS i pomija
zmienność rynku oraz część realnych zasad. Decyzje finansowe podejmuj z głową —
najlepiej z doradcą, który zna Twoją sytuację.

## Autorstwo

Projekt powstał metodą *vibe-coding*: kod napisali asystenci AI (opencode — różne
modele w kolejnych sesjach) w trakcie interaktywnych sesji z właścicielem
repozytorium (sequencer-pl), który pełnił rolę nadzoru merytorycznego, recenzenta
i akceptanta — w jego imieniu i pod jego czujnym okiem. Wszelkie błędy modelowe
są efektem wspólnych, czasem zbyt śmiałych, decyzji. :)

## Licencja

MIT
