// wizard.js — Asystent FIRE: 3 ścieżki planowania oparte o backend planner.py

const WZ_TOTAL_STEPS = 6;
const WIZARD_STATE_KEY = "fire.wizardState";

// Step 3 rows: wszystkie 14 kont widoczne od razu jako pastylki wyboru,
// a pola kwotowe renderowane pod spodem tylko dla wybranych kont.
const WZ_CAPITAL_ROWS = [
    "gotowka", "zus", "zus:ofe", "ppk", "ppe",
    "ike", "ikze", "oipe", "oki_inw", "oki_osk",
    "krypto", "lokata", "obligacje", "broker",
];

// Accounts allocatable from the discretionary pool (sliders + pills in step 5).
// Payroll vehicles (ZUS, PPK, PPE) are excluded — savings can't be routed there.
const WZ_ALLOC_ACCOUNTS = [
    "broker", "ikze", "ike", "oipe",
    "krypto", "lokata", "obligacje", "oki_inw", "oki_osk",
];

// Always present in engine: the cash sink and the ZUS state pension.
const WZ_ALWAYS_ON = new Set(["gotowka", "zus"]);

// Payroll-funded vehicles — participation is toggled with pills,
// contributions come from the salary, never from the discretionary pool.
const WZ_PAYROLL = new Set(["ppk", "ppe"]);

// Ustawowy wiek emerytalny wg płci (spójny z config.zus.wiek_emerytalny_*).
const RETIREMENT_DEFAULT = { k: 60, m: 65 };

// Średnie dalsze trwanie życia (lata) wg wieku i płci — GUS, tablica trwania
// życia za 2024 r. Domyślny „Horyzont czasowy" = obecny wiek + wartość z tabeli.
const LIFE_EXPECTANCY = {
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

const WZ_CAPITAL_OVERRIDES = { zus: "ZUS", "zus:ofe": "OFE" };
const WZ_CAPITAL_ICONS = { "zus:ofe": iconSvg("zus") };

// State
let wzCapitalSelected = new Set();
let wzPill = new Set();
let wzPlan = null;
let wzSelectedScenario = null;
let wzNavStep = 1;
// Paths 1/3: annual amounts are canonical (extra pool goes to cash).
// Path 2: percentage weights are canonical (amounts scale with the solved pool).
let wzWeights = {};
let wzAmounts = {};
let wzLimits = null;
let wzStrategyValue = null;
let wzAssumptionsValue = "realne";
let wzAllocMode = null;
let wzEstimatedPoolMonthly = null;
let wzPoolEstimatePending = false;
let wzNetMonthly = null;
let wzSalaryPreviewSeq = 0;
let wzRetirementTouched = false;
let wzPlanEndTouched = false;
let wzLoaderTimer = null;

function capitalLabel(account) {
    return WZ_CAPITAL_OVERRIDES[account] || ACCOUNT_LABELS[account] || account;
}

function accountIcon(account) {
    return WZ_CAPITAL_ICONS[account] || ACCOUNT_ICONS[account] || "";
}

function radioChecked(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
}

function numControl(account, ariaLabel, initialValue = "0") {
    return numControlsHtml({
        value: String(initialValue),
        min: "0",
        step: "1000",
        fieldClass: "wz-capital-input",
        aria: ariaLabel || account,
        attrs: ` data-account="${account}"`,
    });
}

// --- Krok 3: Kapitał (wybór pastylkami z listy wszystkich 14 kont) -----------

function buildCapitalRow(account, initialValue = "0") {
    const icon = accountIcon(account);
    const label = capitalLabel(account);
    const wrap = document.createElement("div");
    wrap.className = "wz-capital-item wz-instrument-row";
    wrap.dataset.account = account;
    wrap.innerHTML = `
        <div class="wz-capital-item-head">
            <label class="wz-instrument-name"><span class="wz-alloc-icon">${icon}</span>${label}</label>
            <button type="button" class="btn btn-ghost btn-icon btn-sm wz-pill-remove" aria-label="Usuń ${label}" title="Usuń">${iconSvg("x")}</button>
        </div>
        <div class="wz-instrument-fields">
            ${numControl(account, label, initialValue)}
        </div>`;
    const rmBtn = wrap.querySelector(".wz-pill-remove");
    if (rmBtn) {
        rmBtn.addEventListener("click", () => toggleCapitalAccount(account, false));
    }
    return wrap;
}

function toggleCapitalAccount(account, forceState = null, focusInput = true) {
    const grid = document.getElementById("wzCapitalGrid");
    const shouldAdd = forceState !== null ? forceState : !wzCapitalSelected.has(account);
    if (shouldAdd) {
        wzCapitalSelected.add(account);
        if (grid && !grid.querySelector(`.wz-capital-item[data-account="${account}"]`)) {
            const row = buildCapitalRow(account, "0");
            grid.appendChild(row);
            if (focusInput) {
                const inp = row.querySelector(".wz-capital-input");
                if (inp) inp.focus();
            }
        }
    } else {
        wzCapitalSelected.delete(account);
        const existing = grid?.querySelector(`.wz-capital-item[data-account="${account}"]`);
        if (existing) existing.remove();
    }
    refreshCapitalPicker();
    updateSalaryHint();
}

function refreshCapitalPicker() {
    const picker = document.getElementById("wzCapitalPicker");
    if (!picker) return;
    picker.querySelectorAll(".wz-pill").forEach((btn) => {
        const acc = btn.dataset.account;
        const active = wzCapitalSelected.has(acc);
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
    });
}

function buildCapitalGrid() {
    const picker = document.getElementById("wzCapitalPicker");
    const grid = document.getElementById("wzCapitalGrid");
    if (!grid) return;
    grid.innerHTML = "";
    if (picker) {
        picker.innerHTML = "";
        WZ_CAPITAL_ROWS.forEach((account) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "pill-toggle wz-pill";
            btn.dataset.account = account;
            btn.innerHTML = `${accountIcon(account)}<span>${capitalLabel(account)}</span>`;
            btn.addEventListener("click", () => toggleCapitalAccount(account));
            picker.appendChild(btn);
        });
    }
    refreshCapitalPicker();
}

function capitalSaldo(account) {
    const el = document.querySelector(`.wz-capital-input[data-account="${account}"]`);
    return parseFloat(el && el.value) || 0;
}

function isCapActive(account) {
    if (WZ_ALWAYS_ON.has(account)) return true;
    return capitalSaldo(account) > 0 || wzCapitalSelected.has(account) || wzPill.has(account);
}

function togglePill(account) {
    const on = isCapActive(account);
    if (on && !WZ_ALWAYS_ON.has(account) && capitalSaldo(account) <= 0) {
        wzPill.delete(account);
        wzCapitalSelected.delete(account);
        delete wzWeights[account];
        delete wzAmounts[account];
    } else if (!on) {
        wzPill.add(account);
    }
    updateSalaryHint();
}

// Dezaktywacja instrumentu (przycisk „Usuń” wiersza / payroll) — czyści też
// wagę, żeby martwe udziały nie wracały do sumy (collectAllocations, suggest).
function deactivateAllocAccount(acc) {
    wzPill.delete(acc);
    if (capitalSaldo(acc) <= 0) wzCapitalSelected.delete(acc);
    delete wzWeights[acc];
    delete wzAmounts[acc];
    buildAllocationStep();
    updateSalaryHint();
}

function collectAnswers() {
    const capital = {};
    document.querySelectorAll(".wz-capital-input").forEach((el) => {
        const v = parseFloat(el.value) || 0;
        if (v > 0) capital[el.dataset.account] = v;
    });
    const hasOfe = (capital["zus:ofe"] || 0) > 0 || wzCapitalSelected.has("zus:ofe");
    return {
        gender: radioChecked("wzGender") || "m",
        age_now: parseInt(document.getElementById("wzAge").value, 10) || 0,
        employment: radioChecked("wzEmployment") || "etat",
        gross_monthly: parseFloat(document.getElementById("wzGross").value) || 0,
        salary_mode: (radioChecked("wzEmployment") || "etat") === "etat"
            ? (radioChecked("wzSalaryMode") || "gross")
            : "gross",
        capital: capital,
        use_zus: true,
        ofe_member: hasOfe,
        use_ppk: isCapActive("ppk"),
        use_ppe: isCapActive("ppe"),
        use_ikze: isCapActive("ikze"),
        use_ike: isCapActive("ike"),
        use_oipe: isCapActive("oipe"),
        use_oki_inw: isCapActive("oki_inw"),
        use_oki_osk: isCapActive("oki_osk"),
        use_krypto: isCapActive("krypto"),
        use_lokata: isCapActive("lokata"),
        use_obligacje: isCapActive("obligacje"),
        use_broker: isCapActive("broker"),
        retire_early_age: parseInt(document.getElementById("wzRe").value, 10) || null,
        retirement_age: (() => {
            const v = parseInt(document.getElementById("wzRetirement").value, 10);
            return Number.isFinite(v) && v > 0 ? v : null;
        })(),
        plan_end_age: parseInt(document.getElementById("wzPlanEnd").value, 10) || 96,
        savings: parseFloat(document.getElementById("wzSavings").value) || 0,
        strategy: wzStrategyValue || "zbilansowana",
        assumptions: wzAssumptionsValue || "realne",
        roi_overrides: {},
        allocations: collectAllocations(),
    };
}

function collectAllocations() {
    wzSyncWeightsFromAmounts();
    const alloc = {};
    Object.keys(wzWeights).forEach((acc) => {
        if (isCapActive(acc) && wzWeights[acc] > 0) alloc[acc] = wzWeights[acc];
    });
    return alloc;
}

