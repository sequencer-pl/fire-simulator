// simulator.js — Main entry, config, results, save/load

const TAX_MODEL_LABELS = { none: "Brak", flat: "Ryczałt", scale: "Skala PIT", assets: "Od wartości aktywów" };
const TAX_BASIS_LABELS = { gains: "od zysku", full: "od całości" };
let CONFIG = null;
let USER_CONFIG = null;
let DEFAULT_CONFIG = null;
let PRESETS = [];
let _currentPresetId = null;
let _currentPresetName = "Domyślne 2026";
let CONFIG_BASELINE = null;
let CONFIG_BASELINE_NAME = "Domyślne 2026";
let CONFIG_OVERRIDE_PATHS = new Set();

let lastInput = null;
let lastResult = null;

function gatherFormData() {
    const stages = [];
    document.querySelectorAll(".stage-block").forEach((block) => {
        const accounts = {};
        block.querySelectorAll(".acc-field").forEach((input) => {
            if (input.dataset.skipSubmit === "true") return;
            const acc = input.dataset.account;
            const key = input.dataset.key;
            if (!acc || !key) return;
            if (!accounts[acc]) accounts[acc] = {};
            let val;
            if (input.type === "checkbox") {
                val = input.checked;
            } else if (input.tagName === "SELECT") {
                val = parseFloat(input.value) || 0;
            } else {
                val = parseFloat(input.value) || 0;
                if (input.dataset.percent) val /= 100;
            }
            accounts[acc][key] = val;
        });
        block.querySelectorAll(".account-card").forEach((card) => {
            const acc = card.dataset.account;
            if (acc !== "ikze" || !card.querySelector('[data-key="annual_contribution"]')) return;
            if (!accounts[acc]) accounts[acc] = {};
            accounts[acc].ikze_limit =
                ikzeLimitKey(card) === "ikze_annual_self_employed" ? "self_employed" : "etat";
        });

        stages.push({
            stage_type: block.dataset.stageType,
            name: block.querySelector(".stage-name").value,
            start_age: parseInt(block.querySelector(".start-age").value) || 0,
            end_age: parseInt(block.querySelector(".end-age").value) || 0,
            accounts: accounts,
            withdrawal_target_monthly: parseFloat(block.dataset.withdrawalTargetMonthly) || 0,
        });
    });

    return {
        stages: stages,
        max_age: 100,
        gender: currentGender(),
        monthly_gross: 0,
        inflation: null,
        config: CONFIG,
    };
}

function currentGender() {
    const checked = document.querySelector(
        '.account-card[data-account="zus"] input[type="radio"]:checked'
    );
    return checked ? checked.value : "m";
}

function setGender(value) {
    const radio = document.querySelector(`.account-card[data-account="zus"] input[type="radio"][value="${value}"]`);
    if (radio) radio.checked = true;
}

function pensionAge(config) {
    if (!config || !config.zus) return null;
    const z = config.zus;
    if (currentGender() === "k") {
        return z.wiek_emerytalny_k ?? z.wiek_emerytalny ?? 60;
    }
    return z.wiek_emerytalny_m ?? z.wiek_emerytalny ?? 65;
}

function renderResults(data) {
    const container = document.getElementById("results");
    const thead = document.querySelector("#resultsTable thead");
    const tbody = document.querySelector("#resultsTable tbody");
    const summary = document.getElementById("summary");
    const warnings = document.getElementById("warnings");

    const accounts = data.accounts || [];

    thead.innerHTML = "";
    const headerRow = document.createElement("tr");
    headerRow.innerHTML = `
        <th class="col-age">Wiek</th>
        <th class="col-stage">Etap</th>
        ${accounts.map(a => `<th data-col="${a}">${ACCOUNT_LABELS[a] || a}</th>`).join("")}
        <th data-col="wealth">Majątek</th>
        <th data-col="annual">Wypłata roczna</th>
        <th data-col="monthly">Wypłata mies.</th>
        <th data-col="tax">Podatek</th>
    `;
    thead.appendChild(headerRow);

    tbody.innerHTML = "";

    warnings.innerHTML = "";
    (data.warnings || []).forEach((w) => {
        const div = document.createElement("div");
        div.className = "banner banner-warn";
        div.innerHTML = `${iconSvg("warning")}<div class="banner-body"></div>`;
        div.querySelector(".banner-body").textContent = w;
        warnings.appendChild(div);
    });

    const totalContrib = computeTotalUserContributions(lastInput);
    const initCap = computeInitialCapital(lastInput);
    const totalInvested = initCap + totalContrib;
    const multiplier = totalInvested > 0 ? (data.peak_wealth / totalInvested) : 0;
    const multiplierBadge = multiplier > 0
        ? `<span class="metric-note" title="Majątek szczytowy / (kapitał początkowy + wpłaty własne)">${multiplier.toFixed(1)}×</span>`
        : "";

    summary.innerHTML = `
        <div class="metric-grid">
            <div class="metric">
                <span class="metric-label">Kapitał początkowy</span>
                <span class="metric-value">${fmtMoney(initCap)}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Wpłaty własne</span>
                <span class="metric-value">${fmtMoney(totalContrib)}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Szczyt majątku</span>
                <span class="metric-value">${fmtMoney(data.peak_wealth)}${multiplierBadge}</span>
            </div>
            <div class="metric${data.final_wealth <= 0 ? " is-muted" : ""}">
                <span class="metric-label">Majątek na koniec</span>
                <span class="metric-value">${fmtMoney(data.final_wealth)}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Suma wypłat netto</span>
                <span class="metric-value">${fmtMoney(data.total_withdrawn)}</span>
            </div>
            <div class="metric${data.total_tax < 0 ? " is-positive" : ""}">
                <span class="metric-label">Suma podatków</span>
                <span class="metric-value">${fmtMoney(data.total_tax)}</span>
            </div>
        </div>
    `;

    const total = data.years.length;
    const hasPension = data.has_pension;
    data.years.forEach((y, i) => {
        const tr = document.createElement("tr");
        if (y.annual_withdrawal > 0) tr.classList.add("highlight");
        else tr.classList.add("stage-accum");

        const balanceCells = accounts.map(a => {
            const val = y.balances?.[a] || 0;
            return `<td class="amount" data-col="${a}">${formatMoney(val)}</td>`;
        }).join("");

        const isLast = i === total - 1;
        tr.innerHTML = `
            <td class="col-age">${y.age}${isLast && hasPension ? '<span class="plus-suffix">+</span>' : ''}</td>
            <td class="col-stage">${y.stage_name}</td>
            ${balanceCells}
            <td class="amount" data-col="wealth"><strong>${formatMoney(y.total_wealth)}</strong></td>
            <td class="amount" data-col="annual">${formatMoney(y.annual_withdrawal)}</td>
            <td class="amount" data-col="monthly">${formatMoney(y.monthly_withdrawal)}</td>
            <td class="amount ${y.tax_paid < 0 ? 'text-success' : ''}" data-col="tax">${formatMoney(y.tax_paid)}</td>
        `;
        tbody.appendChild(tr);
    });

    renderColumnToggles(accounts);
    applyColVisibility();
    applyDensity();
    renderStageSummary(data);
    renderWealthChart(data);
    renderWithdrawalChart(data);

    /* show charts section if any chart is visible */
    const hasCharts = !document.getElementById("wealthChart").classList.contains("hidden")
        || !document.getElementById("withdrawalChart").classList.contains("hidden");
    document.getElementById("chartsSection").classList.toggle("hidden", !hasCharts);

    switchToResults();
}

function switchToResults() {
    document.getElementById("simConfigSection").classList.add("collapsed");
    document.getElementById("results").style.display = "block";
    document.querySelector(".form-actions")?.classList.add("config-collapsed");
    document.getElementById("results").scrollIntoView({ behavior: "smooth" });
}

