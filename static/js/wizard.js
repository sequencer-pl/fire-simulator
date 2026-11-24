// wizard.js — Asystent FIRE: drzewo kroków, B2B, Coast/Barista FIRE.
// Wymaga: helpers.js, icons.js, sim-utils.js, controls.js, sim-metadata.js.

const WZ_STATE_KEY = "fire.wizardState";
const WZ_PLAN_KEY = "fire.wizardPlan";
const WZ_CONFIG_KEY = "fire.config";
const WZ_LEGACY_CONFIG_KEY = "fire.config.anonymous";
const WZ_LEGACY_STATE_KEY = "fire.wizardV2State";
const WZ_LEGACY_PLAN_KEY = "fire.wizardV2Plan";
const WZ_TINY_CASH_ANNUAL = 120;
const WZ_STATE_SAVE_MS = 150;
// Wersje cache'y w localStorage. Niezgodne wpisy odrzucamy, żeby po zmianie
// schematu stary stan nie nadpisywał nowego planu.
const WZ_STATE_VERSION = 2;
const WZ_PLAN_VERSION = 2;
const WZ_DRAFT_VERSION = 2;

const WZ_RETIREMENT_DEFAULT = { k: 60, m: 65 };

// Średnie dalsze trwanie życia (lata) wg wieku i płci — GUS, tablica 2024.
// Domyślny horyzont = obecny wiek + wartość z tabeli, powiększona o
// prognozowany wzrost długowieczności z konfiguracji.
const WZ_LIFE_EXPECTANCY = {
    m: {
        16: 59.4, 17: 58.4, 18: 57.4, 19: 56.5, 20: 55.5,
        21: 54.5, 22: 53.5, 23: 52.6, 24: 51.6, 25: 50.7,
        26: 49.7, 27: 48.8, 28: 47.8, 29: 46.9, 30: 45.9,
        31: 45.0, 32: 44.0, 33: 43.1, 34: 42.2, 35: 41.2,
        36: 40.3, 37: 39.4, 38: 38.5, 39: 37.5, 40: 36.6,
        41: 35.7, 42: 34.8, 43: 33.9, 44: 33.0, 45: 32.1,
        46: 31.2, 47: 30.4, 48: 29.5, 49: 28.6, 50: 27.8,
        51: 26.9, 52: 26.1, 53: 25.2, 54: 24.4, 55: 23.6,
        56: 22.8, 57: 22.1, 58: 21.3, 59: 20.5, 60: 19.8,
        61: 19.1, 62: 18.4, 63: 17.7, 64: 17.0, 65: 16.3,
        66: 15.7, 67: 15.0, 68: 14.4, 69: 13.8, 70: 13.2,
        71: 12.6, 72: 12.1, 73: 11.5, 74: 10.9, 75: 10.4,
        76: 9.9, 77: 9.4, 78: 8.8, 79: 8.4, 80: 7.9,
        81: 7.4, 82: 7.0, 83: 6.5, 84: 6.1, 85: 5.7,
        86: 5.4, 87: 5.0, 88: 4.7, 89: 4.4, 90: 4.2,
    },
    k: {
        16: 66.6, 17: 65.6, 18: 64.7, 19: 63.7, 20: 62.7,
        21: 61.7, 22: 60.7, 23: 59.7, 24: 58.8, 25: 57.8,
        26: 56.8, 27: 55.8, 28: 54.8, 29: 53.8, 30: 52.8,
        31: 51.9, 32: 50.9, 33: 49.9, 34: 48.9, 35: 48.0,
        36: 47.0, 37: 46.0, 38: 45.0, 39: 44.1, 40: 43.1,
        41: 42.1, 42: 41.2, 43: 40.2, 44: 39.3, 45: 38.3,
        46: 37.4, 47: 36.4, 48: 35.5, 49: 34.5, 50: 33.6,
        51: 32.6, 52: 31.7, 53: 30.8, 54: 29.9, 55: 29.0,
        56: 28.1, 57: 27.2, 58: 26.3, 59: 25.4, 60: 24.5,
        61: 23.7, 62: 22.8, 63: 22.0, 64: 21.1, 65: 20.3,
        66: 19.5, 67: 18.7, 68: 17.9, 69: 17.1, 70: 16.4,
        71: 15.6, 72: 14.9, 73: 14.1, 74: 13.4, 75: 12.7,
        76: 12.0, 77: 11.4, 78: 10.7, 79: 10.1, 80: 9.4,
        81: 8.8, 82: 8.3, 83: 7.7, 84: 7.2, 85: 6.7,
        86: 6.2, 87: 5.8, 88: 5.4, 89: 5.0, 90: 4.6,
    },
};

const WZ_SHELTERS = [
    { account: "ike", label: "IKE" },
    { account: "ikze", label: "IKZE" },
    { account: "oipe", label: "OIPE" },
];

const WZ_SAFE_BASES = ["lokata", "obligacje", "gotowka"];
const WZ_MARKET_BASES = ["broker", "krypto"];
const WZ_ALLOCATABLE_ACCOUNTS = [
    "ikze",
    "ike",
    "oipe",
    "broker",
    "obligacje",
    "oki_inw",
    "oki_osk",
    "lokata",
    "krypto",
];
const WZ_WRAPPER_ACCOUNTS = ["ike", "ikze", "oipe"];
const WZ_VEHICLE_LABELS = {
    broker: "Maklerskie",
    fund: "Funduszowe",
    savings: "Oszczędnościowe",
};
const WZ_VEHICLE_HINTS = {
    broker: "Akcje/ETF, samodzielne decyzje, wyższe oczekiwane ROI.",
    fund: "Fundusze lub portfel zarządzany, wyższe opłaty. OIPE jest dziś funduszowe.",
    savings: "Lokaty, obligacje i fundusze obligacji — bezpieczna część portfela.",
};

const WZ_SALARY_IDS = new Set([
    "wzEtatSalary",
    "wzEtatSalaryRange",
    "wzB2bSalary",
    "wzB2bSalaryRange",
    "wzB2bCustomZus",
    "wzB2bCustomZusRange",
    "wzPpkEmployeePct",
    "wzPpkEmployerPct",
    "wzPpeEmployerPct",
]);

const WZ_SALARY_NAMES = new Set([
    "wzEtatSalaryMode",
    "wzEtatPeriod",
    "wzPpkState",
    "wzPpeState",
    "wzB2bSalaryMode",
    "wzB2bTaxForm",
    "wzB2bLumpRate",
    "wzB2bZusMode",
]);

const WZ_PLAN_LOADER_TIPS = [
    // Cierpliwość, czas i oczekiwanie

    "Procent składany wynagradza cierpliwość. Loader na razie tylko ją testuje.",
    "Plan FIRE to maraton, nie sprint. Szkoda tylko, że maraton nie ma opcji pominięcia pierwszych 30 kilometrów.",
    "Nie chodzi o szybki zysk. Chodzi o to, żeby nie musieć się spieszyć.",
    "Czas w rynku bije timing rynku. Przynajmniej w teorii, którą wyjątkowo łatwo zrozumieć na wykresie historycznym.",
    "Cierpliwość jest jak procent składany: początkowo niewidoczna, potem robi całą robotę.",
    "Spokojnie. Twoja wolność finansowa nie przyjdzie szybciej tylko dlatego, że patrzysz na pasek postępu.",
    "Dobre decyzje finansowe potrzebują czasu. Na szczęście nie musisz podejmować ich wszystkich dzisiaj.",
    "Nie ma trybu instant na niezależność finansową. Jest dobra mapa, konsekwencja i trochę szczęścia.",
    "Każdy chce efektów procentu składanego. Mało kto ma cierpliwość, żeby uzbierać potrzebny mu kapitał.",
    "Symulacja trwa sekundy. Oszczędzanie — lata.",
    "Za chwilę zobaczysz wynik symulacji, ale nie zobaczysz przyszłości.",
    "Za chwilę zobaczysz trzy scenariusze. Żaden nie jest przepowiednią.",
    "Ten symulator działa znacznie szybciej niż procent składany.",
    "Wynik — za chwilę. Konsekwencje — za dwadzieścia lat.",
    "Ten pasek postępu nie ma nic wspólnego z postępem Twojego portfela.",

    // Pieniądze i życie

    "Pieniądze szczęścia nie dają. Ale ich brak potrafi bardzo skutecznie je odebrać.",
    "Możesz mieć wszystko, czego chcesz. Problem w tym, że wtedy nie będziesz mieć pieniędzy.",
    "Nie musisz być bogaty. Wystarczy, że nie będziesz musiał udawać, że lubisz poniedziałki.",
    "Luksus to niekoniecznie drogi samochód. Czasem luksusem jest możliwość powiedzenia szefowi, co naprawdę o nim myślisz.",
    "Nie odkładasz życia na później. Próbujesz kupić sobie możliwość decydowania o nim wcześniej.",
    "Nie oszczędzasz po to, żeby umrzeć z największym portfelem. To byłaby dość kiepska strategia.",

    // Czas i rynek

    "Inwestowanie długoterminowe jest trudne głównie dlatego, że jest długoterminowe.",
    "Każdy potrafi czytać wykres w lewo.",
    "Długi horyzont nie naprawi złej strategii. Da Ci tylko więcej czasu na obserwowanie jej porażki.",
    "Nikt nie wie, kiedy rynek spadnie. Ci, którzy twierdzą inaczej, zwykle sprzedają szkolenia.",
    "Rynek nie wie, że istniejesz. I całe szczęście, bo nie musisz mu niczego udowadniać.",
    "Kupowanie tanio i sprzedawanie drogo brzmi banalnie. Dlatego większość ludzi robi dokładnie odwrotnie.",
    "Giełda jest jedynym miejscem, w którym ludzie uciekają ze sklepu, gdy przeceny są największe.",
    "Nie musisz pokonać rynku. Wystarczy, że nie pokonasz sam siebie.",
    "Trudno jest prognozować, szczególnie jeśli prognozy te dotyczą przyszłości.",
    "Tym razem jest inaczej. Najdroższe zdanie w historii inwestowania.",
    "Najlepszy moment na inwestowanie był wczoraj. Drugi najlepszy to wtedy, kiedy przestaniesz szukać najlepszego momentu.",

    // Ryzyko i niepewność

    "Każdy plan opiera się na założeniach. Przyszłość ma jednak irytujący zwyczaj, żeby ich nie przestrzegać.",
    "ROI z symulacji nie jest obietnicą. Jest hipotezą, dopóki rynek nie powie: sprawdzam.",
    "Zmienność to nie usterka rynku, tylko koszt uczestnictwa w nim.",
    "Dywersyfikacja nie eliminuje strat. Ogranicza ryzyko, że jedna zła decyzja pociągnie za sobą wszystko.",
    "Poduszka finansowa nie pracuje na Twój zysk. Pracuje na to, żebyś nie musiał podejmować desperackich decyzji.",
    "Spadek o 50% wymaga wzrostu o 100%, żeby wrócić do punktu wyjścia.",
    "Historyczna stopa zwrotu mówi, co się wydarzyło, a nie co się stanie.",
    "Jeśli nie znasz swojego horyzontu, każdy spadek wygląda jak katastrofa.",
    "Jeśli Twój plan zakłada ROI 15% rocznie, to może zamiast symulować FIRE, zasymuluj jednorożca.",
    "Jeśli plan działa wyłącznie przy optymistycznych założeniach, to nie jest plan. To życzenie z Excela.",
    "Ryzyko rynkowe możesz ograniczyć, trzymając gotówkę. Wtedy zaczynasz martwić się inflacją. Ryzyko nie lubi bezrobocia.",

    // Podatki i polskie realia

    "IKE i IKZE nie są magicznymi maszynkami do zarabiania. Ich przewaga tkwi w podatkach.",
    "Inflacja nie zabiera Ci banknotów. Zabiera to, co możesz za nie kupić.",
    "Podatki są pewne. Stopy zwrotu już niekoniecznie.",

    // Zachowanie i psychologia

    "Twój największy koszt inwestycyjny to nie prowizja. To decyzje pod wpływem emocji.",
    "Nie potrzebujesz perfekcyjnej strategii. Potrzebujesz takiej, której nie porzucisz po pierwszym spadku.",
    "Wybór strategii jest łatwy. Trudniej jest jej nie zmieniać co tydzień.",
    "Podnoszenie standardu życia wraz z pensją to inflacja, którą tworzysz sam.",
    "Oglądanie portfela codziennie nie zwiększa stopy zwrotu.",
    "Zmiana strategii po każdym spadku to też strategia, tylko kosztowna.",
    "Czasem najlepszą decyzją inwestycyjną jest nie robić nic. Dla niektórych okazuje się to zadaniem ekstremalnie trudnym.",
    "Człowiek potrafi racjonalizować niemal każdą decyzję. Szczególnie tę, którą już podjął.",
    "Nie każda zachcianka jest problemem. Problem zaczyna się wtedy, gdy każdą zachciankę nazywasz potrzebą.",
    "Najłatwiej wydaje się pieniądze, których nie widzimy. Dlatego karta kredytowa jest tak doskonałym wynalazkiem.",
    "Nie jesteś Warrenem Buffettem. I prawdopodobnie nie musisz nim być, żeby osiągnąć swój cel.",
    "Twój portfel nie potrzebuje emocjonalnego wsparcia. Potrzebuje, żebyś dał mu święty spokój.",
    "Jeśli strategia wymaga codziennego sprawdzania, czy nadal działa, być może to nie strategia, tylko źródło stresu.",

    // FIRE i niezależność finansowa

    "FIRE to nie moment, w którym przestajesz pracować. To moment, w którym przestajesz musieć pracować.",
    "Twoja stopa oszczędności jest ważniejsza niż stopa zwrotu z ostatniego miesiąca.",
    "Wiek FIRE to wynik oszczędności, nie odwagi.",
    "Im niższe wydatki, tym mniej kapitału potrzebujesz. Wydatki zmienisz szybciej niż stopę zwrotu.",
    "Celem nie jest emerytura w wieku 40 lat. Celem jest możliwość niepracowania w wieku 40 lat. To spora różnica.",
    "Wolność finansowa nie oznacza, że nie musisz nic robić. Oznacza, że nie musisz robić rzeczy, których nie chcesz.",
    "Możesz pracować do siedemdziesiątki. To też jest strategia. Niekoniecznie dobra, ale matematycznie dopuszczalna.",

    // Wpłaty a procent składany

    "Na początku oszczędzania liczą się wpłaty, nie stopa zwrotu. Dołożenie 1 000 zł do 1 000 zł podwaja kapitał.",
    "Przy 1 000 000 zł kapitału nawet 2% zwrotu daje więcej niż kolejne 1 000 zł odłożone z pensji.",
    "Przy małym kapitale liczy się każda wpłata. Przy dużym — każdy ułamek procenta.",
    "Na pierwszy milion w portfelu FIRE w większości zapracują wpłaty. Na kolejne — procent składany.",

    // Bezczelności i finansowe otrzeźwienie

    "Możesz próbować pokonać inflację, rynek i podatki. Ale jeśli przegrasz z własnym budżetem, cała reszta nie ma znaczenia.",
    "Możesz przejść na emeryturę w wieku 35 lat. Wystarczy, że odziedziczysz kilka milionów.",
    "Nie każda osoba z drogim zegarkiem jest bogata. Niektóre po prostu mają drogi zegarek.",
    "Rynek może pozostać nieracjonalny dłużej, niż Ty pozostaniesz wypłacalny.",
];

let wzInitialized = false;
let wzCurrentStep = "cel";
let wzPlan = null;
let wzPlanSignature = "";
let wzPlanBodyCache = null;
let wzPlanSeq = 0;
let wzPlanLoading = false;
let wzSelectedScenario = "realne";
let wzSuggested = null;
let wzSuggestSignature = "";
let wzSuggestSeq = 0;
let wzSuggestTimer = null;
let wzSuggestLoading = false;
let wzSalaryPreview = null;
let wzSalaryPreviewCache = Object.create(null);
let wzSalarySeq = 0;
let wzSalaryTimer = null;
let wzSalaryRetryTimer = null;
let wzSalaryRetries = 0;
let wzRetirementTouched = false;
let wzPlanEndTouched = false;
let wzSalaryTouched = false;
let wzPayrollRatesTouched = false;
let wzStrategyExpanded = false;
let wzLongevityGrowth = 1.5;
let wzEtatPeriodPrev = "year";
let wzFormVersion = 0;
let wzAccountConfig = null;
let wzAllocationMode = "auto";
let wzManualAllocations = null;
let wzManualVehicles = {};
let wzLoaderTimer = null;
let wzLoaderTipBag = [];
let wzLoaderLastTip = "";
let wzStateReady = false;
let wzRestoring = false;
let wzStateTimer = null;
const wzFullResults = new Map();
let wzFullResultsSignature = "";
let wzFullResultSeq = 0;

// --- Małe helpery -----------------------------------------------------------

function wzEl(id) {
    return document.getElementById(id);
}

function wzRadio(name, fallback = null) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : fallback;
}

function wzNum(id, fallback = 0) {
    const el = wzEl(id);
    const value = parseFloat(el?.value);
    return Number.isFinite(value) ? value : fallback;
}

function wzInt(id, fallback = 0) {
    return Math.round(wzNum(id, fallback));
}

function wzCurrentPath() {
    return parseInt(wzRadio("wzPath", "1"), 10) || 1;
}

function wzEmployment() {
    return wzRadio("wzEmployment", "etat");
}

function wzBaseKey(account) {
    if (typeof baseAccountKey === "function") return baseAccountKey(account);
    if (account === "zus:ofe") return account;
    return String(account).split(":")[0];
}

function wzAccountLabel(account, customName = "") {
    if (typeof accountDisplayLabel === "function") {
        return accountDisplayLabel(account, customName);
    }
    return customName || account;
}

function wzAccountIcon(account) {
    if (typeof accountIconFor === "function") return accountIconFor(account);
    return "";
}

function wzWrapperVehiclesConfig() {
    return wzAccountConfig?.wrapper_vehicles || {};
}

function wzAllowedVehicles(wrapper) {
    const configured = wzAccountConfig?.wrapper_vehicle_options?.[wrapper];
    if (Array.isArray(configured) && configured.length) return configured;
    const keys = Object.keys(wzWrapperVehiclesConfig());
    if (keys.length) return keys;
    return wrapper === "oipe" ? ["fund"] : ["broker", "fund", "savings"];
}

function wzVehicleLabel(vehicle) {
    return wzWrapperVehiclesConfig()?.[vehicle]?.label
        || WZ_VEHICLE_LABELS[vehicle]
        || vehicle;
}

function wzVehicleRoi(vehicle) {
    const roi = Number(wzWrapperVehiclesConfig()?.[vehicle]?.default_roi);
    return Number.isFinite(roi) ? roi : null;
}

function wzVehicleRisk(vehicle) {
    return wzWrapperVehiclesConfig()?.[vehicle]?.risk_class || "market";
}

function wzDefaultVehicleFor(wrapper, profile = wzRiskProfile()) {
    const allowed = wzAllowedVehicles(wrapper);
    const preferences = profile === "spokojny"
        ? ["savings", "fund", "broker"]
        : ["broker", "fund", "savings"];
    return preferences.find((vehicle) => allowed.includes(vehicle)) || allowed[0] || null;
}

function wzApplyVehiclesToCapitalRows() {
    WZ_WRAPPER_ACCOUNTS.forEach((wrapper) => {
        const input = wzWrapperCapitalRoiInput(wrapper);
        if (!input || input.dataset.roiEdited === "true") return;
        const roi = wzVehicleRoi(wzManualVehicleFor(wrapper));
        if (roi != null) {
            input.value = (roi * 100).toFixed(1);
            input.dataset.defaultRoi = input.value;
            wzSyncRoiReset(input);
        }
    });
}

function wzSeedManualVehicles() {
    if (!Object.keys(wzManualVehicles).length) {
        const suggested = wzSuggested?.wrapperVehicles || {};
        const profile = wzRiskProfile();
        WZ_WRAPPER_ACCOUNTS.forEach((wrapper) => {
            const allowed = wzAllowedVehicles(wrapper);
            const vehicle = suggested?.[wrapper];
            const chosen = allowed.includes(vehicle) ? vehicle : wzDefaultVehicleFor(wrapper, profile);
            if (chosen) wzManualVehicles[wrapper] = chosen;
        });
    }
    wzApplyVehiclesToCapitalRows();
}

function wzManualVehicleFor(wrapper) {
    const allowed = wzAllowedVehicles(wrapper);
    const current = wzManualVehicles?.[wrapper];
    if (allowed.includes(current)) return current;
    return wzDefaultVehicleFor(wrapper) || allowed[0] || null;
}

function wzVehicleOptionsHtml(wrapper) {
    const current = wzManualVehicleFor(wrapper);
    return wzAllowedVehicles(wrapper).map((vehicle) => (
        `<option value="${vehicle}" title="${escapeHtml(WZ_VEHICLE_HINTS[vehicle] || "")}" ${vehicle === current ? "selected" : ""}>${escapeHtml(wzVehicleLabel(vehicle))}</option>`
    )).join("");
}

function wzWrapperCapitalRoiInput(wrapper) {
    return document.querySelector(
        `#wzSheltersList .wz-cap-row[data-account="${wrapper}"] .wz-cap-roi`
    );
}

function wzWrapperRoiOverride(wrapper) {
    const input = wzWrapperCapitalRoiInput(wrapper);
    if (input?.dataset.roiEdited !== "true") return null;
    const value = parseFloat(input.value);
    return Number.isFinite(value) ? value / 100 : null;
}

function wzEffectiveWrapperRoi(wrapper) {
    return wzWrapperRoiOverride(wrapper) ?? wzVehicleRoi(wzManualVehicleFor(wrapper));
}

function wzVehicleRoiNote(wrapper) {
    const roi = wzEffectiveWrapperRoi(wrapper);
    if (roi == null) return "";
    const own = wzWrapperRoiOverride(wrapper) != null ? " (własne)" : "";
    return `ROI ${(roi * 100).toFixed(1).replace(".", ",")}%/rok${own}`;
}

function wzSetValue(id, value) {
    const el = wzEl(id);
    if (el) el.value = String(value);
}

function wzSyncRange(rangeId, inputId) {
    const range = wzEl(rangeId);
    const input = wzEl(inputId);
    if (!range || !input) return;
    input.addEventListener("input", () => {
        range.value = input.value;
    });
    range.addEventListener("input", () => {
        input.value = range.value;
    });
}

function wzPostJson(url, body, errorLabel) {
    return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }).then(async (res) => {
        let data = null;
        try {
            data = await res.json();
        } catch {
            data = {};
        }
        if (!res.ok) {
            let msg = data.detail;
            if (Array.isArray(msg)) {
                msg = msg.map((d) => d.msg || JSON.stringify(d)).join("; ");
            }
            const error = new Error(msg || errorLabel);
            error.status = res.status;
            error.retryAfter = res.headers?.get?.("Retry-After") || null;
            throw error;
        }
        return data;
    });
}

function wzAnonymousConfig() {
    try {
        const raw = localStorage.getItem(WZ_CONFIG_KEY)
            || localStorage.getItem(WZ_LEGACY_CONFIG_KEY);
        if (!raw) return null;
        const payload = JSON.parse(raw);
        if (!payload || typeof payload !== "object" || !payload.config) return null;
        if (!localStorage.getItem(WZ_CONFIG_KEY)) {
            localStorage.setItem(WZ_CONFIG_KEY, raw);
            localStorage.removeItem(WZ_LEGACY_CONFIG_KEY);
        }
        return payload.config;
    } catch {
        return null;
    }
}

function wzDefaultAccountRoi(account) {
    const rules = wzAccountConfig?.accounts?.[wzBaseKey(account)];
    const roi = Number(rules?.default_roi);
    return Number.isFinite(roi) ? roi : null;
}

function wzFormatRoiInput(roi) {
    return (roi * 100).toFixed(1);
}

function wzSeedManualAllocations() {
    if (wzManualAllocations !== null) return;
    // Manual startuje od zera: cała pula jest w gotówce, dopóki użytkownik
    // nie ustawi udziałów albo nie użyje kafla „Zacznij od propozycji”.
    wzManualAllocations = Object.fromEntries(
        WZ_ALLOCATABLE_ACCOUNTS.map((account) => [account, 0])
    );
}

function wzAssetMixForShares(shares) {
    const mix = { safe: 0, market: 0, high: 0 };
    Object.entries(shares || {}).forEach(([account, value]) => {
        const weight = Number(value) || 0;
        if (weight <= 0) return;
        const base = wzBaseKey(account);
        let risk = "safe";
        if (WZ_WRAPPER_ACCOUNTS.includes(base)) {
            risk = wzVehicleRisk(wzManualVehicleFor(base));
        } else if (base === "krypto") {
            risk = "high";
        } else if (base === "broker" || base === "oki_inw") {
            risk = "market";
        }
        mix[risk] = (mix[risk] || 0) + weight;
    });
    return Object.fromEntries(
        Object.entries(mix).map(([key, value]) => [key, Math.round(value * 10) / 10])
    );
}

function wzManualAllocationShares() {
    const inputs = [...document.querySelectorAll(".wz-manual-share")];
    if (!inputs.length) return wzManualAllocations || {};
    return Object.fromEntries(inputs.map((input) => [
        input.dataset.account,
        Math.max(0, parseFloat(input.value) || 0),
    ]));
}

function wzCurrentAllocations() {
    if (wzAllocationMode === "manual") return wzManualAllocationShares();
    return wzSuggested?.allocations || {};
}

function wzCurrentVehicles() {
    if (wzAllocationMode === "manual") {
        return Object.fromEntries(
            WZ_WRAPPER_ACCOUNTS
                .map((wrapper) => [wrapper, wzManualVehicleFor(wrapper)])
                .filter(([, vehicle]) => Boolean(vehicle))
        );
    }
    return wzPlan?.wrapper_vehicles || wzSuggested?.wrapperVehicles || {};
}

function wzManualAllocationCap(account) {
    const limits = wzAccountConfig?.limits || {};
    if (account === "ike") return Number(limits.ike_annual) || 0;
    if (account === "oipe") return Number(limits.oipe_annual) || 0;
    if (account === "ikze") {
        const key = wzEmployment() === "b2b" ? "ikze_annual_self_employed" : "ikze_annual";
        return Number(limits[key]) || 0;
    }
    return 0;
}

function wzManualAllocationPoolMonthly() {
    return Number(wzSuggested?.pool_monthly) || 0;
}

function wzRoiResetButton(input) {
    return input.closest(".wz-field")?.querySelector(".wz-cap-roi-reset");
}

function wzSyncRoiReset(input) {
    const reset = wzRoiResetButton(input);
    if (reset) reset.classList.toggle("hidden", input.dataset.roiEdited !== "true");
}

function wzApplyDefaultAccountRois() {
    document.querySelectorAll(".wz-cap-roi").forEach((input) => {
        if (input.dataset.roiEdited === "true") {
            wzSyncRoiReset(input);
            return;
        }
        const roi = wzDefaultAccountRoi(input.closest(".wz-cap-row")?.dataset.account);
        if (roi == null) {
            input.dataset.defaultRoi = "";
            wzSyncRoiReset(input);
            return;
        }
        input.value = wzFormatRoiInput(roi);
        input.dataset.defaultRoi = input.value;
        wzSyncRoiReset(input);
    });
}

async function wzLoadAccountConfig() {
    let config = wzAnonymousConfig();
    if (!config) {
        try {
            const response = await fetch("/api/config");
            if (response.ok) config = await response.json();
        } catch {
            // Sam formularz pozostaje dostępny; backend nadal użyje swoich reguł.
        }
    }

    wzAccountConfig = config;
    const growth = Number(config?.longevity?.growth_months_per_year);
    if (Number.isFinite(growth)) wzLongevityGrowth = growth;
    wzApplyDefaultAccountRois();
    wzApplyPlanEndDefault();
    wzApplyDefaultSalary();
    wzApplyPayrollRateDefaults();
    if (wzAllocationMode === "manual") wzUpdateManualAllocationAmounts();
    wzUpdateB2bZusLabels();
}

function wzUpdateB2bZusLabels() {
    const zl = (value) => `${Math.round(value).toLocaleString("pl-PL")} zł`;
    const base = Number(wzAccountConfig?.zus?.b2b_base_monthly);
    if (Number.isFinite(base) && base > 0) {
        const label = document.querySelector(".wz-b2b-zus-label");
        if (label) {
            label.textContent = `Duży ZUS (podstawa ${zl(base)})`;
        }
        const baseLabel = wzEl("wzB2bZusBase");
        if (baseLabel) baseLabel.textContent = zl(base);
        const rate = Number(wzAccountConfig?.zus?.skladka_rate);
        const contributionLabel = wzEl("wzB2bZusContribution");
        if (contributionLabel && Number.isFinite(rate) && rate > 0) {
            contributionLabel.textContent = zl(base * rate);
        }
        const custom = wzEl("wzB2bCustomZus");
        if (custom) {
            const current = parseFloat(custom.value);
            if (!Number.isFinite(current) || current <= 0) {
                custom.value = String(Math.round(base));
                wzSetValue("wzB2bCustomZusRange", Math.round(base));
            }
        }
    }
    const preferential = Number(wzAccountConfig?.b2b?.preferential_base_monthly);
    const preferentialLabel = wzEl("wzB2bPreferentialBase");
    if (preferentialLabel && Number.isFinite(preferential) && preferential > 0) {
        preferentialLabel.textContent = zl(preferential);
    }
    const ikzeLimit = Number(wzAccountConfig?.limits?.ikze_annual_self_employed);
    const ikzeLabel = wzEl("wzB2bIkzeLimit");
    if (ikzeLabel && Number.isFinite(ikzeLimit) && ikzeLimit > 0) {
        ikzeLabel.textContent = `${Math.round(ikzeLimit).toLocaleString("pl-PL")} zł/rok`;
    }
}

function wzFormatPercent(value) {
    const rounded = Math.round(value);
    return rounded < 1 ? "<1%" : `${rounded}%`;
}

function wzFormatYears(years) {
    if (years === 1) return "1 rok";
    if (years >= 2 && years <= 4) return `${years} lata`;
    return `${years} lat`;
}

function wzPlanEndDefault(gender, age, growth = wzLongevityGrowth) {
    const table = WZ_LIFE_EXPECTANCY[gender] || WZ_LIFE_EXPECTANCY.m;
    const years = table[age] ?? (age < 16 ? table[16] : age > 90 ? table[90] : 0);
    const rate = Number.isFinite(growth) ? Math.max(0, growth) : 0;
    const projected = years * (1 + rate / 12);
    return Math.min(120, Math.max(55, age + Math.round(projected)));
}