function currentPath() {
    const checked = document.querySelector('input[name="wzPath"]:checked');
    return checked ? parseInt(checked.value, 10) : 1;
}

function setStep(n, focus = false) {
    syncPathUI();
    document.querySelectorAll(".wz-step").forEach((el) => {
        el.classList.toggle("hidden", parseInt(el.dataset.step, 10) !== n);
    });
    const bar = document.getElementById("wizardProgressBar");
    bar.style.width = (n / WZ_TOTAL_STEPS) * 100 + "%";
    bar.setAttribute("aria-valuenow", String(n));
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (n === 5) {
        buildAllocationStep();
        if (!wzAllocMode) {
            ["wzAllocPanel", "wzAllocPillsPanel", "wzPayrollPanel"].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.classList.add("hidden");
            });
        }
    }
    wzNavStep = n;
    updateFooterNav(n);
    saveWizardState();
    if (focus) {
        const heading = document.querySelector(`.wz-step[data-step="${n}"] h2`);
        if (heading) {
            heading.setAttribute("tabindex", "-1");
            heading.focus({ preventScroll: true });
        }
    }
}

function validateStep(n) {
    if (n === 4) {
        const path = currentPath();
        const age = parseInt(document.getElementById("wzAge").value, 10) || 0;
        const reGroup = document.getElementById("wzReGroup");
        const reVisible = !reGroup || !reGroup.classList.contains("hidden");
        const re = parseInt(document.getElementById("wzRe").value, 10) || 0;
        if (path !== 1) {
            const t = parseFloat(document.getElementById("wzTarget").value) || 0;
            if (t <= 0) {
                alert("Podaj cel wypłaty miesięcznej.");
                return false;
            }
        }
        if (reVisible) {
            if (re <= age) {
                alert("Wiek FIRE musi być większy niż obecny wiek (" + age + ").");
                return false;
            }
            const end = parseInt(document.getElementById("wzPlanEnd").value, 10) || 96;
            if (end <= re) {
                alert("Horyzont czasowy musi być późniejszy niż wiek FIRE.");
                return false;
            }
        }
    }
    if (n === 5) {
        if (!allocReady()) {
            alert("Wybierz strategię podziału oszczędności, zanim przejdziesz dalej.");
            return false;
        }
        const total = Object.values(collectAllocations()).reduce((a, b) => a + (b || 0), 0);
        if (total > 100 + 1e-6) {
            alert("Suma udziałów przekracza 100%. Zmniejsz któreś z kont albo zostaw resztę w gotówce.");
            return false;
        }
    }
    if (n === 6) {
        return wzPlan !== null;
    }
    return true;
}

// --- Bramka kroku 5: wybór strategii przed przejściem dalej ------------------

function allocReady() {
    return wzAllocMode != null;
}

const ALLOC_GATE_MSG = "Wybierz strategię podziału oszczędności (Konserwatywną, Zrównoważoną, Agresywną lub Manualną), aby wyliczyć plan.";

let wzPopTimer = null;

function showAllocGatePop() {
    const pop = document.getElementById("wzNextPop");
    if (pop) {
        pop.hidden = false;
        pop.textContent = ALLOC_GATE_MSG;
        if (wzPopTimer) clearTimeout(wzPopTimer);
        wzPopTimer = setTimeout(() => {
            pop.hidden = true;
            wzPopTimer = null;
        }, 4000);
    }
}

function refreshAllocGate() {
    const ready = allocReady();
    const next = document.getElementById("wzNextBtn");
    if (next) next.disabled = wzNavStep === 5 && !ready;
    const tip = document.getElementById("wzNextTip");
    if (tip) {
        const locked = wzNavStep === 5 && !ready;
        tip.title = locked ? ALLOC_GATE_MSG : "";
        tip.classList.toggle("is-locked", locked);
    }
    const pop = document.getElementById("wzNextPop");
    if (pop) {
        if (wzPopTimer) {
            clearTimeout(wzPopTimer);
            wzPopTimer = null;
        }
        pop.hidden = true;
    }
}

// --- Krok 6: Wynik, Hero Answer, 3 scenariusze i oś czasu --------------------

function renderWarnings(list) {
    const box = document.getElementById("wzWarnings");
    box.classList.add("hidden");
    box.innerHTML = "";
    if (!list || !list.length) return;
    const banner = document.createElement("div");
    banner.className = "banner banner-warn";
    banner.insertAdjacentHTML("afterbegin", iconSvg("warning"));
    const body = document.createElement("div");
    body.className = "banner-body";
    const ul = document.createElement("ul");
    ul.className = "banner-list";
    list.forEach((w) => {
        const li = document.createElement("li");
        li.textContent = w;
        ul.appendChild(li);
    });
    body.appendChild(ul);
    banner.appendChild(body);
    box.appendChild(banner);
    box.classList.remove("hidden");
}

function activeScenarioData(data) {
    const key = wzSelectedScenario;
    return {
        projection: data.scenario_projections?.[key] || data.projection || {},
        solved: data.scenario_solved?.[key] || data.solved || {},
        input: data.scenario_inputs?.[key] || data.input,
    };
}

function renderHeroAnswer(data) {
    const box = document.getElementById("wzHeroAnswer");
    if (!box) return;
    const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString("pl-PL"));
    const path = data.path || currentPath();
    const { projection: proj, solved } = activeScenarioData(data);

    box.classList.toggle("is-warn", !solved.feasible || !proj.met);

    if (path === 1) {
        const payout = proj.min_monthly;
        const reAge = parseInt(document.getElementById("wzRe")?.value, 10) || 55;
        const endAge = parseInt(document.getElementById("wzPlanEnd")?.value, 10) || 96;
        box.innerHTML = `
            <div class="wz-hero-kicker">Odpowiedź Asystenta · Ile dostaniesz na emeryturze FIRE</div>
            <div class="wz-hero-headline">Możesz wypłacać gwarantowane ${fmt(payout)} zł/mies. netto</div>
            <div class="wz-hero-desc">Od ${reAge}. do ${endAge}. roku życia Twój portfel wraz z emeryturą ZUS zapewni co najmniej <strong>${fmt(payout)} zł/mies.</strong> na rękę (średnio <strong>${fmt(proj.mean_monthly)} zł/mies.</strong>).</div>`;
    } else if (path === 2) {
        const sav = solved.savings_monthly;
        const pct = solved.savings_pct;
        const target = proj.target_monthly || parseFloat(document.getElementById("wzTarget")?.value) || 0;
        if (solved.feasible) {
            const pctStr = pct != null ? ` (${pct.toLocaleString("pl-PL")}% pensji netto)` : "";
            box.innerHTML = `
                <div class="wz-hero-kicker">Odpowiedź Asystenta · Ile musisz odkładać</div>
                <div class="wz-hero-headline">Odkładaj ${fmt(sav)} zł/mies.${pctStr}</div>
                <div class="wz-hero-desc">Tyle wystarczy odkładać, aby osiągnąć docelową wypłatę <strong>${fmt(target)} zł/mies. netto</strong> przez cały wybrany horyzont czasowy.</div>`;
        } else {
            box.innerHTML = `
                <div class="wz-hero-kicker">Odpowiedź Asystenta · Ile musisz odkładać</div>
                <div class="wz-hero-headline">Cel ${fmt(target)} zł/mies. wymaga korekty założeń</div>
                <div class="wz-hero-desc">${escapeHtml(solved.note || "Rozważ późniejszy wiek FIRE lub niższy cel wypłaty.")}</div>`;
        }
    } else {
        const re = solved.retire_early_age;
        const target = proj.target_monthly || parseFloat(document.getElementById("wzTarget")?.value) || 0;
        const ageNow = parseInt(document.getElementById("wzAge")?.value, 10) || 0;
        if (solved.feasible && re != null) {
            const yearsLeft = Math.max(0, re - ageNow);
            box.innerHTML = `
                <div class="wz-hero-kicker">Odpowiedź Asystenta · Kiedy możesz przestać pracować</div>
                <div class="wz-hero-headline">W wieku ${re} lat (za ${yearsLeft} ${yearsLeft === 1 ? "rok" : (yearsLeft >= 2 && yearsLeft <= 4 ? "lata" : "lat")})</div>
                <div class="wz-hero-desc">To najwcześniejszy wiek przejścia na FIRE z gwarancją wypłaty co najmniej <strong>${fmt(target)} zł/mies. netto</strong>.</div>`;
        } else {
            box.innerHTML = `
                <div class="wz-hero-kicker">Odpowiedź Asystenta · Kiedy możesz przestać pracować</div>
                <div class="wz-hero-headline">Cel ${fmt(target)} zł/mies. nieosiągalny przed emeryturą</div>
                <div class="wz-hero-desc">${escapeHtml(solved.note || "Rozważ wyższe miesięczne oszczędności lub niższą docelową wypłatę.")}</div>`;
        }
    }
}

function renderScenarioResult(data) {
    const active = activeScenarioData(data);
    renderHeroAnswer(data);
    renderMetrics(active.projection);
    renderSolved(active.solved);
    renderWarnings(active.projection.warnings || []);
    renderTimeline(active.input, active.projection);
    renderPhaseTable(active.projection);
    renderStageSummaryList(active.input, active.projection);
}

