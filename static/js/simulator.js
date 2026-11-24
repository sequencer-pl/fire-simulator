// simulator.js — Main entry, config, results, save/load

const TAX_MODEL_LABELS = { none: "Brak", flat: "Ryczałt", scale: "Skala PIT", assets: "Od wartości aktywów" };
const TAX_BASIS_LABELS = { gains: "od zysku", full: "od całości" };
let CONFIG = null;
let USER_CONFIG = null;
let DEFAULT_CONFIG = null;
let PRESETS = [];
let SERVER_PRESETS = {};
let _currentPresetId = null;
let _currentPresetName = "Domyślny 2026";
let CONFIG_BASELINE = null;
let CONFIG_BASELINE_NAME = "Domyślny 2026";
let CONFIG_IS_CUSTOM = false;
let CONFIG_OVERRIDE_PATHS = new Set();
const CONFIG_KEY = "fire.config";
const LEGACY_CONFIG_KEY = "fire.config.anonymous";
const LOCAL_PRESETS_KEY = "fire.presets";

let lastInput = null;
let lastResult = null;
// Polityka wypłat przeniesiona z Asystenta (bez UI w edytorze).
let loadedWithdrawalPolicy = "defer_tier";
// Horyzont z wczytanego planu (np. draftu Asystenta). Zachowujemy go, bo etap
// ZUS może wystawać do 100 r.ż., a portfel ma się kończyć na plan_end.
let loadedMaxAge = null;
// Skalary z draftu/importu, których nie ma w edytorze etapów.
let loadedStartYear = null;
let loadedInflation = null;
let loadedMonthlyGross = null;

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
            } else if (input.type === "text") {
                val = input.value.trim();
            } else if (input.tagName === "SELECT") {
                const parsed = parseFloat(input.value);
                val = Number.isNaN(parsed) ? input.value : parsed;
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
            withdrawal_target_gross_monthly: parseFloat(block.dataset.withdrawalTargetGrossMonthly) || 0,
            part_time_net_monthly: parseFloat(block.dataset.partTimeNetMonthly) || 0,
            part_time_gross_monthly: parseFloat(block.dataset.partTimeGrossMonthly) || 0,
            part_time_zus_base: parseFloat(block.dataset.partTimeZusBase) || 0,
        });
    });

    const obligations = gatherObligations();
    const adjustedStages = applyObligationStages(stages, obligations);
    return {
        stages: adjustedStages,
        obligations,
        max_age: derivedMaxAgeInfo(adjustedStages).maxAge,
        gender: currentGender(),
        monthly_gross: loadedMonthlyGross ?? 0,
        start_year: loadedStartYear,
        inflation: loadedInflation,
        withdrawal_policy: loadedWithdrawalPolicy,
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

function clampAge(value) {
    return Math.min(120, Math.max(0, Math.round(value)));
}

function latestByEndAge(stages) {
    if (!stages.length) return null;
    return stages.reduce((best, stage) => (
        Number(stage.end_age) > Number(best.end_age) ? stage : best
    ));
}

function derivedMaxAgeInfo(stages) {
    const all = Array.isArray(stages) ? stages : [];
    const realization = all.filter((stage) => stage.stage_type === "realizacja");
    const portfolio = realization.filter((stage) =>
        Object.keys(stage.accounts || {}).some((account) => baseAccountKey(account) !== "zus")
    );
    const portfolioStage = latestByEndAge(portfolio);
    if (portfolioStage) {
        return {
            maxAge: clampAge(Number(portfolioStage.end_age) - 1),
            stageName: portfolioStage.name || "Realizacja",
        };
    }
    if (loadedMaxAge != null && Number.isFinite(Number(loadedMaxAge))) {
        return { maxAge: clampAge(Number(loadedMaxAge)), stageName: null };
    }
    const lastStage = latestByEndAge(all);
    if (lastStage) {
        return {
            maxAge: clampAge(Number(lastStage.end_age) - 1),
            stageName: lastStage.name || "Etap",
        };
    }
    return { maxAge: 100, stageName: null };
}

function updateHorizonHint() {
    const hint = document.getElementById("simHorizonHint");
    if (!hint) return;
    const blocks = document.querySelectorAll("#stages-container .stage-block");
    if (!blocks.length) {
        hint.hidden = true;
        hint.textContent = "";
        return;
    }
    const { maxAge, stageName } = derivedMaxAgeInfo(gatherFormData().stages);
    hint.hidden = false;
    hint.textContent = stageName
        ? `Horyzont planu: do ${maxAge} r.ż. — wynika z etapu „${stageName}”.`
        : `Horyzont planu: do ${maxAge} r.ż.`;
}

function pensionAge(config) {
    if (!config || !config.zus) return null;
    const z = config.zus;
    if (currentGender() === "k") {
        return z.wiek_emerytalny_k ?? z.wiek_emerytalny ?? 60;
    }
    return z.wiek_emerytalny_m ?? z.wiek_emerytalny ?? 65;
}

let simResultsRoot = null;

function renderResults(data) {
    const body = document.getElementById("simResultBody");
    if (!body) return;
    if (!simResultsRoot || !body.contains(simResultsRoot)) {
        simResultsRoot = window.ResultsView.mount(body, { scenarios: false });
    }
    const root = simResultsRoot;
    // Wykresy liczą szerokość z żywego DOM. Najpierw pokazujemy wyniki,
    // dopiero potem renderujemy sekcje — inaczej SVG dostaje fallback 640 px
    // i po pokazaniu sekcji jest rozciągany do rzeczywistej szerokości.
    showResults();
    const totalContrib = computeTotalUserContributions(lastInput);
    const initCap = computeInitialCapital(lastInput);
    const summary = data.summary || {
        initial_capital: initCap,
        total_user_contributions: totalContrib,
        peak_wealth: data.peak_wealth,
        final_wealth: data.final_wealth,
        final_wealth_net: data.final_wealth_net ?? data.final_wealth,
        total_withdrawn: data.total_withdrawn,
        total_tax: data.total_tax,
        total_tax_refund: data.total_tax_refund,
    };
    const planView = { result: data, summary, projection: data.projection || null };

    window.ResultsSummary.render(root, {
        hero: simulatorHero(data, summary),
        warnings: data.warnings || [],
        metrics: window.ResultsSummary.metricsFor(planView),
        facts: window.ResultsSummary.factsForSimulator(
            lastInput,
            data.projection || null,
            summary
        ),
    });

    renderPlanTime(root, data);
    renderSharedCharts(root, data);
    renderSimulatorTable(root, data);

    scrollToResults();
}

function simulatorHero(data, summary) {
    const fmt = window.ResultsModel.fmtMoney;
    const projection = data.projection || {};
    const payoutPhases = (projection.phase_metrics || []).filter(
        (phase) => phase.cashflow === "payout"
    );
    const mainPayouts = payoutPhases.filter((phase) => phase.key !== "zus_only");
    // Start liczymy z faktycznych wypłat, nie z pierwszego roku symulacji.
    const payoutStart = payoutPhases.length
        ? Math.min(...payoutPhases.map((phase) => phase.start_age))
        : null;
    const start = payoutStart ?? summary?.start_age;
    const phaseEnd = payoutPhases.length
        ? Math.max(...payoutPhases.map((phase) => phase.end_age))
        : null;
    const end = summary?.end_age ?? phaseEnd;
    // Hero pokazuje lifestyle: budżet netto łącznie z ZUS, częścią etatu i kredytem.
    const monthly = projection.mean_monthly
        || projection.min_monthly
        || summary?.avg_income
        || summary?.avg_monthly
        || 0;
    const lifestyle = projection.mean_lifestyle_monthly
        || summary?.avg_monthly
        || null;
    const finalNet = summary?.final_wealth_net ?? data.final_wealth_net ?? 0;
    const zusOnlyNote = payoutPhases.length && !mainPayouts.length
        ? " Wypłaty pochodzą wyłącznie z ZUS."
        : "";

    if (monthly > 0 && start != null && end != null) {
        const lifestyleNote = lifestyle != null && lifestyle < monthly - 1
            ? ` Po zobowiązaniach zostaje średnio <strong>${fmt(lifestyle)}/mies.</strong>`
            : "";
        return {
            kicker: "TWÓJ PLAN",
            headline: `Plan wypłaca średnio ${fmt(monthly)}/mies. netto`,
            desc: `Od ${start}. do ${end}. roku życia. Na koniec zostaje <strong>${fmt(finalNet)}</strong> netto.${lifestyleNote}${zusOnlyNote}`,
        };
    }
    return {
        kicker: "TWÓJ PLAN",
        warn: true,
        headline: `Plan kończy się w wieku ${end ?? "—"}`,
        desc: `Majątek końcowy netto: <strong>${fmt(finalNet)}</strong>.${zusOnlyNote}`,
    };
}

function renderSimulatorTable(root, data) {
    const box = root?.querySelector("[data-results-year-table]");
    if (!box || !window.ResultsTable) return;
    window.ResultsTable.render(box, {
        result: data,
        input: lastInput,
        density: 5,
        embedded: true,
        tableId: "resultsTable",
    });
}

function renderPlanTime(root, data) {
    const box = root?.querySelector("[data-results-plan-time]");
    if (!box) return;
    if (!data.projection || !window.ResultsPlanTime) {
        box.innerHTML = "";
        return;
    }
    window.ResultsPlanTime.render(box, {
        input: lastInput,
        projection: data.projection,
        summary: data.summary,
        result: data,
    });
}

function renderSharedCharts(root, data) {
    const section = root?.querySelector('[data-results-section="charts"]');
    const projection = data.projection;
    if (!projection?.chart?.ages?.length || !window.ResultsCharts) {
        section?.classList.add("hidden");
        return false;
    }
    window.ResultsCharts.render({
        input: lastInput,
        projection,
        summary: data.summary || {},
    });
    section?.classList.remove("hidden");
    return true;
}

function showResults() {
    document.getElementById("simConfigSection").classList.add("collapsed");
    document.getElementById("results").style.display = "block";
    document.querySelector(".form-actions")?.classList.add("config-collapsed");
}

function scrollToResults() {
    document.getElementById("results").scrollIntoView({ behavior: "smooth" });
}

function switchToConfig() {
    document.getElementById("simConfigSection").classList.remove("collapsed");
    document.getElementById("results").style.display = "none";
    document.querySelector(".form-actions")?.classList.remove("config-collapsed");
    document.getElementById("simConfigSection").scrollIntoView({ behavior: "smooth" });
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("stages-container");
    const params = new URLSearchParams(location.search);

    if (params.get("view") === "config") switchMode("config");
    initConfig();
    initSimulationIO();
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
    const obligationsPanel = document.getElementById("simObligationsPanel");
    if (obligationsPanel) initNumControls(obligationsPanel);
    document.getElementById("addObligationBtn")?.addEventListener("click", () => {
        addObligationRow({});
    });

    const draftApplied = applyWizardDraftIfPresent();
    updateStageButtons(container);
    updateStageHints(container);
    refreshRealizationToggles(container);
    updateHorizonHint();
    container.addEventListener("input", updateHorizonHint);
    container.addEventListener("change", updateHorizonHint);
    if (draftApplied) {
        // Draft zostaje, żeby F5/back-forward nie gubiły planu. Czyścimy go
        // dopiero przy pierwszej edycji etapów albo po eksporcie.
        container.addEventListener("input", () => clearWizardDraft(), { once: true });
        container.addEventListener("click", (event) => {
            if (event.target.closest?.(".stage-block")) clearWizardDraft();
        }, { once: true });
        // „Dostosuj w symulatorze” ma otwierać edytor etapów, a nie wynik.
        // Użytkownik klika „Symuluj”, kiedy jest gotowy.
    }

    document.querySelectorAll(".topnav a[data-nav], .tabbar a[data-nav]").forEach((a) => {
        a.addEventListener("click", (e) => {
            const section = document.body.dataset.section;
            const nav = a.dataset.nav;
            const switchable = nav === "edytor" || nav === "konfiguracja";
            if ((section === "edytor" || section === "konfiguracja") && switchable) {
                window.setNavSection(nav);
                e.preventDefault();
            }
        });
    });

    updateEmptyState();
    new MutationObserver(() => {
        updateEmptyState();
        updateHorizonHint();
    }).observe(container, { childList: true });
});