function wzApplyPlanEndDefault() {
    if (wzPlanEndTouched) return;
    const planEnd = wzEl("wzPlanEnd");
    if (!planEnd) return;
    const gender = wzRadio("wzGender", "m");
    const age = wzInt("wzAge", 40);
    const value = wzPlanEndDefault(gender, age);
    planEnd.value = String(value);
    wzSetValue("wzPlanEndRange", value);
}

function wzApplyDefaultSalary() {
    if (wzSalaryTouched || wzEmployment() !== "etat") return;
    const input = wzEl("wzEtatSalary");
    if (!input) return;
    const limit = Number(wzAccountConfig?.limits?.oipe_annual);
    const averageMonthly = Number.isFinite(limit) && limit > 0 ? limit / 3 : 9420;
    const annual = Math.max(0, Math.round((averageMonthly * 12) / 1000) * 1000);
    const value = wzEtatPeriod() === "year" ? annual : Math.round(annual / 12);
    input.value = String(value);
    input.dataset.monthlyValue = String(annual / 12);
    wzSetValue("wzEtatSalaryRange", value);
    wzUpdateSalaryLabels();
    wzScheduleSalaryPreview();
}

function wzCanonicalValue(value) {
    if (Array.isArray(value)) {
        return `[${value.map(wzCanonicalValue).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${wzCanonicalValue(value[key])}`);
        return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value);
}

function wzCanonicalJson(value) {
    return wzCanonicalValue(value);
}

// --- Drzewo kroków ----------------------------------------------------------

const WZ_RISK_STRATEGY = {
    spokojny: "konserwatywna",
    zrownowazony: "zbilansowana",
    dynamiczny: "agresywna",
};
const WZ_RISK_LABELS = {
    spokojny: "Spokojny",
    zrownowazony: "Rynkowy",
    dynamiczny: "Dynamiczny",
};

function wzRiskProfile() {
    return wzRadio("wzRiskProfile", "zrownowazony");
}

function wzStrategyForRisk() {
    return WZ_RISK_STRATEGY[wzRiskProfile()] || "zbilansowana";
}

function wzOptimizeMode() {
    return wzRadio("wzOptimizeMode", "auto");
}

function wzIsAutoPlan() {
    return wzCurrentPath() === 1 && wzOptimizeMode() === "auto";
}

function wzStepOrder() {
    const employment = wzEmployment();
    const paidStep = employment === "etat" ? ["etat"] : employment === "b2b" ? ["b2b"] : [];
    return [
        "cel",
        "profil",
        ...paidStep,
        "zus",
        "oszczednosci",
        "kapital",
        "sabbatical",
        "strategia",
        "wynik",
    ];
}

function wzPlanStepId() {
    const order = wzStepOrder();
    return order.length > 1 ? order[order.length - 2] : "wynik";
}

function wzQuestionForPath(path = wzCurrentPath()) {
    if (path === 2) return "Ile muszę odkładać?";
    if (path === 3) return "Kiedy mogę przejść na FIRE?";
    return "Ile dostanę miesięcznie?";
}

function wzShowStep(stepId, focus = false) {
    const order = wzStepOrder();
    const id = order.includes(stepId) ? stepId : order[0];
    wzCurrentStep = id;
    wzClearValidationError();

    document.querySelectorAll(".wz-step").forEach((el) => {
        el.classList.toggle("hidden", el.dataset.stepId !== id);
    });
    if (id !== "wynik") wzMilestoneTipHide();

    const index = order.indexOf(id);
    const progress = wzEl("wzProgressBar");
    if (progress) {
        progress.style.width = `${((index + 1) / order.length) * 100}%`;
        progress.setAttribute("aria-valuenow", String(index + 1));
        progress.setAttribute("aria-valuemax", String(order.length));
    }

    const count = wzEl("wzStepCount");
    if (count) count.textContent = `Krok ${index + 1} / ${order.length}`;

    const back = wzEl("wzBackBtn");
    if (back) back.classList.toggle("hidden", index === 0);

    if (id === "kapital" && wzAllocationMode === "manual") {
        wzSeedManualVehicles();
    }
    if (id === "strategia") {
        wzSyncModeUI();
        if (!wzIsAutoPlan()) {
            wzAllocationMode = "manual";
            wzUpdateAllocationModeControl();
            wzRefreshSuggestion();
        }
    }
    if (id === "wynik" && wzPlan) wzRenderResult(wzPlan);

    wzUpdateActions();

    if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (focus) {
        const heading = document.querySelector(`.wz-step[data-step-id="${id}"] h2`);
        if (heading) {
            heading.setAttribute("tabindex", "-1");
            heading.focus({ preventScroll: true });
        }
    }
    wzSaveState();
}

function wzUpdateActions() {
    const next = wzEl("wzNextBtn");
    if (!next) return;
    next.disabled = wzPlanLoading;

    let label = "Dalej";
    let planReady = false;
    const planStep = wzPlanStepId();
    if (wzCurrentStep === planStep) {
        label = "Wylicz plan";
    } else if (wzCurrentStep === "wynik") {
        planReady = Boolean(wzPlan);
        label = wzPlanLoading ? "Wyliczam..." : planReady ? "Dostosuj w symulatorze" : "Wylicz plan";
    }
    next.textContent = wzPlanLoading && wzCurrentStep === "wynik" ? "Wyliczam..." : label;
    next.classList.toggle("btn-real", planReady && !wzPlanLoading);
    next.classList.toggle("btn-primary", !(planReady && !wzPlanLoading));
    const exportBtn = wzEl("wzExportBtn");
    if (exportBtn) {
        const exportVisible = wzCurrentStep === "wynik" && planReady && !wzPlanLoading;
        exportBtn.classList.toggle("hidden", !exportVisible);
        wzEl("wzFooter")?.classList.toggle("has-export", exportVisible);
    }
}

function wzNext() {
    if (wzPlanLoading) return;

    if (wzCurrentStep === "wynik") {
        if (wzPlan) {
            wzFinish();
        } else {
            wzRunPlan();
        }
        return;
    }

    if (!wzValidateStep(wzCurrentStep)) return;

    const planStep = wzPlanStepId();
    if (wzCurrentStep === "strategia" && planStep !== "strategia") {
        wzShowStep(planStep, true);
        return;
    }
    if (wzCurrentStep === planStep) {
        // Walidacja musi zakończyć się przed przejściem na krok wyniku —
        // inaczej użytkownik widzi pusty wynik i dopiero potem błąd.
        if (!wzValidateForPlan()) return;
        const body = wzPlanBody();
        if (wzPlan && wzPlanSignature === wzCanonicalJson(body)) {
            wzShowStep("wynik", true);
            return;
        }
        wzShowStep("wynik", true);
        wzRunPlan({ validated: true });
        return;
    }

    const order = wzStepOrder();
    const index = order.indexOf(wzCurrentStep);
    if (index >= 0 && index < order.length - 1) {
        wzShowStep(order[index + 1], true);
    }
}

function wzBack() {
    const order = wzStepOrder();
    const index = order.indexOf(wzCurrentStep);
    if (index > 0) wzShowStep(order[index - 1], true);
}

// --- Widoczność paneli zależna od ścieżki i sytuacji ------------------------

function wzSyncPathUI() {
    const path = wzCurrentPath();
    wzEl("wzTargetPanel")?.classList.toggle("hidden", path === 1);
    wzEl("wzSavingsPanel")?.classList.toggle("hidden", path === 2);
    wzEl("wzReGroup")?.classList.toggle("hidden", path === 3);
    wzSyncModeUI();
}

function wzSyncModeUI() {
    const path = wzCurrentPath();
    const auto = wzIsAutoPlan();
    wzEl("wzPlanningModePanel")?.classList.toggle("hidden", path !== 1);
    wzEl("wzAutoPlanningPanel")?.classList.toggle("hidden", !auto);
    wzEl("wzManualPlanningPanel")?.classList.toggle("hidden", auto);
    const title = wzEl("wzPlanningTitle");
    const subtitle = wzEl("wzPlanningSubtitle");
    if (title) title.textContent = path === 1 ? "Jak zaplanować wpłaty?" : "Podział wpłat";
    if (subtitle) {
        subtitle.textContent = path === 1
            ? "Możesz sam ustawić podział i wiek ZUS albo oddać dobór asystentowi. W trybie automatycznym silnik działa w granicach profilu ryzyka."
            : "Ustaw, jaka część miesięcznej puli trafia na poszczególne konta.";
    }
}

function wzSyncOfeBox() {
    const member = wzRadio("wzHasOfe", "no") === "yes";
    wzEl("wzOfeCapBox")?.classList.toggle("hidden", !member);
}

function wzSyncB2bRows() {
    const form = wzRadio("wzB2bTaxForm", "ryczalt");
    const zus = wzRadio("wzB2bZusMode", "duzy");
    wzEl("wzB2bLumpRow")?.classList.toggle("hidden", form !== "ryczalt");
    wzEl("wzB2bCustomZusRow")?.classList.toggle("hidden", zus !== "custom");
}

function wzSyncZusBox() {
    const has = wzRadio("wzHasZusCap", "no") === "yes";
    wzEl("wzZusCapBox")?.classList.toggle("hidden", !has);
}

function wzSyncMortgageBox() {
    const has = wzRadio("wzHasMortgage", "no") === "yes";
    wzEl("wzMortgageBox")?.classList.toggle("hidden", !has);
}

function wzSyncRealEstateBox() {
    const has = wzRadio("wzHasRealEstate", "no") === "yes";
    wzEl("wzRealEstateBox")?.classList.toggle("hidden", !has);
}

function wzSyncFireStyle() {
    const style = wzRadio("wzFireStyle", "full");
    const semi = style !== "full";
    wzEl("wzSemiFireBox")?.classList.toggle("hidden", !semi);
    wzEl("wzSemiSavingsGroup")?.classList.toggle("hidden", style === "barista");
    if (semi) wzSyncSemiBounds();
}

function wzSyncAgeBounds() {
    const age = wzInt("wzAge", 40);
    const reInput = wzEl("wzRe");
    const reRange = wzEl("wzReRange");
    if (reInput && (parseInt(reInput.value, 10) || 0) <= age) {
        const next = Math.min(95, age + 5);
        reInput.value = String(next);
        if (reRange) reRange.value = String(next);
    }

    const path = wzCurrentPath();
    const re = path === 3 ? 0 : parseInt(reInput?.value, 10) || age + 1;
    const retirement = wzEl("wzRetirement");
    const retirementRange = wzEl("wzRetirementRange");
    if (retirement) {
        const current = parseInt(retirement.value, 10) || 0;
        if (current <= age || (path !== 3 && current < re)) {
            const next = Math.min(95, Math.max(age + 1, re));
            retirement.value = String(next);
            if (retirementRange) retirementRange.value = String(next);
        }
    }

    const planEnd = wzEl("wzPlanEnd");
    const planEndRange = wzEl("wzPlanEndRange");
    if (planEnd) {
        const current = parseInt(planEnd.value, 10) || 0;
        const retirementAge = parseInt(retirement?.value, 10) || 0;
        const horizon = Math.max(age + 10, re + 1, retirementAge + 1);
        if (current <= age || (path !== 3 && current <= re) || current <= retirementAge) {
            const next = Math.min(120, horizon);
            planEnd.value = String(next);
            if (planEndRange) planEndRange.value = String(next);
        }
    }
    wzSyncSemiBounds();
}

function wzSyncSemiBounds() {
    const style = wzRadio("wzFireStyle", "full");
    if (style === "full") return;
    const age = wzInt("wzAge", 40);
    const path = wzCurrentPath();
    // Na ścieżce 3 wiek FIRE dopiero wyliczamy, ale etap części etatu musi
    // zmieścić się przed wiekiem emerytury ZUS — inaczej planner go pominie.
    const re = path === 3 ? wzInt("wzRetirement", 65) : wzInt("wzRe", 55);
    const lo = age + 1;
    const hi = Math.max(lo, Math.min(110, re - 1));
    const input = wzEl("wzSemiAge");
    const range = wzEl("wzSemiAgeRange");
    if (input) {
        input.min = String(lo);
        input.max = String(hi);
        const current = parseInt(input.value, 10) || 0;
        if (current < lo || current > hi) {
            input.value = String(Math.min(hi, Math.max(lo, age + 10)));
        }
    }
    if (range) {
        range.min = String(lo);
        range.max = String(hi);
        if (input) range.value = input.value;
    }
}

// --- Etykiety i podglądy pensji --------------------------------------------

function wzEtatPeriod() {
    return wzRadio("wzEtatPeriod", "year");
}

function wzRememberMonthlySalary() {
    const input = wzEl("wzEtatSalary");
    if (!input) return;
    const value = parseFloat(input.value) || 0;
    input.dataset.monthlyValue = String(
        wzEtatPeriod() === "year" ? value / 12 : value
    );
}

function wzApplyEtatPeriod(convert) {
    const period = wzEtatPeriod();
    const annual = period === "year";
    const input = wzEl("wzEtatSalary");
    const range = wzEl("wzEtatSalaryRange");
    if (!input) return;

    if (convert && period !== wzEtatPeriodPrev) {
        const current = parseFloat(input.value) || 0;
        const stored = parseFloat(input.dataset.monthlyValue);
        const monthly = Number.isFinite(stored) && stored > 0
            ? stored
            : (wzEtatPeriodPrev === "year" ? current / 12 : current);
        const next = Math.max(0, Math.round(annual ? monthly * 12 : monthly));
        input.value = String(next);
        input.dataset.monthlyValue = String(monthly);
        if (range) range.value = String(next);
    } else if (!input.dataset.monthlyValue) {
        wzRememberMonthlySalary();
    }
    wzEtatPeriodPrev = period;

    // Suwak pokazuje realistyczny zakres; ręcznie można wpisać więcej.
    const rangeMax = annual ? 600_000 : 50_000;
    const inputMax = annual ? 2_000_000 : 166_667;
    const step = annual ? 1_000 : 250;
    input.max = String(inputMax);
    input.step = String(step);
    if (range) {
        range.max = String(rangeMax);
        range.step = String(step);
    }
    wzUpdateSalaryLabels();
}

function wzUpdateSalaryLabels() {
    const employment = wzEmployment();
    const etatLabel = wzEl("wzEtatSalaryLabel");
    if (etatLabel) {
        const net = wzRadio("wzEtatSalaryMode", "gross") === "net";
        const period = wzEtatPeriod() === "year" ? "rok" : "mies.";
        etatLabel.textContent = net
            ? `Twoja pensja netto (zł/${period})`
            : `Twoja pensja brutto (zł/${period})`;
    }
    const b2bLabel = wzEl("wzB2bSalaryLabel");
    if (b2bLabel) {
        b2bLabel.textContent = wzRadio("wzB2bSalaryMode", "gross") === "net"
            ? "Kwota na czysto po ZUS i podatku (zł/mies.)"
            : "Przychód miesięczny po kosztach (zł/mies.)";
    }
    if (employment !== "etat") wzHideSalaryPreview(wzEl("wzEtatSalaryPreview"));
    if (employment !== "b2b") wzHideSalaryPreview(wzEl("wzB2bSalaryPreview"));
}

function wzInitPayrollRateControls() {
    const controls = [
        ["wzPpkEmployeePctControl", "wzPpkEmployeePct", "2.0", "0", "4", "0.1", "Składka pracownika PPK (%)"],
        ["wzPpkEmployerPctControl", "wzPpkEmployerPct", "1.5", "0", "4", "0.1", "Składka pracodawcy PPK (%)"],
        ["wzPpeEmployerPctControl", "wzPpeEmployerPct", "3.5", "0", "7", "0.1", "Składka pracodawcy PPE (%)"],
    ];
    controls.forEach(([containerId, inputId, value, min, max, step, aria]) => {
        const container = wzEl(containerId);
        if (!container || container.querySelector("input")) return;
        container.innerHTML = numControlsHtml({
            value,
            min,
            max,
            step,
            fieldClass: "wz-payroll-rate-input",
            attrs: `id="${inputId}"`,
            aria,
        });
    });
    wzUpdatePayrollRateSummaries();
}

function wzPayrollRateValue(inputId, fallback) {
    const value = wzNum(inputId, fallback);
    return Number.isFinite(value) ? value : fallback;
}

function wzFormatPayrollRate(value) {
    return Number(value).toLocaleString("pl-PL", { maximumFractionDigits: 1 });
}

function wzUpdatePayrollRateSummaries() {
    const ppkEmployee = wzPayrollRateValue("wzPpkEmployeePct", 2.0);
    const ppkEmployer = wzPayrollRateValue("wzPpkEmployerPct", 1.5);
    const ppeEmployer = wzPayrollRateValue("wzPpeEmployerPct", 3.5);
    const ppkSummary = wzEl("wzPpkRateSummary");
    const ppeSummary = wzEl("wzPpeRateSummary");
    if (ppkSummary) {
        ppkSummary.textContent = `${wzFormatPayrollRate(ppkEmployee)}% pracownika · ${wzFormatPayrollRate(ppkEmployer)}% pracodawcy`;
    }
    if (ppeSummary) {
        ppeSummary.textContent = `${wzFormatPayrollRate(ppeEmployer)}% pracodawcy`;
    }
}

function wzApplyPayrollRateDefaults() {
    if (wzPayrollRatesTouched) return;
    const ppkEmployee = Number(wzAccountConfig?.ppk?.employee_pct);
    const ppkEmployer = Number(wzAccountConfig?.ppk?.employer_pct);
    const ppeEmployer = Number(wzAccountConfig?.ppe?.employer_pct);
    wzSetValue("wzPpkEmployeePct", Number.isFinite(ppkEmployee) ? ppkEmployee * 100 : 2.0);
    wzSetValue("wzPpkEmployerPct", Number.isFinite(ppkEmployer) ? ppkEmployer * 100 : 1.5);
    wzSetValue("wzPpeEmployerPct", Number.isFinite(ppeEmployer) ? ppeEmployer * 100 : 3.5);
    wzUpdatePayrollRateSummaries();
    wzScheduleSalaryPreview();
}

function wzPayrollState(name) {
    return wzRadio(name, "never");
}

function wzSyncPayrollPrograms() {
    const employment = wzEmployment();
    const ppkState = wzPayrollState("wzPpkState");
    const ppeState = wzPayrollState("wzPpeState");
    wzEl("wzPpkRates")?.classList.toggle("hidden", ppkState !== "active");
    wzEl("wzPpeRates")?.classList.toggle("hidden", ppeState !== "active");
    if (wzEl("wzPpkRates")) wzEl("wzPpkRates").hidden = ppkState !== "active";
    if (wzEl("wzPpeRates")) wzEl("wzPpeRates").hidden = ppeState !== "active";

    const etat = employment === "etat";
    const showPpk = !etat || ppkState !== "never";
    const showPpe = !etat || ppeState !== "never";
    wzEl("wzPpkBalanceField")?.classList.toggle("hidden", !showPpk);
    wzEl("wzPpeBalanceField")?.classList.toggle("hidden", !showPpe);
    wzEl("wzPayrollCapitalPanel")?.classList.toggle("hidden", etat && !showPpk && !showPpe);
    wzUpdatePayrollRateSummaries();
}

function wzMonthlySalaryValue() {
    const employment = wzEmployment();
    if (employment === "etat") {
        const amount = wzNum("wzEtatSalary", 0);
        return wzEtatPeriod() === "year" ? amount / 12 : amount;
    }
    if (employment === "b2b") return wzNum("wzB2bSalary", 0);
    return 0;
}

function wzSalaryMode() {
    const employment = wzEmployment();
    if (employment === "etat") return wzRadio("wzEtatSalaryMode", "gross");
    if (employment === "b2b") return wzRadio("wzB2bSalaryMode", "gross");
    return "gross";
}

function wzScheduleSalaryPreview() {
    clearTimeout(wzSalaryTimer);
    clearTimeout(wzSalaryRetryTimer);
    wzSalaryRetries = 0;
    wzSalaryTimer = setTimeout(wzRunSalaryPreview, 350);
}

function wzSalaryRequestBody() {
    const employment = wzEmployment();
    const amount = wzMonthlySalaryValue();
    if (employment === "niepracujacy" || amount <= 0) return null;
    const body = {
        salary_mode: wzSalaryMode(),
        amount,
        employment,
        use_ppk: employment === "etat" && wzPayrollState("wzPpkState") === "active",
        ppk_employee_pct: wzPayrollRateValue("wzPpkEmployeePct", 2.0) / 100,
    };
    if (employment === "b2b") {
        body.b2b_tax_form = wzRadio("wzB2bTaxForm", "ryczalt");
        body.b2b_lump_rate = parseFloat(wzRadio("wzB2bLumpRate", "0.12"));
        body.b2b_zus_mode = wzRadio("wzB2bZusMode", "duzy");
        body.b2b_custom_zus_base = wzNum(
            "wzB2bCustomZus",
            Number(wzAccountConfig?.zus?.b2b_base_monthly) || 0
        );
    }
    const config = wzAnonymousConfig();
    if (config) body.base_config = config;
    return body;
}

function wzSalaryPreviewKey(body) {
    if (!body) return "";
    const { base_config, ...rest } = body;
    return wzCanonicalJson(rest);
}

function wzSalaryBaseKey(body) {
    if (!body) return "";
    const { base_config, salary_mode, ...rest } = body;
    return wzCanonicalJson(rest);
}

function wzCurrentSalaryPreviewKey() {
    return wzSalaryPreviewKey(wzSalaryRequestBody());
}

function wzHideSalaryPreview(box) {
    if (!box) return;
    box.hidden = true;
    box.innerHTML = "";
}

async function wzRunSalaryPreview() {
    clearTimeout(wzSalaryRetryTimer);
    const body = wzSalaryRequestBody();
    const seq = ++wzSalarySeq;
    if (!body) {
        wzSalaryPreview = null;
        wzHideSalaryPreview(wzEl("wzEtatSalaryPreview"));
        wzHideSalaryPreview(wzEl("wzB2bSalaryPreview"));
        wzUpdateSavingsHint();
        return;
    }

    const key = wzSalaryPreviewKey(body);
    if (wzSalaryPreviewCache[key]) {
        wzSalaryPreview = {
            ...wzSalaryPreviewCache[key],
            key,
            baseKey: wzSalaryBaseKey(body),
            mode: body.salary_mode,
        };
        wzRenderSalaryHint();
        wzUpdateSavingsHint();
        return;
    }

    try {
        const data = await wzPostJson("/api/wizard/salary", body, "Błąd podglądu pensji.");
        if (seq !== wzSalarySeq) return;
        wzSalaryPreview = {
            key,
            baseKey: wzSalaryBaseKey(body),
            mode: body.salary_mode,
            gross: data.gross_monthly,
            net: data.net_monthly,
        };
        wzSalaryPreviewCache[key] = { gross: wzSalaryPreview.gross, net: wzSalaryPreview.net };
        wzSalaryRetries = 0;
        wzRenderSalaryHint();
    } catch (err) {
        if (seq !== wzSalarySeq) return;
        if (err?.status === 429) {
            // Limit zapytań to nie błąd obliczeń — zostaw ostatnią dobrą
            // wartość i ponów po Retry-After, zamiast straszyć użytkownika.
            if (wzSalaryPreview) wzRenderSalaryHint();
            if (wzSalaryRetries < 2) {
                const parsed = parseInt(err.retryAfter || "", 10);
                const seconds = Number.isFinite(parsed) && parsed > 0 ? Math.min(10, parsed) : 2;
                wzSalaryRetries += 1;
                clearTimeout(wzSalaryRetryTimer);
                wzSalaryRetryTimer = setTimeout(wzRunSalaryPreview, seconds * 1000);
            }
            return;
        }
        // Podgląd jest tylko pomocniczy — zostawiamy ostatnią dobrą wartość.
    } finally {
        if (seq === wzSalarySeq) wzUpdateSavingsHint();
    }
}

function wzSalaryLabel(mode, employment) {
    if (employment === "b2b") {
        return mode === "gross" ? "Przychód" : "Na czysto";
    }
    return mode === "gross" ? "Brutto" : "Netto";
}

function wzSalaryInputPeriod() {
    return wzEmployment() === "etat" ? wzEtatPeriod() : "month";
}

function wzSalaryPreviewBlock(monthly, label, approximate, inputPeriod) {
    const annual = Math.round((Number(monthly) || 0) * 12);
    const showAnnual = inputPeriod === "month";
    const mainValue = showAnnual ? annual : monthly;
    const mainUnit = showAnnual ? "rok" : "mies.";
    const subValue = showAnnual ? monthly : annual;
    const subUnit = showAnnual ? "mies." : "rok";
    return `
        <div class="wz-salary-preview-item">
            <span class="wz-salary-preview-label">${approximate ? "≈ " : ""}${escapeHtml(label)}</span>
            <span class="wz-salary-preview-value is-result">${fmtMoney(mainValue)} <span class="wz-suggest-unit">/${mainUnit}</span></span>
            <span class="wz-salary-preview-sub">${fmtMoney(subValue)}/${subUnit}</span>
        </div>`;
}

function wzRenderSalaryHint() {
    const employment = wzEmployment();
    const etatBox = wzEl("wzEtatSalaryPreview");
    const b2bBox = wzEl("wzB2bSalaryPreview");
    if (employment !== "etat") wzHideSalaryPreview(etatBox);
    if (employment !== "b2b") wzHideSalaryPreview(b2bBox);
    const box = employment === "etat" ? etatBox : employment === "b2b" ? b2bBox : null;
    if (!box) return;
    if (!wzSalaryPreview || wzSalaryPreview.key !== wzCurrentSalaryPreviewKey()) {
        wzHideSalaryPreview(box);
        return;
    }
    const mode = wzSalaryMode();
    const gross = Number(wzSalaryPreview.gross);
    const net = Number(wzSalaryPreview.net);
    if (!Number.isFinite(gross) || !Number.isFinite(net)) {
        wzHideSalaryPreview(box);
        return;
    }
    const otherMode = mode === "gross" ? "net" : "gross";
    const activeMonthly = mode === "gross" ? gross : net;
    const otherMonthly = mode === "gross" ? net : gross;
    const inputPeriod = wzSalaryInputPeriod();
    box.innerHTML = `
        ${wzSalaryPreviewBlock(activeMonthly, wzSalaryLabel(mode, employment), false, inputPeriod)}
        <span class="wz-salary-preview-arrow" aria-hidden="true">↔</span>
        ${wzSalaryPreviewBlock(otherMonthly, wzSalaryLabel(otherMode, employment), true, inputPeriod)}`;
    box.hidden = false;
}

function wzApplySalaryModeConversion() {
    const preview = wzSalaryPreview;
    if (!preview) return;
    const body = wzSalaryRequestBody();
    if (!body) return;
    if (preview.baseKey !== wzSalaryBaseKey(body)) return;
    const mode = body.salary_mode;
    const monthly = mode === "gross" ? Number(preview.gross) : Number(preview.net);
    if (!Number.isFinite(monthly) || monthly <= 0) return;
    const annual = wzEmployment() === "etat" && wzEtatPeriod() === "year";
    const input = wzEmployment() === "etat" ? wzEl("wzEtatSalary") : wzEl("wzB2bSalary");
    const range = wzEmployment() === "etat" ? wzEl("wzEtatSalaryRange") : wzEl("wzB2bSalaryRange");
    if (!input) return;
    const value = Math.max(0, Math.round(annual ? monthly * 12 : monthly));
    const displayedMonthly = annual ? value / 12 : value;
    input.value = String(value);
    input.dataset.monthlyValue = String(displayedMonthly);
    if (range) range.value = String(value);
    const nextBody = { ...body, amount: displayedMonthly, salary_mode: mode };
    wzSalaryPreview = {
        ...preview,
        key: wzSalaryPreviewKey(nextBody),
        baseKey: wzSalaryBaseKey(nextBody),
        mode,
    };
    wzSalaryPreviewCache[wzSalaryPreview.key] = {
        gross: preview.gross,
        net: preview.net,
    };
    wzRenderSalaryHint();
    wzUpdateSavingsHint();
}

function wzUpdateSavingsMax() {
    const range = wzEl("wzSavingsRange");
    if (!range) return;
    const previewMatches = wzSalaryPreview
        && wzSalaryPreview.key === wzCurrentSalaryPreviewKey();
    const net = previewMatches ? wzSalaryPreview.net : null;
    const cap = net && net > 0 ? net : 20000;
    const max = Math.max(100, Math.min(20000, Math.floor(cap / 100) * 100));
    range.max = String(max);
    if ((parseFloat(range.value) || 0) > max) range.value = String(max);
}

function wzUpdateSavingsHint() {
    const hint = wzEl("wzSavingsHint");
    const warn = wzEl("wzSavingsWarn");
    const savings = wzNum("wzSavings", 0);
    const employment = wzEmployment();
    const previewMatches = wzSalaryPreview
        && wzSalaryPreview.key === wzCurrentSalaryPreviewKey();
    const net = previewMatches ? wzSalaryPreview.net : null;
    const gross = wzMonthlySalaryValue();
    wzUpdateSavingsMax();
    if (hint) {
        if (net && net > 0 && savings > 0) {
            hint.textContent = `${fmtMoney(savings)} = ${wzFormatPercent((savings / net) * 100)} pensji netto`;
        } else {
            hint.textContent = "";
        }
    }
    let msg = "";
    if (employment === "niepracujacy" && savings > 0) {
        msg = "Nie pracujesz — upewnij się, że masz inne źródło finansowania tych wpłat.";
    } else if (employment === "b2b" && gross > 0 && savings > gross) {
        msg = `Odkładasz więcej, niż wynosi miesięczny przychód (${fmtMoney(gross)} zł/mc).`;
    } else if (net && net > 0 && savings > net) {
        msg = "Oszczędności przewyższają pensję netto — sprawdź kwoty lub źródło oszczędności.";
    }
    if (warn) {
        warn.hidden = !msg;
        warn.textContent = msg;
    }
}

// --- Kapitał: pastylki i dynamiczne wiersze ---------------------------------

function wzBuildShelterPicker() {
    const picker = wzEl("wzSheltersPicker");
    if (!picker) return;
    picker.innerHTML = "";
    WZ_SHELTERS.forEach(({ account, label }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pill-toggle wz-pill";
        btn.dataset.account = account;
        btn.innerHTML = `${wzAccountIcon(account)}<span>${escapeHtml(label)}</span>`;
        btn.addEventListener("click", () => wzToggleShelter(account));
        picker.appendChild(btn);
    });
    wzRefreshShelterPicker();
}

function wzRefreshShelterPicker() {
    const selected = new Set(
        [...document.querySelectorAll("#wzSheltersList .wz-cap-row")].map((row) => row.dataset.account)
    );
    document.querySelectorAll("#wzSheltersPicker .wz-pill").forEach((btn) => {
        const active = selected.has(btn.dataset.account);
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
    });
}

