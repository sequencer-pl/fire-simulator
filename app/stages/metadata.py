"""Static stage metadata: descriptions, field hints, account info, and UI definitions.

All Polish labels and descriptions are intentionally kept as-is because they
are user-facing strings.
"""

# Canonical processing order for stages.
STAGE_ORDER = ["akumulacja", "realizacja"]

# Product descriptions and links (tooltip content on card headers).
ACCOUNT_INFO = {
    "broker": {
        "description": (
            "Zwykły rachunek maklerski. Zyski ze sprzedaży są opodatkowane 19% "
            "(podatek Belki) od nadwyżki ponad wpłacony kapitał."
        ),
    },
    "lokata": {
        "description": (
            "Lokata bankowa. Odsetki (zysk) są opodatkowane 19% ryczałtem "
            "pobieranym przez bank."
        ),
    },
    "obligacje": {
        "description": (
            "Obligacje skarbowe. Zyski (odsetki) opodatkowane 19% podatkiem "
            "Belki. Dla obligacji indeksowanych inflacją (EDO, COI) realna stopa "
            "zwrotu to marża ponad inflację."
        ),
    },
    "gotowka": {
        "description": (
            "Gotówka na rachunku, bez oprocentowania. Realnie traci na wartości "
            "wskutek inflacji (domyślnie -2,5% rocznie)."
        ),
    },
    "ike": {
        "description": (
            "Indywidualne Konto Emerytalne. Wpłaty objęte rocznym limitem; wypłaty "
            "po 60. r.ż. są całkowicie zwolnione z podatku od zysków."
        ),
    },
    "ikze": {
        "description": (
            "Indywidualne Konto Zabezpieczenia Emerytalnego. Wpłaty odliczane od "
            "dochodu (bonus podatkowy), wypłaty po 65. r.ż. opodatkowane ryczałtem "
            "10%; wcześniejszy zwrot — skalą PIT od całej kwoty."
        ),
    },
    "oipe": {
        "description": (
            "OIPE — konto emerytalne o zasadach zbliżonych do IKE: wypłaty po 60. "
            "r.ż. zwolnione z podatku od zysków, roczny limit wpłat (ok. 28 260 zł)."
        ),
    },
    "ppk": {
        "description": (
            "Pracownicze Plany Kapitałowe. Składki pracownika i pracodawcy od "
            "podstawy wynagrodzenia + dopłaty państwa: 240 zł rocznie i 250 zł "
            "powitalne. Po 60. r.ż. wypłata bez podatku od zysków."
        ),
        "url": "https://www.mojeppk.pl/",
    },
    "ppe": {
        "description": (
            "Pracowniczy Program Emerytalny. Składkę podstawową finansuje "
            "pracodawca (max 7% wynagrodzenia); uczestnik może dopłacać dodatkową "
            "składkę w ramach rocznego limitu."
        ),
        "url": "https://www.mojeppk.pl/",
    },
    "oki_inw": {
        "description": (
            "OKI inwestycyjne (od 2027) — rachunek, w którym zamiast podatku Belki "
            "od zysków płacisz roczny podatek od wartości aktywów (0,85%) ponad "
            "próg zwolnienia. Próg 100 000 zł jest wspólny dla wszystkich kont OKI; "
            "w jego ramach max 25 000 zł może przypadać na aktywa oszczędnościowe. "
            "Wypłaty w każdym wieku bez podatku od zysku."
        ),
    },
    "oki_osk": {
        "description": (
            "OKI oszczędnościowe (od 2027) — aktywa typu lokaty i obligacje skarbowe "
            "na rachunku OKI. W ramach wspólnego limitu 100 000 zł zwolniona jest "
            "część oszczędnościowa do 25 000 zł; nadwyżka podlega rocznemu podatkowi "
            "od wartości aktywów (0,85%)."
        ),
    },
    "krypto": {
        "description": (
            "Kryptowaluty. 19% od zysku przy sprzedaży za złotówki (PIT-38, FIFO); "
            "zamiany krypto→krypto są neutralne podatkowo."
        ),
    },
    "zus": {
        "description": (
            "ZUS — obowiązkowy system emerytalny. Składki 19,52% podstawy, kapitał "
            "waloryzowany; emerytura wyliczana z kapitału i tablic dalszego trwania "
            "życia (ŚDTŻ)."
        ),
        "url": "https://www.zus.pl/",
    },
}

