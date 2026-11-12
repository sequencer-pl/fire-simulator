// wizard-v2.js — Asystent FIRE v2: drzewo kroków, B2B, Coast/Barista FIRE.
// Wymaga: helpers.js, icons.js, sim-utils.js, controls.js, sim-metadata.js.

const V2_STATE_KEY = "fire.wizardV2State";
const V2_PLAN_KEY = "fire.wizardV2Plan";
const V2_ANON_CONFIG_KEY = "fire.config.anonymous";
const V2_STATE_SAVE_MS = 150;

const V2_RETIREMENT_DEFAULT = { k: 60, m: 65 };

// Średnie dalsze trwanie życia (lata) wg wieku i płci — GUS, tablica 2024.
// Domyślny horyzont = obecny wiek + wartość z tabeli, powiększona o
// prognozowany wzrost długowieczności z konfiguracji.
const V2_LIFE_EXPECTANCY = {
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

const V2_SHELTERS = [
    { account: "ike", label: "IKE" },
    { account: "ikze", label: "IKZE" },
    { account: "oipe", label: "OIPE" },
];

const V2_SAFE_BASES = ["lokata", "obligacje", "gotowka"];
const V2_MARKET_BASES = ["broker", "krypto"];
const V2_ALLOCATABLE_ACCOUNTS = [
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

const V2_SALARY_IDS = new Set([
    "v2EtatSalary",
    "v2EtatSalaryRange",
    "v2B2bSalary",
    "v2B2bSalaryRange",
    "v2B2bCustomZus",
    "v2B2bCustomZusRange",
    "v2PpkEmployeePct",
    "v2PpkEmployerPct",
    "v2PpeEmployerPct",
]);
const V2_SALARY_NAMES = new Set([
    "v2EtatSalaryMode",
    "v2EtatPeriod",
    "v2PpkState",
    "v2PpeState",
    "v2B2bSalaryMode",
    "v2B2bTaxForm",
    "v2B2bLumpRate",
    "v2B2bZusMode",
]);
const V2_PLAN_LOADER_TIPS = [
    // Cierpliwość
    "Cierpliwość to klucz do niezależności finansowej. Liczę Twój plan…",
    "Dobre plany dojrzewają dłużej niż sekundę.",
    "Procent składany lubi cierpliwych. Ten loader też.",
    "Plan FIRE to maraton, nie sprint. Dlatego liczę go chwilę dłużej.",
    "Nie chodzi o szybki zysk. Chodzi o to, żeby nie musieć się spieszyć.",
    "Każdy rok cierpliwości to zwykle kilka lat spokoju później.",
    "Czas w rynku bije timing rynku — nawet gdy czekasz na wynik symulacji.",
    "Twoje pieniądze nie spieszą się z inwestowaniem. Ten loader też nie.",
    "Cierpliwość jest jak procent składany: początkowo niewidoczna, potem robi całą robotę.",
    "Im mniej pośpiechu w planie, tym więcej spokoju w realizacji.",
    "Ten loader też ćwiczy cierpliwość. To feature, nie bug.",
    "Nie chodzi o to, czy masz już wynik. Chodzi o to, czy wytrwasz w postanowieniach.",
    "Spokojnie. Wolność finansowa i tak nie przyjdzie w kilka sekund.",
    "Najlepsze decyzje finansowe rzadko mieszczą się w jednej sekundzie.",
    "Nie ma trybu instant na niezależność. Jest dobra mapa i czas.",
    "Procent składany nie potrzebuje idealnego momentu. Potrzebuje lat.",

    // Oczekiwanie na wynik symulacji
    "Za chwilę zobaczysz wynik symulacji, ale nie zobaczysz przyszłości.",
    "Za chwilę zobaczysz trzy scenariusze. Żaden nie jest przepowiednią.",
    "Symulacja trwa sekundy. Oszczędzanie — lata. Ten podział jest sprawiedliwy.",
    "Ten symulator działa znacznie szybciej niż procent składany.",
    "Wynik — za chwilę. Konsekwencje — za dwadzieścia lat.",
    "Plan będzie gotowy, zanim zdążysz zmienić strategię. To akurat dobrze.",
    "Ten pasek postępu nie ma nic wspólnego z postępem Twojego portfela.",

    // Czas i rynek
    "Inwestowanie długoterminowe jest trudne głównie dlatego, że jest długoterminowe.",
    "Każdy chce procentu składanego. Nikt nie chce czekać na jego efekty.",
    "Największy zysk często nie pochodzi z trafionej spółki, tylko z tego, że nie sprzedałeś wszystkiego w panice.",
    "Długi horyzont nie czyni złej strategii dobrą — daje tylko więcej czasu, żeby to zauważyć.",
    "Nikt nie wie, kiedy rynek spadnie. Ci, którzy twierdzą inaczej, zwykle sprzedają szkolenia.",
    "Każdy potrafi czytać wykres w lewo.",
    "„Tym razem jest inaczej” to najdroższe zdanie w inwestowaniu.",

    // Ryzyko i niepewność
    "Każdy plan opiera się na założeniach. Problem zaczyna się, gdy traktujesz je jak pewniki.",
    "ROI z symulacji nie jest obietnicą. Jest hipotezą, dopóki rynek nie powie „sprawdzam”.",
    "Zmienność to nie usterka rynku, tylko koszt uczestnictwa w nim.",
    "Ryzyko rynkowe możesz ograniczyć gotówką. Wtedy zamieniasz je na ryzyko inflacji.",
    "Dywersyfikacja nie sprawia, że nie tracisz. Sprawia, że nie tracisz wszystkiego naraz.",
    "Bezpieczna poduszka finansowa nie zwiększa zysku, ale zmniejsza liczbę głupich decyzji.",
    "Spadek o 50% wymaga wzrostu o 100%, żeby wrócić do punktu wyjścia.",
    "Historyczna stopa zwrotu mówi, co się wydarzyło, a nie co się stanie.",
    "Jeśli nie znasz swojego horyzontu, każdy spadek wygląda jak katastrofa.",

    // Podatki i polskie realia
    "IKE i IKZE nie tworzą zysku. Zmniejszają podatek, który od niego zapłacisz.",
    "Inflacja nie zabiera Ci banknotów. Zabiera to, co możesz za nie kupić.",

    // Zachowanie i psychologia
    "Twój największy koszt inwestycyjny to nie prowizja. To decyzje pod wpływem emocji.",
    "Nie potrzebujesz perfekcyjnej strategii. Potrzebujesz takiej, której nie porzucisz po pierwszym spadku.",
    "Wybór strategii jest łatwy. Trudniej jest jej nie zmieniać co tydzień.",
    "Podnoszenie standardu życia wraz z pensją to inflacja, którą tworzysz sam.",
    "Oglądanie portfela codziennie nie zwiększa stopy zwrotu.",
    "Zmiana strategii po każdym spadku to też strategia, tylko kosztowna.",

    // FIRE
    "FIRE to nie moment, w którym przestajesz pracować. To moment, w którym przestajesz musieć pracować.",
    "Twoja stopa oszczędności jest ważniejsza niż stopa zwrotu z ostatniego miesiąca.",
    "Wiek FIRE to wynik oszczędności, nie odwagi.",
    "Im niższe wydatki, tym mniej kapitału potrzebujesz. Wydatki zmienisz szybciej niż stopę zwrotu.",

    // Wpłaty vs procent składany
    "Na początku oszczędzania liczą się wpłaty, nie stopa zwrotu. Dołożenie 1 000 zł do 1 000 zł podwaja kapitał.",
    "Przy 1 000 000 zł kapitału nawet 2% odsetek daje więcej niż kolejne 1 000 zł odłożone z pensji.",
    "Przy małym kapitale liczy się każda wpłata. Przy dużym — każdy ułamek procenta.",
    "Na pierwszy milion w większości zapracują wpłaty. Na kolejne — procent składany.",

];


let v2Initialized = false;
let v2CurrentStep = "cel";
let v2Plan = null;
let v2PlanSignature = "";
let v2PlanBodyCache = null;
let v2PlanSeq = 0;
let v2PlanLoading = false;
let v2SelectedScenario = "realne";
let v2Suggested = null;
let v2SuggestSignature = "";
let v2SuggestSeq = 0;
let v2SuggestTimer = null;
let v2SuggestLoading = false;
let v2SalaryPreview = null;
let v2SalaryPreviewCache = Object.create(null);
let v2SalarySeq = 0;
let v2SalaryTimer = null;
let v2SalaryRetryTimer = null;
let v2SalaryRetries = 0;
let v2RetirementTouched = false;
let v2PlanEndTouched = false;
let v2SalaryTouched = false;
let v2PayrollRatesTouched = false;
let v2StrategyExpanded = false;
let v2LongevityGrowth = 1.5;
let v2EtatPeriodPrev = "year";
let v2FormVersion = 0;
let v2AccountConfig = null;
let v2AllocationMode = "auto";
let v2ManualAllocations = null;
let v2LoaderTimer = null;
let v2LoaderTipBag = [];
let v2LoaderLastTip = "";
let v2StateReady = false;
let v2Restoring = false;
let v2StateTimer = null;

// --- Małe helpery -----------------------------------------------------------

function v2El(id) {
    return document.getElementById(id);
}

function v2Radio(name, fallback = null) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : fallback;
}

function v2Num(id, fallback = 0) {
    const el = v2El(id);
    const value = parseFloat(el?.value);
    return Number.isFinite(value) ? value : fallback;
}

function v2Int(id, fallback = 0) {
    return Math.round(v2Num(id, fallback));
}

function v2CurrentPath() {
    return parseInt(v2Radio("v2Path", "1"), 10) || 1;
}

function v2Employment() {
    return v2Radio("v2Employment", "etat");
}

function v2BaseKey(account) {
    if (typeof baseAccountKey === "function") return baseAccountKey(account);
    if (account === "zus:ofe") return account;
    return String(account).split(":")[0];
}

function v2AccountLabel(account, customName = "") {
    if (typeof accountDisplayLabel === "function") {
        return accountDisplayLabel(account, customName);
    }
    return customName || account;
}

function v2AccountIcon(account) {
    if (typeof accountIconFor === "function") return accountIconFor(account);
    return "";
}

function v2SetValue(id, value) {
    const el = v2El(id);
    if (el) el.value = String(value);
}

function v2SyncRange(rangeId, inputId) {
    const range = v2El(rangeId);
    const input = v2El(inputId);
    if (!range || !input) return;
    input.addEventListener("input", () => {
        range.value = input.value;
    });
    range.addEventListener("input", () => {
        input.value = range.value;
    });
}

function v2PostJson(url, body, errorLabel) {
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

function v2AnonymousConfig() {
    try {
        const raw = localStorage.getItem(V2_ANON_CONFIG_KEY);
        if (!raw) return null;
        const payload = JSON.parse(raw);
        return payload && typeof payload === "object" && payload.config ? payload.config : null;
    } catch {
        return null;
    }
}

function v2DefaultAccountRoi(account) {
    const rules = v2AccountConfig?.accounts?.[v2BaseKey(account)];
    const roi = Number(rules?.default_roi);
    return Number.isFinite(roi) ? roi : null;
}

function v2FormatRoiInput(roi) {
    return (roi * 100).toFixed(1);
}

function v2SeedManualAllocations() {
    if (v2ManualAllocations !== null) return;
    const suggested = v2Suggested?.allocations || {};
    v2ManualAllocations = Object.fromEntries(
        V2_ALLOCATABLE_ACCOUNTS.map((account) => [account, Number(suggested[account]) || 0])
    );
}

function v2ManualAllocationShares() {
    const inputs = [...document.querySelectorAll(".v2-manual-share")];
    if (!inputs.length) return v2ManualAllocations || {};
    return Object.fromEntries(inputs.map((input) => [
        input.dataset.account,
        Math.max(0, parseFloat(input.value) || 0),
    ]));
}

function v2CurrentAllocations() {
    if (v2AllocationMode === "manual") return v2ManualAllocationShares();
    return v2Suggested?.allocations || {};
}

function v2ManualAllocationCap(account) {
    const limits = v2AccountConfig?.limits || {};
    if (account === "ike") return Number(limits.ike_annual) || 0;
    if (account === "oipe") return Number(limits.oipe_annual) || 0;
    if (account === "ikze") {
        const key = v2Employment() === "b2b" ? "ikze_annual_self_employed" : "ikze_annual";
        return Number(limits[key]) || 0;
    }
    return 0;
}

function v2ManualAllocationPoolMonthly() {
    return Number(v2Suggested?.pool_monthly) || 0;
}

function v2RoiResetButton(input) {
    return input.closest(".v2-field")?.querySelector(".v2-cap-roi-reset");
}

function v2SyncRoiReset(input) {
    const reset = v2RoiResetButton(input);
    if (reset) reset.classList.toggle("hidden", input.dataset.roiEdited !== "true");
}

function v2ApplyDefaultAccountRois() {
    document.querySelectorAll(".v2-cap-roi").forEach((input) => {
        if (input.dataset.roiEdited === "true") {
            v2SyncRoiReset(input);
            return;
        }
        const roi = v2DefaultAccountRoi(input.closest(".v2-cap-row")?.dataset.account);
        if (roi == null) {
            input.dataset.defaultRoi = "";
            v2SyncRoiReset(input);
            return;
        }
        input.value = v2FormatRoiInput(roi);
        input.dataset.defaultRoi = input.value;
        v2SyncRoiReset(input);
    });
}

async function v2LoadAccountConfig() {
    let config = null;
    let isAuthenticated = false;
    try {
        const [sessionResponse, configResponse] = await Promise.all([
            fetch("/api/session"),
            fetch("/api/config/user"),
        ]);
        if (sessionResponse.ok) {
            const session = await sessionResponse.json();
            isAuthenticated = Boolean(session.email);
        }
        if (configResponse.ok) {
            const data = await configResponse.json();
            config = data?.config || null;
        }
    } catch {
        // W razie braku sieci użyjemy konfiguracji lokalnej albo domyślnej.
    }

    if (!isAuthenticated) config = v2AnonymousConfig() || config;
    if (!config) {
        try {
            const response = await fetch("/api/config");
            if (response.ok) config = await response.json();
        } catch {
            // Sam formularz pozostaje dostępny; backend nadal użyje swoich reguł.
        }
    }

    v2AccountConfig = config;
    const growth = Number(config?.longevity?.growth_months_per_year);
    if (Number.isFinite(growth)) v2LongevityGrowth = growth;
    v2ApplyDefaultAccountRois();
    v2ApplyPlanEndDefault();
    v2ApplyDefaultSalary();
    v2ApplyPayrollRateDefaults();
    if (v2AllocationMode === "manual") v2UpdateManualAllocationAmounts();
    v2UpdateB2bZusLabels();
}

function v2UpdateB2bZusLabels() {
    const base = Number(v2AccountConfig?.zus?.b2b_base_monthly);
    if (!Number.isFinite(base) || base <= 0) return;
    const label = document.querySelector(".v2-b2b-zus-label");
    if (label) {
        label.textContent = `Duży ZUS (podstawa ${Math.round(base).toLocaleString("pl-PL")} zł)`;
    }
    const custom = v2El("v2B2bCustomZus");
    if (custom) {
        const current = parseFloat(custom.value);
        if (!Number.isFinite(current) || Math.abs(current - 5652) < 1) {
            custom.value = String(Math.round(base));
            v2SetValue("v2B2bCustomZusRange", Math.round(base));
        }
    }
}

function v2FormatPercent(value) {
    const rounded = Math.round(value);
    return rounded < 1 ? "<1%" : `${rounded}%`;
}

function v2FormatYears(years) {
    if (years === 1) return "1 rok";
    if (years >= 2 && years <= 4) return `${years} lata`;
    return `${years} lat`;
}

function v2PlanEndDefault(gender, age, growth = v2LongevityGrowth) {
    const table = V2_LIFE_EXPECTANCY[gender] || V2_LIFE_EXPECTANCY.m;
    const years = table[age] ?? (age < 16 ? table[16] : age > 90 ? table[90] : 0);
    const rate = Number.isFinite(growth) ? Math.max(0, growth) : 0;
    const projected = years * (1 + rate / 12);
    return Math.min(120, Math.max(55, age + Math.round(projected)));
}

function v2ApplyPlanEndDefault() {
    if (v2PlanEndTouched) return;
    const planEnd = v2El("v2PlanEnd");
    if (!planEnd) return;
    const gender = v2Radio("v2Gender", "m");
    const age = v2Int("v2Age", 40);
    const value = v2PlanEndDefault(gender, age);
    planEnd.value = String(value);
    v2SetValue("v2PlanEndRange", value);
}

function v2ApplyDefaultSalary() {
    if (v2SalaryTouched || v2Employment() !== "etat") return;
    const input = v2El("v2EtatSalary");
    if (!input) return;
    const limit = Number(v2AccountConfig?.limits?.oipe_annual);
    const averageMonthly = Number.isFinite(limit) && limit > 0 ? limit / 3 : 9420;
    const annual = Math.max(0, Math.round((averageMonthly * 12) / 1000) * 1000);
    const value = v2EtatPeriod() === "year" ? annual : Math.round(annual / 12);
    input.value = String(value);
    input.dataset.monthlyValue = String(annual / 12);
    v2SetValue("v2EtatSalaryRange", value);
    v2UpdateSalaryLabels();
    v2ScheduleSalaryPreview();
}

function v2CanonicalValue(value) {
    if (Array.isArray(value)) {
        return `[${value.map(v2CanonicalValue).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${v2CanonicalValue(value[key])}`);
        return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value);
}

function v2CanonicalJson(value) {
    return v2CanonicalValue(value);
}

// --- Drzewo kroków ----------------------------------------------------------

function v2StepOrder() {
    const employment = v2Employment();
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

function v2ShowStep(stepId, focus = false) {
    const order = v2StepOrder();
    const id = order.includes(stepId) ? stepId : order[0];
    v2CurrentStep = id;

    document.querySelectorAll(".v2-step").forEach((el) => {
        el.classList.toggle("hidden", el.dataset.stepId !== id);
    });

    const index = order.indexOf(id);
    const progress = v2El("v2ProgressBar");
    if (progress) {
        progress.style.width = `${((index + 1) / order.length) * 100}%`;
        progress.setAttribute("aria-valuenow", String(index + 1));
        progress.setAttribute("aria-valuemax", String(order.length));
    }

    const count = v2El("v2StepCount");
    if (count) count.textContent = `Krok ${index + 1} / ${order.length}`;

    const back = v2El("v2BackBtn");
    if (back) back.classList.toggle("hidden", index === 0);

    if (id === "strategia") v2RefreshSuggestion();
    if (id === "wynik" && v2Plan) v2RenderResult(v2Plan);

    v2UpdateActions();

    if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (focus) {
        const heading = document.querySelector(`.v2-step[data-step-id="${id}"] h2`);
        if (heading) {
            heading.setAttribute("tabindex", "-1");
            heading.focus({ preventScroll: true });
        }
    }
    v2SaveState();
}

function v2UpdateActions() {
    const next = v2El("v2NextBtn");
    if (!next) return;
    next.disabled = v2PlanLoading;

    let label = "Dalej";
    let planReady = false;
    if (v2CurrentStep === "strategia") {
        label = "Wylicz plan";
    } else if (v2CurrentStep === "wynik") {
        planReady = Boolean(v2Plan);
        label = v2PlanLoading ? "Wyliczam..." : planReady ? "Dostosuj w symulatorze" : "Wylicz plan";
    }
    next.textContent = v2PlanLoading && v2CurrentStep === "wynik" ? "Wyliczam..." : label;
    next.classList.toggle("btn-real", planReady && !v2PlanLoading);
    next.classList.toggle("btn-primary", !(planReady && !v2PlanLoading));
}

function v2Next() {
    if (v2PlanLoading) return;

    if (v2CurrentStep === "wynik") {
        if (v2Plan) {
            v2Finish();
        } else {
            v2RunPlan();
        }
        return;
    }

    if (!v2ValidateStep(v2CurrentStep)) return;

    if (v2CurrentStep === "strategia") {
        const body = v2PlanBody();
        if (v2Plan && v2PlanSignature === v2CanonicalJson(body)) {
            v2ShowStep("wynik", true);
            return;
        }
        v2ShowStep("wynik", true);
        v2RunPlan();
        return;
    }

    const order = v2StepOrder();
    const index = order.indexOf(v2CurrentStep);
    if (index >= 0 && index < order.length - 1) {
        v2ShowStep(order[index + 1], true);
    }
}

function v2Back() {
    const order = v2StepOrder();
    const index = order.indexOf(v2CurrentStep);
    if (index > 0) v2ShowStep(order[index - 1], true);
}

// --- Widoczność paneli zależna od ścieżki i sytuacji ------------------------

function v2SyncPathUI() {
    const path = v2CurrentPath();
    v2El("v2TargetPanel")?.classList.toggle("hidden", path === 1);
    v2El("v2SavingsPanel")?.classList.toggle("hidden", path === 2);
    v2El("v2ReGroup")?.classList.toggle("hidden", path === 3);
}

function v2SyncOfeBox() {
    const member = v2Radio("v2HasOfe", "no") === "yes";
    v2El("v2OfeCapBox")?.classList.toggle("hidden", !member);
}

function v2SyncB2bRows() {
    const form = v2Radio("v2B2bTaxForm", "ryczalt");
    const zus = v2Radio("v2B2bZusMode", "duzy");
    v2El("v2B2bLumpRow")?.classList.toggle("hidden", form !== "ryczalt");
    v2El("v2B2bCustomZusRow")?.classList.toggle("hidden", zus !== "custom");
}

function v2SyncZusBox() {
    const has = v2Radio("v2HasZusCap", "no") === "yes";
    v2El("v2ZusCapBox")?.classList.toggle("hidden", !has);
}

function v2SyncMortgageBox() {
    const has = v2Radio("v2HasMortgage", "no") === "yes";
    v2El("v2MortgageBox")?.classList.toggle("hidden", !has);
}

function v2SyncRealEstateBox() {
    const has = v2Radio("v2HasRealEstate", "no") === "yes";
    v2El("v2RealEstateBox")?.classList.toggle("hidden", !has);
}

function v2SyncFireStyle() {
    const style = v2Radio("v2FireStyle", "full");
    const semi = style !== "full";
    v2El("v2SemiFireBox")?.classList.toggle("hidden", !semi);
    v2El("v2SemiSavingsGroup")?.classList.toggle("hidden", style === "barista");
    if (semi) v2SyncSemiBounds();
}

function v2SyncAgeBounds() {
    const age = v2Int("v2Age", 40);
    const reInput = v2El("v2Re");
    const reRange = v2El("v2ReRange");
    if (reInput && (parseInt(reInput.value, 10) || 0) <= age) {
        const next = Math.min(90, age + 5);
        reInput.value = String(next);
        if (reRange) reRange.value = String(next);
    }

    const path = v2CurrentPath();
    const re = path === 3 ? 0 : parseInt(reInput?.value, 10) || age + 1;
    const retirement = v2El("v2Retirement");
    const retirementRange = v2El("v2RetirementRange");
    if (retirement) {
        const current = parseInt(retirement.value, 10) || 0;
        if (current <= age || (path !== 3 && current < re)) {
            const next = Math.min(95, Math.max(age + 1, re));
            retirement.value = String(next);
            if (retirementRange) retirementRange.value = String(next);
        }
    }

    const planEnd = v2El("v2PlanEnd");
    const planEndRange = v2El("v2PlanEndRange");
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
    v2SyncSemiBounds();
}

function v2SyncSemiBounds() {
    const style = v2Radio("v2FireStyle", "full");
    if (style === "full") return;
    const age = v2Int("v2Age", 40);
    const path = v2CurrentPath();
    // Na ścieżce 3 wiek FIRE dopiero wyliczamy, ale etap części etatu musi
    // zmieścić się przed wiekiem emerytury ZUS — inaczej planner go pominie.
    const re = path === 3 ? v2Int("v2Retirement", 65) : v2Int("v2Re", 55);
    const lo = age + 1;
    const hi = Math.max(lo, Math.min(110, re - 1));
    const input = v2El("v2SemiAge");
    const range = v2El("v2SemiAgeRange");
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

function v2EtatPeriod() {
    return v2Radio("v2EtatPeriod", "year");
}

function v2RememberMonthlySalary() {
    const input = v2El("v2EtatSalary");
    if (!input) return;
    const value = parseFloat(input.value) || 0;
    input.dataset.monthlyValue = String(
        v2EtatPeriod() === "year" ? value / 12 : value
    );
}

function v2ApplyEtatPeriod(convert) {
    const period = v2EtatPeriod();
    const annual = period === "year";
    const input = v2El("v2EtatSalary");
    const range = v2El("v2EtatSalaryRange");
    if (!input) return;

    if (convert && period !== v2EtatPeriodPrev) {
        const current = parseFloat(input.value) || 0;
        const stored = parseFloat(input.dataset.monthlyValue);
        const monthly = Number.isFinite(stored) && stored > 0
            ? stored
            : (v2EtatPeriodPrev === "year" ? current / 12 : current);
        const next = Math.max(0, Math.round(annual ? monthly * 12 : monthly));
        input.value = String(next);
        input.dataset.monthlyValue = String(monthly);
        if (range) range.value = String(next);
    } else if (!input.dataset.monthlyValue) {
        v2RememberMonthlySalary();
    }
    v2EtatPeriodPrev = period;

    const max = annual ? 1_200_000 : 100_000;
    const step = annual ? 1_000 : 250;
    input.max = String(max);
    input.step = String(step);
    if (range) {
        range.max = String(max);
        range.step = String(step);
    }
    v2UpdateSalaryLabels();
}

function v2UpdateSalaryLabels() {
    const employment = v2Employment();
    const etatLabel = v2El("v2EtatSalaryLabel");
    if (etatLabel) {
        const net = v2Radio("v2EtatSalaryMode", "gross") === "net";
        const period = v2EtatPeriod() === "year" ? "rok" : "mies.";
        etatLabel.textContent = net
            ? `Twoja pensja netto (zł/${period})`
            : `Twoja pensja brutto (zł/${period})`;
    }
    const b2bLabel = v2El("v2B2bSalaryLabel");
    if (b2bLabel) {
        b2bLabel.textContent = v2Radio("v2B2bSalaryMode", "gross") === "net"
            ? "Kwota na czysto po ZUS i podatku (zł/mies.)"
            : "Przychód miesięczny po kosztach (zł/mies.)";
    }
    if (employment !== "etat") v2HideSalaryPreview(v2El("v2EtatSalaryPreview"));
    if (employment !== "b2b") v2HideSalaryPreview(v2El("v2B2bSalaryPreview"));
}

function v2InitPayrollRateControls() {
    const controls = [
        ["v2PpkEmployeePctControl", "v2PpkEmployeePct", "2.0", "0", "4", "0.1", "Składka pracownika PPK (%)"],
        ["v2PpkEmployerPctControl", "v2PpkEmployerPct", "1.5", "0", "4", "0.1", "Składka pracodawcy PPK (%)"],
        ["v2PpeEmployerPctControl", "v2PpeEmployerPct", "3.5", "0", "7", "0.1", "Składka pracodawcy PPE (%)"],
    ];
    controls.forEach(([containerId, inputId, value, min, max, step, aria]) => {
        const container = v2El(containerId);
        if (!container || container.querySelector("input")) return;
        container.innerHTML = numControlsHtml({
            value,
            min,
            max,
            step,
            fieldClass: "v2-payroll-rate-input",
            attrs: `id="${inputId}"`,
            aria,
        });
    });
    v2UpdatePayrollRateSummaries();
}

function v2PayrollRateValue(inputId, fallback) {
    const value = v2Num(inputId, fallback);
    return Number.isFinite(value) ? value : fallback;
}

function v2FormatPayrollRate(value) {
    return Number(value).toLocaleString("pl-PL", { maximumFractionDigits: 1 });
}

function v2UpdatePayrollRateSummaries() {
    const ppkEmployee = v2PayrollRateValue("v2PpkEmployeePct", 2.0);
    const ppkEmployer = v2PayrollRateValue("v2PpkEmployerPct", 1.5);
    const ppeEmployer = v2PayrollRateValue("v2PpeEmployerPct", 3.5);
    const ppkSummary = v2El("v2PpkRateSummary");
    const ppeSummary = v2El("v2PpeRateSummary");
    if (ppkSummary) {
        ppkSummary.textContent = `${v2FormatPayrollRate(ppkEmployee)}% pracownika · ${v2FormatPayrollRate(ppkEmployer)}% pracodawcy`;
    }
    if (ppeSummary) {
        ppeSummary.textContent = `${v2FormatPayrollRate(ppeEmployer)}% pracodawcy`;
    }
}

function v2ApplyPayrollRateDefaults() {
    if (v2PayrollRatesTouched) return;
    const ppkEmployee = Number(v2AccountConfig?.ppk?.employee_pct);
    const ppkEmployer = Number(v2AccountConfig?.ppk?.employer_pct);
    const ppeEmployer = Number(v2AccountConfig?.ppe?.employer_pct);
    v2SetValue("v2PpkEmployeePct", Number.isFinite(ppkEmployee) ? ppkEmployee * 100 : 2.0);
    v2SetValue("v2PpkEmployerPct", Number.isFinite(ppkEmployer) ? ppkEmployer * 100 : 1.5);
    v2SetValue("v2PpeEmployerPct", Number.isFinite(ppeEmployer) ? ppeEmployer * 100 : 3.5);
    v2UpdatePayrollRateSummaries();
    v2ScheduleSalaryPreview();
}

function v2PayrollState(name) {
    return v2Radio(name, "never");
}

function v2SyncPayrollPrograms() {
    const employment = v2Employment();
    const ppkState = v2PayrollState("v2PpkState");
    const ppeState = v2PayrollState("v2PpeState");
    v2El("v2PpkRates")?.classList.toggle("hidden", ppkState !== "active");
    v2El("v2PpeRates")?.classList.toggle("hidden", ppeState !== "active");
    if (v2El("v2PpkRates")) v2El("v2PpkRates").hidden = ppkState !== "active";
    if (v2El("v2PpeRates")) v2El("v2PpeRates").hidden = ppeState !== "active";

    const etat = employment === "etat";
    const showPpk = !etat || ppkState !== "never";
    const showPpe = !etat || ppeState !== "never";
    v2El("v2PpkBalanceField")?.classList.toggle("hidden", !showPpk);
    v2El("v2PpeBalanceField")?.classList.toggle("hidden", !showPpe);
    v2El("v2PayrollCapitalPanel")?.classList.toggle("hidden", etat && !showPpk && !showPpe);
    v2UpdatePayrollRateSummaries();
}

function v2MonthlySalaryValue() {
    const employment = v2Employment();
    if (employment === "etat") {
        const amount = v2Num("v2EtatSalary", 0);
        return v2EtatPeriod() === "year" ? amount / 12 : amount;
    }
    if (employment === "b2b") return v2Num("v2B2bSalary", 0);
    return 0;
}

function v2SalaryMode() {
    const employment = v2Employment();
    if (employment === "etat") return v2Radio("v2EtatSalaryMode", "gross");
    if (employment === "b2b") return v2Radio("v2B2bSalaryMode", "gross");
    return "gross";
}

function v2ScheduleSalaryPreview() {
    clearTimeout(v2SalaryTimer);
    clearTimeout(v2SalaryRetryTimer);
    v2SalaryRetries = 0;
    v2SalaryTimer = setTimeout(v2RunSalaryPreview, 350);
}

function v2SalaryRequestBody() {
    const employment = v2Employment();
    const amount = v2MonthlySalaryValue();
    if (employment === "niepracujacy" || amount <= 0) return null;
    const body = {
        salary_mode: v2SalaryMode(),
        amount,
        employment,
        use_ppk: employment === "etat" && v2PayrollState("v2PpkState") === "active",
        ppk_employee_pct: v2PayrollRateValue("v2PpkEmployeePct", 2.0) / 100,
    };
    if (employment === "b2b") {
        body.b2b_tax_form = v2Radio("v2B2bTaxForm", "ryczalt");
        body.b2b_lump_rate = parseFloat(v2Radio("v2B2bLumpRate", "0.12"));
        body.b2b_zus_mode = v2Radio("v2B2bZusMode", "duzy");
        body.b2b_custom_zus_base = v2Num("v2B2bCustomZus", 5652);
    }
    const config = v2AnonymousConfig();
    if (config) body.base_config = config;
    return body;
}

function v2SalaryPreviewKey(body) {
    if (!body) return "";
    const { base_config, ...rest } = body;
    return v2CanonicalJson(rest);
}

function v2SalaryBaseKey(body) {
    if (!body) return "";
    const { base_config, salary_mode, ...rest } = body;
    return v2CanonicalJson(rest);
}

function v2CurrentSalaryPreviewKey() {
    return v2SalaryPreviewKey(v2SalaryRequestBody());
}

function v2HideSalaryPreview(box) {
    if (!box) return;
    box.hidden = true;
    box.innerHTML = "";
}

async function v2RunSalaryPreview() {
    clearTimeout(v2SalaryRetryTimer);
    const body = v2SalaryRequestBody();
    const seq = ++v2SalarySeq;
    if (!body) {
        v2SalaryPreview = null;
        v2HideSalaryPreview(v2El("v2EtatSalaryPreview"));
        v2HideSalaryPreview(v2El("v2B2bSalaryPreview"));
        v2UpdateSavingsHint();
        return;
    }

    const key = v2SalaryPreviewKey(body);
    if (v2SalaryPreviewCache[key]) {
        v2SalaryPreview = {
            ...v2SalaryPreviewCache[key],
            key,
            baseKey: v2SalaryBaseKey(body),
            mode: body.salary_mode,
        };
        v2RenderSalaryHint();
        v2UpdateSavingsHint();
        return;
    }

    try {
        const data = await v2PostJson("/api/wizard/salary", body, "Błąd podglądu pensji.");
        if (seq !== v2SalarySeq) return;
        v2SalaryPreview = {
            key,
            baseKey: v2SalaryBaseKey(body),
            mode: body.salary_mode,
            gross: data.gross_monthly,
            net: data.net_monthly,
        };
        v2SalaryPreviewCache[key] = { gross: v2SalaryPreview.gross, net: v2SalaryPreview.net };
        v2SalaryRetries = 0;
        v2RenderSalaryHint();
    } catch (err) {
        if (seq !== v2SalarySeq) return;
        if (err?.status === 429) {
            // Limit zapytań to nie błąd obliczeń — zostaw ostatnią dobrą
            // wartość i ponów po Retry-After, zamiast straszyć użytkownika.
            if (v2SalaryPreview) v2RenderSalaryHint();
            if (v2SalaryRetries < 2) {
                const parsed = parseInt(err.retryAfter || "", 10);
                const seconds = Number.isFinite(parsed) && parsed > 0 ? Math.min(10, parsed) : 2;
                v2SalaryRetries += 1;
                clearTimeout(v2SalaryRetryTimer);
                v2SalaryRetryTimer = setTimeout(v2RunSalaryPreview, seconds * 1000);
            }
            return;
        }
        // Podgląd jest tylko pomocniczy — zostawiamy ostatnią dobrą wartość.
    } finally {
        if (seq === v2SalarySeq) v2UpdateSavingsHint();
    }
}

function v2SalaryLabel(mode, employment) {
    if (employment === "b2b") {
        return mode === "gross" ? "Przychód" : "Na czysto";
    }
    return mode === "gross" ? "Brutto" : "Netto";
}

function v2SalaryPreviewBlock(monthly, label, active, approximate) {
    const annual = Math.round((Number(monthly) || 0) * 12);
    return `
        <div class="v2-salary-preview-item${active ? "" : " is-result"}">
            <span class="v2-salary-preview-label">${approximate ? "≈ " : ""}${escapeHtml(label)}</span>
            <span class="v2-salary-preview-value">${fmtMoney(annual)} <span class="v2-suggest-unit">/rok</span></span>
            <span class="v2-salary-preview-sub">${fmtMoney(monthly)}/mies.</span>
        </div>`;
}

function v2RenderSalaryHint() {
    const employment = v2Employment();
    const etatBox = v2El("v2EtatSalaryPreview");
    const b2bBox = v2El("v2B2bSalaryPreview");
    if (employment !== "etat") v2HideSalaryPreview(etatBox);
    if (employment !== "b2b") v2HideSalaryPreview(b2bBox);
    const box = employment === "etat" ? etatBox : employment === "b2b" ? b2bBox : null;
    if (!box) return;
    if (!v2SalaryPreview || v2SalaryPreview.key !== v2CurrentSalaryPreviewKey()) {
        v2HideSalaryPreview(box);
        return;
    }
    const mode = v2SalaryMode();
    const gross = Number(v2SalaryPreview.gross);
    const net = Number(v2SalaryPreview.net);
    if (!Number.isFinite(gross) || !Number.isFinite(net)) {
        v2HideSalaryPreview(box);
        return;
    }
    const otherMode = mode === "gross" ? "net" : "gross";
    const activeMonthly = mode === "gross" ? gross : net;
    const otherMonthly = mode === "gross" ? net : gross;
    box.innerHTML = `
        ${v2SalaryPreviewBlock(activeMonthly, v2SalaryLabel(mode, employment), true, false)}
        <span class="v2-salary-preview-arrow" aria-hidden="true">↔</span>
        ${v2SalaryPreviewBlock(otherMonthly, v2SalaryLabel(otherMode, employment), false, true)}`;
    box.hidden = false;
}

function v2ApplySalaryModeConversion() {
    const preview = v2SalaryPreview;
    if (!preview) return;
    const body = v2SalaryRequestBody();
    if (!body) return;
    if (preview.baseKey !== v2SalaryBaseKey(body)) return;
    const mode = body.salary_mode;
    const monthly = mode === "gross" ? Number(preview.gross) : Number(preview.net);
    if (!Number.isFinite(monthly) || monthly <= 0) return;
    const annual = v2Employment() === "etat" && v2EtatPeriod() === "year";
    const input = v2Employment() === "etat" ? v2El("v2EtatSalary") : v2El("v2B2bSalary");
    const range = v2Employment() === "etat" ? v2El("v2EtatSalaryRange") : v2El("v2B2bSalaryRange");
    if (!input) return;
    const value = Math.max(0, Math.round(annual ? monthly * 12 : monthly));
    const displayedMonthly = annual ? value / 12 : value;
    input.value = String(value);
    input.dataset.monthlyValue = String(displayedMonthly);
    if (range) range.value = String(value);
    const nextBody = { ...body, amount: displayedMonthly, salary_mode: mode };
    v2SalaryPreview = {
        ...preview,
        key: v2SalaryPreviewKey(nextBody),
        baseKey: v2SalaryBaseKey(nextBody),
        mode,
    };
    v2SalaryPreviewCache[v2SalaryPreview.key] = {
        gross: preview.gross,
        net: preview.net,
    };
    v2RenderSalaryHint();
    v2UpdateSavingsHint();
}

function v2UpdateSavingsMax() {
    const range = v2El("v2SavingsRange");
    if (!range) return;
    const previewMatches = v2SalaryPreview
        && v2SalaryPreview.key === v2CurrentSalaryPreviewKey();
    const net = previewMatches ? v2SalaryPreview.net : null;
    const cap = net && net > 0 ? net : 20000;
    const max = Math.max(100, Math.min(20000, Math.floor(cap / 100) * 100));
    range.max = String(max);
    if ((parseFloat(range.value) || 0) > max) range.value = String(max);
}

function v2UpdateSavingsHint() {
    const hint = v2El("v2SavingsHint");
    const warn = v2El("v2SavingsWarn");
    const savings = v2Num("v2Savings", 0);
    const employment = v2Employment();
    const previewMatches = v2SalaryPreview
        && v2SalaryPreview.key === v2CurrentSalaryPreviewKey();
    const net = previewMatches ? v2SalaryPreview.net : null;
    const gross = v2MonthlySalaryValue();
    v2UpdateSavingsMax();
    if (hint) {
        if (net && net > 0 && savings > 0) {
            hint.textContent = `${fmtMoney(savings)} = ${v2FormatPercent((savings / net) * 100)} pensji netto`;
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

function v2BuildShelterPicker() {
    const picker = v2El("v2SheltersPicker");
    if (!picker) return;
    picker.innerHTML = "";
    V2_SHELTERS.forEach(({ account, label }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pill-toggle wz-pill";
        btn.dataset.account = account;
        btn.innerHTML = `${v2AccountIcon(account)}<span>${escapeHtml(label)}</span>`;
        btn.addEventListener("click", () => v2ToggleShelter(account));
        picker.appendChild(btn);
    });
    v2RefreshShelterPicker();
}

function v2RefreshShelterPicker() {
    const selected = new Set(
        [...document.querySelectorAll("#v2SheltersList .v2-cap-row")].map((row) => row.dataset.account)
    );
    document.querySelectorAll("#v2SheltersPicker .wz-pill").forEach((btn) => {
        const active = selected.has(btn.dataset.account);
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
    });
}

function v2ToggleShelter(account) {
    const existing = document.querySelector(
        `#v2SheltersList .v2-cap-row[data-account="${account}"]`
    );
    if (existing) {
        existing.remove();
    } else {
        v2El("v2SheltersList")?.appendChild(v2BuildCapRow(account, { name: false, roi: true }));
    }
    v2RefreshShelterPicker();
    v2Touch();
}

function v2BuildCapRow(account, { name = true, roi = true } = {}) {
    const base = v2BaseKey(account);
    const defaultName = v2AccountLabel(account);
    const wrap = document.createElement("div");
    wrap.className = "wz-capital-item v2-cap-row";
    wrap.dataset.account = account;
    wrap.dataset.base = base;
    wrap.dataset.defaultName = defaultName;

    const fields = [];
    fields.push(`
        <div class="v2-field">
            <span class="v2-field-label">Saldo (zł)</span>
            ${numControlsHtml({
                value: "0",
                min: "0",
                step: "1000",
                fieldClass: "v2-cap-amount",
                aria: `Saldo ${v2AccountLabel(account)}`,
            })}
        </div>`);
    if (roi && base !== "gotowka") {
        const defaultRoi = v2DefaultAccountRoi(account);
        const roiValue = defaultRoi == null ? "" : v2FormatRoiInput(defaultRoi);
        fields.push(`
            <div class="v2-field">
                <div class="v2-field-label-row">
                    <span class="v2-field-label">Realne ROI (%/rok)</span>
                    <button type="button" class="btn btn-ghost btn-icon btn-sm v2-cap-roi-reset hidden"
                            title="Przywróć domyślne ROI z Konfiguracji"
                            aria-label="Przywróć domyślne ROI dla ${escapeHtml(defaultName)}">${iconSvg("restore")}</button>
                </div>
                ${numControlsHtml({
                    value: roiValue,
                    min: "0",
                    max: "30",
                    step: "0.1",
                    fieldClass: "v2-cap-roi",
                    attrs: `data-default-roi="${roiValue}" title="ROI jest wstępnie wypełnione wartością z Konfiguracji. Zmiana dotyczy tylko tego planu."`,
                    aria: `Realne ROI ${defaultName}`,
                })}
            </div>`);
    }

    wrap.innerHTML = `
        <div class="wz-capital-item-head">
            <span class="wz-instrument-name">${v2AccountIcon(account)}<span class="v2-cap-name-display">${escapeHtml(defaultName)}</span></span>
            ${name ? `<div class="v2-cap-name-edit hidden"><input type="text" class="acc-field v2-cap-name" maxlength="80" value="${escapeHtml(defaultName)}" aria-label="Nazwa własna ${escapeHtml(defaultName)}"><button type="button" class="btn btn-ghost btn-icon btn-sm v2-cap-name-save" aria-label="Zapisz nazwę">${iconSvg("check")}</button></div>` : ""}
            <div class="btn-row v2-cap-actions">
                ${name ? `<button type="button" class="btn btn-ghost btn-icon btn-sm v2-cap-name-edit-btn" aria-label="Zmień nazwę ${escapeHtml(defaultName)}" title="Zmień nazwę">${iconSvg("pencil")}</button>` : ""}
                <button type="button" class="btn btn-ghost btn-icon btn-sm v2-cap-remove" aria-label="Usuń ${escapeHtml(defaultName)}" title="Usuń">${iconSvg("x")}</button>
            </div>
        </div>
        <div class="v2-cap-fields">${fields.join("")}</div>`;
    return wrap;
}

function v2NextInstance(base, list) {
    const rows = [...list.querySelectorAll(".v2-cap-row")].filter(
        (row) => v2BaseKey(row.dataset.account) === base
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

function v2AddMulti(base) {
    const list = V2_SAFE_BASES.includes(base)
        ? v2El("v2SafeList")
        : v2El("v2MarketList");
    if (!list) return;
    const account = v2NextInstance(base, list);
    const row = v2BuildCapRow(account, { name: true, roi: true });
    list.appendChild(row);
    v2SyncMultiAddButtons();
    const input = row.querySelector(".v2-cap-amount");
    if (input && typeof input.focus === "function") input.focus();
    v2Touch();
}

function v2ToggleSingle(account) {
    const list = v2El("v2MarketList");
    if (!list) return;
    const existing = list.querySelector(`.v2-cap-row[data-account="${account}"]`);
    if (existing) {
        existing.remove();
    } else {
        list.appendChild(v2BuildCapRow(account, { name: false, roi: true }));
    }
    v2SyncSingleButtons();
    v2Touch();
}

function v2SyncSingleButtons() {
    const list = v2El("v2MarketList");
    document.querySelectorAll(".v2-add-single").forEach((btn) => {
        const account = btn.dataset.account;
        const label = btn.dataset.label || v2AccountLabel(account);
        const active = Boolean(list?.querySelector(`.v2-cap-row[data-account="${account}"]`));
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
        btn.setAttribute("aria-label", `${active ? "Usuń" : "Dodaj"} ${label}`);
    });
}

function v2CountBaseRows(base) {
    return [
        ...document.querySelectorAll(
            "#v2SafeList .v2-cap-row, #v2MarketList .v2-cap-row"
        ),
    ].filter((row) => v2BaseKey(row.dataset.account) === base).length;
}

function v2SyncMultiAddButtons() {
    document.querySelectorAll(".v2-add-multi").forEach((btn) => {
        const count = v2CountBaseRows(btn.dataset.base);
        const countEl = btn.querySelector(".v2-add-count");
        btn.classList.toggle("has-items", count > 0);
        if (countEl) {
            countEl.textContent = `×${count}`;
            countEl.classList.toggle("is-visible", count > 1);
        }
    });
}

function v2InitCapitalAddButtons() {
    document.querySelectorAll(".v2-add-multi").forEach((button) => {
        const base = button.dataset.base;
        const label = button.dataset.label || v2AccountLabel(base);
        button.classList.add("pill-toggle");
        button.innerHTML = `${v2AccountIcon(base)}<span>${escapeHtml(label)}</span><span class="v2-add-count" aria-hidden="true"></span><span class="v2-add-plus" aria-hidden="true">${iconSvg("plus")}</span>`;
    });
    document.querySelectorAll(".v2-add-single").forEach((button) => {
        const account = button.dataset.account;
        const label = button.dataset.label || v2AccountLabel(account);
        button.classList.add("pill-toggle");
        button.setAttribute("aria-pressed", "false");
        button.innerHTML = `${v2AccountIcon(account)}<span>${escapeHtml(label)}</span>`;
    });
}

// --- Zbieranie odpowiedzi ---------------------------------------------------

function v2CollectCapital() {
    const capital = {};
    const customNames = {};
    const roiOverrides = {};
    const rows = document.querySelectorAll(
        "#v2SheltersList .v2-cap-row, #v2SafeList .v2-cap-row, #v2MarketList .v2-cap-row"
    );
    rows.forEach((row) => {
        const account = row.dataset.account;
        const amount = parseFloat(row.querySelector(".v2-cap-amount")?.value) || 0;
        if (amount > 0) capital[account] = amount;
        const name = row.querySelector(".v2-cap-name")?.value.trim();
        if (name && name !== row.dataset.defaultName) customNames[account] = name;
        const roiInput = row.querySelector(".v2-cap-roi");
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

function v2CollectAnswers({ withAllocations = true } = {}) {
    const employment = v2Employment();
    const path = v2CurrentPath();
    const { capital, customNames, roiOverrides } = v2CollectCapital();

    const rows = [...document.querySelectorAll(
        "#v2SheltersList .v2-cap-row, #v2SafeList .v2-cap-row, #v2MarketList .v2-cap-row"
    )];
    const activeBases = new Set(rows.map((row) => v2BaseKey(row.dataset.account)));

    const etat = employment === "etat";
    const ppkState = etat ? v2PayrollState("v2PpkState") : "paused";
    const ppeState = etat ? v2PayrollState("v2PpeState") : "paused";
    const ppkBalance = etat && ppkState === "never" ? 0 : v2Num("v2PpkBalance", 0);
    const ppeBalance = etat && ppeState === "never" ? 0 : v2Num("v2PpeBalance", 0);
    if (ppkBalance > 0) capital.ppk = ppkBalance;
    if (ppeBalance > 0) capital.ppe = ppeBalance;

    const ppkContributions = etat && ppkState === "active";
    const ppeContributions = etat && ppeState === "active";
    const usePpk = ppkContributions || ppkBalance > 0;
    const usePpe = ppeContributions || ppeBalance > 0;
    const ppkEmployeePct = v2PayrollRateValue("v2PpkEmployeePct", 2.0) / 100;
    const ppkEmployerPct = v2PayrollRateValue("v2PpkEmployerPct", 1.5) / 100;
    const ppeEmployerPct = v2PayrollRateValue("v2PpeEmployerPct", 3.5) / 100;

    if (v2Radio("v2HasZusCap", "no") === "yes") {
        const zus = v2Num("v2ZusBalance", 0);
        if (zus > 0) capital.zus = zus;
    }
    const ofeMember = v2Radio("v2HasOfe", "no") === "yes";
    if (ofeMember) {
        const ofe = v2Num("v2OfeBalance", 0);
        if (ofe > 0) capital["zus:ofe"] = ofe;
    }

    const hasMortgage = v2Radio("v2HasMortgage", "no") === "yes";
    const hasRealEstate = v2Radio("v2HasRealEstate", "no") === "yes";
    if (hasRealEstate) {
        const value = v2Num("v2ReValue", 0);
        if (value > 0) capital.nieruchomosc = value;
    }

    const fireStyle = v2Radio("v2FireStyle", "full");
    const semiEnabled = fireStyle === "coast" || fireStyle === "barista";

    const answers = {
        gender: v2Radio("v2Gender", "m"),
        age_now: v2Int("v2Age", 40),
        life_expectancy_growth_months_per_year: v2LongevityGrowth,
        employment,
        gross_monthly: v2MonthlySalaryValue(),
        salary_mode: employment === "niepracujacy" ? "gross" : v2SalaryMode(),
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
        real_estate_rental_monthly: hasRealEstate ? v2Num("v2ReRent", 0) : 0,
        real_estate_liquidation_age: hasRealEstate
            ? (v2Int("v2ReLiqAge", 0) || null)
            : null,
        mortgage_monthly: hasMortgage ? v2Num("v2MortgageMonthly", 0) : 0,
        mortgage_end_age: hasMortgage ? v2Int("v2MortgageEndAge", 50) : null,
        redirect_mortgage_to_savings: hasMortgage
            ? Boolean(v2El("v2RedirectMortgage")?.checked)
            : false,
        semi_fire_enabled: semiEnabled,
        semi_fire_mode: fireStyle === "barista" ? "barista" : "coast",
        semi_fire_age: semiEnabled ? v2Int("v2SemiAge", 48) : null,
        semi_fire_net_monthly: semiEnabled ? v2Num("v2SemiNet", 0) : 0,
        semi_fire_savings_monthly: semiEnabled && fireStyle === "coast"
            ? v2Num("v2SemiSavings", 0)
            : 0,
        retire_early_age: path === 3 ? null : v2Int("v2Re", 55),
        retirement_age: v2Int("v2Retirement", 65),
        plan_end_age: v2Int("v2PlanEnd", 85),
        savings: path === 2 ? 0 : v2Num("v2Savings", 0),
        strategy: v2Radio("v2Strategy", "zbilansowana"),
        assumptions: "realne",
    };

    if (employment === "b2b") {
        answers.b2b_tax_form = v2Radio("v2B2bTaxForm", "ryczalt");
        answers.b2b_lump_rate = parseFloat(v2Radio("v2B2bLumpRate", "0.12"));
        answers.b2b_zus_mode = v2Radio("v2B2bZusMode", "duzy");
        answers.b2b_custom_zus_base = v2Num("v2B2bCustomZus", 5652);
    }

    const config = v2AnonymousConfig();
    if (config) answers.base_config = config;
    if (withAllocations && v2Suggested) {
        answers.allocations = Object.fromEntries(
            Object.entries(v2CurrentAllocations())
                .filter(([, share]) => Number(share) > 0)
                .map(([account, share]) => [account, Number(share)])
        );
    }
    return answers;
}

function v2PlanBody() {
    const path = v2CurrentPath();
    const body = { path, answers: v2CollectAnswers() };
    if (path !== 1) body.target_monthly = v2Num("v2Target", 0);
    return body;
}

// --- Walidacja --------------------------------------------------------------

function v2ValidateStep(stepId) {
    const age = v2Int("v2Age", 40);
    const path = v2CurrentPath();

    if (stepId === "profil") {
        if (age < 16 || age > 90) {
            alert("Podaj wiek z zakresu 16–90 lat.");
            return false;
        }
    }

    if (stepId === "etat" && v2MonthlySalaryValue() <= 0) {
        alert("Podaj kwotę pensji większą od zera.");
        return false;
    }

    if (stepId === "b2b" && v2MonthlySalaryValue() <= 0) {
        alert("Podaj miesięczny przychód z działalności większy od zera.");
        return false;
    }

    if (stepId === "oszczednosci") {
        if (path !== 2 && v2Num("v2Savings", 0) < 0) {
            alert("Kwota oszczędności nie może być ujemna.");
            return false;
        }
        if (v2Radio("v2HasMortgage", "no") === "yes") {
            if (v2Num("v2MortgageMonthly", 0) <= 0) {
                alert("Podaj miesięczną ratę kredytu hipotecznego.");
                return false;
            }
            if (v2Int("v2MortgageEndAge", 0) <= age) {
                alert("Wiek końca spłaty kredytu musi być późniejszy niż obecny wiek.");
                return false;
            }
        }
    }

    if (stepId === "kapital" && v2Radio("v2HasRealEstate", "no") === "yes") {
        if (v2Num("v2ReValue", 0) <= 0) {
            alert("Podaj wartość rynkową nieruchomości inwestycyjnej.");
            return false;
        }
        const liq = v2Int("v2ReLiqAge", 0);
        if (liq > 0 && liq <= age) {
            alert("Wiek sprzedaży nieruchomości musi być późniejszy niż obecny wiek (albo 0 = nie sprzedawaj).");
            return false;
        }
    }

    if (stepId === "sabbatical") {
        if (path !== 1 && v2Num("v2Target", 0) <= 0) {
            alert("Podaj docelową wypłatę miesięczną netto.");
            return false;
        }

        const retirement = v2Int("v2Retirement", 65);
        const planEnd = v2Int("v2PlanEnd", 85);
        if (planEnd <= retirement) {
            alert("Horyzont planu musi być późniejszy niż wiek rozpoczęcia emerytury ZUS.");
            return false;
        }

        if (path !== 3) {
            const re = v2Int("v2Re", 55);
            if (re <= age) {
                alert(`Wiek FIRE musi być większy niż obecny wiek (${age}).`);
                return false;
            }
            if (retirement < re) {
                alert("Wiek emerytury ZUS nie może być wcześniejszy niż wiek pełnego FIRE. Zwiększ wiek emerytury albo obniż wiek FIRE.");
                return false;
            }
            if (planEnd <= re) {
                alert("Horyzont planu musi być późniejszy niż wiek FIRE.");
                return false;
            }
        }

        const style = v2Radio("v2FireStyle", "full");
        if (style === "coast" || style === "barista") {
            const semiAge = v2Int("v2SemiAge", 48);
            if (semiAge <= age) {
                alert("Wiek przejścia na część etatu musi być późniejszy niż obecny wiek.");
                return false;
            }
            const semiUpper = path === 3 ? retirement : v2Int("v2Re", 55);
            if (semiAge >= semiUpper) {
                alert(path === 3
                    ? "Wiek przejścia na część etatu musi być wcześniejszy niż wiek emerytury ZUS."
                    : "Wiek przejścia na część etatu musi być wcześniejszy niż wiek pełnego FIRE.");
                return false;
            }
            if (v2Num("v2SemiNet", 0) <= 0) {
                alert("Podaj miesięczne zarobki netto na części etatu.");
                return false;
            }
        }
    }

    if (stepId === "strategia") {
        if (!v2Suggested || v2SuggestLoading) {
            alert("Poczekaj na wyliczenie propozycji podziału oszczędności, a potem przejdź dalej.");
            return false;
        }
        const allocations = v2CurrentAllocations();
        const total = Object.values(allocations).reduce((sum, value) => sum + (value || 0), 0);
        if (total > 100 + 1e-6) {
            alert("Suma udziałów nie może przekraczać 100%. Zmniejsz wybrane wartości.");
            return false;
        }
        if (total <= 0 && v2ManualAllocationPoolMonthly() > 0) {
            alert("Nie udało się zaproponować podziału oszczędności. Spróbuj ponownie.");
            return false;
        }
    }

    return true;
}

// --- Propozycja podziału ----------------------------------------------------

function v2SuggestBody() {
    const path = v2CurrentPath();
    const body = {
        answers: v2CollectAnswers({ withAllocations: v2AllocationMode === "manual" && path === 2 }),
        path,
        target_monthly: path !== 1 ? v2Num("v2Target", 0) : null,
    };
    return body;
}

function v2InvalidateSuggestion() {
    v2SuggestSeq += 1;
    v2Suggested = null;
    v2SuggestSignature = "";
    v2SuggestLoading = false;
    v2UpdateAllocationModeControl();
}

function v2ScheduleSuggestion() {
    clearTimeout(v2SuggestTimer);
    v2SuggestTimer = setTimeout(() => v2RefreshSuggestion(), 250);
}

function v2RefreshSuggestion() {
    clearTimeout(v2SuggestTimer);
    const body = v2SuggestBody();
    const signature = v2CanonicalJson(body);
    if (v2Suggested && signature === v2SuggestSignature) {
        v2RenderSuggestion();
        return;
    }

    const preserveManualRows = v2AllocationMode === "manual" && Boolean(v2Suggested);
    v2SuggestLoading = true;
    if (preserveManualRows) {
        v2UpdateAllocationModeControl();
        const note = v2El("v2TaxTipNote");
        if (note) note.textContent = "Przeliczam pulę oszczędności dla ręcznego podziału…";
    } else {
        v2Suggested = null;
        v2RenderSuggestionLoading();
    }
    const seq = ++v2SuggestSeq;
    v2PostJson("/api/wizard/suggest", body, "Błąd sugestii podziału.")
        .then((data) => {
            if (seq !== v2SuggestSeq) return;
            v2SuggestLoading = false;
            v2Suggested = {
                allocations: data.allocations || {},
                pool_monthly: Number(data.pool_monthly) || 0,
                strategyPreviews: data.strategy_previews || {},
                strategyPriorities: data.strategy_priorities || {},
            };
            v2SuggestSignature = signature;
            v2RenderSuggestion();
        })
        .catch((err) => {
            if (seq !== v2SuggestSeq) return;
            v2Suggested = null;
            v2SuggestLoading = false;
            v2RenderSuggestionError(err.message);
        });
}

function v2RenderSuggestionLoading() {
    const box = v2El("v2SuggestList");
    const note = v2El("v2TaxTipNote");
    const sumBox = v2El("v2ManualSum");
    if (sumBox) {
        sumBox.hidden = true;
        sumBox.classList.add("hidden");
        sumBox.innerHTML = "";
    }
    const strategyHint = v2El("v2StrategyHint");
    if (strategyHint) {
        strategyHint.hidden = true;
        strategyHint.classList.add("hidden");
        strategyHint.innerHTML = "";
    }
    v2UpdateAllocationModeControl();
    if (box) {
        box.innerHTML = `
            <div class="v2-suggest-empty">
                <span class="spinner" aria-hidden="true"></span>
                <span>Wyliczam propozycję podziału oszczędności…</span>
            </div>`;
    }
    if (note) note.textContent = "";
}

function v2RenderSuggestionError(message) {
    const box = v2El("v2SuggestList");
    const note = v2El("v2TaxTipNote");
    v2SuggestLoading = false;
    if (box) {
        box.innerHTML = `
            <div class="banner banner-warn">
                ${iconSvg("warning")}
                <div class="banner-body">
                    ${escapeHtml(message || "Nie udało się wyliczyć podziału.")}
                    <button type="button" class="btn btn-secondary btn-sm v2-retry-suggest" data-v2-retry-suggest>Ponów</button>
                </div>
            </div>`;
    }
    if (note) note.textContent = "Możesz spróbować ponownie — bez propozycji podziału nie wyliczymy planu.";
    if (v2AllocationMode === "manual") v2AllocationMode = "auto";
    const sumBox = v2El("v2ManualSum");
    if (sumBox) {
        sumBox.hidden = true;
        sumBox.classList.add("hidden");
        sumBox.innerHTML = "";
    }
    const strategyHint = v2El("v2StrategyHint");
    if (strategyHint) {
        strategyHint.hidden = true;
        strategyHint.classList.add("hidden");
        strategyHint.innerHTML = "";
    }
    v2UpdateAllocationModeControl();
}

function v2UpdateAllocationModeControl() {
    const auto = document.querySelector('input[name="v2AllocationMode"][value="auto"]');
    const manual = document.querySelector('input[name="v2AllocationMode"][value="manual"]');
    const title = v2El("v2SuggestTitle");
    const manualMode = v2AllocationMode === "manual";

    if (auto) auto.checked = !manualMode;
    if (manual) {
        manual.checked = manualMode;
        manual.disabled = !v2Suggested || v2SuggestLoading;
    }
    if (title) title.textContent = manualMode
        ? "Ręczny podział miesięcznych wpłat"
        : "Proponowany podział oszczędności";
}

function v2FormatAllocationShare(value) {
    return Number(value).toLocaleString("pl-PL", { maximumFractionDigits: 2 });
}

function v2ManualShareAttr(value) {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    return String(Math.round(clamped * 10) / 10);
}

function v2ManualShareInput(account) {
    return document.querySelector(`.v2-manual-share[data-account="${account}"]`);
}

function v2ManualShareRange(account) {
    return document.querySelector(`.v2-manual-share-range[data-account="${account}"]`);
}

function v2SetManualShare(account, value) {
    const input = v2ManualShareInput(account);
    const range = v2ManualShareRange(account);
    const formatted = v2ManualShareAttr(value);
    if (input) input.value = formatted;
    if (range) range.value = formatted;
}

function v2NormalizeManualShares(shares) {
    const total = Object.values(shares).reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (total <= 100 + 1e-6) return shares;
    const factor = 100 / total;
    const normalized = {};
    V2_ALLOCATABLE_ACCOUNTS.forEach((account) => {
        normalized[account] = Math.max(0, (Number(shares[account]) || 0) * factor);
        v2SetManualShare(account, normalized[account]);
    });
    return normalized;
}

function v2RenderManualAllocation() {
    const box = v2El("v2SuggestList");
    if (!box || !v2Suggested) return;
    v2SeedManualAllocations();
    box.innerHTML = `
        <div class="v2-manual-alloc-grid" role="table" aria-label="Ręczny podział oszczędności">
            <div class="v2-manual-alloc-head" role="row">
                <span role="columnheader">Produkt</span>
                <span role="columnheader">Udział</span>
                <span role="columnheader">Miesięcznie</span>
                <span role="columnheader">Rocznie</span>
            </div>
            <div class="v2-manual-alloc-list" role="rowgroup">
                <div class="v2-manual-alloc-row v2-manual-cash-row" role="row" data-account="gotowka">
                    <span class="v2-manual-alloc-name" role="rowheader">${v2AccountIcon("gotowka")}Gotówka (reszta)<span class="v2-manual-cash-state" aria-hidden="true"></span></span>
                    <span class="v2-manual-share-readonly" role="cell" data-label="Udział">—</span>
                    <span class="v2-manual-monthly" role="cell" data-label="Miesięcznie">0 zł/mies.</span>
                    <span class="v2-manual-annual" role="cell" data-label="Rocznie">0 zł/rok</span>
                </div>
                ${V2_ALLOCATABLE_ACCOUNTS.map((account) => `
                    <div class="v2-manual-alloc-row" role="row" data-account="${account}">
                        <span class="v2-manual-alloc-name" role="rowheader">${v2AccountIcon(account)}${escapeHtml(v2AccountLabel(account))}</span>
                        <div class="v2-manual-share-field" role="cell">
                            <span class="v2-field-label v2-manual-share-mobile-label">Udział (%)</span>
                            ${numControlsHtml({
                                value: v2ManualShareAttr(v2ManualAllocations[account] || 0),
                                min: "0",
                                max: "100",
                                step: "0.1",
                                fieldClass: "v2-manual-share",
                                attrs: `data-account="${account}"`,
                                aria: `Udział ${v2AccountLabel(account)} procent`,
                            })}
                            <input type="range" class="range v2-manual-share-range"
                                   data-account="${account}" min="0" max="100" step="0.1"
                                   value="${v2ManualShareAttr(v2ManualAllocations[account] || 0)}"
                                   aria-label="Udział ${escapeHtml(v2AccountLabel(account))} suwak">
                        </div>
                        <span class="v2-manual-monthly" role="cell" data-label="Miesięcznie">0 zł/mies.</span>
                        <span class="v2-manual-annual" role="cell" data-label="Rocznie">0 zł/rok</span>
                        <span class="v2-manual-cap-note" hidden></span>
                    </div>`).join("")}
            </div>
        </div>`;
    v2UpdateManualAllocationAmounts();
}

function v2UpdateManualAllocationAmounts() {
    if (v2AllocationMode !== "manual") return;
    if (!document.querySelector(".v2-manual-share")) return;
    let shares = v2ManualAllocationShares();
    shares = v2NormalizeManualShares(shares);
    v2ManualAllocations = { ...shares };
    const pool = v2ManualAllocationPoolMonthly();
    const poolAnnual = pool * 12;
    let totalShare = Object.values(shares).reduce((sum, share) => sum + (Number(share) || 0), 0);
    let allocatedAnnual = 0;

    V2_ALLOCATABLE_ACCOUNTS.forEach((account) => {
        const share = Math.max(0, Number(shares[account]) || 0);
        const others = Math.max(0, totalShare - share);
        const max = Math.max(0, 100 - others);
        const input = v2ManualShareInput(account);
        const range = v2ManualShareRange(account);
        if (input) input.max = v2ManualShareAttr(max);
        if (range) {
            range.max = v2ManualShareAttr(max);
            if (input) range.value = input.value;
        }
        const requestedAnnual = poolAnnual * share / 100;
        const cap = v2ManualAllocationCap(account);
        const allocated = cap > 0 ? Math.min(requestedAnnual, cap) : requestedAnnual;
        allocatedAnnual += allocated;
        const row = document.querySelector(`.v2-manual-alloc-row[data-account="${account}"]`);
        if (!row) return;
        row.querySelector(".v2-manual-monthly").textContent = `${fmtMoney(allocated / 12)}/mies.`;
        row.querySelector(".v2-manual-annual").textContent = `${fmtMoney(allocated)}/rok`;
        const capNote = row.querySelector(".v2-manual-cap-note");
        const overCap = cap > 0 && requestedAnnual > cap + 0.01;
        capNote.hidden = !overCap;
        capNote.textContent = overCap ? `Limit roczny ${fmtMoney(cap)} — nadwyżka w gotówce` : "";
    });

    const cashAnnual = Math.max(0, poolAnnual - allocatedAnnual);
    const cashMonthly = cashAnnual / 12;
    const cashShare = poolAnnual > 0 ? (cashAnnual / poolAnnual) * 100 : 0;
    const cashPositive = cashAnnual > 0.5;
    const cashRow = document.querySelector('.v2-manual-alloc-row[data-account="gotowka"]');
    if (cashRow) {
        cashRow.classList.toggle("is-clear", !cashPositive);
        cashRow.classList.toggle("is-warning", cashPositive);
        cashRow.querySelector(".v2-manual-share-readonly").textContent = `${v2FormatAllocationShare(cashShare)}%`;
        cashRow.querySelector(".v2-manual-monthly").textContent = `${fmtMoney(cashMonthly)}/mies.`;
        cashRow.querySelector(".v2-manual-annual").textContent = `${fmtMoney(cashAnnual)}/rok`;
        const state = cashRow.querySelector(".v2-manual-cash-state");
        if (state) state.innerHTML = cashPositive ? iconSvg("warning") : iconSvg("check");
    }

    const sumBox = v2El("v2ManualSum");
    if (sumBox) {
        const complete = Math.abs(totalShare - 100) <= 0.05;
        const extra = complete && cashPositive ? " · nadwyżka w gotówce" : "";
        const chipClass = complete
            ? (cashPositive ? "chip-warn" : "chip-success")
            : "";
        sumBox.hidden = false;
        sumBox.classList.remove("hidden");
        sumBox.innerHTML = `<span class="chip ${chipClass}">${complete && !cashPositive ? iconSvg("check") : ""}Suma udziałów: ${v2FormatAllocationShare(totalShare)}%${extra}</span>`;
    }
    const note = v2El("v2TaxTipNote");
    if (note) note.textContent = "";
}

function v2UpdateManualAllocationInput(target) {
    const range = target?.matches?.(".v2-manual-share-range") ? target : null;
    const account = range?.dataset.account || target?.dataset.account;
    const input = range
        ? v2ManualShareInput(account)
        : (target?.matches?.(".v2-manual-share") ? target : null);
    if (input && range) input.value = range.value;
    if (input && account) {
        const shares = v2ManualAllocationShares();
        const others = Object.entries(shares)
            .filter(([key]) => key !== account)
            .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
        const max = Math.max(0, 100 - others);
        const current = Math.max(0, Math.min(max, parseFloat(input.value) || 0));
        input.value = v2ManualShareAttr(current);
        const pairedRange = v2ManualShareRange(account);
        if (pairedRange) pairedRange.value = input.value;
    }
    v2ManualAllocations = v2ManualAllocationShares();
    v2FormVersion += 1;
    v2Plan = null;
    v2PlanSignature = "";
    v2PlanBodyCache = null;
    v2UpdateManualAllocationAmounts();
    v2RenderIkzeRefundNote(
        Object.entries(v2ManualAllocations || {}).filter(
            ([, share]) => Number(share) > 0
        )
    );
    v2ScheduleStateSave();
    if (v2CurrentPath() === 2) {
        v2SuggestLoading = true;
        v2UpdateAllocationModeControl();
        const note = v2El("v2TaxTipNote");
        if (note) note.textContent = "Przeliczam wymaganą pulę dla ręcznego podziału…";
        v2ScheduleSuggestion();
    }
}

function v2SetAllocationMode(mode) {
    if (mode === "manual" && !v2Suggested) {
        v2UpdateAllocationModeControl();
        return;
    }
    const nextMode = mode === "manual" ? "manual" : "auto";
    if (nextMode === v2AllocationMode) return;
    v2AllocationMode = nextMode;
    if (v2AllocationMode === "manual") v2SeedManualAllocations();
    v2FormVersion += 1;
    v2Plan = null;
    v2PlanSignature = "";
    v2PlanBodyCache = null;
    v2ScheduleStateSave();
    if (v2CurrentPath() === 2) {
        v2SuggestSeq += 1;
        v2SuggestSignature = "";
        v2SuggestLoading = true;
        v2UpdateAllocationModeControl();
        v2RenderSuggestion();
        const note = v2El("v2TaxTipNote");
        if (note) note.textContent = "Przeliczam pulę oszczędności dla tego podziału…";
        v2ScheduleSuggestion();
        return;
    }
    v2UpdateAllocationModeControl();
    v2RenderSuggestion();
}

function v2StrategyPriorityHtml(accounts) {
    const priority = (accounts || []).filter(Boolean);
    if (!priority.length) {
        return '<span class="v2-strategy-empty">Brak nowych wpłat</span>';
    }
    const visible = priority.slice(0, 5);
    const rest = priority.slice(5);
    const rows = visible.map((account, index) => `
        <span class="v2-strategy-rank-row">
            <span class="v2-strategy-rank-num">${index + 1}</span>
            <span class="v2-strategy-rank-icon">${v2AccountIcon(account)}</span>
            <span class="v2-strategy-rank-name">${escapeHtml(v2AccountLabel(account))}</span>
        </span>`);
    if (rest.length) {
        const full = priority.map((account) => v2AccountLabel(account)).join(" → ");
        rows.push(`
            <span class="v2-strategy-more">
                <span>…i ${rest.length} dalsze</span>${tipHtml(full)}
            </span>`);
    }
    return rows.join("");
}

function v2StrategyPreviewsAllSame() {
    const previews = v2Suggested?.strategyPreviews || {};
    const keys = ["konserwatywna", "zbilansowana", "agresywna"];
    if (!keys.every((key) => previews[key])) return false;
    const first = v2CanonicalJson(previews[keys[0]]);
    return keys.every((key) => v2CanonicalJson(previews[key]) === first);
}

function v2RenderStrategyPreviews() {
    const priorities = v2Suggested?.strategyPriorities || {};
    const previews = v2Suggested?.strategyPreviews || {};
    document.querySelectorAll("[data-strategy-rank]").forEach((el) => {
        const key = el.dataset.strategyRank;
        const accounts = priorities[key] || Object.keys(previews[key] || {});
        el.innerHTML = v2StrategyPriorityHtml(accounts);
    });
    const allSame = v2StrategyPreviewsAllSame();
    const selected = v2Radio("v2Strategy", "zbilansowana");
    const expanded = v2StrategyExpanded || !allSame;
    document.querySelectorAll("[data-strategy-card]").forEach((card) => {
        const key = card.dataset.strategyCard;
        card.hidden = !expanded && key !== selected;
    });
    const showAll = v2El("v2StrategyShowAll");
    if (showAll) {
        showAll.classList.toggle("hidden", !allSame);
        showAll.textContent = expanded ? "Ukryj inne strategie" : "Pokaż inne strategie";
    }

    const hint = v2El("v2StrategyHint");
    if (!hint) return;
    const pool = Number(v2Suggested?.pool_monthly) || 0;
    if (allSame && pool > 0 && v2AllocationMode !== "manual") {
        hint.hidden = false;
        hint.classList.remove("hidden");
        hint.innerHTML = `<div class="banner banner-info">${iconSvg("info")}<div class="banner-body">Przy tej puli wszystkie strategie dają ten sam podział — cała kwota mieści się w limitach IKE i IKZE.</div></div>`;
    } else {
        hint.hidden = true;
        hint.classList.add("hidden");
        hint.innerHTML = "";
    }
}

function v2RenderIkzeRefundNote(entries) {
    const note = v2El("v2IkzeRefundNote");
    if (!note) return;
    const hasIkze = (entries || []).some(
        ([account]) => v2BaseKey(account) === "ikze"
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
        "Broker",
        "OKI inwestycyjne",
        "Obligacje",
        "Lokata",
        "OKI oszczędnościowe",
        "Krypto",
        "Gotówka",
    ].join(" → ");
    note.innerHTML = `${iconSvg("info")}<span>Ulga IKZE wraca co roku i jest reinwestowana.${tipHtml(
        `Kolejność: ${order}. IKE i OIPE tylko do rocznego limitu. Zwrot trafia na konto docelowe, jeśli jest w planie; inaczej tylko obniża podatek. To dodatkowy kapitał poza miesięczną pulą.`
    )}</span>`;
}

function v2RenderSuggestion() {
    const box = v2El("v2SuggestList");
    const note = v2El("v2TaxTipNote");
    if (!box || !v2Suggested) {
        v2RenderIkzeRefundNote([]);
        return;
    }

    v2RenderStrategyPreviews();
    v2UpdateAllocationModeControl();
    if (v2AllocationMode === "manual") {
        v2RenderManualAllocation();
        v2RenderIkzeRefundNote(
            Object.entries(v2ManualAllocations || {}).filter(
                ([, share]) => Number(share) > 0
            )
        );
        return;
    }
    const sumBox = v2El("v2ManualSum");
    if (sumBox) {
        sumBox.hidden = true;
        sumBox.classList.add("hidden");
        sumBox.innerHTML = "";
    }

    const pool = Number(v2Suggested.pool_monthly) || 0;
    const entries = Object.entries(v2Suggested.allocations || {})
        .filter(([, pct]) => pct > 0)
        .sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
        box.innerHTML = `
            <div class="v2-suggest-empty">
                <span>Brak nowych wpłat do podziału — plan obejmie tylko posiadany kapitał.</span>
            </div>`;
        v2RenderIkzeRefundNote([]);
        if (note) note.textContent = "Możesz zwiększyć miesięczne oszczędności, aby zobaczyć propozycję podziału.";
        return;
    }

    v2RenderIkzeRefundNote(entries);

    box.innerHTML = entries.map(([account, pct]) => {
        const monthly = (pool * pct) / 100;
        return `
            <div class="v2-suggest-row">
                <span class="v2-suggest-icon">${v2AccountIcon(account)}</span>
                <span class="v2-suggest-name">${escapeHtml(v2AccountLabel(account))}</span>
                <span class="v2-suggest-pct">${escapeHtml(v2FormatPercent(pct))}</span>
                <span class="v2-suggest-amount">${fmtMoney(monthly)}<span class="v2-suggest-unit">/mies.</span></span>
            </div>`;
    }).join("");

    if (note) {
        const parts = [];
        if (pool > 0) parts.push(`Pula: ${fmtMoney(pool)}/mies.`);
        if (v2Employment() === "b2b") {
            parts.push("Na B2B limit IKZE jest wyższy niż na etacie.");
        } else if (entries.some(([account]) => account === "ikze")) {
            parts.push("Wpłaty na IKZE odliczasz od podatku dochodowego.");
        }
        parts.push("Możesz przełączyć się na tryb Ręczny i zmienić udziały produktów.");
        note.textContent = parts.join(" ");
    }
}

// --- Wyliczanie i renderowanie planu ---------------------------------------

function v2ShowLoader(showLoader) {
    const loader = v2El("v2PlanLoader");
    loader?.classList.toggle("hidden", !showLoader);
    if (showLoader) {
        v2UpdateLoaderText();
        clearInterval(v2LoaderTimer);
        v2LoaderTimer = setInterval(v2UpdateLoaderText, 6000);
    } else {
        clearInterval(v2LoaderTimer);
        v2LoaderTimer = null;
    }
    const result = v2El("v2Result");
    if (showLoader && result) result.classList.add("hidden");
}

function v2ShuffleLoaderTips() {
    const tips = [...V2_PLAN_LOADER_TIPS];
    for (let i = tips.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [tips[i], tips[j]] = [tips[j], tips[i]];
    }
    return tips;
}

function v2NextLoaderTip() {
    if (!v2LoaderTipBag.length) v2LoaderTipBag = v2ShuffleLoaderTips();
    let tip = v2LoaderTipBag.pop();
    if (tip === v2LoaderLastTip && v2LoaderTipBag.length) {
        const swap = v2LoaderTipBag.pop();
        v2LoaderTipBag.push(tip);
        tip = swap;
    }
    v2LoaderLastTip = tip;
    return tip;
}

function v2UpdateLoaderText() {
    const tip = v2El("v2LoaderTip");
    if (tip) tip.textContent = v2NextLoaderTip();
}

async function v2RunPlan() {
    if (v2PlanLoading) return;
    if (!v2ValidateStep("sabbatical") || !v2ValidateStep("strategia")) return;

    const body = v2PlanBody();
    const seq = ++v2PlanSeq;
    const version = v2FormVersion;
    v2PlanLoading = true;
    v2ShowLoader(true);
    v2UpdateActions();

    const errorBox = v2El("v2ResultError");
    if (errorBox) {
        errorBox.classList.add("hidden");
        errorBox.textContent = "";
    }

    try {
        const data = await v2PostJson("/api/wizard/plan", body, "Błąd planowania.");
        if (seq !== v2PlanSeq) return;
        v2Plan = data;
        v2PlanSignature = v2CanonicalJson(body);
        v2PlanBodyCache = body;
        v2SelectedScenario = "realne";
        if (version !== v2FormVersion) {
            // Odpowiedź dotyczy starszych odpowiedzi — nie pokazujemy jej.
            v2Plan = null;
            v2PlanSignature = "";
            v2PlanBodyCache = null;
            return;
        }
        v2El("v2Result")?.classList.remove("hidden");
        v2El("v2ResultError")?.classList.add("hidden");
        v2RenderResult(data);
        v2SavePlanCache();
    } catch (err) {
        if (seq !== v2PlanSeq) return;
        v2Plan = null;
        v2PlanSignature = "";
        v2PlanBodyCache = null;
        const result = v2El("v2Result");
        if (result) result.classList.remove("hidden");
        if (errorBox) {
            errorBox.innerHTML = `${iconSvg("danger")}<div class="banner-body">${escapeHtml(err.message)}</div>`;
            errorBox.classList.remove("hidden");
        }
    } finally {
        if (seq === v2PlanSeq) {
            v2PlanLoading = false;
            v2ShowLoader(false);
            v2UpdateActions();
        }
    }
}

function v2ActiveScenarioData(data) {
    const key = v2SelectedScenario;
    return {
        projection: data.scenario_projections?.[key] || data.projection || {},
        solved: data.scenario_solved?.[key] || data.solved || {},
        input: data.scenario_inputs?.[key] || data.input,
    };
}

function v2RenderResult(data) {
    const result = v2El("v2Result");
    if (!result || !data) return;
    result.classList.remove("hidden");
    v2El("v2ResultError")?.classList.add("hidden");
    const active = v2ActiveScenarioData(data);
    v2RenderHero(data);
    v2RenderScenarios(data);
    v2RenderMetrics(active.projection);
    v2RenderFacts(active.projection);
    v2RenderWarnings(active.projection?.warnings || []);
    v2RenderTimeline(active.input, active.projection);
    v2RenderPhaseTable(active.projection);
    v2RenderStageSummary(active.input, active.projection);
    v2RenderAccountFlows(active.input, active.projection);
    v2RenderPolicy(active.projection);
}

function v2RenderHero(data) {
    const box = v2El("v2HeroAnswer");
    if (!box) return;
    const fmt = (value) => (value == null ? "—" : Math.round(value).toLocaleString("pl-PL"));
    const path = data.path || v2CurrentPath();
    const { projection: proj, solved, input } = v2ActiveScenarioData(data);
    const scenarioLabel = data.scenarios?.[v2SelectedScenario]?.label || "";
    const kicker = `Odpowiedź Asystenta${scenarioLabel ? ` · ${scenarioLabel}` : ""}`;

    box.classList.toggle("is-warn", !solved.feasible || !proj.met);

    if (path === 1) {
        const payout = proj.min_monthly || 0;
        const reAge = solved.retire_early_age ?? input?.retire_early_age ?? v2Int("v2Re", 55);
        const endAge = input?.plan_end_age ?? v2Int("v2PlanEnd", 85);
        if (solved.feasible && proj.met && payout > 0) {
            box.innerHTML = `
                <div class="wz-hero-kicker">${escapeHtml(kicker)} · Ile dostaniesz miesięcznie</div>
                <div class="wz-hero-headline">Możesz wypłacać ${fmt(payout)} zł/mies. netto</div>
                <div class="wz-hero-desc">Od ${reAge}. do ${endAge}. roku życia Twój portfel wraz z emeryturą ZUS zapewni co najmniej <strong>${fmt(payout)} zł/mies.</strong> na rękę (średnio <strong>${fmt(proj.mean_monthly)} zł/mies.</strong>).</div>`;
        } else {
            box.innerHTML = `
                <div class="wz-hero-kicker">${escapeHtml(kicker)} · Ile dostaniesz miesięcznie</div>
                <div class="wz-hero-headline">Plan wymaga korekty założeń</div>
                <div class="wz-hero-desc">${escapeHtml(solved.note || proj.warnings?.[0] || "Zwiększ oszczędności, wydłuż horyzont lub obniż oczekiwania.")}</div>`;
        }
        return;
    }

    if (path === 2) {
        const target = proj.target_monthly || v2Num("v2Target", 0);
        const savings = solved.savings_monthly;
        if (solved.feasible && savings != null) {
            const pct = solved.savings_pct != null
                ? ` (${solved.savings_pct.toLocaleString("pl-PL")}% pensji netto)`
                : "";
            box.innerHTML = `
                <div class="wz-hero-kicker">${escapeHtml(kicker)} · Ile musisz odkładać</div>
                <div class="wz-hero-headline">Odkładaj ${fmt(savings)} zł/mies.${pct}</div>
                <div class="wz-hero-desc">Tyle wystarczy odkładać, aby osiągnąć docelową wypłatę <strong>${fmt(target)} zł/mies. netto</strong> przez cały wybrany horyzont czasowy.</div>`;
        } else {
            box.innerHTML = `
                <div class="wz-hero-kicker">${escapeHtml(kicker)} · Ile musisz odkładać</div>
                <div class="wz-hero-headline">Cel ${fmt(target)} zł/mies. wymaga korekty założeń</div>
                <div class="wz-hero-desc">${escapeHtml(solved.note || "Rozważ późniejszy wiek FIRE lub niższy cel wypłaty.")}</div>`;
        }
        return;
    }

    const target = proj.target_monthly || v2Num("v2Target", 0);
    const re = solved.retire_early_age;
    const ageNow = input?.age_now ?? v2Int("v2Age", 40);
    if (solved.feasible && re != null) {
        const yearsLeft = Math.max(0, re - ageNow);
        box.innerHTML = `
            <div class="wz-hero-kicker">${escapeHtml(kicker)} · Kiedy możesz przestać pracować</div>
            <div class="wz-hero-headline">W wieku ${re} lat (za ${yearsLeft} ${v2FormatYears(yearsLeft)})</div>
            <div class="wz-hero-desc">To najwcześniejszy wiek przejścia na FIRE z gwarancją wypłaty co najmniej <strong>${fmt(target)} zł/mies. netto</strong>.</div>`;
    } else {
        box.innerHTML = `
            <div class="wz-hero-kicker">${escapeHtml(kicker)} · Kiedy możesz przestać pracować</div>
            <div class="wz-hero-headline">Cel ${fmt(target)} zł/mies. nieosiągalny przed emeryturą</div>
            <div class="wz-hero-desc">${escapeHtml(solved.note || "Rozważ wyższe miesięczne oszczędności lub niższą docelową wypłatę.")}</div>`;
    }
}

function v2RenderScenarios(data) {
    const box = v2El("v2ScenariosBox");
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
    const path = data.path || v2CurrentPath();

    let html = `<h3 class="eyebrow wz-panel-title">${tipLabelHtml("Scenariusze rynkowe", "Konserwatywne: wyższa inflacja, niższe ROI i słabsza waloryzacja ZUS. Realne: Twoja konfiguracja bazowa. Optymistyczne: niższa inflacja, wyższe ROI i mocniejsza waloryzacja. Kliknij kartę, aby ustawić scenariusz główny.")}</h3><div class="wz-scenarios-grid">`;
    keys.forEach((key) => {
        const scenario = scenarios[key];
        const selected = key === v2SelectedScenario;
        let mainText = "";
        let subText = `Szczyt majątku: ${fmt(scenario.peak_wealth)} zł`;
        if (path === 1) {
            mainText = `${fmt(scenario.payout_monthly)} zł/mies.`;
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
            <button type="button" class="wz-scenario-card${selected ? " is-selected" : ""}" data-scenario="${key}" aria-pressed="${selected}">
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

function v2RenderMetrics(projection) {
    const box = v2El("v2Metrics");
    if (!box) return;
    const fmt = (value) => (value == null ? "—" : Math.round(value).toLocaleString("pl-PL"));
    let html = `<div class="metric"><span class="metric-label">Średnia wypłata/mies.</span><span class="metric-value">${fmt(projection.mean_monthly)} zł</span></div>`;
    html += `<div class="metric"><span class="metric-label">Minimalna wypłata/mies.</span><span class="metric-value">${fmt(projection.min_monthly)} zł</span></div>`;
    if (projection.target_monthly != null) {
        const ok = projection.met;
        html += `<div class="metric ${ok ? "is-positive" : "is-warning"}"><span class="metric-label">Cel ${fmt(projection.target_monthly)} zł</span><span class="metric-value">${ok ? "osiągnięty" : "nieosiągnięty"}</span></div>`;
        if (!ok && projection.exhaust_age != null) {
            html += `<div class="metric is-warning"><span class="metric-label">Wiek wyczerpania</span><span class="metric-value">${projection.exhaust_age} r.ż.</span></div>`;
        }
    }
    html += `<div class="metric"><span class="metric-label">Majątek szczytowy</span><span class="metric-value">${fmt(projection.peak_wealth)} zł</span></div>`;
    html += `<div class="metric${(projection.final_wealth || 0) <= 0 ? " is-muted" : ""}"><span class="metric-label">Na koniec brutto</span><span class="metric-value">${fmt(projection.final_wealth)} zł</span></div>`;
    html += `<div class="metric${(projection.final_wealth_net || 0) <= 0 ? " is-muted" : ""}" title="Po podatku od likwidacji kont na koniec horyzontu"><span class="metric-label">Na koniec netto</span><span class="metric-value">${fmt(projection.final_wealth_net ?? projection.final_wealth)} zł</span></div>`;
    box.innerHTML = html;
}

function v2RenderFacts(projection) {
    const box = v2El("v2Facts");
    if (!box) return;
    const fmt = (value) => Math.round(value || 0).toLocaleString("pl-PL");
    const facts = [];

    const earlyTotal = projection?.early_return_total || 0;
    if (earlyTotal > 0.5) {
        const entries = Object.entries(projection.early_return_allocations || {})
            .filter(([, amount]) => amount > 0.5);
        const parts = entries.map(([account, amount]) => `${v2AccountLabel(account)}: ${fmt(amount)} zł`);
        const targets = entries.map(([account]) => v2AccountLabel(account));
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
        const parts = entries.map(([account, amount]) => `${v2AccountLabel(account)}: ${fmt(amount)} zł`);
        const targets = entries.map(([account]) => v2AccountLabel(account));
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

function v2RenderWarnings(list) {
    const box = v2El("v2Warnings");
    if (!box) return;
    box.innerHTML = "";
    if (!list || !list.length) return;
    const banner = document.createElement("div");
    banner.className = "banner banner-warn";
    banner.insertAdjacentHTML("afterbegin", iconSvg("warning"));
    const body = document.createElement("div");
    body.className = "banner-body";
    const ul = document.createElement("ul");
    ul.className = "banner-list";
    list.forEach((warning) => {
        const li = document.createElement("li");
        li.textContent = warning;
        ul.appendChild(li);
    });
    body.appendChild(ul);
    banner.appendChild(body);
    box.appendChild(banner);
}

function v2PhaseSplit(phase) {
    if (!phase || phase.cashflow === "contribution") return "";
    const parts = [];
    if (phase.portfolio_monthly > 0) parts.push(`portfel ${Math.round(phase.portfolio_monthly).toLocaleString("pl-PL")}`);
    if (phase.zus_monthly > 0) parts.push(`ZUS ${Math.round(phase.zus_monthly).toLocaleString("pl-PL")}`);
    return parts.join(" + ");
}

function v2RenderTimeline(input, projection) {
    const box = v2El("v2Timeline");
    if (!box) return;
    box.innerHTML = "";
    const phases = projection?.phase_metrics || [];
    if (phases.length) {
        const ordered = [...phases].sort((a, b) => a.start_age - b.start_age);
        const min = Math.min(...ordered.map((phase) => phase.start_age));
        const max = Math.max(...ordered.map((phase) => phase.end_age));
        const width = max - min || 1;
        ordered.forEach((phase) => {
            const leftPct = ((phase.start_age - min) / width) * 100;
            const spanPct = Math.max(2, ((phase.end_age - phase.start_age) / width) * 100);
            const isAccum = phase.cashflow === "contribution";
            const split = v2PhaseSplit(phase);
            const seg = document.createElement("div");
            seg.className = `wz-timeline-segment ${isAccum ? "wz-tl-acc" : "wz-tl-real"}`;
            seg.style.left = `${leftPct}%`;
            seg.style.width = `${spanPct}%`;
            seg.dataset.phaseKey = phase.key || "";
            seg.title = [
                phase.name,
                `${phase.start_age} → ${phase.end_age} r.ż.`,
                isAccum
                    ? `wpłaty ~${fmtMoney(phase.monthly)}/mies.`
                    : `wypłata netto ~${fmtMoney(phase.monthly)}/mies.`,
                split,
            ].filter(Boolean).join(" · ");
            seg.innerHTML = `
                <span class="wz-tl-name">${escapeHtml(phase.name)}</span>
                <span class="wz-tl-age">${phase.start_age}–${phase.end_age} r.ż.</span>
                <span class="wz-tl-amount">${phase.monthly > 0 ? `~${fmtMoney(phase.monthly)}/mies.` : "—"}</span>
                <span class="wz-tl-kind">${isAccum ? "wpłaty" : "wypłata netto"}</span>
                ${split ? `<span class="wz-tl-split">${escapeHtml(split)}</span>` : ""}`;
            box.appendChild(seg);
        });
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
}

function v2StageMetricFor(metrics, stage, index) {
    if (!Array.isArray(metrics)) return null;
    const direct = metrics[index];
    if (direct
        && direct.name === stage.name
        && direct.start_age === stage.start_age
        && direct.end_age === stage.end_age) {
        return direct;
    }
    return metrics.find(
        (metric) => metric.name === stage.name
            && metric.start_age === stage.start_age
            && metric.end_age === stage.end_age
    ) || null;
}

function v2RenderPhaseTable(projection) {
    const box = v2El("v2PhaseTable");
    if (!box) return;
    const phases = projection?.phase_metrics || [];
    if (!phases.length) {
        box.innerHTML = "";
        return;
    }
    const rows = [...phases]
        .sort((a, b) => a.start_age - b.start_age)
        .map((phase) => {
            const isAccum = phase.cashflow === "contribution";
            const amount = phase.monthly > 0 ? `~${fmtMoney(phase.monthly)}/mies.` : "—";
            const kind = isAccum ? "wpłaty" : "wypłata netto";
            const components = isAccum ? "wpłaty do portfela" : (v2PhaseSplit(phase) || "—");
            return `
                <tr>
                    <td data-label="Etap"><span class="wz-phase-name">${escapeHtml(phase.name)}</span></td>
                    <td data-label="Wiek">${phase.start_age}–${phase.end_age} r.ż.</td>
                    <td data-label="Miesięcznie"><strong>${amount}</strong><span class="wz-phase-kind">${kind}</span></td>
                    <td data-label="Składniki"><span class="wz-phase-components">${components}</span></td>
                </tr>`;
        })
        .join("");
    box.innerHTML = `
        <div class="wz-phase-table-wrap">
            <table class="wz-phase-table" aria-label="Szczegóły etapów planu">
                <thead>
                    <tr>
                        <th scope="col">Etap</th>
                        <th scope="col">Wiek</th>
                        <th scope="col">Miesięcznie</th>
                        <th scope="col" title="Kwoty portfela i ZUS sumują się do wypłaty netto.">Składniki</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function v2RenderStageSummary(input, projection) {
    const box = v2El("v2StageSummaryList");
    if (!box || !input || !Array.isArray(input.stages)) return;
    const metrics = projection?.stage_metrics || [];
    box.innerHTML = "";
    input.stages.forEach((stage, index) => {
        const isAccum = stage.stage_type === "akumulacja";
        const kind = isAccum ? "accum" : "withdraw";
        const accounts = stage.accounts || {};
        const accountKeys = Object.keys(accounts);
        const zusOnly = !isAccum && accountKeys.length === 1 && accountKeys[0] === "zus";
        const metric = v2StageMetricFor(metrics, stage, index);
        const amount = metric?.monthly || 0;
        let finance = "";
        if (amount > 0) {
            const title = isAccum
                ? "Średnie miesięczne wpłaty do portfela (bez ZUS)"
                : zusOnly
                    ? "Średnia miesięczna emerytura ZUS netto"
                    : "Średnia miesięczna wypłata netto z portfela";
            finance = `<span class="stage-finance ${kind}" title="${title}">~${fmtMoney(amount)}/mies.</span>`;
        }
        const pills = accountKeys
            .map((key) => {
                const customName = accounts[key]?.custom_name;
                return `<span class="chip">${escapeHtml(v2AccountLabel(key, customName))}</span>`;
            })
            .join("");
        const partTime = Number(stage.part_time_net_monthly) > 0
            ? `<span class="chip chip-accum" title="Dochód netto z pracy na część etatu">praca ${fmtMoney(stage.part_time_net_monthly)}/mies.</span>`
            : "";
        const row = document.createElement("div");
        row.className = "stage-line";
        row.innerHTML = `
            <span class="stage-dot ${kind}"></span>
            <span class="stage-label ${kind}">${escapeHtml(stage.name || (isAccum ? "Akumulacja" : "Realizacja"))}</span>
            <span class="stage-age">${stage.start_age}→${stage.end_age} r.ż.</span>
            ${pills}${partTime}${finance}`;
        box.appendChild(row);
    });
}

function v2FmtZloty(value) {
    return Math.round(value || 0).toLocaleString("pl-PL");
}

function v2FlowMonthlyLabel(phase) {
    const avg = phase.avg_monthly_net || 0;
    const min = phase.min_monthly_net || avg;
    const max = phase.max_monthly_net || avg;
    if (max - min > Math.max(50, avg * 0.05)) {
        return `${v2FmtZloty(min)}–${v2FmtZloty(max)}`;
    }
    return v2FmtZloty(avg);
}

function v2PhaseBadge(n) {
    let out = "";
    while (n > 0) {
        n -= 1;
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26);
    }
    return out;
}

function v2FlowsRange(input, phases, compact = false) {
    const ages = [];
    if (!compact) {
        (input?.stages || []).forEach((stage) => ages.push(stage.start_age, stage.end_age));
        phases.forEach((phase) => {
            if (phase.accumulation_start_age != null) ages.push(phase.accumulation_start_age);
        });
    }
    phases.forEach((phase) => ages.push(phase.start_age, phase.last_age + 1));
    if (!ages.length) return { min: 0, max: 1 };
    const min = Math.min(...ages);
    const max = Math.max(...ages);
    return { min, max: Math.max(min + 1, max) };
}

function v2FlowPct(age, range) {
    return ((age - range.min) / (range.max - range.min)) * 100;
}

let v2GanttTips = [];
let v2GanttBound = false;
let v2GanttPinned = false;
let v2GanttActive = null;
let v2GanttHideTimer = null;
let v2GanttShowTimer = null;
const V2_GANTT_TIP_HOVER_DELAY = 900;

function v2GanttTipHide(force = false) {
    if (v2GanttPinned && !force) return;
    clearTimeout(v2GanttShowTimer);
    v2GanttPinned = false;
    v2GanttActive = null;
    v2El("v2GanttTip")?.classList.add("hidden");
}

function v2GanttTipPlace() {
    const tip = v2El("v2GanttTip");
    const anchor = v2GanttActive;
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

function v2GanttTipCancelShow() {
    clearTimeout(v2GanttShowTimer);
    v2GanttShowTimer = null;
}

function v2GanttTipShow(anchor, pin = false) {
    const html = v2GanttTips[Number(anchor.dataset.tipId)];
    const tip = v2El("v2GanttTip");
    const body = v2El("v2GanttTipBody");
    if (!html || !tip || !body) return;
    v2GanttTipCancelShow();
    body.innerHTML = html;
    tip.classList.remove("hidden");
    v2GanttActive = anchor;
    v2GanttPinned = pin;
    requestAnimationFrame(v2GanttTipPlace);
}

function v2GanttTipScheduleHide() {
    clearTimeout(v2GanttHideTimer);
    v2GanttHideTimer = setTimeout(() => {
        if (!v2GanttPinned) v2GanttTipHide();
    }, 140);
}

function setupV2GanttTips(gantt, tips) {
    v2GanttTips = tips;
    v2GanttTipHide(true);
    if (v2GanttBound) return;
    v2GanttBound = true;
    const anchorOf = (event) => event.target.closest?.("[data-tip-id]");
    gantt.addEventListener("mouseover", (event) => {
        const anchor = anchorOf(event);
        if (!anchor || v2GanttPinned) return;
        if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
        if (v2GanttActive === anchor) return;
        v2GanttTipCancelShow();
        clearTimeout(v2GanttHideTimer);
        v2GanttShowTimer = setTimeout(() => {
            v2GanttShowTimer = null;
            if (!v2GanttPinned && anchor.isConnected) v2GanttTipShow(anchor);
        }, V2_GANTT_TIP_HOVER_DELAY);
    });
    gantt.addEventListener("mouseout", (event) => {
        const anchor = anchorOf(event);
        if (!anchor) return;
        if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
        v2GanttTipCancelShow();
        v2GanttTipScheduleHide();
    });
    gantt.addEventListener("click", (event) => {
        const anchor = anchorOf(event);
        if (!anchor) return;
        event.preventDefault();
        v2GanttTipCancelShow();
        if (v2GanttActive === anchor && v2GanttPinned) {
            v2GanttTipHide(true);
        } else {
            v2GanttTipShow(anchor, true);
        }
    });
    gantt.addEventListener("focusin", (event) => {
        const anchor = anchorOf(event);
        if (anchor) {
            v2GanttTipCancelShow();
            v2GanttTipShow(anchor, v2GanttPinned);
        }
    });
    gantt.addEventListener("focusout", (event) => {
        if (anchorOf(event)) v2GanttTipScheduleHide();
    });
    const tip = v2El("v2GanttTip");
    const close = v2El("v2GanttTipClose");
    if (tip) {
        tip.addEventListener("mouseenter", () => clearTimeout(v2GanttHideTimer));
        tip.addEventListener("mouseleave", v2GanttTipScheduleHide);
    }
    if (close) close.addEventListener("click", () => v2GanttTipHide(true));
    document.addEventListener("pointerdown", (event) => {
        v2GanttTipCancelShow();
        if (!v2GanttActive) return;
        if (tip && (tip.contains(event.target) || event.target.closest?.("[data-tip-id]"))) return;
        v2GanttTipHide(true);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") v2GanttTipHide(true);
    });
    window.addEventListener(
        "scroll",
        () => {
            v2GanttTipCancelShow();
            if (!v2GanttPinned) v2GanttTipHide(true);
            else if (v2GanttActive) requestAnimationFrame(v2GanttTipPlace);
        },
        true
    );
    window.addEventListener("resize", () => {
        if (v2GanttActive) requestAnimationFrame(v2GanttTipPlace);
    });
}

function v2GanttTipRow(label, value, note = "") {
    const noteHtml = note ? `<span class="wz-gantt-tip-note">${escapeHtml(note)}</span>` : "";
    return `<div class="wz-gantt-tip-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}${noteHtml}</dd></div>`;
}

function v2GanttTipPanel(title, subtitle, rows) {
    return `<div class="wz-gantt-tip-title">${escapeHtml(title)}</div>
        <div class="wz-gantt-tip-sub">${escapeHtml(subtitle)}</div>
        <dl class="wz-gantt-tip-list">${rows.join("")}</dl>`;
}

function v2AccumulationTipHtml(input, phase, accountLabel) {
    const rows = [];
    rows.push(v2GanttTipRow("Kapitał startowy", `${v2FmtZloty(phase.accumulation_start_balance)} zł`));

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
            rows.push(v2GanttTipRow(
                "Wpłaty roczne",
                `${v2FmtZloty(annual)} zł`,
                `≈ ${v2FmtZloty(annual / 12)} zł/mies. (pracownik + pracodawca)`
            ));
        }
        if (topups) {
            rows.push(v2GanttTipRow(
                "Dopłaty państwa",
                `${v2FmtZloty(stateAnnual)} zł/rok`,
                `+ ${v2FmtZloty(welcoming)} zł jednorazowo`
            ));
        }
    } else if (annual > 0.5) {
        rows.push(v2GanttTipRow(
            "Wpłaty roczne",
            `${v2FmtZloty(annual)} zł`,
            `≈ ${v2FmtZloty(annual / 12)} zł/mies.`
        ));
    }

    if (phase.accumulation_total_contributions > 0.5) {
        rows.push(v2GanttTipRow(
            "Wpłaty łącznie",
            `${v2FmtZloty(phase.accumulation_total_contributions)} zł`
        ));
    }
    const endAge = phase.accumulation_end_age;
    rows.push(v2GanttTipRow(
        endAge != null ? `Kapitał na koniec wpłat (${endAge} r.ż.)` : "Kapitał na koniec",
        `${v2FmtZloty(phase.accumulation_end_balance)} zł`
    ));
    rows.push(v2GanttTipRow(
        phase.account === "zus" ? "Wzrost (składki + waloryzacja)" : "Wzrost (odsetki)",
        `${v2FmtZloty(phase.accumulation_growth)} zł`
    ));
    if (endAge != null && phase.start_age > endAge) {
        const note = phase.starting_balance < phase.accumulation_end_balance
            ? `po podatkach lub przepadku (${phase.start_age} r.ż.)`
            : `po dalszym wzroście lub transferach (${phase.start_age} r.ż.)`;
        rows.push(v2GanttTipRow(
            "Saldo przed 1. wypłatą",
            `${v2FmtZloty(phase.starting_balance)} zł`,
            note
        ));
    }

    const start = phase.accumulation_start_age;
    const years = start != null && endAge != null ? Math.max(0, endAge - start) : null;
    const period = start != null && endAge != null ? `${start}–${endAge} r.ż.` : "";
    const subtitle = `Akumulacja · ${period}${years ? ` · wpłaty przez ${v2FormatYears(years)}` : ""}`;
    return v2GanttTipPanel(accountLabel, subtitle, rows);
}

function v2PhaseTipHtml(phase, accountLabel) {
    const rows = [];
    rows.push(v2GanttTipRow("Miesięcznie netto", `${v2FlowMonthlyLabel(phase)} zł`));
    rows.push(v2GanttTipRow("Razem netto", `${v2FmtZloty(phase.total_net)} zł`));
    rows.push(v2GanttTipRow(
        phase.account === "zus" ? "Kapitał ZUS" : "Saldo na start",
        `${v2FmtZloty(phase.starting_balance)} zł`
    ));
    rows.push(v2GanttTipRow("Saldo na koniec", `${v2FmtZloty(phase.ending_balance)} zł`));

    const tax = (phase.total_tax || 0) + (phase.total_health || 0);
    const parts = [];
    if (phase.total_tax > 0.5) parts.push(`PIT ${v2FmtZloty(phase.total_tax)} zł`);
    if (phase.total_health > 0.5) parts.push(`zdrowotna ${v2FmtZloty(phase.total_health)} zł`);
    if (phase.lump_tax > 0.5) parts.push(`jednorazowo ${v2FmtZloty(phase.lump_tax)} zł`);
    rows.push(v2GanttTipRow("Podatki i składki", `${v2FmtZloty(tax)} zł`, parts.join(" · ")));

    const subtitle = `Faza ${phase._flowLabel} · ${phase.start_age}–${phase.last_age} r.ż. · ${v2FormatYears(phase.years)}`;
    return v2GanttTipPanel(accountLabel, subtitle, rows);
}

function v2TotalTipHtml(phase) {
    const years = Math.max(0, phase.end_age - phase.start_age);
    const rows = [];
    rows.push(v2GanttTipRow("Miesięcznie netto", `${v2FmtZloty(phase.monthly || 0)} zł`));
    rows.push(v2GanttTipRow("Okres", `${phase.start_age}–${phase.end_age} r.ż.`, v2FormatYears(years)));
    if (phase.portfolio_monthly > 0.5) {
        rows.push(v2GanttTipRow("w tym portfel", `${v2FmtZloty(phase.portfolio_monthly)} zł/mies.`));
    }
    if (phase.zus_monthly > 0.5) {
        rows.push(v2GanttTipRow("w tym ZUS", `${v2FmtZloty(phase.zus_monthly)} zł/mies.`));
    }
    rows.push(v2GanttTipRow(
        "Razem netto (≈)",
        `${v2FmtZloty((phase.monthly || 0) * years * 12)} zł`
    ));
    return v2GanttTipPanel(phase.name || "Razem", "Wypłaty łączne", rows);
}

function v2RenderAccountFlows(input, projection) {
    const wrap = v2El("v2AccountFlows");
    const gantt = v2El("v2FlowsGantt");
    const flowsWrap = v2El("v2FlowsWrap");
    const phases = projection?.account_phases || [];
    if (!wrap || !gantt || !phases.length) {
        flowsWrap?.classList.add("hidden");
        if (wrap) {
            wrap.innerHTML = "<p class=\"field-hint\">Brak szczegółowych danych o wypłatach z kont w tym planie.</p>";
        }
        return;
    }
    flowsWrap?.classList.remove("hidden");

    const compact = typeof window.matchMedia === "function"
        ? window.matchMedia("(max-width: 640px)").matches
        : false;
    const range = v2FlowsRange(input, phases, compact);
    phases.forEach((phase, index) => {
        phase._flowIndex = index + 1;
        phase._flowLabel = v2PhaseBadge(index + 1);
    });
    const customNames = new Map();
    (input?.stages || []).forEach((stage) => {
        Object.entries(stage.accounts || {}).forEach(([account, config]) => {
            if (config?.custom_name) customNames.set(account, config.custom_name);
        });
    });
    const accountName = (account) => account === "zus"
        ? "ZUS (emerytura)"
        : v2AccountLabel(account, customNames.get(account) || "");
    const tips = [];
    const addTip = (html) => {
        tips.push(html);
        return tips.length - 1;
    };

    const accounts = [...new Set(phases.map((phase) => phase.account))];
    const step = range.max - range.min <= 20 ? 2 : 5;
    let ganttHtml = `<div class="wz-gantt-axis"><span class="wz-gantt-axis-label">Konto</span><div class="wz-gantt-axis-track">`;
    for (let age = Math.ceil(range.min / step) * step; age <= range.max; age += step) {
        ganttHtml += `<span class="wz-gantt-tick" style="left:${v2FlowPct(age, range).toFixed(2)}%">${age}</span>`;
    }
    ganttHtml += `</div></div>`;

    accounts.forEach((account) => {
        const list = phases.filter((phase) => phase.account === account);
        const starts = list.map((phase) => phase.accumulation_start_age).filter((value) => value != null);
        const accumStart = starts.length ? Math.min(...starts) : null;
        const firstStart = Math.min(...list.map((phase) => phase.start_age));
        const firstPhase = list[0];
        let bars = "";
        if (accumStart != null && firstStart > accumStart && accumStart >= range.min) {
            const left = v2FlowPct(accumStart, range);
            const width = v2FlowPct(firstStart, range) - left;
            const tipIdx = addTip(v2AccumulationTipHtml(input, firstPhase, accountName(account)));
            const accumEnd = firstPhase.accumulation_end_age ?? firstStart;
            const tipLabel = `Akumulacja ${accumStart}–${accumEnd} r.ż. — szczegóły`;
            bars += `<span class="wz-gantt-accum" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}"></span>`;
        }
        list.forEach((phase) => {
            const left = v2FlowPct(phase.start_age, range);
            const width = Math.max(0.8, v2FlowPct(phase.last_age + 1, range) - left);
            const short = Math.round(phase.avg_monthly_net).toLocaleString("pl-PL");
            const showUnit = width >= 11;
            const showAmount = width >= 7.5;
            const amountText = showUnit ? `${short} zł` : showAmount ? short : "";
            const label = `<span class="wz-gantt-phase-letter">${phase._flowLabel}</span>`
                + (amountText ? `<span class="wz-gantt-phase-value">${amountText}</span>` : "");
            const cls = showAmount ? "" : " is-index";
            const tipIdx = addTip(v2PhaseTipHtml(phase, accountName(account)));
            const tipLabel = `${accountName(account)}: faza ${phase._flowLabel}, ${phase.start_age}–${phase.last_age} r.ż., ${v2FlowMonthlyLabel(phase)} zł/mies. netto — szczegóły`;
            bars += `<span class="wz-gantt-phase${cls}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}">${label}</span>`;
        });
        ganttHtml += `<div class="wz-gantt-row"><span class="wz-gantt-label">${v2AccountIcon(account)}<span>${escapeHtml(account === "zus" ? "ZUS" : accountName(account))}</span></span><div class="wz-gantt-track">${bars}</div></div>`;
    });

    const payouts = (projection.phase_metrics || []).filter(
        (phase) => phase.cashflow === "payout" && phase.end_age > phase.start_age
    );
    if (payouts.length) {
        let totalBars = "";
        payouts.forEach((phase) => {
            const left = v2FlowPct(phase.start_age, range);
            const width = Math.max(0.8, v2FlowPct(phase.end_age, range) - left);
            const label = width >= 8
                ? `${Math.round(phase.monthly || 0).toLocaleString("pl-PL")} zł/mies.`
                : "";
            const tipIdx = addTip(v2TotalTipHtml(phase));
            const tipLabel = `${phase.name}: ${phase.start_age}–${phase.end_age} r.ż., ${Math.round(phase.monthly || 0).toLocaleString("pl-PL")} zł/mies. netto — szczegóły`;
            totalBars += `<span class="wz-gantt-phase is-total" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}">${label}</span>`;
        });
        ganttHtml += `<div class="wz-gantt-row wz-gantt-total"><span class="wz-gantt-label">Razem</span><div class="wz-gantt-track">${totalBars}</div></div>`;
    }
    gantt.innerHTML = ganttHtml;
    setupV2GanttTips(gantt, tips);

    const totalNote = v2El("v2FlowsTotal");
    if (totalNote) {
        const total = projection.total_withdrawn || 0;
        totalNote.textContent = total > 0 ? `Łącznie wypłacono netto: ${v2FmtZloty(total)} zł.` : "";
        totalNote.hidden = !(total > 0);
    }

    const rows = phases.map((phase) => {
        const account = accountName(phase.account);
        const period = `${phase.start_age}–${phase.last_age} r.ż. (${v2FormatYears(phase.years)})`;
        const health = Number(phase.total_health || 0);
        const pit = Number(phase.total_tax || 0);
        const lump = Number(phase.lump_tax || 0);
        let taxSub = "";
        if (lump > 0.5) {
            taxSub = Math.abs(pit - lump) < 0.5
                ? "jednorazowo"
                : `w tym ${v2FmtZloty(lump)} zł jednorazowo`;
        } else if (health > 0.5) {
            taxSub = pit > 0.5
                ? `PIT ${v2FmtZloty(pit)} zł + zdrowotna ${v2FmtZloty(health)} zł`
                : "zdrowotna 9%";
        }
        const tax = `<span class="wz-flow-tax-cell"><span class="wz-flow-tax-main">${v2FmtZloty(pit + health)} zł</span>${taxSub ? tipHtml(taxSub) : ""}</span>`;
        return `
            <tr>
                <td data-label="Konto">${escapeHtml(account)}</td>
                <td data-label="Okres">${escapeHtml(period)}</td>
                <td data-label="Średnio netto">${fmtMoney(phase.avg_monthly_net)} zł/mies.</td>
                <td data-label="Łącznie netto">${fmtMoney(phase.total_net)} zł</td>
                <td data-label="Podatki i składki">${tax}</td>
                <td data-label="Saldo końcowe">${fmtMoney(phase.ending_balance)} zł</td>
            </tr>`;
    }).join("");

    wrap.innerHTML = `
        <div class="wz-flows-table-wrap">
            <table class="wz-flows-table">
                <thead><tr><th>Konto</th><th>Okres</th><th>Średnio netto</th><th>Łącznie netto</th><th>Podatki i składki</th><th>Saldo końcowe</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="field-hint">Kwoty netto uwzględniają podatek, składkę zdrowotną i ewentualny podatek jednorazowy IKZE.</p>`;
}

function v2RenderPolicy(projection) {
    const note = v2El("v2PolicyNote");
    if (!note) return;
    const policy = projection?.withdrawal_policy || "";
    const early = policy.startsWith("early");
    const roi = policy.endsWith("_roi");
    let text = "Kolejność wypłat: najpierw konta dostępne bez kary, potem wcześniejsze z 19% "
        + "(IKE/PPK/PPE przed 60), na końcu IKZE przed 65 (skala).";
    text += early
        ? " W tym planie IKZE jest opodatkowane wcześniej, a IKE/PPK schodzą później."
        : " W tym planie nie wymuszamy wcześniejszego zwrotu IKZE — najpierw schodzą IKE/PPK i konta dostępne. Jeśli portfel nie wystarcza, silnik może odblokować IKZE wcześniej.";
    text += roi
        ? " W obrębie progu najpierw konta z niższym ROI."
        : " W obrębie progu wypłaty idą proporcjonalnie do sald.";
    note.textContent = text;
}

// --- Zakończenie i przejście do symulatora ----------------------------------

function v2Finish() {
    if (!v2Plan) return;
    v2SaveState();
    v2SavePlanCache();
    const activeInput = v2Plan.scenario_inputs?.[v2SelectedScenario] || v2Plan.input;
    const draft = {
        gender: activeInput.gender,
        config: activeInput.config,
        stages: activeInput.stages,
        withdrawal_policy: activeInput.withdrawal_policy || "defer_tier",
        source: "v2",
    };
    try {
        localStorage.setItem("fire.wizardDraft", JSON.stringify(draft));
    } catch {
        // Gdy localStorage jest pełny, przejście do symulatora nadal działa.
    }
    window.location.href = "/sim?wizard=1";
}

// --- Zdarzenia --------------------------------------------------------------

function v2Touch() {
    v2FormVersion += 1;
    v2Plan = null;
    v2PlanSignature = "";
    v2PlanBodyCache = null;
    v2InvalidateSuggestion();
    v2UpdateSavingsHint();
    if (v2CurrentStep === "strategia") v2ScheduleSuggestion();
    v2ScheduleStateSave();
}

function v2IsSalaryEvent(target) {
    if (!target) return false;
    if (V2_SALARY_IDS.has(target.id)) return true;
    if (V2_SALARY_NAMES.has(target.name)) return true;
    return false;
}

function v2IsEtatSalaryInput(target) {
    if (!target) return false;
    return ["v2EtatSalary", "v2EtatSalaryRange"].includes(target.id)
        || ["v2EtatSalaryMode", "v2EtatPeriod"].includes(target.name);
}

function v2SyncAllPanels() {
    v2SyncPathUI();
    v2SyncB2bRows();
    v2SyncZusBox();
    v2SyncOfeBox();
    v2SyncPayrollPrograms();
    v2SyncMortgageBox();
    v2SyncRealEstateBox();
    v2SyncFireStyle();
    v2UpdateSalaryLabels();
}

function v2BindEvents() {
    const wizard = document.querySelector(".wz-v2");
    if (!wizard) return;

    v2El("v2BackBtn")?.addEventListener("click", v2Back);
    v2El("v2NextBtn")?.addEventListener("click", v2Next);

    wizard.addEventListener("input", (event) => {
        const target = event.target;
        if (!target) return;
        if (target.name === "v2AllocationMode") return;
        if (target.matches?.(".v2-manual-share, .v2-manual-share-range")) {
            v2UpdateManualAllocationInput(target);
            return;
        }
        v2Touch();
        if (v2IsEtatSalaryInput(target)) v2SalaryTouched = true;
        if (["v2PpkEmployeePct", "v2PpkEmployerPct", "v2PpeEmployerPct"].includes(target.id)) {
            v2PayrollRatesTouched = true;
            v2UpdatePayrollRateSummaries();
        }
        if (target.id === "v2EtatSalary" || target.id === "v2EtatSalaryRange") {
            v2RememberMonthlySalary();
        }
        if (target.matches?.(".v2-cap-roi")) {
            const value = parseFloat(target.value);
            const defaultValue = parseFloat(target.dataset.defaultRoi);
            target.dataset.roiEdited = Number.isFinite(value)
                && (!Number.isFinite(defaultValue) || Math.abs(value - defaultValue) > 1e-9)
                ? "true"
                : "false";
            v2SyncRoiReset(target);
        }
        if (target.matches?.(".v2-cap-name")) {
            const row = target.closest(".v2-cap-row");
            const display = row?.querySelector(".v2-cap-name-display");
            if (display) display.textContent = target.value.trim() || row.dataset.defaultName;
        }
        if (v2IsSalaryEvent(target)) v2ScheduleSalaryPreview();
        if (target.name === "v2Path") v2SyncPathUI();
        if (target.name === "v2Employment") {
            v2ApplyDefaultSalary();
            v2UpdateSalaryLabels();
            v2SyncPayrollPrograms();
            v2ApplyEtatPeriod(false);
            v2ScheduleSalaryPreview();
        }
        if (target.name === "v2Gender") {
            const gender = v2Radio("v2Gender", "m");
            if (!v2RetirementTouched) {
                const retirement = V2_RETIREMENT_DEFAULT[gender] || V2_RETIREMENT_DEFAULT.m;
                v2SetValue("v2Retirement", retirement);
                v2SetValue("v2RetirementRange", retirement);
            }
            v2ApplyPlanEndDefault();
        }
        if (target.id === "v2Age" || target.id === "v2AgeRange") {
            v2ApplyPlanEndDefault();
            v2SyncAgeBounds();
        }
        if (target.name === "v2EtatSalaryMode") {
            v2UpdateSalaryLabels();
            v2ScheduleSalaryPreview();
        }
        if (target.name === "v2EtatPeriod") {
            v2ApplyEtatPeriod(true);
            v2ScheduleSalaryPreview();
        }
        if (target.name === "v2B2bTaxForm") v2SyncB2bRows();
        if (target.name === "v2B2bZusMode") v2SyncB2bRows();
        if (target.name === "v2B2bSalaryMode") v2UpdateSalaryLabels();
        if (target.name === "v2HasZusCap") v2SyncZusBox();
        if (target.name === "v2HasOfe") v2SyncOfeBox();
        if (target.name === "v2PpkState" || target.name === "v2PpeState") {
            v2SyncPayrollPrograms();
        }
        if (target.name === "v2HasMortgage") v2SyncMortgageBox();
        if (target.name === "v2HasRealEstate") v2SyncRealEstateBox();
        if (target.name === "v2FireStyle") v2SyncFireStyle();
        if (target.id === "v2Retirement" || target.id === "v2RetirementRange") {
            v2RetirementTouched = true;
            v2SyncAgeBounds();
        }
        if (target.id === "v2PlanEnd" || target.id === "v2PlanEndRange") {
            v2PlanEndTouched = true;
        }
        if (target.id === "v2Re" || target.id === "v2ReRange") v2SyncSemiBounds();
        if (target.id === "v2Savings" || target.id === "v2SavingsRange") {
            v2UpdateSavingsHint();
        }
    });

    wizard.addEventListener("change", (event) => {
        const target = event.target;
        if (!target) return;
        if (target.name === "v2AllocationMode") {
            v2SetAllocationMode(target.value);
            return;
        }
        if (target.matches?.(".v2-manual-share, .v2-manual-share-range")) {
            v2UpdateManualAllocationInput(target);
            return;
        }
        v2Touch();

        if (v2IsEtatSalaryInput(target)) v2SalaryTouched = true;
        if (target.name === "v2EtatSalaryMode" || target.name === "v2B2bSalaryMode") {
            v2ApplySalaryModeConversion();
        }
        if (v2IsSalaryEvent(target)) {
            v2UpdateSalaryLabels();
            v2ScheduleSalaryPreview();
        }
        if (target.name === "v2EtatPeriod") {
            v2ApplyEtatPeriod(true);
            v2ScheduleSalaryPreview();
        }
        if (target.name === "v2Path") {
            v2SyncPathUI();
            v2SyncSemiBounds();
        }
        if (target.name === "v2B2bTaxForm" || target.name === "v2B2bZusMode") {
            v2SyncB2bRows();
        }
        if (target.name === "v2HasZusCap") v2SyncZusBox();
        if (target.name === "v2HasOfe") v2SyncOfeBox();
        if (target.name === "v2PpkState" || target.name === "v2PpeState") {
            v2SyncPayrollPrograms();
        }
        if (target.name === "v2HasMortgage") v2SyncMortgageBox();
        if (target.name === "v2HasRealEstate") v2SyncRealEstateBox();
        if (target.name === "v2Employment") {
            v2ApplyDefaultSalary();
            v2UpdateSalaryLabels();
            v2SyncPayrollPrograms();
            v2ScheduleSalaryPreview();
            const order = v2StepOrder();
            if (!order.includes(v2CurrentStep)) {
                v2ShowStep("profil");
            } else if (v2CurrentStep === "etat" || v2CurrentStep === "b2b") {
                v2ShowStep(v2Employment() === "b2b" ? "b2b" : "etat");
            }
        }
        if (target.name === "v2FireStyle") v2SyncFireStyle();
    });

    wizard.addEventListener("keydown", (event) => {
        const input = event.target.closest?.(".v2-cap-name");
        if (!input) return;
        if (event.key === "Enter") {
            event.preventDefault();
            input.closest(".v2-cap-row")?.querySelector(".v2-cap-name-save")?.click();
        } else if (event.key === "Escape") {
            const row = input.closest(".v2-cap-row");
            const display = row?.querySelector(".v2-cap-name-display");
            if (row && display) {
                input.value = display.textContent || row.dataset.defaultName;
                row.querySelector(".v2-cap-name-edit")?.classList.add("hidden");
                row.querySelector(".v2-cap-name-edit-btn")?.classList.remove("hidden");
                input.blur();
            }
        }
    });

    wizard.addEventListener("click", (event) => {
        const showAll = event.target.closest("#v2StrategyShowAll");
        if (showAll) {
            v2StrategyExpanded = !v2StrategyExpanded;
            v2RenderStrategyPreviews();
            return;
        }
        const editName = event.target.closest(".v2-cap-name-edit-btn");
        if (editName) {
            const row = editName.closest(".v2-cap-row");
            const nameEdit = row?.querySelector(".v2-cap-name-edit");
            const nameInput = nameEdit?.querySelector(".v2-cap-name");
            if (nameEdit && nameInput) {
                nameInput.value = row.dataset.defaultName === row.querySelector(".v2-cap-name-display")?.textContent
                    ? row.dataset.defaultName
                    : row.querySelector(".v2-cap-name-display")?.textContent || row.dataset.defaultName;
                nameEdit.classList.remove("hidden");
                editName.classList.add("hidden");
                nameInput.focus();
                nameInput.select();
            }
            return;
        }
        const saveName = event.target.closest(".v2-cap-name-save");
        if (saveName) {
            const row = saveName.closest(".v2-cap-row");
            row?.querySelector(".v2-cap-name-edit")?.classList.add("hidden");
            row?.querySelector(".v2-cap-name-edit-btn")?.classList.remove("hidden");
            v2Touch();
            return;
        }
        const roiReset = event.target.closest(".v2-cap-roi-reset");
        if (roiReset) {
            const input = roiReset.closest(".v2-field")?.querySelector(".v2-cap-roi");
            if (input) {
                const defaultValue = input.dataset.defaultRoi || "";
                input.value = defaultValue;
                input.dataset.roiEdited = "false";
                v2SyncRoiReset(input);
                v2Touch();
            }
            return;
        }
        const addMulti = event.target.closest(".v2-add-multi");
        if (addMulti) {
            v2AddMulti(addMulti.dataset.base);
            return;
        }
        const addSingle = event.target.closest(".v2-add-single");
        if (addSingle) {
            v2ToggleSingle(addSingle.dataset.account);
            return;
        }
        const remove = event.target.closest(".v2-cap-remove");
        if (remove) {
            const row = remove.closest(".v2-cap-row");
            const account = row?.dataset.account;
            row?.remove();
            if (account && V2_SHELTERS.some((shelter) => shelter.account === account)) {
                v2RefreshShelterPicker();
            }
            v2SyncSingleButtons();
            v2SyncMultiAddButtons();
            v2Touch();
            return;
        }
        const retry = event.target.closest("[data-v2-retry-suggest]");
        if (retry) {
            v2RefreshSuggestion();
            return;
        }
        const scenario = event.target.closest("#v2ScenariosBox .wz-scenario-card");
        if (scenario && v2Plan) {
            v2SelectedScenario = scenario.dataset.scenario;
            v2RenderResult(v2Plan);
            v2SavePlanCache();
        }
    });
}

function v2CollectFormState() {
    const fields = [];
    document.querySelectorAll(".wz-v2 input, .wz-v2 select, .wz-v2 textarea").forEach((el) => {
        if (el.closest(".v2-cap-row")) return;
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

function v2CollectCapitalState() {
    return [...document.querySelectorAll(
        "#v2SheltersList .v2-cap-row, #v2SafeList .v2-cap-row, #v2MarketList .v2-cap-row"
    )].map((row) => {
        const roi = row.querySelector(".v2-cap-roi");
        return {
            account: row.dataset.account,
            amount: row.querySelector(".v2-cap-amount")?.value || "0",
            roi: roi?.value || "",
            roiEdited: roi?.dataset.roiEdited === "true",
            name: row.querySelector(".v2-cap-name")?.value || "",
            displayName: row.querySelector(".v2-cap-name-display")?.textContent || "",
        };
    });
}

function v2SaveState() {
    if (!v2StateReady || v2Restoring) return;
    clearTimeout(v2StateTimer);
    const state = {
        step: v2CurrentStep,
        fields: v2CollectFormState(),
        rows: v2CollectCapitalState(),
        allocationMode: v2AllocationMode,
        manualAllocations: v2ManualAllocations,
        suggested: v2Suggested,
        suggestSignature: v2SuggestSignature,
        selectedScenario: v2SelectedScenario,
        retirementTouched: v2RetirementTouched,
        planEndTouched: v2PlanEndTouched,
        salaryTouched: v2SalaryTouched,
        payrollRatesTouched: v2PayrollRatesTouched,
        longevityGrowth: v2LongevityGrowth,
        salaryPreview: v2SalaryPreview,
        etatPeriodPrev: v2EtatPeriodPrev,
    };
    try {
        localStorage.setItem(V2_STATE_KEY, JSON.stringify(state));
    } catch {
        // Brak miejsca w localStorage nie może blokować kreatora.
    }
}

function v2ScheduleStateSave() {
    if (!v2StateReady || v2Restoring) return;
    clearTimeout(v2StateTimer);
    v2StateTimer = setTimeout(v2SaveState, V2_STATE_SAVE_MS);
}

function v2SavePlanCache() {
    if (!v2Plan) return;
    const body = v2PlanBodyCache || v2PlanBody();
    try {
        localStorage.setItem(V2_PLAN_KEY, JSON.stringify({
            plan: v2Plan,
            body,
            path: v2CurrentPath(),
            signature: v2PlanSignature || v2CanonicalJson(body),
            selectedScenario: v2SelectedScenario,
        }));
    } catch {
        // Gdy localStorage jest pełny, powrót po prostu pominie cache planu.
    }
}

function v2RestoreFormState(fields) {
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

function v2CapitalListId(account) {
    if (V2_SHELTERS.some((shelter) => shelter.account === account)) return "v2SheltersList";
    if (V2_SAFE_BASES.includes(v2BaseKey(account))) return "v2SafeList";
    return "v2MarketList";
}

function v2CapitalRowAllowsName(account) {
    return !V2_SHELTERS.some((shelter) => shelter.account === account)
        && account !== "oki_inw"
        && account !== "oki_osk";
}

function v2RestoreCapitalState(rows) {
    ["v2SheltersList", "v2SafeList", "v2MarketList"].forEach((id) => {
        const list = v2El(id);
        if (list) list.innerHTML = "";
    });
    rows.forEach((saved) => {
        const account = saved.account;
        if (!account) return;
        const row = v2BuildCapRow(account, {
            name: v2CapitalRowAllowsName(account),
            roi: true,
        });
        const amount = row.querySelector(".v2-cap-amount");
        if (amount) amount.value = saved.amount ?? "0";
        const roi = row.querySelector(".v2-cap-roi");
        if (roi) {
            roi.value = saved.roi ?? "";
            roi.dataset.roiEdited = saved.roiEdited ? "true" : "false";
            v2SyncRoiReset(roi);
        }
        const name = saved.name || saved.displayName || row.dataset.defaultName;
        const nameInput = row.querySelector(".v2-cap-name");
        const nameDisplay = row.querySelector(".v2-cap-name-display");
        if (nameInput) nameInput.value = name;
        if (nameDisplay) nameDisplay.textContent = name;
        v2El(v2CapitalListId(account))?.appendChild(row);
    });
    v2RefreshShelterPicker();
    v2SyncSingleButtons();
    v2SyncMultiAddButtons();
}

function v2ReadCachedPlan(allowLegacy = true) {
    let raw = null;
    try {
        raw = localStorage.getItem(V2_PLAN_KEY);
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

    const body = v2PlanBody();
    const signature = v2CanonicalJson(body);
    if (stored.body) {
        if (v2CanonicalJson(stored.body) !== signature) return null;
    } else if (!allowLegacy || Number(stored.path || 1) !== v2CurrentPath()) {
        return null;
    }
    return { stored, body, signature };
}

function v2MigratePayrollState(state) {
    const fields = state?.fields || [];
    const hasPpkState = fields.some((field) => field.name === "v2PpkState");
    const hasPpeState = fields.some((field) => field.name === "v2PpeState");
    const fieldValue = (id) => fields.find((field) => field.id === id)?.value;
    const fieldChecked = (id) => Boolean(fields.find((field) => field.id === id)?.checked);
    if (!hasPpkState) {
        const balance = parseFloat(fieldValue("v2PpkBalance")) || 0;
        const next = fieldChecked("v2UsePpk") ? "active" : (balance > 0 ? "paused" : "never");
        const radio = document.querySelector(`input[name="v2PpkState"][value="${next}"]`);
        if (radio) radio.checked = true;
    }
    if (!hasPpeState) {
        const balance = parseFloat(fieldValue("v2PpeBalance")) || 0;
        const next = fieldChecked("v2UsePpe") ? "active" : (balance > 0 ? "paused" : "never");
        const radio = document.querySelector(`input[name="v2PpeState"][value="${next}"]`);
        if (radio) radio.checked = true;
    }
}

function v2RestoreIfRequested() {
    const params = new URLSearchParams(window.location.search || "");
    if (!params.get("restore")) return false;

    let state = null;
    try {
        const rawState = localStorage.getItem(V2_STATE_KEY);
        if (rawState) state = JSON.parse(rawState);
    } catch {
        state = null;
    }

    v2Restoring = true;
    if (state) {
        try {
            v2RestoreFormState(state.fields || []);
            v2MigratePayrollState(state);
            v2RestoreCapitalState(state.rows || []);
            v2ApplyDefaultAccountRois();
            v2AllocationMode = state.allocationMode === "manual" ? "manual" : "auto";
            v2ManualAllocations = state.manualAllocations || null;
            v2Suggested = state.suggested || null;
            v2SuggestSignature = state.suggestSignature || "";
            v2SelectedScenario = state.selectedScenario || "realne";
            v2RetirementTouched = Boolean(state.retirementTouched);
            v2PlanEndTouched = Boolean(state.planEndTouched);
            v2SalaryTouched = state.salaryTouched == null
                ? true
                : Boolean(state.salaryTouched);
            v2PayrollRatesTouched = Boolean(state.payrollRatesTouched);
            if (Number.isFinite(Number(state.longevityGrowth))) {
                v2LongevityGrowth = Number(state.longevityGrowth);
            }
            v2SalaryPreview = state.salaryPreview || null;
            v2EtatPeriodPrev = state.etatPeriodPrev || v2EtatPeriod();
            v2SyncAllPanels();
            v2ApplyEtatPeriod(false);
            v2EtatPeriodPrev = v2EtatPeriod();
            v2UpdateSalaryLabels();
            v2UpdateSavingsHint();
            v2UpdateAllocationModeControl();
        } catch {
            state = null;
        }
    }
    v2Restoring = false;

    const cached = v2ReadCachedPlan(!state);
    if (cached) {
        v2Plan = cached.stored.plan;
        v2PlanBodyCache = cached.body;
        v2PlanSignature = cached.signature;
        v2SelectedScenario = cached.stored.selectedScenario || v2SelectedScenario || "realne";
        v2ShowStep("wynik", true);
        return true;
    }

    if (state) {
        const step = state.step === "wynik" ? "strategia" : state.step;
        v2ShowStep(step || "cel", true);
        return true;
    }
    return false;
}

function v2Init() {
    if (v2Initialized) return;
    v2Initialized = true;

    const scope = document.querySelector(".wz-v2") || document;
    if (typeof initTipAnchoring === "function") initTipAnchoring();
    v2InitPayrollRateControls();
    initNumControls(scope);

    const ranges = [
        ["v2AgeRange", "v2Age"],
        ["v2EtatSalaryRange", "v2EtatSalary"],
        ["v2PpkBalanceRange", "v2PpkBalance"],
        ["v2PpeBalanceRange", "v2PpeBalance"],
        ["v2B2bCustomZusRange", "v2B2bCustomZus"],
        ["v2B2bSalaryRange", "v2B2bSalary"],
        ["v2ZusBalanceRange", "v2ZusBalance"],
        ["v2OfeBalanceRange", "v2OfeBalance"],
        ["v2SavingsRange", "v2Savings"],
        ["v2MortgageMonthlyRange", "v2MortgageMonthly"],
        ["v2MortgageEndAgeRange", "v2MortgageEndAge"],
        ["v2ReValueRange", "v2ReValue"],
        ["v2ReRentRange", "v2ReRent"],
        ["v2ReLiqAgeRange", "v2ReLiqAge"],
        ["v2TargetRange", "v2Target"],
        ["v2SemiAgeRange", "v2SemiAge"],
        ["v2SemiNetRange", "v2SemiNet"],
        ["v2SemiSavingsRange", "v2SemiSavings"],
        ["v2ReRange", "v2Re"],
        ["v2RetirementRange", "v2Retirement"],
        ["v2PlanEndRange", "v2PlanEnd"],
    ];
    ranges.forEach(([rangeId, inputId]) => v2SyncRange(rangeId, inputId));

    v2BuildShelterPicker();
    v2InitCapitalAddButtons();
    v2SyncSingleButtons();
    v2SyncMultiAddButtons();
    v2BindEvents();
    v2UpdateAllocationModeControl();
    v2LoadAccountConfig();
    v2SyncAllPanels();
    v2ApplyEtatPeriod(false);
    v2ApplyPlanEndDefault();
    v2ApplyDefaultSalary();
    v2EtatPeriodPrev = v2EtatPeriod();
    v2UpdateSavingsHint();
    v2ShowStep("cel");

    // Pierwszy podgląd pensji jest opóźniony, żeby nie konkurować z renderingiem.
    setTimeout(v2ScheduleSalaryPreview, 150);

    v2RestoreIfRequested();
    v2StateReady = true;
    v2SaveState();
}

document.addEventListener("DOMContentLoaded", v2Init);