function wzToggleShelter(account) {
    const existing = document.querySelector(
        `#wzSheltersList .wz-cap-row[data-account="${account}"]`
    );
    if (existing) {
        existing.remove();
    } else {
        wzEl("wzSheltersList")?.appendChild(wzBuildCapRow(account, { name: false, roi: true }));
    }
    wzRefreshShelterPicker();
    wzTouch();
}

function wzBuildCapRow(account, { name = true, roi = true } = {}) {
    const base = wzBaseKey(account);
    const defaultName = wzAccountLabel(account);
    const wrap = document.createElement("div");
    wrap.className = "wz-capital-item wz-cap-row";
    wrap.dataset.account = account;
    wrap.dataset.base = base;
    wrap.dataset.defaultName = defaultName;

    const fields = [];
    fields.push(`
        <div class="wz-field">
            <span class="wz-field-label">Saldo (zł)</span>
            ${numControlsHtml({
                value: "0",
                min: "0",
                step: "1000",
                fieldClass: "wz-cap-amount",
                aria: `Saldo ${wzAccountLabel(account)}`,
            })}
        </div>`);
    if (roi && base !== "gotowka") {
        const defaultRoi = wzDefaultAccountRoi(account);
        const roiValue = defaultRoi == null ? "" : wzFormatRoiInput(defaultRoi);
        fields.push(`
            <div class="wz-field">
                <div class="wz-field-label-row">
                    <span class="wz-field-label">Realne ROI (%/rok)</span>
                    <button type="button" class="btn btn-ghost btn-icon btn-sm wz-cap-roi-reset hidden"
                            title="Przywróć domyślne ROI z Konfiguracji"
                            aria-label="Przywróć domyślne ROI dla ${escapeHtml(defaultName)}">${iconSvg("restore")}</button>
                </div>
                ${numControlsHtml({
                    value: roiValue,
                    min: "0",
                    max: "30",
                    step: "0.1",
                    fieldClass: "wz-cap-roi",
                    attrs: `data-default-roi="${roiValue}" title="ROI jest wstępnie wypełnione wartością z Konfiguracji. Zmiana dotyczy tylko tego planu."`,
                    aria: `Realne ROI ${defaultName}`,
                })}
            </div>`);
    }

    wrap.innerHTML = `
        <div class="wz-capital-item-head">
            <span class="wz-instrument-name">${wzAccountIcon(account)}<span class="wz-cap-name-display">${escapeHtml(defaultName)}</span></span>
            ${name ? `<div class="wz-cap-name-edit hidden"><input type="text" class="acc-field wz-cap-name" maxlength="80" value="${escapeHtml(defaultName)}" aria-label="Nazwa własna ${escapeHtml(defaultName)}"><button type="button" class="btn btn-ghost btn-icon btn-sm wz-cap-name-save" aria-label="Zapisz nazwę">${iconSvg("check")}</button></div>` : ""}
            <div class="btn-row wz-cap-actions">
                ${name ? `<button type="button" class="btn btn-ghost btn-icon btn-sm wz-cap-name-edit-btn" aria-label="Zmień nazwę ${escapeHtml(defaultName)}" title="Zmień nazwę">${iconSvg("pencil")}</button>` : ""}
                <button type="button" class="btn btn-ghost btn-icon btn-sm wz-cap-remove" aria-label="Usuń ${escapeHtml(defaultName)}" title="Usuń">${iconSvg("x")}</button>
            </div>
        </div>
        <div class="wz-cap-fields">${fields.join("")}</div>`;
    return wrap;
}

function wzNextInstance(base, list) {
    const rows = [...list.querySelectorAll(".wz-cap-row")].filter(
        (row) => wzBaseKey(row.dataset.account) === base
    );
    if (!rows.length) return base;
    let max = 0;
    rows.forEach((row) => {
        if (row.dataset.account === base) {
            max = Math.max(max, 1);
            return;
        }
        const suffix = parseInt(String(row.dataset.account).split(":")[1], 10);
        if (Number.isFinite(suffix)) max = Math.max(max, suffix);
    });
    return `${base}:${max + 1}`;
}

function wzAddMulti(base) {
    const list = WZ_SAFE_BASES.includes(base)
        ? wzEl("wzSafeList")
        : wzEl("wzMarketList");
    if (!list) return;
    const account = wzNextInstance(base, list);
    const row = wzBuildCapRow(account, { name: true, roi: true });
    list.appendChild(row);
    wzSyncMultiAddButtons();
    const input = row.querySelector(".wz-cap-amount");
    if (input && typeof input.focus === "function") input.focus();
    wzTouch();
}

function wzToggleSingle(account) {
    const list = wzEl("wzMarketList");
    if (!list) return;
    const existing = list.querySelector(`.wz-cap-row[data-account="${account}"]`);
    if (existing) {
        existing.remove();
    } else {
        list.appendChild(wzBuildCapRow(account, { name: false, roi: true }));
    }
    wzSyncSingleButtons();
    wzTouch();
}

function wzSyncSingleButtons() {
    const list = wzEl("wzMarketList");
    document.querySelectorAll(".wz-add-single").forEach((btn) => {
        const account = btn.dataset.account;
        const label = btn.dataset.label || wzAccountLabel(account);
        const active = Boolean(list?.querySelector(`.wz-cap-row[data-account="${account}"]`));
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
        btn.setAttribute("aria-label", `${active ? "Usuń" : "Dodaj"} ${label}`);
    });
}

function wzCountBaseRows(base) {
    return [
        ...document.querySelectorAll(
            "#wzSafeList .wz-cap-row, #wzMarketList .wz-cap-row"
        ),
    ].filter((row) => wzBaseKey(row.dataset.account) === base).length;
}

function wzSyncMultiAddButtons() {
    document.querySelectorAll(".wz-add-multi").forEach((btn) => {
        const count = wzCountBaseRows(btn.dataset.base);
        const countEl = btn.querySelector(".wz-add-count");
        btn.classList.toggle("has-items", count > 0);
        if (countEl) {
            countEl.textContent = `×${count}`;
            countEl.classList.toggle("is-visible", count > 1);
        }
    });
}

function wzInitCapitalAddButtons() {
    document.querySelectorAll(".wz-add-multi").forEach((button) => {
        const base = button.dataset.base;
        const label = button.dataset.label || wzAccountLabel(base);
        button.classList.add("pill-toggle");
        button.innerHTML = `${wzAccountIcon(base)}<span>${escapeHtml(label)}</span><span class="wz-add-count" aria-hidden="true"></span><span class="wz-add-plus" aria-hidden="true">${iconSvg("plus")}</span>`;
    });
    document.querySelectorAll(".wz-add-single").forEach((button) => {
        const account = button.dataset.account;
        const label = button.dataset.label || wzAccountLabel(account);
        button.classList.add("pill-toggle");
        button.setAttribute("aria-pressed", "false");
        button.innerHTML = `${wzAccountIcon(account)}<span>${escapeHtml(label)}</span>`;
    });
}

// --- Zbieranie odpowiedzi ---------------------------------------------------

function wzCollectCapital() {
    const capital = {};
    const customNames = {};
    const roiOverrides = {};
    const rows = document.querySelectorAll(
        "#wzSheltersList .wz-cap-row, #wzSafeList .wz-cap-row, #wzMarketList .wz-cap-row"
    );
    rows.forEach((row) => {
        const account = row.dataset.account;
        const amount = parseFloat(row.querySelector(".wz-cap-amount")?.value) || 0;
        if (amount > 0) capital[account] = amount;
        const name = row.querySelector(".wz-cap-name")?.value.trim();
        if (name && name !== row.dataset.defaultName) customNames[account] = name;
        const roiInput = row.querySelector(".wz-cap-roi");
        const roi = parseFloat(roiInput?.value);
        const defaultRoi = parseFloat(roiInput?.dataset.defaultRoi);
        const differsFromDefault = !Number.isFinite(defaultRoi)
            || Math.abs(roi - defaultRoi) > 1e-9;
        if (roiInput?.dataset.roiEdited === "true" && Number.isFinite(roi) && differsFromDefault) {
            roiOverrides[account] = roi / 100;
        }
    });
    return { capital, customNames, roiOverrides };
}

function wzCollectAnswers({ withAllocations = true } = {}) {
    const employment = wzEmployment();
    const path = wzCurrentPath();
    const { capital, customNames, roiOverrides } = wzCollectCapital();

    const rows = [...document.querySelectorAll(
        "#wzSheltersList .wz-cap-row, #wzSafeList .wz-cap-row, #wzMarketList .wz-cap-row"
    )];
    const activeBases = new Set(rows.map((row) => wzBaseKey(row.dataset.account)));

    const etat = employment === "etat";
    // Stan programu czytamy niezależnie od zatrudnienia: „nigdy" zawsze zeruje
    // saldo, a zmiana gałęzi nie przenosi starych kwot bez wiedzy użytkownika.
    const ppkStateRaw = wzPayrollState("wzPpkState");
    const ppeStateRaw = wzPayrollState("wzPpeState");
    const ppkState = etat ? ppkStateRaw : "paused";
    const ppeState = etat ? ppeStateRaw : "paused";
    const ppkBalance = ppkStateRaw === "never" ? 0 : wzNum("wzPpkBalance", 0);
    const ppeBalance = ppeStateRaw === "never" ? 0 : wzNum("wzPpeBalance", 0);
    if (ppkBalance > 0) capital.ppk = ppkBalance;
    if (ppeBalance > 0) capital.ppe = ppeBalance;

    const ppkContributions = etat && ppkState === "active";
    const ppeContributions = etat && ppeState === "active";
    const usePpk = ppkContributions || ppkBalance > 0;
    const usePpe = ppeContributions || ppeBalance > 0;
    const ppkEmployeePct = wzPayrollRateValue("wzPpkEmployeePct", 2.0) / 100;
    const ppkEmployerPct = wzPayrollRateValue("wzPpkEmployerPct", 1.5) / 100;
    const ppeEmployerPct = wzPayrollRateValue("wzPpeEmployerPct", 3.5) / 100;

    if (wzRadio("wzHasZusCap", "no") === "yes") {
        const zus = wzNum("wzZusBalance", 0);
        if (zus > 0) capital.zus = zus;
    }
    const ofeMember = wzRadio("wzHasOfe", "no") === "yes";
    if (ofeMember) {
        const ofe = wzNum("wzOfeBalance", 0);
        if (ofe > 0) capital["zus:ofe"] = ofe;
    }

    const hasMortgage = wzRadio("wzHasMortgage", "no") === "yes";
    const hasRealEstate = wzRadio("wzHasRealEstate", "no") === "yes";
    if (hasRealEstate) {
        const value = wzNum("wzReValue", 0);
        if (value > 0) capital.nieruchomosc = value;
    }

    const fireStyle = wzRadio("wzFireStyle", "full");
    const semiEnabled = fireStyle === "coast" || fireStyle === "barista";

    const answers = {
        gender: wzRadio("wzGender", "m"),
        age_now: wzInt("wzAge", 40),
        life_expectancy_growth_months_per_year: wzLongevityGrowth,
        employment,
        gross_monthly: wzMonthlySalaryValue(),
        salary_mode: employment === "niepracujacy" ? "gross" : wzSalaryMode(),
        capital,
        custom_names: customNames,
        roi_overrides: roiOverrides,
        use_zus: true,
        ofe_member: ofeMember,
        use_ppk: usePpk,
        use_ppe: usePpe,
        ppk_contributions: ppkContributions,
        ppe_contributions: ppeContributions,
        ppk_employee_pct: ppkEmployeePct,
        ppk_employer_pct: ppkEmployerPct,
        ppe_employer_pct: ppeEmployerPct,
        use_ikze: activeBases.has("ikze"),
        use_ike: activeBases.has("ike"),
        use_oipe: activeBases.has("oipe"),
        use_oki_inw: activeBases.has("oki_inw"),
        use_oki_osk: activeBases.has("oki_osk"),
        use_krypto: activeBases.has("krypto"),
        use_lokata: activeBases.has("lokata"),
        use_obligacje: activeBases.has("obligacje"),
        use_broker: activeBases.has("broker"),
        use_nieruchomosc: hasRealEstate,
        real_estate_rental_monthly: hasRealEstate ? wzNum("wzReRent", 0) : 0,
        real_estate_liquidation_age: hasRealEstate
            ? (wzInt("wzReLiqAge", 0) || null)
            : null,
        mortgage_monthly: hasMortgage ? wzNum("wzMortgageMonthly", 0) : 0,
        mortgage_end_age: hasMortgage ? wzInt("wzMortgageEndAge", 50) : null,
        redirect_mortgage_to_savings: hasMortgage
            ? Boolean(wzEl("wzRedirectMortgage")?.checked)
            : false,
        semi_fire_enabled: semiEnabled,
        semi_fire_mode: fireStyle === "barista" ? "barista" : "coast",
        semi_fire_age: semiEnabled ? wzInt("wzSemiAge", 48) : null,
        semi_fire_net_monthly: semiEnabled ? wzNum("wzSemiNet", 0) : 0,
        semi_fire_savings_monthly: semiEnabled && fireStyle === "coast"
            ? wzNum("wzSemiSavings", 0)
            : 0,
        retire_early_age: path === 3 ? null : wzInt("wzRe", 55),
        retirement_age: wzIsAutoPlan() ? null : wzInt("wzRetirement", 65),
        plan_end_age: wzInt("wzPlanEnd", 85),
        bequest_target: wzNum("wzBequest", 0),
        optimization_objective: wzRadio("wzPriority", "payout"),
        risk_profile: wzRiskProfile(),
        savings: path === 2 ? 0 : wzNum("wzSavings", 0),
        strategy: wzStrategyForRisk(),
        assumptions: "realne",
    };

    if (employment === "b2b") {
        answers.b2b_tax_form = wzRadio("wzB2bTaxForm", "ryczalt");
        answers.b2b_lump_rate = parseFloat(wzRadio("wzB2bLumpRate", "0.12"));
        answers.b2b_zus_mode = wzRadio("wzB2bZusMode", "duzy");
        answers.b2b_custom_zus_base = wzNum(
            "wzB2bCustomZus",
            Number(wzAccountConfig?.zus?.b2b_base_monthly) || 0
        );
    }

    const config = wzAnonymousConfig();
    if (config) answers.base_config = config;
    if (withAllocations && wzSuggested && !wzIsAutoPlan()) {
        answers.allocations = Object.fromEntries(
            Object.entries(wzCurrentAllocations())
                .filter(([, share]) => Number(share) > 0)
                .map(([account, share]) => [account, Number(share)])
        );
    }
    if (!wzIsAutoPlan()) {
        const vehicles = {};
        WZ_WRAPPER_ACCOUNTS.forEach((wrapper) => {
            const vehicle = wzManualVehicleFor(wrapper);
            if (vehicle) vehicles[wrapper] = vehicle;
        });
        answers.wrapper_vehicles = vehicles;
    }
    return answers;
}

function wzPlanBody() {
    const path = wzCurrentPath();
    const body = { path, answers: wzCollectAnswers() };
    if (path !== 1) body.target_monthly = wzNum("wzTarget", 0);
    if (path === 1) {
        body.optimize = wzIsAutoPlan();
    }
    return body;
}

// --- Walidacja --------------------------------------------------------------

function wzClearValidationError() {
    const box = wzEl("wzValidationError");
    if (box) {
        box.classList.add("hidden");
        box.innerHTML = "";
    }
    document.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
        el.removeAttribute("aria-invalid");
    });
}

function wzValidationError(message, fieldId = null) {
    const field = fieldId ? wzEl(fieldId) : null;
    // Pole może być w ukrytym kroku (np. walidacja całego planu z „strategii”).
    // Najpierw pokaż właściwy krok, dopiero potem banner i fokus.
    if (field) {
        const stepId = field.closest(".wz-step")?.dataset.stepId;
        if (stepId && stepId !== wzCurrentStep) wzShowStep(stepId, true);
    }
    const box = wzEl("wzValidationError");
    if (box) {
        box.innerHTML = `${iconSvg("danger")}<div class="banner-body">${escapeHtml(message)}</div>`;
        box.classList.remove("hidden");
    }
    if (field) {
        field.setAttribute("aria-invalid", "true");
        field.focus({ preventScroll: false });
        field.scrollIntoView?.({ block: "center", behavior: "smooth" });
    } else if (box) {
        box.setAttribute("tabindex", "-1");
        box.focus({ preventScroll: true });
    }
    return false;
}

function wzValidateStep(stepId) {
    const age = wzInt("wzAge", 40);
    const path = wzCurrentPath();

    if (stepId === "profil") {
        if (age < 16 || age > 90) {
            return wzValidationError("Podaj wiek z zakresu 16–90 lat.", "wzAge");
        }
    }

    if (stepId === "etat" && wzMonthlySalaryValue() <= 0) {
        return wzValidationError("Podaj kwotę pensji większą od zera.", "wzEtatSalary");
    }

    if (stepId === "b2b" && wzMonthlySalaryValue() <= 0) {
        return wzValidationError(
            "Podaj miesięczny przychód z działalności większy od zera.",
            "wzB2bSalary"
        );
    }

    if (stepId === "oszczednosci") {
        if (path !== 2 && wzNum("wzSavings", 0) < 0) {
            return wzValidationError("Kwota oszczędności nie może być ujemna.", "wzSavings");
        }
        if (wzRadio("wzHasMortgage", "no") === "yes") {
            if (wzNum("wzMortgageMonthly", 0) <= 0) {
                return wzValidationError(
                    "Podaj miesięczną ratę kredytu hipotecznego.",
                    "wzMortgageMonthly"
                );
            }
            if (wzInt("wzMortgageEndAge", 0) <= age) {
                return wzValidationError(
                    "Wiek końca spłaty kredytu musi być późniejszy niż obecny wiek.",
                    "wzMortgageEndAge"
                );
            }
        }
    }

    if (stepId === "kapital" && wzRadio("wzHasRealEstate", "no") === "yes") {
        if (wzNum("wzReValue", 0) <= 0) {
            return wzValidationError(
                "Podaj wartość rynkową nieruchomości inwestycyjnej.",
                "wzReValue"
            );
        }
        const liq = wzInt("wzReLiqAge", 0);
        if (liq > 0 && liq <= age) {
            return wzValidationError(
                "Wiek sprzedaży nieruchomości musi być późniejszy niż obecny wiek (albo 0 = nie sprzedawaj).",
                "wzReLiqAge"
            );
        }
    }

    if (stepId === "sabbatical") {
        if (path !== 1 && wzNum("wzTarget", 0) <= 0) {
            return wzValidationError(
                "Podaj docelową wypłatę miesięczną netto.",
                "wzTarget"
            );
        }

        const retirement = wzInt("wzRetirement", 65);
        const planEnd = wzInt("wzPlanEnd", 85);
        const auto = wzIsAutoPlan();
        if (!auto && planEnd <= retirement) {
            return wzValidationError(
                "Horyzont planu musi być późniejszy niż wiek rozpoczęcia emerytury ZUS.",
                "wzPlanEnd"
            );
        }

        if (path !== 3) {
            const re = wzInt("wzRe", 55);
            if (re <= age) {
                return wzValidationError(
                    `Wiek FIRE musi być większy niż obecny wiek (${age}).`,
                    "wzRe"
                );
            }
            if (!auto && retirement < re) {
                return wzValidationError(
                    "Wiek emerytury ZUS nie może być wcześniejszy niż wiek pełnego FIRE. Zwiększ wiek emerytury albo obniż wiek FIRE.",
                    "wzRetirement"
                );
            }
            if (planEnd <= re) {
                return wzValidationError(
                    "Horyzont planu musi być późniejszy niż wiek FIRE.",
                    "wzPlanEnd"
                );
            }
        }

        const style = wzRadio("wzFireStyle", "full");
        if (style === "coast" || style === "barista") {
            const semiAge = wzInt("wzSemiAge", 48);
            if (semiAge <= age) {
                return wzValidationError(
                    "Wiek przejścia na część etatu musi być późniejszy niż obecny wiek.",
                    "wzSemiAge"
                );
            }
            const semiUpper = path === 3 ? retirement : wzInt("wzRe", 55);
            if (semiAge >= semiUpper) {
                return wzValidationError(
                    path === 3
                        ? "Wiek przejścia na część etatu musi być wcześniejszy niż wiek emerytury ZUS."
                        : "Wiek przejścia na część etatu musi być wcześniejszy niż wiek pełnego FIRE.",
                    "wzSemiAge"
                );
            }
            if (wzNum("wzSemiNet", 0) <= 0) {
                return wzValidationError(
                    "Podaj miesięczne zarobki netto na części etatu.",
                    "wzSemiNet"
                );
            }
        }
    }

    if (stepId === "strategia") {
        if (wzIsAutoPlan()) return true;
        if (!wzSuggested || wzSuggestLoading) {
            return wzValidationError(
                "Poczekaj na wyliczenie propozycji podziału oszczędności, a potem przejdź dalej."
            );
        }
        const allocations = wzCurrentAllocations();
        const total = Object.values(allocations).reduce((sum, value) => sum + (value || 0), 0);
        if (total > 100 + 1e-6) {
            return wzValidationError(
                "Suma udziałów nie może przekraczać 100%. Zmniejsz wybrane wartości."
            );
        }
        if (total <= 0 && wzManualAllocationPoolMonthly() > 0) {
            return wzValidationError(
                "Rozdziel wpłaty: użyj kafla „Zacznij od propozycji” albo ustaw udziały. Inaczej cała pula trafi do gotówki."
            );
        }
    }

    return true;
}

function wzValidateForPlan() {
    // Walidujemy wszystkie kroki przed wynikiem, nie tylko dwa ostatnie:
    // użytkownik może wrócić i zmienić wcześniejsze pola, a „Wylicz plan”
    // nie może wtedy pominąć błędów.
    for (const step of wzStepOrder()) {
        if (step === "wynik") break;
        if (!wzValidateStep(step)) return false;
    }
    return true;
}

// --- Propozycja podziału ----------------------------------------------------

async function wzApplyProfileSeed(profile) {
    const path = wzCurrentPath();
    const answers = wzCollectAnswers({ withAllocations: false });
    answers.strategy = WZ_RISK_STRATEGY[profile] || "zbilansowana";
    answers.risk_profile = profile;
    const body = { answers, path };
    if (path !== 1) body.target_monthly = wzNum("wzTarget", 0);
    const seq = ++wzSuggestSeq;
    try {
        const data = await wzPostJson(
            "/api/wizard/suggest",
            body,
            "Nie udało się wypełnić podziału propozycją."
        );
        if (seq !== wzSuggestSeq) return;
        wzSuggested = {
            ...(wzSuggested || {}),
            allocations: data.allocations,
            wrapperVehicles: data.wrapper_vehicles || {},
            assetMix: data.asset_mix || {},
            pool_monthly: data.pool_monthly,
        };
        const seeded = Object.fromEntries(
            WZ_ALLOCATABLE_ACCOUNTS.map((account) => [
                account,
                Number(data.allocations?.[account]) || 0,
            ])
        );
        wzManualVehicles = {};
        WZ_WRAPPER_ACCOUNTS.forEach((wrapper) => {
            const allowed = wzAllowedVehicles(wrapper);
            const vehicle = data.wrapper_vehicles?.[wrapper];
            const chosen = allowed.includes(vehicle)
                ? vehicle
                : wzDefaultVehicleFor(wrapper, profile);
            if (chosen) wzManualVehicles[wrapper] = chosen;
        });
        wzManualAllocations = wzNormalizeManualShares(seeded, { exact: true });
        wzAllocationMode = "manual";
        wzApplyVehiclesToCapitalRows();
        wzSuggestSignature = wzCanonicalJson(body);
        wzRenderManualAllocation();
    } catch (err) {
        alert(err?.message || "Nie udało się wypełnić podziału propozycją.");
    }
}

function wzSuggestBody() {
    const path = wzCurrentPath();
    const body = {
        answers: wzCollectAnswers({ withAllocations: wzAllocationMode === "manual" && path === 2 }),
        path,
        target_monthly: path !== 1 ? wzNum("wzTarget", 0) : null,
    };
    return body;
}

function wzInvalidateSuggestion() {
    wzSuggestSeq += 1;
    wzSuggested = null;
    wzSuggestSignature = "";
    wzSuggestLoading = false;
    wzUpdateAllocationModeControl();
}

function wzScheduleSuggestion() {
    clearTimeout(wzSuggestTimer);
    wzSuggestTimer = setTimeout(() => wzRefreshSuggestion(), 250);
}

function wzRefreshSuggestion() {
    clearTimeout(wzSuggestTimer);
    const body = wzSuggestBody();
    const signature = wzCanonicalJson(body);
    if (wzSuggested && signature === wzSuggestSignature) {
        wzRenderSuggestion();
        return;
    }

    const preserveManualRows = wzAllocationMode === "manual" && Boolean(wzSuggested);
    wzSuggestLoading = true;
    if (preserveManualRows) {
        wzUpdateAllocationModeControl();
        const note = wzEl("wzTaxTipNote");
        if (note) note.textContent = "Przeliczam pulę oszczędności dla ręcznego podziału…";
    } else {
        wzSuggested = null;
        wzRenderSuggestionLoading();
    }
    const seq = ++wzSuggestSeq;
    wzPostJson("/api/wizard/suggest", body, "Błąd sugestii podziału.")
        .then((data) => {
            if (seq !== wzSuggestSeq) return;
            wzSuggestLoading = false;
            wzSuggested = {
                allocations: data.allocations || {},
                wrapperVehicles: data.wrapper_vehicles || {},
                assetMix: data.asset_mix || {},
                pool_monthly: Number(data.pool_monthly) || 0,
                strategyPreviews: data.strategy_previews || {},
                strategyPriorities: data.strategy_priorities || {},
            };
            wzSuggestSignature = signature;
            wzRenderSuggestion();
        })
        .catch((err) => {
            if (seq !== wzSuggestSeq) return;
            wzSuggested = null;
            wzSuggestLoading = false;
            wzRenderSuggestionError(err.message);
        });
}

function wzRenderSuggestionLoading() {
    const box = wzEl("wzSuggestList");
    const note = wzEl("wzTaxTipNote");
    const sumBox = wzEl("wzManualSum");
    if (sumBox) {
        sumBox.hidden = true;
        sumBox.classList.add("hidden");
        sumBox.innerHTML = "";
    }
    const strategyHint = wzEl("wzStrategyHint");
    if (strategyHint) {
        strategyHint.hidden = true;
        strategyHint.classList.add("hidden");
        strategyHint.innerHTML = "";
    }
    wzUpdateAllocationModeControl();
    if (box) {
        box.innerHTML = `
            <div class="wz-suggest-empty">
                <span class="spinner" aria-hidden="true"></span>
                <span>Wyliczam propozycję podziału oszczędności…</span>
            </div>`;
    }
    if (note) note.textContent = "";
}

function wzRenderSuggestionError(message) {
    const box = wzEl("wzSuggestList");
    const note = wzEl("wzTaxTipNote");
    wzSuggestLoading = false;
    if (box) {
        box.innerHTML = `
            <div class="banner banner-warn">
                ${iconSvg("warning")}
                <div class="banner-body">
                    ${escapeHtml(message || "Nie udało się wyliczyć podziału.")}
                    <button type="button" class="btn btn-secondary btn-sm wz-retry-suggest" data-wz-retry-suggest>Ponów</button>
                </div>
            </div>`;
    }
    if (note) note.textContent = "Możesz spróbować ponownie — bez propozycji podziału nie wyliczymy planu.";
    if (wzAllocationMode === "manual") wzAllocationMode = "auto";
    const sumBox = wzEl("wzManualSum");
    if (sumBox) {
        sumBox.hidden = true;
        sumBox.classList.add("hidden");
        sumBox.innerHTML = "";
    }
    const strategyHint = wzEl("wzStrategyHint");
    if (strategyHint) {
        strategyHint.hidden = true;
        strategyHint.classList.add("hidden");
        strategyHint.innerHTML = "";
    }
    wzUpdateAllocationModeControl();
}

function wzUpdateAllocationModeControl() {
    const auto = document.querySelector('input[name="wzAllocationMode"][value="auto"]');
    const manual = document.querySelector('input[name="wzAllocationMode"][value="manual"]');
    const title = wzEl("wzSuggestTitle");
    const manualMode = wzAllocationMode === "manual";

    if (auto) auto.checked = !manualMode;
    if (manual) {
        manual.checked = manualMode;
        manual.disabled = !wzSuggested || wzSuggestLoading;
    }
    if (title) title.textContent = manualMode
        ? "Ręczny podział miesięcznych wpłat"
        : "Proponowany podział oszczędności";
}

function wzFormatAllocationShare(value) {
    return Number(value).toLocaleString("pl-PL", { maximumFractionDigits: 2 });
}

function wzManualShareAttr(value) {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    return String(Math.round(clamped * 10) / 10);
}

function wzManualShareInput(account) {
    return document.querySelector(`.wz-manual-share[data-account="${account}"]`);
}

function wzManualShareRange(account) {
    return document.querySelector(`.wz-manual-share-range[data-account="${account}"]`);
}

function wzSetManualShare(account, value) {
    const input = wzManualShareInput(account);
    const range = wzManualShareRange(account);
    const formatted = wzManualShareAttr(value);
    if (input) input.value = formatted;
    if (range) range.value = formatted;
}

function wzNormalizeManualShares(shares, { exact = false } = {}) {
    const units = WZ_ALLOCATABLE_ACCOUNTS.map((account) => ({
        account,
        units: Math.max(0, Math.round((Number(shares[account]) || 0) * 10)),
    }));
    const total = units.reduce((sum, item) => sum + item.units, 0);
    if (total === 0) return Object.fromEntries(
        WZ_ALLOCATABLE_ACCOUNTS.map((account) => [account, 0])
    );
    const needsNormalize = total > 1000 || exact;
    if (!needsNormalize) {
        return Object.fromEntries(units.map(({ account, units: value }) => [account, value / 10]));
    }
    const scaled = units.map(({ account, units: value }) => ({
        account,
        units: Math.floor(value * 1000 / total),
    }));
    let residual = 1000 - scaled.reduce((sum, item) => sum + item.units, 0);
    while (residual > 0) {
        const largest = scaled.reduce(
            (best, item) => (item.units > best.units ? item : best),
            scaled[0]
        );
        largest.units += 1;
        residual -= 1;
    }
    const normalized = Object.fromEntries(
        scaled.map(({ account, units: value }) => {
            wzSetManualShare(account, value / 10);
            return [account, value / 10];
        })
    );
    return normalized;
}

function wzManualAllocationMaxShare(account, poolAnnual) {
    const cap = wzManualAllocationCap(account);
    if (cap <= 0 || poolAnnual <= 0) return 100;
    const share = (cap / poolAnnual) * 100;
    return Math.max(0, Math.min(100, Math.ceil((share - 1e-9) * 10) / 10));
}