function switchToConfig() {
    document.getElementById("simConfigSection").classList.remove("collapsed");
    document.getElementById("results").style.display = "none";
    document.querySelector(".form-actions")?.classList.remove("config-collapsed");
    document.getElementById("simConfigSection").scrollIntoView({ behavior: "smooth" });
}

function renderStageSummary(data) {
    const el = document.getElementById("stageSummary");
    if (!lastInput || !lastInput.stages) {
        el.innerHTML = "";
        return;
    }
    const stages = computeStageSummaries(lastInput, data);
    if (stages.length === 0) {
        el.innerHTML = "";
        return;
    }

    let html = '<h3 class="section-title">Etapy</h3><div class="stage-summary">';
    for (const st of stages) {
        const isAccum = st.type === "akumulacja";
        const kind = isAccum ? "accum" : "withdraw";

        const accounts = st.accounts
            .map((a) => `<span class="chip">${escapeHtml(ACCOUNT_LABELS[a.key] || a.key)}</span>`)
            .join("");

        let finance = "";
        if (isAccum && st.total_monthly > 0) {
            finance = `<span class="stage-finance ${kind}">~${formatMoney(st.total_monthly)}/mies.</span>`;
        } else if (!isAccum && st.avg_withdrawal > 0) {
            finance = `<span class="stage-finance ${kind}">~${formatMoney(st.avg_withdrawal)}/mies.</span>`;
        }

        html += `
            <div class="stage-line">
                <span class="stage-dot ${kind}"></span>
                <span class="stage-label ${kind}">${escapeHtml(st.label)}</span>
                <span class="stage-age">${st.start_age}→${st.end_age} r.ż.</span>
                ${accounts}
                ${finance}
            </div>`;
    }
    el.innerHTML = html + "</div>";
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("stages-container");
    const params = new URLSearchParams(location.search);
    const simId = params.get("id");

    if (params.get("view") === "config") switchMode("config");
    initConfig();
    refreshSessionBar();
    initSaveButton();
    initResultsControls();
    initStageEventHandlers(container);
    initTipAnchoring();

    // "Edytuj" button — switch from results back to config
    const editBtn = document.getElementById("editConfigBtn");
    if (editBtn) {
        editBtn.addEventListener("click", () => switchToConfig());
    }

    // Steppery w konfiguracji (num-control; pct-control obsługuje guardedNumberInputStep)
    const configContent = document.getElementById("config-content");
    if (configContent) {
        initNumControls(configContent, guardedNumberInputStep);
    }

    if (simId) {
        loadSimulation(simId, container);
    } else {
        applyWizardDraftIfPresent();
        updateStageButtons(container);
        updateStageHints(container);
        refreshRealizationToggles(container);
    }

    updateEmptyState();
    new MutationObserver(updateEmptyState).observe(container, { childList: true });
});

function updateEmptyState() {
    const el = document.getElementById("emptyState");
    if (!el) return;
    const container = document.getElementById("stages-container");
    const hasStages = container && container.querySelector(".stage-block");
    el.classList.toggle("hidden", hasStages);
}

const WIZARD_DRAFT_KEY = "fire.wizardDraft";

function applyWizardDraftIfPresent() {
    const container = document.getElementById("stages-container");
    const raw = localStorage.getItem(WIZARD_DRAFT_KEY);
    if (!raw || !container) return;
    try {
        const draft = JSON.parse(raw);
        if (!draft || !Array.isArray(draft.stages) || !draft.stages.length) return;
        populateStages(draft);
        showWizardDraftBanner();
    } catch (err) {
        localStorage.removeItem(WIZARD_DRAFT_KEY);
    }
}

function showWizardDraftBanner() {
    const bar = document.getElementById("wizardDraftBar");
    if (bar) bar.classList.remove("hidden");
}

function clearWizardDraft() {
    localStorage.removeItem(WIZARD_DRAFT_KEY);
}

// --- Tryby: Symulator / Konfiguracja ---

function switchMode(mode) {
    document.getElementById("simulatorView").classList.toggle("hidden", mode !== "sim");
    document.getElementById("configView").classList.toggle("hidden", mode !== "config");
    document.body.dataset.section = mode === "config" ? "konfiguracja" : "edytor";
    const subtitleEl = document.querySelector('.topbar .subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = mode === "config" ? "Konfigurator niezależności finansowej" : "Symulator niezależności finansowej";
    }
    const url = new URL(window.location.href);
    if (mode === "config") {
        url.searchParams.set("view", "config");
    } else {
        url.searchParams.delete("view");
    }
    history.replaceState(null, "", url.pathname + url.search);
}

// Primary nav (Symulacje / Konfiguracja) na /sim — przełącza widok bez reloadu.
window.setNavSection = function (section) {
    switchMode(section === "konfiguracja" ? "config" : "sim");
};

// --- Konfiguracja (podatki, limity, reguły kont) ---

async function initConfig() {
    try {
        const [defaultsRes, userRes, presetsRes] = await Promise.all([
            fetch("/api/config"),
            fetch("/api/config/user"),
            fetch("/api/presets"),
        ]);
        DEFAULT_CONFIG = await defaultsRes.json();
        const userData = await userRes.json();
        if (userData.config) {
            USER_CONFIG = backfillConfig(userData.config);
            if (userData.baseline) {
                CONFIG_BASELINE = backfillConfig(userData.baseline);
                CONFIG_BASELINE_NAME = userData.preset_name || "Własna konfiguracja";
                _currentPresetId = userData.preset_id ?? null;
                _currentPresetName = CONFIG_BASELINE_NAME === "Własna konfiguracja" ? null : CONFIG_BASELINE_NAME;
                CONFIG_OVERRIDE_PATHS = new Set(userData.overrides || []);
            } else {
                CONFIG_BASELINE = structuredClone(USER_CONFIG);
                CONFIG_BASELINE_NAME = "Własna konfiguracja";
                _currentPresetId = null;
                _currentPresetName = null;
                CONFIG_OVERRIDE_PATHS = new Set();
            }
        } else {
            USER_CONFIG = structuredClone(DEFAULT_CONFIG);
            CONFIG_BASELINE = structuredClone(DEFAULT_CONFIG);
            CONFIG_BASELINE_NAME = "Domyślne 2026";
            _currentPresetId = null;
            _currentPresetName = "Domyślne 2026";
            CONFIG_OVERRIDE_PATHS = new Set();
        }
        const presetsData = await presetsRes.json();
        PRESETS = presetsData.presets || [];
        if (!CONFIG) CONFIG = structuredClone(USER_CONFIG);
        applyZusWaloryzacjaDefaults();
        renderConfigView();
        initTipAnchoring();
        updateStageHints(document.getElementById("stages-container"));
        document.getElementById("configResetBtn").addEventListener("click", resetConfig);
        initPresetBar();
    } catch (err) {
        console.error("Nie udało się wczytać konfiguracji:", err);
    }
}

// Uzupełnia brakujące klucze wczytanego configu domyślnymi (stare zapisane symulacje).
function backfillConfig(config) {
    if (!DEFAULT_CONFIG) return config;
    const out = {};
    for (const [section, defaults] of Object.entries(DEFAULT_CONFIG)) {
        const loaded = config[section];
        if (loaded && typeof defaults === "object" && defaults !== null && !Array.isArray(defaults)) {
            out[section] = { ...defaults, ...loaded };
        } else {
            out[section] = loaded !== undefined ? loaded : defaults;
        }
    }
    return out;
}

function setConfigPath(path, value) {
    const parts = path.split(".");
    let obj = USER_CONFIG;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    scheduleConfigSave();
}

