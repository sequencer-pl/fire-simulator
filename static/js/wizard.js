// wizard.js — Asystent FIRE: 3 ścieżki planowania oparte o backend planner.py

const WZ_TOTAL_STEPS = 6;
const WZ_CAPITAL_ACCOUNTS = [
    "gotowka", "broker", "ike", "ikze", "oipe",
    "lokata", "obligacje", "krypto", "oki_inw", "oki_osk",
];

let wzPlan = null;

function capitalizeLabel(s) {
    return (ACCOUNT_LABELS[s] || s).charAt(0).toUpperCase() + (ACCOUNT_LABELS[s] || s).slice(1);
}

function buildCapitalGrid() {
    const grid = document.getElementById("wzCapitalGrid");
    grid.innerHTML = "";
    WZ_CAPITAL_ACCOUNTS.forEach((account) => {
        const wrap = document.createElement("div");
        wrap.className = "wz-capital-item";
        const icon = ACCOUNT_ICONS[account] || "";
        wrap.innerHTML = `
            <label>${icon} ${capitalizeLabel(account)}</label>
            <div class="num-control">
                <button type="button" class="stepper stepper-down" tabindex="-1" aria-label="Zmniejsz ${account}">&minus;</button>
                <input type="number" class="acc-field wz-capital-input" data-account="${account}" value="0" min="0" step="1000">
                <button type="button" class="stepper stepper-up" tabindex="-1" aria-label="Zwiększ ${account}">+</button>
            </div>
        `;
        grid.appendChild(wrap);
    });
}

function collectAnswers() {
    const capital = {};
    document.querySelectorAll(".wz-capital-input").forEach((el) => {
        const v = parseFloat(el.value) || 0;
        if (v > 0) capital[el.dataset.account] = v;
    });
    return {
        gender: document.getElementById("wzGender").value,
        age_now: parseInt(document.getElementById("wzAge").value, 10) || 0,
        employment: document.getElementById("wzEmployment").value,
        gross_monthly: parseFloat(document.getElementById("wzGross").value) || 0,
        capital: capital,
        use_zus: document.getElementById("wzZus").checked,
        use_ppk: document.getElementById("wzPpk").checked,
        ppk_employee_pct: (parseFloat(document.getElementById("wzPpkEmployee").value) || 0) / 100,
        ppk_employer_pct: (parseFloat(document.getElementById("wzPpkEmployer").value) || 0) / 100,
        ppk_state_topups: true,
        use_ikze: document.getElementById("wzIkze").checked,
        use_ike: document.getElementById("wzIke").checked,
        use_oipe: document.getElementById("wzOipe").checked,
        use_ppe: document.getElementById("wzPpe").checked,
        use_oki_inw: document.getElementById("wzOkiInw").checked,
        use_oki_osk: document.getElementById("wzOkiOsk").checked,
        use_krypto: document.getElementById("wzKrypto").checked,
        use_lokata: document.getElementById("wzLokata").checked,
        use_obligacje: document.getElementById("wzObligacje").checked,
        retire_early_age: parseInt(document.getElementById("wzRe").value, 10) || null,
        retirement_age: (() => {
            const v = parseInt(document.getElementById("wzRetirement").value, 10);
            return Number.isFinite(v) && v > 0 ? v : null;
        })(),
        plan_end_age: parseInt(document.getElementById("wzPlanEnd").value, 10) || 96,
        savings_mode: document.getElementById("wzSavingsMode").value,
        savings: parseFloat(document.getElementById("wzSavings").value) || 0,
        strategy: document.getElementById("wzStrategy").value,
        roi_overrides: {},
        primary_account: "broker",
    };
}

function currentPath() {
    const checked = document.querySelector('input[name="wzPath"]:checked');
    return checked ? parseInt(checked.value, 10) : 1;
}

function setStep(n) {
    document.querySelectorAll(".wz-step").forEach((el) => {
        el.classList.toggle("hidden", parseInt(el.dataset.step, 10) !== n);
    });
    const bar = document.getElementById("wizardProgressBar");
    bar.style.width = (n / WZ_TOTAL_STEPS) * 100 + "%";
    window.scrollTo({ top: 0, behavior: "smooth" });
    const finalStep = document.getElementById("wzToSummary");
    if (finalStep) finalStep.disabled = true;
}