function renderScenarios(data) {
    const box = document.getElementById("wzScenariosBox");
    if (!box) return;
    const scenarios = data.scenarios || {};
    const keys = ["konserwatywne", "realne", "optymistyczne"].filter((k) => scenarios[k]);
    if (!keys.length) {
        box.innerHTML = "";
        return;
    }
    const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString("pl-PL"));
    const icons = { konserwatywne: iconSvg("rain"), realne: iconSvg("cloud"), optymistyczne: iconSvg("sun") };
    const path = data.path || currentPath();

    let html = `<h3 class="eyebrow wz-panel-title">Scenariusze rynkowe</h3><div class="wz-scenarios-grid">`;
    keys.forEach((key) => {
        const s = scenarios[key];
        const selected = key === wzSelectedScenario;
        let mainText = "";
        let subText = `Szczyt majątku: ${fmt(s.peak_wealth)} zł`;
        if (path === 1) {
            mainText = `${fmt(s.payout_monthly)} zł/mies.`;
        } else if (path === 2) {
            mainText = s.feasible
                ? `${fmt(s.savings_monthly)} zł/mies.`
                : "Nieosiągalne";
            if (s.savings_pct != null && s.feasible) {
                subText = `${s.savings_pct.toLocaleString("pl-PL")}% pensji netto · Szczyt: ${fmt(s.peak_wealth)} zł`;
            }
        } else {
            mainText = s.feasible && s.retire_early_age != null
                ? `FIRE w wieku ${s.retire_early_age} lat`
                : "Po wieku emerytalnym";
        }
        html += `
            <button type="button" class="wz-scenario-card${selected ? " is-selected" : ""}" data-scenario="${key}" aria-pressed="${selected}">
                <span class="wz-scenario-title">
                    <span class="wz-scenario-name">${icons[key] || ""}<span>${escapeHtml(s.label)}</span></span>
                    ${selected ? `<span class="chip chip-primary">${iconSvg("check")}Wybrany</span>` : ""}
                </span>
                <span class="wz-scenario-main">${mainText}</span>
                <span class="wz-scenario-sub">${subText}</span>
            </button>`;
    });
    html += `</div>`;
    box.innerHTML = html;

    box.querySelectorAll(".wz-scenario-card").forEach((btn) => {
        btn.addEventListener("click", () => {
            wzSelectedScenario = btn.dataset.scenario;
            renderScenarios(wzPlan);
            renderScenarioResult(wzPlan);
            saveWizardState();
        });
    });
}

function renderMetrics(projection) {
    const box = document.getElementById("wzMetrics");
    const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString("pl-PL"));
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
    html += `<div class="metric${(projection.final_wealth || 0) <= 0 ? " is-muted" : ""}"><span class="metric-label">Na koniec horyzontu</span><span class="metric-value">${fmt(projection.final_wealth)} zł</span></div>`;
    box.innerHTML = `<div class="metric-grid">${html}</div>`;
    box.classList.remove("hidden");
}

function renderSolved(solved) {
    const box = document.getElementById("wzSolved");
    box.innerHTML = "";
    const li = [];
    if (solved.savings_monthly != null) {
        li.push(`Wymagane oszczędności: <strong>${Math.round(solved.savings_monthly).toLocaleString("pl-PL")} zł/mies.</strong>`);
        if (solved.savings_pct != null) {
            li.push(`czyli <strong>${solved.savings_pct.toLocaleString("pl-PL")}%</strong> pensji netto.`);
        }
    }
    if (solved.retire_early_age != null) {
        li.push(`Najwcześniejszy wiek FIRE: <strong>${solved.retire_early_age} lat</strong>.`);
    }
    if (!solved.feasible) {
        li.push(`<span class="text-warning">${solved.note}</span>`);
    }
    if (li.length) {
        box.innerHTML = `<div class="banner banner-info">${iconSvg("info")}<div class="banner-body">${li.join(" ")}</div></div>`;
        box.classList.remove("hidden");
    }
}

function stageMetricFor(metrics, stage, index) {
    if (!Array.isArray(metrics)) return null;
    const direct = metrics[index];
    if (direct
        && direct.name === stage.name
        && direct.start_age === stage.start_age
        && direct.end_age === stage.end_age) {
        return direct;
    }
    return metrics.find(
        (m) => m.name === stage.name
            && m.start_age === stage.start_age
            && m.end_age === stage.end_age
    ) || null;
}

function renderStageSummaryList(input, projection) {
    const box = document.getElementById("wzStageSummaryList");
    if (!box || !input || !Array.isArray(input.stages)) return;
    const metrics = projection?.stage_metrics || [];
    box.innerHTML = "";
    input.stages.forEach((st, index) => {
        const isAccum = st.stage_type === "akumulacja";
        const kind = isAccum ? "accum" : "withdraw";
        const accountKeys = Object.keys(st.accounts || {});
        const zusOnly = !isAccum && accountKeys.length === 1 && accountKeys[0] === "zus";
        const metric = stageMetricFor(metrics, st, index);
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
            .map((k) => `<span class="chip">${escapeHtml(ACCOUNT_LABELS[k] || k)}</span>`)
            .join("");
        const row = document.createElement("div");
        row.className = "stage-line";
        row.innerHTML = `
            <span class="stage-dot ${kind}"></span>
            <span class="stage-label ${kind}">${escapeHtml(st.name || (isAccum ? "Akumulacja" : "Realizacja"))}</span>
            <span class="stage-age">${st.start_age}→${st.end_age} r.ż.</span>
            ${pills}${finance}`;
        box.appendChild(row);
    });

    // Supplement + ZUS run in parallel after retirement; their component
    // amounts add up to the total net payout shown in the metrics.
    const zusStages = input.stages.filter(
        (st) => st.stage_type === "realizacja" && st.accounts && st.accounts.zus
    );
    const portfolioStages = input.stages.filter(
        (st) => st.stage_type === "realizacja" && !(st.accounts && st.accounts.zus)
    );
    let overlap = null;
    for (const portfolioStage of portfolioStages) {
        const zusStage = zusStages.find(
            (z) => portfolioStage.start_age < z.end_age && z.start_age < portfolioStage.end_age
        );
        if (zusStage) {
            overlap = { portfolioStage, zusStage };
            break;
        }
    }
    if (overlap) {
        const note = document.createElement("p");
        note.className = "wz-stage-note";
        const portfolioName = overlap.portfolioStage.name || "Dopłata do emerytury";
        const zusName = overlap.zusStage.name || "Emerytura ZUS";
        note.textContent = `W latach nakładania się etapów „${portfolioName}” i „${zusName}” kwoty się sumują — to łączna wypłata netto.`;
        box.appendChild(note);
    }
}

async function postJson(url, body, errorLabel) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
        let msg = data.detail;
        if (Array.isArray(msg)) msg = msg.map((d) => d.msg || JSON.stringify(d)).join("; ");
        throw new Error(msg || errorLabel);
    }
    return data;
}

function startPlanLoader() {
    const loader = document.getElementById("wzPlanLoader");
    const stepText = document.getElementById("wzPlanLoaderStep");
    if (!loader) return;
    loader.classList.remove("hidden");
    const steps = [
        "Krok 1 / 3: Budowanie etapów akumulacji, brydża i emerytury ZUS…",
        "Krok 2 / 3: Poszukiwanie optymalnej wypłaty i rozliczanie podatków…",
        "Krok 3 / 3: Porównywanie scenariusza ostrożnego, realnego i optymistycznego…",
    ];
    let idx = 0;
    if (stepText) stepText.textContent = steps[0];
    if (wzLoaderTimer) clearInterval(wzLoaderTimer);
    wzLoaderTimer = setInterval(() => {
        idx = (idx + 1) % steps.length;
        if (stepText) stepText.textContent = steps[idx];
    }, 550);
}

function stopPlanLoader() {
    if (wzLoaderTimer) {
        clearInterval(wzLoaderTimer);
        wzLoaderTimer = null;
    }
    const loader = document.getElementById("wzPlanLoader");
    if (loader) loader.classList.add("hidden");
}

async function runPlan() {
    const answers = collectAnswers();
    const path = currentPath();
    const body = { path: path, answers: answers };
    if (path !== 1) {
        body.target_monthly = parseFloat(document.getElementById("wzTarget").value) || null;
    }
    const runBtn = document.getElementById("wzNextBtn");
    const errorBox = document.getElementById("wzResultError");
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    runBtn.disabled = true;
    runBtn.textContent = "Wyliczam...";
    startPlanLoader();
    try {
        const data = await postJson("/api/wizard/plan", body, "Błąd planowania.");
        wzPlan = data;
        wzSelectedScenario = answers.assumptions || "realne";
        document.getElementById("wzResult").classList.remove("hidden");
        renderScenarios(data);
        renderScenarioResult(data);
        saveWizardState();
    } catch (err) {
        wzPlan = null;
        document.getElementById("wzResult").classList.remove("hidden");
        errorBox.innerHTML = `${iconSvg("danger")}<div class="banner-body"></div>`;
        errorBox.querySelector(".banner-body").textContent = "Błąd: " + err.message;
        errorBox.classList.remove("hidden");
    } finally {
        stopPlanLoader();
        runBtn.disabled = false;
        updateFooterNav(wzNavStep);
    }
}

function fmtShortAmount(value) {
    return Math.round(value).toLocaleString("pl-PL");
}

function phaseComponents(phase) {
    if (!phase || phase.cashflow === "contribution") return "";
    const parts = [];
    if (phase.portfolio_monthly > 0) {
        parts.push(`portfel ${fmtShortAmount(phase.portfolio_monthly)}`);
    }
    if (phase.zus_monthly > 0) {
        parts.push(`ZUS ${fmtShortAmount(phase.zus_monthly)}`);
    }
    return parts.join(" + ");
}