let _configSaveTimeout = null;
function scheduleConfigSave() {
    if (!window.getCurrentUserEmail?.()) return;
    clearTimeout(_configSaveTimeout);
    _configSaveTimeout = setTimeout(() => {
        fetch("/api/config/user", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                config: USER_CONFIG,
                baseline: CONFIG_BASELINE || USER_CONFIG,
                preset_id: _currentPresetId,
                preset_name: CONFIG_BASELINE_NAME,
                overrides: [...CONFIG_OVERRIDE_PATHS],
            }),
        }).catch((err) => console.error("Błąd zapisu konfiguracji:", err));
    }, 500);
}

function renderConfigView() {
    const root = document.getElementById("config-content");
    root.innerHTML = "";

    const skalaBadge = (() => {
        const p1 = USER_CONFIG.prog;
        const p2 = USER_CONFIG.prog2;
        const rm = USER_CONFIG.rate_middle;
        if (p1 === 130000 && p2 === 150000 && rm === 0.24) return "Skala podatkowa — 2027 (projekt UD458)";
        if (p1 === 120000 && p2 == null && rm == null) return "Skala podatkowa — 2026 (obowiązuje)";
        return "Skala podatkowa — custom";
    })();
    root.appendChild(configSection(skalaBadge, [
        configNumberField("kwota_wolna", "Kwota wolna od podatku", USER_CONFIG.kwota_wolna, "Kwota wolna od podatku (2026 i projekt 2027: 30 000 zł)."),
        configNumberField("prog", "Próg I", USER_CONFIG.prog, "Próg wejścia w stawkę środkową/wyższą (2026: 120 000 zł; projekt 2027: 130 000 zł)."),
        configNullableNumberField("prog2", "Próg II (3 progi)", USER_CONFIG.prog2, "Drugi próg skali 3-progowej (projekt 2027: 150 000 zł). Puste = stara skala 2-progowa."),
        configPercentField("rate_lower", "Stawka niższa", USER_CONFIG.rate_lower, "Stawka podatku do progu I (12%)."),
        configNullablePercentField("rate_middle", "Stawka środkowa", USER_CONFIG.rate_middle, "Stawka między progiem I a II (projekt 2027: 24%). Puste = stara skala 2-progowa."),
        configPercentField("rate_upper", "Stawka wyższa", USER_CONFIG.rate_upper, "Stawka podatku powyżej progu (2026: 32% od 120k; projekt 2027: 32% od 150k)."),
        configNumberField("kup", "Koszty uzyskania przychodu", USER_CONFIG.kup, "Roczne koszty uzyskania przychodu (2026 r.: 3 000–3 600 zł)."),
        configNumberField("kup_50_limit", "Limit 50% KUP", USER_CONFIG.kup_50_limit, "Limit przychodów dla 50% kosztów autorskich (projekt 2027: powiązany z progiem 130k)."),
        configPercentField("danina_rate", "Danina solidarnościowa", USER_CONFIG.danina_rate, "Stawka daniny od nadwyżki ponad 1 mln zł (2026: 4%; projekt 2027: 5%)."),
        configPercentField("inflation", "Inflacja roczna", USER_CONFIG.inflation, "Roczna inflacja — jedyne źródło dla całej symulacji. Używana do wyliczenia nominalnego podatku Belki/OKI z realnego ROI oraz realnej erozji gotówki (wyniki zawsze w dzisiejszych zł)."),
    ]));

    root.appendChild(configSection("Limity rocznych wpłat", [
        configNumberField("limits.ike_annual", "IKE", USER_CONFIG.limits.ike_annual, "Limit roczny wpłat na IKE (2026 r.: 28 260 zł)."),
        configNumberField("limits.ikze_annual", "IKZE — etat", USER_CONFIG.limits.ikze_annual, "Limit roczny IKZE dla zatrudnionych (2026 r.: 11 304 zł)."),
        configNumberField("limits.ikze_annual_self_employed", "IKZE — przedsiębiorca", USER_CONFIG.limits.ikze_annual_self_employed, "Limit roczny IKZE dla przedsiębiorców (2026 r.: 16 956 zł)."),
        configNumberField("limits.oipe_annual", "OIPE", USER_CONFIG.limits.oipe_annual, "Limit roczny wpłat na OIPE (2026 r.: 28 260 zł)."),
        configNumberField("limits.ppe_additional_annual", "PPE — składka dodatkowa", USER_CONFIG.limits.ppe_additional_annual, "Limit roczny składki dodatkowej PPE (2026 r.: 42 390 zł)."),
    ]));

    root.appendChild(configSection("PPK — parametry", [
        configPercentField("ppk.employee_pct", "Wpłata pracownika", USER_CONFIG.ppk.employee_pct, "Ustawowo min. 2% wynagrodzenia; można obniżyć do 0,5%."),
        configPercentField("ppk.employer_pct", "Wpłata pracodawcy", USER_CONFIG.ppk.employer_pct, "Ustawowo min. 1,5%, max 4% wynagrodzenia."),
        configPercentField("ppk.max_total_pct", "Limit sumy wpłat", USER_CONFIG.ppk.max_total_pct, "Ustawowy limit łącznej sumy wpłat pracownika i pracodawcy (8%)."),
        configNumberField("ppk.state_welcoming", "Dopłata powitalna", USER_CONFIG.ppk.state_welcoming, "Jednorazowa dopłata państwa w pierwszym roku akumulacji (250 zł)."),
        configNumberField("ppk.state_annual", "Dopłata roczna", USER_CONFIG.ppk.state_annual, "Coroczna dopłata państwa przy wpłacie min. 0,5% (240 zł)."),
    ]));

    root.appendChild(configSection("PPE — parametry", [
        configPercentField("ppe.max_employer_pct", "Limit składki podstawowej", USER_CONFIG.ppe.max_employer_pct, "Ustawowy limit składki podstawowej pracodawcy (7% wynagrodzenia)."),
    ]));

    root.appendChild(configSection("ZUS — parametry", [
        configPercentField("zus.skladka_rate", "Składka emerytalna", USER_CONFIG.zus.skladka_rate, "Część składki na ubezpieczenie emerytalne (19,52% podstawy)."),
        configPercentField("zus.ofe_rate", "Część składki do OFE", USER_CONFIG.zus.ofe_rate, "Punkt procentowy składki trafiający do OFE dla członków OFE (2,92 pkt)."),
        configNumberField("zus.limit_base_annual", "Limit rocznej podstawy (30×)", USER_CONFIG.zus.limit_base_annual, "Roczna podstawa wymiaru składek (30× przeciętne wynagrodzenie; 0 = brak limitu)."),
        configPercentField("zus.waloryzacja_skladek", "Waloryzacja składek", USER_CONFIG.zus.waloryzacja_skladek, "Roczna waloryzacja kapitału zgromadzonego w ZUS."),
        configPercentField("zus.waloryzacja_swiadczenia", "Waloryzacja świadczenia", USER_CONFIG.zus.waloryzacja_swiadczenia, "Roczna waloryzacja wypłacanej emerytury."),
        configNumberField("zus.wiek_emerytalny_k", "Wiek emerytalny — kobiety", USER_CONFIG.zus.wiek_emerytalny_k, "Powszechny wiek emerytalny kobiet (60 r.ż. od 1.10.2017)."),
        configNumberField("zus.wiek_emerytalny_m", "Wiek emerytalny — mężczyźni", USER_CONFIG.zus.wiek_emerytalny_m, "Powszechny wiek emerytalny mężczyzn (65 r.ż. od 1.10.2017)."),
        configNumberField("zus.min_emerytura", "Emerytura minimalna", USER_CONFIG.zus.min_emerytura, "Najniższa gwarantowana emerytura (2026 r.: 1 740 zł)."),
    ]));

    const accountsSection = document.createElement("div");
    accountsSection.className = "config-section";
    accountsSection.innerHTML = "<h3>Konta — reguły wypłat i podatków</h3>";
    const grid = document.createElement("div");
    grid.className = "config-accounts";
    for (const [key, rules] of Object.entries(USER_CONFIG.accounts)) {
        grid.appendChild(renderAccountRulesCard(key, rules));
    }
    accountsSection.appendChild(grid);
    root.appendChild(accountsSection);
}