function wzRenderManualAllocation() {
    const box = wzEl("wzSuggestList");
    if (!box || !wzSuggested) return;
    wzSeedManualAllocations();
    wzSeedManualVehicles();
    box.innerHTML = `
        <div class="wz-manual-alloc-grid" role="table" aria-label="Ręczny podział oszczędności">
            <div class="wz-manual-alloc-head" role="row">
                <span role="columnheader">Produkt</span>
                <span role="columnheader">Udział</span>
                <span role="columnheader">Miesięcznie</span>
                <span role="columnheader">Rocznie</span>
            </div>
            <div class="wz-manual-alloc-list" role="rowgroup">
                <div class="wz-manual-alloc-row wz-manual-cash-row" role="row" data-account="gotowka">
                    <span class="wz-manual-alloc-name" role="rowheader">${wzAccountIcon("gotowka")}Gotówka (reszta)<span class="wz-manual-cash-state" aria-hidden="true"></span></span>
                    <span class="wz-manual-share-readonly" role="cell" data-label="Udział">—</span>
                    <span class="wz-manual-monthly" role="cell" data-label="Miesięcznie">0 zł/mies.</span>
                    <span class="wz-manual-annual" role="cell" data-label="Rocznie">0 zł/rok</span>
                </div>
                ${WZ_ALLOCATABLE_ACCOUNTS.map((account) => `
                    <div class="wz-manual-alloc-row" role="row" data-account="${account}">
                        <span class="wz-manual-alloc-name" role="rowheader">
                            ${wzAccountIcon(account)}${escapeHtml(wzAccountLabel(account))}
                            ${WZ_WRAPPER_ACCOUNTS.includes(account) ? `
                                <span class="wz-manual-vehicle">
                                    <select class="wz-vehicle-select" data-account="${account}" aria-label="Rodzaj inwestycji w ${escapeHtml(wzAccountLabel(account))}">
                                        ${wzVehicleOptionsHtml(account)}
                                    </select>
                                    <span class="wz-vehicle-roi">${escapeHtml(wzVehicleRoiNote(account))}</span>
                                </span>` : ""}
                        </span>
                        <div class="wz-manual-share-field" role="cell">
                            <span class="wz-field-label wz-manual-share-mobile-label">Udział (%)</span>
                            ${numControlsHtml({
                                value: wzManualShareAttr(wzManualAllocations[account] || 0),
                                min: "0",
                                max: "100",
                                step: "0.1",
                                fieldClass: "wz-manual-share",
                                attrs: `data-account="${account}"`,
                                aria: `Udział ${wzAccountLabel(account)} procent`,
                            })}
                            <input type="range" class="range wz-manual-share-range"
                                   data-account="${account}" min="0" max="100" step="0.1"
                                   value="${wzManualShareAttr(wzManualAllocations[account] || 0)}"
                                   aria-label="Udział ${escapeHtml(wzAccountLabel(account))} suwak">
                        </div>
                        <span class="wz-manual-monthly" role="cell" data-label="Miesięcznie">0 zł/mies.</span>
                        <span class="wz-manual-annual" role="cell" data-label="Rocznie">0 zł/rok</span>
                        <span class="wz-manual-cap-note" hidden></span>
                    </div>`).join("")}
            </div>
        </div>`;
    wzUpdateManualAllocationAmounts();
}

function wzUpdateManualAllocationAmounts() {
    if (wzAllocationMode !== "manual") return;
    if (!document.querySelector(".wz-manual-share")) return;
    let shares = wzManualAllocationShares();
    wzManualAllocations = { ...shares };
    const pool = wzManualAllocationPoolMonthly();
    const poolAnnual = pool * 12;
    const totalShare = Object.values(shares).reduce(
        (sum, share) => sum + (Number(share) || 0),
        0
    );

    const freeShare = Math.max(0, 100 - totalShare);
    const allocations = WZ_ALLOCATABLE_ACCOUNTS.map((account) => {
        const share = Math.max(0, Number(shares[account]) || 0);
        const accountCap = wzManualAllocationMaxShare(account, poolAnnual);
        const max = Math.min(accountCap, share + freeShare);
        const input = wzManualShareInput(account);
        const range = wzManualShareRange(account);
        if (input) input.max = wzManualShareAttr(max);
        if (range) {
            range.max = wzManualShareAttr(max);
            if (input) range.value = input.value;
        }
        const requestedAnnual = poolAnnual * share / 100;
        const cap = wzManualAllocationCap(account);
        const allocated = cap > 0 ? Math.min(requestedAnnual, cap) : requestedAnnual;
        return {
            account,
            requestedAnnual,
            cap,
            allocated,
            atMax: cap > 0 && share >= max - 0.05,
            overCap: cap > 0 && share > max + 0.05,
            maxShare: max,
        };
    });

    let allocatedAnnual = allocations.reduce((sum, item) => sum + item.allocated, 0);
    let cashAnnual = Math.max(0, poolAnnual - allocatedAnnual);
    const overCapAny = allocations.some((item) => item.atMax);

    // Ten sam próg co backend (_resolve_allocation): drobna reszta po
    // zaokrągleniach/limitach nie ma udawać gotówki.
    if (cashAnnual > 0 && cashAnnual <= WZ_TINY_CASH_ANNUAL) {
        const uncapped = allocations.filter((item) => item.cap <= 0 && item.allocated > 0);
        if (uncapped.length) {
            const biggest = uncapped.reduce(
                (best, item) => (item.allocated > best.allocated ? item : best)
            );
            biggest.allocated += cashAnnual;
            allocatedAnnual += cashAnnual;
            cashAnnual = 0;
        }
    }

    allocations.forEach(({ account, cap, allocated, atMax, overCap }) => {
        const row = document.querySelector(`.wz-manual-alloc-row[data-account="${account}"]`);
        if (!row) return;
        row.querySelector(".wz-manual-monthly").textContent = `${fmtMoney(allocated / 12)}/mies.`;
        row.querySelector(".wz-manual-annual").textContent = `${fmtMoney(allocated)}/rok`;
        const capNote = row.querySelector(".wz-manual-cap-note");
        capNote.hidden = cap <= 0;
        capNote.classList.toggle("is-warning", overCap || (atMax && cashAnnual > 0.5));
        if (cap > 0) {
            capNote.textContent = `Limit roczny: ${fmtMoney(cap)}`;
            if (overCap || (atMax && cashAnnual > 0.5)) {
                capNote.textContent += " — nadwyżka w gotówce";
            }
        } else {
            capNote.textContent = "";
        }
    });

    const cashMonthly = cashAnnual / 12;
    const cashShare = poolAnnual > 0 ? (cashAnnual / poolAnnual) * 100 : 0;
    const cashPositive = cashAnnual > 0.5;
    const cashRow = document.querySelector('.wz-manual-alloc-row[data-account="gotowka"]');
    if (cashRow) {
        cashRow.classList.toggle("is-clear", !cashPositive);
        cashRow.classList.toggle("is-warning", cashPositive);
        cashRow.querySelector(".wz-manual-share-readonly").textContent = `${wzFormatAllocationShare(cashShare)}%`;
        cashRow.querySelector(".wz-manual-monthly").textContent = `${fmtMoney(cashMonthly)}/mies.`;
        cashRow.querySelector(".wz-manual-annual").textContent = `${fmtMoney(cashAnnual)}/rok`;
        const state = cashRow.querySelector(".wz-manual-cash-state");
        if (state) state.innerHTML = cashPositive ? iconSvg("warning") : iconSvg("check");
    }

    const sumBox = wzEl("wzManualSum");
    if (sumBox) {
        const complete = Math.abs(totalShare - 100) <= 0.05;
        const extra = complete && cashPositive
            ? (overCapAny ? " · nadwyżka z limitów w gotówce" : " · nadwyżka w gotówce")
            : "";
        const chipClass = complete
            ? (cashPositive ? "chip-warn" : "chip-success")
            : "";
        sumBox.hidden = false;
        sumBox.classList.remove("hidden");
        const mix = wzAssetMixLabel(wzAssetMixForShares(shares));
        sumBox.innerHTML = `<span class="chip ${chipClass}">${complete && !cashPositive ? iconSvg("check") : ""}Suma udziałów: ${wzFormatAllocationShare(totalShare)}%${extra}</span>${mix ? `<span class="chip">${escapeHtml(mix)}</span>` : ""}`;
    }
    const note = wzEl("wzTaxTipNote");
    if (note) note.textContent = "";
}

function wzOnVehicleChange(select) {
    const wrapper = select?.dataset?.account;
    if (!WZ_WRAPPER_ACCOUNTS.includes(wrapper)) return;
    wzManualVehicles[wrapper] = select.value;
    const capitalRoi = wzWrapperCapitalRoiInput(wrapper);
    if (capitalRoi && capitalRoi.dataset.roiEdited !== "true") {
        const roi = wzVehicleRoi(select.value);
        if (roi != null) {
            capitalRoi.value = (roi * 100).toFixed(1);
            capitalRoi.dataset.defaultRoi = capitalRoi.value;
            wzSyncRoiReset(capitalRoi);
        }
    }
    const note = select.closest(".wz-manual-vehicle")?.querySelector(".wz-vehicle-roi");
    if (note) note.textContent = wzVehicleRoiNote(wrapper);
    wzTouch();
    wzFormVersion += 1;
    wzPlan = null;
    wzPlanSignature = "";
    wzPlanBodyCache = null;
    wzScheduleStateSave();
    if (wzCurrentPath() === 2) {
        wzScheduleSuggestion();
    } else {
        wzUpdateManualAllocationAmounts();
    }
}

function wzUpdateManualAllocationInput(target) {
    const range = target?.matches?.(".wz-manual-share-range") ? target : null;
    const account = range?.dataset.account || target?.dataset.account;
    const input = range
        ? wzManualShareInput(account)
        : (target?.matches?.(".wz-manual-share") ? target : null);
    if (input && range) input.value = range.value;
    if (input && account) {
        const shares = wzManualAllocationShares();
        const othersTotal = Object.entries(shares)
            .filter(([key]) => key !== account)
            .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
        const free = Math.max(0, 100 - othersTotal);
        const capShare = wzManualAllocationMaxShare(
            account,
            wzManualAllocationPoolMonthly() * 12
        );
        const max = Math.min(capShare, free);
        const current = Math.max(0, Math.min(max, parseFloat(input.value) || 0));
        input.value = wzManualShareAttr(current);
        const pairedRange = wzManualShareRange(account);
        if (pairedRange) pairedRange.value = input.value;
        wzManualAllocations = { ...shares, [account]: current };
    } else {
        wzManualAllocations = wzManualAllocationShares();
    }
    wzFormVersion += 1;
    wzPlan = null;
    wzPlanSignature = "";
    wzPlanBodyCache = null;
    wzUpdateManualAllocationAmounts();
    wzRenderIkzeRefundNote(
        Object.entries(wzManualAllocations || {}).filter(
            ([, share]) => Number(share) > 0
        )
    );
    wzScheduleStateSave();
    if (wzCurrentPath() === 2) {
        wzSuggestLoading = true;
        wzUpdateAllocationModeControl();
        const note = wzEl("wzTaxTipNote");
        if (note) note.textContent = "Przeliczam wymaganą pulę dla ręcznego podziału…";
        wzScheduleSuggestion();
    }
}

function wzSetAllocationMode(mode) {
    if (mode === "manual" && !wzSuggested) {
        wzUpdateAllocationModeControl();
        return;
    }
    const nextMode = mode === "manual" ? "manual" : "auto";
    if (nextMode === wzAllocationMode) return;
    wzAllocationMode = nextMode;
    if (wzAllocationMode === "manual") wzSeedManualAllocations();
    wzFormVersion += 1;
    wzPlan = null;
    wzPlanSignature = "";
    wzPlanBodyCache = null;
    wzScheduleStateSave();
    if (wzCurrentPath() === 2) {
        wzSuggestSeq += 1;
        wzSuggestSignature = "";
        wzSuggestLoading = true;
        wzUpdateAllocationModeControl();
        wzRenderSuggestion();
        const note = wzEl("wzTaxTipNote");
        if (note) note.textContent = "Przeliczam pulę oszczędności dla tego podziału…";
        wzScheduleSuggestion();
        return;
    }
    wzUpdateAllocationModeControl();
    wzRenderSuggestion();
}

function wzStrategyPriorityHtml(accounts) {
    const priority = (accounts || []).filter(Boolean);
    if (!priority.length) {
        return '<span class="wz-strategy-empty">Brak nowych wpłat</span>';
    }
    const visible = priority.slice(0, 5);
    const rest = priority.slice(5);
    const rows = visible.map((account, index) => `
        <span class="wz-strategy-rank-row">
            <span class="wz-strategy-rank-num">${index + 1}</span>
            <span class="wz-strategy-rank-icon">${wzAccountIcon(account)}</span>
            <span class="wz-strategy-rank-name">${escapeHtml(wzAccountLabel(account))}</span>
        </span>`);
    if (rest.length) {
        const full = priority.map((account) => wzAccountLabel(account)).join(" → ");
        rows.push(`
            <span class="wz-strategy-more">
                <span>…i ${rest.length} dalsze</span>${tipHtml(full)}
            </span>`);
    }
    return rows.join("");
}

function wzStrategyPreviewsAllSame() {
    const previews = wzSuggested?.strategyPreviews || {};
    const keys = ["konserwatywna", "zbilansowana", "agresywna"];
    if (!keys.every((key) => previews[key])) return false;
    const first = wzCanonicalJson(previews[keys[0]]);
    return keys.every((key) => wzCanonicalJson(previews[key]) === first);
}

function wzRenderStrategyPreviews() {
    const priorities = wzSuggested?.strategyPriorities || {};
    const previews = wzSuggested?.strategyPreviews || {};
    document.querySelectorAll("[data-strategy-rank]").forEach((el) => {
        const key = el.dataset.strategyRank;
        const accounts = priorities[key] || Object.keys(previews[key] || {});
        el.innerHTML = wzStrategyPriorityHtml(accounts);
    });
    const allSame = wzStrategyPreviewsAllSame();
    const selected = wzRadio("wzStrategy", "zbilansowana");
    const expanded = wzStrategyExpanded || !allSame;
    document.querySelectorAll("[data-strategy-card]").forEach((card) => {
        const key = card.dataset.strategyCard;
        card.hidden = !expanded && key !== selected;
    });
    const showAll = wzEl("wzStrategyShowAll");
    if (showAll) {
        showAll.classList.toggle("hidden", !allSame);
        showAll.textContent = expanded ? "Ukryj inne strategie" : "Pokaż inne strategie";
    }

    const hint = wzEl("wzStrategyHint");
    if (!hint) return;
    const pool = Number(wzSuggested?.pool_monthly) || 0;
    if (allSame && pool > 0 && wzAllocationMode !== "manual") {
        hint.hidden = false;
        hint.classList.remove("hidden");
        hint.innerHTML = `<div class="banner banner-info">${iconSvg("info")}<div class="banner-body">Przy tej puli wszystkie strategie dają ten sam podział — cała kwota mieści się w limitach IKE i IKZE.</div></div>`;
    } else {
        hint.hidden = true;
        hint.classList.add("hidden");
        hint.innerHTML = "";
    }
}

function wzRenderIkzeRefundNote(entries) {
    const note = wzEl("wzIkzeRefundNote");
    if (!note) return;
    const hasIkze = (entries || []).some(
        ([account]) => wzBaseKey(account) === "ikze"
    );
    note.classList.toggle("hidden", !hasIkze);
    note.hidden = !hasIkze;
    if (!hasIkze) {
        note.innerHTML = "";
        return;
    }
    const order = [
        "IKE",
        "OIPE",
        "Obligacje",
        "Lokata",
        "OKI oszczędnościowe",
        "Broker",
        "Gotówka",
    ].join(" → ");
    note.innerHTML = `${iconSvg("info")}<span>Ulga IKZE wraca co roku i jest reinwestowana.${tipHtml(
        `Kolejność: ${order}. IKE i OIPE tylko do rocznego limitu. Zwrot trafia na konto docelowe, jeśli jest w planie; inaczej tylko obniża podatek. To dodatkowy kapitał poza miesięczną pulą.`
    )}</span>`;
}

function wzRenderSuggestion() {
    const box = wzEl("wzSuggestList");
    const note = wzEl("wzTaxTipNote");
    if (!box || !wzSuggested) {
        wzRenderIkzeRefundNote([]);
        return;
    }

    wzRenderStrategyPreviews();
    wzUpdateAllocationModeControl();
    if (wzAllocationMode === "manual") {
        wzRenderManualAllocation();
        wzRenderIkzeRefundNote(
            Object.entries(wzManualAllocations || {}).filter(
                ([, share]) => Number(share) > 0
            )
        );
        return;
    }
    const sumBox = wzEl("wzManualSum");
    if (sumBox) {
        sumBox.hidden = true;
        sumBox.classList.add("hidden");
        sumBox.innerHTML = "";
    }

    const pool = Number(wzSuggested.pool_monthly) || 0;
    const entries = Object.entries(wzSuggested.allocations || {})
        .filter(([, pct]) => pct > 0)
        .sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
        box.innerHTML = `
            <div class="wz-suggest-empty">
                <span>Brak nowych wpłat do podziału — plan obejmie tylko posiadany kapitał.</span>
            </div>`;
        wzRenderIkzeRefundNote([]);
        if (note) note.textContent = "Możesz zwiększyć miesięczne oszczędności, aby zobaczyć propozycję podziału.";
        return;
    }

    wzRenderIkzeRefundNote(entries);

    box.innerHTML = entries.map(([account, pct]) => {
        const monthly = (pool * pct) / 100;
        const base = wzBaseKey(account);
        const vehicle = wzSuggested.wrapperVehicles?.[base];
        const suffix = vehicle ? ` · ${wzVehicleLabel(vehicle)}` : "";
        return `
            <div class="wz-suggest-row">
                <span class="wz-suggest-icon">${wzAccountIcon(account)}</span>
                <span class="wz-suggest-name">${escapeHtml(wzAccountLabel(account))}${escapeHtml(suffix)}</span>
                <span class="wz-suggest-pct">${escapeHtml(wzFormatPercent(pct))}</span>
                <span class="wz-suggest-amount">${fmtMoney(monthly)}<span class="wz-suggest-unit">/mies.</span></span>
            </div>`;
    }).join("");

    if (note) {
        const parts = [];
        if (pool > 0) parts.push(`Pula: ${fmtMoney(pool)}/mies.`);
        if (wzEmployment() === "b2b") {
            parts.push("Na B2B limit IKZE jest wyższy niż na etacie.");
        } else if (entries.some(([account]) => account === "ikze")) {
            parts.push("Wpłaty na IKZE odliczasz od podatku dochodowego.");
        }
        parts.push("Możesz przełączyć się na tryb Ręczny i zmienić udziały produktów.");
        note.textContent = parts.join(" ");
    }
}

// --- Wyliczanie i renderowanie planu ---------------------------------------

function wzShowLoader(showLoader) {
    const loader = wzEl("wzPlanLoader");
    loader?.classList.toggle("hidden", !showLoader);
    if (showLoader) {
        wzMilestoneTipHide();
        wzUpdateLoaderText();
        clearInterval(wzLoaderTimer);
        wzLoaderTimer = setInterval(wzUpdateLoaderText, 6000);
    } else {
        clearInterval(wzLoaderTimer);
        wzLoaderTimer = null;
    }
    const result = wzEl("wzResult");
    if (showLoader && result) result.classList.add("hidden");
}

function wzShuffleLoaderTips() {
    const tips = [...WZ_PLAN_LOADER_TIPS];
    for (let i = tips.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [tips[i], tips[j]] = [tips[j], tips[i]];
    }
    return tips;
}

function wzNextLoaderTip() {
    if (!wzLoaderTipBag.length) wzLoaderTipBag = wzShuffleLoaderTips();
    let tip = wzLoaderTipBag.pop();
    if (tip === wzLoaderLastTip && wzLoaderTipBag.length) {
        const swap = wzLoaderTipBag.pop();
        wzLoaderTipBag.push(tip);
        tip = swap;
    }
    wzLoaderLastTip = tip;
    return tip;
}

function wzUpdateLoaderText() {
    const tip = wzEl("wzLoaderTip");
    if (!tip) return;
    const text = wzNextLoaderTip();
    tip.innerHTML = `<span class="wz-loader-tip-icon">${iconSvg("sun")}</span>
        <span class="wz-loader-tip-body">
            <span class="wz-loader-tip-label">Warto wiedzieć</span>
            <span class="wz-loader-tip-text">${escapeHtml(text)}</span>
        </span>`;
}

function wzRetryAfterSeconds(value) {
    const parsed = parseInt(value || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function wzRunPlan({ validated = false } = {}) {
    if (wzPlanLoading) return;
    if (!validated && !wzValidateForPlan()) return;

    const body = wzPlanBody();
    const seq = ++wzPlanSeq;
    const version = wzFormVersion;
    wzPlanLoading = true;
    wzShowLoader(true);
    wzUpdateActions();

    const errorBox = wzEl("wzResultError");
    if (errorBox) {
        errorBox.classList.add("hidden");
        errorBox.textContent = "";
    }

    try {
        const data = await wzPostJson("/api/wizard/plan", body, "Błąd planowania.");
        if (seq !== wzPlanSeq) return;
        wzPlan = data;
        wzPlanSignature = wzCanonicalJson(body);
        wzPlanBodyCache = body;
        wzSelectedScenario = "realne";
        if (version !== wzFormVersion) {
            // Odpowiedź dotyczy starszych odpowiedzi — nie pokazujemy jej.
            wzPlan = null;
            wzPlanSignature = "";
            wzPlanBodyCache = null;
            return;
        }
        wzEl("wzResult")?.classList.remove("hidden");
        wzEl("wzResultError")?.classList.add("hidden");
        wzRenderResult(data);
        wzSavePlanCache();
    } catch (err) {
        if (seq !== wzPlanSeq) return;
        wzPlan = null;
        wzPlanSignature = "";
        wzPlanBodyCache = null;
        const result = wzEl("wzResult");
        if (result) result.classList.remove("hidden");
        if (errorBox) {
            if (err?.status === 429) {
                const seconds = wzRetryAfterSeconds(err.retryAfter);
                const waitText = seconds ? ` Spróbuj ponownie za ${seconds} s.` : "";
                errorBox.innerHTML = `${iconSvg("danger")}<div class="banner-body">
                    <p>Zbyt wiele zapytań do planera.${waitText}</p>
                    <button type="button" class="btn btn-secondary btn-sm" data-wz-retry-plan>Ponów</button>
                </div>`;
            } else {
                errorBox.innerHTML = `${iconSvg("danger")}<div class="banner-body">${escapeHtml(err.message)}</div>`;
            }
            errorBox.classList.remove("hidden");
        }
    } finally {
        if (seq === wzPlanSeq) {
            wzPlanLoading = false;
            wzShowLoader(false);
            wzUpdateActions();
        }
    }
}

function wzActiveScenarioData(data) {
    const key = wzSelectedScenario;
    return {
        projection: data.scenario_projections?.[key] || data.projection || {},
        solved: data.scenario_solved?.[key] || data.solved || {},
        input: data.scenario_inputs?.[key] || data.input,
    };
}

function wzInputHorizonAge(input) {
    const maxAge = Number(input?.max_age);
    return Number.isFinite(maxAge) ? maxAge + 1 : null;
}

function wzOptimizerMixLabel(candidate) {
    const entries = Object.entries(candidate?.allocations || {})
        .filter(([, value]) => Number(value) > 0.01)
        .sort((a, b) => Number(b[1]) - Number(a[1]));
    if (!entries.length) return "—";
    const visible = entries.slice(0, 3).map(([account, value]) => {
        const base = wzBaseKey(account);
        const vehicle = candidate?.vehicles?.[base];
        const suffix = vehicle ? ` (${wzVehicleLabel(vehicle).toLowerCase()})` : "";
        return `${wzAccountLabel(account)}${suffix} ${Math.round(Number(value))}%`;
    });
    if (entries.length > 3) visible.push(`+${entries.length - 3}`);
    return visible.join(" · ");
}

function wzAssetMixLabel(mix) {
    if (!mix || !Object.keys(mix).length) return "";
    const labels = { safe: "bezpieczne", market: "rynkowe", high: "krypto" };
    return Object.entries(labels)
        .filter(([key]) => Number(mix[key]) > 0.01)
        .map(([key, label]) => `${label} ${Math.round(Number(mix[key]))}%`)
        .join(" · ");
}

function wzRenderStageSummaryFromResult(input, result, projection) {
    const box = wzEl("wzStageSummary");
    if (!box || !input || !result) return;
    const stages = typeof computeStageSummaries === "function"
        ? computeStageSummaries(input, result)
        : [];
    if (!stages.length) {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
    }
    const rows = stages.map((stage) => {
        const isAccum = stage.type === "akumulacja";
        const accountKeys = (stage.accounts || []).map((account) => account.key || account);
        const isZus = !isAccum && accountKeys.length > 0
            && accountKeys.every((key) => key === "zus");
        const stageClass = isAccum ? "is-accum" : isZus ? "is-zus" : "is-real";
        const accounts = (stage.accounts || [])
            .filter((account) => {
                const key = account.key || account;
                if (isAccum) {
                    if (key === "zus") return false;
                    return (account.monthly || 0) > 0 || (account.balance || 0) > 0;
                }
                return !(key === "zus" && stage.end_age <= 65 && accountKeys.length > 1);
            })
            .map((account) => `<span class="chip">${escapeHtml(accountDisplayLabel(account.key || account))}</span>`)
            .join("");
        const phase = (projection?.phase_metrics || []).find(
            (item) => item.cashflow === "payout"
                && item.start_age < stage.end_age
                && item.end_age > stage.start_age
        );
        const monthly = isAccum
            ? stage.total_monthly
            : (stage.avg_withdrawal || phase?.monthly || phase?.zus_monthly || 0);
        const finance = monthly > 0 ? `~${formatMoney(monthly)}/mies.` : "";
        return `<div class="stage-line ${stageClass}">
            <span class="stage-dot ${isAccum ? "accum" : "withdraw"}"></span>
            <span class="stage-label ${isAccum ? "accum" : "withdraw"}">${escapeHtml(stage.label)}</span>
            <span class="stage-age">${stage.start_age}→${stage.end_age} r.ż.</span>
            ${accounts}
            ${finance ? `<span class="stage-finance ${isAccum ? "accum" : "withdraw"}">${finance}</span>` : ""}
        </div>`;
    }).join("");
    box.classList.remove("hidden");
    box.innerHTML = `<h4 class="wz-plan-subhead">Etapy</h4>${rows}`;
}

function wzZusEndAge(input) {
    const stages = input?.stages || [];
    const ends = stages
        .filter((stage) => stage.stage_type === "realizacja" && (stage.accounts || {}).zus)
        .map((stage) => Number(stage.end_age))
        .filter((age) => Number.isFinite(age));
    return ends.length ? Math.max(...ends) : null;
}

function wzPostHorizonRow(input, result) {
    const summary = result?.summary || {};
    if (!summary.has_pension) return null;
    const lastAge = Number(summary.end_age);
    const zusEndAge = wzZusEndAge(input);
    const monthly = Number(summary.zus_monthly) || 0;
    if (!Number.isFinite(lastAge) || zusEndAge == null || lastAge + 1 > zusEndAge) return null;
    if (monthly <= 0.5) return null;
    return {
        ageLabel: `${lastAge + 1}+`,
        stageName: "Tylko ZUS (po horyzoncie)",
        monthly,
        annual: monthly * 12,
        title: `Po horyzoncie planu pokazujemy samą emeryturę ZUS. Kwota netto miesięcznie: ${wzFmtZloty(monthly)} zł.`,
    };
}

function wzRenderYearTableFromResult(result, input) {
    const box = wzEl("wzYearTable");
    if (!box || !window.ResultsTable) return;
    window.ResultsTable.render(box, {
        result,
        density: 5,
        embedded: true,
        postHorizon: wzPostHorizonRow(input, result),
    });
}

function wzLoadFullResult(input, scenarioKey) {
    if (!input) return;
    const key = scenarioKey || wzSelectedScenario;
    if (wzPlanSignature !== wzFullResultsSignature) {
        wzFullResults.clear();
        wzFullResultsSignature = wzPlanSignature;
    }
    const cached = wzFullResults.get(key);
    if (cached) {
        // Unieważnij ewentualną odpowiedź w locie dla innego scenariusza.
        wzFullResultSeq += 1;
        wzRenderStageSummaryFromResult(input, cached, cached.projection);
        wzRenderYearTableFromResult(cached, input);
        return;
    }
    const stageBox = wzEl("wzStageSummary");
    const tableBox = wzEl("wzYearTable");
    if (stageBox) {
        stageBox.classList.remove("hidden");
        stageBox.innerHTML = '<p class="field-hint">Liczę etapy…</p>';
    }
    if (tableBox) {
        tableBox.innerHTML = '<p class="field-hint">Liczę tabelę rok po roku…</p>';
    }
    const seq = ++wzFullResultSeq;
    fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    })
        .then((response) => {
            if (!response.ok) throw new Error("simulate");
            return response.json();
        })
        .then((result) => {
            if (seq !== wzFullResultSeq) return;
            wzFullResults.set(key, result);
            wzRenderStageSummaryFromResult(input, result, result.projection);
            wzRenderYearTableFromResult(result, input);
        })
        .catch(() => {
            if (seq !== wzFullResultSeq) return;
            if (stageBox) stageBox.classList.add("hidden");
            if (tableBox) {
                tableBox.innerHTML = '<p class="field-hint">Nie udało się wczytać tabeli rok po roku.</p>';
            }
        });
}

function wzRenderResult(data) {
    const result = wzEl("wzResult");
    if (!result || !data) return;
    result.classList.remove("hidden");
    wzEl("wzResultError")?.classList.add("hidden");
    const active = wzActiveScenarioData(data);
    wzRenderHero(data);
    wzRenderScenarios(data);
    wzRenderMetrics(data);
    wzRenderPlanWhy(data);
    const warnings = (active.projection?.warnings || []).filter(
        (warning) => !(
            active.projection?.early_return_total > 0
            && warning.startsWith("IKZE:")
            && warning.includes("wcześniejszy zwrot")
        )
    );
    wzRenderWarnings(warnings);
    const summary = data.scenario_summaries?.[wzSelectedScenario]
        || data.summary
        || active.projection?.summary
        || {};
    wzRenderTimeline(active.input, active.projection);
    wzRenderAccountFlows(active.input, active.projection);
    wzRenderCharts(active.input, active.projection, summary);
    wzRenderFacts(active.projection, data);
    wzRenderPolicy(active.projection);
    wzLoadFullResult(active.input, wzSelectedScenario);
}

