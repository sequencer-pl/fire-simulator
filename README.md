# FIRE Simulator

Symulator niezależności finansowej (Financial Independence, Retire Early) — polski kalkulator przejścia na emeryturę z uwzględnieniem kont IKE, IKZE, ZUS i lokat.

## Funkcje

- **Etap akumulacji** — oszczędzanie z dopłatami rocznymi i wzrostem ROI
- **Etap realizacji** — wypłaty annuitetowe (PMT type=1, początek okresu) z buforem
- **Emerytura ZUS** — stała miesięczna, dowolna konfiguracja wieku
- **Nakładające się etapy** — jednoczesne korzystanie z wielu źródeł (np. IKE + ZUS)
- **Rosnąca emerytura** — ZUS w wielu etapach z różnymi kwotami
- **Dynamiczne konta** — toggle dla każdego źródła w każdym etapie
- **Pasywny wzrost** — konta nieobsługiwane w danym etapie rosną na poprzednim ROI
- **Majątek szczytowy** — śledzenie maximum wartości portfela

## Stack

- **Backend:** Python 3.12+, FastAPI, Pydantic
- **Frontend:** Vanilla JS, Jinja2, CSS (dark theme)
- **Zarządzanie pakietami:** [uv](https://docs.astral.sh/uv/)
- **Jakość kodu:** pytest, ruff

## Szybki start

Wymagania: [uv](https://docs.astral.sh/uv/#installation), Python 3.12+.

```bash
make setup      # tworzy .venv i instaluje zależności
make dev        # uruchamia serwer deweloperski na http://localhost:8000
```

## Makefile

| Cel | Opis |
|-----|------|
| `make setup` | Instaluje zależności (`uv sync`) |
| `make dev` | Serwer deweloperski z auto-reload |
| `make prod` | Serwer produkcyjny (0.0.0.0:8000) |
| `make test` | Testy jednostkowe (pytest) |
| `make lint` | Linter (ruff check) |
| `make format` | Formatowanie kodu (ruff format + fix) |
| `make clean` | Czyści cache i artefakty builda |

## Struktura

```
fire-simulator/
├── app/
│   ├── core/
│   │   └── pmt.py              # Funkcja PMT (annuitet)
│   ├── stages/
│   │   ├── base.py             # Abstrakcyjna klasa etapu
│   │   ├── akumulacja.py       # Etap oszczędzania
│   │   ├── realizacja.py       # Etap wypłat (PMT + ZUS)
│   │   └── registry.py         # Rejestr typów etapów + metadata
│   ├── simulation/
│   │   ├── engine.py           # Silnik symulacji
│   │   └── schemas.py          # Modele Pydantic
│   ├── web/
│   │   └── routes.py           # Trasy FastAPI + dane domyślne
│   ├── templates/
│   │   └── simulator.html      # Szablon Jinja2
│   └── main.py                 # Aplikacja FastAPI
├── static/
│   ├── css/style.css           # Dark theme + animacje
│   └── js/simulator.js         # Dynamiczny formularz + tabela
├── tests/
│   ├── test_pmt.py             # Testy funkcji PMT
│   └── test_engine.py          # Testy silnika symulacji
├── Makefile
├── pyproject.toml              # Metadata + zależności (uv)
├── uv.lock                     # Zablokowane wersje zależności
├── LICENSE                     # MIT
└── README.md
```

## Logika symulacji

### PMT (annuitet)

Wypłata roczna liczona jako annuitet na początku okresu (type=1):

```
PMT = pmt(ROI, lata_do_końca, -saldo, bufor, when=1)
```

- **ROI** — stopa zwrotu (domyślnie 2%)
- **lata_do_końca** — end_age - bieżący_wiek
- **saldo** — bieżące saldo konta
- **bufor** — kwota pozostała na koncie po wyczerpaniu PMT

### Nakładające się etapy

Silnik przetwarza wieki chronologicznie. Dla każdego roku:
1. Znajduje aktywne etapy (start ≤ wiek < end)
2. Przetwarza konta z deduplikacją (pierwszy etap wygrywa)
3. Mergeuje wypłaty i podatki
4. Raz stosuje passive growth dla kont nieobsługiwanych

### ZUS

Emerytura ZUS to stała kwota miesięczna × 12. Nie ma salda, nie ma PMT — po prostu wypłata. Może występować w wielu etapach z rosnącą kwotą.

## Testowanie

```bash
make test       # uruchamia wszystkie testy
make lint       # sprawdza styl i jakość kodu
```

## Domyślne dane

| Etap | Wiek | Konta |
|------|------|-------|
| Akumulacja | 40-45 | Broker 100k, IKE 100k, IKZE 100k |
| Broker | 45-60 | PMT z buforem 100k |
| IKE | 60-65 | PMT bez bufora |
| IKZE | 65-70 | PMT bez bufora |
| ZUS | 67-100 | Emerytura 4000 zł/mies. |

## Wdrożenie na PythonAnywhere

PythonAnywhere (free tier) nie ma uv. Z pyproject można wygenerować requirements na żądanie:

```bash
uv pip compile pyproject.toml -o requirements.txt
```

albo zainstalować projekt bezpośrednio:

```bash
pip install -e .
```

## Licencja

MIT