function configSection(title, fields) {
    const section = document.createElement("div");
    section.className = "config-section";
    section.innerHTML = `<h3>${title}</h3>`;
    const grid = document.createElement("div");
    grid.className = "config-fields";
    fields.forEach((f) => grid.appendChild(f));
    section.appendChild(grid);
    return section;
}

function configPathValue(config, path) {
    return path.split(".").reduce((value, part) => value?.[part], config);
}

function configValuesEqual(a, b) {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
    return a === b;
}

function formatConfigValue(value, percent = false) {
    if (value == null) return "Nie ustawiono";
    const number = percent ? value * 100 : value;
    const formatted = Number(number).toLocaleString("pl-PL", { maximumFractionDigits: 4 });
    return percent ? `${formatted}%` : formatted;
}

// Pole konfiguracji: edycja w miejscu (bez trybu podglądu). Kropka przy etykiecie
// i aktywny przycisk „przywróć” sygnalizują wartość inną niż w presecie.
function configFieldShell(path, label, hint, editorMarkup, displayValue, inputValue = (current) => current) {
    const wrap = document.createElement("div");
    wrap.className = "field config-field";
    wrap.innerHTML = `
        <div class="config-field-heading">
            <label class="config-field-label">${tipLabelHtml(label, hint)}</label>
            <span class="config-override-indicator" role="img" hidden></span>
        </div>
        <div class="config-field-control">
            <div class="config-inline-editor">${editorMarkup}</div>
            <button type="button" class="btn btn-ghost btn-icon config-restore-btn">${iconSvg("restore")}</button>
        </div>
    `;

    const input = wrap.querySelector(".acc-field, select");
    const indicator = wrap.querySelector(".config-override-indicator");
    const restoreBtn = wrap.querySelector(".config-restore-btn");
    const restoreLabel = CONFIG_BASELINE_NAME === "Własna konfiguracja"
        ? "Przywróć zapisaną wartość"
        : "Przywróć z presetu";
    restoreBtn.title = restoreLabel;
    restoreBtn.setAttribute("aria-label", restoreLabel);
    input.setAttribute("aria-label", label);

    function updateState() {
        const isChanged = !configValuesEqual(
            configPathValue(USER_CONFIG, path),
            configPathValue(CONFIG_BASELINE || DEFAULT_CONFIG, path)
        );
        if (isChanged) CONFIG_OVERRIDE_PATHS.add(path);
        else CONFIG_OVERRIDE_PATHS.delete(path);
        indicator.hidden = !isChanged;
        indicator.title = CONFIG_BASELINE_NAME === "Własna konfiguracja"
            ? "Wartość różni się od zapisanej konfiguracji"
            : "Wartość różni się od presetu";
        indicator.setAttribute("aria-label", indicator.title);
        wrap.classList.toggle("has-override", isChanged);
        restoreBtn.disabled = !isChanged;
        wrap.title = displayValue(configPathValue(USER_CONFIG, path));
    }

    restoreBtn.addEventListener("click", () => {
        const baselineValue = configPathValue(CONFIG_BASELINE || DEFAULT_CONFIG, path);
        const restoredValue = inputValue(baselineValue);
        input.value = restoredValue == null ? "" : String(restoredValue);
        input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    });

    updateState();
    wrap._updateConfigState = updateState;
    return wrap;
}

function configField(path, label, value, percent, hint, ticks, nullable = false) {
    const raw = value == null ? null : percent ? value * 100 : value;
    const displayVal = raw == null ? "" : Math.round(raw * 1e4) / 1e4;
    const inputMin = ticks && ticks.length ? Math.min(...ticks) : 0;
    const hasTicks = Boolean(ticks && ticks.length);
    const emptyDefault = percent ? "24" : "150000";
    const editorMarkup = `<div class="num-control">
                <button type="button" class="stepper stepper-down" tabindex="-1" aria-label="Zmniejsz ${escapeHtml(label)}">&minus;</button>
                <input type="number" class="acc-field" min="${inputMin}" step="any" value="${displayVal}" ${nullable ? `placeholder="—" data-empty="${emptyDefault}"` : ""} />
                <button type="button" class="stepper stepper-up" tabindex="-1" aria-label="Zwiększ ${escapeHtml(label)}">+</button>
            </div>${percent ? '<span class="field-unit">%</span>' : ""}`;
    const wrap = configFieldShell(
        path,
        label,
        hint,
        editorMarkup,
        (current) => formatConfigValue(current, percent),
        (current) => current == null ? null : percent ? current * 100 : current
    );
    const input = wrap.querySelector(".acc-field");

    if (hasTicks) input.dataset.ticks = JSON.stringify(ticks);

    input.addEventListener("input", () => {
        const parsed = input.value === "" ? (nullable ? null : 0) : (parseFloat(input.value) || 0);
        const normalized = nullable && parsed === 0 ? null : parsed;
        setConfigPath(path, normalized == null ? null : percent ? normalized / 100 : normalized);
        wrap._updateConfigState();
        updateStageHints(document.getElementById("stages-container"));
    });
    return wrap;
}

function configNumberField(path, label, value, hint) {
    return configField(path, label, value, false, hint);
}

function configPercentField(path, label, value, hint, ticks) {
    return configField(path, label, value, true, hint, ticks);
}

function configNullableNumberField(path, label, value, hint) {
    return configField(path, label, value, false, hint, null, true);
}

function configNullablePercentField(path, label, value, hint) {
    return configField(path, label, value, true, hint, null, true);
}

function renderAccountRulesCard(key, rules) {
    const info = getAccountInfo(key);
    const card = document.createElement("details");
    card.className = "account-rules-card";
    card.open = !window.matchMedia("(max-width: 768px)").matches;
    card.innerHTML = `<summary class="account-rules-summary"><span class="account-rules-icon">${ACCOUNT_ICONS[key] || ""}</span>${tipLabelHtml(ACCOUNT_LABELS[key] || key, info)}<span class="account-rules-chevron" aria-hidden="true">${iconSvg("chevron")}</span></summary><div class="account-rules-body"></div>`;
    card.querySelector(".account-rules-summary .tip")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    const body = card.querySelector(".account-rules-body");
    body.appendChild(configPercentField("accounts." + key + ".default_roi", "Domyślne ROI (realne)", rules.default_roi ?? 0.04, "Domyślna realna stopa zwrotu (ponad inflacją) dla tego konta w Asystencie i przy dodawaniu nowego kafelka."));
    body.appendChild(configSelect("accounts." + key + ".tax_model", "Model podatkowy", rules.tax_model, TAX_MODEL_LABELS, "Sposób opodatkowania wypłat z konta."));
    body.appendChild(configPercentField("accounts." + key + ".tax_rate", "Stawka ryczałtowa", rules.tax_rate, "Stawka podatku od zysku/całości po osiągnięciu docelowego wieku."));
    body.appendChild(configSelect("accounts." + key + ".tax_basis", "Podstawa", rules.tax_basis, TAX_BASIS_LABELS, "Podstawa opodatkowania ryczałtem: zysk albo cała wypłata."));
    body.appendChild(configNumberField("accounts." + key + ".min_withdrawal_age", "Wiek zmiany reżimu", rules.min_withdrawal_age, "Wiek, od którego wypłaty nie są już objęte reżimem „przed wiekiem” (np. 60 dla IKE, 65 dla IKZE)."));
    body.appendChild(configSelect("accounts." + key + ".early_tax_model", "Model przed wiekiem", rules.early_tax_model, TAX_MODEL_LABELS, "Opodatkowanie wypłat przed osiągnięciem docelowego wieku (np. skala PIT dla IKZE)."));
    body.appendChild(configPercentField("accounts." + key + ".early_tax_rate", "Stawka przed wiekiem", rules.early_tax_rate, "Stawka podatku obowiązująca przed osiągnięciem docelowego wieku."));
    body.appendChild(configPercentField("accounts." + key + ".asset_tax_rate", "Podatek od wartości aktywów", rules.asset_tax_rate, "Roczny podatek od wartości aktywów ponad próg zwolnienia (OKI: 0,85%)."));
    body.appendChild(configNumberField("accounts." + key + ".asset_exemption", "Próg zwolnienia aktywów", rules.asset_exemption, "Kwota, poniżej której aktywa nie podlegają corocznemu podatkowi od wartości."));

    return card;
}