function wzRenderPlanWhy(data) {
    const box = wzEl("wzPlanWhy");
    if (!box) return;
    const optimization = data.optimization;
    if (!optimization?.recommended) {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
    }
    const rec = optimization.recommended;
    const baseline = optimization.baseline;
    const totalObjective = optimization.objective === "total";
    const delta = totalObjective
        ? (rec.total_withdrawn || 0) - (baseline?.total_withdrawn || 0)
        : (rec.payout_monthly || 0) - (baseline?.payout_monthly || 0);
    const objectiveText = totalObjective
        ? "najwyższą sumę wypłat"
        : "najwyższą wypłatę miesięczną";
    const mix = wzOptimizerMixLabel(rec);
    const deltaText = delta > 1
        ? ` o ${Math.round(delta).toLocaleString("pl-PL")} zł więcej niż wariant bazowy`
        : "";
    const summary = delta > 1
        ? `ZUS od ${rec.zus_start_age} r.ż., ${mix} — ${objectiveText}${deltaText}.`
        : `Nie znaleźliśmy lepszego wariantu niż Twój bazowy — zostaje ZUS od ${rec.zus_start_age} r.ż. i ${mix}.`;
    const tip = tipHtml(
        "Silnik porównał kilka wariantów wieku rozpoczęcia ZUS i podziału wpłat IKE/IKZE. "
        + "Wybrany wariant jest najlepszy według wybranego priorytetu. "
        + "Wiek ZUS i podział wpłat wybranego wariantu znajdziesz w podsumowaniu planu."
    );
    box.innerHTML = `<span class="wz-why-label">Dlaczego ten plan?</span> ${escapeHtml(summary)}${tip}`;
    box.classList.remove("hidden");
}

function wzRenderHero(data) {
    const box = wzEl("wzHeroAnswer");
    if (!box) return;
    const fmt = (value) => (value == null ? "—" : Math.round(value).toLocaleString("pl-PL"));
    const path = data.path || wzCurrentPath();
    const { projection: proj, solved, input } = wzActiveScenarioData(data);
    const scenarioLabel = data.scenarios?.[wzSelectedScenario]?.label || "";
    const kicker = `${wzQuestionForPath(path)}${scenarioLabel ? ` · ${scenarioLabel}` : ""}`;

    box.classList.toggle("is-warn", !solved.feasible || !proj.met);

    if (path === 1) {
        const payout = proj.min_monthly || 0;
        const reAge = solved.retire_early_age ?? input?.retire_early_age ?? wzInt("wzRe", 55);
        const endAge = wzInputHorizonAge(input) ?? wzInt("wzPlanEnd", 85);
        const totalObjective = data.optimization?.objective === "total";
        if (solved.feasible && proj.met && payout > 0) {
            if (totalObjective) {
                const baseScenario = !data.scenarios?.[wzSelectedScenario]
                    || wzSelectedScenario === "realne";
                const sourceNote = baseScenario
                    ? "Plan jest dobrany pod najwyższą sumę wypłat."
                    : "Podział i wiek ZUS pochodzą z wariantu Realne; ten scenariusz zmienia tylko założenia rynkowe.";
                box.innerHTML = `
                    <div class="wz-hero-kicker">${escapeHtml(kicker)}</div>
                    <div class="wz-hero-headline">Możesz wypłacać co najmniej ${fmt(payout)} zł/mies. netto</div>
                    <div class="wz-hero-desc">Wariant pod najwyższą sumę: łącznie <strong>${fmt(proj.total_withdrawn)} zł</strong> do ${endAge}. roku życia, średnio ${fmt(proj.mean_monthly)} zł/mies. ${escapeHtml(sourceNote)}</div>`;
            } else {
                box.innerHTML = `
                    <div class="wz-hero-kicker">${escapeHtml(kicker)}</div>
                    <div class="wz-hero-headline">Możesz wypłacać ${fmt(payout)} zł/mies. netto</div>
                    <div class="wz-hero-desc">Od ${reAge}. do ${endAge}. roku życia Twój budżet netto wyniesie co najmniej <strong>${fmt(payout)} zł/mies.</strong> — portfel, ZUS i ewentualna praca na część etatu, po racie kredytu.</div>`;
            }
        } else {
            box.innerHTML = `
                <div class="wz-hero-kicker">${escapeHtml(kicker)}</div>
                <div class="wz-hero-headline">Plan wymaga korekty założeń</div>
                <div class="wz-hero-desc">${escapeHtml(solved.note || proj.warnings?.[0] || "Zwiększ oszczędności, wydłuż horyzont lub obniż oczekiwania.")}</div>`;
        }
        return;
    }

    if (path === 2) {
        const target = proj.target_monthly || wzNum("wzTarget", 0);
        const savings = solved.savings_monthly;
        if (solved.feasible && savings != null) {
            const pct = solved.savings_pct != null
                ? ` (${solved.savings_pct.toLocaleString("pl-PL")}% pensji netto)`
                : "";
            box.innerHTML = `
                <div class="wz-hero-kicker">${escapeHtml(kicker)}</div>
                <div class="wz-hero-headline">Odkładaj ${fmt(savings)} zł/mies.${pct}</div>
                <div class="wz-hero-desc">Tyle wystarczy odkładać, aby osiągnąć docelową wypłatę <strong>${fmt(target)} zł/mies. netto</strong> przez cały wybrany horyzont czasowy.</div>`;
        } else {
            box.innerHTML = `
                <div class="wz-hero-kicker">${escapeHtml(kicker)}</div>
                <div class="wz-hero-headline">Cel ${fmt(target)} zł/mies. wymaga korekty założeń</div>
                <div class="wz-hero-desc">${escapeHtml(solved.note || "Rozważ późniejszy wiek FIRE lub niższy cel wypłaty.")}</div>`;
        }
        return;
    }

    const target = proj.target_monthly || wzNum("wzTarget", 0);
    const re = solved.retire_early_age;
    const ageNow = input?.age_now ?? wzInt("wzAge", 40);
    if (solved.feasible && re != null) {
        const yearsLeft = Math.max(0, re - ageNow);
        box.innerHTML = `
            <div class="wz-hero-kicker">${escapeHtml(kicker)}</div>
            <div class="wz-hero-headline">W wieku ${re} lat (za ${yearsLeft} ${wzFormatYears(yearsLeft)})</div>
            <div class="wz-hero-desc">To najwcześniejszy wiek przejścia na FIRE z gwarancją wypłaty co najmniej <strong>${fmt(target)} zł/mies. netto</strong>.</div>`;
    } else {
        box.innerHTML = `
            <div class="wz-hero-kicker">${escapeHtml(kicker)}</div>
            <div class="wz-hero-headline">Cel ${fmt(target)} zł/mies. nieosiągalny przed emeryturą</div>
            <div class="wz-hero-desc">${escapeHtml(solved.note || "Rozważ wyższe miesięczne oszczędności lub niższą docelową wypłatę.")}</div>`;
    }
}

function wzRenderScenarios(data) {
    const box = wzEl("wzScenariosBox");
    if (!box) return;
    const scenarios = data.scenarios || {};
    const keys = ["konserwatywne", "realne", "optymistyczne"].filter((key) => scenarios[key]);
    if (!keys.length) {
        box.innerHTML = "";
        return;
    }
    const fmt = (value) => (value == null ? "—" : Math.round(value).toLocaleString("pl-PL"));
    const icons = {
        konserwatywne: iconSvg("rain"),
        realne: iconSvg("cloud"),
        optymistyczne: iconSvg("sun"),
    };
    const path = data.path || wzCurrentPath();

    let html = `<h3 class="wz-section-title">${tipLabelHtml("Scenariusze rynkowe", "Kryzys / bessa: wyższa inflacja, niższe ROI — na krypto nawet ujemne — i słabsza waloryzacja ZUS. Realne: Twoja konfiguracja bazowa. Hossa: niższa inflacja, wyższe ROI i mocniejsza waloryzacja. Kliknij kartę, aby ustawić scenariusz główny.")}</h3>
        <div class="wz-scenarios-grid">`;
    keys.forEach((key) => {
        const scenario = scenarios[key];
        const selected = key === wzSelectedScenario;
        let mainText = "";
        let subText = `Szczyt majątku: ${fmt(scenario.peak_wealth)} zł`;
        if (path === 1) {
            mainText = scenario.feasible
                ? `${fmt(scenario.payout_monthly)} zł/mies.`
                : "Nieosiągalne";
            if (data.optimization?.objective === "total") {
                subText = `Łącznie ${fmt(scenario.total_withdrawn)} zł · Szczyt: ${fmt(scenario.peak_wealth)} zł`;
            }
        } else if (path === 2) {
            mainText = scenario.feasible ? `${fmt(scenario.savings_monthly)} zł/mies.` : "Nieosiągalne";
            if (scenario.savings_pct != null && scenario.feasible) {
                subText = `${scenario.savings_pct.toLocaleString("pl-PL")}% pensji netto · Szczyt: ${fmt(scenario.peak_wealth)} zł`;
            }
        } else {
            mainText = scenario.feasible && scenario.retire_early_age != null
                ? `FIRE w wieku ${scenario.retire_early_age} lat`
                : "Po wieku emerytalnym";
        }
        html += `
            <button type="button" class="wz-scenario-card${selected ? " is-selected" : ""}" data-scenario="${key}" aria-pressed="${selected}" title="Kliknij, aby wybrać scenariusz ${escapeHtml(scenario.label)}">
                <span class="wz-scenario-title">
                    <span class="wz-scenario-name">${icons[key] || ""}<span>${escapeHtml(scenario.label)}</span></span>
                    ${selected ? `<span class="chip chip-primary">${iconSvg("check")}Wybrany</span>` : ""}
                </span>
                <span class="wz-scenario-main">${mainText}</span>
                <span class="wz-scenario-sub">${subText}</span>
            </button>`;
    });
    html += "</div>";
    box.innerHTML = html;
}

function wzRenderMetrics(data) {
    const box = wzEl("wzMetrics");
    if (!box) return;
    const planView = window.ResultsModel.fromWizard(data, wzSelectedScenario);
    const metrics = [
        window.ResultsModel.metric(planView, "totalWithdrawnPrivate"),
        window.ResultsModel.metric(planView, "avgMonthly", { label: "Średnia wypłata mies." }),
        window.ResultsModel.metric(planView, "minMonthly", { label: "Minimalna wypłata mies." }),
        window.ResultsModel.metric(planView, "portfolioMinMonthly", {
            label: "Minimalna wypłata z portfela",
        }),
        window.ResultsModel.metric(planView, "finalWealthNet"),
        window.ResultsModel.metric(planView, "taxAndHealth", { label: "Podatki i składki" }),
    ];
    if ((planView.summary?.zus_monthly ?? 0) > 0) {
        metrics.push(window.ResultsModel.metric(planView, "zusMonthly"));
    } else {
        metrics.push(window.ResultsModel.metric(planView, "peakWealth", { label: "Majątek szczytowy" }));
    }
    window.ResultsMetrics.render(box, metrics);
}

function wzRenderFacts(projection, plan = null) {
    const box = wzEl("wzFacts");
    if (!box) return;
    const fmt = (value) => Math.round(value || 0).toLocaleString("pl-PL");
    const facts = [];

    const mixText = wzAssetMixLabel(plan?.asset_mix);
    if (mixText) {
        const vehicleParts = Object.entries(plan?.wrapper_vehicles || {})
            .map(([wrapper, vehicle]) => `${wzAccountLabel(wrapper)}: ${wzVehicleLabel(vehicle)}`);
        const tip = vehicleParts.length
            ? `Rodzaje inwestycji — ${vehicleParts.join(", ")}.`
            : "Rodzaje inwestycji wynikają z profilu i limitów.";
        facts.push(
            `<span class="chip wz-fact">Nowe wpłaty: ${escapeHtml(mixText)}${tipHtml(tip)}</span>`
        );
    }

    const earlyTotal = projection?.early_return_total || 0;
    if (earlyTotal > 0.5) {
        const entries = Object.entries(projection.early_return_allocations || {})
            .filter(([, amount]) => amount > 0.5);
        const parts = entries.map(([account, amount]) => `${wzAccountLabel(account)}: ${fmt(amount)} zł`);
        const targets = entries.map(([account]) => wzAccountLabel(account));
        const tax = projection.early_return_tax_total || 0;
        const label = targets.length ? targets.join(" + ") : "konto docelowe";
        const tip = `Podatek jednorazowy: ${fmt(tax)} zł. Netto ${fmt(earlyTotal)} zł${
            parts.length ? `; reinwestycja: ${parts.join(", ")}` : ""
        }.`;
        facts.push(
            `<span class="chip wz-fact">Wcześniejszy zwrot IKZE: ${fmt(earlyTotal)} zł → ${escapeHtml(label)}${tipHtml(tip)}</span>`
        );
    }

    const refundTotal = projection?.ikze_refund_total || 0;
    if (refundTotal > 0) {
        const entries = Object.entries(projection.ikze_refund_allocations || {})
            .filter(([, amount]) => amount > 0.5);
        const parts = entries.map(([account, amount]) => `${wzAccountLabel(account)}: ${fmt(amount)} zł`);
        const targets = entries.map(([account]) => wzAccountLabel(account));
        const allocated = entries.reduce((sum, [, amount]) => sum + amount, 0);
        let tip = parts.length
            ? `Zainwestowano: ${parts.join(", ")}.`
            : "Brak celu reinwestycji — kwota pozostaje jako obniżenie podatku.";
        if (parts.length) {
            tip += " Ulga wraca co roku i powiększa kapitał.";
        }
        const unallocated = refundTotal - allocated;
        if (parts.length && unallocated > 0.5) {
            tip += ` Nierozdysponowane ${fmt(unallocated)} zł pozostaje jako obniżenie podatku.`;
        }
        const targetSuffix = targets.length === 1 ? ` → ${escapeHtml(targets[0])}` : "";
        facts.push(
            `<span class="chip wz-fact">Ulga IKZE: ${fmt(refundTotal)} zł${targetSuffix}${tipHtml(tip)}</span>`
        );
    }

    box.innerHTML = facts.join("");
    box.classList.toggle("hidden", !facts.length);
}

function wzRenderWarnings(list) {
    const box = wzEl("wzWarnings");
    if (!box) return;
    window.ResultsBanners.render(box, list || [], {
        variant: "warn",
        mode: "list",
    });
}

function wzRenderTimeline(input, projection) {
    const box = wzEl("wzTimeline");
    if (!box) return;
    box.innerHTML = "";
    const phases = projection?.phase_metrics || [];
    if (phases.length) {
        const ordered = [...phases].sort((a, b) => a.start_age - b.start_age);
        const min = Math.min(...ordered.map((phase) => phase.start_age));
        const max = Math.max(...ordered.map((phase) => phase.end_age));
        const width = max - min || 1;
        ordered.forEach((phase, index) => {
            const leftPct = ((phase.start_age - min) / width) * 100;
            const spanPct = Math.max(2, ((phase.end_age - phase.start_age) / width) * 100);
            const isAccum = phase.cashflow === "contribution";
            const seg = document.createElement("div");
            seg.className = `wz-timeline-segment ${isAccum ? "wz-tl-acc" : "wz-tl-real"}`;
            seg.style.left = `${leftPct}%`;
            seg.style.width = `${spanPct}%`;
            seg.dataset.phaseIndex = String(index);
            seg.setAttribute("role", "button");
            seg.tabIndex = 0;
            const phaseName = phase.key === "partial_fire" ? "Częściowe FIRE" : phase.name;
            seg.setAttribute(
                "aria-label",
                `${phaseName}, ${phase.start_age}–${phase.end_age} r.ż., `
                + `${isAccum ? "wpłaty" : "wypłata netto"} ${wzFmtZloty(phase.monthly)} zł/mies. — szczegóły`
            );
            seg.innerHTML = `
                <span class="wz-tl-name">${escapeHtml(phaseName)}</span>
                <span class="wz-tl-age">${phase.start_age}–${phase.end_age} r.ż.</span>
                <span class="wz-tl-amount">${phase.monthly > 0 ? `~${fmtMoney(phase.monthly)}/mies.` : "—"}</span>
                <span class="wz-tl-kind">${isAccum ? "wpłaty" : "wypłata netto"}</span>`;
            box.appendChild(seg);
        });
        const horizonAge = wzInputHorizonAge(input);
        if (Number.isFinite(horizonAge) && horizonAge >= min && horizonAge <= max) {
            const line = document.createElement("span");
            line.className = "wz-gantt-horizon";
            line.style.left = `${((horizonAge - min) / width) * 100}%`;
            line.title = `Horyzont planu: ${horizonAge} r.ż.`;
            box.appendChild(line);
        }
        setupTimelineDetails(box, ordered);
        return;
    }

    const stages = input?.stages || [];
    if (!stages.length) return;
    const spans = [];
    stages.forEach((stage) => {
        const kind = stage.stage_type === "realizacja" ? "realizacja" : "akumulacja";
        const label = stage.name || (kind === "realizacja" ? "Realizacja" : "Akumulacja");
        const existing = spans.find(
            (span) => span.kind === kind && span.start === stage.start_age && span.end === stage.end_age
        );
        if (existing) {
            if (!existing.label.includes(label)) existing.label += ` + ${label}`;
        } else {
            spans.push({ kind, label, start: stage.start_age, end: stage.end_age });
        }
    });
    const min = Math.min(...spans.map((span) => span.start));
    const max = Math.max(...spans.map((span) => span.end));
    const width = max - min || 1;
    spans.forEach((span) => {
        const seg = document.createElement("div");
        seg.className = `wz-timeline-segment ${span.kind === "realizacja" ? "wz-tl-real" : "wz-tl-acc"}`;
        seg.style.left = `${((span.start - min) / width) * 100}%`;
        seg.style.width = `${Math.max(2, ((span.end - span.start) / width) * 100)}%`;
        seg.title = `${span.label}: ${span.start} → ${span.end} r.ż.`;
        seg.innerHTML = `
            <span class="wz-tl-name">${escapeHtml(span.label)}</span>
            <span class="wz-tl-age">${span.start}–${span.end} r.ż.</span>`;
        box.appendChild(seg);
    });
    const horizonAge = wzInputHorizonAge(input);
    if (Number.isFinite(horizonAge) && horizonAge >= min && horizonAge <= max) {
        const line = document.createElement("span");
        line.className = "wz-gantt-horizon";
        line.style.left = `${((horizonAge - min) / width) * 100}%`;
        line.title = `Horyzont planu: ${horizonAge} r.ż.`;
        box.appendChild(line);
    }
}

let wzTimelinePhases = [];
let wzTimelineBound = false;

function wzTimelineTipHtml(phase) {
    const rows = [];
    const years = Math.max(0, phase.end_age - phase.start_age);
    const period = `${phase.start_age}–${phase.end_age} r.ż.`;
    if (phase.cashflow === "contribution") {
        rows.push(wzGanttTipRow("Wpłaty miesięcznie", `${wzFmtZloty(phase.monthly)} zł`));
        rows.push(wzGanttTipRow("Okres", period, wzFormatYears(years)));
        rows.push(wzGanttTipRow(
            "Łącznie wpłacono (≈)",
            `${wzFmtZloty(phase.monthly * years * 12)} zł`
        ));
        return wzGanttTipPanel(phase.name, "Akumulacja", rows);
    }
    rows.push(wzGanttTipRow("Wypłata netto", `${wzFmtZloty(phase.monthly)} zł/mies.`));
    rows.push(wzGanttTipRow("Okres", period, wzFormatYears(years)));
    if (phase.portfolio_monthly > 0.5) {
        rows.push(wzGanttTipRow("Portfel", `${wzFmtZloty(phase.portfolio_monthly)} zł/mies.`));
    }
    if (phase.zus_monthly > 0.5) {
        rows.push(wzGanttTipRow("ZUS", `${wzFmtZloty(phase.zus_monthly)} zł/mies.`));
    }
    if (phase.part_time_monthly > 0.5) {
        rows.push(wzGanttTipRow(
            "Część etatu",
            `${wzFmtZloty(phase.part_time_monthly)} zł/mies.`
        ));
    }
    if (phase.mortgage_monthly > 0.5) {
        rows.push(wzGanttTipRow(
            "Rata kredytu",
            `−${wzFmtZloty(phase.mortgage_monthly)} zł/mies.`
        ));
    }
    rows.push(wzGanttTipRow(
        "Razem netto (≈)",
        `${wzFmtZloty(phase.monthly * years * 12)} zł`
    ));
    return wzGanttTipPanel(
        phase.key === "partial_fire" ? "Częściowe FIRE" : phase.name,
        "Wypłaty",
        rows
    );
}

function setupTimelineDetails(box, phases) {
    wzTimelinePhases = phases;
    if (wzTimelineBound) return;
    wzTimelineBound = true;
    const open = (segment) => {
        const phase = wzTimelinePhases[Number(segment.dataset.phaseIndex)];
        if (!phase) return;
        wzDetailShow(segment, wzTimelineTipHtml(phase), true);
    };
    box.addEventListener("click", (event) => {
        const segment = event.target.closest?.(".wz-timeline-segment");
        if (!segment) return;
        event.preventDefault();
        open(segment);
    });
    box.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const segment = event.target.closest?.(".wz-timeline-segment");
        if (!segment) return;
        event.preventDefault();
        open(segment);
    });
}

function wzFmtZloty(value) {
    return Math.round(value || 0).toLocaleString("pl-PL");
}

function wzFlowMonthlyLabel(phase) {
    const avg = phase.avg_monthly_net || 0;
    const min = phase.min_monthly_net || avg;
    const max = phase.max_monthly_net || avg;
    if (max - min > Math.max(50, avg * 0.05)) {
        return `${wzFmtZloty(min)}–${wzFmtZloty(max)}`;
    }
    return wzFmtZloty(avg);
}

function wzPhaseBadge(n) {
    let out = "";
    while (n > 0) {
        n -= 1;
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26);
    }
    return out;
}

function wzFlowsRange(input, phases, extraAges = []) {
    const ages = [];
    (input?.stages || []).forEach((stage) => ages.push(stage.start_age, stage.end_age));
    phases.forEach((phase) => {
        if (phase.accumulation_start_age != null) ages.push(phase.accumulation_start_age);
    });
    phases.forEach((phase) => ages.push(phase.start_age, phase.last_age + 1));
    extraAges.filter((age) => Number.isFinite(Number(age))).forEach((age) => ages.push(Number(age)));
    if (!ages.length) return { min: 0, max: 1 };
    const min = Math.min(...ages);
    const max = Math.max(...ages);
    return { min, max: Math.max(min + 1, max) };
}

function wzFlowPct(age, range) {
    return ((age - range.min) / (range.max - range.min)) * 100;
}

let wzGanttTips = [];
let wzGanttBound = false;
let wzGanttPinned = false;
let wzGanttActive = null;
let wzGanttHideTimer = null;
let wzGanttShowTimer = null;
const WZ_GANTT_TIP_HOVER_DELAY = 900;

function wzGanttTipHide(force = false) {
    if (wzGanttPinned && !force) return;
    clearTimeout(wzGanttShowTimer);
    wzGanttPinned = false;
    wzGanttActive = null;
    wzEl("wzGanttTip")?.classList.add("hidden");
}

