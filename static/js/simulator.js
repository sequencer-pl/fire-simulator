// simulator.js — Main entry, config, results, save/load

const TAX_MODEL_LABELS = { none: "Brak", flat: "Ryczałt", scale: "Skala PIT", assets: "Od wartości aktywów" };
const TAX_BASIS_LABELS = { gains: "od zysku", full: "od całości" };
let CONFIG = null;
let DEFAULT_CONFIG = null;
let PRESETS = [];
let _currentPresetId = null;
let _currentPresetName = "Domyślne 2026";

let lastInput = null;
let lastResult = null;

function gatherFormData() {
    const stages = [];
    document.querySelectorAll(".stage-block").forEach((block) => {
        const accounts = {};
        block.querySelectorAll(".acc-field").forEach((input) => {
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
        });
    });

    return {
        stages: stages,
        max_age: 100,
        gender: currentGender(),
        monthly_gross: parseFloat(document.getElementById("monthlyGross")?.value) || 0,
        config: CONFIG,
    };
}

function currentGender() {
    const checked = document.querySelector('input[name="gender"]:checked');
    return checked ? checked.value : "m";
}

function setGender(value) {
    const radio = document.querySelector(`input[name="gender"][value="${value}"]`);
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
        div.className = "warning-item";
        div.textContent = "!" + " " + w;
        warnings.appendChild(div);
    });

    const totalContrib = computeTotalUserContributions(lastInput);
    const initCap = computeInitialCapital(lastInput);
    const totalInvested = initCap + totalContrib;
    const multiplier = totalInvested > 0 ? (data.peak_wealth / totalInvested) : 0;
    const multiplierBadge = multiplier > 0
        ? `<span class="summary-badge" title="Majątek szczytowy / (kapitał początkowy + wpłaty własne)">${multiplier.toFixed(1)}×</span>`
        : "";

    summary.innerHTML = `
        <div class="summary-card">
            <div class="label">Początkowy kapitał</div>
            <div class="value purple">${formatMoney(initCap)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Wpłaty własne</div>
            <div class="value primary">${formatMoney(totalContrib)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Majątek szczytowy${multiplierBadge}</div>
            <div class="value accent">${formatMoney(data.peak_wealth)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Majątek końcowy</div>
            <div class="value accent">${formatMoney(data.final_wealth)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Suma wypłat</div>
            <div class="value green">${formatMoney(data.total_withdrawn)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Suma podatków</div>
            <div class="value ${data.total_tax < 0 ? 'green' : 'red'}">${formatMoney(data.total_tax)}</div>
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
            <td class="amount ${y.tax_paid < 0 ? 'green' : ''}" data-col="tax">${formatMoney(y.tax_paid)}</td>
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

    let html = '<h3 class="section-heading">Podsumowanie etapów</h3><div class="stage-summary">';
    for (const st of stages) {
        const isAccum = st.type === "akumulacja";
        const kind = isAccum ? "accum" : "withdraw";

        const accounts = st.accounts
            .map((a) => `<span class="stage-pill">${escapeHtml(ACCOUNT_LABELS[a.key] || a.key)}</span>`)
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

    initModeToggle();
    initConfig();
    refreshSessionBar();
    initSaveButton();
    initResultsControls();
    initStageEventHandlers(container);

    // "Edytuj" button — switch from results back to config
    const editBtn = document.getElementById("editConfigBtn");
    if (editBtn) {
        editBtn.addEventListener("click", () => switchToConfig());
    }

    // Steppery w globalConfig (brutto mies.)
    const globalConfig = document.getElementById("globalConfig");
    if (globalConfig) {
        globalConfig.addEventListener("click", (e) => {
            const btn = e.target.closest(".stepper");
            if (!btn) return;
            const input = btn.closest(".num-control")?.querySelector("input");
            if (!input) return;
            stepInputValue(input, parseInt(btn.dataset.dir) || 0);
        });
    }

    // Steppery w konfiguracji
    const configContent = document.getElementById("config-content");
    if (configContent) {
        configContent.addEventListener("click", (e) => {
            const btn = e.target.closest(".num-control .stepper");
            if (!btn) return;
            const input = btn.parentElement.querySelector(".acc-field");
            if (!input) return;
            stepInputValue(input, btn.classList.contains("stepper-up") ? 1 : -1);
        });
    }

    if (simId) {
        loadSimulation(simId, container);
    } else {
        if (DEFAULTS.monthly_gross) {
            const grossInput = document.getElementById("monthlyGross");
            if (grossInput) grossInput.value = DEFAULTS.monthly_gross;
        }
        (DEFAULTS.stages || []).forEach((s) => container.appendChild(createStageBlock(s)));
        updateStageButtons(container);
        updateStageHints(container);
        refreshRealizationToggles(container);
    }
});

// --- Tryby: Symulator / Konfiguracja ---

function initModeToggle() {
    document.getElementById("modeSimBtn").addEventListener("click", () => switchMode("sim"));
    document.getElementById("modeConfigBtn").addEventListener("click", () => switchMode("config"));
}

function switchMode(mode) {
    document.getElementById("modeSimBtn").classList.toggle("active", mode === "sim");
    document.getElementById("modeConfigBtn").classList.toggle("active", mode === "config");
    document.getElementById("simulatorView").classList.toggle("hidden", mode !== "sim");
    document.getElementById("configView").classList.toggle("hidden", mode !== "config");
}

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
        CONFIG = userData.config ? backfillConfig(userData.config) : structuredClone(DEFAULT_CONFIG);
        const presetsData = await presetsRes.json();
        PRESETS = presetsData.presets || [];
        applyZusWaloryzacjaDefaults();
        renderConfigView();
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
    let obj = CONFIG;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    scheduleConfigSave();
}

function getConfigDefault(path) {
    const parts = path.split(".");
    let val = DEFAULT_CONFIG;
    for (const p of parts) val = val?.[p];
    return val;
}

let _configSaveTimeout = null;
function scheduleConfigSave() {
    if (!window.getCurrentUserEmail?.()) return;
    clearTimeout(_configSaveTimeout);
    _configSaveTimeout = setTimeout(() => {
        fetch("/api/config/user", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(CONFIG),
        }).catch((err) => console.error("Błąd zapisu konfiguracji:", err));
    }, 500);
}

function renderConfigView() {
    const root = document.getElementById("config-content");
    root.innerHTML = "";

    root.appendChild(configSection("Skala podatkowa", [
        configNumberField("kwota_wolna", "Kwota wolna od podatku", CONFIG.kwota_wolna, "Kwota wolna od podatku (2026 r.: 30 000 zł)."),
        configNumberField("prog", "Próg podatkowy", CONFIG.prog, "Próg dochodowy: powyżej kwoty obowiązuje wyższa stawka (2026 r.: 120 000 zł)."),
        configPercentField("rate_lower", "Stawka niższa", CONFIG.rate_lower, "Stawka podatku do progu (2026 r.: 12%)."),
        configPercentField("rate_upper", "Stawka wyższa", CONFIG.rate_upper, "Stawka podatku powyżej progu (2026 r.: 32%)."),
    ]));

    root.appendChild(configSection("Limity rocznych wpłat", [
        configNumberField("limits.ike_annual", "IKE", CONFIG.limits.ike_annual, "Limit roczny wpłat na IKE (2026 r.: 28 260 zł)."),
        configNumberField("limits.ikze_annual", "IKZE — etat", CONFIG.limits.ikze_annual, "Limit roczny IKZE dla zatrudnionych (2026 r.: 11 304 zł)."),
        configNumberField("limits.ikze_annual_self_employed", "IKZE — przedsiębiorca", CONFIG.limits.ikze_annual_self_employed, "Limit roczny IKZE dla przedsiębiorców (2026 r.: 16 956 zł)."),
        configNumberField("limits.oipe_annual", "OIPE", CONFIG.limits.oipe_annual, "Limit roczny wpłat na OIPE (2026 r.: 28 260 zł)."),
        configNumberField("limits.ppe_additional_annual", "PPE — składka dodatkowa", CONFIG.limits.ppe_additional_annual, "Limit roczny składki dodatkowej PPE (2026 r.: 42 390 zł)."),
    ]));

    root.appendChild(configSection("PPK — parametry", [
        configPercentField("ppk.employee_pct", "Wpłata pracownika", CONFIG.ppk.employee_pct, "Ustawowo min. 2% wynagrodzenia; można obniżyć do 0,5%."),
        configPercentField("ppk.employer_pct", "Wpłata pracodawcy", CONFIG.ppk.employer_pct, "Ustawowo min. 1,5%, max 4% wynagrodzenia."),
        configPercentField("ppk.max_total_pct", "Limit sumy wpłat", CONFIG.ppk.max_total_pct, "Ustawowy limit łącznej sumy wpłat pracownika i pracodawcy (8%)."),
        configNumberField("ppk.state_welcoming", "Dopłata powitalna", CONFIG.ppk.state_welcoming, "Jednorazowa dopłata państwa w pierwszym roku akumulacji (250 zł)."),
        configNumberField("ppk.state_annual", "Dopłata roczna", CONFIG.ppk.state_annual, "Coroczna dopłata państwa przy wpłacie min. 0,5% (240 zł)."),
    ]));

    root.appendChild(configSection("PPE — parametry", [
        configPercentField("ppe.max_employer_pct", "Limit składki podstawowej", CONFIG.ppe.max_employer_pct, "Ustawowy limit składki podstawowej pracodawcy (7% wynagrodzenia)."),
    ]));

    root.appendChild(configSection("ZUS — parametry", [
        configPercentField("zus.skladka_rate", "Składka emerytalna", CONFIG.zus.skladka_rate, "Część składki na ubezpieczenie emerytalne (19,52% podstawy)."),
        configPercentField("zus.ofe_rate", "Część składki do OFE", CONFIG.zus.ofe_rate, "Punkt procentowy składki trafiający do OFE dla członków OFE (2,92 pkt)."),
        configNumberField("zus.limit_base_annual", "Limit rocznej podstawy (30×)", CONFIG.zus.limit_base_annual, "Roczna podstawa wymiaru składek (30× przeciętne wynagrodzenie; 0 = brak limitu)."),
        configPercentField("zus.waloryzacja_skladek", "Waloryzacja składek", CONFIG.zus.waloryzacja_skladek, "Roczna waloryzacja kapitału zgromadzonego w ZUS."),
        configPercentField("zus.waloryzacja_swiadczenia", "Waloryzacja świadczenia", CONFIG.zus.waloryzacja_swiadczenia, "Roczna waloryzacja wypłacanej emerytury."),
        configNumberField("zus.wiek_emerytalny_k", "Wiek emerytalny — kobiety", CONFIG.zus.wiek_emerytalny_k, "Powszechny wiek emerytalny kobiet (60 r.ż. od 1.10.2017)."),
        configNumberField("zus.wiek_emerytalny_m", "Wiek emerytalny — mężczyźni", CONFIG.zus.wiek_emerytalny_m, "Powszechny wiek emerytalny mężczyzn (65 r.ż. od 1.10.2017)."),
        configNumberField("zus.min_emerytura", "Emerytura minimalna", CONFIG.zus.min_emerytura, "Najniższa gwarantowana emerytura (2026 r.: 1 740 zł)."),
    ]));

    const accountsSection = document.createElement("div");
    accountsSection.className = "config-section";
    accountsSection.innerHTML = "<h3>Konta — reguły wypłat i podatków</h3>";
    const grid = document.createElement("div");
    grid.className = "config-accounts";
    for (const [key, rules] of Object.entries(CONFIG.accounts)) {
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

function configField(path, label, value, percent, hint) {
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    const raw = percent ? value * 100 : value;
    const displayVal = Math.round(raw * 1e4) / 1e4;
    wrap.innerHTML = `
        <label>${label}${hint ? tipHtml(hint) : ""}</label>
        <div class="num-control">
            <button type="button" class="stepper stepper-down" tabindex="-1" aria-label="Zmniejsz">&minus;</button>
            <input type="number" class="acc-field" min="0" step="any" value="${displayVal}" />
            <button type="button" class="stepper stepper-up" tabindex="-1" aria-label="Zwiększ">+</button>
            <button type="button" class="field-reset" title="Przywróć wartość domyślną" hidden>&#x21ba;</button>
        </div>
    `;
    const input = wrap.querySelector("input");
    const resetBtn = wrap.querySelector(".field-reset");

    function updateIndicator() {
        const cur = percent ? (parseFloat(input.value) || 0) / 100 : (parseFloat(input.value) || 0);
        const def = getConfigDefault(path);
        resetBtn.hidden = Math.abs(cur - def) < 1e-9;
    }

    input.addEventListener("input", () => {
        const parsed = parseFloat(input.value) || 0;
        setConfigPath(path, percent ? parsed / 100 : parsed);
        updateStageHints(document.getElementById("stages-container"));
        updateIndicator();
    });

    resetBtn.addEventListener("click", () => {
        const def = getConfigDefault(path);
        setConfigPath(path, def);
        input.value = percent ? def * 100 : def;
        updateIndicator();
    });

    updateIndicator();
    return wrap;
}

function configNumberField(path, label, value, hint) {
    return configField(path, label, value, false, hint);
}

function configPercentField(path, label, value, hint) {
    return configField(path, label, value, true, hint);
}

function renderAccountRulesCard(key, rules) {
    const info = getAccountInfo(key);
    const card = document.createElement("div");
    card.className = "account-rules-card";
    card.innerHTML = `<h4>${ACCOUNT_LABELS[key] || key}${info ? tipHtml(info) : ""}</h4>`;

    card.appendChild(configSelect("accounts." + key + ".tax_model", "Model podatkowy", rules.tax_model, TAX_MODEL_LABELS, "Sposób opodatkowania wypłat z konta."));
    card.appendChild(configPercentField("accounts." + key + ".tax_rate", "Stawka ryczałtowa", rules.tax_rate, "Stawka podatku od zysku/całości po osiągnięciu docelowego wieku."));
    card.appendChild(configSelect("accounts." + key + ".tax_basis", "Podstawa", rules.tax_basis, TAX_BASIS_LABELS, "Podstawa opodatkowania ryczałtem: zysk albo cała wypłata."));
    card.appendChild(configNumberField("accounts." + key + ".min_withdrawal_age", "Wiek zmiany reżimu", rules.min_withdrawal_age, "Wiek, od którego wypłaty nie są już objęte reżimem „przed wiekiem” (np. 60 dla IKE, 65 dla IKZE)."));
    card.appendChild(configSelect("accounts." + key + ".early_tax_model", "Model przed wiekiem", rules.early_tax_model, TAX_MODEL_LABELS, "Opodatkowanie wypłat przed osiągnięciem docelowego wieku (np. skala PIT dla IKZE)."));
    card.appendChild(configPercentField("accounts." + key + ".early_tax_rate", "Stawka przed wiekiem", rules.early_tax_rate, "Stawka podatku obowiązująca przed osiągnięciem docelowego wieku."));
    card.appendChild(configPercentField("accounts." + key + ".asset_tax_rate", "Podatek od wartości aktywów", rules.asset_tax_rate, "Roczny podatek od wartości aktywów ponad próg zwolnienia (OKI: 0,85%)."));
    card.appendChild(configNumberField("accounts." + key + ".asset_exemption", "Próg zwolnienia aktywów", rules.asset_exemption, "Kwota, poniżej której aktywa nie podlegają corocznemu podatkowi od wartości."));

    return card;
}

function configSelect(path, label, value, options, hint) {
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    wrap.innerHTML = `<label>${label}${hint ? tipHtml(hint) : ""}</label>`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:0.25rem;";
    const select = document.createElement("select");
    select.style.flex = "1";
    for (const [val, text] of Object.entries(options)) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = text;
        if (val === value) opt.selected = true;
        select.appendChild(opt);
    }

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "field-reset";
    resetBtn.title = "Przywróć wartość domyślną";
    resetBtn.innerHTML = "&#x21ba;";

    function updateIndicator() {
        resetBtn.hidden = select.value === getConfigDefault(path);
    }

    select.addEventListener("change", () => {
        setConfigPath(path, select.value);
        updateStageHints(document.getElementById("stages-container"));
        updateIndicator();
    });

    resetBtn.addEventListener("click", () => {
        const def = getConfigDefault(path);
        setConfigPath(path, def);
        select.value = def;
        updateIndicator();
    });

    row.appendChild(select);
    row.appendChild(resetBtn);
    wrap.appendChild(row);
    updateIndicator();
    return wrap;
}

async function resetConfig() {
    CONFIG = structuredClone(DEFAULT_CONFIG);
    _currentPresetId = null;
    _currentPresetName = "Domyślne 2026";
    renderConfigView();
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

    select.addEventListener("change", () => {
        const opt = select.selectedOptions[0];
        if (!opt) return;
        const presetId = opt.dataset.presetId;
        const presetName = opt.dataset.presetName;
        const isBuiltin = opt.dataset.isBuiltin === "true";
        if (isBuiltin) {
            applyPresetByName(presetName);
        } else if (presetId) {
            applyPresetById(parseInt(presetId));
        }
    });

    saveBtn.addEventListener("click", async () => {
        const name = prompt("Nazwa nowego presetu:");
        if (!name) return;
        try {
            const res = await fetch("/api/presets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), config: CONFIG }),
            });
            if (!res.ok) {
                const err = await res.json();
                alert(err.detail || "Błąd zapisu presetu");
                return;
            }
            const saved = await res.json();
            _currentPresetId = saved.id;
            _currentPresetName = null;
            await refreshPresets();
            refreshPresetBar();
        } catch (err) {
            console.error("Błąd zapisu presetu:", err);
        }
    });

    deleteBtn.addEventListener("click", async () => {
        if (_currentPresetId === null || !confirm("Na pewno usunąć ten preset?")) return;
        try {
            await fetch(`/api/presets/${_currentPresetId}`, { method: "DELETE" });
            _currentPresetId = null;
            _currentPresetName = "Domyślne 2026";
            await refreshPresets();
            refreshPresetBar();
        } catch (err) {
            console.error("Błąd usuwania presetu:", err);
        }
    });

    exportBtn.addEventListener("click", () => {
        const name = _currentPresetId !== null
            ? (PRESETS.find(p => p.id === _currentPresetId)?.name || "preset")
            : (_currentPresetName || "preset");
        const blob = new Blob([JSON.stringify(CONFIG, null, 2)], { type: "application/json" });
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
            _currentPresetId = saved.id;
            await refreshPresets();
            applyPresetById(saved.id);
        } catch (err) {
            alert("Nieprawidłowy plik JSON: " + err.message);
        }
        importInput.value = "";
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
        if (p.is_builtin && p.name === _currentPresetName) opt.selected = true;
        else if (_currentPresetId !== null && p.id === _currentPresetId) opt.selected = true;
        select.appendChild(opt);
    }

    // If no option is selected, mark "Domyślne 2026"
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
        if (overrides) {
            CONFIG = deepMerge(structuredClone(defaults), overrides);
        } else {
            CONFIG = backfillConfig(defaults);
        }
        _currentPresetId = null;
        _currentPresetName = name;
        applyZusWaloryzacjaDefaults();
        renderConfigView();
        updateStageHints(document.getElementById("stages-container"));
        scheduleConfigSave();
        refreshPresetBar();
    } catch (err) {
        console.error("Błąd wczytywania presetu:", err);
    }
}

const BUILTIN_PRESETS_CLIENT = {
    "Domyślne 2026": {},
    "Konserwatywne": {
        zus: { waloryzacja_skladek: 0.005, waloryzacja_swiadczenia: 0.005 },
    },
    "Realne": {
        zus: { waloryzacja_skladek: 0.015, waloryzacja_swiadczenia: 0.015 },
    },
    "Optymistyczne": {
        zus: { waloryzacja_skladek: 0.025, waloryzacja_swiadczenia: 0.025 },
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
        CONFIG = backfillConfig(data.config);
        _currentPresetId = presetId;
        _currentPresetName = null;
        applyZusWaloryzacjaDefaults();
        renderConfigView();
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
    const grossInput = document.getElementById("monthlyGross");
    if (grossInput && inputData.monthly_gross) grossInput.value = inputData.monthly_gross;
    container.innerHTML = "";
    (inputData.stages || []).forEach((stage) => {
        migrateLegacyAccounts(stage);
        container.appendChild(createStageBlock(stage));
    });
    if (inputData.config) renderConfigView();
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
        (DEFAULTS.stages || []).forEach((s) => container.appendChild(createStageBlock(s)));
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
        const toggle = document.createElement("label");
        toggle.className = "col-toggle" + (hidden.has(col) ? " off" : "");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !hidden.has(col);
        cb.dataset.col = col;
        cb.addEventListener("change", () => {
            if (cb.checked) hidden.delete(col);
            else hidden.add(col);
            localStorage.setItem(COLUMN_TOGGLES_KEY, JSON.stringify([...hidden]));
            toggle.classList.toggle("off", !cb.checked);
            applyColVisibility();
        });
        toggle.appendChild(cb);
        toggle.appendChild(document.createTextNode(" " + label));
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

    /* line */
    const points = years.map((yr) => `${x(yr.age).toFixed(1)},${y(yr.total_wealth).toFixed(1)}`);
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
        return `<span class="detail-pill${match ? " " + pillClass : ""}">${escapeHtml(k.toUpperCase())}: ${fmt(v)}</span>`;
    }).join("");

    container.innerHTML = `
        <div class="detail-header">
            <strong>${yr.age} r.ż.</strong> — ${escapeHtml(yr.stage_name || "")}
        </div>
        <div class="detail-grid">
            <div class="detail-item"><span class="detail-label">Majątek łącznie</span><span class="detail-value">${fmt(yr.total_wealth)}</span></div>
            <div class="detail-item"><span class="detail-label">Wypłata mies.</span><span class="detail-value green">${fmt(yr.monthly_withdrawal)}</span></div>
            <div class="detail-item"><span class="detail-label">Wypłata roczna</span><span class="detail-value green">${fmt(yr.annual_withdrawal)}</span></div>
            <div class="detail-item"><span class="detail-label">Podatek</span><span class="detail-value ${yr.tax_paid < 0 ? 'green' : 'red'}">${fmt(yr.tax_paid)}</span></div>
        </div>
        ${balHtml ? `<div class="detail-balances">${balHtml}</div>` : ""}
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

    /* line */
    const points = withWithdrawals.map((yr) => `${x(yr.age).toFixed(1)},${y(yr.monthly_withdrawal).toFixed(1)}`);
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
        return `<span class="detail-pill${isActive ? " pill-active" : ""}">${escapeHtml(k.toUpperCase())}: ${fmt(v)}</span>`;
    }).join("");

    container.innerHTML = `
        <div class="detail-header">
            <strong>${yr.age} r.ż.</strong> — ${escapeHtml(yr.stage_name || "")}
        </div>
        <div class="detail-grid">
            <div class="detail-item"><span class="detail-label">Majątek łącznie</span><span class="detail-value">${fmt(yr.total_wealth)}</span></div>
            <div class="detail-item"><span class="detail-label">Wypłata mies.</span><span class="detail-value green">${fmt(yr.monthly_withdrawal)}</span></div>
            <div class="detail-item"><span class="detail-label">Wypłata roczna</span><span class="detail-value green">${fmt(yr.annual_withdrawal)}</span></div>
            <div class="detail-item"><span class="detail-label">Podatek</span><span class="detail-value ${yr.tax_paid < 0 ? 'green' : 'red'}">${fmt(yr.tax_paid)}</span></div>
        </div>
        ${balHtml ? `<div class="detail-balances">${balHtml}</div>` : ""}
    `;
    container.classList.remove("hidden");
}