function configSelect(path, label, value, options, hint) {
    const editorMarkup = `<select class="select config-select"></select>`;
    const wrap = configFieldShell(path, label, hint, editorMarkup, (current) => {
        const option = options[current];
        return option || current;
    });
    const select = wrap.querySelector("select");
    for (const [val, text] of Object.entries(options)) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = text;
        if (val === value) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener("change", () => {
        setConfigPath(path, select.value);
        wrap._updateConfigState();
        updateStageHints(document.getElementById("stages-container"));
    });
    return wrap;
}

async function resetConfig() {
    USER_CONFIG = structuredClone(DEFAULT_CONFIG);
    CONFIG_BASELINE = structuredClone(DEFAULT_CONFIG);
    CONFIG_BASELINE_NAME = "Domyślne 2026";
    CONFIG_OVERRIDE_PATHS.clear();
    _currentPresetId = null;
    _currentPresetName = "Domyślne 2026";
    renderConfigView();
    initTipAnchoring();
    updateStageHints(document.getElementById("stages-container"));
    refreshPresetBar();
    if (window.getCurrentUserEmail?.()) {
        fetch("/api/config/user", { method: "DELETE" }).catch(() => {});
    }
}

// --- Presety ---

function initPresetBar() {
    const select = document.getElementById("presetSelect");
    const saveBtn = document.getElementById("presetSaveBtn");
    const deleteBtn = document.getElementById("presetDeleteBtn");
    const exportBtn = document.getElementById("presetExportBtn");
    const importInput = document.getElementById("presetImportInput");

    select.addEventListener("change", async () => {
        const opt = select.selectedOptions[0];
        if (!opt) return;
        if (opt.dataset.isCustom === "true") return;
        const presetId = opt.dataset.presetId;
        const presetName = opt.dataset.presetName;
        const isBuiltin = opt.dataset.isBuiltin === "true";
        const samePreset = isBuiltin
            ? presetName === CONFIG_BASELINE_NAME
            : Number(presetId) === _currentPresetId;
        if (samePreset) return;
        if (CONFIG_OVERRIDE_PATHS.size && !confirm("Zmiana presetu zastąpi bieżące wartości i usunie ich nadpisania. Kontynuować?")) {
            refreshPresetBar();
            return;
        }
        if (isBuiltin) {
            await applyPresetByName(presetName);
        } else if (presetId) {
            await applyPresetById(parseInt(presetId, 10));
        }
    });

    saveBtn.addEventListener("click", async () => {
        const name = prompt("Nazwa nowego presetu:");
        if (!name) return;
        try {
            const res = await fetch("/api/presets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), config: USER_CONFIG }),
            });
            if (!res.ok) {
                const err = await res.json();
                alert(err.detail || "Błąd zapisu presetu");
                return;
            }
            const saved = await res.json();
            _currentPresetId = saved.id;
            _currentPresetName = null;
            CONFIG_BASELINE = structuredClone(USER_CONFIG);
            CONFIG_BASELINE_NAME = saved.name;
            CONFIG_OVERRIDE_PATHS.clear();
            await refreshPresets();
            renderConfigView();
            initTipAnchoring();
            refreshPresetBar();
            scheduleConfigSave();
        } catch (err) {
            console.error("Błąd zapisu presetu:", err);
        }
    });

    deleteBtn.addEventListener("click", async () => {
        if (_currentPresetId === null || !confirm("Na pewno usunąć ten preset? Po usunięciu zostanie wczytana konfiguracja Domyślne 2026.")) return;
        try {
            const response = await fetch(`/api/presets/${_currentPresetId}`, { method: "DELETE" });
            if (!response.ok) throw new Error("Nie udało się usunąć presetu.");
            await refreshPresets();
            await applyPresetByName("Domyślne 2026");
        } catch (err) {
            console.error("Błąd usuwania presetu:", err);
        }
    });

    exportBtn.addEventListener("click", () => {
        const name = _currentPresetId !== null
            ? (PRESETS.find(p => p.id === _currentPresetId)?.name || "preset")
            : (CONFIG_BASELINE_NAME || "preset");
        const blob = new Blob([JSON.stringify(USER_CONFIG, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    });

    importInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const config = JSON.parse(text);
            const name = prompt("Nazwa dla zaimportowanego presetu:", file.name.replace(/\.json$/, ""));
            if (!name) return;
            if (CONFIG_OVERRIDE_PATHS.size && !confirm("Importowany preset zastąpi bieżące wartości i usunie ich nadpisania. Kontynuować?")) return;
            const res = await fetch("/api/presets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), config }),
            });
            if (!res.ok) {
                const err = await res.json();
                alert(err.detail || "Błąd importu presetu");
                return;
            }
            const saved = await res.json();
            await refreshPresets();
            await applyPresetById(saved.id);
        } catch (err) {
            alert("Nieprawidłowy plik JSON: " + err.message);
        } finally {
            importInput.value = "";
        }
    });

    refreshPresetBar();
}

function refreshPresetBar() {
    const select = document.getElementById("presetSelect");
    const deleteBtn = document.getElementById("presetDeleteBtn");
    select.innerHTML = "";

    for (const p of PRESETS) {
        const opt = document.createElement("option");
        opt.textContent = p.name;
        opt.dataset.presetId = p.id ?? "";
        opt.dataset.presetName = p.name;
        opt.dataset.isBuiltin = p.is_builtin;
        if (p.is_builtin && p.name === CONFIG_BASELINE_NAME) opt.selected = true;
        else if (_currentPresetId !== null && p.id === _currentPresetId) opt.selected = true;
        select.appendChild(opt);
    }

    if (CONFIG_BASELINE_NAME === "Własna konfiguracja") {
        const opt = document.createElement("option");
        opt.textContent = "Własna konfiguracja";
        opt.dataset.isCustom = "true";
        opt.selected = true;
        select.appendChild(opt);
    }

    if (!select.value && select.options.length > 0) {
        select.selectedIndex = 0;
    }

    deleteBtn.hidden = _currentPresetId === null;
}

async function refreshPresets() {
    try {
        const res = await fetch("/api/presets");
        const data = await res.json();
        PRESETS = data.presets || [];
    } catch (err) {
        console.error("Błąd odświeżania presetów:", err);
    }
}

