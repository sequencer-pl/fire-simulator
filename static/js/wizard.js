// wizard.js — Asystent FIRE: drzewo kroków, B2B, Coast/Barista FIRE.
// Wymaga: helpers.js, icons.js, sim-utils.js, controls.js, sim-metadata.js.

const WZ_STATE_KEY = "fire.wizardState";
const WZ_PLAN_KEY = "fire.wizardPlan";
const WZ_CONFIG_KEY = "fire.config";
const WZ_LEGACY_CONFIG_KEY = "fire.config.anonymous";
const WZ_LEGACY_STATE_KEY = "fire.wizardV2State";
const WZ_LEGACY_PLAN_KEY = "fire.wizardV2Plan";
const WZ_TINY_CASH_ANNUAL = 120;
const WZ_MIN_TARGET_MONTHLY = 500;
const WZ_STATE_SAVE_MS = 150;
// Wersje cache'y w localStorage. Niezgodne wpisy odrzucamy, żeby po zmianie
// schematu stary stan nie nadpisywał nowego planu.
const WZ_STATE_VERSION = 3;
const WZ_PLAN_VERSION = 3;
const WZ_DRAFT_VERSION = 3;

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

const WZ_OBLIGATION_TYPES = {
    kredyt: "Kredyt",
    alimenty: "Alimenty",
    czynsz: "Czynsz",
    czesne: "Czesne",
    inne: "Zobowiązanie",
};

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
let wzObligationRedirectSeq = 0;
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
    return "Jaki budżet na życie?";
}

