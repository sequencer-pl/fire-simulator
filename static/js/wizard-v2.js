// wizard-v2.js — Asystent FIRE v2: drzewo kroków, B2B, Coast/Barista FIRE.
// Wymaga: helpers.js, icons.js, sim-utils.js, controls.js, sim-metadata.js.

const V2_STATE_KEY = "fire.wizardV2State";
const V2_PLAN_KEY = "fire.wizardV2Plan";
const V2_ANON_CONFIG_KEY = "fire.config.anonymous";

const V2_SHELTERS = [
    { account: "ike", label: "IKE" },
    { account: "ikze", label: "IKZE" },
    { account: "oipe", label: "OIPE" },
];

const V2_SAFE_BASES = ["lokata", "obligacje", "gotowka"];
const V2_MARKET_BASES = ["broker", "krypto"];

const V2_SALARY_IDS = new Set([
    "v2EtatSalary",
    "v2EtatSalaryRange",
    "v2B2bSalary",
    "v2B2bSalaryRange",
    "v2B2bCustomZus",
    "v2B2bCustomZusRange",
]);
const V2_SALARY_NAMES = new Set([
    "v2EtatSalaryMode",
    "v2EtatPeriod",
    "v2WorkplacePlan",
    "v2B2bSalaryMode",
    "v2B2bTaxForm",
    "v2B2bLumpRate",
    "v2B2bZusMode",
]);

let v2Initialized = false;
let v2CurrentStep = "cel";
let v2Plan = null;
let v2PlanSignature = "";
let v2PlanSeq = 0;
let v2PlanLoading = false;
let v2SelectedScenario = "realne";
let v2Suggested = null;
let v2SuggestSignature = "";
let v2SuggestSeq = 0;
let v2SuggestTimer = null;
let v2SalaryPreview = null;
let v2SalarySeq = 0;
let v2SalaryTimer = null;
let v2RetirementTouched = false;
let v2EtatPeriodPrev = "month";
let v2FormVersion = 0;

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
            throw new Error(msg || errorLabel);
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

function v2FormatPercent(value) {
    const rounded = Math.round(value);
    return rounded < 1 ? "<1%" : `${rounded}%`;
}