async function applyPresetByName(name) {
    try {
        const res = await fetch("/api/config");
        const defaults = await res.json();
        const overrides = BUILTIN_PRESETS_CLIENT[name];
        USER_CONFIG = overrides
            ? deepMerge(structuredClone(defaults), overrides)
            : backfillConfig(defaults);
        CONFIG_BASELINE = structuredClone(USER_CONFIG);
        CONFIG_BASELINE_NAME = name;
        CONFIG_OVERRIDE_PATHS.clear();
        _currentPresetId = null;
        _currentPresetName = name;
        renderConfigView();
        initTipAnchoring();
        updateStageHints(document.getElementById("stages-container"));
        scheduleConfigSave();
        refreshPresetBar();
    } catch (err) {
        console.error("Błąd wczytywania presetu:", err);
    }
}

const BUILTIN_PRESETS_CLIENT = {
    "Domyślne 2026": { year: 2026, inflation: 0.025 },
    "2027 (projekt UD458)": {
        year: 2027,
        prog: 130_000,
        prog2: 150_000,
        rate_lower: 0.12,
        rate_middle: 0.24,
        rate_upper: 0.32,
        danina_rate: 0.05,
        kup_50_limit: 130_000,
        inflation: 0.025,
    },
    "Konserwatywne": {
        inflation: 0.035,
        zus: { waloryzacja_skladek: 0.01, waloryzacja_swiadczenia: 0.01 },
        accounts: {
            broker: { default_roi: 0.035 },
            ike: { default_roi: 0.035 },
            ikze: { default_roi: 0.035 },
            oipe: { default_roi: 0.035 },
            ppk: { default_roi: 0.03 },
            ppe: { default_roi: 0.03 },
            oki_inw: { default_roi: 0.03 },
            oki_osk: { default_roi: 0.01 },
            obligacje: { default_roi: 0.015 },
            lokata: { default_roi: 0.005 },
            krypto: { default_roi: 0.03 },
            zus: { default_roi: 0.03 },
        },
    },
    "Realne": {
        inflation: 0.025,
        zus: { waloryzacja_skladek: 0.02, waloryzacja_swiadczenia: 0.02 },
        accounts: {
            broker: { default_roi: 0.05 },
            ike: { default_roi: 0.05 },
            ikze: { default_roi: 0.05 },
            oipe: { default_roi: 0.05 },
            ppk: { default_roi: 0.04 },
            ppe: { default_roi: 0.04 },
            oki_inw: { default_roi: 0.045 },
            oki_osk: { default_roi: 0.02 },
            obligacje: { default_roi: 0.02 },
            lokata: { default_roi: 0.01 },
            krypto: { default_roi: 0.06 },
            zus: { default_roi: 0.04 },
        },
    },
    "Optymistyczne": {
        inflation: 0.015,
        zus: { waloryzacja_skladek: 0.025, waloryzacja_swiadczenia: 0.025 },
        accounts: {
            broker: { default_roi: 0.065 },
            ike: { default_roi: 0.065 },
            ikze: { default_roi: 0.065 },
            oipe: { default_roi: 0.065 },
            ppk: { default_roi: 0.055 },
            ppe: { default_roi: 0.055 },
            oki_inw: { default_roi: 0.06 },
            oki_osk: { default_roi: 0.025 },
            obligacje: { default_roi: 0.025 },
            lokata: { default_roi: 0.015 },
            krypto: { default_roi: 0.08 },
            zus: { default_roi: 0.05 },
        },
    },
};

function deepMerge(base, overrides) {
    for (const [key, val] of Object.entries(overrides)) {
        if (val && typeof val === "object" && !Array.isArray(val) && base[key] && typeof base[key] === "object") {
            deepMerge(base[key], val);
        } else {
            base[key] = val;
        }
    }
    return base;
}

async function applyPresetById(presetId) {
    try {
        const res = await fetch(`/api/presets/${presetId}`);
        const data = await res.json();
        USER_CONFIG = backfillConfig(data.config);
        CONFIG_BASELINE = structuredClone(USER_CONFIG);
        CONFIG_BASELINE_NAME = PRESETS.find(preset => preset.id === presetId)?.name || "Własna konfiguracja";
        CONFIG_OVERRIDE_PATHS.clear();
        _currentPresetId = presetId;
        _currentPresetName = null;
        renderConfigView();
        initTipAnchoring();
        updateStageHints(document.getElementById("stages-container"));
        scheduleConfigSave();
        refreshPresetBar();
    } catch (err) {
        console.error("Błąd wczytywania presetu:", err);
    }
}

// --- Sesja i zapis symulacji ---

function defaultSimName() {
    return "Symulacja " + new Date().toLocaleDateString("pl-PL");
}

function initSaveButton() {
    const btn = document.getElementById("saveSimBtn");
    const exportBtn = document.getElementById("exportSimBtn");
    const importInput = document.getElementById("importSimInput");

    if (exportBtn) {
        exportBtn.addEventListener("click", () => {
            const data = lastInput || gatherFormData();
            const payload = {
                name: defaultSimName(),
                exported_at: new Date().toISOString(),
                input: data,
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "symulacja_fire_" + new Date().toISOString().slice(0, 10) + ".json";
            a.click();
            URL.revokeObjectURL(a.href);
        });
    }

    if (importInput) {
        importInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const item = Array.isArray(parsed) ? parsed[0] : parsed;
                const inputData = item?.input && Array.isArray(item.input.stages) ? item.input : item;
                if (!inputData || !Array.isArray(inputData.stages)) {
                    throw new Error("Brak listy etapów (stages) w pliku JSON.");
                }
                populateStages(inputData);
                switchToConfig();
            } catch (err) {
                alert("Nieprawidłowy plik symulacji JSON: " + err.message);
            }
            importInput.value = "";
        });
    }

    btn.addEventListener("click", async () => {
        if (!lastInput) return;
        const session = await fetch("/api/session").then((r) => r.json()).catch(() => ({ email: null }));
        if (!session.email) {
            alert("Aby zapisać symulację, zaloguj się lub zarejestruj.");
            window.location.href = "/";
            return;
        }
        const name = prompt("Nazwa symulacji:", defaultSimName());
        if (name === null || !name.trim()) return;
        btn.disabled = true;
        try {
            const res = await fetch("/api/simulations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), input: lastInput }),
            });
            const result = await res.json();
            if (!res.ok) {
                alert("Błąd zapisu: " + (result.detail || result.error || "nieznany"));
            } else {
                alert(`Zapisano symulację „${result.name}".`);
                clearWizardDraft();
                const bar = document.getElementById("wizardDraftBar");
                if (bar) bar.classList.add("hidden");
            }
        } catch (err) {
            alert("Błąd zapisu: " + err.message);
        } finally {
            btn.disabled = false;
        }
    });
}

// --- Wczytywanie zapisanej symulacji (/sim?id=N) ---

function migrateLegacyAccounts(stage) {
    // Stare zapisy miały jedno konto "oki" z wyborem typu aktywów
    // (asset_exemption: 100000 inwestycyjne / 25000 oszczędnościowe).
    if (!stage.accounts || !stage.accounts["oki"]) return;
    const legacy = stage.accounts["oki"];
    const target =
        legacy.asset_exemption === 25000 ? "oki_osk" : "oki_inw";
    const { asset_exemption, ...rest } = legacy;
    delete stage.accounts["oki"];
    stage.accounts[target] = rest;
}

function populateStages(inputData) {
    const container = document.getElementById("stages-container");
    if (inputData.config) CONFIG = backfillConfig(inputData.config);
    if (inputData.gender) setGender(inputData.gender);
    resetStartingBalanceValues();
    container.innerHTML = "";
    (inputData.stages || []).forEach((stage) => {
        migrateLegacyAccounts(stage);
        container.appendChild(createStageBlock(stage));
    });
    applyZusWaloryzacjaDefaults();
    updateStageButtons(container);
    updateStageHints(container);
    refreshRealizationToggles(container);
}