function renderTimeline(input, projection) {
    const box = document.getElementById("wzTimeline");
    if (!box) return;
    box.innerHTML = "";
    const phases = projection?.phase_metrics || [];
    if (phases.length) {
        renderPhaseTimeline(box, phases);
        return;
    }
    renderLegacyTimeline(input, box);
}

function renderPhaseTimeline(box, phases) {
    const ordered = [...phases].sort((a, b) => a.start_age - b.start_age);
    const min = Math.min(...ordered.map((p) => p.start_age));
    const max = Math.max(...ordered.map((p) => p.end_age));
    const width = max - min || 1;
    ordered.forEach((phase) => {
        const leftPct = ((phase.start_age - min) / width) * 100;
        const spanPct = Math.max(2, ((phase.end_age - phase.start_age) / width) * 100);
        const isAccum = phase.cashflow === "contribution";
        const seg = document.createElement("div");
        seg.className = "wz-timeline-segment " + (isAccum ? "wz-tl-acc" : "wz-tl-real");
        seg.style.left = leftPct + "%";
        seg.style.width = spanPct + "%";
        seg.dataset.phaseKey = phase.key || "";
        const split = phaseComponents(phase);
        seg.title = [
            phase.name,
            `${phase.start_age} → ${phase.end_age} r.ż.`,
            isAccum ? `wpłaty ~${fmtMoney(phase.monthly)}/mies.` : `wypłata netto ~${fmtMoney(phase.monthly)}/mies.`,
            split,
        ].filter(Boolean).join(" · ");
        seg.innerHTML = `
            <span class="wz-tl-name">${escapeHtml(phase.name)}</span>
            <span class="wz-tl-age">${phase.start_age}–${phase.end_age} r.ż.</span>
            <span class="wz-tl-amount">${phase.monthly > 0 ? `~${fmtMoney(phase.monthly)}/mies.` : "—"}</span>
            <span class="wz-tl-kind">${isAccum ? "wpłaty" : "wypłata netto"}</span>
            ${split ? `<span class="wz-tl-split">${split}</span>` : ""}`;
        box.appendChild(seg);
    });
}

function renderLegacyTimeline(input, box) {
    const stages = input?.stages || [];
    if (!stages.length) return;
    const raw = stages.map((s) => ({
        label: s.name || (s.stage_type === "realizacja" ? "Realizacja" : "Akumulacja"),
        kind: s.stage_type === "realizacja" ? "Realizacja" : "Akumulacja",
        start: s.start_age,
        end: s.end_age,
    }));
    // Deduplicate identical start-end spans so overlapping supplement + ZUS
    // render cleanly on the timeline bar.
    const spans = [];
    raw.forEach((s) => {
        const existing = spans.find((x) => x.kind === s.kind && x.start === s.start && x.end === s.end);
        if (existing) {
            if (!existing.label.includes(s.label)) existing.label += " + " + s.label;
        } else {
            spans.push({ ...s });
        }
    });
    const min = Math.min(...spans.map((x) => x.start));
    const max = Math.max(...spans.map((x) => x.end));
    const width = max - min || 1;
    spans.forEach((s) => {
        const leftPct = ((s.start - min) / width) * 100;
        const spanPct = Math.max(2, ((s.end - s.start) / width) * 100);
        const seg = document.createElement("div");
        seg.className = "wz-timeline-segment " + (s.kind === "Realizacja" ? "wz-tl-real" : "wz-tl-acc");
        seg.style.left = leftPct + "%";
        seg.style.width = spanPct + "%";
        seg.title = s.label + ": " + s.start + " → " + s.end + " r.ż.";
        seg.innerHTML = `<span class="wz-tl-name">${escapeHtml(s.label)}</span><span class="wz-tl-age">${s.start}–${s.end} r.ż.</span>`;
        box.appendChild(seg);
    });
}

function renderPhaseTable(projection) {
    const box = document.getElementById("wzPhaseTable");
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
            const components = isAccum ? "wpłaty do portfela" : (phaseComponents(phase) || "—");
            return `
                <tr>
                    <td data-label="Etap"><span class="wz-phase-name">${escapeHtml(phase.name)}</span></td>
                    <td data-label="Wiek">${phase.start_age}–${phase.end_age} r.ż.</td>
                    <td data-label="Miesięcznie"><strong>${amount}</strong><span class="wz-phase-kind">${kind}</span></td>
                    <td data-label="Składniki"><span class="wz-phase-components">${components}</span></td>
                </tr>`;
        })
        .join("");
    const hasTopup = phases.some(
        (phase) => phase.key === "retirement_topup" && phase.zus_monthly > 0
    );
    const hasZusOnly = phases.some((phase) => phase.key === "zus_only");
    let note = "";
    if (hasTopup) {
        note = "W etapie „Emerytura + dopłata” kwoty portfela i ZUS sumują się do łącznej wypłaty netto.";
    }
    if (hasZusOnly) {
        note += `${note ? " " : ""}Sama emerytura ZUS po horyzoncie to szacunek z coroczną waloryzacją.`;
    }
    box.innerHTML = `
        <div class="wz-phase-table-wrap">
            <table class="wz-phase-table" aria-label="Szczegóły etapów planu">
                <thead>
                    <tr>
                        <th scope="col">Etap</th>
                        <th scope="col">Wiek</th>
                        <th scope="col">Miesięcznie</th>
                        <th scope="col">Składniki</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${note ? `<p class="wz-phase-note">${note}</p>` : ""}`;
}

function updateFooterNav(n) {
    const count = document.getElementById("wzStepCount");
    if (count) count.textContent = `Krok ${n} / ${WZ_TOTAL_STEPS}`;
    const back = document.getElementById("wzBackBtn");
    if (back) back.classList.toggle("hidden", n === 1);
    const next = document.getElementById("wzNextBtn");
    if (!next) return;
    if (n === 5) {
        next.textContent = "Wylicz plan";
    } else if (n === 6) {
        next.textContent = wzPlan ? "Przejdź do symulatora" : "Wylicz plan";
    } else {
        next.textContent = "Dalej";
    }
    if (n === 5) {
        refreshAllocGate();
    } else {
        next.disabled = false;
    }
}

function saveWizardState() {
    try {
        const state = {
            step: wzNavStep,
            path: currentPath(),
            answers: collectAnswers(),
            capitalSelected: [...wzCapitalSelected],
            pills: [...wzPill],
            weights: wzWeights,
            amounts: wzAmounts,
            allocMode: wzAllocMode,
            strategy: wzStrategyValue,
            assumptions: wzAssumptionsValue,
            estimatedPoolMonthly: wzEstimatedPoolMonthly,
            selectedScenario: wzSelectedScenario,
            retirementTouched: wzRetirementTouched,
            planEndTouched: wzPlanEndTouched,
        };
        localStorage.setItem(WIZARD_STATE_KEY, JSON.stringify(state));
    } catch {
        // ignore storage errors
    }
}

function restoreWizardStateIfRequested() {
    const params = new URLSearchParams(window.location.search || "");
    if (!params.get("restore")) return false;
    const raw = localStorage.getItem(WIZARD_STATE_KEY);
    if (!raw) return false;
    try {
        const st = JSON.parse(raw);
        if (!st || !st.answers) return false;
        const a = st.answers;

        const pathRadio = document.querySelector(`input[name="wzPath"][value="${st.path || 1}"]`);
        if (pathRadio) pathRadio.checked = true;

        const genderRadio = document.querySelector(`input[name="wzGender"][value="${a.gender || "m"}"]`);
        if (genderRadio) genderRadio.checked = true;

        if (a.age_now) applyStep5Value(document.getElementById("wzAge"), a.age_now);

        const empRadio = document.querySelector(`input[name="wzEmployment"][value="${a.employment || "etat"}"]`);
        if (empRadio) {
            empRadio.checked = true;
            empRadio.dispatchEvent(new Event("change"));
        }

        if (a.gross_monthly != null) applyStep5Value(document.getElementById("wzGross"), a.gross_monthly);

        const salModeRadio = document.querySelector(`input[name="wzSalaryMode"][value="${a.salary_mode || "gross"}"]`);
        if (salModeRadio) {
            salModeRadio.checked = true;
            salModeRadio.dispatchEvent(new Event("change"));
        }
        if (a.savings != null) {
            document.getElementById("wzSavings").value = String(a.savings);
            document.getElementById("wzSavings").dispatchEvent(new Event("input", { bubbles: true }));
        }

        // Restore capital accounts
        wzCapitalSelected.clear();
        const grid = document.getElementById("wzCapitalGrid");
        if (grid) grid.innerHTML = "";
        const capKeys = new Set([...(st.capitalSelected || []), ...Object.keys(a.capital || {})]);
        capKeys.forEach((acc) => {
            if (!WZ_CAPITAL_ROWS.includes(acc)) return;
            wzCapitalSelected.add(acc);
            if (grid) {
                grid.appendChild(buildCapitalRow(acc, a.capital?.[acc] || 0));
            }
        });
        refreshCapitalPicker();

        if (a.retire_early_age) applyStep5Value(document.getElementById("wzRe"), a.retire_early_age);
        if (a.retirement_age) {
            wzRetirementTouched = Boolean(st.retirementTouched);
            applyStep5Value(document.getElementById("wzRetirement"), a.retirement_age);
        }
        if (a.plan_end_age) {
            wzPlanEndTouched = Boolean(st.planEndTouched);
            applyStep5Value(document.getElementById("wzPlanEnd"), a.plan_end_age);
        }

        wzPill = new Set(st.pills || []);
        wzWeights = st.weights || {};
        wzAllocMode = st.allocMode || null;
        wzStrategyValue = st.strategy || null;
        wzAssumptionsValue = st.assumptions || "realne";
        wzEstimatedPoolMonthly = st.estimatedPoolMonthly != null ? st.estimatedPoolMonthly : null;
        const restoredPath = st.path || 1;
        if (st.amounts) {
            wzAmounts = { ...st.amounts };
        } else if (restoredPath !== 2 && Object.keys(wzWeights).length) {
            // Migracja starego stanu (tylko procenty): przelicz na kwoty roczne.
            const poolAnnual = (parseFloat(document.getElementById("wzSavings")?.value) || 0) * 12;
            wzAmounts = {};
            if (poolAnnual > 0) {
                Object.entries(wzWeights).forEach(([acc, w]) => {
                    if (w > 0) wzAmounts[acc] = (poolAnnual * w) / 100;
                });
            }
        } else {
            wzAmounts = {};
        }
        wzSelectedScenario = st.selectedScenario || wzAssumptionsValue;

        const assumpRadio = document.querySelector(`input[name="wzAssumptions"][value="${wzAssumptionsValue}"]`);
        if (assumpRadio) assumpRadio.checked = true;
        if (wzStrategyValue) {
            const stratRadio = document.querySelector(`input[name="wzStrategy"][value="${wzStrategyValue}"]`);
            if (stratRadio) stratRadio.checked = true;
        }

        const targetStep = Math.min(5, Math.max(1, st.step || 5));
        if (wzAllocMode) {
            const panel = document.getElementById("wzAllocPanel");
            if (panel) panel.classList.remove("hidden");
        }
        setStep(targetStep);
        return true;
    } catch {
        return false;
    }
}

