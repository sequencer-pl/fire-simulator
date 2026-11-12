# ADR 0001 — strategia inwestora vs scenariusz rynkowy

Status: przyjęte (A), model docelowy (B) odłożony.

## Kontekst

Asystent ma trzy warstwy, które łatwo pomylić:

1. **Konto / opakowanie podatkowe** — IKE, IKZE, OIPE, PPK, PPE, broker, OKI.
2. **Aktywo w środku** — akcje/ETF, obligacje, lokaty, gotówka, krypto.
3. **Scenariusz rynkowy** — konserwatywny, realny, optymistyczny.

Obecny model upraszcza warstwę 1 i 2: każde konto ma jedno `default_roi`.
IKE/IKZE są więc traktowane jak konto akcyjne (domyślnie 5%), a nie jak
opakowanie, w którym można trzymać różne aktywa. Strategia wpłat zmienia
wyłącznie kolejność zapełniania kont i podział nadwyżki. Przy małej puli
wszystkie strategie wypełniają najpierw limity ulg, więc dają ten sam wynik.

`STRATEGY_ROI` był martwym kodem: `_roi()` najpierw zwracał `default_roi`
z konfiguracji, a wartości w `STRATEGY_ROI` były identyczne z presetami
scenariuszy. Użycie ich oznaczałoby podwójne liczenie ryzyka.

## Decyzja A — wdrożona

- **Strategia = sposób dzielenia wpłat**, nie profil ryzyka.
- **Scenariusze = założenia rynkowe / ROI.**
- IKE/IKZE/OIPE są opakowaniami podatkowymi; ROI ustawiamy per konto.
- `STRATEGY_ROI` usuwamy.
- Jeśli wszystkie strategie dają ten sam podział, UI pokazuje jedną
  rekomendowaną kartę i „Pokaż inne strategie” zamiast trzech identycznych
  wyborów. Karty rozwijają się, gdy pula zaczyna przekraczać limity ulg.
  Lista na karcie to 5 pierwszych pozycji dynamicznej kolejności kont,
  bez procentów i kwot; resztę pokazuje wiersz „…i N dalsze” z pełną
  kolejnością w tooltipie. Wartości zostają wyłącznie w proponowanym podziale.
- Tooltip wyjaśnia, że strategia nie zmienia ROI; za rynek odpowiadają
  scenariusze.

## Odrzucona alternatywa B — model dwuwarstwowy

Docelowo poprawniejszy model rozdziela opakowanie od aktywa:

- opakowanie decyduje o podatkach i limitach,
- aktywo decyduje o oczekiwanym ROI i ryzyku,
- strategia ustawia docelowy miks aktywów (np. konserwatywna: obligacje,
  zrównoważona: akcje/ETF, agresywna: większy udział akcji i krypto),
- scenariusz zmienia stopy zwrotu klas aktywów,
- IKE/IKZE mogą mieć inny ROI w zależności od tego, co jest w środku.

Wymagałoby to m.in. wyboru aktywa dla IKE/IKZE/OIPE (i ewentualnie PPK/PPE),
nowych pól w schematach, migracji zapisanych planów i przebudowy UI.
Największe ryzyko: podwójne liczenie ryzyka, jeśli strategia i scenariusz
niezależnie nadpiszą to samo ROI.

## Konsekwencje A

- Prostszy i uczciwszy model.
- Przy niskiej puli strategie mogą dawać identyczny podział — to oczekiwane,
  bo cała pula mieści się w ulgach.
- Użytkownik, który chce inny miks wewnątrz IKE/IKZE, może zmienić ROI konta.
- Scenariusze pozostają jedynym mechanizmem zmiany ROI.

## Konsekwencje B

- Większa precyzja i możliwość realnego modelowania profilu ryzyka.
- Większa złożoność UI i modelu; konieczne ustalenie, czy PPK/PPE też mają
  wybór aktywów i jak traktować krypto w opakowaniach emerytalnych.
- Konieczna migracja starych planów i nowe testy scenariuszy.

## Otwarte pytania na przyszłość

- **Broker vs OKI inwestycyjne — do przeglądu.** Obecnie Broker ma wyższą wagę
  w `STRATEGY_MIX` (45–50%) niż OKI inw. (15%). Uzasadnienie: wyższe założone
  ROI brokera (5,0% vs 4,5%) i podatek Belki dopiero przy wyjściu, podczas gdy
  OKI rozlicza podatek od aktywów corocznie. To założenie modelu, nie uniwersalna
  prawda rynkowa — wagi, ROI i opodatkowanie wymagają osobnej weryfikacji.
  Do czasu przeglądu zostaje Broker > OKI.
- Czy PPK/PPE powinny mieć osobny wybór aktywów, czy pozostać funduszami
  mieszanymi?
- Czy IKE/IKZE mogą w modelu trzymać krypto, czy tylko akcje/obligacje/lokaty?
- Jak migrować plany zapisane przed wprowadzeniem warstwy aktywów?
- Czy strategia ma ustawiać domyślny miks, czy tylko podpowiadać go w UI?