# Short descriptive hints for form fields (tooltip text next to field labels).
FIELD_HINTS = {
    "starting_balance": "Saldo zgromadzone na starcie etapu (przenoszone między etapami).",
    "annual_contribution": "Dopłata wnoszona co roku (równymi ratami przez cały etap).",
    "roi": "Roczna stopa zwrotu (kapitalizacja odsetek/zysków raz w roku).",
    "buffer": "Kwota, która zostaje na koncie po etapie (nie jest wypłacana).",
    "monthly_base": (
        "Miesięczne wynagrodzenie brutto — podstawa wymiaru składek "
        "(ZUS/PPK/PPE) lub obliczania oszczędności podatkowej (IKZE). "
        "Domyślnie pobierane z globalnego pola \"Brutto mies.\""
    ),
    "employee_pct": "Wpłata pracownika (% podstawy, ustawowo min. 2%).",
    "employer_pct": "Wpłata pracodawcy (% podstawy, min. 1,5%, max 4%).",
    "state_topups": (
        "Dopłaty państwa: 240 zł rocznie + 250 zł powitalne "
        "w pierwszym roku akumulacji."
    ),
    "starting_balance_ofe": "Zgromadzony kapitał w OFE.",
    "ofe_member": "Członek OFE: część składki (2,92 pkt) trafia do OFE i rośnie wg ROI.",
    "waloryzacja_skladek": "Roczna waloryzacja składek zgromadzonych w ZUS.",
    "waloryzacja_swiadczenia": "Roczna waloryzacja wypłacanego świadczenia emerytalnego.",
    "monthly_pension": "Świadczenie miesięczne; 0 = wylicz z kapitału i tablic ŚDTŻ.",
    "asset_exemption": (
        "Próg zwolnienia w OKI. Konta OKI dzielą wspólny limit 100 000 zł; "
        "w jego ramach część oszczędnościowa (lokaty/obligacje) do 25 000 zł."
    ),
    "asset_tax_rate": "Roczny podatek od wartości aktywów ponad próg (OKI: 0,85%).",
    "cost_basis_enabled": (
        "Zaznacz, jeśli znasz koszty zakupu (cenę nabycia). "
        "Dzięki temu podatek 19% naliczany jest tylko od zysku, "
        "a nie od całej kwoty wypłaty."
    ),
    "cost_basis": (
        "Łączny koszt zakupu (wpłacony kapitał) — "
        "podatek zapłacisz tylko od różnicy."
    ),
    "base_override_enabled": (
        "Nadpisz globalne brutto dla tego konta. "
        "Zaznacz, jeśli używasz innej podstawy niż wpisana globalnie."
    ),
}