function finishWizard() {
    if (!wzPlan) return;
    saveWizardState();
    const activeInput = (wzSelectedScenario && wzPlan.scenario_inputs?.[wzSelectedScenario]) || wzPlan.input;
    const draft = {
        gender: activeInput.gender,
        config: activeInput.config,
        stages: activeInput.stages,
    };
    localStorage.setItem("fire.wizardDraft", JSON.stringify(draft));
    window.location.href = "/sim?wizard=1";
}

function currentSalaryMode() {
    return radioChecked("wzSalaryMode") || "gross";
}

function initSavingsMode() {
    const input = document.getElementById("wzSavings");
    const amtRange = document.getElementById("wzSavingsAmtRange");
    if (!input) return;
    input.step = "50";
    input.min = "0";
    input.removeAttribute("max");
    if (amtRange) {
        amtRange.addEventListener("input", () => {
            input.value = String(Math.max(0, parseFloat(amtRange.value) || 0));
            updateSavingsWarn();
            updateSavingsHint();
        });
    }
    input.addEventListener("input", () => {
        if (amtRange) {
            amtRange.value = String(
                Math.min(
                    parseFloat(amtRange.max) || 0,
                    Math.max(0, parseFloat(input.value) || 0)
                )
            );
        }
        updateSavingsWarn();
        updateSavingsHint();
    });
    if ((parseFloat(input.value) || 0) <= 0) input.value = "1000";
    updateSavingsAmtMax();
    updateSavingsHint();
    updateSavingsWarn();
}

function updateSavingsAmtMax() {
    const amtRange = document.getElementById("wzSavingsAmtRange");
    const input = document.getElementById("wzSavings");
    if (!amtRange || !input) return;
    // Net is the real capacity for an etat. Without a known salary (B2B,
    // unemployed) leave a generous fallback so outside money can still be saved.
    const cap = wzNetMonthly != null && wzNetMonthly > 0 ? wzNetMonthly : 10000;
    const max = Math.max(50, Math.floor(cap / 50) * 50);
    amtRange.max = String(max);
    amtRange.value = String(Math.min(max, Math.max(0, parseFloat(input.value) || 0)));
    updateSavingsWarn();
    updateSavingsHint();
}

function updateSavingsHint() {
    const hint = document.getElementById("wzSavingsHint");
    const input = document.getElementById("wzSavings");
    if (!hint || !input) return;
    const amount = Math.max(0, parseFloat(input.value) || 0);
    if (wzNetMonthly != null && wzNetMonthly > 0) {
        const pct = Math.round((amount / wzNetMonthly) * 1000) / 10;
        hint.textContent = `${fmtZloty(amount)} zł/mies. = ${String(pct).replace(".", ",")}% pensji netto`;
    } else {
        hint.textContent = `${fmtZloty(amount)} zł/mies.`;
    }
    hint.hidden = false;
}

function updateSavingsWarn() {
    const warn = document.getElementById("wzSavingsWarn");
    if (!warn) return;
    const amount = Math.max(
        0,
        parseFloat(document.getElementById("wzSavings")?.value) || 0
    );
    const employment = radioChecked("wzEmployment") || "etat";
    const gross = parseFloat(document.getElementById("wzGross")?.value) || 0;
    let msg = "";
    if (employment === "niepracujacy" && amount > 0) {
        msg = "Nie pracujesz — upewnij się, że masz inne źródło finansowania tych wpłat.";
    } else if (employment === "b2b" && gross > 0 && amount > gross) {
        msg = "Odkładasz więcej, niż wynosi pensja brutto (" + fmtZloty(gross) + " zł/mc).";
    } else if (wzNetMonthly != null && wzNetMonthly > 0 && amount > wzNetMonthly) {
        msg = "Odkładasz więcej, niż wynosi pensja netto (" + fmtZloty(wzNetMonthly) + " zł/mc).";
    }
    warn.textContent = msg;
    warn.hidden = !msg;
}

async function updateSalaryHint() {
    const hint = document.getElementById("wzSalaryHint");
    const label = document.getElementById("wzGrossLabel");
    const modeGroup = document.getElementById("wzSalaryMode");
    const grossInput = document.getElementById("wzGross");
    if (!hint || !grossInput) return;
    const employment = radioChecked("wzEmployment") || "etat";
    const mode = currentSalaryMode();
    const etat = employment === "etat";

    if (modeGroup) modeGroup.classList.toggle("hidden", !etat);
    const labelText = etat && mode === "net" ? "Pensja netto (mies.)" : "Pensja brutto (mies.)";
    if (label) label.textContent = labelText;
    const range = document.getElementById("wzGrossRange");
    if (range) range.setAttribute("aria-label", labelText);

    if (employment === "niepracujacy") {
        wzNetMonthly = null;
        hint.textContent = "";
        hint.hidden = true;
        updateSavingsAmtMax();
        return;
    }
    if (employment === "b2b") {
        wzNetMonthly = null;
        hint.textContent = "Podaj brutto — netto zależy od formy opodatkowania.";
        hint.hidden = false;
        updateSavingsAmtMax();
        return;
    }

    const amount = Math.max(0, parseFloat(grossInput.value) || 0);
    if (amount <= 0) {
        wzNetMonthly = 0;
        hint.textContent = "Podaj pensję, aby zobaczyć kwotę netto.";
        hint.hidden = false;
        updateSavingsAmtMax();
        return;
    }

    const seq = ++wzSalaryPreviewSeq;
    hint.textContent = "Liczę kwotę netto…";
    hint.hidden = false;
    try {
        const res = await fetch("/api/wizard/salary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                salary_mode: mode,
                amount,
                employment,
                use_ppk: isCapActive("ppk"),
                ppk_employee_pct: 0.02,
            }),
        });
        if (seq !== wzSalaryPreviewSeq) return;
        if (!res.ok) throw new Error("salary preview failed");
        const data = await res.json();
        if (seq !== wzSalaryPreviewSeq) return;
        wzNetMonthly = data.net_monthly;
        if (mode === "net") {
            hint.textContent = `≈ ${fmtZloty(data.gross_monthly)} zł/mies. brutto`;
        } else {
            hint.textContent = `≈ ${fmtZloty(data.net_monthly)} zł/mies. netto`;
        }
    } catch {
        if (seq !== wzSalaryPreviewSeq) return;
        wzNetMonthly = null;
        hint.textContent = "Nie udało się obliczyć kwoty netto.";
    }
    updateSavingsAmtMax();
}

function initEmploymentToggle() {
    const group = document.getElementById("wzGrossGroup");
    const gross = document.getElementById("wzGross");
    const range = document.getElementById("wzGrossRange");
    if (!group || !gross) return;
    let lastGross = parseFloat(gross.value) || 8000;
    const sync = () => {
        const employment = radioChecked("wzEmployment") || "etat";
        const disabled = employment === "niepracujacy";
        if (disabled) {
            lastGross = parseFloat(gross.value) || lastGross;
            gross.value = "0";
        } else if (gross.value === "0" || gross.value === "") {
            gross.value = String(lastGross || 8000);
        }
        gross.disabled = disabled;
        group.classList.toggle("is-disabled", disabled);
        group.querySelectorAll(".stepper").forEach((b) => (b.disabled = disabled));
        if (employment !== "etat") {
            const grossMode = document.querySelector('input[name="wzSalaryMode"][value="gross"]');
            if (grossMode) grossMode.checked = true;
        }
        if (range) {
            range.disabled = disabled;
            range.value = String(Math.min(100000, Math.max(0, parseFloat(gross.value) || 0)));
        }
        updateSalaryHint();
    };
    document.querySelectorAll('input[name="wzEmployment"]').forEach((r) => {
        r.addEventListener("change", sync);
    });
    document.querySelectorAll('input[name="wzSalaryMode"]').forEach((r) => {
        r.addEventListener("change", () => updateSalaryHint());
    });
    sync();
}