function updateEmptyState() {
    const el = document.getElementById("emptyState");
    if (!el) return;
    const container = document.getElementById("stages-container");
    const hasStages = container && container.querySelector(".stage-block");
    el.classList.toggle("hidden", hasStages);
    document.getElementById("stagesHead")?.classList.toggle("hidden", !hasStages);
}

const WIZARD_DRAFT_KEY = "fire.wizardDraft";

function applyWizardDraftIfPresent() {
    const container = document.getElementById("stages-container");
    const raw = localStorage.getItem(WIZARD_DRAFT_KEY);
    if (!raw || !container) return false;
    try {
        const draft = JSON.parse(raw);
        // Wersję draftu ustala Asystent (wizard.js); Symulator czyta zawsze
        // aktualny kształt pola `input` i nie duplikuje tej stałej.
        const input = draft?.input && Array.isArray(draft.input.stages)
            ? draft.input
            : draft;
        if (!input || !Array.isArray(input.stages) || !input.stages.length) return false;
        loadedWithdrawalPolicy = input.withdrawal_policy
            || draft.withdrawal_policy
            || "defer_tier";
        populateStages(input);
        showWizardDraftBanner();
        return true;
    } catch (err) {
        localStorage.removeItem(WIZARD_DRAFT_KEY);
        return false;
    }
}