function wzGanttTipPlace() {
    const tip = wzEl("wzGanttTip");
    const anchor = wzGanttActive;
    if (!tip || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - height - 8);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function wzGanttTipCancelShow() {
    clearTimeout(wzGanttShowTimer);
    wzGanttShowTimer = null;
}

function wzDetailShow(anchor, html, pin = false) {
    const tip = wzEl("wzGanttTip");
    const body = wzEl("wzGanttTipBody");
    if (!html || !tip || !body) return;
    if (wzActiveChartMilestone) wzMilestoneTipHide();
    wzChartTipHide(true);
    wzGanttTipCancelShow();
    body.innerHTML = html;
    tip.classList.remove("hidden");
    wzGanttActive = anchor;
    wzGanttPinned = pin;
    requestAnimationFrame(wzGanttTipPlace);
}

function wzGanttTipShow(anchor, pin = false) {
    const html = wzGanttTips[Number(anchor.dataset.tipId)];
    if (!html) return;
    wzDetailShow(anchor, html, pin);
}

function wzGanttTipScheduleHide() {
    clearTimeout(wzGanttHideTimer);
    wzGanttHideTimer = setTimeout(() => {
        if (!wzGanttPinned) wzGanttTipHide();
    }, 140);
}

function setupGanttTips(gantt, tips) {
    wzGanttTips = tips;
    wzGanttTipHide(true);
    if (wzGanttBound) return;
    wzGanttBound = true;
    const anchorOf = (event) => event.target.closest?.("[data-tip-id]");
    gantt.addEventListener("mouseover", (event) => {
        const anchor = anchorOf(event);
        if (!anchor || wzGanttPinned) return;
        if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
        if (wzGanttActive === anchor) return;
        wzGanttTipCancelShow();
        clearTimeout(wzGanttHideTimer);
        wzGanttShowTimer = setTimeout(() => {
            wzGanttShowTimer = null;
            if (!wzGanttPinned && anchor.isConnected) wzGanttTipShow(anchor);
        }, WZ_GANTT_TIP_HOVER_DELAY);
    });
    gantt.addEventListener("mouseout", (event) => {
        const anchor = anchorOf(event);
        if (!anchor) return;
        if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
        wzGanttTipCancelShow();
        wzGanttTipScheduleHide();
    });
    gantt.addEventListener("click", (event) => {
        const anchor = anchorOf(event);
        if (!anchor) return;
        event.preventDefault();
        wzGanttTipCancelShow();
        if (wzGanttActive === anchor && wzGanttPinned) {
            wzGanttTipHide(true);
        } else {
            wzGanttTipShow(anchor, true);
        }
    });
    gantt.addEventListener("focusin", (event) => {
        const anchor = anchorOf(event);
        if (anchor) {
            wzGanttTipCancelShow();
            wzGanttTipShow(anchor, wzGanttPinned);
        }
    });
    gantt.addEventListener("focusout", (event) => {
        if (anchorOf(event)) wzGanttTipScheduleHide();
    });
    const tip = wzEl("wzGanttTip");
    const close = wzEl("wzGanttTipClose");
    if (tip) {
        tip.addEventListener("mouseenter", () => clearTimeout(wzGanttHideTimer));
        tip.addEventListener("mouseleave", wzGanttTipScheduleHide);
    }
    if (close) close.addEventListener("click", () => wzGanttTipHide(true));
    document.addEventListener("pointerdown", (event) => {
        wzGanttTipCancelShow();
        if (!wzGanttActive) return;
        if (tip && (tip.contains(event.target) || event.target.closest?.("[data-tip-id]"))) return;
        wzGanttTipHide(true);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") wzGanttTipHide(true);
    });
    window.addEventListener(
        "scroll",
        () => {
            wzGanttTipCancelShow();
            if (!wzGanttPinned) wzGanttTipHide(true);
            else if (wzGanttActive) requestAnimationFrame(wzGanttTipPlace);
        },
        true
    );
    window.addEventListener("resize", () => {
        if (wzGanttActive) requestAnimationFrame(wzGanttTipPlace);
    });
}

function wzGanttTipRow(label, value, note = "") {
    const noteHtml = note ? `<span class="wz-gantt-tip-note">${escapeHtml(note)}</span>` : "";
    return `<div class="wz-gantt-tip-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}${noteHtml}</dd></div>`;
}

function wzGanttTipPanel(title, subtitle, rows) {
    return `<div class="wz-gantt-tip-title">${escapeHtml(title)}</div>
        <div class="wz-gantt-tip-sub">${escapeHtml(subtitle)}</div>
        <dl class="wz-gantt-tip-list">${rows.join("")}</dl>`;
}

function wzAccumulationTipHtml(input, phase, accountLabel) {
    const rows = [];
    rows.push(wzGanttTipRow("Kapitał startowy", `${wzFmtZloty(phase.accumulation_start_balance)} zł`));

    let annual = phase.accumulation_annual_contribution || 0;
    if (phase.account === "ppk") {
        const ppkCfg = input?.config?.ppk || {};
        const ppkStage = (input?.stages || []).find(
            (stage) => stage.stage_type === "akumulacja" && stage.accounts?.ppk
        );
        const topups = ppkStage?.accounts?.ppk?.state_topups !== false;
        const stateAnnual = topups ? ppkCfg.state_annual ?? 240 : 0;
        const welcoming = topups ? ppkCfg.state_welcoming ?? 250 : 0;
        annual = Math.max(0, annual - stateAnnual);
        if (annual > 0.5) {
            rows.push(wzGanttTipRow(
                "Wpłaty roczne",
                `${wzFmtZloty(annual)} zł`,
                `≈ ${wzFmtZloty(annual / 12)} zł/mies. (pracownik + pracodawca)`
            ));
        }
        if (topups) {
            rows.push(wzGanttTipRow(
                "Dopłaty państwa",
                `${wzFmtZloty(stateAnnual)} zł/rok`,
                `+ ${wzFmtZloty(welcoming)} zł jednorazowo`
            ));
        }
    } else if (annual > 0.5) {
        rows.push(wzGanttTipRow(
            "Wpłaty roczne",
            `${wzFmtZloty(annual)} zł`,
            `≈ ${wzFmtZloty(annual / 12)} zł/mies.`
        ));
    }

    if (phase.accumulation_total_contributions > 0.5) {
        rows.push(wzGanttTipRow(
            "Wpłaty łącznie",
            `${wzFmtZloty(phase.accumulation_total_contributions)} zł`
        ));
    }
    const endAge = phase.accumulation_end_age;
    rows.push(wzGanttTipRow(
        endAge != null ? `Kapitał na koniec wpłat (${endAge} r.ż.)` : "Kapitał na koniec",
        `${wzFmtZloty(phase.accumulation_end_balance)} zł`
    ));
    rows.push(wzGanttTipRow(
        phase.account === "zus" ? "Wzrost (składki + waloryzacja)" : "Wzrost (odsetki)",
        `${wzFmtZloty(phase.accumulation_growth)} zł`
    ));
    if (endAge != null && phase.start_age > endAge) {
        const note = phase.starting_balance < phase.accumulation_end_balance
            ? `po podatkach lub przepadku (${phase.start_age} r.ż.)`
            : `po dalszym wzroście lub transferach (${phase.start_age} r.ż.)`;
        rows.push(wzGanttTipRow(
            "Saldo przed 1. wypłatą",
            `${wzFmtZloty(phase.starting_balance)} zł`,
            note
        ));
    }

    const start = phase.accumulation_start_age;
    const years = start != null && endAge != null ? Math.max(0, endAge - start) : null;
    const period = start != null && endAge != null ? `${start}–${endAge} r.ż.` : "";
    const subtitle = `Akumulacja · ${period}${years ? ` · wpłaty przez ${wzFormatYears(years)}` : ""}`;
    return wzGanttTipPanel(accountLabel, subtitle, rows);
}

function wzPhaseTipHtml(phase, accountLabel) {
    const rows = [];
    rows.push(wzGanttTipRow("Miesięcznie netto", `${wzFlowMonthlyLabel(phase)} zł`));
    rows.push(wzGanttTipRow("Razem netto", `${wzFmtZloty(phase.total_net)} zł`));
    rows.push(wzGanttTipRow(
        phase.account === "zus" ? "Kapitał ZUS" : "Saldo na start",
        `${wzFmtZloty(phase.starting_balance)} zł`
    ));
    rows.push(wzGanttTipRow("Saldo na koniec", `${wzFmtZloty(phase.ending_balance)} zł`));

    if (phase.total_tax > 0.5) {
        rows.push(wzGanttTipRow("PIT", `${wzFmtZloty(phase.total_tax)} zł`));
    }
    if (phase.total_health > 0.5) {
        rows.push(wzGanttTipRow("Składka zdrowotna", `${wzFmtZloty(phase.total_health)} zł`));
    }
    if (phase.lump_tax > 0.5) {
        rows.push(wzGanttTipRow("Podatek jednorazowy IKZE", `${wzFmtZloty(phase.lump_tax)} zł`));
    }

    const subtitle = `Faza ${phase._flowLabel} · ${phase.start_age}–${phase.last_age} r.ż. · ${wzFormatYears(phase.years)}`;
    return wzGanttTipPanel(accountLabel, subtitle, rows);
}

function wzTotalTipHtml(phase) {
    const years = Math.max(0, phase.end_age - phase.start_age);
    const rows = [];
    rows.push(wzGanttTipRow("Miesięcznie netto", `${wzFmtZloty(phase.monthly || 0)} zł`));
    rows.push(wzGanttTipRow("Okres", `${phase.start_age}–${phase.end_age} r.ż.`, wzFormatYears(years)));
    if (phase.portfolio_monthly > 0.5) {
        rows.push(wzGanttTipRow("Portfel", `${wzFmtZloty(phase.portfolio_monthly)} zł/mies.`));
    }
    if (phase.zus_monthly > 0.5) {
        rows.push(wzGanttTipRow("ZUS", `${wzFmtZloty(phase.zus_monthly)} zł/mies.`));
    }
    if (phase.part_time_monthly > 0.5) {
        rows.push(wzGanttTipRow(
            "Część etatu",
            `${wzFmtZloty(phase.part_time_monthly)} zł/mies.`
        ));
    }
    if (phase.mortgage_monthly > 0.5) {
        rows.push(wzGanttTipRow(
            "Rata kredytu",
            `−${wzFmtZloty(phase.mortgage_monthly)} zł/mies.`
        ));
    }
    rows.push(wzGanttTipRow(
        "Razem netto (≈)",
        `${wzFmtZloty((phase.monthly || 0) * years * 12)} zł`
    ));
    return wzGanttTipPanel(
        phase.key === "partial_fire" ? "Częściowe FIRE" : (phase.name || "Razem"),
        "Wypłaty łączne",
        rows
    );
}

function wzAccumulationPhaseTipHtml(phase, accountLabel) {
    const rows = [
        wzGanttTipRow("Wpłata miesięcznie", `${wzFmtZloty(phase.monthly_contribution)} zł`),
        wzGanttTipRow(
            "Okres",
            `${phase.start_age}–${phase.end_age} r.ż.`,
            wzFormatYears(Math.max(0, phase.end_age - phase.start_age))
        ),
        wzGanttTipRow("Wpłaty łącznie", `${wzFmtZloty(phase.total_contributions)} zł`),
        wzGanttTipRow("Kapitał startowy", `${wzFmtZloty(phase.starting_balance)} zł`),
        wzGanttTipRow(
            `Kapitał na koniec (${phase.end_age - 1} r.ż.)`,
            `${wzFmtZloty(phase.ending_balance)} zł`
        ),
        wzGanttTipRow("Wzrost", `${wzFmtZloty(phase.growth)} zł`),
    ];
    return wzGanttTipPanel(`${accountLabel} — akumulacja`, "Akumulacja", rows);
}

function wzTransferTipHtml(transfers, projection, accountLabel) {
    const age = transfers[0]?.age;
    const rows = transfers.map((transfer) => wzGanttTipRow(
        `${accountLabel(transfer.from_account)} → ${accountLabel(transfer.to_account)}`,
        `${wzFmtZloty(transfer.amount)} zł netto`
    ));
    if (projection?.early_return_tax_total > 0.5) {
        rows.push(wzGanttTipRow(
            "Podatek od wcześniejszego zwrotu IKZE",
            `${wzFmtZloty(projection.early_return_tax_total)} zł`
        ));
    }
    return wzGanttTipPanel(`Transfery — ${age} r.ż.`, "Przepływ kapitału", rows);
}

function wzRenderAccumulationTable(phases, accountLabel) {
    if (!phases.length) return "";
    const rows = phases.map((phase) => `
        <tr>
            <td data-label="Konto">${escapeHtml(accountLabel(phase.account))}</td>
            <td data-label="Okres">${phase.start_age}–${phase.end_age} r.ż.</td>
            <td data-label="Wpłata miesięcznie">${fmtMoney(phase.monthly_contribution)}/mies.</td>
            <td data-label="Wpłaty łącznie">${fmtMoney(phase.total_contributions)}</td>
            <td data-label="Wzrost">${fmtMoney(phase.growth)}</td>
            <td data-label="Saldo końcowe">${fmtMoney(phase.ending_balance)}</td>
        </tr>`).join("");
    return `
        <h5 class="wz-flows-subtitle">Akumulacja</h5>
        <div class="wz-flows-table-wrap">
            <table class="wz-flows-table">
                <thead><tr><th>Konto</th><th>Okres</th><th>Wpłata miesięcznie</th><th>Wpłaty łącznie</th><th>Wzrost</th><th>Saldo końcowe</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function wzRenderTransferTable(transfers, projection, accountLabel) {
    if (!transfers.length) return "";
    const rows = transfers.map((transfer) => `
        <tr>
            <td data-label="Wiek">${transfer.age} r.ż.</td>
            <td data-label="Z konta">${escapeHtml(accountLabel(transfer.from_account))}</td>
            <td data-label="Na konto">${escapeHtml(accountLabel(transfer.to_account))}</td>
            <td data-label="Kwota netto">${fmtMoney(transfer.amount)}</td>
        </tr>`).join("");
    const taxNote = projection?.early_return_tax_total > 0.5
        ? `<p class="field-hint">Podatek od wcześniejszego zwrotu IKZE: ${fmtMoney(projection.early_return_tax_total)} łącznie.</p>`
        : "";
    return `
        <h5 class="wz-flows-subtitle">Transfery kapitału</h5>
        <div class="wz-flows-table-wrap">
            <table class="wz-flows-table">
                <thead><tr><th>Wiek</th><th>Z konta</th><th>Na konto</th><th>Kwota netto</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${taxNote}`;
}

function wzRenderAccountFlows(input, projection) {
    const wrap = wzEl("wzAccountFlows");
    const gantt = wzEl("wzFlowsGantt");
    const flowsWrap = wzEl("wzFlowsWrap");
    const tableDetails = wzEl("wzFlowsTableDetails");
    const phases = projection?.account_phases || [];
    const accumulationPhases = projection?.accumulation_phases || [];
    const transfers = projection?.capital_transfers || [];
    if (!wrap || !gantt || (!phases.length && !accumulationPhases.length && !transfers.length)) {
        flowsWrap?.classList.add("hidden");
        tableDetails?.classList.add("hidden");
        if (wrap) {
            wrap.innerHTML = "<p class=\"field-hint\">Brak szczegółowych danych o wypłatach z kont w tym planie.</p>";
        }
        return;
    }
    flowsWrap?.classList.remove("hidden");
    tableDetails?.classList.remove("hidden");

    const range = wzFlowsRange(input, phases, [
        ...accumulationPhases.flatMap((phase) => [phase.start_age, phase.end_age]),
        ...transfers.map((transfer) => transfer.age),
    ]);
    phases.forEach((phase, index) => {
        phase._flowIndex = index + 1;
        phase._flowLabel = wzPhaseBadge(index + 1);
    });
    const customNames = new Map();
    (input?.stages || []).forEach((stage) => {
        Object.entries(stage.accounts || {}).forEach(([account, config]) => {
            if (config?.custom_name) customNames.set(account, config.custom_name);
        });
    });
    const accountName = (account) => account === "zus"
        ? "ZUS (emerytura)"
        : wzAccountLabel(account, customNames.get(account) || "");
    const tips = [];
    const addTip = (html) => {
        tips.push(html);
        return tips.length - 1;
    };

    const baseAccounts = [...new Set(phases.map((phase) => phase.account))];
    const allAccounts = new Set(baseAccounts);
    accumulationPhases.forEach((phase) => allAccounts.add(phase.account));
    transfers.forEach((transfer) => {
        allAccounts.add(transfer.from_account);
        allAccounts.add(transfer.to_account);
    });
    const extraAccounts = [...allAccounts].filter((account) => !baseAccounts.includes(account));
    const zusIndex = baseAccounts.indexOf("zus");
    const accounts = zusIndex >= 0
        ? [...baseAccounts.slice(0, zusIndex), ...extraAccounts, ...baseAccounts.slice(zusIndex)]
        : [...baseAccounts, ...extraAccounts];
    const step = range.max - range.min <= 20 ? 2 : 5;
    let ganttHtml = `<div class="wz-gantt-axis"><span class="wz-gantt-axis-label">Konto</span><div class="wz-gantt-axis-track">`;
    for (let age = Math.ceil(range.min / step) * step; age <= range.max; age += step) {
        ganttHtml += `<span class="wz-gantt-tick" style="left:${wzFlowPct(age, range).toFixed(2)}%">${age}</span>`;
    }
    ganttHtml += `</div></div>`;

    accounts.forEach((account) => {
        const list = phases.filter((phase) => phase.account === account);
        const accumList = accumulationPhases.filter((phase) => phase.account === account);
        let bars = "";
        if (accumList.length) {
            accumList.forEach((phase) => {
                if (phase.end_age <= phase.start_age) return;
                const left = wzFlowPct(phase.start_age, range);
                const width = Math.max(
                    0.8,
                    wzFlowPct(phase.end_age, range) - left
                );
                const tipIdx = addTip(
                    wzAccumulationPhaseTipHtml(phase, accountName(account))
                );
                const tipLabel = `Akumulacja ${phase.start_age}–${phase.end_age} r.ż., ${wzFmtZloty(phase.monthly_contribution)} zł/mies. — szczegóły`;
                bars += `<span class="wz-gantt-accum" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}"></span>`;
            });
        } else if (list.length && account !== "zus") {
            // Zgodność ze starymi zapisanymi planami bez accumulation_phases.
            const starts = list.map((phase) => phase.accumulation_start_age).filter((value) => value != null);
            const accumStart = starts.length ? Math.min(...starts) : null;
            const firstStart = Math.min(...list.map((phase) => phase.start_age));
            const firstPhase = list[0];
            if (accumStart != null && firstStart > accumStart && accumStart >= range.min) {
                const left = wzFlowPct(accumStart, range);
                const width = wzFlowPct(firstStart, range) - left;
                const tipIdx = addTip(wzAccumulationTipHtml(input, firstPhase, accountName(account)));
                const accumEnd = firstPhase.accumulation_end_age ?? firstStart;
                const tipLabel = `Akumulacja ${accumStart}–${accumEnd} r.ż. — szczegóły`;
                bars += `<span class="wz-gantt-accum" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}"></span>`;
            }
        }
        list.forEach((phase) => {
            const left = wzFlowPct(phase.start_age, range);
            const width = Math.max(0.8, wzFlowPct(phase.last_age + 1, range) - left);
            const short = Math.round(phase.avg_monthly_net).toLocaleString("pl-PL");
            const showUnit = width >= 11;
            const showAmount = width >= 7.5;
            const amountText = showUnit ? `${short} zł` : showAmount ? short : "";
            const label = `<span class="wz-gantt-phase-letter">${phase._flowLabel}</span>`
                + (amountText ? `<span class="wz-gantt-phase-value">${amountText}</span>` : "");
            const cls = showAmount ? "" : " is-index";
            const tipIdx = addTip(wzPhaseTipHtml(phase, accountName(account)));
            const tipLabel = `${accountName(account)}: faza ${phase._flowLabel}, ${phase.start_age}–${phase.last_age} r.ż., ${wzFlowMonthlyLabel(phase)} zł/mies. netto — szczegóły`;
            bars += `<span class="wz-gantt-phase${cls}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}">${label}</span>`;
        });
        ganttHtml += `<div class="wz-gantt-row"><span class="wz-gantt-label">${wzAccountIcon(account)}<span>${escapeHtml(account === "zus" ? "ZUS" : accountName(account))}</span></span><div class="wz-gantt-track">${bars}</div></div>`;
    });

    if (transfers.length) {
        const byAge = new Map();
        transfers.forEach((transfer) => {
            if (!byAge.has(transfer.age)) byAge.set(transfer.age, []);
            byAge.get(transfer.age).push(transfer);
        });
        let transferBars = "";
        byAge.forEach((items, age) => {
            const left = wzFlowPct(age, range);
            const tipIdx = addTip(wzTransferTipHtml(items, projection, accountName));
            const summary = items
                .map((transfer) => `${accountName(transfer.from_account)} → ${accountName(transfer.to_account)}`)
                .join(", ");
            const sources = [...new Set(
                items.map((transfer) => accountName(transfer.from_account))
            )].join(", ");
            const tipLabel = `Transfery ${age} r.ż.: ${summary} — szczegóły`;
            transferBars += `<span class="wz-gantt-transfer" style="left:${left.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}">${escapeHtml(sources)} ${iconSvg("arrow")}</span>`;
        });
        ganttHtml += `<div class="wz-gantt-row wz-gantt-transfer-row"><span class="wz-gantt-label">${iconSvg("arrow")}<span>Transfery</span></span><div class="wz-gantt-track">${transferBars}</div></div>`;
    }

    const payouts = (projection.phase_metrics || []).filter(
        (phase) => phase.cashflow === "payout" && phase.end_age > phase.start_age
    );
    if (payouts.length) {
        let totalBars = "";
        payouts.forEach((phase) => {
            const left = wzFlowPct(phase.start_age, range);
            const width = Math.max(0.8, wzFlowPct(phase.end_age, range) - left);
            const label = width >= 8
                ? `${Math.round(phase.monthly || 0).toLocaleString("pl-PL")} zł/mies.`
                : "";
            const tipIdx = addTip(wzTotalTipHtml(phase));
            const phaseName = phase.key === "partial_fire" ? "Częściowe FIRE" : phase.name;
            const tipLabel = `${phaseName}: ${phase.start_age}–${phase.end_age} r.ż., ${Math.round(phase.monthly || 0).toLocaleString("pl-PL")} zł/mies. netto — szczegóły`;
            totalBars += `<span class="wz-gantt-phase is-total" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}">${label}</span>`;
        });
        ganttHtml += `<div class="wz-gantt-row wz-gantt-total"><span class="wz-gantt-label">Razem</span><div class="wz-gantt-track">${totalBars}</div></div>`;
    }
    gantt.innerHTML = ganttHtml;
    setupGanttTips(gantt, tips);


    const rows = phases.map((phase, index) => {
        const account = accountName(phase.account);
        const phaseLabel = phase._flowLabel || wzPhaseBadge(index + 1);
        const period = `${phase.start_age}–${phase.last_age} r.ż. (${wzFormatYears(phase.years)})`;
        const health = Number(phase.total_health || 0);
        const pit = Number(phase.total_tax || 0);
        const lump = Number(phase.lump_tax || 0);
        let taxSub = "";
        if (lump > 0.5) {
            taxSub = Math.abs(pit - lump) < 0.5
                ? "jednorazowo"
                : `w tym ${wzFmtZloty(lump)} zł jednorazowo`;
        } else if (health > 0.5) {
            taxSub = pit > 0.5
                ? `PIT ${wzFmtZloty(pit)} zł + zdrowotna ${wzFmtZloty(health)} zł`
                : "zdrowotna 9%";
        }
        const tax = `<span class="wz-flow-tax-cell"><span class="wz-flow-tax-main">${wzFmtZloty(pit + health)} zł</span>${taxSub ? tipHtml(taxSub) : ""}</span>`;
        return `
            <tr>
                <td data-label="Faza"><span class="wz-phase-badge">${escapeHtml(phaseLabel)}</span></td>
                <td data-label="Konto">${escapeHtml(account)}</td>
                <td data-label="Okres">${escapeHtml(period)}</td>
                <td data-label="Średnio netto">${fmtMoney(phase.avg_monthly_net)}/mies.</td>
                <td data-label="Łącznie netto">${fmtMoney(phase.total_net)}</td>
                <td data-label="Podatki i składki">${tax}</td>
                <td data-label="Saldo końcowe">${fmtMoney(phase.ending_balance)}</td>
            </tr>`;
    }).join("");

    const accumulationBox = wzEl("wzAccumulationFlows");
    if (accumulationBox) {
        accumulationBox.innerHTML = wzRenderAccumulationTable(
            accumulationPhases,
            accountName
        );
    }
    const transferBox = wzEl("wzTransferFlows");
    if (transferBox) {
        transferBox.innerHTML = wzRenderTransferTable(
            transfers,
            projection,
            accountName
        );
    }
    wrap.innerHTML = phases.length
        ? `<h5 class="wz-flows-subtitle">Wypłaty</h5>
        <div class="wz-flows-table-wrap">
            <table class="wz-flows-table">
                <thead><tr><th>Faza</th><th>Konto</th><th>Okres</th><th>Średnio netto</th><th>Łącznie netto</th><th>Podatki i składki</th><th>Saldo końcowe</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`
        : "";
}

/* ── Wykresy wyniku: wypłaty i kapitał prywatny ─────────────────────────── */

const WZ_CHART_ORDER = [
    "ike", "ikze", "oipe", "ppk", "ppe", "broker", "obligacje", "lokata",
    "oki_inw", "oki_osk", "gotowka", "krypto", "nieruchomosc", "zus",
];
const WZ_CHART_LABELS = {
    ike: "IKE",
    ikze: "IKZE",
    oipe: "OIPE",
    ppk: "PPK",
    ppe: "PPE",
    broker: "Broker",
    obligacje: "Obligacje",
    lokata: "Lokata",
    oki_inw: "OKI inw.",
    oki_osk: "OKI oszcz.",
    gotowka: "Gotówka",
    krypto: "Krypto",
    nieruchomosc: "Nieruchomość",
    zus: "ZUS",
    other: "Pozostałe",
};
const WZ_CHART_MAX_SERIES = 10;

let wzChartData = null;
let wzChartModels = {};
let wzChartGeom = {};
let wzChartPinned = false;
let wzChartPinnedAt = 0;
let wzChartActive = null;
let wzChartHideTimer = null;
let wzChartResizeTimer = null;
let wzChartBound = false;
let wzChartFocusIndex = {};

function wzChartColorKey(key) {
    return WZ_CHART_ORDER.includes(key) || key === "other" ? key : "other";
}

function wzChartOrder(key) {
    const index = WZ_CHART_ORDER.indexOf(key);
    return index === -1 ? WZ_CHART_ORDER.length : index;
}

function wzChartCustomNames(input) {
    const names = new Map();
    (input?.stages || []).forEach((stage) => {
        Object.entries(stage.accounts || {}).forEach(([account, config]) => {
            if (config?.custom_name) names.set(account, config.custom_name);
        });
    });
    return names;
}

function wzChartGroups(raw, input, kind, count) {
    const customNames = wzChartCustomNames(input);
    const groups = new Map();
    Object.entries(raw || {}).forEach(([account, values]) => {
        if (account === "zus:ofe") return;
        const base = baseAccountKey(account);
        if (kind === "capital" && base === "zus") return;
        let group = groups.get(base);
        if (!group) {
            group = {
                key: base,
                label: "",
                values: new Array(count).fill(0),
                accounts: [],
                total: 0,
            };
            groups.set(base, group);
        }
        const clean = Array.from({ length: count }, (_, index) => Number(values?.[index]) || 0);
        clean.forEach((value, index) => { group.values[index] += value; });
        group.accounts.push({
            key: account,
            name: accountDisplayLabel(account, customNames.get(account) || ""),
            values: clean,
        });
    });

    const list = [...groups.values()].filter((group) => {
        group.total = group.values.reduce((sum, value) => sum + value, 0);
        return group.total > 0.5;
    });
    list.forEach((group) => {
        const single = group.accounts.length === 1 ? group.accounts[0] : null;
        const custom = single ? customNames.get(single.key) : "";
        group.label = custom || WZ_CHART_LABELS[group.key] || (single ? single.name : group.key);
    });
    list.sort((a, b) => wzChartOrder(a.key) - wzChartOrder(b.key));
    return list;
}

function wzLimitChartGroups(groups) {
    if (groups.length <= WZ_CHART_MAX_SERIES) return groups;
    const ordered = [...groups].sort((a, b) => b.total - a.total);
    const keep = new Set(ordered.slice(0, WZ_CHART_MAX_SERIES - 1).map((group) => group.key));
    const rest = groups.filter((group) => !keep.has(group.key));
    if (!rest.length) return groups;

    const other = {
        key: "other",
        label: WZ_CHART_LABELS.other,
        values: new Array(groups[0].values.length).fill(0),
        accounts: [],
        total: 0,
    };
    rest.forEach((group) => {
        group.values.forEach((value, index) => { other.values[index] += value; });
        other.accounts.push(...group.accounts);
        other.total += group.total;
    });
    const kept = groups.filter((group) => keep.has(group.key));
    kept.sort((a, b) => wzChartOrder(a.key) - wzChartOrder(b.key));
    kept.push(other);
    return kept;
}

function wzScaleChartGroups(groups, factor) {
    if (factor === 1) return groups;
    return groups.map((group) => ({
        ...group,
        values: group.values.map((value) => value * factor),
        accounts: group.accounts.map((account) => ({
            ...account,
            values: account.values.map((value) => value * factor),
        })),
        total: group.total * factor,
    }));
}

function wzChartTotals(groups, count) {
    return Array.from({ length: count }, (_, index) => (
        groups.reduce((sum, group) => sum + (group.values[index] || 0), 0)
    ));
}

function wzChartCompact(value) {
    const rounded = Math.abs(value) >= 1_000_000
        ? `${(value / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln`
        : Math.abs(value) >= 1_000
            ? `${Math.round(value / 1_000).toLocaleString("pl-PL")} tys.`
            : Math.round(value).toLocaleString("pl-PL");
    return rounded;
}

function wzChartAxisNumber(value) {
    const text = value.toLocaleString("pl-PL", { maximumFractionDigits: 2 });
    const [integer, fraction] = text.split(",");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    return fraction ? `${grouped},${fraction}` : grouped;
}

function wzNiceStep(value, targetTicks) {
    if (!(value > 0)) return 1;
    const raw = value / Math.max(1, targetTicks);
    const power = 10 ** Math.floor(Math.log10(raw));
    const normalized = raw / power;
    const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
    return factor * power;
}

function wzChartAreaPath(x, y, lower, upper, start = 0, end = lower.length - 1) {
    let path = `M ${x(start).toFixed(2)} ${y(lower[start]).toFixed(2)}`;
    for (let index = start + 1; index <= end; index += 1) {
        path += ` L ${x(index).toFixed(2)} ${y(lower[index]).toFixed(2)}`;
    }
    for (let index = end; index >= start; index -= 1) {
        path += ` L ${x(index).toFixed(2)} ${y(upper[index]).toFixed(2)}`;
    }
    return `${path} Z`;
}

function wzChartLinePath(x, y, values, start = 0, end = values.length - 1) {
    let path = `M ${x(start).toFixed(2)} ${y(values[start]).toFixed(2)}`;
    for (let index = start + 1; index <= end; index += 1) {
        path += ` L ${x(index).toFixed(2)} ${y(values[index]).toFixed(2)}`;
    }
    return path;
}

function wzChartVisibleRange(values) {
    let first = -1;
    let last = -1;
    values.forEach((value, index) => {
        if (value <= 0.005) return;
        if (first === -1) first = index;
        last = index;
    });
    return { first, last };
}

function wzChartLegendHtml(groups) {
    return groups.map((group) => {
        const colorKey = wzChartColorKey(group.key);
        return `<span class="wz-chart-legend-item wz-chart-c-${colorKey}"><span class="wz-chart-swatch"></span>${escapeHtml(group.label)}</span>`;
    }).join("");
}

function wzChartGradientId(kind, index) {
    return `wz-chart-grad-${kind}-${index}`;
}

function wzChartReferences(model) {
    if (model.kind === "withdrawals") {
        const positive = model.totals.filter((value) => value > 0.5);
        const fallbackAvg = positive.length
            ? positive.reduce((sum, value) => sum + value, 0) / positive.length
            : null;
        const fallbackMin = positive.length ? Math.min(...positive) : null;
        const rawAvg = model.references?.avgMonthly;
        const rawMin = model.references?.minMonthly;
        const avg = rawAvg == null ? null : Number(rawAvg);
        const min = rawMin == null ? null : Number(rawMin);
        const refs = [];
        if (Number.isFinite(avg) && avg > 0.5) {
            refs.push({ key: "avg", label: "średnia", value: avg });
        } else if (fallbackAvg) {
            refs.push({ key: "avg", label: "średnia", value: fallbackAvg });
        }
        if (Number.isFinite(min) && min >= 0) {
            refs.push({ key: "min", label: "min", value: min });
        } else if (fallbackMin) {
            refs.push({ key: "min", label: "min", value: fallbackMin });
        }
        return refs;
    }
    const peak = Math.max(...model.totals);
    if (!(peak > 0.5)) return [];
    const index = model.totals.indexOf(peak);
    return [{
        key: "peak",
        label: "szczyt",
        value: peak,
        age: model.ages[index],
        index,
    }];
}

function wzChartReferenceSvg(model, refs, geometry) {
    const {
        x, y, margin, plotW, yMax,
    } = geometry;
    const avg = refs.find((ref) => ref.key === "avg");
    const visible = refs.filter((ref) => {
        if (!(ref.value > 0) || ref.value > yMax * 1.001) return false;
        if (ref.key === "min" && avg && avg.value - ref.value < yMax * 0.08) return false;
        return true;
    });
    if (!visible.length) return "";
    const labels = visible.map((ref) => {
        const lineY = y(ref.value);
        const labelY = lineY < margin.top + 18 ? lineY + 14 : lineY - 5;
        const amount = model.kind === "withdrawals"
            ? wzChartAxisNumber(Math.round(ref.value))
            : wzChartCompact(ref.value);
        const label = model.kind === "withdrawals"
            ? `${ref.label} ${amount} zł/mies.`
            : `${ref.label} ${wzChartCompact(ref.value)} zł · ${ref.age} r.ż.`;
        const dot = ref.key === "peak"
            ? `<circle class="wz-chart-reference-dot" cx="${x(ref.index).toFixed(2)}" cy="${lineY.toFixed(2)}" r="4"/>`
            : "";
        return `<line class="wz-chart-reference-line is-${ref.key}" x1="${margin.left}" y1="${lineY.toFixed(2)}" x2="${margin.left + plotW}" y2="${lineY.toFixed(2)}"/>
            ${dot}
            <text class="wz-chart-reference-label is-${ref.key}" x="${margin.left + plotW - 4}" y="${labelY.toFixed(2)}" text-anchor="end">${escapeHtml(label)}</text>`;
    }).join("");
    return `<g class="wz-chart-reference-layer" aria-hidden="true">${labels}</g>`;
}

function wzChartSummary(model) {
    const first = model.ages[0];
    const last = model.ages[model.ages.length - 1];
    const peak = Math.max(...model.totals);
    if (model.kind === "withdrawals") {
        const horizon = Number(model.horizonAge);
        const total = model.totals.reduce(
            (sum, value, index) => (
                Number.isFinite(horizon) && model.ages[index] >= horizon ? sum : sum + value
            ),
            0
        ) * 12;
        const refs = wzChartReferences(model);
        const avg = refs.find((ref) => ref.key === "avg");
        const min = refs.find((ref) => ref.key === "min");
        const extra = [];
        if (avg) extra.push(`Średnia wypłata ${wzChartAxisNumber(Math.round(avg.value))} zł/mies.`);
        if (min) extra.push(`Minimalna wypłata ${wzChartAxisNumber(Math.round(min.value))} zł/mies.`);
        const horizonText = Number.isFinite(horizon)
            ? ` Horyzont planu: ${horizon} r.ż.; dalsze lata pokazują sam ZUS.`
            : "";
        return `Wykres miesięcznych wypłat netto według kont, wiek ${first}–${last}. Łącznie w horyzoncie ${wzFmtZloty(total)} zł netto.${horizonText} ${extra.join(" ")} Użyj strzałek, aby czytać szczegóły.`;
    }
    const peakIndex = model.totals.indexOf(peak);
    return `Wykres kapitału prywatnego według kont, wiek ${first}–${last}. Kapitał szczytowy ${wzFmtZloty(peak)} zł w wieku ${model.ages[peakIndex]}.${model.truncated ? " Wykres ucięty na horyzoncie planu." : ""} Użyj strzałek, aby czytać szczegóły.`;
}

let wzChartMilestones = [];
let wzChartMilestonesVisible = true;
let wzActiveChartMilestone = null;
let wzMilestoneAnchor = null;