function bindSliderRange(range, input, min, max, onChange) {
    if (!range || !input) return;
    const clamp = (v) => Math.min(max, Math.max(min, v));
    const after = () => {
        if (typeof onChange === "function") onChange();
    };
    range.addEventListener("input", () => {
        input.value = String(clamp(parseFloat(range.value) || min));
        after();
    });
    input.addEventListener("input", () => {
        range.value = String(clamp(parseFloat(input.value) || min));
        after();
    });
}

// --- Krok 4: Cel i horyzont (domyślne wg płci i wieku) ----------------------

function planEndDefault(gender, age) {
    const table = LIFE_EXPECTANCY[gender] || LIFE_EXPECTANCY.m;
    const years = table[age]
        ?? (age < 16 ? table[16] : age > 90 ? table[90] : 0);
    return Math.min(120, Math.max(2, age + Math.round(years)));
}

function applyStep5Value(input, value) {
    if (!input) return;
    input.value = String(value);
    const range = document.getElementById(input.id + "Range");
    if (range) {
        const lo = parseFloat(range.min) ?? value;
        const hi = parseFloat(range.max) ?? value;
        range.value = String(Math.min(hi, Math.max(lo, value)));
    }
}

function applyGenderDefaults() {
    const gender = radioChecked("wzGender") || "m";
    const age = parseInt(document.getElementById("wzAge")?.value, 10) || 0;
    const retirement = document.getElementById("wzRetirement");
    const planEnd = document.getElementById("wzPlanEnd");
    if (retirement && !wzRetirementTouched) applyStep5Value(retirement, RETIREMENT_DEFAULT[gender]);
    if (planEnd && !wzPlanEndTouched) applyStep5Value(planEnd, planEndDefault(gender, age));
}

function initGoalHorizon() {
    bindSliderRange(document.getElementById("wzTargetRange"), document.getElementById("wzTarget"), 0, 50000);
    bindSliderRange(document.getElementById("wzReRange"), document.getElementById("wzRe"), 16, 95);
    bindSliderRange(document.getElementById("wzRetirementRange"), document.getElementById("wzRetirement"), 50, 95);
    bindSliderRange(document.getElementById("wzPlanEndRange"), document.getElementById("wzPlanEnd"), 65, 115);
    ["wzRetirement", "wzRetirementRange"].forEach((id) => {
        document.getElementById(id)?.addEventListener("input", () => { wzRetirementTouched = true; });
    });
    ["wzPlanEnd", "wzPlanEndRange"].forEach((id) => {
        document.getElementById(id)?.addEventListener("input", () => { wzPlanEndTouched = true; });
    });
    document.querySelectorAll('input[name="wzGender"]').forEach((r) => {
        r.addEventListener("change", applyGenderDefaults);
    });
    document.getElementById("wzAge")?.addEventListener("input", () => {
        if (wzPlanEndTouched) return;
        const gender = radioChecked("wzGender") || "m";
        const age = parseInt(document.getElementById("wzAge").value, 10) || 0;
        applyStep5Value(document.getElementById("wzPlanEnd"), planEndDefault(gender, age));
    });
    applyGenderDefaults();
}

// --- Krok 5: Strategia, założenia i podział oszczędności ---------------------

function fmtZloty(v) {
    return Math.round(v).toLocaleString("pl-PL");
}

function fmtApproxPct(weight) {
    if (!Number.isFinite(weight) || weight <= 0) return "0%";
    const rounded = Math.round(weight);
    return rounded < 1 ? "<1%" : `≈${rounded}%`;
}

function wzActiveAllocAccounts() {
    return WZ_ALLOC_ACCOUNTS.filter((acc) => isCapActive(acc));
}

function wzIsPath2() {
    return currentPath() === 2;
}

function wzPoolMonthly() {
    if (currentPath() === 2) {
        if (wzPlan && wzPlan.solved && wzPlan.solved.savings_monthly != null) {
            return wzPlan.solved.savings_monthly;
        }
        if (wzEstimatedPoolMonthly != null) {
            return wzEstimatedPoolMonthly;
        }
        return null;
    }
    const v = parseFloat(document.getElementById("wzSavings").value) || 0;
    return v;
}

function wzPoolAnnual() {
    const monthly = wzPoolMonthly();
    return monthly == null ? null : monthly * 12;
}

function wzShelterCap(acc) {
    if (!wzLimits) return 0;
    if (acc === "ikze") {
        const emp = radioChecked("wzEmployment") || "etat";
        return emp === "b2b" ? wzLimits.ikze_annual_self_employed : wzLimits.ikze_annual;
    }
    if (acc === "ike") return wzLimits.ike_annual;
    if (acc === "oipe") return wzLimits.oipe_annual;
    return 0;
}

// Path 1/3: the annual amount is the source of truth. Path 2: the weight is.
function wzAllocAmountAnnual(acc) {
    if (wzIsPath2()) {
        const poolAnnual = wzPoolAnnual();
        if (poolAnnual == null) return null;
        return ((wzWeights[acc] || 0) / 100) * poolAnnual;
    }
    return wzAmounts[acc] || 0;
}

function wzOtherAmountAnnual(excludeAcc) {
    let total = 0;
    wzActiveAllocAccounts().forEach((acc) => {
        if (acc === excludeAcc) return;
        const amount = wzAllocAmountAnnual(acc);
        if (amount != null) total += amount;
    });
    return total;
}

function wzMaxAmountFor(acc) {
    const poolAnnual = wzPoolAnnual();
    if (poolAnnual == null) return null;
    const remaining = Math.max(0, poolAnnual - wzOtherAmountAnnual(acc));
    const cap = wzShelterCap(acc);
    return cap ? Math.min(remaining, cap) : remaining;
}

function wzSyncWeightsFromAmounts() {
    if (wzIsPath2()) return;
    const poolAnnual = wzPoolAnnual();
    const next = {};
    if (poolAnnual != null && poolAnnual > 0) {
        wzActiveAllocAccounts().forEach((acc) => {
            const amount = Math.max(0, wzAmounts[acc] || 0);
            if (amount > 0) next[acc] = (amount / poolAnnual) * 100;
        });
    }
    wzWeights = next;
}

function wzSyncAmountsFromWeights() {
    const poolAnnual = wzPoolAnnual();
    const next = {};
    if (poolAnnual != null && poolAnnual > 0) {
        wzActiveAllocAccounts().forEach((acc) => {
            const weight = wzWeights[acc] || 0;
            if (weight > 0) next[acc] = (weight / 100) * poolAnnual;
        });
    }
    wzAmounts = next;
}

// Gdy pula maleje, przycinamy przypisane kwoty proporcjonalnie. Gdy rośnie,
// kwoty zostają bez zmian, a różnica trafia do Gotówki.
function wzReconcileAmounts() {
    if (wzIsPath2()) return;
    const poolAnnual = wzPoolAnnual();
    if (poolAnnual == null || poolAnnual <= 0) return;
    const active = wzActiveAllocAccounts();
    active.forEach((acc) => {
        const cap = wzShelterCap(acc);
        if (cap) wzAmounts[acc] = Math.min(wzAmounts[acc] || 0, cap);
    });
    const total = active.reduce((sum, acc) => sum + Math.max(0, wzAmounts[acc] || 0), 0);
    if (total > poolAnnual + 0.5) {
        const scale = poolAnnual / total;
        active.forEach((acc) => {
            if ((wzAmounts[acc] || 0) > 0) wzAmounts[acc] *= scale;
        });
    }
}

function setWzAmount(acc, value) {
    const poolAnnual = wzPoolAnnual();
    if (poolAnnual == null || poolAnnual <= 0) return;
    const max = wzMaxAmountFor(acc);
    const clamped = Math.max(0, Math.min(max == null ? value : max, value));
    if (wzIsPath2()) {
        wzWeights[acc] = (clamped / poolAnnual) * 100;
    } else {
        wzAmounts[acc] = clamped;
        wzSyncWeightsFromAmounts();
    }
    refreshAllocationDisplay();
}