function wzShowStep(stepId, focus = false) {
    const order = wzStepOrder();
    const id = order.includes(stepId) ? stepId : order[0];
    wzCurrentStep = id;
    wzClearValidationError();

    document.querySelectorAll(".wz-step").forEach((el) => {
        el.classList.toggle("hidden", el.dataset.stepId !== id);
    });
    if (id !== "wynik") {
        window.ResultsCharts?.hideTips?.();
        window.ResultsPlanTime?.hideTips?.();
    }

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
    wzSyncObligationRedirects();
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

function wzSyncObligationsBox() {
    const has = wzRadio("wzHasObligations", "no") === "yes";
    wzEl("wzObligationsBox")?.classList.toggle("hidden", !has);
}

function wzSyncObligationRedirects() {
    // W ścieżce 3 wiek FIRE jest wynikiem, a nie założeniem — nie ukrywamy
    // wtedy przełącznika na podstawie pola, które i tak jest nieaktywne.
    const path = wzCurrentPath();
    const style = wzRadio("wzFireStyle", "full");
    // Przekierowanie ma pokrycie tylko w akumulacji. W Baricie kończy się ona
    // w wieku części etatu; w Coast trwa do pełnego FIRE.
    const accumulationEnd = path === 3
        ? null
        : (style === "barista" ? wzInt("wzSemiAge", 48) : wzInt("wzRe", 55));
    document.querySelectorAll("#wzObligationsList .obligation-row").forEach((row) => {
        const endAge = parseInt(row.querySelector(".obligation-end")?.value, 10);
        const hasAccumulation = !Number.isFinite(endAge) || !Number.isFinite(accumulationEnd)
            || endAge < accumulationEnd;
        row.querySelector(".obligation-redirect")?.classList.toggle("hidden", !hasAccumulation);
        row.querySelector(".obligation-redirect-note")?.classList.toggle("hidden", hasAccumulation);
        const hint = row.querySelector(".obligation-redirect-hint");
        if (hint) {
            hint.textContent = path === 3
                ? "Zadziała tylko wtedy, gdy po zakończeniu zobowiązania pozostanie etap akumulacji."
                : "Bez przekierowania uwolniona kwota zostaje w budżecie na życie.";
        }
    });
}

function wzObligationDefaultAges() {
    const start = wzInt("wzAge", 40);
    return { start, end: Math.min(120, Math.max(start + 1, 55)) };
}

function wzCreateObligationRow(data = {}) {
    const ages = wzObligationDefaultAges();
    const row = document.createElement("div");
    const redirectName = `wzObligationRedirect${++wzObligationRedirectSeq}`;
    const redirectToSavings = data.redirect_to_savings !== false;
    row.className = "obligation-row";
    row.dataset.obligation = "true";
    row.innerHTML = `
        <div class="obligation-head">
            <label class="field obligation-name-field">
                <span class="obligation-label">Nazwa</span>
                <input type="text" class="input obligation-name" maxlength="200"
                       value="${escapeHtml(data.name || "Zobowiązanie")}"
                       aria-label="Nazwa zobowiązania">
            </label>
            <button type="button" class="btn btn-ghost btn-icon btn-sm obligation-remove"
                    title="Usuń zobowiązanie" aria-label="Usuń zobowiązanie">${iconSvg("x")}</button>
        </div>
        <div class="obligation-main">
            <div class="field">
                <span class="obligation-label">Kwota mies. (zł)</span>
                ${numControlsHtml({
                    value: String(Math.round(Number(data.monthly) || 0)),
                    min: "0", max: "100000", step: "100",
                    fieldClass: "obligation-monthly",
                    aria: "kwota zobowiązania",
                })}
            </div>
            <div class="field">
                <span class="obligation-label">Od wieku</span>
                ${numControlsHtml({
                    value: String(Number.isFinite(Number(data.start_age)) ? Number(data.start_age) : ages.start),
                    min: "0", max: "120", step: "1",
                    fieldClass: "obligation-start",
                    aria: "wiek start zobowiązania",
                })}
            </div>
            <div class="field">
                <span class="obligation-label">Do wieku</span>
                ${numControlsHtml({
                    value: String(Number.isFinite(Number(data.end_age)) ? Number(data.end_age) : ages.end),
                    min: "1", max: "120", step: "1",
                    fieldClass: "obligation-end",
                    aria: "wiek końca zobowiązania",
                })}
            </div>
        </div>
        <div class="obligation-redirect">
            <span class="obligation-redirect-title">Po zakończeniu zobowiązania</span>
            <div class="segmented is-sm segmented-stack obligation-redirect-switch"
                 role="radiogroup" aria-label="Po zakończeniu zobowiązania">
                <label class="seg-option">
                    <input type="radio" class="obligation-redirect-yes" name="${redirectName}" value="yes" ${redirectToSavings ? "checked" : ""}>
                    Przekierować na oszczędności
                </label>
                <label class="seg-option">
                    <input type="radio" class="obligation-redirect-no" name="${redirectName}" value="no" ${redirectToSavings ? "" : "checked"}>
                    Zostawić w budżecie
                </label>
            </div>
            <p class="field-hint obligation-redirect-hint">Bez przekierowania uwolniona kwota zostaje w budżecie na życie.</p>
        </div>
        <p class="field-hint obligation-redirect-note hidden">To zobowiązanie kończy się na FIRE lub później. Po zakończeniu budżet zależy od ustawionych wypłat; w Asystencie planner utrzymuje cel, w Symulatorze zmieniasz wypłaty ręcznie.</p>`;
    row.querySelector(".obligation-remove").addEventListener("click", () => {
        row.remove();
        wzTouch();
    });
    row.addEventListener("input", wzTouch);
    row.addEventListener("change", wzTouch);
    return row;
}

function wzAddObligationRow(data = {}) {
    const list = wzEl("wzObligationsList");
    if (!list) return;
    list.appendChild(wzCreateObligationRow(data));
    wzSyncObligationRedirects();
}

function wzAddObligationType(type) {
    const name = WZ_OBLIGATION_TYPES[type] || "Zobowiązanie";
    wzAddObligationRow({ name });
    wzEl("wzObligationsList")?.lastElementChild?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth",
    });
}

function wzRenderObligations(items = []) {
    const list = wzEl("wzObligationsList");
    if (!list) return;
    const hasItems = (items || []).length > 0;
    const radio = document.querySelector(
        `input[name="wzHasObligations"][value="${hasItems ? "yes" : "no"}"]`
    );
    if (radio) radio.checked = true;
    wzSyncObligationsBox();
    list.innerHTML = "";
    (items || []).forEach((item) => wzAddObligationRow(item));
}

function wzGatherObligations() {
    if (wzRadio("wzHasObligations", "no") !== "yes") return [];
    return [...document.querySelectorAll("#wzObligationsList .obligation-row")]
        .map((row) => {
            const name = row.querySelector(".obligation-name")?.value.trim() || "Zobowiązanie";
            const monthly = parseFloat(row.querySelector(".obligation-monthly")?.value) || 0;
            const startAge = parseInt(row.querySelector(".obligation-start")?.value, 10);
            const endAge = parseInt(row.querySelector(".obligation-end")?.value, 10);
            return {
                name,
                monthly,
                start_age: Number.isFinite(startAge) ? startAge : 0,
                end_age: Number.isFinite(endAge) ? endAge : 0,
                redirect_to_savings: Boolean(row.querySelector(".obligation-redirect-yes")?.checked),
            };
        })
        .filter((item) => item.monthly > 0 && item.end_age > item.start_age);
}