function validateStep(n) {
    if (n === 4) {
        const age = parseInt(document.getElementById("wzAge").value, 10) || 0;
        const re = parseInt(document.getElementById("wzRe").value, 10) || 0;
        if (re <= age) {
            alert("Wiek FIRE musi być większy niż obecny wiek (" + age + ").");
            return false;
        }
        const end = parseInt(document.getElementById("wzPlanEnd").value, 10) || 96;
        if (end <= re) {
            alert("Koniec planu musi być późniejszy niż wiek FIRE.");
            return false;
        }
        if (currentPath() !== 1) {
            const t = parseFloat(document.getElementById("wzTarget").value) || 0;
            if (t <= 0) {
                alert("Podaj cel wypłaty miesięcznej.");
                return false;
            }
        }
    }
    if (n === 5) {
        return wzPlan !== null;
    }
    return true;
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

async function runPlan() {
    const answers = collectAnswers();
    const path = currentPath();
    const body = { path: path, answers: answers };
    if (path !== 1) {
        body.target_monthly = parseFloat(document.getElementById("wzTarget").value) || null;
    }
    const runBtn = document.getElementById("wzRunBtn");
    const errorBox = document.getElementById("wzResultError");
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    runBtn.disabled = true;
    runBtn.textContent = "Wyliczam...";
    try {
        const res = await fetch("/api/wizard/plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            let msg = data.detail;
            if (Array.isArray(msg)) {
                msg = msg.map((d) => d.msg || JSON.stringify(d)).join("; ");
            }
            throw new Error(msg || "Błąd planowania.");
        }
        wzPlan = data;
        document.getElementById("wzResult").classList.remove("hidden");
        renderMetrics(data.projection);
        renderSolved(data.solved);
        renderWarnings(data.projection.warnings);
        document.getElementById("wzToSummary").disabled = false;
    } catch (err) {
        wzPlan = null;
        document.getElementById("wzToSummary").disabled = true;
        errorBox.textContent = "Błąd: " + err.message;
        errorBox.classList.remove("hidden");
    } finally {
        runBtn.disabled = false;
        runBtn.textContent = "Wylicz plan";
    }
}

function renderTimeline(input) {
    const box = document.getElementById("wzTimeline");
    box.innerHTML = "";
    const spans = [];
    input.stages.forEach((s) => {
        spans.push({
            label: s.stage_type === "realizacja" ? "Realizacja" : "Akumulacja",
            start: s.start_age,
            end: s.end_age,
        });
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
    const mode = document.getElementById("wzSavingsMode");
    const input = document.getElementById("wzSavings");
    const hint = document.getElementById("wzSavingsHint");
    const sync = () => {
        if (mode.value === "amount") {
            input.step = "50";
            hint.textContent = "Kwota miesięcznie „na czysto” — dodatkowa do wpłat w PPK/ZUS.";
            if (parseFloat(input.value) < 100) input.value = "1000";
        } else {
            input.step = "1";
            hint.textContent = "Procent pensji brutto odkładany miesięcznie na inwestycje.";
            if (parseFloat(input.value) > 100) input.value = "10";
        }
    };
    mode.addEventListener("change", sync);
    sync();
}

function initInstrumentToggles() {
    const ppk = document.getElementById("wzPpk");
    const fields = document.getElementById("wzPpkFields");
    const sync = () => fields.classList.toggle("hidden", !ppk.checked);
    ppk.addEventListener("change", sync);
    sync();
}

function initAdvancedToggles() {
    document.querySelectorAll(".wz-advanced-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = document.getElementById(btn.dataset.target);
            if (target) target.classList.toggle("hidden");
            btn.classList.toggle("hidden");
        });
    });
}

function initPaths() {
    const goalField = document.getElementById("wzGoalField");
    const sync = () => {
        const path = currentPath();
        goalField.classList.toggle("hidden", path === 1);
    };
    document.querySelectorAll('input[name="wzPath"]').forEach((r) => {
        r.addEventListener("change", sync);
    });
    sync();
}

function initSteppers() {
    document.querySelector(".wizard").addEventListener("click", (e) => {
        const btn = e.target.closest(".num-control .stepper");
        if (!btn) return;
        const input = btn.closest(".num-control")?.querySelector(".acc-field");
        if (!input) return;
        stepInputValue(input, btn.classList.contains("stepper-up") ? 1 : -1);
    });
}

function initNav() {
    document.querySelectorAll(".wz-next").forEach((btn) => {
        btn.addEventListener("click", () => {
            const step = parseInt(btn.closest(".wz-step").dataset.step, 10);
            if (!validateStep(step)) return;
            setStep(step + 1);
        });
    });
    document.querySelectorAll(".wz-back").forEach((btn) => {
        btn.addEventListener("click", () => {
            const step = parseInt(btn.closest(".wz-step").dataset.step, 10);
            setStep(step - 1);
        });
    });
    document.getElementById("wzRunBtn").addEventListener("click", runPlan);
    document.getElementById("wzToSummary").addEventListener("click", () => {
        if (!wzPlan) return;
        renderTimeline(wzPlan.input);
        renderStagePreview(wzPlan.input);
        setStep(6);
    });
    document.getElementById("wzFinishBtn").addEventListener("click", finishWizard);
}

function initWizard() {
    buildCapitalGrid();
    initSteppers();
    initSavingsMode();
    initInstrumentToggles();
    initAdvancedToggles();
    initPaths();
    initNav();
    setStep(1);
}

document.addEventListener("DOMContentLoaded", () => {
    initWizard();
});