function showWizardDraftBanner() {
    const bar = document.getElementById("wizardDraftBar");
    if (bar) bar.classList.remove("hidden");
    const restoreHref = "/wizard?restore=1";
    const draftBack = document.getElementById("wizardDraftBackLink");
    if (draftBack) draftBack.href = restoreHref;
    const back = document.getElementById("backToWizardBtn");
    if (back) {
        back.hidden = false;
        back.href = restoreHref;
        back.title = "Wróć do Asystenta, aby zmienić dane";
        back.setAttribute("aria-label", "Wróć do Asystenta");
    }
}

function clearWizardDraft() {
    localStorage.removeItem(WIZARD_DRAFT_KEY);
    const back = document.getElementById("backToWizardBtn");
    if (back) back.hidden = true;
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
        const defaultsRes = await fetch("/api/config");
        DEFAULT_CONFIG = await defaultsRes.json();
        try {
            const presetsRes = await fetch("/api/presets");
            SERVER_PRESETS = presetsRes.ok ? await presetsRes.json() : {};
        } catch {
            SERVER_PRESETS = {};
        }
        if (!Object.keys(SERVER_PRESETS).length) {
            SERVER_PRESETS = { "Domyślny 2026": structuredClone(DEFAULT_CONFIG) };
        }
        const localData = loadLocalConfig();

        if (localData) {
            USER_CONFIG = backfillConfig(localData.config);
            CONFIG_BASELINE = backfillConfig(localData.baseline || localData.config);
            CONFIG_BASELINE_NAME = normalizePresetName(localData.preset_name);
            _currentPresetId = localData.preset_id ?? null;
            _currentPresetName = CONFIG_BASELINE_NAME === "Własna konfiguracja" ? null : CONFIG_BASELINE_NAME;
            CONFIG_OVERRIDE_PATHS = new Set(localData.overrides || []);
            CONFIG_IS_CUSTOM = CONFIG_OVERRIDE_PATHS.size > 0
                || CONFIG_BASELINE_NAME === "Własna konfiguracja";
        } else {
            USER_CONFIG = structuredClone(DEFAULT_CONFIG);
            CONFIG_BASELINE = structuredClone(DEFAULT_CONFIG);
            CONFIG_BASELINE_NAME = "Domyślny 2026";
            _currentPresetId = null;
            _currentPresetName = "Domyślny 2026";
            CONFIG_OVERRIDE_PATHS = new Set();
            CONFIG_IS_CUSTOM = false;
        }
        PRESETS = loadPresetList();
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
function normalizePresetName(name) {
    if (!name) return "Własna konfiguracja";
    if (name === "Domyślne 2026") return "Domyślny 2026";
    if (["Realne", "Konserwatywne", "Optymistyczne", "2027 (projekt UD458)"].includes(name)) {
        return "Własna konfiguracja";
    }
    return name;
}

function backfillConfig(config) {
    if (!DEFAULT_CONFIG) return config;
    const year = Number(config?.year);
    const presetName = Number.isFinite(year) ? `Domyślny ${year}` : "";
    const baseDefaults = (presetName && SERVER_PRESETS[presetName]) || DEFAULT_CONFIG;
    const out = {};
    for (const [section, defaults] of Object.entries(baseDefaults)) {
        const loaded = config[section];
        if (loaded && typeof defaults === "object" && defaults !== null && !Array.isArray(defaults)) {
            out[section] = { ...defaults, ...loaded };
        } else {
            out[section] = loaded !== undefined ? loaded : defaults;
        }
    }
    for (const profile of Object.values(out.risk_profiles || {})) {
        if (profile && profile.max_market == null && profile.max_taxable_market != null) {
            profile.max_market = profile.max_taxable_market;
            delete profile.max_taxable_market;
        }
    }
    return out;
}

function setConfigPath(path, value) {
    const parts = path.split(".");
    let obj = USER_CONFIG;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
}

let _configSaveTimeout = null;
let _configSaveDirty = false;

function configSavePayload() {
    return {
        config: USER_CONFIG,
        baseline: CONFIG_BASELINE || USER_CONFIG,
        preset_id: _currentPresetId,
        preset_name: CONFIG_BASELINE_NAME,
        overrides: [...CONFIG_OVERRIDE_PATHS],
    };
}

function loadLocalConfig() {
    try {
        const raw = localStorage.getItem(CONFIG_KEY)
            || localStorage.getItem(LEGACY_CONFIG_KEY);
        if (!raw) return null;
        const payload = JSON.parse(raw);
        if (!payload || typeof payload !== "object" || !payload.config) return null;
        if (!localStorage.getItem(CONFIG_KEY)) {
            localStorage.setItem(CONFIG_KEY, raw);
            localStorage.removeItem(LEGACY_CONFIG_KEY);
        }
        return payload;
    } catch {
        return null;
    }
}

function persistConfigLocal() {
    try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(configSavePayload()));
        return true;
    } catch (err) {
        console.error("Błąd lokalnego zapisu konfiguracji:", err);
        return false;
    }
}

function saveConfigNow() {
    clearTimeout(_configSaveTimeout);
    _configSaveTimeout = null;
    if (!_configSaveDirty) return;
    _configSaveDirty = false;
    _configSaveDirty = !persistConfigLocal();
}