function refreshAllocationDisplay() {
    wzReconcileAmounts();
    wzSyncWeightsFromAmounts();

    const poolMonthly = wzPoolMonthly();
    const poolKnown = poolMonthly != null;
    const poolAnnual = poolKnown ? poolMonthly * 12 : null;
    let usedAnnual = 0;
    let anyOverflow = false;

    wzActiveAllocAccounts().forEach((acc) => {
        const amount = wzAllocAmountAnnual(acc);
        const cap = wzShelterCap(acc);
        const eff = amount == null ? 0 : cap ? Math.min(amount, cap) : amount;
        if (amount != null) usedAnnual += eff;
        const weight = poolAnnual && poolAnnual > 0
            ? (eff / poolAnnual) * 100
            : (wzIsPath2() ? wzWeights[acc] || 0 : 0);
        const maxAmount = wzMaxAmountFor(acc);

        const input = document.querySelector(`.wz-alloc-annual .acc-field[data-account="${acc}"]`);
        const annualStatic = document.querySelector(`.wz-alloc-annual-static[data-account="${acc}"]`);
        const range = document.querySelector(`.wz-alloc-range[data-account="${acc}"]`);
        const moneyEl = document.querySelector(`.wz-alloc-money[data-account="${acc}"]`);
        const pctEl = document.querySelector(`.wz-alloc-pct[data-account="${acc}"]`);
        const capEl = document.querySelector(`.wz-alloc-cap[data-account="${acc}"]`);
        const overflowEl = document.querySelector(`.wz-alloc-overflow[data-account="${acc}"]`);

        if (input) {
            const next = amount == null ? 0 : Math.round(eff);
            if ((parseFloat(input.value) || 0) !== next) input.value = String(next);
            input.disabled = maxAmount == null;
            if (maxAmount != null) input.max = String(Math.max(0, Math.floor(maxAmount)));
        }
        if (annualStatic) {
            annualStatic.textContent = amount == null ? "—" : `${fmtZloty(eff)} zł/rok`;
        }
        if (range) {
            range.disabled = maxAmount == null;
            if (maxAmount == null) {
                range.max = "0";
            } else {
                range.max = String(Math.max(0, Math.floor(maxAmount)));
                range.value = String(Math.round(eff));
            }
        }
        if (moneyEl) {
            moneyEl.textContent = amount == null ? "—" : `≈${fmtZloty(eff / 12)} zł/mies.`;
        }
        if (pctEl) {
            pctEl.textContent = poolKnown ? fmtApproxPct(weight) : "—";
        }
        if (capEl) {
            if (!cap) {
                capEl.textContent = "";
                capEl.classList.add("hidden");
            } else {
                capEl.classList.remove("hidden");
                capEl.textContent = amount != null && amount >= cap - 0.5
                    ? `limit roczny osiągnięty (${fmtZloty(cap)} zł)`
                    : `limit roczny: ${fmtZloty(cap)} zł`;
            }
        }
        if (overflowEl) {
            const overflowMonthly = amount == null ? 0 : (amount - eff) / 12;
            // Nadwyżki poniżej 1 zł/mies. to artefakt zaokrągleń — nie zaśmiecaj UI.
            if (Math.round(overflowMonthly) >= 1) {
                overflowEl.textContent = `nadwyżka ${fmtZloty(overflowMonthly)} zł/mies. → Gotówka`;
                overflowEl.classList.remove("hidden");
                anyOverflow = true;
            } else {
                overflowEl.textContent = "";
                overflowEl.classList.add("hidden");
            }
        }
    });

    const usedPct = poolAnnual && poolAnnual > 0 ? (usedAnnual / poolAnnual) * 100 : 0;
    const over = usedPct > 100 + 1e-6;
    document.querySelectorAll(".wz-alloc-row:not(.wz-alloc-cash-row)").forEach((r) => r.classList.toggle("is-over", over));

    const header = document.getElementById("wzAllocHeader");
    const cashNote = document.getElementById("wzAllocCashNote");
    if (header) {
        if (!poolKnown) {
            header.innerHTML = `Wybierz strategię poniżej — Asystent oszacuje wymaganą pulę oszczędności dla Twojego celu.`;
        } else if (currentPath() === 2) {
            header.innerHTML = `Szacowana pula do rozdysponowania: <strong>${fmtZloty(poolAnnual)} zł/rok</strong> (${fmtZloty(poolMonthly)} zł/mies.)`;
        } else {
            header.innerHTML = `Odkładasz <strong>${fmtZloty(poolAnnual)} zł/rok</strong> (${fmtZloty(poolMonthly)} zł/mies.)`;
        }
    }
    if (cashNote) cashNote.hidden = !poolKnown;

    const cashAnnual = poolKnown ? Math.max(0, poolAnnual - usedAnnual) : 0;
    const cashPct = poolAnnual && poolAnnual > 0 ? (cashAnnual / poolAnnual) * 100 : 0;
    const cashRow = document.getElementById("wzAllocCashRow");
    if (cashRow) {
        const readonly = wzAllocMode === "auto";
        cashRow.classList.toggle("is-over", over);
        cashRow.classList.toggle("wz-alloc-readonly", readonly);
        const range = cashRow.querySelector(".wz-alloc-range");
        if (range && !readonly) range.value = String(Math.round(cashPct));
        const annual = document.getElementById("wzAllocCashAnnual");
        if (annual) annual.textContent = poolKnown ? `${fmtZloty(cashAnnual)} zł/rok` : "—";
        const money = document.getElementById("wzAllocCashMoney");
        if (money) money.textContent = poolKnown ? `≈${fmtZloty(cashAnnual / 12)} zł/mies.` : "—";
        const pct = document.getElementById("wzAllocCashPct");
        if (pct) pct.textContent = poolKnown ? fmtApproxPct(cashPct) : "—";
    }

    const cash = document.getElementById("wzAllocCash");
    if (cash) {
        const notes = [];
        if (poolKnown && currentPath() === 2) {
            notes.push("Podział proporcjonalny — kwoty przeliczą się po wyliczeniu wymaganej puli.");
        }
        if (poolKnown && anyOverflow) {
            notes.push("Nadwyżka ponad limit trafia do Gotówki — rozważ uaktywnienie kolejnego instrumentu pastylką poniżej.");
        }
        cash.textContent = notes.join(" ");
    }
    const sum = document.getElementById("wzAllocSum");
    if (sum) {
        sum.textContent = poolKnown
            ? `Rozdysponowano: ${fmtZloty(usedAnnual)} zł/rok (${fmtApproxPct(usedPct)})`
            : "—";
        sum.classList.toggle("wz-alloc-over", over);
        sum.classList.toggle("wz-alloc-ok", !over && usedPct >= 99.999);
    }
}

function bindAllocInputs() {
    document.querySelectorAll(".wz-alloc-grid .wz-alloc-range").forEach((range) => {
        range.addEventListener("input", () => setWzAmount(range.dataset.account, parseFloat(range.value) || 0));
    });
    document.querySelectorAll(".wz-alloc-grid .wz-alloc-annual .acc-field").forEach((input) => {
        input.addEventListener("input", () => setWzAmount(input.dataset.account, parseFloat(input.value) || 0));
    });
}

function buildAllocationStep() {
    const grid = document.getElementById("wzAllocGrid");
    if (!grid) return;
    const readonly = wzAllocMode === "auto";
    wzReconcileAmounts();
    grid.innerHTML = "";
    wzActiveAllocAccounts().forEach((acc) => {
        const icon = accountIcon(acc);
        const label = capitalLabel(acc);
        const amount = wzAllocAmountAnnual(acc);
        const maxAmount = wzMaxAmountFor(acc);
        const maxAttr = maxAmount == null ? "" : String(Math.max(0, Math.floor(maxAmount)));
        const value = amount == null ? 0 : Math.round(amount);
        const cap = wzShelterCap(acc);
        const labelTip = cap ? `title="Limit roczny wpłat: ${fmtZloty(cap)} zł"` : "";
        const wrap = document.createElement("div");
        wrap.className = "wz-alloc-row" + (readonly ? " wz-alloc-readonly" : "");
        wrap.innerHTML = readonly
            ? `
            <div class="wz-alloc-label" ${labelTip}><span class="wz-alloc-icon">${icon}</span>${label}</div>
            <span class="wz-alloc-annual wz-alloc-annual-static" data-account="${acc}" aria-label="Wpłata roczna ${label}">—</span>
            <span class="wz-alloc-money" data-account="${acc}">—</span>
            <span class="wz-alloc-pct" data-account="${acc}">—</span>
            <span class="wz-alloc-cap hidden" data-account="${acc}"></span>
            <span class="wz-alloc-overflow hidden" data-account="${acc}"></span>`
            : `
            <div class="wz-alloc-label" ${labelTip}><span class="wz-alloc-icon">${icon}</span>${label}</div>
            <div class="wz-alloc-annual">
                ${numControlsHtml({
                    value,
                    min: "0",
                    max: maxAttr,
                    step: "10",
                    fieldClass: "wz-alloc-annual-input",
                    aria: `Wpłata roczna ${label}`,
                    attrs: ` data-account="${acc}"`,
                })}
                <span class="wz-alloc-unit">zł/rok</span>
            </div>
            <input type="range" class="wz-alloc-range" data-account="${acc}" min="0" max="${maxAttr || 0}" step="10" value="${value}" aria-label="Wpłata roczna ${label}">
            <span class="wz-alloc-money" data-account="${acc}">—</span>
            <span class="wz-alloc-pct" data-account="${acc}">—</span>
            <span class="wz-alloc-cap hidden" data-account="${acc}"></span>
            <span class="wz-alloc-overflow hidden" data-account="${acc}"></span>`;
        if (!readonly && capitalSaldo(acc) <= 0) {
            const rm = document.createElement("button");
            rm.type = "button";
            rm.className = "btn btn-ghost btn-icon btn-sm wz-pill-remove";
            rm.innerHTML = iconSvg("x");
            rm.title = "Usuń";
            rm.setAttribute("aria-label", `Usuń ${label}`);
            rm.addEventListener("click", () => {
                deactivateAllocAccount(acc);
            });
            wrap.appendChild(rm);
        }
        grid.appendChild(wrap);
    });
    if (!readonly && wzAllocMode === "manual") {
        renderPayrollActive();
        buildAllocationPills();
        bindAllocInputs();
    } else {
        const pills = document.getElementById("wzAllocPillsPanel");
        if (pills) pills.classList.add("hidden");
        const payroll = document.getElementById("wzPayrollPanel");
        if (payroll) payroll.classList.add("hidden");
    }
    refreshAllocationDisplay();
    if (wzAllocMode === "manual" && currentPath() === 2 && wzPoolMonthly() == null) {
        ensureWzPoolEstimate();
    }
}

