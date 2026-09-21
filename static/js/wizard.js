// wizard.js — Asystent FIRE: 3 ścieżki planowania oparte o backend planner.py

const WZ_TOTAL_STEPS = 7;

// Step 3 rows: every account is a plain balance field — participation follows
// the declared capital (zero/nonzero). OFE lives as its own row beneath ZUS.
const WZ_CAPITAL_ROWS = [
    "gotowka", "zus", "zus:ofe", "ppk", "ppe",
    "ike", "ikze", "oipe", "oki_inw", "oki_osk",
    "krypto", "lokata", "obligacje", "broker",
];

// Accounts allocatable from the discretionary pool (sliders + pills in step 4).
// Payroll vehicles (ZUS, PPK, PPE) are excluded — savings can't be routed there.
const WZ_ALLOC_ACCOUNTS = [
    "broker", "ikze", "ike", "oipe",
    "krypto", "lokata", "obligacje", "oki_inw", "oki_osk",
];

// Always present: the cash sink and the ZUS state pension.
const WZ_ALWAYS_ON = new Set(["gotowka", "zus"]);

// Payroll-funded vehicles — participation is toggled with pills in step 4,
// contributions come from the salary, never from the discretionary pool.
const WZ_PAYROLL = new Set(["ppk", "ppe"]);

// Ustawowy wiek emerytalny wg płci (spójny z config.zus.wiek_emerytalny_*).
const RETIREMENT_DEFAULT = { k: 60, m: 65 };

// Średnie dalsze trwanie życia (lata) wg wieku i płci — GUS, tablica trwania
// życia za 2024 r. Domyślny „Koniec planu" = obecny wiek + wartość z tabeli.
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

// Etykiety kont: ACCOUNT_LABELS (sim-metadata.js) + kontekstowe nadpisania (krok 3).
const WZ_CAPITAL_OVERRIDES = { zus: "ZUS", "zus:ofe": "OFE" };

// Accounts added explicitly via the step-4 pills (no capital, participation only).
let wzPill = new Set();
let wzPlan = null;
let wzNavStep = 1;
let wzWeights = {};
let wzLimits = null;
let wzStrategyValue = "zbilansowana";
let wzAllocMode = null;
let wzRetirementTouched = false;
let wzPlanEndTouched = false;

function capitalLabel(account) {
    return WZ_CAPITAL_OVERRIDES[account] || ACCOUNT_LABELS[account] || account;
}

function radioChecked(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
}

function numControl(account, ariaLabel) {
    return numControlsHtml({
        value: "0",
        min: "0",
        step: "1000",
        fieldClass: "wz-capital-input",
        aria: ariaLabel || account,
        attrs: ` data-account="${account}"`,
    });
}

function buildCapitalGrid() {
    const grid = document.getElementById("wzCapitalGrid");
    grid.innerHTML = "";
    WZ_CAPITAL_ROWS.forEach((account) => {
        const icon = ACCOUNT_ICONS[account] || "";
        const wrap = document.createElement("div");
        wrap.className = "wz-capital-item wz-instrument-row";
        wrap.innerHTML = `
            <label class="wz-instrument-name">${icon} ${capitalLabel(account)}</label>
            <div class="wz-instrument-fields">
                ${numControl(account, capitalLabel(account))}
            </div>`;
        grid.appendChild(wrap);
    });
}

function capitalSaldo(account) {
    const el = document.querySelector(`.wz-capital-input[data-account="${account}"]`);
    return parseFloat(el && el.value) || 0;
}

function isCapActive(account) {
    if (WZ_ALWAYS_ON.has(account)) return true;
    return capitalSaldo(account) > 0 || wzPill.has(account);
}

function togglePill(account) {
    const on = isCapActive(account);
    if (on && !WZ_ALWAYS_ON.has(account) && capitalSaldo(account) <= 0) {
        wzPill.delete(account);
        delete wzWeights[account];
    } else if (!on) {
        wzPill.add(account);
    }
}