function scheduleConfigSave() {
    _configSaveDirty = true;
    _configSaveDirty = !persistConfigLocal();
}

function flushConfigSave() {
    if (_configSaveDirty) saveConfigNow({ keepalive: true });
}

window.addEventListener("pagehide", flushConfigSave);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushConfigSave();
});

function renderConfigView() {
    const root = document.getElementById("config-content");
    root.innerHTML = "";

    const skalaBadge = (() => {
        const p1 = USER_CONFIG.prog;
        const p2 = USER_CONFIG.prog2;
        const rm = USER_CONFIG.rate_middle;
        if (p1 === 130000 && p2 === 150000 && rm === 0.24) return "Skala podatkowa — 2027";
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
        configNullablePercentField("prog_indexation", "Indeksacja progów PIT", USER_CONFIG.prog_indexation, "Roczna nominalna waloryzacja kwoty wolnej, progów, KUP i progu daniny. Puste = równa inflacji (progi stałe realnie). 0% = progi zamrożone nominalnie, czyli realnie maleją co roku o inflację.", { zeroIsNull: false }),
    ]));

    root.appendChild(configSection("Limity rocznych wpłat", [
        configNumberField("limits.ike_annual", "IKE", USER_CONFIG.limits.ike_annual, "Limit roczny wpłat na IKE (2026 r.: 28 260 zł)."),
        configNumberField("limits.ikze_annual", "IKZE — etat", USER_CONFIG.limits.ikze_annual, "Limit roczny IKZE dla zatrudnionych (2026 r.: 11 304 zł)."),
        configNumberField("limits.ikze_annual_self_employed", "IKZE — przedsiębiorca", USER_CONFIG.limits.ikze_annual_self_employed, "Limit roczny IKZE dla przedsiębiorców (2026 r.: 16 956 zł)."),
        configNumberField("limits.oipe_annual", "OIPE", USER_CONFIG.limits.oipe_annual, "Limit roczny wpłat na OIPE (2026 r.: 28 260 zł)."),
        configNumberField("limits.ppe_additional_annual", "PPE — składka dodatkowa", USER_CONFIG.limits.ppe_additional_annual, "Limit roczny składki dodatkowej PPE (2026 r.: 42 390 zł)."),
    ]));

    const riskFields = [];
    const riskLabels = {
        spokojny: "Spokojny",
        zrownowazony: "Rynkowy",
        dynamiczny: "Dynamiczny",
    };
    for (const [key, label] of Object.entries(riskLabels)) {
        const profile = USER_CONFIG.risk_profiles?.[key] || {};
        riskFields.push(
            configPercentField(`risk_profiles.${key}.max_crypto`, `${label} — max krypto`, profile.max_crypto ?? 0, "Maksymalny udział nowych wpłat w krypto dla tego profilu."),
            configPercentField(`risk_profiles.${key}.max_market`, `${label} — max rynkowe`, profile.max_market ?? 0, "Maksymalny udział nowych wpłat w aktywach rynkowych — łącznie w IKE/IKZE/OIPE i kontach taxable."),
            configPercentField(`risk_profiles.${key}.max_single_taxable`, `${label} — max pojedyncze`, profile.max_single_taxable ?? 0, "Maksymalny udział nowych wpłat w jednym rynkowym koncie taxable."),
            configPercentField(`risk_profiles.${key}.min_safe`, `${label} — min safe`, profile.min_safe ?? 0, "Minimalny udział nowych wpłat w aktywach bezpiecznych — łącznie z bezpiecznymi wariantami IKE/IKZE/OIPE."),
        );
    }
    root.appendChild(configSection("Profile ryzyka — limity nowych wpłat", riskFields));

    const vehicleFields = [
        configPercentField("wrapper_vehicles.broker.default_roi", "Maklerskie — ROI", USER_CONFIG.wrapper_vehicles?.broker?.default_roi ?? 0.05, "Domyślne realne ROI dla samodzielnego inwestowania w akcje/ETF wewnątrz IKE/IKZE/OIPE."),
        configPercentField("wrapper_vehicles.fund.default_roi", "Funduszowe — ROI", USER_CONFIG.wrapper_vehicles?.fund?.default_roi ?? 0.045, "Domyślne realne ROI dla funduszy i portfeli zarządzanych. OIPE jest dziś funduszowe (Finax), z opłatą ok. 0,9% rocznie."),
        configPercentField("wrapper_vehicles.savings.default_roi", "Oszczędnościowe — ROI", USER_CONFIG.wrapper_vehicles?.savings?.default_roi ?? 0.018, "Domyślne realne ROI dla lokat, obligacji i funduszy obligacji wewnątrz wrappera."),
        configWrapperOptionsField("ike", "IKE — dostępne rodzaje", "Zaznacz rodzaje inwestycji, które chcesz dopuścić w IKE."),
        configWrapperOptionsField("ikze", "IKZE — dostępne rodzaje", "Zaznacz rodzaje inwestycji, które chcesz dopuścić w IKZE."),
        configWrapperOptionsField("oipe", "OIPE — dostępne rodzaje", "Domyślnie tylko funduszowe (Finax). W przyszłości możesz tu włączyć maklerskie lub oszczędnościowe."),
    ];
    root.appendChild(configSection("Rodzaje inwestycji w IKE/IKZE/OIPE", vehicleFields));

    root.appendChild(configSection("PPK — parametry", [
        configPercentField("ppk.employee_pct", "Wpłata pracownika", USER_CONFIG.ppk.employee_pct, "Domyślną stawkę pracownika ustawia Konfiguracja; ustawowe minima i limity zależą od przepisów."),
        configPercentField("ppk.employer_pct", "Wpłata pracodawcy", USER_CONFIG.ppk.employer_pct, "Ustawowo min. 1,5%, max 4% wynagrodzenia."),
        configPercentField("ppk.max_total_pct", "Limit sumy wpłat", USER_CONFIG.ppk.max_total_pct, "Ustawowy limit łącznej sumy wpłat pracownika i pracodawcy (8%)."),
        configNumberField("ppk.state_welcoming", "Dopłata powitalna", USER_CONFIG.ppk.state_welcoming, "Jednorazowa dopłata państwa w pierwszym roku akumulacji (250 zł)."),
        configNumberField("ppk.state_annual", "Dopłata roczna", USER_CONFIG.ppk.state_annual, "Coroczna dopłata państwa przy wpłacie min. 0,5% (240 zł)."),
    ]));

    root.appendChild(configSection("PPE — parametry", [
        configPercentField("ppe.employer_pct", "Wpłata pracodawcy", USER_CONFIG.ppe.employer_pct, "Realistyczna składka podstawowa pracodawcy (domyślnie 3,5%; max 7%)."),
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

    root.appendChild(configSection("Długowieczność", [
        configNumberField("longevity.growth_months_per_year", "Wydłużenie życia (mies./rok)", USER_CONFIG.longevity.growth_months_per_year, "O ile miesięcy rocznie wydłuża się prognozowane życie. Wpływa na wysokość emerytury ZUS (dłuższa tabela ŚDTŻ) i domyślny horyzont w Asystencie."),
    ]));

    const accountsSection = document.createElement("details");
    accountsSection.className = "config-section";
    accountsSection.innerHTML = `<summary class="config-section-summary"><span class="config-section-title">Konta — reguły wypłat i podatków</span><span class="config-section-modified" hidden></span><span class="config-section-chevron" aria-hidden="true">${iconSvg("chevron")}</span></summary>`;
    const grid = document.createElement("div");
    grid.className = "config-accounts config-section-body";
    for (const [key, rules] of Object.entries(USER_CONFIG.accounts)) {
        grid.appendChild(renderAccountRulesCard(key, rules));
    }
    accountsSection.appendChild(grid);
    root.appendChild(accountsSection);
    root.querySelectorAll("details.config-section").forEach((section) => {
        section.addEventListener("toggle", updateConfigExpandButton);
    });
    updateConfigExpandButton();
    refreshConfigSectionBadges();
}

function configWrapperOptionsField(wrapper, label, hint) {
    const path = `wrapper_vehicle_options.${wrapper}`;
    const all = Object.entries(USER_CONFIG.wrapper_vehicles || {});
    const current = USER_CONFIG.wrapper_vehicle_options?.[wrapper] || [];
    const wrap = document.createElement("div");
    wrap.className = "field config-field";
    wrap.innerHTML = `
        <div class="config-field-heading">
            <label class="config-field-label">${tipLabelHtml(label, hint)}</label>
            <span class="config-override-indicator" role="img" hidden></span>
        </div>
        <div class="config-field-control">
            <div class="config-inline-editor config-checkbox-row">
                ${all.map(([key, vehicle]) => `
                    <label class="config-checkbox">
                        <input type="checkbox" value="${key}" ${current.includes(key) ? "checked" : ""}>
                        <span>${escapeHtml(vehicle.label || key)}</span>
                    </label>`).join("")}
            </div>
            <button type="button" class="btn btn-ghost btn-icon config-restore-btn">${iconSvg("restore")}</button>
        </div>`;
    const inputs = [...wrap.querySelectorAll("input[type=checkbox]")];
    const indicator = wrap.querySelector(".config-override-indicator");
    const restoreBtn = wrap.querySelector(".config-restore-btn");
    restoreBtn.title = "Przywróć domyślne";
    restoreBtn.setAttribute("aria-label", "Przywróć domyślne");
    const baseline = () => configPathValue(CONFIG_BASELINE || DEFAULT_CONFIG, path) || [];
    function updateState() {
        const value = USER_CONFIG.wrapper_vehicle_options?.[wrapper] || [];
        const base = baseline();
        const changed = JSON.stringify([...value].sort()) !== JSON.stringify([...base].sort());
        if (changed) CONFIG_OVERRIDE_PATHS.add(path);
        else CONFIG_OVERRIDE_PATHS.delete(path);
        indicator.hidden = !changed;
        indicator.title = changed ? "Wartość różni się od presetu" : "";
        wrap.classList.toggle("has-override", changed);
        restoreBtn.disabled = !changed;
        syncConfigCustomState();
        refreshConfigSectionBadges();
    }
    inputs.forEach((input) => {
        input.addEventListener("change", () => {
            let selected = inputs.filter((item) => item.checked).map((item) => item.value);
            if (!selected.length) {
                input.checked = true;
                selected = [input.value];
            }
            setConfigPath(path, selected);
            updateState();
            scheduleConfigSave();
        });
    });
    restoreBtn.addEventListener("click", () => {
        setConfigPath(path, [...baseline()]);
        inputs.forEach((input) => {
            input.checked = baseline().includes(input.value);
        });
        updateState();
        scheduleConfigSave();
    });
    updateState();
    wrap._updateConfigState = updateState;
    return wrap;
}

function configSection(title, fields) {
    const section = document.createElement("details");
    section.className = "config-section";
    section.innerHTML = `<summary class="config-section-summary"><span class="config-section-title">${escapeHtml(title)}</span><span class="config-section-modified" hidden></span><span class="config-section-chevron" aria-hidden="true">${iconSvg("chevron")}</span></summary>`;
    const grid = document.createElement("div");
    grid.className = "config-fields config-section-body";
    fields.forEach((f) => grid.appendChild(f));
    section.appendChild(grid);
    return section;
}

function setModifiedBadge(badge, count) {
    if (!badge) return;
    badge.hidden = count === 0;
    badge.textContent = count > 0 ? String(count) : "";
    const label = count === 1 ? "1 zmienione pole" : `${count} zmienionych pól`;
    badge.title = count > 0 ? label : "";
    badge.setAttribute("aria-label", count > 0 ? label : "");
}

function refreshConfigSectionBadges() {
    document.querySelectorAll("#config-content details.config-section").forEach((section) => {
        const count = section.querySelectorAll(".config-field.has-override").length;
        setModifiedBadge(section.querySelector("summary .config-section-modified"), count);
        section.classList.toggle("has-override", count > 0);
    });
    document.querySelectorAll("#config-content .account-rules-card").forEach((card) => {
        const count = card.querySelectorAll(".config-field.has-override").length;
        setModifiedBadge(card.querySelector("summary .account-rules-modified"), count);
        card.classList.toggle("has-override", count > 0);
    });
}

function updateConfigExpandButton() {
    const btn = document.getElementById("configExpandBtn");
    if (!btn) return;
    const sections = [...document.querySelectorAll("#config-content details.config-section")];
    const allOpen = sections.length > 0 && sections.every((section) => section.open);
    btn.textContent = allOpen ? "Zwiń sekcje" : "Rozwiń sekcje";
    btn.setAttribute("aria-pressed", String(allOpen));
}

function toggleConfigSections() {
    const sections = [...document.querySelectorAll("#config-content details.config-section")];
    const allOpen = sections.length > 0 && sections.every((section) => section.open);
    sections.forEach((section) => {
        section.open = !allOpen;
    });
    updateConfigExpandButton();
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
        syncConfigCustomState();
        refreshConfigSectionBadges();
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

function configField(path, label, value, percent, hint, ticks, nullable = false, zeroIsNull = true) {
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
        const normalized = nullable && zeroIsNull && parsed === 0 ? null : parsed;
        setConfigPath(path, normalized == null ? null : percent ? normalized / 100 : normalized);
        wrap._updateConfigState();
        updateStageHints(document.getElementById("stages-container"));
        scheduleConfigSave();
    });
    input.addEventListener("change", () => saveConfigNow());
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

function configNullablePercentField(path, label, value, hint, options = {}) {
    return configField(
        path, label, value, true, hint, null, true,
        options.zeroIsNull !== false
    );
}

function renderAccountRulesCard(key, rules) {
    const info = getAccountInfo(key);
    const card = document.createElement("details");
    card.className = "account-rules-card";
    card.open = false;
    card.innerHTML = `<summary class="account-rules-summary"><span class="account-rules-icon">${ACCOUNT_ICONS[key] || ""}</span>${tipLabelHtml(ACCOUNT_LABELS[key] || key, info)}<span class="account-rules-modified" hidden></span><span class="account-rules-chevron" aria-hidden="true">${iconSvg("chevron")}</span></summary><div class="account-rules-body"></div>`;
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
    body.appendChild(configPercentField("accounts." + key + ".asset_tax_rate", "Podatek od wartości aktywów", rules.asset_tax_rate, "Stawka bazowa. Dla OKI: 0,85% w 2027, od 2028 19% stopy referencyjnej NBP (bez górnego limitu)."));
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
        scheduleConfigSave();
        saveConfigNow();
    });
    return wrap;
}