function wzChartAnnotationsFor(input, projection) {
    const ages = (projection?.chart?.ages || []).map(Number);
    if (!ages.length) return [];
    const minAge = ages[0];
    const maxAge = ages[ages.length - 1];
    const stages = input?.stages || [];
    const portfolioStages = stages.filter(
        (stage) => stage.stage_type === "realizacja"
            && !("zus" in (stage.accounts || {}))
    );
    // FIRE to pełne zakończenie pracy, a nie etap części etatu. Etapy
    // Coast/Barista mają dodatni part_time_* i nie mogą przejąć etykiety FIRE.
    const fireStage = portfolioStages.find(
        (stage) => !(Number(stage.part_time_net_monthly) > 0)
            && !(Number(stage.part_time_gross_monthly) > 0)
    );
    const zusStage = stages.find(
        (stage) => stage.stage_type === "realizacja"
            && Object.keys(stage.accounts || {}).length === 1
            && stage.accounts.zus
    ) || stages.find(
        (stage) => stage.stage_type === "realizacja"
            && "zus" in (stage.accounts || {})
    );
    const statutoryAge = WZ_RETIREMENT_DEFAULT[input?.gender]
        || (input?.gender === "k" ? 60 : 65);
    const horizonAge = wzInputHorizonAge(input);
    const annotations = [];

    const add = (kind, label, age, text, short = label) => {
        const numeric = Number(age);
        if (!Number.isFinite(numeric) || numeric < minAge || numeric > maxAge) return;
        annotations.push({
            id: `${kind}-${numeric}`,
            kind,
            label,
            short,
            age: numeric,
            text,
        });
    };

    if (fireStage?.start_age != null) {
        add(
            "fire",
            "FIRE",
            fireStage.start_age,
            `Pełne FIRE: ${fireStage.start_age} r.ż. Od tego roku portfel finansuje życie zamiast pensji.`
        );
    }
    if (projection?.early_return_total > 0 && projection?.early_return_age != null) {
        add(
            "ikze",
            "Zwrot IKZE",
            projection.early_return_age,
            `W wieku ${projection.early_return_age} r.ż. IKZE zostało zamknięte: ${fmtMoney(projection.early_return_total)} netto przeniesione do kont docelowych po podatku ${fmtMoney(projection.early_return_tax_total)}. Pionowa linia oznacza ten transfer.`,
            "IKZE"
        );
    }
    if (zusStage?.start_age != null) {
        const zusText = zusStage.start_age !== statutoryAge
            ? `ZUS startuje od ${zusStage.start_age} r.ż. Ustawowy wiek emerytalny to ${statutoryAge} lat.`
            : `ZUS startuje od ${zusStage.start_age} r.ż. To ustawowy wiek emerytalny (${statutoryAge} lat).`;
        add("zus", "ZUS", zusStage.start_age, zusText);
    }
    if (horizonAge != null) {
        const lastYear = Math.max(minAge, horizonAge - 1);
        add(
            "horizon",
            "Horyzont",
            lastYear,
            `Horyzont planu: ${horizonAge} r.ż. — ostatni pełny rok symulacji to ${lastYear}. Metryki i podatek wyjścia liczą się do tego wieku; wykresy pokazują ZUS do 100 r.ż.`
        );
    }

    const byAge = new Map();
    annotations.forEach((annotation) => {
        if (!byAge.has(annotation.age)) byAge.set(annotation.age, []);
        byAge.get(annotation.age).push(annotation);
    });
    byAge.forEach((items) => {
        items.forEach((annotation, index) => {
            annotation.offset = (index - (items.length - 1) / 2) * 3;
        });
    });
    return annotations;
}

function wzUpdateMilestoneToggle() {
    const button = wzEl("wzChartMilestonesToggle");
    const label = wzEl("wzChartMilestonesToggleLabel");
    if (!button || !label) return;
    const hasMilestones = wzChartMilestones.length > 0;
    button.classList.toggle("hidden", !hasMilestones);
    button.setAttribute("aria-pressed", String(wzChartMilestonesVisible));
    label.textContent = wzChartMilestonesVisible
        ? "Ukryj kamienie milowe"
        : "Pokaż kamienie milowe";
}

function wzMilestoneLayout(model, geom) {
    const compact = geom.width < 560;
    const laneHeight = compact ? 28 : 30;
    const railWidth = geom.actualWidth || geom.width;
    const scale = railWidth / Math.max(1, geom.width);
    const items = [];
    (model.annotations || []).forEach((annotation) => {
        const index = model.ages.indexOf(Number(annotation.age));
        if (index < 0) return;
        const lineX = geom.x(index) + (annotation.offset || 0);
        const x = lineX * scale;
        const text = `${annotation.short || annotation.label} ${annotation.age}`;
        const width = Math.min(
            Math.max(40, railWidth - 8),
            Math.max(56, Math.ceil(text.length * 6.4 + 26))
        );
        const left = Math.max(4, Math.min(x - width / 2, railWidth - width - 4));
        items.push({ annotation, lineX, x, text, width, left, top: 0 });
    });
    items.sort((a, b) => a.left - b.left);
    const laneRight = [];
    items.forEach((item) => {
        let lane = 0;
        while (lane < laneRight.length && item.left < laneRight[lane] + 6) {
            lane += 1;
        }
        item.lane = lane;
        item.top = lane * laneHeight;
        laneRight[lane] = item.left + item.width;
    });
    return {
        items,
        height: Math.max(24, laneRight.length * laneHeight),
    };
}

function wzUpdateMilestoneState() {
    document.querySelectorAll(".wz-chart-milestone").forEach((button) => {
        const isActive = button.dataset.annotationId === wzActiveChartMilestone;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-expanded", String(isActive));
        if (isActive) button.setAttribute("aria-describedby", "wzChartMilestoneTipBody");
        else button.removeAttribute("aria-describedby");
    });
    document.querySelectorAll(".wz-chart-milestone-line, .wz-chart-milestone-band").forEach((node) => {
        node.classList.toggle("is-active", node.dataset.annotationId === wzActiveChartMilestone);
    });
}

function wzMilestoneTipHide() {
    const tip = wzEl("wzChartMilestoneTip");
    const anchor = wzMilestoneAnchor;
    const hadActive = Boolean(wzActiveChartMilestone)
        || Boolean(tip && !tip.classList.contains("hidden"));
    const focusInside = Boolean(tip && tip.contains(document.activeElement));
    tip?.classList.add("hidden");
    wzActiveChartMilestone = null;
    wzMilestoneAnchor = null;
    if (hadActive) wzUpdateMilestoneState();
    if (focusInside && anchor?.isConnected) anchor.focus({ preventScroll: true });
}

function wzMilestoneBottomInset() {
    let inset = 8;
    const actionBar = document.querySelector(".action-bar");
    if (actionBar) {
        const rect = actionBar.getBoundingClientRect();
        if (rect.height > 0) inset = Math.max(inset, window.innerHeight - rect.top + 8);
    }
    const tabbar = document.querySelector(".tabbar");
    if (tabbar) {
        const rect = tabbar.getBoundingClientRect();
        if (rect.height > 0) inset = Math.max(inset, window.innerHeight - rect.top + 8);
    }
    return inset;
}

function wzMilestoneTipPlace(anchor) {
    const tip = wzEl("wzChartMilestoneTip");
    if (!tip || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const margin = 8;
    const bottomLimit = window.innerHeight - wzMilestoneBottomInset();
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    const spaceBelow = bottomLimit - rect.bottom;
    const spaceAbove = rect.top;
    const placeBelow = spaceBelow >= height + margin || spaceBelow >= spaceAbove;
    let top = placeBelow ? rect.bottom + margin : rect.top - height - margin;
    top = Math.max(margin, Math.min(top, Math.max(margin, bottomLimit - height - margin)));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function wzMilestoneTipShow(annotation, anchor) {
    const tip = wzEl("wzChartMilestoneTip");
    const body = wzEl("wzChartMilestoneTipBody");
    if (!tip || !body || !anchor) return;
    wzChartTipHide(true);
    wzGanttTipHide(true);
    body.innerHTML = `<div class="wz-gantt-tip-title wz-chart-milestone-tip-title">
            <span class="wz-chart-milestone-dot is-${annotation.kind}" aria-hidden="true"></span>
            <span>${escapeHtml(annotation.label)} · ${annotation.age} r.ż.</span>
        </div>
        <p class="wz-chart-milestone-tip-text">${escapeHtml(annotation.text)}</p>`;
    tip.classList.remove("hidden");
    wzActiveChartMilestone = annotation.id;
    wzMilestoneAnchor = anchor;
    wzUpdateMilestoneState();
    requestAnimationFrame(() => wzMilestoneTipPlace(anchor));
}

function wzMilestoneTipOnScroll() {
    if (!wzMilestoneAnchor) return;
    if (!wzMilestoneAnchor.isConnected) {
        wzMilestoneTipHide();
        return;
    }
    const rect = wzMilestoneAnchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
        wzMilestoneTipHide();
        return;
    }
    requestAnimationFrame(() => wzMilestoneTipPlace(wzMilestoneAnchor));
}

function wzToggleMilestone(annotationId, anchor) {
    if (wzActiveChartMilestone === annotationId && wzMilestoneAnchor === anchor) {
        wzMilestoneTipHide();
        return;
    }
    const annotation = wzChartMilestones.find((item) => item.id === annotationId);
    if (annotation) wzMilestoneTipShow(annotation, anchor);
}

function wzToggleMilestonesVisibility() {
    wzChartMilestonesVisible = !wzChartMilestonesVisible;
    wzMilestoneTipHide();
    wzUpdateMilestoneToggle();
    Object.entries(wzChartModels).forEach(([kind, model]) => {
        const container = kind === "withdrawals"
            ? wzEl("wzWithdrawalsChart")
            : wzEl("wzCapitalChart");
        if (container) wzRenderMilestoneLayer(container, model);
    });
}

function wzRenderMilestoneLayer(container, model) {
    if (!container) return;
    const geom = wzChartGeom[model.kind];
    if (!geom) return;
    container.querySelector(".wz-chart-milestones")?.remove();
    geom.svg.querySelector(".wz-chart-milestone-layer")?.remove();
    if (!wzChartMilestonesVisible || !model.annotations?.length) return;

    const layout = wzMilestoneLayout(model, geom);
    if (!layout.items.length) return;

    const rail = document.createElement("div");
    rail.className = "wz-chart-milestones";
    rail.style.height = `${layout.height}px`;
    rail.setAttribute("role", "group");
    rail.setAttribute(
        "aria-label",
        `Kamienie milowe — ${model.kind === "withdrawals" ? "wypłaty netto" : "kapitał prywatny"}`
    );
    layout.items.forEach(({ annotation, left, top, width }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `wz-chart-milestone is-${annotation.kind}`;
        button.dataset.annotationId = annotation.id;
        button.style.left = `${left}px`;
        button.style.top = `${top}px`;
        button.style.width = `${width}px`;
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", "wzChartMilestoneTip");
        button.setAttribute(
            "aria-label",
            `${annotation.label}, ${annotation.age} r.ż. — pokaż szczegóły`
        );
        button.innerHTML = `<span class="wz-chart-milestone-dot" aria-hidden="true"></span>
            <span class="wz-chart-milestone-label">${escapeHtml(annotation.short || annotation.label)}</span>
            <span class="wz-chart-milestone-age">${annotation.age}</span>`;
        rail.appendChild(button);
    });
    container.insertBefore(rail, container.firstChild);

    const NS = "http://www.w3.org/2000/svg";
    const layer = document.createElementNS(NS, "g");
    layer.setAttribute("class", "wz-chart-milestone-layer");
    layer.setAttribute("aria-hidden", "true");
    layout.items.forEach(({ annotation, lineX }) => {
        const band = document.createElementNS(NS, "rect");
        band.setAttribute("class", `wz-chart-milestone-band is-${annotation.kind}`);
        band.setAttribute("data-annotation-id", annotation.id);
        band.setAttribute("x", String(lineX - 7));
        band.setAttribute("y", String(geom.top));
        band.setAttribute("width", "14");
        band.setAttribute("height", String(geom.plotH));
        band.setAttribute("rx", "4");
        layer.appendChild(band);

        const line = document.createElementNS(NS, "line");
        line.setAttribute("class", `wz-chart-milestone-line is-${annotation.kind}`);
        line.setAttribute("data-annotation-id", annotation.id);
        line.setAttribute("x1", String(lineX));
        line.setAttribute("x2", String(lineX));
        line.setAttribute("y1", String(lineX < geom.left + 56 ? geom.top : 0));
        line.setAttribute("y2", String(geom.top + geom.plotH));
        layer.appendChild(line);
    });
    const hover = geom.svg.querySelector(".wz-chart-hover");
    if (hover) geom.svg.insertBefore(layer, hover);
    else geom.svg.appendChild(layer);
    wzUpdateMilestoneState();
}

function wzChartIndexFromEvent(svg, event) {
    const geom = wzChartGeom[svg?.dataset.chart];
    if (!geom) return 0;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width ? geom.width / rect.width : 1;
    const x = (event.clientX - rect.left) * scale;
    const ratio = (x - geom.left) / geom.plotW;
    return Math.max(0, Math.min(geom.n - 1, Math.round(ratio * (geom.n - 1))));
}

function wzChartFirstActiveIndex(model) {
    const index = model.totals.findIndex((value) => value > 0.5);
    return index === -1 ? 0 : index;
}

function wzChartSetHover(key, index) {
    const geom = wzChartGeom[key];
    if (!geom) return;
    Object.entries(wzChartGeom).forEach(([otherKey, other]) => {
        if (otherKey !== key) other.hover?.classList.remove("is-visible");
    });
    const band = geom.band(index);
    const x = geom.x(index);
    geom.hoverBand.setAttribute("x", band.x.toFixed(2));
    geom.hoverBand.setAttribute("width", band.width.toFixed(2));
    geom.hoverLine.setAttribute("x1", x.toFixed(2));
    geom.hoverLine.setAttribute("x2", x.toFixed(2));
    geom.hoverDot.setAttribute("cx", x.toFixed(2));
    geom.hoverDot.setAttribute("cy", geom.totalY[index].toFixed(2));
    geom.hover?.classList.add("is-visible");
}

function wzChartClearHover() {
    Object.values(wzChartGeom).forEach((geom) => {
        geom.hover?.classList.remove("is-visible");
    });
}

function wzChartTooltipHtml(model, index) {
    const total = model.totals[index] || 0;
    const entries = model.groups
        .map((group) => ({ group, value: group.values[index] || 0 }))
        .filter((entry) => entry.value > 0.5)
        .sort((a, b) => b.value - a.value);

    let totalCard;
    if (model.kind === "withdrawals") {
        totalCard = `<div class="metric wz-chart-tip-total">
            <span class="metric-label">Wypłaty netto</span>
            <span class="metric-value">${wzFmtZloty(total)} zł<span class="wz-chart-tip-unit">/mies.</span></span>
            <span class="wz-chart-tip-total-sub">${total > 0.5 ? `≈ ${wzFmtZloty(total * 12)} zł rocznie` : "brak wypłat w tym roku"}</span>
        </div>`;
    } else {
        totalCard = `<div class="metric wz-chart-tip-total">
            <span class="metric-label">Kapitał prywatny</span>
            <span class="metric-value">${wzFmtZloty(total)} zł</span>
            <span class="wz-chart-tip-total-sub">${total > 0.5 ? "na koniec roku · brutto" : "brak kapitału w tym roku"}</span>
        </div>`;
    }

    const rows = entries.map(({ group, value }) => {
        const percent = total > 0 ? (value / total) * 100 : 0;
        const percentLabel = percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
        const colorKey = wzChartColorKey(group.key);
        const row = `<div class="wz-chart-tip-row wz-chart-c-${colorKey}">
            <span class="wz-chart-tip-label"><span class="wz-chart-swatch"></span><span>${escapeHtml(group.label)}</span></span>
            <span class="wz-chart-tip-value">${wzFmtZloty(value)} zł <span class="wz-chart-tip-share">${percentLabel}</span></span>
        </div>`;
        if (group.accounts.length <= 1) return `<div class="wz-chart-tip-group">${row}</div>`;
        const subs = group.accounts
            .map((account) => ({ name: account.name, value: account.values[index] || 0 }))
            .filter((account) => account.value > 0.5)
            .sort((a, b) => b.value - a.value)
            .map((account) => `<div class="wz-chart-tip-subrow"><span>${escapeHtml(account.name)}</span><span>${wzFmtZloty(account.value)} zł</span></div>`)
            .join("");
        return `<div class="wz-chart-tip-group">${row}${subs ? `<div class="wz-chart-tip-subrows">${subs}</div>` : ""}</div>`;
    }).join("");

    return `<div class="wz-gantt-tip-title">Wiek ${model.ages[index]}</div>
        ${totalCard}
        ${rows ? `<div class="wz-chart-tip-list">${rows}</div>` : ""}`;
}

function wzChartTipPlace(event, key, index) {
    const tip = wzEl("wzChartTip");
    const geom = wzChartGeom[key];
    if (!tip || !geom) return;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let clientX;
    let clientY;
    if (event && Number.isFinite(event.clientX)) {
        clientX = event.clientX;
        clientY = event.clientY;
    } else {
        const rect = geom.svg.getBoundingClientRect();
        clientX = rect.left + (geom.x(index) / geom.width) * rect.width;
        clientY = rect.top + (geom.top / geom.height) * rect.height + 12;
    }
    let left = clientX + 14;
    let top = clientY - height - 12;
    if (left + width > window.innerWidth - 8) left = clientX - width - 14;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top < 8) top = clientY + 16;
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function wzChartTipShow(key, index, event, pin = false) {
    const model = wzChartModels[key];
    const tip = wzEl("wzChartTip");
    const body = wzEl("wzChartTipBody");
    if (!model || !tip || !body) return;
    if (wzActiveChartMilestone) wzMilestoneTipHide();
    wzGanttTipHide(true);
    body.innerHTML = wzChartTooltipHtml(model, index);
    tip.classList.remove("hidden");
    wzChartActive = { key, index };
    wzChartPinned = Boolean(pin);
    if (wzChartPinned) wzChartPinnedAt = Date.now();
    wzChartSetHover(key, index);
    requestAnimationFrame(() => wzChartTipPlace(event, key, index));
}

function wzChartTipHide(force = false) {
    if (wzChartPinned && !force) return;
    clearTimeout(wzChartHideTimer);
    wzChartPinned = false;
    wzChartActive = null;
    wzEl("wzChartTip")?.classList.add("hidden");
    wzChartClearHover();
}

function wzChartTipScheduleHide() {
    clearTimeout(wzChartHideTimer);
    wzChartHideTimer = setTimeout(() => {
        if (!wzChartPinned) wzChartTipHide();
    }, 140);
}

function wzBindChartGlobalEvents() {
    if (wzChartBound) return;
    wzChartBound = true;
    wzEl("wzChartMilestonesToggle")?.addEventListener("click", wzToggleMilestonesVisibility);
    const chartsWrap = wzEl("wzChartsWrap");
    chartsWrap?.addEventListener("click", (event) => {
        const button = event.target.closest?.(".wz-chart-milestone");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        wzToggleMilestone(button.dataset.annotationId, button);
    });
    const milestoneTip = wzEl("wzChartMilestoneTip");
    const milestoneClose = wzEl("wzChartMilestoneTipClose");
    if (milestoneTip) {
        milestoneTip.addEventListener("pointerdown", (event) => event.stopPropagation());
    }
    if (milestoneClose) milestoneClose.addEventListener("click", wzMilestoneTipHide);
    document.addEventListener("pointerdown", (event) => {
        if (!wzActiveChartMilestone) return;
        if (event.target.closest?.(".wz-chart-milestone, #wzChartMilestoneTip")) return;
        wzMilestoneTipHide();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") wzMilestoneTipHide();
    });
    const tip = wzEl("wzChartTip");
    const close = wzEl("wzChartTipClose");
    if (tip) {
        tip.addEventListener("mouseenter", () => clearTimeout(wzChartHideTimer));
        tip.addEventListener("mouseleave", wzChartTipScheduleHide);
    }
    if (close) close.addEventListener("click", () => wzChartTipHide(true));
    document.addEventListener("pointerdown", (event) => {
        if (!wzChartActive) return;
        if (event.target.closest?.(".wz-chart-svg, #wzChartTip")) return;
        wzChartTipHide(true);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") wzChartTipHide(true);
    });
    window.addEventListener("scroll", () => {
        wzMilestoneTipOnScroll();
        // Auto-scroll tuż po kliknięciu nie może od razu zamykać przypiętego dymku.
        if (wzChartPinned && Date.now() - wzChartPinnedAt < 500) return;
        wzChartTipHide(true);
    }, true);
    window.addEventListener("resize", () => {
        wzMilestoneTipHide();
        wzChartTipHide(true);
        clearTimeout(wzChartResizeTimer);
        wzChartResizeTimer = setTimeout(() => {
            if (wzChartData) wzRenderCharts(wzChartData.input, wzChartData.projection);
        }, 180);
    });
}

function wzRenderChartSvg(container, model) {
    const width = Math.max(280, Math.round(container.clientWidth || container.parentElement?.clientWidth || 640));
    const compact = width < 560;
    const height = compact ? 210 : 260;
    const margin = { top: 18, right: 12, bottom: 28, left: compact ? 64 : 60 };
    const plotW = Math.max(40, width - margin.left - margin.right);
    const plotH = height - margin.top - margin.bottom;
    const count = model.ages.length;
    const maxTotal = Math.max(0, ...model.totals);
    const step = wzNiceStep(Math.max(1, maxTotal * 1.08), 5);
    const yMax = Math.max(step, Math.ceil((maxTotal * 1.08) / step) * step);
    const capitalInThousands = model.kind === "capital" && yMax >= 10_000;
    const axisUnit = model.kind === "withdrawals"
        ? "zł/mies."
        : (capitalInThousands ? "tys. zł" : "zł");
    const axisLabel = (value) => {
        if (capitalInThousands) {
            const thousands = value / 1000;
            const digits = Math.abs(thousands) < 10 ? 2 : 0;
            return wzChartAxisNumber(Number(thousands.toFixed(digits)));
        }
        return wzChartAxisNumber(Math.round(value));
    };
    const x = (index) => margin.left + (count <= 1 ? plotW / 2 : (index / (count - 1)) * plotW);
    const y = (value) => margin.top + plotH - (Math.max(0, value) / yMax) * plotH;
    const upperBounds = [];
    let running = new Array(count).fill(0);
    model.groups.forEach((group) => {
        running = running.map((value, index) => value + (group.values[index] || 0));
        upperBounds.push(running);
    });

    let svg = `<svg class="wz-chart-svg" data-chart="${model.kind}" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" tabindex="0" aria-label="${escapeHtml(wzChartSummary(model))}">`;
    svg += `<defs>`;
    model.groups.forEach((group, index) => {
        const colorKey = wzChartColorKey(group.key);
        const { first, last } = wzChartVisibleRange(group.values);
        const upper = upperBounds[index];
        const lower = index === 0 ? new Array(count).fill(0) : upperBounds[index - 1];
        let bandTop = margin.top;
        let bandBottom = margin.top + 1;
        if (first !== -1 && last >= first) {
            bandTop = Math.min(...upper.slice(first, last + 1).map((value) => y(value)));
            bandBottom = Math.max(...lower.slice(first, last + 1).map((value) => y(value)));
        }
        if (bandBottom - bandTop < 1) bandBottom = bandTop + 1;
        svg += `<linearGradient id="${wzChartGradientId(model.kind, index)}" class="wz-chart-c-${colorKey}" gradientUnits="userSpaceOnUse" x1="0" y1="${bandTop.toFixed(2)}" x2="0" y2="${bandBottom.toFixed(2)}">
            <stop offset="0%" class="wz-chart-stop-top"/>
            <stop offset="100%" class="wz-chart-stop-bottom"/>
        </linearGradient>`;
    });
    svg += `</defs>`;
    svg += `<rect class="wz-chart-plot-bg" x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" rx="8"/>`;

    for (let tick = 0; tick * step <= yMax + 0.0001; tick += 1) {
        const value = tick * step;
        const yPos = y(value);
        svg += `<line class="wz-chart-grid" x1="${margin.left}" y1="${yPos.toFixed(2)}" x2="${margin.left + plotW}" y2="${yPos.toFixed(2)}"/>`;
        svg += `<text class="wz-chart-axis-text wz-chart-axis-y" x="${margin.left - 8}" y="${yPos.toFixed(2)}" text-anchor="end">${axisLabel(value)}</text>`;
    }

    const span = count > 1 ? model.ages[count - 1] - model.ages[0] : 1;
    let ageStep = span <= 12 ? 1 : span <= 24 ? 2 : 5;
    if (compact) ageStep = span <= 12 ? 2 : 10;
    const firstTick = Math.ceil(model.ages[0] / ageStep) * ageStep;
    for (let age = firstTick; age <= model.ages[count - 1]; age += ageStep) {
        const index = model.ages.indexOf(age);
        if (index === -1) continue;
        const xPos = x(index);
        svg += `<line class="wz-chart-grid-v" x1="${xPos.toFixed(2)}" y1="${margin.top}" x2="${xPos.toFixed(2)}" y2="${margin.top + plotH}"/>`;
        const anchor = xPos < margin.left + 20 ? "start" : xPos > margin.left + plotW - 20 ? "end" : "middle";
        svg += `<text class="wz-chart-axis-text" x="${xPos.toFixed(2)}" y="${height - 8}" text-anchor="${anchor}">${age}</text>`;
    }

    svg += `<text class="wz-chart-unit" x="${margin.left}" y="11">${axisUnit}</text>`;

    model.groups.forEach((group, index) => {
        const upper = upperBounds[index];
        const lower = index === 0 ? new Array(count).fill(0) : upperBounds[index - 1];
        const colorKey = wzChartColorKey(group.key);
        const { first, last } = wzChartVisibleRange(group.values);
        if (first !== -1 && last >= first) {
            const start = Math.max(0, first - 1);
            const end = Math.min(count - 1, last + 1);
            svg += `<path class="wz-chart-area wz-chart-c-${colorKey}" fill="url(#${wzChartGradientId(model.kind, index)})" d="${wzChartAreaPath(x, y, lower, upper, start, end)}"/>`;
            svg += `<path class="wz-chart-edge wz-chart-c-${colorKey}" d="${wzChartLinePath(x, y, upper, start, end)}"/>`;
        }
    });
    svg += `<path class="wz-chart-total" d="${wzChartLinePath(x, y, model.totals)}"/>`;
    svg += wzChartReferenceSvg(model, wzChartReferences(model), {
        x, y, margin, plotW, yMax,
    });

    svg += `<g class="wz-chart-hover" aria-hidden="true">`;
    svg += `<rect class="wz-chart-hover-band" x="${margin.left}" y="${margin.top}" width="0" height="${plotH}" rx="4"/>`;
    svg += `<line class="wz-chart-hover-line" x1="0" y1="${margin.top}" x2="0" y2="${margin.top + plotH}"/>`;
    svg += `<circle class="wz-chart-hover-dot" cx="0" cy="0" r="4"/>`;
    svg += `</g>`;
    svg += `<rect class="wz-chart-hit" x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}"/>`;
    svg += `</svg>`;

    container.innerHTML = svg;
    const svgEl = container.querySelector(".wz-chart-svg");
    if (!svgEl) return;

    const geom = {
        key: model.kind,
        width,
        actualWidth: container.clientWidth || width,
        height,
        left: margin.left,
        top: margin.top,
        plotW,
        plotH,
        n: count,
        svg: svgEl,
        x,
        totalY: model.totals.map((value) => y(value)),
        hover: svgEl.querySelector(".wz-chart-hover"),
        hoverBand: svgEl.querySelector(".wz-chart-hover-band"),
        hoverLine: svgEl.querySelector(".wz-chart-hover-line"),
        hoverDot: svgEl.querySelector(".wz-chart-hover-dot"),
        band: (index) => {
            const left = index <= 0 ? margin.left : (x(index - 1) + x(index)) / 2;
            const right = index >= count - 1 ? margin.left + plotW : (x(index) + x(index + 1)) / 2;
            return { x: left, width: Math.max(1, right - left) };
        },
    };
    wzChartGeom[model.kind] = geom;

    svgEl.addEventListener("pointermove", (event) => {
        if (wzActiveChartMilestone) return;
        if (wzChartPinned || event.pointerType === "touch") return;
        wzChartTipShow(model.kind, wzChartIndexFromEvent(svgEl, event), event, false);
    });
    svgEl.addEventListener("pointerleave", () => {
        if (!wzChartPinned) wzChartTipScheduleHide();
    });
    svgEl.addEventListener("click", (event) => {
        const index = wzChartIndexFromEvent(svgEl, event);
        if (wzChartActive && wzChartActive.key === model.kind && wzChartActive.index === index && wzChartPinned) {
            wzChartTipHide(true);
        } else {
            wzChartTipShow(model.kind, index, event, true);
        }
    });
    svgEl.addEventListener("focus", () => {
        const index = wzChartFocusIndex[model.kind] ?? wzChartFirstActiveIndex(model);
        wzChartFocusIndex[model.kind] = index;
        wzChartTipShow(model.kind, index, null, false);
    });
    svgEl.addEventListener("blur", () => {
        if (!wzChartPinned) wzChartTipHide(true);
    });
    svgEl.addEventListener("keydown", (event) => {
        let next = null;
        const current = wzChartFocusIndex[model.kind] ?? 0;
        if (event.key === "ArrowRight") next = Math.min(count - 1, current + 1);
        else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = count - 1;
        else if (event.key === "Escape") {
            wzChartTipHide(true);
            return;
        } else {
            return;
        }
        event.preventDefault();
        wzChartFocusIndex[model.kind] = next;
        wzChartTipShow(model.kind, next, null, false);
    });

    wzRenderMilestoneLayer(container, model);
}

function wzRenderCharts(input, projection, summary = {}) {
    const wrap = wzEl("wzChartsWrap");
    if (!wrap) return;
    const chart = projection?.chart;
    const ages = Array.isArray(chart?.ages) ? chart.ages.map(Number) : [];
    if (!ages.length) {
        wrap.classList.add("hidden");
        wzChartMilestones = [];
        wzMilestoneTipHide();
        wzUpdateMilestoneToggle();
        wzChartData = null;
        wzChartTipHide(true);
        return;
    }

    const withdrawalGroups = wzScaleChartGroups(
        wzLimitChartGroups(
            wzChartGroups(chart.withdrawals_net, input, "withdrawals", ages.length)
        ),
        1 / 12
    );
    const inputHorizon = wzInputHorizonAge(input);
    const horizonAge = Number.isFinite(inputHorizon)
        ? inputHorizon
        : (Number.isFinite(Number(summary?.end_age)) ? Number(summary.end_age) + 1 : null);
    // Wykresy wypłat pokazują ZUS do 100 r.ż.; kapitał prywatny urywamy na
    // horyzoncie planu (plan_end jest wiekiem ekskluzywnym — ostatni rok to
    // plan_end - 1), żeby nie sugerować, że poza modelem nadal rośnie.
    const capitalAges = horizonAge == null
        ? ages
        : ages.filter((age) => age < horizonAge);
    const capitalLimit = capitalAges.length;
    let capitalGroups = wzLimitChartGroups(
        wzChartGroups(chart.balances, input, "capital", ages.length)
    ).map((group) => ({
        ...group,
        values: group.values.slice(0, capitalLimit),
    }));
    if (!capitalLimit) capitalGroups = [];
    if (!withdrawalGroups.length && !capitalGroups.length) {
        wrap.classList.add("hidden");
        wzChartMilestones = [];
        wzMilestoneTipHide();
        wzUpdateMilestoneToggle();
        wzChartData = null;
        wzChartTipHide(true);
        return;
    }

    wrap.classList.remove("hidden");
    const annotations = wzChartAnnotationsFor(input, projection);
    const references = {
        // Linie referencyjne to wypłata z portfela i ZUS, nie lifestyle
        // (mean/min z projekcji zawierają część etatu i kredyt).
        avgMonthly: Number(summary?.avg_monthly) || null,
        minMonthly: Number(summary?.min_monthly) || null,
        peakWealth: Number(projection?.peak_wealth) || null,
    };
    wzChartMilestones = annotations;
    wzMilestoneTipHide();
    wzUpdateMilestoneToggle();
    wzChartData = { input, projection };
    wzChartModels = {
        withdrawals: {
            kind: "withdrawals",
            ages,
            annotations,
            references,
            horizonAge,
            groups: withdrawalGroups,
            totals: wzChartTotals(withdrawalGroups, ages.length),
        },
        capital: {
            kind: "capital",
            ages: capitalAges,
            annotations,
            references,
            horizonAge,
            truncated: capitalAges.length < ages.length,
            groups: capitalGroups,
            totals: wzChartTotals(capitalGroups, capitalAges.length),
        },
    };
    wzChartTipHide(true);

    const withdrawalLegend = wzEl("wzWithdrawalsLegend");
    const capitalLegend = wzEl("wzCapitalLegend");
    if (withdrawalLegend) withdrawalLegend.innerHTML = wzChartLegendHtml(withdrawalGroups);
    if (capitalLegend) capitalLegend.innerHTML = wzChartLegendHtml(capitalGroups);

    const withdrawalChart = wzEl("wzWithdrawalsChart");
    if (withdrawalChart) {
        if (withdrawalGroups.length) {
            wzRenderChartSvg(withdrawalChart, wzChartModels.withdrawals);
        } else {
            delete wzChartGeom.withdrawals;
            withdrawalChart.innerHTML = `<div class="wz-chart-empty">Brak wypłat w tym planie.</div>`;
        }
    }

    const capitalChart = wzEl("wzCapitalChart");
    if (capitalChart) {
        if (capitalGroups.length) {
            wzRenderChartSvg(capitalChart, wzChartModels.capital);
        } else {
            delete wzChartGeom.capital;
            capitalChart.innerHTML = `<div class="wz-chart-empty">Brak kapitału prywatnego w tym planie.</div>`;
        }
    }

    wzBindChartGlobalEvents();
}

function wzRenderPolicy(projection) {
    const note = wzEl("wzPolicyTipText");
    if (!note) return;
    const policy = projection?.withdrawal_policy || "";
    const early = policy.startsWith("early");
    const roi = policy.endsWith("_roi");
    const tax = policy.endsWith("_tax");
    let text = "Najpierw konta dostępne bez kary, potem wcześniejsze z 19% "
        + "(IKE/PPK/PPE przed 60), na końcu IKZE przed 65 (skala).";
    text += early
        ? " W tym planie IKZE jest opodatkowane wcześniej, a IKE/PPK schodzą później."
        : " W tym planie nie wymuszamy wcześniejszego zwrotu IKZE — najpierw schodzą IKE/PPK i konta dostępne. Jeśli portfel nie wystarcza, silnik może odblokować IKZE wcześniej.";
    text += tax
        ? " W obrębie progu najpierw konta najtańsze podatkowo (np. OKI, IKE po 60)."
        : roi
            ? " W obrębie progu najpierw konta z niższym ROI."
            : " W obrębie progu wypłaty idą proporcjonalnie do sald.";
    note.textContent = text;
}

// --- Zakończenie i przejście do symulatora ----------------------------------

function wzSimulationFileName(name) {
    const slug = String(name || "plan-fire")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "plan-fire";
    return `${slug}.sim.json`;
}

function wzExportPlan() {
    if (!wzPlan) return;
    const activeInput = wzPlan.scenario_inputs?.[wzSelectedScenario] || wzPlan.input;
    if (!activeInput) return;
    const target = wzCurrentPath() !== 1 ? wzNum("wzTarget", 0) : 0;
    const name = target > 0
        ? `Plan FIRE — ${Math.round(target)} zł/mies.`
        : `Plan FIRE ${new Date().toISOString().slice(0, 10)}`;
    const payload = {
        schema: "fire-simulation/v1",
        name,
        exported_at: new Date().toISOString(),
        source: "wizard",
        scenario: wzSelectedScenario,
        meta: {
            path: wzCurrentPath(),
            target_monthly: wzCurrentPath() !== 1 ? wzNum("wzTarget", 0) : null,
            strategy: wzStrategyForRisk(),
            risk_profile: wzRiskProfile(),
            allocation_mode: wzAllocationMode,
            allocations: wzCurrentAllocations(),
            wrapper_vehicles: wzCurrentVehicles(),
            pool_monthly: Number(wzSuggested?.pool_monthly) || 0,
            optimized: Boolean(wzPlan.optimization),
            recommended_allocations: wzPlan.optimization?.recommended?.allocations || null,
            recommended_wrapper_vehicles: wzPlan.optimization?.recommended?.vehicles || null,
            recommended_zus_start_age: wzPlan.optimization?.recommended?.zus_start_age ?? null,
        },
        input: activeInput,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = wzSimulationFileName(name);
    a.click();
    URL.revokeObjectURL(a.href);
}

function wzBuildDraft(activeInput) {
    const input = activeInput || {};
    return {
        version: WZ_DRAFT_VERSION,
        // Pełny input jest źródłem prawdy dla Symulatora; stare pola zostają
        // dla zgodności z wcześniejszymi wersjami frontu.
        input,
        gender: input.gender,
        config: input.config,
        stages: input.stages,
        withdrawal_policy: input.withdrawal_policy || "defer_tier",
        max_age: input.max_age,
        mortgage_monthly: input.mortgage_monthly,
        mortgage_end_age: input.mortgage_end_age,
        monthly_gross: input.monthly_gross,
        start_year: input.start_year,
        inflation: input.inflation,
        source: "wizard",
    };
}

function wzFinish() {
    if (!wzPlan) return;
    wzSaveState();
    wzSavePlanCache();
    const activeInput = wzPlan.scenario_inputs?.[wzSelectedScenario] || wzPlan.input;
    const draft = wzBuildDraft(activeInput);
    try {
        localStorage.setItem("fire.wizardDraft", JSON.stringify(draft));
    } catch {
        // Gdy localStorage jest pełny, przejście do symulatora nadal działa.
    }
    window.location.href = "/sim?wizard=1";
}

// --- Zdarzenia --------------------------------------------------------------

function wzTouch() {
    wzClearValidationError();
    wzFormVersion += 1;
    wzPlan = null;
    wzPlanSignature = "";
    wzPlanBodyCache = null;
    wzInvalidateSuggestion();
    wzUpdateSavingsHint();
    if (wzCurrentStep === "strategia") wzScheduleSuggestion();
    wzScheduleStateSave();
}

function wzIsSalaryEvent(target) {
    if (!target) return false;
    if (WZ_SALARY_IDS.has(target.id)) return true;
    if (WZ_SALARY_NAMES.has(target.name)) return true;
    return false;
}

function wzIsEtatSalaryInput(target) {
    if (!target) return false;
    return ["wzEtatSalary", "wzEtatSalaryRange"].includes(target.id)
        || ["wzEtatSalaryMode", "wzEtatPeriod"].includes(target.name);
}

function wzSyncAllPanels() {
    wzSyncPathUI();
    wzSyncB2bRows();
    wzSyncZusBox();
    wzSyncOfeBox();
    wzSyncPayrollPrograms();
    wzSyncMortgageBox();
    wzSyncRealEstateBox();
    wzSyncFireStyle();
    wzUpdateSalaryLabels();
}

function wzBindEvents() {
    const wizard = document.querySelector(".wizard");
    if (!wizard) return;

    wzEl("wzBackBtn")?.addEventListener("click", wzBack);
    wzEl("wzNextBtn")?.addEventListener("click", wzNext);
    wzEl("wzExportBtn")?.addEventListener("click", wzExportPlan);
    wzEl("wzProfileSeeds")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-profile-seed]");
        if (button) wzApplyProfileSeed(button.dataset.profileSeed);
    });

    wizard.addEventListener("input", (event) => {
        const target = event.target;
        if (!target) return;
        if (target.name === "wzAllocationMode") return;
        if (target.matches?.(".wz-manual-share, .wz-manual-share-range")) {
            wzUpdateManualAllocationInput(target);
            return;
        }
        wzTouch();
        if (wzIsEtatSalaryInput(target)) wzSalaryTouched = true;
        if (["wzPpkEmployeePct", "wzPpkEmployerPct", "wzPpeEmployerPct"].includes(target.id)) {
            wzPayrollRatesTouched = true;
            wzUpdatePayrollRateSummaries();
        }
        if (target.id === "wzEtatSalary" || target.id === "wzEtatSalaryRange") {
            wzRememberMonthlySalary();
        }
        if (target.matches?.(".wz-cap-roi")) {
            const value = parseFloat(target.value);
            const defaultValue = parseFloat(target.dataset.defaultRoi);
            target.dataset.roiEdited = Number.isFinite(value)
                && (!Number.isFinite(defaultValue) || Math.abs(value - defaultValue) > 1e-9)
                ? "true"
                : "false";
            wzSyncRoiReset(target);
        }
        if (target.matches?.(".wz-cap-name")) {
            const row = target.closest(".wz-cap-row");
            const display = row?.querySelector(".wz-cap-name-display");
            if (display) display.textContent = target.value.trim() || row.dataset.defaultName;
        }
        if (wzIsSalaryEvent(target)) wzScheduleSalaryPreview();
        if (target.name === "wzOptimizeMode") {
            wzSyncModeUI();
            wzShowStep(wzCurrentStep, false);
        }
        if (target.name === "wzPath") {
            wzSyncPathUI();
            wzShowStep(wzCurrentStep, false);
        }
        if (target.name === "wzEmployment") {
            wzApplyDefaultSalary();
            wzUpdateSalaryLabels();
            wzSyncPayrollPrograms();
            wzApplyEtatPeriod(false);
            wzScheduleSalaryPreview();
        }
        if (target.name === "wzGender") {
            const gender = wzRadio("wzGender", "m");
            if (!wzRetirementTouched) {
                const retirement = WZ_RETIREMENT_DEFAULT[gender] || WZ_RETIREMENT_DEFAULT.m;
                wzSetValue("wzRetirement", retirement);
                wzSetValue("wzRetirementRange", retirement);
            }
            wzApplyPlanEndDefault();
        }
        if (target.id === "wzAge" || target.id === "wzAgeRange") {
            wzApplyPlanEndDefault();
            wzSyncAgeBounds();
        }
        if (target.name === "wzEtatSalaryMode") {
            wzUpdateSalaryLabels();
            wzScheduleSalaryPreview();
        }
        if (target.name === "wzEtatPeriod") {
            wzApplyEtatPeriod(true);
            wzScheduleSalaryPreview();
        }
        if (target.name === "wzB2bTaxForm") wzSyncB2bRows();
        if (target.name === "wzB2bZusMode") wzSyncB2bRows();
        if (target.name === "wzB2bSalaryMode") wzUpdateSalaryLabels();
        if (target.name === "wzHasZusCap") wzSyncZusBox();
        if (target.name === "wzHasOfe") wzSyncOfeBox();
        if (target.name === "wzPpkState" || target.name === "wzPpeState") {
            wzSyncPayrollPrograms();
        }
        if (target.name === "wzHasMortgage") wzSyncMortgageBox();
        if (target.name === "wzHasRealEstate") wzSyncRealEstateBox();
        if (target.name === "wzFireStyle") wzSyncFireStyle();
        if (target.id === "wzRetirement" || target.id === "wzRetirementRange") {
            wzRetirementTouched = true;
            wzSyncAgeBounds();
        }
        if (target.id === "wzPlanEnd" || target.id === "wzPlanEndRange") {
            wzPlanEndTouched = true;
        }
        if (target.id === "wzRe" || target.id === "wzReRange") wzSyncSemiBounds();
        if (target.id === "wzSavings" || target.id === "wzSavingsRange") {
            wzUpdateSavingsHint();
        }
    });

    wizard.addEventListener("change", (event) => {
        const target = event.target;
        if (!target) return;
        if (target.name === "wzAllocationMode") {
            wzSetAllocationMode(target.value);
            return;
        }
        if (target.matches?.(".wz-manual-share, .wz-manual-share-range")) {
            wzUpdateManualAllocationInput(target);
            return;
        }
        wzTouch();

        if (wzIsEtatSalaryInput(target)) wzSalaryTouched = true;
        if (target.name === "wzEtatSalaryMode" || target.name === "wzB2bSalaryMode") {
            wzApplySalaryModeConversion();
        }
        if (wzIsSalaryEvent(target)) {
            wzUpdateSalaryLabels();
            wzScheduleSalaryPreview();
        }
        if (target.name === "wzOptimizeMode") {
            wzSyncModeUI();
            wzShowStep(wzCurrentStep, false);
        }
        if (target.name === "wzEtatPeriod") {
            wzApplyEtatPeriod(true);
            wzScheduleSalaryPreview();
        }
        if (target.name === "wzPath") {
            wzSyncPathUI();
            wzSyncSemiBounds();
            wzShowStep(wzCurrentStep, false);
        }
        if (target.name === "wzB2bTaxForm" || target.name === "wzB2bZusMode") {
            wzSyncB2bRows();
        }
        if (target.name === "wzHasZusCap") wzSyncZusBox();
        if (target.name === "wzHasOfe") wzSyncOfeBox();
        if (target.name === "wzPpkState" || target.name === "wzPpeState") {
            wzSyncPayrollPrograms();
        }
        if (target.name === "wzHasMortgage") wzSyncMortgageBox();
        if (target.name === "wzHasRealEstate") wzSyncRealEstateBox();
        if (target.name === "wzEmployment") {
            wzApplyDefaultSalary();
            wzUpdateSalaryLabels();
            wzSyncPayrollPrograms();
            wzScheduleSalaryPreview();
            const order = wzStepOrder();
            if (!order.includes(wzCurrentStep)) {
                wzShowStep("profil");
            } else if (wzCurrentStep === "etat" || wzCurrentStep === "b2b") {
                wzShowStep(wzEmployment() === "b2b" ? "b2b" : "etat");
            }
        }
        if (target.name === "wzFireStyle") wzSyncFireStyle();
    });

    wizard.addEventListener("change", (event) => {
        const select = event.target.closest?.(".wz-vehicle-select");
        if (select) wzOnVehicleChange(select);
    });

    wizard.addEventListener("keydown", (event) => {
        const input = event.target.closest?.(".wz-cap-name");
        if (!input) return;
        if (event.key === "Enter") {
            event.preventDefault();
            input.closest(".wz-cap-row")?.querySelector(".wz-cap-name-save")?.click();
        } else if (event.key === "Escape") {
            const row = input.closest(".wz-cap-row");
            const display = row?.querySelector(".wz-cap-name-display");
            if (row && display) {
                input.value = display.textContent || row.dataset.defaultName;
                row.querySelector(".wz-cap-name-edit")?.classList.add("hidden");
                row.querySelector(".wz-cap-name-edit-btn")?.classList.remove("hidden");
                input.blur();
            }
        }
    });

    wizard.addEventListener("click", (event) => {
        const showAll = event.target.closest("#wzStrategyShowAll");
        if (showAll) {
            wzStrategyExpanded = !wzStrategyExpanded;
            wzRenderStrategyPreviews();
            return;
        }
        const editName = event.target.closest(".wz-cap-name-edit-btn");
        if (editName) {
            const row = editName.closest(".wz-cap-row");
            const nameEdit = row?.querySelector(".wz-cap-name-edit");
            const nameInput = nameEdit?.querySelector(".wz-cap-name");
            if (nameEdit && nameInput) {
                nameInput.value = row.dataset.defaultName === row.querySelector(".wz-cap-name-display")?.textContent
                    ? row.dataset.defaultName
                    : row.querySelector(".wz-cap-name-display")?.textContent || row.dataset.defaultName;
                nameEdit.classList.remove("hidden");
                editName.classList.add("hidden");
                nameInput.focus();
                nameInput.select();
            }
            return;
        }
        const saveName = event.target.closest(".wz-cap-name-save");
        if (saveName) {
            const row = saveName.closest(".wz-cap-row");
            row?.querySelector(".wz-cap-name-edit")?.classList.add("hidden");
            row?.querySelector(".wz-cap-name-edit-btn")?.classList.remove("hidden");
            wzTouch();
            return;
        }
        const roiReset = event.target.closest(".wz-cap-roi-reset");
        if (roiReset) {
            const input = roiReset.closest(".wz-field")?.querySelector(".wz-cap-roi");
            if (input) {
                const defaultValue = input.dataset.defaultRoi || "";
                input.value = defaultValue;
                input.dataset.roiEdited = "false";
                wzSyncRoiReset(input);
                wzTouch();
            }
            return;
        }
        const addMulti = event.target.closest(".wz-add-multi");
        if (addMulti) {
            wzAddMulti(addMulti.dataset.base);
            return;
        }
        const addSingle = event.target.closest(".wz-add-single");
        if (addSingle) {
            wzToggleSingle(addSingle.dataset.account);
            return;
        }
        const remove = event.target.closest(".wz-cap-remove");
        if (remove) {
            const row = remove.closest(".wz-cap-row");
            const account = row?.dataset.account;
            row?.remove();
            if (account && WZ_SHELTERS.some((shelter) => shelter.account === account)) {
                wzRefreshShelterPicker();
            }
            wzSyncSingleButtons();
            wzSyncMultiAddButtons();
            wzTouch();
            return;
        }
        const retryPlan = event.target.closest("[data-wz-retry-plan]");
        if (retryPlan) {
            wzRunPlan({ validated: true });
            return;
        }
        const retry = event.target.closest("[data-wz-retry-suggest]");
        if (retry) {
            wzRefreshSuggestion();
            return;
        }
        const scenario = event.target.closest("#wzScenariosBox .wz-scenario-card");
        if (scenario && wzPlan) {
            wzSelectedScenario = scenario.dataset.scenario;
            wzRenderResult(wzPlan);
            wzSavePlanCache();
        }
    });
}