STAGE_META = {
    "akumulacja": {
        "label": "Akumulacja",
        "description": "Etap akumulacji kapitału - oszczędzanie i inwestowanie",
        "type": "accumulation",
        "available_accounts": {
            "broker": {
                "label": "Broker",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                        "hint": FIELD_HINTS["annual_contribution"],
                    },
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "cost_basis_enabled": {
                        "label": "Koszty zakupu",
                        "type": "checkbox",
                        "hint": FIELD_HINTS["cost_basis_enabled"],
                    },
                    "cost_basis": {
                        "label": "Koszt zakupu (zł)",
                        "type": "number",
                        "step": 1000,
                        "visible_when": "cost_basis_enabled",
                        "hint": FIELD_HINTS["cost_basis"],
                    },
                },
            },
            "ike": {
                "label": "IKE",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                        "hint": (
                            "Dopłata wnoszona co roku. Limit roczny (2026): "
                            "28 260 zł — przekroczenie to błąd konfiguracji."
                        ),
                    },
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                },
            },
            "ikze": {
                "label": "IKZE",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                        "hint": (
                            "Dopłata wnoszona co roku. Limit roczny zależy od formy "
                            "zatrudnienia: etat 11 304 zł, przedsiębiorca 16 956 zł."
                        ),
                    },
                    "base_override_enabled": {
                        "label": "Niestandardowy dochód",
                        "type": "checkbox",
                        "hint": (
                            "Nadpisz globalne brutto do obliczenia oszczędności "
                            "podatkowej IKZE (odliczenie od dochodu)."
                        ),
                    },
                    "monthly_base": {
                        "label": "Miesięczne brutto",
                        "type": "number",
                        "step": 100,
                        "hint": FIELD_HINTS["monthly_base"],
                        "visible_when": "base_override_enabled",
                    },
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                },
            },
            "oipe": {
                "label": "OIPE",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                        "hint": (
                            "Dopłata wnoszona co roku. Limit roczny (2026): "
                            "28 260 zł (3× przeciętne wynagrodzenie)."
                        ),
                    },
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                },
            },
            "oki_inw": {
                "label": "OKI inwestycyjne",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                        "hint": (
                            "Dopłata wnoszona co roku. Powyżej wspólnego limitu OKI "
                            "(100 000 zł) płacisz podatek od wartości aktywów od nadwyżki."
                        ),
                    },
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                },
            },
            "oki_osk": {
                "label": "OKI oszczędnościowe",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                        "hint": (
                            "Dopłata wnoszona co roku. W ramach wspólnego limitu OKI "
                            "zwolnienie części oszczędnościowej wynosi 25 000 zł."
                        ),
                    },
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                },
            },
            "krypto": {
                "label": "Krypto",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                        "hint": "Dopłata roczna (kupno kryptowalut za złotówki).",
                    },
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "cost_basis_enabled": {
                        "label": "Koszty zakupu",
                        "type": "checkbox",
                        "hint": FIELD_HINTS["cost_basis_enabled"],
                    },
                    "cost_basis": {
                        "label": "Koszt zakupu (zł)",
                        "type": "number",
                        "step": 1000,
                        "visible_when": "cost_basis_enabled",
                        "hint": FIELD_HINTS["cost_basis"],
                    },
                },
            },
            "ppk": {
                "label": "PPK",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "monthly_base": {
                        "label": "Wynagrodzenie (brutto)",
                        "type": "number",
                        "step": 100,
                        "hint": FIELD_HINTS["monthly_base"],
                        "visible_when": "base_override_enabled",
                    },
                    "base_override_enabled": {
                        "label": "Niestandardowa podstawa",
                        "type": "checkbox",
                        "hint": FIELD_HINTS["base_override_enabled"],
                    },
                    "employee_pct": {
                        "label": "Wpłata pracownika",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": FIELD_HINTS["employee_pct"],
                    },
                    "employer_pct": {
                        "label": "Wpłata pracodawcy",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": FIELD_HINTS["employer_pct"],
                    },
                    "state_topups": {
                        "label": "Dopłaty państwa",
                        "type": "checkbox",
                        "hint": FIELD_HINTS["state_topups"],
                    },
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                },
            },
            "ppe": {
                "label": "PPE",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "monthly_base": {
                        "label": "Wynagrodzenie (brutto)",
                        "type": "number",
                        "step": 100,
                        "hint": FIELD_HINTS["monthly_base"],
                        "visible_when": "base_override_enabled",
                    },
                    "base_override_enabled": {
                        "label": "Niestandardowa podstawa",
                        "type": "checkbox",
                        "hint": FIELD_HINTS["base_override_enabled"],
                    },
                    "employer_pct": {
                        "label": "Składka pracodawcy",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": (
                            "Składka podstawowa finansowana przez pracodawcę "
                            "(% podstawy, ustawowo max 7%)."
                        ),
                    },
                    "annual_contribution": {
                        "label": "Składka dodatkowa",
                        "type": "number",
                        "step": 1000,
                        "hint": (
                            "Dodatkowa składka uczestnika wnoszona rocznie "
                            "(limit 2026: 42 390 zł)."
                        ),
                    },
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                },
            },
            "gotowka": {
                "label": "Gotówka",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "roi": {
                        "label": "Inflacja",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": (
                            "Roczny spadek realnej wartości gotówki. Przy inflacji "
                            "2,5% wpisz -2,5."
                        ),
                    },
                },
            },
            "lokata": {
                "label": "Lokata",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "roi": {
                        "label": "Oprocentowanie",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": "Roczne oprocentowanie lokaty; odsetki opodatkowane 19%.",
                    },
                    "cost_basis_enabled": {
                        "label": "Koszty zakupu",
                        "type": "checkbox",
                        "hint": FIELD_HINTS["cost_basis_enabled"],
                    },
                    "cost_basis": {
                        "label": "Koszt zakupu (zł)",
                        "type": "number",
                        "step": 1000,
                        "visible_when": "cost_basis_enabled",
                        "hint": FIELD_HINTS["cost_basis"],
                    },
                },
            },
            "obligacje": {
                "label": "Obligacje",
                "fields": {
                    "starting_balance": {
                        "label": "Saldo startowe", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["starting_balance"],
                    },
                    "annual_contribution": {
                        "label": "Dopłata roczna",
                        "type": "number",
                        "step": 1000,
                        "hint": FIELD_HINTS["annual_contribution"],
                    },
                    "roi": {
                        "label": "ROI",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": (
                            "Roczna stopa zwrotu. Dla obligacji indeksowanych "
                            "(EDO, COI) wpisz realną marżę ponad inflację (np. 2%)."
                        ),
                    },
                    "cost_basis_enabled": {
                        "label": "Koszty zakupu",
                        "type": "checkbox",
                        "hint": FIELD_HINTS["cost_basis_enabled"],
                    },
                    "cost_basis": {
                        "label": "Koszt zakupu (zł)",
                        "type": "number",
                        "step": 1000,
                        "visible_when": "cost_basis_enabled",
                        "hint": FIELD_HINTS["cost_basis"],
                    },
                },
            },
            "zus": {
                "label": "ZUS (składki)",
                "fields": {
                    "starting_balance": {
                        "label": "Kapitał dziś",
                        "type": "number",
                        "step": 1000,
                        "hint": "Zgromadzony kapitał emerytalny (dane z eZUS).",
                    },
                    "starting_balance_ofe": {
                        "label": "Kapitał OFE",
                        "type": "number",
                        "step": 1000,
                        "visible_when": "ofe_member",
                        "hint": FIELD_HINTS["starting_balance_ofe"],
                    },
                    "monthly_base": {
                        "label": "Wynagrodzenie (brutto)",
                        "type": "number",
                        "step": 100,
                        "hint": FIELD_HINTS["monthly_base"],
                        "visible_when": "base_override_enabled",
                    },
                    "base_override_enabled": {
                        "label": "Niestandardowa podstawa",
                        "type": "checkbox",
                        "hint": FIELD_HINTS["base_override_enabled"],
                    },
                    "ofe_member": {
                        "label": "Członek OFE",
                        "type": "checkbox",
                        "hint": FIELD_HINTS["ofe_member"],
                    },
                    "roi": {
                        "label": "ROI (OFE)",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "visible_when": "ofe_member",
                        "hint": "Stopa zwrotu części kapitału zgromadzonej w OFE.",
                    },
                    "waloryzacja_skladek": {
                        "label": "Waloryzacja",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": FIELD_HINTS["waloryzacja_skladek"],
                    },
                },
            },
        },
    },
    "realizacja": {
        "label": "Realizacja",
        "description": "Etap realizacji zysków - wypłaty PMT (annuitet)",
        "type": "withdrawal",
        "available_accounts": {
            "broker": {
                "label": "Broker",
                "fields": {
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "ike": {
                "label": "IKE",
                "fields": {
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "ikze": {
                "label": "IKZE",
                "fields": {
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "oipe": {
                "label": "OIPE",
                "fields": {
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "oki_inw": {
                "label": "OKI inwestycyjne",
                "fields": {
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "oki_osk": {
                "label": "OKI oszczędnościowe",
                "fields": {
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "krypto": {
                "label": "Krypto",
                "fields": {
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "ppk": {
                "label": "PPK",
                "fields": {
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "ppe": {
                "label": "PPE",
                "fields": {
                    "roi": {
                        "label": "ROI", "type": "number", "step": 1, "percent": True,
                        "hint": FIELD_HINTS["roi"],
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "gotowka": {
                "label": "Gotówka",
                "fields": {
                    "roi": {
                        "label": "Inflacja",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": (
                            "Roczny spadek realnej wartości gotówki. Przy inflacji "
                            "2,5% wpisz -2,5."
                        ),
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "lokata": {
                "label": "Lokata",
                "fields": {
                    "roi": {
                        "label": "Oprocentowanie",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": "Roczne oprocentowanie lokaty; odsetki opodatkowane 19%.",
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "obligacje": {
                "label": "Obligacje",
                "fields": {
                    "roi": {
                        "label": "ROI",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": (
                            "Roczna stopa zwrotu. Dla obligacji indeksowanych "
                            "(EDO, COI) wpisz realną marżę ponad inflację (np. 2%)."
                        ),
                    },
                    "buffer": {
                        "label": "Bufor", "type": "number", "step": 1000,
                        "hint": FIELD_HINTS["buffer"],
                    },
                },
            },
            "zus": {
                "label": "ZUS (emerytura)",
                "fields": {
                    "monthly_pension": {
                        "label": "Emerytura mies.",
                        "type": "number",
                        "step": 1000,
                        "hint": (
                            "Świadczenie miesięczne. 0 = wylicz z kapitału i tablic "
                            "dalszego trwania życia (ŚDTŻ)."
                        ),
                    },
                    "waloryzacja_swiadczenia": {
                        "label": "Waloryzacja",
                        "type": "number",
                        "step": 1,
                        "percent": True,
                        "hint": FIELD_HINTS["waloryzacja_swiadczenia"],
                    },
                },
            },
        },
    },
}


def _inject_account_info(stage_meta: dict) -> dict:
    """Inject description/url from ACCOUNT_INFO into stage metadata."""
    for stage_cfg in stage_meta.values():
        for account_key, meta in stage_cfg.get("available_accounts", {}).items():
            info = ACCOUNT_INFO.get(account_key, {})
            if "description" in info:
                meta.setdefault("description", info["description"])
            if "url" in info:
                meta.setdefault("url", info["url"])
    return stage_meta


STAGE_META = _inject_account_info(STAGE_META)