async function resetConfig() {
    if (!confirm("Przywrócić domyślne wartości konfiguracji? Bieżące zmiany zostaną utracone.")) return;
    clearTimeout(_configSaveTimeout);
    _configSaveTimeout = null;
    _configSaveDirty = false;
    USER_CONFIG = structuredClone(DEFAULT_CONFIG);
    CONFIG_BASELINE = structuredClone(DEFAULT_CONFIG);
    CONFIG_BASELINE_NAME = "Domyślny 2026";
    CONFIG_IS_CUSTOM = false;
    CONFIG_OVERRIDE_PATHS.clear();
    _currentPresetId = null;
    _currentPresetName = "Domyślny 2026";
    renderConfigView();
    initTipAnchoring();
    updateStageHints(document.getElementById("stages-container"));
    refreshPresetBar();
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(LEGACY_CONFIG_KEY);
}

// --- Presety ---

function readLocalPresets() {
    try {
        const raw = localStorage.getItem(LOCAL_PRESETS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list)
            ? list.filter((p) => p && p.id && p.name && p.config)
            : [];
    } catch {
        return [];
    }
}

function writeLocalPresets(list) {
    localStorage.setItem(LOCAL_PRESETS_KEY, JSON.stringify(list));
}

function loadPresetList() {
    const builtins = Object.keys(SERVER_PRESETS).map((name) => ({
        id: null,
        name,
        is_builtin: true,
    }));
    const local = readLocalPresets().map((p) => ({
        id: p.id,
        name: p.name,
        is_builtin: false,
    }));
    return [...builtins, ...local];
}