// Dezaktywacja instrumentu (przycisk „Usuń” wiersza / payroll) — czyści też
// wagę, żeby martwe udziały nie wracały do sumy (collectAllocations, suggest).
function deactivateAllocAccount(acc) {
    wzPill.delete(acc);
    delete wzWeights[acc];
    buildAllocationStep();
}

function collectAnswers() {
    const capital = {};
    document.querySelectorAll(".wz-capital-input").forEach((el) => {
        const v = parseFloat(el.value) || 0;
        if (v > 0) capital[el.dataset.account] = v;
    });
    return {
        gender: radioChecked("wzGender") || "m",
        age_now: parseInt(document.getElementById("wzAge").value, 10) || 0,
        employment: radioChecked("wzEmployment") || "etat",
        gross_monthly: parseFloat(document.getElementById("wzGross").value) || 0,
        capital: capital,
        use_zus: true,
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
        savings_mode: radioChecked("wzSavingsMode") || "pct",
        savings: parseFloat(document.getElementById("wzSavings").value) || 0,
        strategy: wzStrategyValue,
        roi_overrides: {},
        allocations: collectAllocations(),
    };
}

function collectAllocations() {
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
    if (n === 4) {
        // Nagłówek podziału (pula oszczędności) renderuj przy każdym wejściu —
        // ma być widoczny zanim użytkownik wybierze tryb podziału.
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
        if (!allocReady()) {
            alert("Wybierz „Zaproponuj” albo „Podziel ręcznie”, zanim przejdziesz dalej.");
            return false;
        }
        const total = Object.values(collectAllocations()).reduce((a, b) => a + (b || 0), 0);
        if (total > 100 + 1e-6) {
            alert("Suma udziałów przekracza 100%. Zmniejsz któreś z kont albo zostaw resztę w gotówce.");
            return false;
        }
    }
    if (n === 5) {
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
                alert("Koniec planu musi być późniejszy niż wiek FIRE.");
                return false;
            }
        }
    }
    if (n === 6) {
        return wzPlan !== null;
    }
    return true;
}

// --- Bramka kroku 4: wybór trybu podziału przed przejściem dalej -------------

function allocReady() {
    return wzAllocMode != null;
}

const ALLOC_GATE_MSG = "Rozdziel środki, aby przejść dalej — wybierz „Zaproponuj” albo „Podziel ręcznie”. Bez tego całość trafi do Gotówki.";

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
    if (next) next.disabled = wzNavStep === 4 && !ready;
    // Tooltip na wrapperze przycisku (natywny title na disabled button
    // nie pokazuje się w większości przeglądarek).
    const tip = document.getElementById("wzNextTip");
    if (tip) {
        const locked = wzNavStep === 4 && !ready;
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

function renderWarnings(list) {
    const box = document.getElementById("wzWarnings");
    box.classList.add("hidden");
    box.innerHTML = "";
    if (!list || !list.length) return;
    const ul = document.createElement("ul");
    list.forEach((w) => {
        const li = document.createElement("li");
        li.textContent = w;
        ul.appendChild(li);
    });
    box.appendChild(ul);
    box.classList.remove("hidden");
}

function renderMetrics(projection) {
    const box = document.getElementById("wzMetrics");
    const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString("pl-PL"));
    let html = `<div class="wz-metric"><span class="wz-metric-label">Średnia wypłata/mies.</span><span class="wz-metric-value">${fmt(projection.mean_monthly)} zł</span></div>`;
    html += `<div class="wz-metric"><span class="wz-metric-label">Minimalna wypłata/mies.</span><span class="wz-metric-value">${fmt(projection.min_monthly)} zł</span></div>`;
    if (projection.target_monthly != null) {
        const ok = projection.met;
        html += `<div class="wz-metric ${ok ? "wz-metric-ok" : "wz-metric-warn"}"><span class="wz-metric-label">Cel ${fmt(projection.target_monthly)} zł</span><span class="wz-metric-value">${ok ? "✔ osiągnięty" : "✖ nieosiągnięty"}</span></div>`;
        if (!ok && projection.exhaust_age != null) {
            html += `<div class="wz-metric wz-metric-warn"><span class="wz-metric-label">Wiek wyczerpania</span><span class="wz-metric-value">starcza do ${projection.exhaust_age} r.ż.</span></div>`;
        }
    }
    html += `<div class="wz-metric"><span class="wz-metric-label">Majątek końcowy</span><span class="wz-metric-value">${fmt(projection.final_wealth)} zł</span></div>`;
    html += `<div class="wz-metric"><span class="wz-metric-label">Majątek szczytowy</span><span class="wz-metric-value">${fmt(projection.peak_wealth)} zł</span></div>`;
    box.innerHTML = html;
    box.classList.remove("hidden");
}