function v2FormatYears(years) {
    if (years === 1) return "1 rok";
    if (years >= 2 && years <= 4) return `${years} lata`;
    return `${years} lat`;
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
        if (v2Plan && v2PlanSignature === JSON.stringify(body)) {
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

    const allocHeader = v2El("v2AllocHeader");
    if (allocHeader) {
        allocHeader.textContent = path === 2
            ? "Wybierz strategię. Pula oszczędności zostanie wyliczona przez solver dla Twojego celu wypłaty, a podział dopasowany automatycznie."
            : "Wybierz, jak chcesz lokować bieżące miesięczne oszczędności. Najpierw automatycznie wykorzystamy najkorzystniejsze ulgi podatkowe (IKE / IKZE).";
    }
}

function v2SyncWorkplaceBoxes() {
    const plan = v2Radio("v2WorkplacePlan", "none");
    v2El("v2PpkBox")?.classList.toggle("hidden", plan !== "ppk");
    v2El("v2PpeBox")?.classList.toggle("hidden", plan !== "ppe");
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
    const age = v2Int("v2Age", 35);
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
    const age = v2Int("v2Age", 35);
    const path = v2CurrentPath();
    const re = path === 3 ? 90 : v2Int("v2Re", 55);
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
    return v2Radio("v2EtatPeriod", "month");
}

function v2ApplyEtatPeriod(convert) {
    const period = v2EtatPeriod();
    const annual = period === "year";
    const input = v2El("v2EtatSalary");
    const range = v2El("v2EtatSalaryRange");
    if (!input) return;

    if (convert && period !== v2EtatPeriodPrev) {
        const factor = annual ? 12 : 1 / 12;
        const current = parseFloat(input.value) || 0;
        const next = Math.max(0, Math.round(current * factor));
        input.value = String(next);
        if (range) range.value = String(next);
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
        const net = v2Radio("v2EtatSalaryMode", "net") === "net";
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
    if (employment !== "etat") {
        const hint = v2El("v2EtatSalaryHint");
        if (hint) hint.textContent = "";
    }
    if (employment !== "b2b") {
        const hint = v2El("v2B2bSalaryHint");
        if (hint) hint.textContent = "";
    }
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
    if (employment === "etat") return v2Radio("v2EtatSalaryMode", "net");
    if (employment === "b2b") return v2Radio("v2B2bSalaryMode", "gross");
    return "gross";
}

function v2ScheduleSalaryPreview() {
    clearTimeout(v2SalaryTimer);
    v2SalaryTimer = setTimeout(v2RunSalaryPreview, 350);
}

async function v2RunSalaryPreview() {
    const employment = v2Employment();
    const amount = v2MonthlySalaryValue();
    const seq = ++v2SalarySeq;
    if (employment === "niepracujacy" || amount <= 0) {
        v2SalaryPreview = null;
        const etatHint = v2El("v2EtatSalaryHint");
        const b2bHint = v2El("v2B2bSalaryHint");
        if (etatHint) etatHint.textContent = "";
        if (b2bHint) b2bHint.textContent = "";
        v2UpdateSavingsHint();
        return;
    }

    const body = {
        salary_mode: v2SalaryMode(),
        amount,
        employment,
        use_ppk: employment === "etat" && v2Radio("v2WorkplacePlan", "none") === "ppk",
        ppk_employee_pct: 0.02,
    };
    if (employment === "b2b") {
        body.b2b_tax_form = v2Radio("v2B2bTaxForm", "ryczalt");
        body.b2b_lump_rate = parseFloat(v2Radio("v2B2bLumpRate", "0.12"));
        body.b2b_zus_mode = v2Radio("v2B2bZusMode", "duzy");
        body.b2b_custom_zus_base = v2Num("v2B2bCustomZus", 5652);
    }
    const config = v2AnonymousConfig();
    if (config) body.base_config = config;

    try {
        const data = await v2PostJson("/api/wizard/salary", body, "Błąd podglądu pensji.");
        if (seq !== v2SalarySeq) return;
        v2SalaryPreview = {
            gross: data.gross_monthly,
            net: data.net_monthly,
        };
        v2RenderSalaryHint();
    } catch {
        // Podgląd jest tylko pomocniczy — zostawiamy ostatnią dobrą wartość.
    } finally {
        if (seq === v2SalarySeq) v2UpdateSavingsHint();
    }
}

function v2RenderSalaryHint() {
    if (!v2SalaryPreview) return;
    const mode = v2SalaryMode();
    const employment = v2Employment();
    let text = "";
    if (mode === "net" && v2SalaryPreview.gross != null) {
        text = `≈ ${fmtMoney(v2SalaryPreview.gross)} brutto/mies.`;
    } else if (mode === "gross" && v2SalaryPreview.net != null) {
        text = `≈ ${fmtMoney(v2SalaryPreview.net)} netto/mies.`;
        if (employment === "b2b") text += " po ZUS i podatku";
    }
    if (employment === "etat") {
        const hint = v2El("v2EtatSalaryHint");
        if (hint) hint.textContent = text;
    } else if (employment === "b2b") {
        const hint = v2El("v2B2bSalaryHint");
        if (hint) hint.textContent = text;
    }
}

function v2UpdateSavingsHint() {
    const hint = v2El("v2SavingsHint");
    const warn = v2El("v2SavingsWarn");
    const savings = v2Num("v2Savings", 0);
    const net = v2SalaryPreview?.net;
    if (hint) {
        if (net && net > 0 && savings > 0) {
            hint.textContent = `${fmtMoney(savings)} = ${v2FormatPercent((savings / net) * 100)} pensji netto`;
        } else {
            hint.textContent = "";
        }
    }
    const over = Boolean(net && net > 0 && savings > net);
    if (warn) {
        warn.hidden = !over;
        warn.textContent = over
            ? "Oszczędności przewyższają pensję netto — sprawdź kwoty lub źródło oszczędności."
            : "";
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
        v2El("v2SheltersList")?.appendChild(v2BuildCapRow(account, { name: false, roi: false }));
    }
    v2RefreshShelterPicker();
    v2Touch();
}

function v2BuildCapRow(account, { name = true, roi = true } = {}) {
    const base = v2BaseKey(account);
    const wrap = document.createElement("div");
    wrap.className = "wz-capital-item v2-cap-row";
    wrap.dataset.account = account;
    wrap.dataset.base = base;

    const fields = [];
    if (name) {
        fields.push(`
            <div class="v2-field">
                <span class="v2-field-label">Nazwa własna (opcjonalnie)</span>
                <input type="text" class="acc-field v2-cap-name" maxlength="80" placeholder="np. ${escapeHtml(v2AccountLabel(base))} mBank">
            </div>`);
    }
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
        fields.push(`
            <div class="v2-field">
                <span class="v2-field-label">Realne ROI (%/rok)</span>
                <input type="number" class="acc-field v2-cap-roi" min="0" max="30" step="0.1" placeholder="wg strategii">
            </div>`);
    }

    wrap.innerHTML = `
        <div class="wz-capital-item-head">
            <span class="wz-instrument-name">${v2AccountIcon(account)}<span>${escapeHtml(v2AccountLabel(account))}</span></span>
            <button type="button" class="btn btn-ghost btn-icon btn-sm v2-cap-remove" aria-label="Usuń ${escapeHtml(v2AccountLabel(account))}" title="Usuń">${iconSvg("x")}</button>
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
        const active = Boolean(list?.querySelector(`.v2-cap-row[data-account="${account}"]`));
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
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
        if (name) customNames[account] = name;
        const roi = parseFloat(row.querySelector(".v2-cap-roi")?.value);
        if (Number.isFinite(roi) && roi > 0) roiOverrides[account] = roi / 100;
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

    let usePpk = false;
    let usePpe = false;
    if (employment === "etat") {
        const plan = v2Radio("v2WorkplacePlan", "none");
        usePpk = plan === "ppk";
        usePpe = plan === "ppe";
        if (usePpk) {
            const balance = v2Num("v2PpkBalance", 0);
            if (balance > 0) capital.ppk = balance;
        }
        if (usePpe) {
            const balance = v2Num("v2PpeBalance", 0);
            if (balance > 0) capital.ppe = balance;
        }
    }

    let ofeMember = false;
    if (v2Radio("v2HasZusCap", "no") === "yes") {
        const zus = v2Num("v2ZusBalance", 0);
        const ofe = v2Num("v2OfeBalance", 0);
        if (zus > 0) capital.zus = zus;
        if (ofe > 0) {
            capital["zus:ofe"] = ofe;
            ofeMember = true;
        }
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
        age_now: v2Int("v2Age", 35),
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
    if (withAllocations && v2Suggested?.allocations) {
        answers.allocations = { ...v2Suggested.allocations };
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
    const age = v2Int("v2Age", 35);
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
            if (path !== 3) {
                const re = v2Int("v2Re", 55);
                if (semiAge >= re) {
                    alert("Wiek przejścia na część etatu musi być wcześniejszy niż wiek pełnego FIRE.");
                    return false;
                }
            }
            if (v2Num("v2SemiNet", 0) <= 0) {
                alert("Podaj miesięczne zarobki netto na części etatu.");
                return false;
            }
        }
    }

    if (stepId === "strategia") {
        if (!v2Suggested) {
            alert("Poczekaj na wyliczenie propozycji podziału oszczędności, a potem przejdź dalej.");
            return false;
        }
        const total = Object.values(v2Suggested.allocations || {})
            .reduce((sum, value) => sum + (value || 0), 0);
        if (total <= 0 && v2MonthlySalaryValue() > 0 && v2Num("v2Savings", 0) > 0) {
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
        answers: v2CollectAnswers({ withAllocations: false }),
        path,
        target_monthly: path !== 1 ? v2Num("v2Target", 0) : null,
    };
    return body;
}

function v2InvalidateSuggestion() {
    v2SuggestSeq += 1;
    v2Suggested = null;
    v2SuggestSignature = "";
}

function v2ScheduleSuggestion() {
    clearTimeout(v2SuggestTimer);
    v2SuggestTimer = setTimeout(() => v2RefreshSuggestion(), 250);
}

function v2RefreshSuggestion() {
    clearTimeout(v2SuggestTimer);
    const body = v2SuggestBody();
    const signature = JSON.stringify(body);
    if (v2Suggested && signature === v2SuggestSignature) {
        v2RenderSuggestion();
        return;
    }

    v2Suggested = null;
    v2RenderSuggestionLoading();
    const seq = ++v2SuggestSeq;
    v2PostJson("/api/wizard/suggest", body, "Błąd sugestii podziału.")
        .then((data) => {
            if (seq !== v2SuggestSeq) return;
            v2Suggested = {
                allocations: data.allocations || {},
                pool_monthly: Number(data.pool_monthly) || 0,
            };
            v2SuggestSignature = signature;
            v2RenderSuggestion();
        })
        .catch((err) => {
            if (seq !== v2SuggestSeq) return;
            v2Suggested = null;
            v2RenderSuggestionError(err.message);
        });
}

function v2RenderSuggestionLoading() {
    const box = v2El("v2SuggestList");
    const note = v2El("v2TaxTipNote");
    if (box) {
        box.innerHTML = `
            <div class="v2-suggest-empty">
                <span class="spinner" aria-hidden="true"></span>
                <span>Wyliczam propozycję podziału rocznych wpłat…</span>
            </div>`;
    }
    if (note) note.textContent = "";
}

function v2RenderSuggestionError(message) {
    const box = v2El("v2SuggestList");
    const note = v2El("v2TaxTipNote");
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
}

function v2RenderSuggestion() {
    const box = v2El("v2SuggestList");
    const note = v2El("v2TaxTipNote");
    if (!box || !v2Suggested) return;

    const pool = Number(v2Suggested.pool_monthly) || 0;
    const entries = Object.entries(v2Suggested.allocations || {})
        .filter(([, pct]) => pct > 0)
        .sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
        box.innerHTML = `
            <div class="v2-suggest-empty">
                <span>Brak nowych wpłat do podziału — plan obejmie tylko posiadany kapitał.</span>
            </div>`;
        if (note) note.textContent = "Możesz zwiększyć miesięczne oszczędności, aby zobaczyć propozycję podziału.";
        return;
    }

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
        parts.push("Pełny, ręczny podział zmienisz w Symulatorze.");
        note.textContent = parts.join(" ");
    }
}

// --- Wyliczanie i renderowanie planu ---------------------------------------

function v2ShowLoader(showLoader) {
    v2El("v2PlanLoader")?.classList.toggle("hidden", !showLoader);
    const result = v2El("v2Result");
    if (showLoader && result) result.classList.add("hidden");
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
        v2PlanSignature = JSON.stringify(body);
        v2SelectedScenario = "realne";
        if (version !== v2FormVersion) {
            // Odpowiedź dotyczy starszych odpowiedzi — nie pokazujemy jej.
            v2Plan = null;
            v2PlanSignature = "";
            return;
        }
        v2El("v2Result")?.classList.remove("hidden");
        v2El("v2ResultError")?.classList.add("hidden");
        v2RenderResult(data);
    } catch (err) {
        if (seq !== v2PlanSeq) return;
        v2Plan = null;
        v2PlanSignature = "";
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
    const active = v2ActiveScenarioData(data);
    v2RenderHero(data);
    v2RenderScenarios(data);
    v2RenderMetrics(active.projection);
    v2RenderWarnings(active.projection?.warnings || []);
    v2RenderTimeline(active.input, active.projection);
    v2RenderStageSummary(active.input, active.projection);
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
    const ageNow = input?.age_now ?? v2Int("v2Age", 35);
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

// --- Zakończenie i przejście do symulatora ----------------------------------

function v2Finish() {
    if (!v2Plan) return;
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
        localStorage.setItem(V2_PLAN_KEY, JSON.stringify({
            plan: v2Plan,
            path: v2CurrentPath(),
            selectedScenario: v2SelectedScenario,
        }));
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
    v2InvalidateSuggestion();
    v2UpdateSavingsHint();
    if (v2CurrentStep === "strategia") v2ScheduleSuggestion();
}

function v2IsSalaryEvent(target) {
    if (!target) return false;
    if (V2_SALARY_IDS.has(target.id)) return true;
    if (V2_SALARY_NAMES.has(target.name)) return true;
    return false;
}

function v2SyncAllPanels() {
    v2SyncPathUI();
    v2SyncWorkplaceBoxes();
    v2SyncB2bRows();
    v2SyncZusBox();
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
        v2Touch();
        if (v2IsSalaryEvent(target)) v2ScheduleSalaryPreview();
        if (target.name === "v2Path") v2SyncPathUI();
        if (target.name === "v2Employment") {
            v2SyncWorkplaceBoxes();
            v2UpdateSalaryLabels();
            v2ApplyEtatPeriod(false);
            v2ScheduleSalaryPreview();
        }
        if (target.name === "v2Gender") {
            if (!v2RetirementTouched) {
                const retirement = v2Radio("v2Gender", "m") === "k" ? 60 : 65;
                v2SetValue("v2Retirement", retirement);
                v2SetValue("v2RetirementRange", retirement);
            }
        }
        if (target.id === "v2Age" || target.id === "v2AgeRange") v2SyncAgeBounds();
        if (target.name === "v2EtatSalaryMode") {
            v2UpdateSalaryLabels();
            v2ScheduleSalaryPreview();
        }
        if (target.name === "v2EtatPeriod") {
            v2ApplyEtatPeriod(true);
            v2ScheduleSalaryPreview();
        }
        if (target.name === "v2WorkplacePlan") v2SyncWorkplaceBoxes();
        if (target.name === "v2B2bTaxForm") v2SyncB2bRows();
        if (target.name === "v2B2bZusMode") v2SyncB2bRows();
        if (target.name === "v2B2bSalaryMode") v2UpdateSalaryLabels();
        if (target.name === "v2HasZusCap") v2SyncZusBox();
        if (target.name === "v2HasMortgage") v2SyncMortgageBox();
        if (target.name === "v2HasRealEstate") v2SyncRealEstateBox();
        if (target.name === "v2FireStyle") v2SyncFireStyle();
        if (target.id === "v2Retirement" || target.id === "v2RetirementRange") {
            v2RetirementTouched = true;
        }
        if (target.id === "v2Re" || target.id === "v2ReRange") v2SyncSemiBounds();
        if (target.id === "v2Savings" || target.id === "v2SavingsRange") {
            v2UpdateSavingsHint();
        }
    });

    wizard.addEventListener("change", (event) => {
        const target = event.target;
        if (!target) return;
        v2Touch();

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
        if (target.name === "v2WorkplacePlan") v2SyncWorkplaceBoxes();
        if (target.name === "v2B2bTaxForm" || target.name === "v2B2bZusMode") {
            v2SyncB2bRows();
        }
        if (target.name === "v2HasZusCap") v2SyncZusBox();
        if (target.name === "v2HasMortgage") v2SyncMortgageBox();
        if (target.name === "v2HasRealEstate") v2SyncRealEstateBox();
        if (target.name === "v2Employment") {
            v2UpdateSalaryLabels();
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

    wizard.addEventListener("click", (event) => {
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
        }
    });
}

function v2RestoreIfRequested() {
    const params = new URLSearchParams(window.location.search || "");
    if (!params.get("restore")) return false;
    let raw = null;
    try {
        raw = localStorage.getItem(V2_PLAN_KEY);
    } catch {
        return false;
    }
    if (!raw) return false;
    let stored = null;
    try {
        stored = JSON.parse(raw);
    } catch {
        return false;
    }
    if (!stored || !stored.plan) return false;

    v2Plan = stored.plan;
    v2PlanSignature = "";
    v2SelectedScenario = stored.selectedScenario || "realne";

    if (stored.path) {
        const radio = document.querySelector(`input[name="v2Path"][value="${stored.path}"]`);
        if (radio) {
            radio.checked = true;
            v2SyncPathUI();
            v2SyncSemiBounds();
        }
    }

    v2ShowStep("wynik", true);
    return true;
}

function v2Init() {
    if (v2Initialized) return;
    v2Initialized = true;

    const scope = document.querySelector(".wz-v2") || document;
    if (typeof initTipAnchoring === "function") initTipAnchoring();
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
    v2SyncSingleButtons();
    v2BindEvents();
    v2SyncAllPanels();
    v2ApplyEtatPeriod(false);
    v2EtatPeriodPrev = v2EtatPeriod();
    v2UpdateSavingsHint();
    v2ShowStep("cel");

    // Pierwszy podgląd pensji jest opóźniony, żeby nie konkurować z renderingiem.
    setTimeout(v2ScheduleSalaryPreview, 150);

    v2RestoreIfRequested();
}

document.addEventListener("DOMContentLoaded", v2Init);