async function loadSimulation(simId, container) {
    try {
        const res = await fetch("/api/simulations/" + simId);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Nie można wczytać symulacji");
        populateStages(data.input);
        if (data.name) document.title = "FIRE Simulator — " + data.name;
    } catch (err) {
        alert("Błąd: " + err.message);
        updateStageButtons(container);
        updateStageHints(container);
        refreshRealizationToggles(container);
    }
}

// --- Czytelność wyników: kolumny, gęstość, wykres ---

const COLUMN_TOGGLES_KEY = "fire.columnToggles";
const DENSITY_KEY = "fire.density";

function initResultsControls() {
    const density = document.getElementById("densitySelect");
    const saved = localStorage.getItem(DENSITY_KEY);
    if (saved) density.value = saved;
    density.addEventListener("change", () => {
        localStorage.setItem(DENSITY_KEY, density.value);
        applyDensity();
    });
}

function renderColumnToggles(accounts) {
    const container = document.getElementById("columnToggles");
    container.innerHTML = "";
    const hidden = new Set(JSON.parse(localStorage.getItem(COLUMN_TOGGLES_KEY) || "[]"));

    const cols = accounts.map((a) => ({ col: a, label: ACCOUNT_LABELS[a] || a }));
    cols.push(
        { col: "wealth", label: "Majątek" },
        { col: "annual", label: "Wypłata roczna" },
        { col: "monthly", label: "Wypłata mies." },
        { col: "tax", label: "Podatek" }
    );

    cols.forEach(({ col, label }) => {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "pill-toggle col-toggle" + (hidden.has(col) ? "" : " is-active");
        toggle.setAttribute("aria-pressed", String(!hidden.has(col)));
        toggle.dataset.col = col;
        toggle.innerHTML = `${iconSvg(hidden.has(col) ? "plus" : "check")}<span>${escapeHtml(label)}</span>`;
        toggle.addEventListener("click", () => {
            const nowHidden = !hidden.has(col);
            if (nowHidden) hidden.add(col);
            else hidden.delete(col);
            localStorage.setItem(COLUMN_TOGGLES_KEY, JSON.stringify([...hidden]));
            toggle.classList.toggle("is-active", !nowHidden);
            toggle.setAttribute("aria-pressed", String(!nowHidden));
            toggle.querySelector(".icon").outerHTML = iconSvg(nowHidden ? "plus" : "check");
            applyColVisibility();
        });
        container.appendChild(toggle);
    });
}

function applyColVisibility() {
    const hidden = new Set(JSON.parse(localStorage.getItem(COLUMN_TOGGLES_KEY) || "[]"));
    document.querySelectorAll("#resultsTable [data-col]").forEach((cell) => {
        cell.classList.toggle("col-hidden", hidden.has(cell.dataset.col));
    });
}

function applyDensity() {
    const tbody = document.querySelector("#resultsTable tbody");
    if (!tbody) return;
    const rows = tbody.querySelectorAll("tr");
    const density = parseInt(document.getElementById("densitySelect").value, 10) || 1;
    rows.forEach((tr, i) => {
        const isLast = i === rows.length - 1;
        tr.classList.toggle("density-hidden", density > 1 && !isLast && i % density !== 0);
    });
}

function renderWealthChart(data) {
    const container = document.getElementById("wealthChart");
    const detail = document.getElementById("wealthDetail");
    const years = data.years || [];
    if (years.length < 2) {
        container.classList.add("hidden");
        detail.classList.add("hidden");
        container.innerHTML = "";
        detail.innerHTML = "";
        return;
    }

    const W = 1000;
    const H = 320;
    const padX = 50;
    const padY = 26;
    const padBottom = 36;
    const innerW = W - padX * 2;
    const innerH = H - padY - padBottom;

    const minAge = years[0].age;
    const maxAge = years[years.length - 1].age;
    const rawMax = Math.max(...years.map((y) => y.total_wealth));
    const maxWealth = rawMax > 0 ? rawMax * 1.1 : 1;
    const x = (age) => padX + ((age - minAge) / Math.max(1, maxAge - minAge)) * innerW;
    const y = (val) => H - padBottom - (val / Math.max(1, maxWealth)) * innerH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg" id="wealthSvg">`;

    /* grid lines + y-axis */
    svg += `<g class="grid-lines">`;
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i++) {
        const gy = padY + (innerH * i) / ySteps;
        const val = maxWealth * (1 - i / ySteps);
        svg += `<line x1="${padX}" y1="${gy}" x2="${W - padX}" y2="${gy}"/>`;
        svg += `<text x="${padX - 6}" y="${gy + 4}" class="axis-text" text-anchor="end">${Math.round(val / 1000).toLocaleString("pl-PL")}k</text>`;
    }

    /* x-axis ticks — always step 5 */
    const ageRange = maxAge - minAge;
    const step = ageRange <= 15 ? 1 : 5;
    for (let a = Math.ceil(minAge / step) * step; a <= maxAge; a += step) {
        const tx = x(a);
        svg += `<line x1="${tx}" y1="${H - padBottom}" x2="${tx}" y2="${H - padBottom + 5}" stroke="var(--text-dim)" stroke-width="1"/>`;
        svg += `<text x="${tx}" y="${H - padBottom - 6}" class="axis-text" text-anchor="middle">${a}</text>`;
    }
    svg += `<text x="${padX - 6}" y="${padY - 8}" class="axis-text" text-anchor="end">zł</text>`;
    svg += `<text x="${W / 2}" y="${H - 4}" class="axis-text" text-anchor="middle">Wiek (r.ż.)</text>`;
    svg += "</g>";

    /* area + line */
    const points = years.map((yr) => `${x(yr.age).toFixed(1)},${y(yr.total_wealth).toFixed(1)}`);
    const baseY = (H - padBottom).toFixed(1);
    svg += `<polygon class="chart-area wealth-area" points="${x(minAge).toFixed(1)},${baseY} ${points.join(" ")} ${x(maxAge).toFixed(1)},${baseY}"/>`;
    svg += `<polyline class="chart-line wealth-line" fill="none" points="${points.join(" ")}"/>`;

    /* clickable dots — sample if too many years */
    const maxDots = 30;
    const dotYears = years.length <= maxDots ? years : years.filter((_, i) => i % Math.ceil(years.length / maxDots) === 0 || i === years.length - 1);
    dotYears.forEach((yr, i) => {
        const cls = i === 0 ? "chart-dot chart-dot-wealth active" : "chart-dot chart-dot-wealth";
        svg += `<circle class="${cls}" cx="${x(yr.age).toFixed(1)}" cy="${y(yr.total_wealth).toFixed(1)}" r="4" data-age="${yr.age}"/>`;
    });

    svg += "</svg>";
    container.innerHTML = svg;
    container.classList.remove("hidden");

    /* click handler on dots */
    container.querySelectorAll(".chart-dot-wealth").forEach((dot) => {
        dot.addEventListener("click", (e) => {
            const age = parseInt(e.target.dataset.age, 10);
            const yr = years.find((y) => y.age === age);
            if (!yr) return;
            container.querySelectorAll(".chart-dot-wealth").forEach((d) => d.classList.remove("active"));
            e.target.classList.add("active");
            renderWealthDetail(yr, detail);
        });
    });

    /* auto-select first dot */
    renderWealthDetail(years[0], detail);
}