function configFileName(name) {
    const slug = String(name || "konfiguracja")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "konfiguracja";
    return `${slug}.config.json`;
}

function initPresetBar() {
    const select = document.getElementById("presetSelect");
    const saveBtn = document.getElementById("presetSaveBtn");
    const deleteBtn = document.getElementById("presetDeleteBtn");
    const exportBtn = document.getElementById("presetExportBtn");
    const importInput = document.getElementById("presetImportInput");
    const expandBtn = document.getElementById("configExpandBtn");
    if (expandBtn) expandBtn.addEventListener("click", toggleConfigSections);

    select.addEventListener("change", async () => {
        const opt = select.selectedOptions[0];
        if (!opt) return;
        if (opt.dataset.isCustom === "true") return;
        const presetId = opt.dataset.presetId;
        const presetName = opt.dataset.presetName;
        const isBuiltin = opt.dataset.isBuiltin === "true";
        const samePreset = !CONFIG_IS_CUSTOM && (isBuiltin
            ? presetName === CONFIG_BASELINE_NAME
            : String(presetId) === String(_currentPresetId));
        if (samePreset) return;
        if (CONFIG_OVERRIDE_PATHS.size && !confirm("Zmiana presetu zastąpi bieżące wartości i usunie ich nadpisania. Kontynuować?")) {
            refreshPresetBar();
            return;
        }
        if (isBuiltin) {
            await applyPresetByName(presetName);
        } else if (presetId) {
            await applyPresetById(presetId);
        }
    });

    saveBtn.addEventListener("click", async () => {
        const name = prompt("Nazwa nowego presetu:");
        if (!name || !name.trim()) return;
        const local = readLocalPresets();
        const saved = {
            id: "local-" + Date.now(),
            name: name.trim().slice(0, 100),
            config: structuredClone(USER_CONFIG),
        };
        local.push(saved);
        writeLocalPresets(local);
        _currentPresetId = saved.id;
        _currentPresetName = null;
        CONFIG_BASELINE = structuredClone(USER_CONFIG);
        CONFIG_BASELINE_NAME = saved.name;
        CONFIG_IS_CUSTOM = false;
        CONFIG_OVERRIDE_PATHS.clear();
        await refreshPresets();
        renderConfigView();
        initTipAnchoring();
        refreshPresetBar();
        scheduleConfigSave();
    });

    deleteBtn.addEventListener("click", async () => {
        if (_currentPresetId === null || !confirm("Na pewno usunąć ten preset? Po usunięciu zostanie wczytana konfiguracja Domyślny 2026.")) return;
        writeLocalPresets(readLocalPresets().filter(
            (p) => String(p.id) !== String(_currentPresetId)
        ));
        await refreshPresets();
        await applyPresetByName("Domyślny 2026");
    });

    exportBtn.addEventListener("click", () => {
        const name = _currentPresetId !== null
            ? (PRESETS.find((p) => String(p.id) === String(_currentPresetId))?.name || "preset")
            : (CONFIG_BASELINE_NAME || "preset");
        const payload = {
            schema: "fire-config/v1",
            name,
            exported_at: new Date().toISOString(),
            config: USER_CONFIG,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = configFileName(name);
        a.click();
        URL.revokeObjectURL(a.href);
    });

    importInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (parsed?.schema === "fire-simulation/v1" || parsed?.input?.stages) {
                throw new Error("To plik symulacji (.sim.json) — wczytaj go w Porównywarce.");
            }
            if (parsed?.schema !== "fire-config/v1"
                || !parsed.config
                || typeof parsed.config !== "object"
                || Array.isArray(parsed.config)) {
                throw new Error("Oczekiwano pliku .config.json (schema fire-config/v1).");
            }
            const config = parsed.config;
            const fallback = file.name.replace(/\.config\.json$|\.json$/i, "") || "Konfiguracja z pliku";
            const name = prompt("Nazwa dla zaimportowanego presetu:", parsed?.name || fallback);
            if (!name || !name.trim()) return;
            if (CONFIG_OVERRIDE_PATHS.size && !confirm("Importowany preset zastąpi bieżące wartości i usunie ich nadpisania. Kontynuować?")) return;
            const local = readLocalPresets();
            const saved = {
                id: "local-" + Date.now(),
                name: name.trim().slice(0, 100),
                config,
            };
            local.push(saved);
            writeLocalPresets(local);
            await refreshPresets();
            await applyPresetById(saved.id);
        } catch (err) {
            alert("Nieprawidłowy plik konfiguracji: " + err.message);
        } finally {
            importInput.value = "";
        }
    });

    refreshPresetBar();
}

