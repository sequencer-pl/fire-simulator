# Model i założenia

Ten dokument opisuje, co symulator modeluje, a czego nie. README trzyma tylko
skrót; tutaj są pełne założenia, wyjątki i ograniczenia.

## 1. Wszystko w dzisiejszych złotych

Silnik przechowuje i pokazuje wyniki w sile nabywczej (realnie). `ROI` podajesz
**realne (ponad inflacją), brutto — przed podatkiem**. Inflacja nie jest
doliczana do wzrostu kont; wchodzi tylko w:

- nominalną Belkę od zysku (broker, IKE/PPK/PPE przed progami) i mechanikę lokaty,
- erozję gotówki (`ROI = -inflacja`),
- waloryzację ZUS i indeksację kapitału,
- indeksację progów PIT, kwoty wolnej, KUP i progu daniny — domyślnie **1,5%**
  (scenariusz Realne). Bessa obniża ją do 1,0%, hossa ustawia pełną indeksację
  (`None`).

Ryczałt IKZE i skala PIT liczą się od realnych kwot. Podatek od aktywów OKI jest
liczony od realnego salda (uproszczenie).

## 2. ROI realne, brutto, stałe

`ROI` to średnioroczny zwrot **przed** podatkiem od wypłat. Silnik nalicza podatek
według zasad konta (Belka, ryczałt, skala PIT). Wyjątki:

- **lokata** — Belka 19% pobierana co okres; silnik przelicza ROI na nominalne
  brutto i urealnia,
- **OKI** — ROI przed rocznym podatkiem od aktywów (0,85%),
- **gotówka** — ROI = `-inflacja`,
- **ZUS** — waloryzacja, nie ROI; emerytura netto po 9% składce zdrowotnej.

Przykład: lokata 5% realnie brutto, inflacja 0% → po Belce 19% zostaje 4,05%
realnie. Przy inflacji 2,5% nominalne brutto ≈7,63%, po Belce ≈6,18% nominalnie,
czyli ≈3,59% realnie. Nie ma zmienności rynku: 6% średnio nie znaczy 6% co roku.

## 3. Emerytura ZUS = kapitał ÷ ŚDTŻ(GUS)

Emeryturę liczymy jako zgromadzony kapitał podzielony przez tablicę średniego
dalszego trwania życia. Bazą jest oficjalna tablica GUS 2026; dla emerytury
w późniejszym roku tabela jest wydłużana o `longevity.growth_months_per_year`
(domyślnie **1,5 mies./rok**). To **projekcja**, nie oficjalna tabela na dany rok.

Tablica jest **wspólna dla obu płci** (GUS publikuje jedną; zróżnicowanie usunął
wyrok TK K 1/13). Płeć zmienia jedynie **wiek emerytalny: kobiety 60, mężczyźni
65**. Silnik nie sprawdza warunków stażowych ani nie wyrównuje do emerytury
minimalnej — o tym tylko ostrzega.

## 4. Wiek emerytalny to sugestia

Silnik policzy emeryturę z dowolnego wieku (np. 55), bo „przed 60/65 realnie
świadczenie nie przysługuje” — dostaniesz ostrzeżenie, ale wynik się pojawi.
Traktuj go jako poglądowy.

## 5. Wypłaty przed wiekiem uprawniającym

Wypłaty przed progami kosztują i nie zawsze da się je zamodelować w 100%:

- **IKE przed 60** — Belka 19% od zysku (zamodelowane);
- **IKZE przed 65** — jednorazowe opodatkowanie całości skalą PIT; netto jest
  reinwestowane w konto docelowe (auto: IKE/OIPE do limitu, jeśli są w etapie,
  potem obligacje → lokata → OKI oszczędnościowe → broker → gotówka; **nigdy
  krypto**);
- **PPK przed 60** — środki pracodawcy i dopłaty państwa przepadają, podatek Belki
  od zysku tylko na części pracownika;
- **PPE przed 60** — 30% składek podstawowych pracodawcy trafia do ZUS subkonto.

## 6. Bufor to wartość końcowa, nie „poduszka”

PMT wylicza wypłatę tak, by na koniec etapu zostało dokładnie `bufor` złotych.
Chcesz zachować kapitał na później → wpisz go w bufor; chcesz przejeść wszystko
→ 0.

## 7. OKI (od 2027 r.)

