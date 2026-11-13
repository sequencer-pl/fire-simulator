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
let wzLoaderTimer = null;
let wzLoaderTipBag = [];
let wzLoaderLastTip = "";
let wzStateReady = false;
let wzRestoring = false;
let wzStateTimer = null;

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
    const suggested = wzSuggested?.allocations || {};
    const seeded = Object.fromEntries(
        WZ_ALLOCATABLE_ACCOUNTS.map((account) => [account, Number(suggested[account]) || 0])
    );
    wzManualAllocations = wzNormalizeManualShares(seeded, { exact: true });
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
    const base = Number(wzAccountConfig?.zus?.b2b_base_monthly);
    if (!Number.isFinite(base) || base <= 0) return;
    const label = document.querySelector(".wz-b2b-zus-label");
    if (label) {
        label.textContent = `Duży ZUS (podstawa ${Math.round(base).toLocaleString("pl-PL")} zł)`;
    }
    const custom = wzEl("wzB2bCustomZus");
    if (custom) {
        const current = parseFloat(custom.value);
        if (!Number.isFinite(current) || Math.abs(current - 5652) < 1) {
            custom.value = String(Math.round(base));
            wzSetValue("wzB2bCustomZusRange", Math.round(base));
        }
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

function wzShowStep(stepId, focus = false) {
    const order = wzStepOrder();
    const id = order.includes(stepId) ? stepId : order[0];
    wzCurrentStep = id;

    document.querySelectorAll(".wz-step").forEach((el) => {
        el.classList.toggle("hidden", el.dataset.stepId !== id);
    });

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

    if (id === "strategia") wzRefreshSuggestion();
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
    if (wzCurrentStep === "strategia") {
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
        exportBtn.classList.toggle(
            "hidden",
            !(wzCurrentStep === "wynik" && planReady && !wzPlanLoading)
        );
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

    if (wzCurrentStep === "strategia") {
        const body = wzPlanBody();
        if (wzPlan && wzPlanSignature === wzCanonicalJson(body)) {
            wzShowStep("wynik", true);
            return;
        }
        wzShowStep("wynik", true);
        wzRunPlan();
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
        const next = Math.min(90, age + 5);
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

    const max = annual ? 1_200_000 : 100_000;
    const step = annual ? 1_000 : 250;
    input.max = String(max);
    input.step = String(step);
    if (range) {
        range.max = String(max);
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
        body.b2b_custom_zus_base = wzNum("wzB2bCustomZus", 5652);
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
    const ppkState = etat ? wzPayrollState("wzPpkState") : "paused";
    const ppeState = etat ? wzPayrollState("wzPpeState") : "paused";
    const ppkBalance = etat && ppkState === "never" ? 0 : wzNum("wzPpkBalance", 0);
    const ppeBalance = etat && ppeState === "never" ? 0 : wzNum("wzPpeBalance", 0);
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
        retirement_age: wzInt("wzRetirement", 65),
        plan_end_age: wzInt("wzPlanEnd", 85),
        savings: path === 2 ? 0 : wzNum("wzSavings", 0),
        strategy: wzRadio("wzStrategy", "zbilansowana"),
        assumptions: "realne",
    };

    if (employment === "b2b") {
        answers.b2b_tax_form = wzRadio("wzB2bTaxForm", "ryczalt");
        answers.b2b_lump_rate = parseFloat(wzRadio("wzB2bLumpRate", "0.12"));
        answers.b2b_zus_mode = wzRadio("wzB2bZusMode", "duzy");
        answers.b2b_custom_zus_base = wzNum("wzB2bCustomZus", 5652);
    }

    const config = wzAnonymousConfig();
    if (config) answers.base_config = config;
    if (withAllocations && wzSuggested) {
        answers.allocations = Object.fromEntries(
            Object.entries(wzCurrentAllocations())
                .filter(([, share]) => Number(share) > 0)
                .map(([account, share]) => [account, Number(share)])
        );
    }
    return answers;
}

function wzPlanBody() {
    const path = wzCurrentPath();
    const body = { path, answers: wzCollectAnswers() };
    if (path !== 1) body.target_monthly = wzNum("wzTarget", 0);
    return body;
}

// --- Walidacja --------------------------------------------------------------

function wzValidateStep(stepId) {
    const age = wzInt("wzAge", 40);
    const path = wzCurrentPath();

    if (stepId === "profil") {
        if (age < 16 || age > 90) {
            alert("Podaj wiek z zakresu 16–90 lat.");
            return false;
        }
    }

    if (stepId === "etat" && wzMonthlySalaryValue() <= 0) {
        alert("Podaj kwotę pensji większą od zera.");
        return false;
    }

    if (stepId === "b2b" && wzMonthlySalaryValue() <= 0) {
        alert("Podaj miesięczny przychód z działalności większy od zera.");
        return false;
    }

    if (stepId === "oszczednosci") {
        if (path !== 2 && wzNum("wzSavings", 0) < 0) {
            alert("Kwota oszczędności nie może być ujemna.");
            return false;
        }
        if (wzRadio("wzHasMortgage", "no") === "yes") {
            if (wzNum("wzMortgageMonthly", 0) <= 0) {
                alert("Podaj miesięczną ratę kredytu hipotecznego.");
                return false;
            }
            if (wzInt("wzMortgageEndAge", 0) <= age) {
                alert("Wiek końca spłaty kredytu musi być późniejszy niż obecny wiek.");
                return false;
            }
        }
    }

    if (stepId === "kapital" && wzRadio("wzHasRealEstate", "no") === "yes") {
        if (wzNum("wzReValue", 0) <= 0) {
            alert("Podaj wartość rynkową nieruchomości inwestycyjnej.");
            return false;
        }
        const liq = wzInt("wzReLiqAge", 0);
        if (liq > 0 && liq <= age) {
            alert("Wiek sprzedaży nieruchomości musi być późniejszy niż obecny wiek (albo 0 = nie sprzedawaj).");
            return false;
        }
    }

    if (stepId === "sabbatical") {
        if (path !== 1 && wzNum("wzTarget", 0) <= 0) {
            alert("Podaj docelową wypłatę miesięczną netto.");
            return false;
        }

        const retirement = wzInt("wzRetirement", 65);
        const planEnd = wzInt("wzPlanEnd", 85);
        if (planEnd <= retirement) {
            alert("Horyzont planu musi być późniejszy niż wiek rozpoczęcia emerytury ZUS.");
            return false;
        }

        if (path !== 3) {
            const re = wzInt("wzRe", 55);
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

        const style = wzRadio("wzFireStyle", "full");
        if (style === "coast" || style === "barista") {
            const semiAge = wzInt("wzSemiAge", 48);
            if (semiAge <= age) {
                alert("Wiek przejścia na część etatu musi być późniejszy niż obecny wiek.");
                return false;
            }
            const semiUpper = path === 3 ? retirement : wzInt("wzRe", 55);
            if (semiAge >= semiUpper) {
                alert(path === 3
                    ? "Wiek przejścia na część etatu musi być wcześniejszy niż wiek emerytury ZUS."
                    : "Wiek przejścia na część etatu musi być wcześniejszy niż wiek pełnego FIRE.");
                return false;
            }
            if (wzNum("wzSemiNet", 0) <= 0) {
                alert("Podaj miesięczne zarobki netto na części etatu.");
                return false;
            }
        }
    }

    if (stepId === "strategia") {
        if (!wzSuggested || wzSuggestLoading) {
            alert("Poczekaj na wyliczenie propozycji podziału oszczędności, a potem przejdź dalej.");
            return false;
        }
        const allocations = wzCurrentAllocations();
        const total = Object.values(allocations).reduce((sum, value) => sum + (value || 0), 0);
        if (total > 100 + 1e-6) {
            alert("Suma udziałów nie może przekraczać 100%. Zmniejsz wybrane wartości.");
            return false;
        }
        if (total <= 0 && wzManualAllocationPoolMonthly() > 0) {
            alert("Nie udało się zaproponować podziału oszczędności. Spróbuj ponownie.");
            return false;
        }
    }

    return true;
}

// --- Propozycja podziału ----------------------------------------------------

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

function wzRenderManualAllocation() {
    const box = wzEl("wzSuggestList");
    if (!box || !wzSuggested) return;
    wzSeedManualAllocations();
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
                        <span class="wz-manual-alloc-name" role="rowheader">${wzAccountIcon(account)}${escapeHtml(wzAccountLabel(account))}</span>
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
    shares = wzNormalizeManualShares(shares);
    wzManualAllocations = { ...shares };
    const pool = wzManualAllocationPoolMonthly();
    const poolAnnual = pool * 12;
    const totalShare = Object.values(shares).reduce(
        (sum, share) => sum + (Number(share) || 0),
        0
    );

    const allocations = WZ_ALLOCATABLE_ACCOUNTS.map((account) => {
        const share = Math.max(0, Number(shares[account]) || 0);
        const others = Math.max(0, totalShare - share);
        const max = Math.max(0, 100 - others);
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
            overCap: cap > 0 && requestedAnnual > cap + 0.01,
        };
    });

    let allocatedAnnual = allocations.reduce((sum, item) => sum + item.allocated, 0);
    let cashAnnual = Math.max(0, poolAnnual - allocatedAnnual);
    const overCapAny = allocations.some((item) => item.overCap);

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

    allocations.forEach(({ account, cap, allocated, overCap }) => {
        const row = document.querySelector(`.wz-manual-alloc-row[data-account="${account}"]`);
        if (!row) return;
        row.querySelector(".wz-manual-monthly").textContent = `${fmtMoney(allocated / 12)}/mies.`;
        row.querySelector(".wz-manual-annual").textContent = `${fmtMoney(allocated)}/rok`;
        const capNote = row.querySelector(".wz-manual-cap-note");
        capNote.hidden = !overCap;
        if (overCap) {
            capNote.textContent = cashAnnual > 0.5
                ? `Limit roczny ${fmtMoney(cap)} — nadwyżka w gotówce`
                : `Limit roczny ${fmtMoney(cap)} — reszta doliczona do innego konta`;
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
        sumBox.innerHTML = `<span class="chip ${chipClass}">${complete && !cashPositive ? iconSvg("check") : ""}Suma udziałów: ${wzFormatAllocationShare(totalShare)}%${extra}</span>`;
    }
    const note = wzEl("wzTaxTipNote");
    if (note) note.textContent = "";
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
        const others = Object.entries(shares)
            .filter(([key]) => key !== account)
            .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
        const max = Math.max(0, 100 - others);
        const current = Math.max(0, Math.min(max, parseFloat(input.value) || 0));
        input.value = wzManualShareAttr(current);
        const pairedRange = wzManualShareRange(account);
        if (pairedRange) pairedRange.value = input.value;
    }
    wzManualAllocations = wzManualAllocationShares();
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
        return `
            <div class="wz-suggest-row">
                <span class="wz-suggest-icon">${wzAccountIcon(account)}</span>
                <span class="wz-suggest-name">${escapeHtml(wzAccountLabel(account))}</span>
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
    if (tip) tip.textContent = wzNextLoaderTip();
}

async function wzRunPlan() {
    if (wzPlanLoading) return;
    if (!wzValidateStep("sabbatical") || !wzValidateStep("strategia")) return;

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
            errorBox.innerHTML = `${iconSvg("danger")}<div class="banner-body">${escapeHtml(err.message)}</div>`;
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

function wzRenderResult(data) {
    const result = wzEl("wzResult");
    if (!result || !data) return;
    result.classList.remove("hidden");
    wzEl("wzResultError")?.classList.add("hidden");
    const active = wzActiveScenarioData(data);
    wzRenderHero(data);
    wzRenderScenarios(data);
    wzRenderMetrics(active.projection);
    wzRenderFacts(active.projection);
    wzRenderWarnings(active.projection?.warnings || []);
    wzRenderTimeline(active.input, active.projection);
    wzRenderPhaseTable(active.projection);
    wzRenderStageSummary(active.input, active.projection);
    wzRenderAccountFlows(active.input, active.projection);
    wzRenderPolicy(active.projection);
}

function wzRenderHero(data) {
    const box = wzEl("wzHeroAnswer");
    if (!box) return;
    const fmt = (value) => (value == null ? "—" : Math.round(value).toLocaleString("pl-PL"));
    const path = data.path || wzCurrentPath();
    const { projection: proj, solved, input } = wzActiveScenarioData(data);
    const scenarioLabel = data.scenarios?.[wzSelectedScenario]?.label || "";
    const kicker = `Odpowiedź Asystenta${scenarioLabel ? ` · ${scenarioLabel}` : ""}`;

    box.classList.toggle("is-warn", !solved.feasible || !proj.met);

    if (path === 1) {
        const payout = proj.min_monthly || 0;
        const reAge = solved.retire_early_age ?? input?.retire_early_age ?? wzInt("wzRe", 55);
        const endAge = input?.plan_end_age ?? wzInt("wzPlanEnd", 85);
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
        const target = proj.target_monthly || wzNum("wzTarget", 0);
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

    const target = proj.target_monthly || wzNum("wzTarget", 0);
    const re = solved.retire_early_age;
    const ageNow = input?.age_now ?? wzInt("wzAge", 40);
    if (solved.feasible && re != null) {
        const yearsLeft = Math.max(0, re - ageNow);
        box.innerHTML = `
            <div class="wz-hero-kicker">${escapeHtml(kicker)} · Kiedy możesz przestać pracować</div>
            <div class="wz-hero-headline">W wieku ${re} lat (za ${yearsLeft} ${wzFormatYears(yearsLeft)})</div>
            <div class="wz-hero-desc">To najwcześniejszy wiek przejścia na FIRE z gwarancją wypłaty co najmniej <strong>${fmt(target)} zł/mies. netto</strong>.</div>`;
    } else {
        box.innerHTML = `
            <div class="wz-hero-kicker">${escapeHtml(kicker)} · Kiedy możesz przestać pracować</div>
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

    let html = `<h3 class="eyebrow wz-panel-title">${tipLabelHtml("Scenariusze rynkowe", "Konserwatywne: wyższa inflacja, niższe ROI i słabsza waloryzacja ZUS. Realne: Twoja konfiguracja bazowa. Optymistyczne: niższa inflacja, wyższe ROI i mocniejsza waloryzacja. Kliknij kartę, aby ustawić scenariusz główny.")}</h3><div class="wz-scenarios-grid">`;
    keys.forEach((key) => {
        const scenario = scenarios[key];
        const selected = key === wzSelectedScenario;
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

function wzRenderMetrics(projection) {
    const box = wzEl("wzMetrics");
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

function wzRenderFacts(projection) {
    const box = wzEl("wzFacts");
    if (!box) return;
    const fmt = (value) => Math.round(value || 0).toLocaleString("pl-PL");
    const facts = [];

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

function wzPhaseSplit(phase) {
    if (!phase || phase.cashflow === "contribution") return "";
    const parts = [];
    if (phase.portfolio_monthly > 0) parts.push(`portfel ${Math.round(phase.portfolio_monthly).toLocaleString("pl-PL")}`);
    if (phase.zus_monthly > 0) parts.push(`ZUS ${Math.round(phase.zus_monthly).toLocaleString("pl-PL")}`);
    return parts.join(" + ");
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
        ordered.forEach((phase) => {
            const leftPct = ((phase.start_age - min) / width) * 100;
            const spanPct = Math.max(2, ((phase.end_age - phase.start_age) / width) * 100);
            const isAccum = phase.cashflow === "contribution";
            const split = wzPhaseSplit(phase);
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

function wzStageMetricFor(metrics, stage, index) {
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

function wzRenderPhaseTable(projection) {
    const box = wzEl("wzPhaseTable");
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
            const components = isAccum ? "wpłaty do portfela" : (wzPhaseSplit(phase) || "—");
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

function wzRenderStageSummary(input, projection) {
    const box = wzEl("wzStageSummaryList");
    if (!box || !input || !Array.isArray(input.stages)) return;
    const metrics = projection?.stage_metrics || [];
    box.innerHTML = "";
    input.stages.forEach((stage, index) => {
        const isAccum = stage.stage_type === "akumulacja";
        const kind = isAccum ? "accum" : "withdraw";
        const accounts = stage.accounts || {};
        const accountKeys = Object.keys(accounts);
        const zusOnly = !isAccum && accountKeys.length === 1 && accountKeys[0] === "zus";
        const metric = wzStageMetricFor(metrics, stage, index);
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
                return `<span class="chip">${escapeHtml(wzAccountLabel(key, customName))}</span>`;
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

function wzFlowsRange(input, phases, compact = false) {
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

function wzGanttTipShow(anchor, pin = false) {
    const html = wzGanttTips[Number(anchor.dataset.tipId)];
    const tip = wzEl("wzGanttTip");
    const body = wzEl("wzGanttTipBody");
    if (!html || !tip || !body) return;
    wzGanttTipCancelShow();
    body.innerHTML = html;
    tip.classList.remove("hidden");
    wzGanttActive = anchor;
    wzGanttPinned = pin;
    requestAnimationFrame(wzGanttTipPlace);
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

    const tax = (phase.total_tax || 0) + (phase.total_health || 0);
    const parts = [];
    if (phase.total_tax > 0.5) parts.push(`PIT ${wzFmtZloty(phase.total_tax)} zł`);
    if (phase.total_health > 0.5) parts.push(`zdrowotna ${wzFmtZloty(phase.total_health)} zł`);
    if (phase.lump_tax > 0.5) parts.push(`jednorazowo ${wzFmtZloty(phase.lump_tax)} zł`);
    rows.push(wzGanttTipRow("Podatki i składki", `${wzFmtZloty(tax)} zł`, parts.join(" · ")));

    const subtitle = `Faza ${phase._flowLabel} · ${phase.start_age}–${phase.last_age} r.ż. · ${wzFormatYears(phase.years)}`;
    return wzGanttTipPanel(accountLabel, subtitle, rows);
}

function wzTotalTipHtml(phase) {
    const years = Math.max(0, phase.end_age - phase.start_age);
    const rows = [];
    rows.push(wzGanttTipRow("Miesięcznie netto", `${wzFmtZloty(phase.monthly || 0)} zł`));
    rows.push(wzGanttTipRow("Okres", `${phase.start_age}–${phase.end_age} r.ż.`, wzFormatYears(years)));
    if (phase.portfolio_monthly > 0.5) {
        rows.push(wzGanttTipRow("w tym portfel", `${wzFmtZloty(phase.portfolio_monthly)} zł/mies.`));
    }
    if (phase.zus_monthly > 0.5) {
        rows.push(wzGanttTipRow("w tym ZUS", `${wzFmtZloty(phase.zus_monthly)} zł/mies.`));
    }
    rows.push(wzGanttTipRow(
        "Razem netto (≈)",
        `${wzFmtZloty((phase.monthly || 0) * years * 12)} zł`
    ));
    return wzGanttTipPanel(phase.name || "Razem", "Wypłaty łączne", rows);
}

function wzRenderAccountFlows(input, projection) {
    const wrap = wzEl("wzAccountFlows");
    const gantt = wzEl("wzFlowsGantt");
    const flowsWrap = wzEl("wzFlowsWrap");
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
    const range = wzFlowsRange(input, phases, compact);
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

    const accounts = [...new Set(phases.map((phase) => phase.account))];
    const step = range.max - range.min <= 20 ? 2 : 5;
    let ganttHtml = `<div class="wz-gantt-axis"><span class="wz-gantt-axis-label">Konto</span><div class="wz-gantt-axis-track">`;
    for (let age = Math.ceil(range.min / step) * step; age <= range.max; age += step) {
        ganttHtml += `<span class="wz-gantt-tick" style="left:${wzFlowPct(age, range).toFixed(2)}%">${age}</span>`;
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
            const left = wzFlowPct(accumStart, range);
            const width = wzFlowPct(firstStart, range) - left;
            const tipIdx = addTip(wzAccumulationTipHtml(input, firstPhase, accountName(account)));
            const accumEnd = firstPhase.accumulation_end_age ?? firstStart;
            const tipLabel = `Akumulacja ${accumStart}–${accumEnd} r.ż. — szczegóły`;
            bars += `<span class="wz-gantt-accum" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}"></span>`;
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
            const tipLabel = `${phase.name}: ${phase.start_age}–${phase.end_age} r.ż., ${Math.round(phase.monthly || 0).toLocaleString("pl-PL")} zł/mies. netto — szczegóły`;
            totalBars += `<span class="wz-gantt-phase is-total" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}">${label}</span>`;
        });
        ganttHtml += `<div class="wz-gantt-row wz-gantt-total"><span class="wz-gantt-label">Razem</span><div class="wz-gantt-track">${totalBars}</div></div>`;
    }
    gantt.innerHTML = ganttHtml;
    setupGanttTips(gantt, tips);

    const totalNote = wzEl("wzFlowsTotal");
    if (totalNote) {
        const total = projection.total_withdrawn || 0;
        totalNote.textContent = total > 0 ? `Łącznie wypłacono netto: ${wzFmtZloty(total)} zł.` : "";
        totalNote.hidden = !(total > 0);
    }

    const rows = phases.map((phase) => {
        const account = accountName(phase.account);
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

function wzRenderPolicy(projection) {
    const note = wzEl("wzPolicyNote");
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
            strategy: wzRadio("wzStrategy", "zbilansowana"),
            allocation_mode: wzAllocationMode,
            allocations: wzCurrentAllocations(),
            pool_monthly: Number(wzSuggested?.pool_monthly) || 0,
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

function wzFinish() {
    if (!wzPlan) return;
    wzSaveState();
    wzSavePlanCache();
    const activeInput = wzPlan.scenario_inputs?.[wzSelectedScenario] || wzPlan.input;
    const draft = {
        gender: activeInput.gender,
        config: activeInput.config,
        stages: activeInput.stages,
        withdrawal_policy: activeInput.withdrawal_policy || "defer_tier",
        source: "wizard",
    };
    try {
        localStorage.setItem("fire.wizardDraft", JSON.stringify(draft));
    } catch {
        // Gdy localStorage jest pełny, przejście do symulatora nadal działa.
    }
    window.location.href = "/sim?wizard=1";
}

// --- Zdarzenia --------------------------------------------------------------

function wzTouch() {
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
        if (target.name === "wzPath") wzSyncPathUI();
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
        if (target.name === "wzEtatPeriod") {
            wzApplyEtatPeriod(true);
            wzScheduleSalaryPreview();
        }
        if (target.name === "wzPath") {
            wzSyncPathUI();
            wzSyncSemiBounds();
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
        step: wzCurrentStep,
        fields: wzCollectFormState(),
        rows: wzCollectCapitalState(),
        allocationMode: wzAllocationMode,
        manualAllocations: wzManualAllocations,
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

    wzRestoring = true;
    if (state) {
        try {
            wzRestoreFormState(state.fields || []);
            wzMigratePayrollState(state);
            wzRestoreCapitalState(state.rows || []);
            wzApplyDefaultAccountRois();
            wzAllocationMode = state.allocationMode === "manual" ? "manual" : "auto";
            wzManualAllocations = state.manualAllocations || null;
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

    wzRestoreIfRequested();
    wzStateReady = true;
    wzSaveState();
}

document.addEventListener("DOMContentLoaded", wzInit);