function renderSolved(solved) {
    const box = document.getElementById("wzSolved");
    box.innerHTML = "";
    const li = [];
    if (solved.savings_monthly != null) {
        li.push(`Wymagane oszczędności: <strong>${Math.round(solved.savings_monthly).toLocaleString("pl-PL")} zł/mies.</strong>`);
        if (solved.savings_pct != null) {
            li.push(`czyli <strong>${solved.savings_pct.toLocaleString("pl-PL")}%</strong> pensji brutto.`);
        }
    }
    if (solved.retire_early_age != null) {
        li.push(`Najwcześniejszy wiek FIRE: <strong>${solved.retire_early_age} lat</strong>.`);
    }
    if (!solved.feasible) {
        li.push(`<span class="wz-warn-inline">${solved.note}</span>`);
    }
    if (li.length) {
        box.innerHTML = `<p>${li.join(" ")}</p>`;
        box.classList.remove("hidden");
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
    try {
        const data = await postJson("/api/wizard/plan", body, "Błąd planowania.");
        wzPlan = data;
        document.getElementById("wzResult").classList.remove("hidden");
        renderMetrics(data.projection);
        renderSolved(data.solved);
        renderWarnings(data.projection.warnings);
    } catch (err) {
        wzPlan = null;
        errorBox.textContent = "Błąd: " + err.message;
        errorBox.classList.remove("hidden");
    } finally {
        runBtn.disabled = false;
        updateFooterNav(wzNavStep);
    }
}

function renderTimeline(input) {
    const box = document.getElementById("wzTimeline");
    box.innerHTML = "";
    const raw = input.stages.map((s) => ({
        label: s.stage_type === "realizacja" ? "Realizacja" : "Akumulacja",
        start: s.start_age,
        end: s.end_age,
    }));
    // Merge overlapping/contiguous realization spans into a single continuous
    // bar, so the FIRE bridge + ZUS stage reads as one "Realizacja" phase.
    const spans = [];
    raw.forEach((s) => {
        const last = spans[spans.length - 1];
        if (last && s.label === last.label && s.label === "Realizacja" && s.start <= last.end) {
            last.end = Math.max(last.end, s.end);
        } else {
            spans.push({ ...s });
        }
    });
    if (!spans.length) return;
    const min = Math.min(...spans.map((x) => x.start));
    const max = Math.max(...spans.map((x) => x.end));
    const width = max - min || 1;
    spans.forEach((s) => {
        const leftPct = ((s.start - min) / width) * 100;
        const spanPct = Math.max(2, ((s.end - s.start) / width) * 100);
        const seg = document.createElement("div");
        seg.className = "wz-timeline-segment " + (s.label === "Realizacja" ? "wz-tl-real" : "wz-tl-acc");
        seg.style.left = leftPct + "%";
        seg.style.width = spanPct + "%";
        seg.title = s.label + ": " + s.start + " → " + s.end;
        seg.innerHTML = `<span class="wz-tl-label">${s.label} ${s.start}→${s.end}</span>`;
        box.appendChild(seg);
    });
}

function renderStagePreview(input) {
    const container = document.getElementById("wzStagePreview");
    container.innerHTML = "";
    input.stages.forEach((stage) => {
        container.appendChild(createStageBlock({
            stage_type: stage.stage_type,
            name: stage.name,
            start_age: stage.start_age,
            end_age: stage.end_age,
            accounts: stage.accounts,
        }));
    });
}

function toSummary() {
    if (!wzPlan) return;
    renderTimeline(wzPlan.input);
    renderStagePreview(wzPlan.input);
    setStep(7, true);
}

function updateFooterNav(n) {
    const count = document.getElementById("wzStepCount");
    if (count) count.textContent = `Krok ${n} / ${WZ_TOTAL_STEPS}`;
    const back = document.getElementById("wzBackBtn");
    if (back) back.classList.toggle("hidden", n === 1);
    const next = document.getElementById("wzNextBtn");
    if (!next) return;
    if (n === 6) {
        next.textContent = wzPlan ? "Podsumowanie" : "Wylicz plan";
    } else if (n === 7) {
        next.textContent = "Przejdź do symulatora";
    } else {
        next.textContent = "Dalej";
    }
if (n === 4) {
        refreshAllocGate();
    } else {
        next.disabled = false;
    }
}

function finishWizard() {
    if (!wzPlan) return;
    const input = wzPlan.input;
    const draft = {
        gender: input.gender,
        config: input.config,
        stages: input.stages,
    };
    localStorage.setItem("fire.wizardDraft", JSON.stringify(draft));
    window.location.href = "/sim?wizard=1";
}

function initSavingsMode() {
    const input = document.getElementById("wzSavings");
    const pctRange = document.getElementById("wzSavingsRange");
    const amtRange = document.getElementById("wzSavingsAmtRange");
    const amountMode = () => (radioChecked("wzSavingsMode") || "pct") === "amount";
    const clampPct = (v) => Math.min(50, Math.max(0, v));
    const sync = () => {
        if (amountMode()) {
            input.step = "50";
            input.min = "0";
            input.removeAttribute("max");
            if (pctRange) pctRange.classList.add("hidden");
            if (amtRange) amtRange.classList.remove("hidden");
            if (parseFloat(input.value) < 100) input.value = "1000";
        } else {
            input.step = "1";
            input.min = "0";
            input.max = "50";
            if (pctRange) pctRange.classList.remove("hidden");
            if (amtRange) amtRange.classList.add("hidden");
            const v = parseFloat(input.value) || 0;
            input.value = String(clampPct(v > 100 ? 10 : v));
            if (pctRange) pctRange.value = String(clampPct(parseFloat(input.value) || 0));
        }
        updateSavingsAmtMax();
        updateSavingsWarn();
    };
    const onInput = () => {
        if (amountMode()) {
            if (amtRange) amtRange.value = String(Math.min(parseFloat(amtRange.max) || 0, Math.max(0, parseFloat(input.value) || 0)));
        } else if (pctRange) {
            const v = clampPct(parseFloat(input.value) || 0);
            input.value = String(v);
            pctRange.value = String(v);
        }
        updateSavingsWarn();
    };
    if (pctRange) {
        pctRange.addEventListener("input", () => {
            input.value = String(clampPct(parseFloat(pctRange.value) || 0));
            updateSavingsWarn();
        });
    }
    if (amtRange) {
        amtRange.addEventListener("input", () => {
            input.value = String(Math.max(0, parseFloat(amtRange.value) || 0));
            updateSavingsWarn();
        });
    }
    input.addEventListener("input", onInput);
    document.querySelectorAll('input[name="wzSavingsMode"]').forEach((r) => {
        r.addEventListener("change", sync);
    });
    sync();
}

function updateSavingsAmtMax() {
    const amtRange = document.getElementById("wzSavingsAmtRange");
    if (!amtRange) return;
    const gross = parseFloat(document.getElementById("wzGross")?.value) || 0;
    const max = Math.floor(gross / 2 / 50) * 50;
    amtRange.max = String(Math.max(0, max));
    if ((radioChecked("wzSavingsMode") || "pct") === "amount") {
        const input = document.getElementById("wzSavings");
        amtRange.value = String(Math.min(amtRange.max, Math.max(0, parseFloat(input?.value) || 0)));
    }
    updateSavingsWarn();
}

function updateSavingsWarn() {
    const warn = document.getElementById("wzSavingsWarn");
    if (!warn) return;
    let msg = "";
    if ((radioChecked("wzSavingsMode") || "pct") === "amount") {
        const amount = parseFloat(document.getElementById("wzSavings")?.value) || 0;
        const gross = parseFloat(document.getElementById("wzGross")?.value) || 0;
        const notWorking = radioChecked("wzEmployment") === "niepracujacy";
        if (notWorking && amount > 0) {
            msg = "Nie pracujesz — skąd pochodzić będą te wpłaty?";
        } else if (amount > gross) {
            msg = "Odkładasz więcej, niż wynosi pensja brutto (" + Math.round(gross) + " zł/mc).";
        }
    }
    warn.textContent = msg;
    warn.hidden = !msg;
}

function initEmploymentToggle() {
    const group = document.getElementById("wzGrossGroup");
    const gross = document.getElementById("wzGross");
    const range = document.getElementById("wzGrossRange");
    if (!group || !gross) return;
    let lastGross = parseFloat(gross.value) || 8000;
    const sync = () => {
        const disabled = radioChecked("wzEmployment") === "niepracujacy";
        if (disabled) {
            lastGross = parseFloat(gross.value) || lastGross;
            gross.value = "0";
        } else if (gross.value === "0" || gross.value === "") {
            gross.value = String(lastGross || 8000);
        }
        gross.disabled = disabled;
        group.classList.toggle("is-disabled", disabled);
        group.querySelectorAll(".stepper").forEach((b) => (b.disabled = disabled));
        if (range) {
            range.disabled = disabled;
            range.value = String(Math.min(50000, Math.max(0, parseFloat(gross.value) || 0)));
        }
        updateSavingsAmtMax();
    };
    document.querySelectorAll('input[name="wzEmployment"]').forEach((r) => {
        r.addEventListener("change", sync);
    });
    sync();
}

// Suwak + pole liczbowe: pole pozostaje kanonem wartości, suwak je synchronizuje
// (ruch suwaka → pole zaokrąglone do kroku; wpisanie → pozycja suwaka).
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

// --- Krok 5: Cel i horyzont (domyślne wg płci i wieku) ----------------------

function planEndDefault(gender, age) {
    const table = LIFE_EXPECTANCY[gender] || LIFE_EXPECTANCY.m;
    const years = table[age]
        ?? (age < 16 ? table[16] : age > 90 ? table[90] : 0);
    return Math.min(120, Math.max(2, age + Math.round(years)));
}

function applyStep5Value(input, value) {
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

// --- Allocation step (Gotówka as the default sink) ---------------------------

function round2(v) {
    return Math.round(v * 100) / 100;
}

function fmtZloty(v) {
    return Math.round(v).toLocaleString("pl-PL");
}

function fmtPct(v) {
    return String(round2(v)).replace(".", ",") + "%";
}

function wzActiveAllocAccounts() {
    return WZ_ALLOC_ACCOUNTS.filter((acc) => isCapActive(acc));
}

function wzPoolMonthly() {
    if (currentPath() === 2 && wzPlan && wzPlan.solved && wzPlan.solved.savings_monthly != null) {
        return wzPlan.solved.savings_monthly;
    }
    if (currentPath() === 2) return null;
    const mode = radioChecked("wzSavingsMode") || "pct";
    const v = parseFloat(document.getElementById("wzSavings").value) || 0;
    if (mode === "amount") return v;
    const gross = parseFloat(document.getElementById("wzGross").value) || 0;
    return (gross * v) / 100;
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

function setWzWeight(acc, v) {
    const clamped = Math.min(100, Math.max(0, v));
    wzWeights[acc] = round2(clamped);
    const range = document.querySelector(`.wz-alloc-range[data-account="${acc}"]`);
    const num = document.querySelector(`.wz-alloc-pct[data-account="${acc}"]`);
    if (range) range.value = String(wzWeights[acc]);
    if (num && num.value !== String(wzWeights[acc])) num.value = String(wzWeights[acc]);
    refreshAllocationDisplay();
}

function refreshAllocationDisplay() {
    const poolMonthly = wzPoolMonthly();
    const poolKnown = poolMonthly != null;
    const poolAnnual = (poolMonthly || 0) * 12;
    let usedPct = 0;
    let effectiveTotal = 0;
    let anyOverflow = false;
    wzActiveAllocAccounts().forEach((acc) => {
        const w = wzWeights[acc] || 0;
        usedPct += w;
        const targetAnnual = ((poolMonthly || 0) * 12 * w) / 100;
        const cap = wzShelterCap(acc);
        const eff = cap ? Math.min(targetAnnual, cap) : targetAnnual;
        effectiveTotal += eff;
        const moneyEl = document.querySelector(`.wz-alloc-money[data-account="${acc}"]`);
        const overflowEl = document.querySelector(`.wz-alloc-overflow[data-account="${acc}"]`);
        if (moneyEl) {
            moneyEl.textContent = poolKnown ? fmtZloty(eff / 12) + " zł/mies." : "—";
        }
        if (overflowEl) {
            const overflow = targetAnnual - eff;
            if (poolKnown && cap && overflow > 0.5 && (poolMonthly || 0) > 0) {
                overflowEl.textContent = "nadwyżka " + fmtZloty(overflow / 12) + " zł/mies. → Gotówka";
                overflowEl.classList.remove("hidden");
                anyOverflow = true;
            } else {
                overflowEl.classList.add("hidden");
                overflowEl.textContent = "";
            }
        }
    });
    const over = usedPct > 100 + 1e-6;
    document.querySelectorAll(".wz-alloc-row:not(.wz-alloc-cash-row)").forEach((r) => r.classList.toggle("is-over", over));

    const header = document.getElementById("wzAllocHeader");
    const cashNote = document.getElementById("wzAllocCashNote");
    if (header) {
        if (!poolKnown) {
            header.innerHTML = `Kliknij <strong>„Wylicz plan”</strong> w kroku Wynik — pula oszczędności zostanie wyznaczona z Twojego celu wypłaty.`;
        } else {
            header.innerHTML = `Odkładasz <strong>${fmtZloty(poolMonthly)} zł/mies. (${fmtZloty(poolAnnual)} zł/rok)</strong>`;
        }
    }
    if (cashNote) cashNote.hidden = !poolKnown;

    const remainingMoney = poolKnown ? Math.max(0, poolMonthly - effectiveTotal / 12) : 0;
    const remainingPct = Math.max(0, 100 - usedPct);
    const cashRow = document.getElementById("wzAllocCashRow");
    if (cashRow) {
        const readonly = wzAllocMode === "auto";
        cashRow.classList.toggle("is-over", over);
        cashRow.classList.toggle("wz-alloc-readonly", readonly);
        const range = cashRow.querySelector(".wz-alloc-range");
        if (range && !readonly) range.value = String(Math.round(remainingPct));
        const money = document.getElementById("wzAllocCashMoney");
        if (money) money.textContent = poolKnown ? fmtZloty(remainingMoney) + " zł/mies." : "—";
    }

    const cash = document.getElementById("wzAllocCash");
    if (cash) {
        cash.textContent = poolKnown && usedPct < 99.999 && anyOverflow
            ? "Nadwyżka ponad limit trafia do Gotówki — rozważ uaktywnienie kolejnego instrumentu pastylką poniżej."
            : "";
    }
    const sum = document.getElementById("wzAllocSum");
    if (sum) {
        sum.textContent = "Rozdysponowano: " + fmtPct(usedPct);
        sum.classList.toggle("wz-alloc-over", over);
        sum.classList.toggle("wz-alloc-ok", !over && usedPct >= 99.999);
    }
}

function bindAllocInputs() {
    document.querySelectorAll(".wz-alloc-grid .wz-alloc-range").forEach((range) => {
        range.addEventListener("input", () => setWzWeight(range.dataset.account, parseFloat(range.value) || 0));
    });
    document.querySelectorAll(".wz-alloc-grid .wz-alloc-pct").forEach((num) => {
        num.addEventListener("input", () => setWzWeight(num.dataset.account, parseFloat(num.value) || 0));
    });
}

function buildAllocationStep() {
    const grid = document.getElementById("wzAllocGrid");
    if (!grid) return;
    const readonly = wzAllocMode === "auto";
    grid.innerHTML = "";
    wzActiveAllocAccounts().forEach((acc) => {
        const icon = ACCOUNT_ICONS[acc] || "";
        const label = capitalLabel(acc);
        const w = wzWeights[acc] != null ? wzWeights[acc] : 0;
        const cap = wzShelterCap(acc);
        const labelTip = cap ? `title="Limit roczny wpłat: ${fmtZloty(cap)} zł"` : "";
        const wrap = document.createElement("div");
        wrap.className = "wz-alloc-row" + (readonly ? " wz-alloc-readonly" : "");
        wrap.innerHTML = readonly
            ? `
            <div class="wz-alloc-label" ${labelTip}>${icon} ${label}</div>
            <span class="wz-alloc-static" aria-label="Udział: ${fmtPct(w)}">${fmtPct(w)}</span>
            <span class="wz-alloc-money" data-account="${acc}">—</span>
            <span class="wz-alloc-overflow hidden" data-account="${acc}"></span>`
            : `
            <div class="wz-alloc-label" ${labelTip}>${icon} ${label}</div>
            <input type="range" class="wz-alloc-range" data-account="${acc}" min="0" max="100" step="1" value="${w}" aria-label="Udział ${label}">
            ${numControlsHtml({
                value: w,
                min: "0",
                max: "100",
                step: "1",
                fieldClass: "wz-alloc-pct",
                aria: `Udział ${label} (%)`,
                attrs: ` data-account="${acc}"`,
            })}
            <span class="wz-alloc-money" data-account="${acc}">—</span>
            <span class="wz-alloc-overflow hidden" data-account="${acc}"></span>`;
        if (!readonly && capitalSaldo(acc) <= 0) {
            const rm = document.createElement("button");
            rm.type = "button";
            rm.className = "wz-pill-remove";
            rm.textContent = "Usuń";
            rm.setAttribute("aria-label", `Usuń ${label}`);
            rm.addEventListener("click", () => {
                deactivateAllocAccount(acc);
            });
            wrap.appendChild(rm);
        }
        grid.appendChild(wrap);
    });
    if (!readonly) {
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
}

// Payroll vehicles present in the plan get an info bar (no slider — their
// money comes from the salary, not from the discretionary pool).
function renderPayrollActive() {
    const box = document.getElementById("wzPayrollActive");
    const panel = document.getElementById("wzPayrollPanel");
    if (!box) return;
    box.innerHTML = "";
    const list = [...WZ_PAYROLL].filter((acc) => isCapActive(acc));
    if (panel) panel.classList.toggle("hidden", !list.length);
    box.classList.toggle("hidden", !list.length);
    list.forEach((acc) => {
        const icon = ACCOUNT_ICONS[acc] || "";
        const row = document.createElement("div");
        row.className = "wz-alloc-row wz-alloc-info";
        row.innerHTML = `<div class="wz-alloc-label">${icon} ${capitalLabel(acc)}</div>`;
        const note = document.createElement("span");
        note.className = "wz-alloc-note";
        note.textContent = "wpłaty z pensji — dodatkowe do oszczędności";
        row.appendChild(note);
        if (capitalSaldo(acc) <= 0) {
            const rm = document.createElement("button");
            rm.type = "button";
            rm.className = "wz-pill-remove";
            rm.textContent = "Usuń";
            rm.setAttribute("aria-label", `Usuń ${capitalLabel(acc)}`);
            rm.addEventListener("click", () => {
                deactivateAllocAccount(acc);
            });
            row.appendChild(rm);
        }
        box.appendChild(row);
    });
}

// Pills for instruments not yet considered — clicking toggles them in.
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
    wrap.className = "wz-pills";
    const pill = (acc) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wz-pill";
        b.dataset.account = acc;
        const payrollSub = WZ_PAYROLL.has(acc)
            ? `<span class="wz-pill-sub">wpłaty z pensji</span>`
            : "";
        b.innerHTML = `${ACCOUNT_ICONS[acc] || ""} ${capitalLabel(acc)}${payrollSub}`;
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
    const btn = document.getElementById("wzAutoBtn");
    if (!btn) return;
    btn.disabled = true;
    try {
        const data = await postJson("/api/wizard/suggest", { answers: collectAnswers() }, "Błąd sugestii.");
        wzWeights = {};
        Object.entries(data.allocations || {}).forEach(([acc, v]) => {
            if (acc !== "gotowka") {
                wzWeights[acc] = v;
                wzPill.add(acc);
            }
        });
        buildAllocationStep();
    } catch (err) {
        alert("Błąd: " + err.message);
    } finally {
        btn.disabled = false;
        refreshAllocGate();
    }
}

function setAllocMode(mode) {
    wzAllocMode = mode;
    const panel = document.getElementById("wzAllocPanel");
    if (panel) panel.classList.remove("hidden");
    const autoBtn = document.getElementById("wzAutoBtn");
    const manualBtn = document.getElementById("wzManualBtn");
    if (autoBtn) autoBtn.setAttribute("aria-pressed", String(mode === "auto"));
    if (manualBtn) manualBtn.setAttribute("aria-pressed", String(mode === "manual"));
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
        if (step && parseInt(step.dataset.step, 10) === 4) buildAllocationStep();
    } catch {
        // best-effort: brak limitów = brak pasków limitów
    }
}

function initStrategy() {
    const opts = document.querySelectorAll('input[name="wzStrategy"]');
    if (!opts.length) return;
    const update = () => {
        const checked = document.querySelector('input[name="wzStrategy"]:checked');
        if (checked) wzStrategyValue = checked.value;
    };
    opts.forEach((r) => r.addEventListener("change", update));
    update();
}

function syncPathUI() {
    const goalField = document.getElementById("wzGoalField");
    const reGroup = document.getElementById("wzReGroup");
    const savingsPanel = document.getElementById("wzSavingsPanel");
    const path = currentPath();
    if (goalField) goalField.classList.toggle("hidden", path === 1);
    if (reGroup) reGroup.classList.toggle("hidden", path === 3);
    if (savingsPanel) savingsPanel.classList.toggle("hidden", path === 2);
}

function initSteppers() {
    initNumControls(document.querySelector(".wizard"));
}

function initNav() {
    document.getElementById("wzNextBtn").addEventListener("click", () => {
        const n = wzNavStep;
        if (n === 6) {
            if (wzPlan) {
                toSummary();
            } else {
                runPlan();
            }
            return;
        }
        if (n === 7) {
            finishWizard();
            return;
        }
        if (!validateStep(n)) return;
        setStep(n + 1, true);
    });
    document.getElementById("wzBackBtn").addEventListener("click", () => {
        if (wzNavStep > 1) setStep(wzNavStep - 1, true);
    });
    document.getElementById("wzAutoBtn").addEventListener("click", () => {
        setAllocMode("auto");
        runSuggestAllocation();
    });
    const manualBtn = document.getElementById("wzManualBtn");
    if (manualBtn) manualBtn.addEventListener("click", () => setAllocMode("manual"));
    const tip = document.getElementById("wzNextTip");
    if (tip) {
        tip.addEventListener("click", (e) => {
            // Tylko fizyczny tap na zablokowany przycisk (pointer-events:none
            // sprawia, że target to wrapper, nie button). Klik na aktywnym
            // „Dalej” (nawigacja) bubble'uje tu po setStep — tą ścieżką
            // nie pokazujemy dymka.
            if (e.target !== tip) return;
            if (wzNavStep === 4 && !allocReady()) {
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
    bindSliderRange(document.getElementById("wzGrossRange"), document.getElementById("wzGross"), 0, 50000, updateSavingsAmtMax);
    bindSliderRange(document.getElementById("wzAgeRange"), document.getElementById("wzAge"), 16, 90);
    initGoalHorizon();
    initStrategy();
    syncPathUI();
    document.querySelectorAll('input[name="wzPath"]').forEach((r) => {
        r.addEventListener("change", syncPathUI);
    });
    initNav();
    loadWzLimits();
    setStep(1);
}

document.addEventListener("DOMContentLoaded", () => {
    initWizard();
});