function wzCollectFormState() {
    const fields = [];
    document.querySelectorAll(".wizard input, .wizard select, .wizard textarea").forEach((el) => {
        if (el.closest(".wz-cap-row")) return;
        if (el.type === "radio") {
            if (el.checked && el.name) {
                fields.push({ kind: "radio", name: el.name, value: el.value });
            }
            return;
        }
        if (!el.id) return;
        if (el.type === "checkbox") {
            fields.push({ kind: "checkbox", id: el.id, checked: Boolean(el.checked) });
        } else {
            fields.push({ kind: "value", id: el.id, value: el.value });
        }
    });
    return fields;
}

function wzCollectCapitalState() {
    return [...document.querySelectorAll(
        "#wzSheltersList .wz-cap-row, #wzSafeList .wz-cap-row, #wzMarketList .wz-cap-row"
    )].map((row) => {
        const roi = row.querySelector(".wz-cap-roi");
        return {
            account: row.dataset.account,
            amount: row.querySelector(".wz-cap-amount")?.value || "0",
            roi: roi?.value || "",
            roiEdited: roi?.dataset.roiEdited === "true",
            name: row.querySelector(".wz-cap-name")?.value || "",
            displayName: row.querySelector(".wz-cap-name-display")?.textContent || "",
        };
    });
}

function wzSaveState() {
    if (!wzStateReady || wzRestoring) return;
    clearTimeout(wzStateTimer);
    const state = {
        version: WZ_STATE_VERSION,
        step: wzCurrentStep,
        fields: wzCollectFormState(),
        rows: wzCollectCapitalState(),
        allocationMode: wzAllocationMode,
        manualAllocations: wzManualAllocations,
        manualVehicles: wzManualVehicles,
        suggested: wzSuggested,
        suggestSignature: wzSuggestSignature,
        selectedScenario: wzSelectedScenario,
        retirementTouched: wzRetirementTouched,
        planEndTouched: wzPlanEndTouched,
        salaryTouched: wzSalaryTouched,
        payrollRatesTouched: wzPayrollRatesTouched,
        longevityGrowth: wzLongevityGrowth,
        salaryPreview: wzSalaryPreview,
        etatPeriodPrev: wzEtatPeriodPrev,
    };
    try {
        localStorage.setItem(WZ_STATE_KEY, JSON.stringify(state));
        localStorage.removeItem(WZ_LEGACY_STATE_KEY);
    } catch {
        // Brak miejsca w localStorage nie może blokować kreatora.
    }
}

function wzScheduleStateSave() {
    if (!wzStateReady || wzRestoring) return;
    clearTimeout(wzStateTimer);
    wzStateTimer = setTimeout(wzSaveState, WZ_STATE_SAVE_MS);
}

function wzSavePlanCache() {
    if (!wzPlan) return;
    const body = wzPlanBodyCache || wzPlanBody();
    try {
        localStorage.setItem(WZ_PLAN_KEY, JSON.stringify({
            version: WZ_PLAN_VERSION,
            plan: wzPlan,
            body,
            path: wzCurrentPath(),
            signature: wzPlanSignature || wzCanonicalJson(body),
            selectedScenario: wzSelectedScenario,
        }));
        localStorage.removeItem(WZ_LEGACY_PLAN_KEY);
    } catch {
        // Gdy localStorage jest pełny, powrót po prostu pominie cache planu.
    }
}

function wzRestoreFormState(fields) {
    fields.forEach((field) => {
        if (field.kind === "radio") {
            document.querySelectorAll(`input[name="${field.name}"]`).forEach((el) => {
                if (el.value === field.value) el.checked = true;
            });
            return;
        }
        const el = document.getElementById(field.id);
        if (!el) return;
        if (field.kind === "checkbox") {
            el.checked = Boolean(field.checked);
        } else {
            el.value = field.value;
        }
    });
}

function wzCapitalListId(account) {
    if (WZ_SHELTERS.some((shelter) => shelter.account === account)) return "wzSheltersList";
    if (WZ_SAFE_BASES.includes(wzBaseKey(account))) return "wzSafeList";
    return "wzMarketList";
}

function wzCapitalRowAllowsName(account) {
    return !WZ_SHELTERS.some((shelter) => shelter.account === account)
        && account !== "oki_inw"
        && account !== "oki_osk";
}

function wzRestoreCapitalState(rows) {
    ["wzSheltersList", "wzSafeList", "wzMarketList"].forEach((id) => {
        const list = wzEl(id);
        if (list) list.innerHTML = "";
    });
    rows.forEach((saved) => {
        const account = saved.account;
        if (!account) return;
        const row = wzBuildCapRow(account, {
            name: wzCapitalRowAllowsName(account),
            roi: true,
        });
        const amount = row.querySelector(".wz-cap-amount");
        if (amount) amount.value = saved.amount ?? "0";
        const roi = row.querySelector(".wz-cap-roi");
        if (roi) {
            roi.value = saved.roi ?? "";
            roi.dataset.roiEdited = saved.roiEdited ? "true" : "false";
            wzSyncRoiReset(roi);
        }
        const name = saved.name || saved.displayName || row.dataset.defaultName;
        const nameInput = row.querySelector(".wz-cap-name");
        const nameDisplay = row.querySelector(".wz-cap-name-display");
        if (nameInput) nameInput.value = name;
        if (nameDisplay) nameDisplay.textContent = name;
        wzEl(wzCapitalListId(account))?.appendChild(row);
    });
    wzRefreshShelterPicker();
    wzSyncSingleButtons();
    wzSyncMultiAddButtons();
}

function wzReadCachedPlan(allowLegacy = true) {
    let raw = null;
    try {
        raw = localStorage.getItem(WZ_PLAN_KEY)
            || localStorage.getItem(WZ_LEGACY_PLAN_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    let stored = null;
    try {
        stored = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!stored || !stored.plan) return null;
    if (Number(stored.version) !== WZ_PLAN_VERSION) return null;
    // Starsze cache'e nie mają serii do wykresów — wymuś świeże wyliczenie.
    if (!stored.plan?.projection?.chart?.ages?.length) return null;

    const body = wzPlanBody();
    const signature = wzCanonicalJson(body);
    if (stored.body) {
        if (wzCanonicalJson(stored.body) !== signature) return null;
    } else if (!allowLegacy || Number(stored.path || 1) !== wzCurrentPath()) {
        return null;
    }
    return { stored, body, signature };
}

function wzMigratePayrollState(state) {
    const fields = state?.fields || [];
    const hasPpkState = fields.some((field) => field.name === "wzPpkState");
    const hasPpeState = fields.some((field) => field.name === "wzPpeState");
    const fieldValue = (id) => fields.find((field) => field.id === id)?.value;
    const fieldChecked = (id) => Boolean(fields.find((field) => field.id === id)?.checked);
    if (!hasPpkState) {
        const balance = parseFloat(fieldValue("wzPpkBalance")) || 0;
        const next = fieldChecked("wzUsePpk") ? "active" : (balance > 0 ? "paused" : "never");
        const radio = document.querySelector(`input[name="wzPpkState"][value="${next}"]`);
        if (radio) radio.checked = true;
    }
    if (!hasPpeState) {
        const balance = parseFloat(fieldValue("wzPpeBalance")) || 0;
        const next = fieldChecked("wzUsePpe") ? "active" : (balance > 0 ? "paused" : "never");
        const radio = document.querySelector(`input[name="wzPpeState"][value="${next}"]`);
        if (radio) radio.checked = true;
    }
}

function wzRestoreIfRequested() {
    const params = new URLSearchParams(window.location.search || "");
    if (!params.get("restore")) return false;

    let state = null;
    try {
        const rawState = localStorage.getItem(WZ_STATE_KEY)
            || localStorage.getItem(WZ_LEGACY_STATE_KEY);
        if (rawState) state = JSON.parse(rawState);
    } catch {
        state = null;
    }
    if (state && Number(state.version) !== WZ_STATE_VERSION) state = null;

    wzRestoring = true;
    if (state) {
        try {
            wzRestoreFormState(state.fields || []);
            wzMigratePayrollState(state);
            wzRestoreCapitalState(state.rows || []);
            wzApplyDefaultAccountRois();
            wzAllocationMode = state.allocationMode === "manual" ? "manual" : "auto";
            wzManualAllocations = state.manualAllocations || null;
            wzManualVehicles = state.manualVehicles || {};
            wzSuggested = state.suggested || null;
            wzSuggestSignature = state.suggestSignature || "";
            wzSelectedScenario = state.selectedScenario || "realne";
            wzRetirementTouched = Boolean(state.retirementTouched);
            wzPlanEndTouched = Boolean(state.planEndTouched);
            wzSalaryTouched = state.salaryTouched == null
                ? true
                : Boolean(state.salaryTouched);
            wzPayrollRatesTouched = Boolean(state.payrollRatesTouched);
            if (Number.isFinite(Number(state.longevityGrowth))) {
                wzLongevityGrowth = Number(state.longevityGrowth);
            }
            wzSalaryPreview = state.salaryPreview || null;
            wzEtatPeriodPrev = state.etatPeriodPrev || wzEtatPeriod();
            wzSyncAllPanels();
            wzApplyEtatPeriod(false);
            wzEtatPeriodPrev = wzEtatPeriod();
            wzUpdateSalaryLabels();
            wzUpdateSavingsHint();
            wzUpdateAllocationModeControl();
        } catch {
            state = null;
        }
    }
    wzRestoring = false;

    const cached = wzReadCachedPlan(!state);
    if (cached) {
        wzPlan = cached.stored.plan;
        wzPlanBodyCache = cached.body;
        wzPlanSignature = cached.signature;
        wzSelectedScenario = cached.stored.selectedScenario || wzSelectedScenario || "realne";
        wzShowStep("wynik", true);
        return true;
    }

    if (state) {
        const step = state.step === "wynik" ? "strategia" : state.step;
        wzShowStep(step || "cel", true);
        return true;
    }
    return false;
}

function wzInit() {
    if (wzInitialized) return;
    wzInitialized = true;

    const scope = document.querySelector(".wizard") || document;
    if (typeof initTipAnchoring === "function") initTipAnchoring();
    wzInitPayrollRateControls();
    initNumControls(scope);

    const ranges = [
        ["wzAgeRange", "wzAge"],
        ["wzEtatSalaryRange", "wzEtatSalary"],
        ["wzPpkBalanceRange", "wzPpkBalance"],
        ["wzPpeBalanceRange", "wzPpeBalance"],
        ["wzB2bCustomZusRange", "wzB2bCustomZus"],
        ["wzB2bSalaryRange", "wzB2bSalary"],
        ["wzZusBalanceRange", "wzZusBalance"],
        ["wzOfeBalanceRange", "wzOfeBalance"],
        ["wzSavingsRange", "wzSavings"],
        ["wzMortgageMonthlyRange", "wzMortgageMonthly"],
        ["wzMortgageEndAgeRange", "wzMortgageEndAge"],
        ["wzReValueRange", "wzReValue"],
        ["wzReRentRange", "wzReRent"],
        ["wzReLiqAgeRange", "wzReLiqAge"],
        ["wzTargetRange", "wzTarget"],
        ["wzSemiAgeRange", "wzSemiAge"],
        ["wzSemiNetRange", "wzSemiNet"],
        ["wzSemiSavingsRange", "wzSemiSavings"],
        ["wzReRange", "wzRe"],
        ["wzRetirementRange", "wzRetirement"],
        ["wzPlanEndRange", "wzPlanEnd"],
        ["wzBequestRange", "wzBequest"],
    ];
    ranges.forEach(([rangeId, inputId]) => wzSyncRange(rangeId, inputId));

    wzBuildShelterPicker();
    wzInitCapitalAddButtons();
    wzSyncSingleButtons();
    wzSyncMultiAddButtons();
    wzBindEvents();
    wzUpdateAllocationModeControl();
    wzLoadAccountConfig();
    wzSyncAllPanels();
    wzApplyEtatPeriod(false);
    wzApplyPlanEndDefault();
    wzApplyDefaultSalary();
    wzEtatPeriodPrev = wzEtatPeriod();
    wzUpdateSavingsHint();
    wzShowStep("cel");

    // Pierwszy podgląd pensji jest opóźniony, żeby nie konkurować z renderingiem.
    setTimeout(wzScheduleSalaryPreview, 150);

    const restored = wzRestoreIfRequested();
    wzStateReady = true;
    // Zwykłe wejście na /wizard nie może nadpisać zapisanego stanu; zapisujemy
    // dopiero po interakcji (wzTouch / zmiana kroku). Przy ?restore utrwalamy
    // odtworzony stan.
    if (restored) wzSaveState();
}

document.addEventListener("DOMContentLoaded", wzInit);