function renderWealthDetail(yr, container) {
    const fmt = formatMoney;

    /* find the active stage for this age and determine pill class */
    let pillClass = "";
    const stageAccounts = new Set();
    if (lastInput && lastInput.stages) {
        for (const stage of lastInput.stages) {
            if (yr.age >= stage.start_age && yr.age < stage.end_age) {
                for (const name of Object.keys(stage.accounts || {})) {
                    stageAccounts.add(name);
                }
                pillClass = stage.stage_type === "realizacja" ? "pill-active" : "pill-accum";
                break;
            }
        }
    }

    const balEntries = Object.entries(yr.balances || {}).filter(([, v]) => v > 0);
    const balHtml = balEntries.map(([k, v]) => {
        const match = stageAccounts.has(k);
        const chipKind = match ? (pillClass === "pill-active" ? " chip-real" : " chip-accum") : "";
        return `<span class="chip${chipKind}">${escapeHtml(ACCOUNT_LABELS[k] || k)}: ${fmt(v)}</span>`;
    }).join("");

    container.innerHTML = `
        <div class="detail-header">
            <strong>${yr.age} r.ż.</strong> — ${escapeHtml(yr.stage_name || "")}
        </div>
        <div class="detail-grid">
            <div class="detail-item"><span class="detail-label">Majątek łącznie</span><span class="detail-value">${fmt(yr.total_wealth)}</span></div>
            <div class="detail-item"><span class="detail-label">Wypłata mies.</span><span class="detail-value">${fmt(yr.monthly_withdrawal)}</span></div>
            <div class="detail-item"><span class="detail-label">Wypłata roczna</span><span class="detail-value">${fmt(yr.annual_withdrawal)}</span></div>
            <div class="detail-item"><span class="detail-label">Podatek</span><span class="detail-value${yr.tax_paid < 0 ? ' text-success' : ''}">${fmt(yr.tax_paid)}</span></div>
        </div>
        ${balHtml ? `<div class="detail-balances chip-row">${balHtml}</div>` : ""}
    `;
    container.classList.remove("hidden");
}

function renderWithdrawalChart(data) {
    const container = document.getElementById("withdrawalChart");
    const detail = document.getElementById("withdrawalDetail");
    const years = data.years || [];
    const withWithdrawals = years.filter((y) => y.monthly_withdrawal > 0);
    if (withWithdrawals.length < 2) {
        container.classList.add("hidden");
        detail.classList.add("hidden");
        container.innerHTML = "";
        detail.innerHTML = "";
        return;
    }

    const W = 1000;
    const H = 320;
    const padX = 50;
    const padY = 26;
    const padBottom = 36;
    const innerW = W - padX * 2;
    const innerH = H - padY - padBottom;

    const minAge = withWithdrawals[0].age;
    const maxAge = withWithdrawals[withWithdrawals.length - 1].age;
    const maxWithdrawal = Math.max(...withWithdrawals.map((y) => y.monthly_withdrawal));
    const x = (age) => padX + ((age - minAge) / Math.max(1, maxAge - minAge)) * innerW;
    const y = (val) => H - padBottom - (val / Math.max(1, maxWithdrawal)) * innerH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg" id="withdrawalSvg">`;

    /* grid lines */
    svg += `<g class="grid-lines">`;
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i++) {
        const gy = padY + (innerH * i) / ySteps;
        const val = maxWithdrawal * (1 - i / ySteps);
        svg += `<line x1="${padX}" y1="${gy}" x2="${W - padX}" y2="${gy}"/>`;
        svg += `<text x="${padX - 6}" y="${gy + 4}" class="axis-text" text-anchor="end">${Math.round(val).toLocaleString("pl-PL")}</text>`;
    }

    /* x-axis ticks — always step 5 */
    const ageRange = maxAge - minAge;
    const step = ageRange <= 15 ? 1 : 5;
    for (let a = Math.ceil(minAge / step) * step; a <= maxAge; a += step) {
        const tx = x(a);
        svg += `<line x1="${tx}" y1="${H - padBottom}" x2="${tx}" y2="${H - padBottom + 5}" stroke="var(--text-dim)" stroke-width="1"/>`;
        svg += `<text x="${tx}" y="${H - padBottom - 6}" class="axis-text" text-anchor="middle">${a}</text>`;
    }
    svg += `<text x="${padX - 6}" y="${padY - 8}" class="axis-text" text-anchor="end">zł/mies.</text>`;
    svg += `<text x="${W / 2}" y="${H - 4}" class="axis-text" text-anchor="middle">Wiek (r.ż.)</text>`;
    svg += "</g>";

    /* area + line */
    const points = withWithdrawals.map((yr) => `${x(yr.age).toFixed(1)},${y(yr.monthly_withdrawal).toFixed(1)}`);
    const baseY = (H - padBottom).toFixed(1);
    svg += `<polygon class="chart-area withdrawal-area" points="${x(minAge).toFixed(1)},${baseY} ${points.join(" ")} ${x(maxAge).toFixed(1)},${baseY}"/>`;
    svg += `<polyline class="chart-line withdrawal-line" fill="none" points="${points.join(" ")}"/>`;

    /* clickable dots */
    withWithdrawals.forEach((yr, i) => {
        const cls = i === 0 ? "chart-dot chart-dot-green active" : "chart-dot chart-dot-green";
        svg += `<circle class="${cls}" cx="${x(yr.age).toFixed(1)}" cy="${y(yr.monthly_withdrawal).toFixed(1)}" r="4" data-age="${yr.age}"/>`;
    });

    svg += "</svg>";
    container.innerHTML = svg;
    container.classList.remove("hidden");

    /* click handler on dots */
    container.querySelectorAll(".chart-dot-green").forEach((dot) => {
        dot.addEventListener("click", (e) => {
            const age = parseInt(e.target.dataset.age, 10);
            const yr = years.find((y) => y.age === age);
            if (!yr) return;
            container.querySelectorAll(".chart-dot-green").forEach((d) => d.classList.remove("active"));
            e.target.classList.add("active");
            renderWithdrawalDetail(yr, detail);
        });
    });

    /* auto-select first dot */
    const firstYr = withWithdrawals[0];
    renderWithdrawalDetail(firstYr, detail);
}

function renderWithdrawalDetail(yr, container) {
    const fmt = formatMoney;

    /* find which accounts belong to the active stage */
    const activeAccounts = new Set();
    if (lastInput && lastInput.stages) {
        for (const stage of lastInput.stages) {
            if (stage.stage_type === "realizacja" && yr.age >= stage.start_age && yr.age < stage.end_age) {
                for (const name of Object.keys(stage.accounts || {})) {
                    activeAccounts.add(name);
                }
            }
        }
    }

    const balEntries = Object.entries(yr.balances || {}).filter(([, v]) => v > 0);
    const balHtml = balEntries.map(([k, v]) => {
        const isActive = activeAccounts.has(k);
        return `<span class="chip${isActive ? " chip-real" : ""}">${escapeHtml(ACCOUNT_LABELS[k] || k)}: ${fmt(v)}</span>`;
    }).join("");

    container.innerHTML = `
        <div class="detail-header">
            <strong>${yr.age} r.ż.</strong> — ${escapeHtml(yr.stage_name || "")}
        </div>
        <div class="detail-grid">
            <div class="detail-item"><span class="detail-label">Majątek łącznie</span><span class="detail-value">${fmt(yr.total_wealth)}</span></div>
            <div class="detail-item"><span class="detail-label">Wypłata mies.</span><span class="detail-value">${fmt(yr.monthly_withdrawal)}</span></div>
            <div class="detail-item"><span class="detail-label">Wypłata roczna</span><span class="detail-value">${fmt(yr.annual_withdrawal)}</span></div>
            <div class="detail-item"><span class="detail-label">Podatek</span><span class="detail-value${yr.tax_paid < 0 ? ' text-success' : ''}">${fmt(yr.tax_paid)}</span></div>
        </div>
        ${balHtml ? `<div class="detail-balances chip-row">${balHtml}</div>` : ""}
    `;
    container.classList.remove("hidden");
}