function syncConfigCustomState() {
    const custom = CONFIG_OVERRIDE_PATHS.size > 0
        || CONFIG_BASELINE_NAME === "Własna konfiguracja";
    if (custom === CONFIG_IS_CUSTOM) return;
    CONFIG_IS_CUSTOM = custom;
    refreshPresetBar();
}

function refreshPresetBar() {
    const select = document.getElementById("presetSelect");
    const deleteBtn = document.getElementById("presetDeleteBtn");
    select.innerHTML = "";

    const showCustom = CONFIG_IS_CUSTOM || CONFIG_BASELINE_NAME === "Własna konfiguracja";
    for (const p of PRESETS) {
        const opt = document.createElement("option");
        opt.textContent = p.name;
        opt.dataset.presetId = p.id ?? "";
        opt.dataset.presetName = p.name;
        opt.dataset.isBuiltin = p.is_builtin;
        if (!showCustom && p.is_builtin && p.name === CONFIG_BASELINE_NAME) opt.selected = true;
        else if (
            !showCustom
            && _currentPresetId !== null
            && String(p.id) === String(_currentPresetId)
        ) opt.selected = true;
        select.appendChild(opt);
    }

    if (showCustom) {
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
    PRESETS = loadPresetList();
}

async function applyPresetByName(name) {
    const preset = SERVER_PRESETS[name];
    USER_CONFIG = preset
        ? backfillConfig(structuredClone(preset))
        : backfillConfig(structuredClone(DEFAULT_CONFIG));
    CONFIG_BASELINE = structuredClone(USER_CONFIG);
    CONFIG_BASELINE_NAME = name;
    CONFIG_IS_CUSTOM = false;
    CONFIG_OVERRIDE_PATHS.clear();
    _currentPresetId = null;
    _currentPresetName = name;
    renderConfigView();
    initTipAnchoring();
    updateStageHints(document.getElementById("stages-container"));
    scheduleConfigSave();
    refreshPresetBar();
}


async function applyPresetById(presetId) {
    const preset = readLocalPresets().find(
        (p) => String(p.id) === String(presetId)
    );
    if (!preset) return;
    USER_CONFIG = backfillConfig(preset.config);
    CONFIG_BASELINE = structuredClone(USER_CONFIG);
    CONFIG_BASELINE_NAME = preset.name;
    CONFIG_IS_CUSTOM = false;
    CONFIG_OVERRIDE_PATHS.clear();
    _currentPresetId = preset.id;
    _currentPresetName = null;
    renderConfigView();
    initTipAnchoring();
    updateStageHints(document.getElementById("stages-container"));
    scheduleConfigSave();
    refreshPresetBar();
}

// --- Eksport i import symulacji ---

function defaultSimName() {
    return "Plan FIRE " + new Date().toISOString().slice(0, 10);
}

function simulationFileName(name) {
    const slug = String(name || "plan-fire")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "plan-fire";
    return `${slug}.sim.json`;
}

function parseSimulationInput(parsed) {
    if (parsed?.schema === "fire-config/v1") {
        throw new Error("To plik konfiguracji (.config.json) — wczytaj go w Konfiguracji.");
    }
    if (parsed?.schema !== "fire-simulation/v1" || !Array.isArray(parsed?.input?.stages)) {
        throw new Error("Oczekiwano pliku .sim.json (schema fire-simulation/v1).");
    }
    return parsed.input;
}

function initSimulationIO() {
    const exportBtn = document.getElementById("exportSimBtn");
    const importInput = document.getElementById("importSimInput");

    if (exportBtn) {
        exportBtn.addEventListener("click", () => {
            const data = lastInput || gatherFormData();
            const name = defaultSimName();
            const payload = {
                schema: "fire-simulation/v1",
                name,
                exported_at: new Date().toISOString(),
                source: "simulator",
                input: data,
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = simulationFileName(name);
            a.click();
            URL.revokeObjectURL(a.href);
            // Eksport oznacza, że plan został zachowany — draft nie może już
            // nadpisywać dalszej pracy na Symulatorze. Banner zostaje.
            clearWizardDraft();
        });
    }

    if (importInput) {
        importInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                populateStages(parseSimulationInput(parsed));
                switchToConfig();
            } catch (err) {
                alert("Nieprawidłowy plik symulacji: " + err.message);
            }
            importInput.value = "";
        });
    }
}

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