function renderPayrollActive() {
    const box = document.getElementById("wzPayrollActive");
    const panel = document.getElementById("wzPayrollPanel");
    if (!box) return;
    box.innerHTML = "";
    const list = [...WZ_PAYROLL].filter((acc) => isCapActive(acc));
    if (panel) panel.classList.toggle("hidden", !list.length);
    box.classList.toggle("hidden", !list.length);
    list.forEach((acc) => {
        const icon = accountIcon(acc);
        const row = document.createElement("div");
        row.className = "wz-alloc-row wz-alloc-info";
        row.innerHTML = `<div class="wz-alloc-label"><span class="wz-alloc-icon">${icon}</span>${capitalLabel(acc)}</div>`;
        const note = document.createElement("span");
        note.className = "wz-alloc-note";
        note.textContent = "wpłaty z pensji, dodatkowe do oszczędności";
        row.appendChild(note);
        if (capitalSaldo(acc) <= 0) {
            const rm = document.createElement("button");
            rm.type = "button";
            rm.className = "btn btn-ghost btn-icon btn-sm wz-pill-remove";
            rm.innerHTML = iconSvg("x");
            rm.title = "Usuń";
            rm.setAttribute("aria-label", `Usuń ${capitalLabel(acc)}`);
            rm.addEventListener("click", () => {
                deactivateAllocAccount(acc);
            });
            row.appendChild(rm);
        }
        box.appendChild(row);
    });
}

function buildAllocationPills() {
    const box = document.getElementById("wzAllocPills");
    const panel = document.getElementById("wzAllocPillsPanel");
    if (!box) return;
    box.innerHTML = "";
    const missing = WZ_ALLOC_ACCOUNTS.filter((acc) => !isCapActive(acc));
    const payrollMissing = [...WZ_PAYROLL].filter((acc) => !isCapActive(acc));
    if (!missing.length && !payrollMissing.length) {
        if (panel) panel.classList.add("hidden");
        box.classList.add("hidden");
        return;
    }
    if (panel) panel.classList.remove("hidden");
    const wrap = document.createElement("div");
    wrap.className = "pill-grid wz-pills";
    const pill = (acc) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pill-toggle wz-pill";
        b.dataset.account = acc;
        const payrollSub = WZ_PAYROLL.has(acc)
            ? `<span class="pill-sub">wpłaty z pensji</span>`
            : "";
        b.innerHTML = `${accountIcon(acc)}<span>${capitalLabel(acc)}</span>${payrollSub}`;
        b.addEventListener("click", () => {
            togglePill(acc);
            buildAllocationStep();
        });
        wrap.appendChild(b);
    };
    missing.forEach(pill);
    payrollMissing.forEach(pill);
    box.appendChild(wrap);
    box.classList.remove("hidden");
}

async function runSuggestAllocation() {
    const loader = document.getElementById("wzSuggestLoader");
    if (loader) loader.classList.remove("hidden");
    try {
        const path = currentPath();
        const target = path !== 1 ? (parseFloat(document.getElementById("wzTarget")?.value) || null) : null;
        const data = await postJson(
            "/api/wizard/suggest",
            { answers: collectAnswers(), path: path, target_monthly: target },
            "Błąd sugestii."
        );
        if (data.pool_monthly != null) {
            wzEstimatedPoolMonthly = data.pool_monthly;
        }
        wzWeights = {};
        Object.entries(data.allocations || {}).forEach(([acc, v]) => {
            if (acc !== "gotowka") {
                wzWeights[acc] = v;
                wzPill.add(acc);
            }
        });
        wzSyncAmountsFromWeights();
        buildAllocationStep();
    } catch (err) {
        alert("Błąd: " + err.message);
    } finally {
        if (loader) loader.classList.add("hidden");
        refreshAllocGate();
    }
}

// W ścieżce 2 pula zależy od celu — ręczny podział potrzebuje szacunku, żeby
// pokazać kwoty roczne. Pobieramy tylko pool_monthly, nie nadpisując wag.
async function ensureWzPoolEstimate() {
    if (wzPoolEstimatePending) return;
    if (currentPath() !== 2 || wzPoolMonthly() != null) return;
    const target = parseFloat(document.getElementById("wzTarget")?.value) || 0;
    if (target <= 0) return;
    wzPoolEstimatePending = true;
    try {
        const data = await postJson(
            "/api/wizard/suggest",
            { answers: collectAnswers(), path: 2, target_monthly: target },
            "Błąd szacowania puli."
        );
        if (data.pool_monthly != null) {
            wzEstimatedPoolMonthly = data.pool_monthly;
            buildAllocationStep();
        }
    } catch {
        // best-effort — kwoty pozostaną nieznane do czasu wyliczenia planu
    } finally {
        wzPoolEstimatePending = false;
    }
}

function setAllocMode(mode) {
    wzAllocMode = mode;
    const panel = document.getElementById("wzAllocPanel");
    if (panel) panel.classList.toggle("hidden", !mode);
    buildAllocationStep();
    refreshAllocGate();
}

async function loadWzLimits() {
    if (wzLimits) return;
    try {
        const res = await fetch("/api/config");
        if (!res.ok) return;
        const cfg = await res.json();
        wzLimits = cfg.limits;
        const step = document.querySelector(".wz-step:not(.hidden)");
        if (step && parseInt(step.dataset.step, 10) === 5) buildAllocationStep();
    } catch {
        // best-effort
    }
}

function initStrategyAndAssumptions() {
    const stratOpts = document.querySelectorAll('input[name="wzStrategy"]');
    stratOpts.forEach((r) => {
        r.addEventListener("change", () => {
            if (!r.checked) return;
            wzStrategyValue = r.value;
            if (wzStrategyValue === "manualna") {
                setAllocMode("manual");
            } else {
                setAllocMode("auto");
                runSuggestAllocation();
            }
            saveWizardState();
        });
    });

    const assumpOpts = document.querySelectorAll('input[name="wzAssumptions"]');
    assumpOpts.forEach((r) => {
        r.addEventListener("change", () => {
            if (!r.checked) return;
            wzAssumptionsValue = r.value;
            if (wzNavStep === 5 && wzAllocMode === "auto" && currentPath() === 2) {
                runSuggestAllocation();
            }
            saveWizardState();
        });
    });
}

function syncPathUI() {
    const goalField = document.getElementById("wzGoalField");
    const reGroup = document.getElementById("wzReGroup");
    const savingsPanel = document.getElementById("wzSavingsPanel");
    const step4Title = document.getElementById("wzStep4Title");
    const step4Sub = document.getElementById("wzStep4Subtitle");
    const path = currentPath();
    if (goalField) goalField.classList.toggle("hidden", path === 1);
    if (reGroup) reGroup.classList.toggle("hidden", path === 3);
    if (savingsPanel) savingsPanel.classList.toggle("hidden", path === 2);

    if (step4Title && step4Sub) {
        if (path === 1) {
            step4Title.textContent = "Kiedy chcesz przejść na FIRE?";
            step4Sub.textContent = "Podaj planowany wiek rezygnacji z pracy oraz horyzont czasowy wypłat — wyliczymy maksymalną bezpieczną kwotę na rękę.";
        } else if (path === 2) {
            step4Title.textContent = "Twój cel wypłaty i wiek FIRE";
            step4Sub.textContent = "Podaj kwotę miesięcznej wypłaty netto, na której Ci zależy, oraz wiek przejścia na FIRE — wyliczymy, ile musisz odkładać.";
        } else {
            step4Title.textContent = "Wymarzona wypłata i horyzont";
            step4Sub.textContent = "Podaj kwotę miesięcznej wypłaty netto, którą chcesz otrzymywać — sprawdzimy, w jakim wieku możesz przestać pracować.";
        }
    }
}

function initSteppers() {
    initNumControls(document.querySelector(".wizard"));
}

function initNav() {
    document.getElementById("wzNextBtn").addEventListener("click", () => {
        const n = wzNavStep;
        if (n === 6) {
            if (wzPlan) {
                finishWizard();
            } else {
                runPlan();
            }
            return;
        }
        if (!validateStep(n)) return;
        if (n === 5) {
            setStep(6, true);
            runPlan();
            return;
        }
        setStep(n + 1, true);
    });
    document.getElementById("wzBackBtn").addEventListener("click", () => {
        if (wzNavStep > 1) setStep(wzNavStep - 1, true);
    });
    const tip = document.getElementById("wzNextTip");
    if (tip) {
        tip.addEventListener("click", (e) => {
            if (e.target !== tip) return;
            if (wzNavStep === 5 && !allocReady()) {
                e.preventDefault();
                showAllocGatePop();
            }
        });
    }
}

function initWizard() {
    buildCapitalGrid();
    initSteppers();
    initSavingsMode();
    initEmploymentToggle();
    bindSliderRange(document.getElementById("wzGrossRange"), document.getElementById("wzGross"), 0, 100000, updateSalaryHint);
    bindSliderRange(document.getElementById("wzAgeRange"), document.getElementById("wzAge"), 16, 90);
    initGoalHorizon();
    initStrategyAndAssumptions();
    syncPathUI();
    document.querySelectorAll('input[name="wzPath"]').forEach((r) => {
        r.addEventListener("change", () => {
            wzEstimatedPoolMonthly = null;
            syncPathUI();
            saveWizardState();
        });
    });
    initNav();
    loadWzLimits();
    if (!restoreWizardStateIfRequested()) {
        setStep(1);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initWizard();
});