Zamiast Belki coroczny podatek od wartości aktywów (0,85%) od średniego stanu
ponad **wspólny limit 100 000 zł** dla wszystkich kont OKI, z czego max
25 000 zł na część oszczędnościową (lokaty/obligacje). Podatek płacisz
niezależnie od zysku lub straty. Wypłaty nie podlegają Belce. Zamodelowane
wprost.

## 8. ZUS w akumulacji

ZUS rośnie przez waloryzację (domyślnie 1%/rok), nie przez ROI — plus składka
19,52% od podstawy do limitu 30× przeciętnego wynagrodzenia. Członkowie OFE mają
rozdzielany strumień: 2,92 pkt do OFE (rośnie z ROI), reszta waloryzowana w ZUS.

## 9. Horyzont i długowieczność

Domyślny horyzont Asystenta = oczekiwana długość życia (GUS 2024, wg płci)
powiększona o skumulowany wzrost długowieczności
(`longevity.growth_months_per_year`). To przybliżenie kohortowe: każdy pozostały
rok życia wydłuża się o założoną liczbę miesięcy. Użytkownik może nadpisać
horyzont suwakiem.

## 10. Asystent a Konfiguracja

Globalny config jest bazą scenariusza „Realne”. Bessa i hossa to **delty
względem tej bazy** (inflacja, ROI kont, waloryzacja ZUS), a nie osobne presety.
Jeśli użytkownik zapisał własną konfigurację, scenariusze przesuwają właśnie jej
wartości. Wbudowane presety to tylko `Domyślny 2026` i `Domyślny 2027`.

Pierwsza ręczna zmiana w Konfiguracji przełącza select presetu na „Własna
konfiguracja”, a przywrócenie wszystkich wartości wraca do nazwy presetu.
Konfiguracja jest zapisywana lokalnie (`localStorage`, klucz `fire.config`)
i Asystent używa jej przez `base_config`.

## 11. Scenariusze rynkowe

- **Kryzys / bessa** — słaby rynek przez cały horyzont, nie jednorazowy krach:
  akcje **0% realnie**, fundusze i PPK/PPE **+0,5%**, obligacje **+0,5%**,
  lokaty i OKI oszczędnościowe **0%**, nieruchomość **0%**, ZUS/OFE **+1%**,
  krypto **−8% realnie**. Gotówka traci tyle, ile wynosi inflacja.
- **Realne / bazowe** — globalny default: akcje **3,5% realnie**, fundusze,
  PPK/PPE i OKI inwestycyjne **+3,0%**, krypto **0%**, obligacje **+1,5%**,
  lokaty, OKI oszczędnościowe i nieruchomość **+1,0%**, ZUS/OFE **+3,0%**.
- **Hossa / optymistyczne** — mocniejszy rynek: wyższe ROI akcji, krypto
  i aktywów rynkowych, niższa inflacja i mocniejsza waloryzacja ZUS.

To założenia scenariuszowe, nie prognozy. Przez procent składany „Realne” nie
jest środkiem wypłat — wynik jest bliżej bessy niż hossy.

## 12. Limity wpłat

**2026:** IKE 28 260 zł, IKZE 11 304 zł (16 956 zł samozatrudnieni), OIPE
28 260 zł, składka dodatkowa PPE 42 390 zł.

**2027:** IKE i OIPE 30 099 zł, IKZE 12 039,60 zł (18 059,40 zł dla działalności
gospodarczej), PPE — składki dodatkowe 45 148,50 zł, limit 30-krotności ZUS
300 990 zł. Preset `Domyślny 2027` używa progów PIT 130/150 tys. i stawek
12/24/32%.

Przekroczenie limitu to ostrzeżenie, nie automatyczne obcięcie — dopłaty ponad
limit po prostu „wchodzą” i tracą sens podatkowy.

## 13. Nakładające się etapy

Dla danego konta wygrywa pierwszy etap. Konta nieobsługiwane w danym roku rosną
pasywnie z ostatnim znanym ROI (domyślnie 2%).

## 14. Czego model nie robi

- Nie przewiduje rynku, inflacji, stóp procentowych ani zmian prawa.
- Nie jest Monte Carlo — nie losuje ścieżek zwrotu.
- Nie modeluje psychiki, nieprzewidzianych wydatków ani decyzji życiowych.
- Nie zastępuje doradcy podatkowego ani finansowego.
- Nie gwarantuje, że ZUS, PPK/PPE, IKE/IKZE/OIPE i OKI będą działać tak samo
  za 20–30 lat.

To model do myślenia „co się stanie, jeśli”, nie do wróżenia.