function defaultObligationAges() {
    const firstStart = parseInt(
        document.querySelector("#stages-container .stage-block .start-age")?.value,
        10
    );
    const start = Number.isFinite(firstStart) ? firstStart : 40;
    return { start, end: Math.min(120, start + 5) };
}

function createObligationRow(data = {}) {
    const ages = defaultObligationAges();
    const row = document.createElement("div");
    row.className = "obligation-row";
    row.dataset.obligation = "true";
    row.innerHTML = `
        <div class="obligation-main">
            <label class="field obligation-name-field">
                <span class="obligation-label">Nazwa</span>
                <input type="text" class="input obligation-name" maxlength="200"
                       value="${escapeHtml(data.name || "Zobowiązanie")}"
                       aria-label="Nazwa zobowiązania">
            </label>
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
        <div class="obligation-actions">
            <label class="field-checkbox obligation-redirect-label">
                <input type="checkbox" class="obligation-redirect" ${data.redirect_to_savings !== false ? "checked" : ""}>
                <span>Po zakończeniu przekieruj na oszczędności</span>
            </label>
            <button type="button" class="btn btn-ghost btn-icon btn-sm obligation-remove"
                    title="Usuń zobowiązanie" aria-label="Usuń zobowiązanie">${iconSvg("x")}</button>
        </div>`;
    row.querySelector(".obligation-remove").addEventListener("click", () => row.remove());
    return row;
}

function addObligationRow(data = {}) {
    const list = document.getElementById("obligationsList");
    if (!list) return;
    list.appendChild(createObligationRow(data));
}

function renderObligations(list = []) {
    const box = document.getElementById("obligationsList");
    if (!box) return;
    box.innerHTML = "";
    list.filter((item) => Number(item.monthly) > 0).forEach((item) => addObligationRow(item));
}

function gatherObligations() {
    return [...document.querySelectorAll("#obligationsList .obligation-row")]
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
                redirect_to_savings: Boolean(row.querySelector(".obligation-redirect")?.checked),
            };
        })
        .filter((item) => item.monthly > 0 && item.end_age > item.start_age);
}

function applyObligationsFromInput(inputData) {
    const explicit = Array.isArray(inputData?.obligations) ? inputData.obligations : [];
    if (explicit.length) {
        renderObligations(explicit);
        return;
    }
    const monthly = Number(inputData?.mortgage_monthly) || 0;
    const endAge = Number(inputData?.mortgage_end_age);
    if (monthly > 0 && Number.isFinite(endAge) && endAge > 0) {
        renderObligations([{
            name: "Kredyt hipoteczny",
            monthly,
            start_age: 0,
            end_age: endAge,
            redirect_to_savings: inputData.redirect_mortgage_to_savings !== false,
        }]);
    } else {
        renderObligations([]);
    }
}

function boostStageAccounts(stage, extraMonthly) {
    if (!stage?.accounts || extraMonthly <= 0) return;
    const eligible = Object.entries(stage.accounts).filter(([key, cfg]) => (
        !["ppk", "ppe", "zus"].includes(baseAccountKey(key))
        && (Number(cfg.annual_contribution) || 0) > 0
    ));
    const total = eligible.reduce(
        (sum, [, cfg]) => sum + (Number(cfg.annual_contribution) || 0),
        0
    );
    if (total <= 0) {
        const cash = stage.accounts.gotowka || { starting_balance: 0, roi: 0 };
        cash.annual_contribution = (Number(cash.annual_contribution) || 0) + extraMonthly * 12;
        stage.accounts.gotowka = cash;
        return;
    }
    eligible.forEach(([, cfg]) => {
        const share = (Number(cfg.annual_contribution) || 0) / total;
        cfg.annual_contribution = (Number(cfg.annual_contribution) || 0) + extraMonthly * 12 * share;
    });
}

function applyObligationStages(stages, obligations) {
    const out = stages.map((stage) => structuredClone(stage));
    const firstStart = Math.min(...out.map((stage) => Number(stage.start_age) || 0), 120);
    const firstReal = Math.min(
        ...out
            .filter((stage) => stage.stage_type === "realizacja")
            .map((stage) => Number(stage.start_age) || 0),
        120
    );
    [...(obligations || [])]
        .filter((item) => item.redirect_to_savings
            && Number(item.monthly) > 0
            && firstStart < Number(item.end_age)
            && Number(item.end_age) < firstReal)
        .sort((a, b) => Number(a.end_age) - Number(b.end_age))
        .forEach((obligation) => {
            const endAge = Number(obligation.end_age);
            for (let index = 0; index < out.length; index += 1) {
                const stage = out[index];
                if (stage.stage_type !== "akumulacja") continue;
                if (Number(stage.start_age) === endAge) {
                    boostStageAccounts(stage, Number(obligation.monthly));
                    break;
                }
                if (Number(stage.start_age) < endAge && endAge < Number(stage.end_age)) {
                    const first = structuredClone(stage);
                    first.end_age = endAge;
                    first.name = `${stage.name} (z zobowiązaniem)`;
                    const second = structuredClone(stage);
                    second.start_age = endAge;
                    second.name = `${stage.name} (po zobowiązaniu: ${obligation.name})`;
                    boostStageAccounts(second, Number(obligation.monthly));
                    out.splice(index, 1, first, second);
                    break;
                }
                if (Number(stage.end_age) === endAge) {
                    const following = out.slice(index + 1)
                        .find((item) => item.stage_type === "akumulacja");
                    if (following) boostStageAccounts(following, Number(obligation.monthly));
                    break;
                }
            }
        });
    return out;
}

function populateStages(inputData) {
    const container = document.getElementById("stages-container");
    loadedMaxAge = inputData.max_age != null && Number.isFinite(Number(inputData.max_age))
        ? Number(inputData.max_age)
        : null;
    loadedStartYear = inputData.start_year != null && Number.isFinite(Number(inputData.start_year))
        ? Number(inputData.start_year)
        : null;
    loadedInflation = inputData.inflation != null && inputData.inflation !== ""
        ? Number(inputData.inflation)
        : null;
    if (loadedInflation != null && !Number.isFinite(loadedInflation)) {
        loadedInflation = null;
    }
    loadedMonthlyGross = Number.isFinite(Number(inputData.monthly_gross))
        ? Number(inputData.monthly_gross)
        : null;
    applyObligationsFromInput(inputData);
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

// --- Czytelność wyników: kolumny, gęstość, wykres ---
