# FIRE Simulator

Symulator niezależności finansowej (Financial Independence, Retire Early) — polski kalkulator przejścia na emeryturę z uwzględnieniem kont IKE, IKZE, ZUS i lokat.

## Funkcje

- **Etap akumulacji** — oszczędzanie z dopłatami rocznymi i wzrostem ROI
- **Etap realizacji** — wypłaty annuitetowe (PMT type=1, początek okresu) z buforem
- **Emerytura ZUS** — stała miesięczna, dowolna konfiguracja wieku
- **Nakładające się etapy** — jednoczesne korzystanie z wielu źródeł (np. IKE + ZUS)
- **Rosnąca emerytura** — ZUS w wielu etapach z różnymi kwotami
- **Dynamiczne konta** — toggle dla każdego źródła w każdym etapie
- **Pasjywny wzrost** — konta nieobsługiwane w danym etapie rosną na poprzednim ROI
- **Majątek szczytowy** — śledzenie maximum wartości portfela

## Stack

- **Backend:** Python, FastAPI, Pydantic
- **Frontend:** Vanilla JS, Jinja2, CSS (dark theme)
- **Hosting:** PythonAnywhere (ASGI)

## Uruchomienie

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Otwórz http://localhost:8000

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
├── requirements.txt
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

## Domyślne dane

| Etap | Wiek | Konta |
|------|------|-------|
| Akumulacja | 40-45 | Broker 100k, IKE 100k, IKZE 100k |
| Broker | 45-60 | PMT z buforem 100k |
| IKE | 60-65 | PMT bez bufora |
| IKZE | 65-70 | PMT bez bufora |
| ZUS | 67-100 | Emerytura 4000 zł/mies. |

## Licencja

MIT