function wzLegacyObligationsFromFields(fields = []) {
    const hasMortgage = fields.find(
        (field) => field.name === "wzHasMortgage" && field.value === "yes"
    );
    if (!hasMortgage) return [];
    const monthly = parseFloat(
        fields.find((field) => field.id === "wzMortgageMonthly")?.value
    ) || 0;
    const endAge = parseInt(
        fields.find((field) => field.id === "wzMortgageEndAge")?.value,
        10
    );
    if (monthly <= 0 || !Number.isFinite(endAge) || endAge <= 0) return [];
    const redirect = fields.find((field) => field.id === "wzRedirectMortgage");
    return [{
        name: "Kredyt hipoteczny",
        monthly,
        start_age: 0,
        end_age: endAge,
        redirect_to_savings: redirect ? Boolean(redirect.checked) : true,
    }];
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
    wzSyncObligationRedirects();
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
        obligations: wzGatherObligations(),
        mortgage_monthly: 0,
        mortgage_end_age: null,
        redirect_mortgage_to_savings: false,
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
        if (wzRadio("wzHasObligations", "no") === "yes") {
            const rows = [...document.querySelectorAll(
                "#wzObligationsList .obligation-row"
            )];
            if (!rows.length) {
                return wzValidationError(
                    "Dodaj przynajmniej jedno zobowiązanie albo wybierz „Nie mam żadnych zobowiązań”."
                );
            }
            const invalid = rows.find((row) => {
                const monthly = parseFloat(row.querySelector(".obligation-monthly")?.value) || 0;
                const start = parseInt(row.querySelector(".obligation-start")?.value, 10);
                const end = parseInt(row.querySelector(".obligation-end")?.value, 10);
                return monthly > 0 && (
                    !Number.isFinite(start)
                    || !Number.isFinite(end)
                    || end <= start
                    || end <= age
                );
            });
            if (invalid) {
                return wzValidationError(
                    "Uzupełnij zobowiązania: wiek końca musi być późniejszy niż wiek start i obecny wiek.",
                    null
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
        if (path !== 1 && wzNum("wzTarget", 0) < WZ_MIN_TARGET_MONTHLY) {
            return wzValidationError(
                `Cel budżetu musi wynosić co najmniej ${WZ_MIN_TARGET_MONTHLY} zł/mies.`,
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
        window.ResultsCharts?.hideTips?.();
        window.ResultsPlanTime?.hideTips?.();
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
    return window.ResultsModel.horizonAge(input);
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

function wzRenderYearTableFromResult(result, input) {
    const box = wzEl("wzYearTable");
    if (!box || !window.ResultsTable) return;
    window.ResultsTable.render(box, {
        result,
        input,
        density: 5,
        embedded: true,
    });
}

let wzResultsRoot = null;

function wzMountResults() {
    const body = wzEl("wzResultBody");
    if (!body) return null;
    if (!wzResultsRoot || !body.contains(wzResultsRoot)) {
        wzResultsRoot = window.ResultsView.mount(body, { scenarios: true });
    }
    return wzResultsRoot;
}

function wzLoadFullResult(input, scenarioKey) {
    if (!input) return;
    const key = scenarioKey || wzSelectedScenario;
    if (wzPlanSignature !== wzFullResultsSignature) {
        wzFullResults.clear();
        wzFullResultsSignature = wzPlanSignature;
    }
    const planTimeBox = document.querySelector("[data-results-plan-time]");
    const tableBox = wzEl("wzYearTable");
    const cached = wzFullResults.get(key);
    if (cached) {
        // Unieważnij ewentualną odpowiedź w locie dla innego scenariusza.
        wzFullResultSeq += 1;
        window.ResultsPlanTime?.renderStages(planTimeBox, {
            input,
            projection: cached.projection,
            result: cached,
        });
        wzRenderYearTableFromResult(cached, input);
        return;
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
            window.ResultsPlanTime?.renderStages(planTimeBox, {
                input,
                projection: result.projection,
                result,
            });
            wzRenderYearTableFromResult(result, input);
        })
        .catch(() => {
            if (seq !== wzFullResultSeq) return;
            const stageBox = planTimeBox?.querySelector("#wzStageSummary");
            if (stageBox) {
                stageBox.classList.remove("hidden");
                stageBox.innerHTML = '<p class="field-hint">Nie udało się wczytać etapów.</p>';
            }
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
    const root = wzMountResults();
    if (!root) return;
    const active = wzActiveScenarioData(data);
    const planView = window.ResultsModel.fromWizard(data, wzSelectedScenario);
    const warnings = (active.projection?.warnings || []).filter(
        (warning) => !(
            active.projection?.early_return_total > 0
            && warning.startsWith("IKZE:")
            && warning.includes("wcześniejszy zwrot")
        )
    );
    const summary = data.scenario_summaries?.[wzSelectedScenario]
        || data.summary
        || active.projection?.summary
        || {};

    window.ResultsSummary.render(root, {
        hero: wzHeroData(data),
        warnings,
        metrics: window.ResultsSummary.metricsFor(planView),
        facts: wzFactsFor(active.projection, data, active.input, summary),
        why: wzPlanWhyHtml(data),
    });
    wzRenderScenarios(data);
    window.ResultsPlanTime.render(root.querySelector("[data-results-plan-time]"), {
        input: active.input,
        projection: active.projection,
        summary,
        result: null,
        loading: true,
    });
    const chartSection = root.querySelector('[data-results-section="charts"]');
    chartSection?.classList.toggle(
        "hidden",
        !(active.projection?.chart?.ages?.length)
    );
    window.ResultsCharts.render({
        input: active.input,
        projection: active.projection,
        summary,
        mode: "wizard",
    });
    wzLoadFullResult(active.input, wzSelectedScenario);
}

function wzPlanWhyHtml(data) {
    const optimization = data.optimization;
    if (!optimization?.recommended) return "";
    const rec = optimization.recommended;
    const baseline = optimization.baseline;
    const totalObjective = optimization.objective === "total";
    const delta = totalObjective
        ? (rec.total_withdrawn || 0) - (baseline?.total_withdrawn || 0)
        : (rec.payout_monthly || 0) - (baseline?.payout_monthly || 0);
    const objectiveText = totalObjective
        ? "najwyższą sumę wypłat"
        : "najwyższy budżet na życie";
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
    return `<span class="wz-why-label">Dlaczego ten plan?</span> ${escapeHtml(summary)}${tip}`;
}

function wzHeroData(data) {
    const fmt = (value) => (value == null ? "—" : Math.round(value).toLocaleString("pl-PL"));
    const path = data.path || wzCurrentPath();
    const { projection: proj, solved, input } = wzActiveScenarioData(data);
    const scenarioLabel = data.scenarios?.[wzSelectedScenario]?.label || "";
    const kicker = `${wzQuestionForPath(path)}${scenarioLabel ? ` · ${scenarioLabel}` : ""}`;
    const warn = !solved.feasible || !proj.met;

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
                return {
                    kicker: escapeHtml(kicker),
                    headline: `Budżet na życie: co najmniej ${fmt(payout)} zł/mies.`,
                    desc: `Wariant pod najwyższą sumę: łącznie <strong>${fmt(proj.total_withdrawn)} zł</strong> do ${endAge}. roku życia, średnio ${fmt(proj.mean_monthly)} zł/mies. budżetu. ${escapeHtml(sourceNote)}`,
                };
            }
            return {
                kicker: escapeHtml(kicker),
                headline: `Budżet na życie: ${fmt(payout)} zł/mies.`,
                desc: `Od ${reAge}. do ${endAge}. roku życia Twój budżet na życie po zobowiązaniach wyniesie co najmniej <strong>${fmt(payout)} zł/mies.</strong> — portfel, ZUS i ewentualna praca na część etatu.`,
            };
        }
        return {
            kicker: escapeHtml(kicker),
            warn: true,
            headline: "Plan wymaga korekty założeń",
            desc: escapeHtml(solved.note || proj.warnings?.[0] || "Zwiększ oszczędności, wydłuż horyzont lub obniż oczekiwania."),
        };
    }

    if (path === 2) {
        const target = proj.target_monthly || wzNum("wzTarget", 0);
        const savings = solved.savings_monthly;
        if (solved.feasible && savings != null) {
            const pct = solved.savings_pct != null
                ? ` (${solved.savings_pct.toLocaleString("pl-PL")}% pensji netto)`
                : "";
            return {
                kicker: escapeHtml(kicker),
                headline: `Odkładaj ${fmt(savings)} zł/mies.${pct}`,
                desc: `Tyle wystarczy odkładać, aby osiągnąć docelowy budżet na życie <strong>${fmt(target)} zł/mies.</strong> przez cały wybrany horyzont czasowy.`,
            };
        }
        return {
            kicker: escapeHtml(kicker),
            warn: true,
            headline: `Cel ${fmt(target)} zł/mies. budżetu wymaga korekty założeń`,
            desc: escapeHtml(solved.note || "Rozważ późniejszy wiek FIRE lub niższy cel budżetu."),
        };
    }

    const target = proj.target_monthly || wzNum("wzTarget", 0);
    const re = solved.retire_early_age;
    const ageNow = input?.age_now ?? wzInt("wzAge", 40);
    if (solved.feasible && re != null) {
        const yearsLeft = Math.max(0, re - ageNow);
        return {
            kicker: escapeHtml(kicker),
            headline: `W wieku ${re} lat (za ${yearsLeft} ${wzFormatYears(yearsLeft)})`,
            desc: `To najwcześniejszy wiek przejścia na FIRE z gwarancją budżetu na życie co najmniej <strong>${fmt(target)} zł/mies.</strong> po zobowiązaniach.`,
        };
    }
    return {
        kicker: escapeHtml(kicker),
        warn: true,
        headline: `Cel ${fmt(target)} zł/mies. nieosiągalny przed emeryturą`,
        desc: escapeHtml(solved.note || "Rozważ wyższe miesięczne oszczędności lub niższy docelowy budżet."),
    };
}

function wzRenderScenarios(data) {
    const box = wzEl("wzScenariosBox");
    if (!box) return;
    const scenarios = data.scenarios || {};
    const keys = ["konserwatywne", "realne", "optymistyczne"].filter((key) => scenarios[key]);
    const section = box.closest('[data-results-section="scenarios"]');
    section?.classList.toggle("hidden", !keys.length);
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
            subText = data.optimization?.objective === "total"
                ? `Budżet na życie · Łącznie ${fmt(scenario.total_withdrawn)} zł`
                : `Budżet na życie · Szczyt: ${fmt(scenario.peak_wealth)} zł`;
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

function wzFactsFor(projection, plan = null, input = null, summary = null) {
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
    const budget = window.ResultsSummary.budgetFact(input, summary);
    if (budget) facts.push(budget);
    return facts
        .concat(window.ResultsSummary.ikzeFacts(projection))
        .concat(window.ResultsSummary.obligationFacts(input));
}

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
        obligations: input.obligations || [],
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
    wzSyncObligationsBox();
    wzSyncObligationRedirects();
    wzSyncPayrollPrograms();
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
    wzEl("wzObligationTypes")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-obligation-type]");
        if (!button) return;
        wzAddObligationType(button.dataset.obligationType);
        wzTouch();
    });
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
        if (target.name === "wzHasObligations") wzSyncObligationsBox();
        if (
            target.matches?.(".obligation-end")
            || target.id === "wzRe"
            || target.id === "wzReRange"
            || target.id === "wzSemiAge"
            || target.id === "wzSemiAgeRange"
        ) {
            wzSyncObligationRedirects();
        }
        if (target.name === "wzPpkState" || target.name === "wzPpeState") {
            wzSyncPayrollPrograms();
        }
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
        if (target.name === "wzHasObligations") wzSyncObligationsBox();
        if (
            target.matches?.(".obligation-end")
            || target.id === "wzRe"
            || target.id === "wzReRange"
            || target.id === "wzSemiAge"
            || target.id === "wzSemiAgeRange"
        ) {
            wzSyncObligationRedirects();
        }
        if (target.name === "wzPpkState" || target.name === "wzPpeState") {
            wzSyncPayrollPrograms();
        }
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
        obligations: wzGatherObligations(),
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
            wzRenderObligations(
                state.obligations || wzLegacyObligationsFromFields(state.fields || [])
            );
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
        wzRenderObligations(cached.stored.plan.input?.obligations || []);
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
