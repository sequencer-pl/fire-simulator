import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readRel = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const tpl = readRel("app/templates/wizard.html");
const bodyStart = tpl.indexOf("{% block content %}") + "{% block content %}".length;
const bodyEnd = tpl.indexOf("{% endblock %}", bodyStart);
const content = tpl
    .slice(bodyStart, bodyEnd)
    .replace(/\{\{ version \}\}/g, "0")
    .replace(/\{\{ stage_types \| tojson \}\}/g, "{}");

const dom = new JSDOM(`<!DOCTYPE html><html><body>${content}</body></html>`, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/wizard",
});
const { window } = dom;
window.scrollTo = () => {};
window.alert = (message) => {
    throw new Error(`alert: ${message}`);
};
window.fetch = (url) => {
    if (String(url).includes("/api/wizard/salary")) {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ gross_monthly: 8_000, net_monthly: 5_789.53 }),
        });
    }
    if (String(url).includes("/api/wizard/suggest")) {
        return Promise.resolve({
            ok: true,
            json: () =>
                Promise.resolve({
                    allocations: { ikze: 40, ike: 20, broker: 40 },
                    wrapper_vehicles: { ike: "savings", ikze: "savings", oipe: "fund" },
                    asset_mix: { safe: 60, market: 40, high: 0 },
                    pool_monthly: 2_000,
                }),
        });
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
};

const scripts = [
    "static/js/helpers.js",
    "static/js/icons.js",
    "static/js/sim-metadata.js",
    "static/js/sim-utils.js",
    "static/js/controls.js",
    "static/js/wizard.js",
]
    .map(readRel)
    .join("\n;\n");

const harness = `
(() => {
    const results = [];
    const check = (name, fn) => {
        try {
            results.push({ name, ok: Boolean(fn()), err: null });
        } catch (e) {
            results.push({ name, ok: false, err: String((e && e.message) || e) });
        }
    };

    wzInit();

    check("start: krok cel, 9 kroków", () => {
        const cel = document.querySelector('.wz-step[data-step-id="cel"]');
        return !cel.classList.contains("hidden")
            && document.getElementById("wzStepCount").textContent === "Krok 1 / 9"
            && document.getElementById("wzBackBtn").classList.contains("hidden");
    });
    check("tryb auto vs manual przełącza panele planowania", () => {
        const autoRadio = document.querySelector('input[name="wzOptimizeMode"][value="auto"]');
        const manualRadio = document.querySelector('input[name="wzOptimizeMode"][value="manual"]');
        if (!autoRadio || !manualRadio) return false;
        autoRadio.checked = true;
        wzSyncModeUI();
        const autoOk = !document.getElementById("wzAutoPlanningPanel").classList.contains("hidden")
            && document.getElementById("wzManualPlanningPanel").classList.contains("hidden");
        manualRadio.checked = true;
        wzSyncModeUI();
        const manualOk = document.getElementById("wzAutoPlanningPanel").classList.contains("hidden")
            && !document.getElementById("wzManualPlanningPanel").classList.contains("hidden");
        autoRadio.checked = true;
        wzSyncModeUI();
        return autoOk && manualOk;
    });
    check("planowanie: priorytet i seed używają dużych kafli", () => {
        return document.querySelectorAll("#wzPriorityPanel .wz-path").length === 2
            && document.querySelectorAll("#wzProfileSeeds button.wz-path").length === 3;
    });
    check("wynagrodzenie: domyślnie brutto rocznie z limitów", () => {
        return document.getElementById("wzEtatSalary").value === "113000"
            && wzRadio("wzEtatPeriod", "year") === "year"
            && wzRadio("wzEtatSalaryMode", "gross") === "gross";
    });
    check("nawigacja: cel -> profil", () => {
        document.getElementById("wzNextBtn").click();
        return !document.querySelector('.wz-step[data-step-id="profil"]').classList.contains("hidden");
    });
    check("B2B: krok etat znika, pojawia się b2b", () => {
        const radio = document.querySelector('input[name="wzEmployment"][value="b2b"]');
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        document.getElementById("wzNextBtn").click();
        const b2b = document.querySelector('.wz-step[data-step-id="b2b"]');
        return !b2b.classList.contains("hidden")
            && document.querySelector('.wz-step[data-step-id="etat"]').classList.contains("hidden");
    });
    check("B2B: ryczałt pokazuje stawkę, liniowy chowa", () => {
        const linear = document.querySelector('input[name="wzB2bTaxForm"][value="liniowy"]');
        linear.checked = true;
        linear.dispatchEvent(new Event("change", { bubbles: true }));
        return document.getElementById("wzB2bLumpRow").classList.contains("hidden");
    });
    check("B2B: mały ZUS chowa pole własnej podstawy", () => {
        const maly = document.querySelector('input[name="wzB2bZusMode"][value="maly"]');
        maly.checked = true;
        maly.dispatchEvent(new Event("change", { bubbles: true }));
        return document.getElementById("wzB2bCustomZusRow").classList.contains("hidden");
    });
    check("PPK/PPE: etat pozwala zaznaczyć oba i wpisać salda", () => {
        const etat = document.querySelector('input[name="wzEmployment"][value="etat"]');
        etat.checked = true;
        etat.dispatchEvent(new Event("change", { bubbles: true }));
        wzShowStep("etat");
        const ppkActive = document.querySelector('input[name="wzPpkState"][value="active"]');
        const ppeActive = document.querySelector('input[name="wzPpeState"][value="active"]');
        ppkActive.checked = true;
        ppeActive.checked = true;
        ppkActive.dispatchEvent(new Event("change", { bubbles: true }));
        ppeActive.dispatchEvent(new Event("change", { bubbles: true }));
        document.getElementById("wzPpkBalance").value = "10000";
        document.getElementById("wzPpeBalance").value = "20000";
        const answers = wzCollectAnswers({ withAllocations: false });
        return answers.use_ppk === true
            && answers.use_ppe === true
            && answers.ppk_contributions === true
            && answers.ppe_contributions === true
            && answers.ppk_employee_pct === 0.02
            && answers.ppe_employer_pct === 0.035
            && answers.capital.ppk === 10000
            && answers.capital.ppe === 20000;
    });
    check("PPK/PPE: stan 'nigdy' chowa pole salda", () => {
        const ppkNever = document.querySelector('input[name="wzPpkState"][value="never"]');
        ppkNever.checked = true;
        ppkNever.dispatchEvent(new Event("change", { bubbles: true }));
        wzShowStep("kapital");
        return document.getElementById("wzPpkBalanceField").classList.contains("hidden");
    });
    check("OFE: członkostwo niezależne od kapitału ZUS", () => {
        wzShowStep("zus");
        const noZus = document.querySelector('input[name="wzHasZusCap"][value="no"]');
        noZus.checked = true;
        noZus.dispatchEvent(new Event("change", { bubbles: true }));
        const hasOfe = document.querySelector('input[name="wzHasOfe"][value="yes"]');
        hasOfe.checked = true;
        hasOfe.dispatchEvent(new Event("change", { bubbles: true }));
        document.getElementById("wzOfeBalance").value = "30000";
        const answers = wzCollectAnswers({ withAllocations: false });
        return !document.getElementById("wzOfeCapBox").classList.contains("hidden")
            && answers.ofe_member === true
            && answers.capital["zus:ofe"] === 30000;
    });
    check("horyzont: domyślny plan end wynika z płci i wieku", () => {
        return document.getElementById("wzPlanEnd").value === "81";
    });
    check("stan: zapis i odtworzenie wieku po ?restore=1", () => {
        localStorage.removeItem("fire.wizardPlan");
        const age = document.getElementById("wzAge");
        age.value = "47";
        age.dispatchEvent(new Event("input", { bubbles: true }));
        wzSaveState();
        age.value = "40";
        window.history.replaceState({}, "", "/wizard?restore=1");
        const restored = wzRestoreIfRequested();
        return restored && document.getElementById("wzAge").value === "47";
    });
    check("kapitał: pastylki IKE/IKZE/OIPE i wiersz z saldem", () => {
        document.querySelector('.wz-step[data-step-id="kapital"]');
        wzShowStep("kapital");
        const pill = document.querySelector('#wzSheltersPicker .wz-pill[data-account="ikze"]');
        pill.click();
        const row = document.querySelector('#wzSheltersList .wz-cap-row[data-account="ikze"]');
        row.querySelector(".wz-cap-amount").value = "20000";
        const answers = wzCollectAnswers({ withAllocations: false });
        return !!row && answers.capital.ikze === 20000 && answers.use_ikze === true;
    });
    check("kapitał: wiele lokat dostaje numerowane instancje", () => {
        const add = document.querySelector('.wz-add-multi[data-base="lokata"]');
        add.click();
        add.click();
        const rows = [...document.querySelectorAll('#wzSafeList .wz-cap-row')];
        return rows.length === 2
            && rows[0].dataset.account === "lokata"
            && rows[1].dataset.account === "lokata:2";
    });
    check("podział ręczny: zaokrąglenia sumują się dokładnie do 100", () => {
        const out = wzNormalizeManualShares({
            ikze: 9.42, ike: 23.55, oipe: 23.55, broker: 19.57,
            obligacje: 10.87, oki_inw: 6.52, lokata: 4.35, krypto: 2.17,
        }, { exact: true });
        const sum = Object.values(out).reduce((a, b) => a + b, 0);
        return Math.abs(sum - 100) < 1e-9;
    });
    check("podział ręczny: suma powyżej 100 jest normalizowana", () => {
        const out = wzNormalizeManualShares({
            broker: 80, lokata: 50, obligacje: 10,
        });
        const sum = Object.values(out).reduce((a, b) => a + b, 0);
        return Math.abs(sum - 100) < 1e-9;
    });
    check("podział ręczny: wrapper ma wybór rodzaju inwestycji", () => {
        wzSuggested = {
            allocations: { ikze: 40, ike: 20, broker: 40 },
            wrapperVehicles: { ike: "savings", ikze: "savings", oipe: "fund" },
            pool_monthly: 2_000,
        };
        wzManualAllocations = Object.fromEntries(
            WZ_ALLOCATABLE_ACCOUNTS.map((account) => [account, 0])
        );
        wzManualVehicles = {};
        wzAllocationMode = "manual";
        wzRenderManualAllocation();
        const selects = [...document.querySelectorAll(".wz-vehicle-select")];
        const oipe = document.querySelector('.wz-vehicle-select[data-account="oipe"]');
        const ike = document.querySelector('.wz-vehicle-select[data-account="ike"]');
        return selects.length === 3
            && Boolean(oipe) && oipe.options.length === 1 && oipe.value === "fund"
            && Boolean(ike) && ike.value === "savings";
    });
    check("podział ręczny: start to 100% gotówki", () => {
        wzManualAllocations = null;
        wzSeedManualAllocations();
        return Object.values(wzManualAllocationShares()).every((value) => value === 0);
    });
    check("podział ręczny: plan zablokowany przy 0% udziałów", () => {
        const manual = document.querySelector('input[name="wzOptimizeMode"][value="manual"]');
        if (!manual) return false;
        manual.checked = true;
        wzSyncModeUI();
        wzSuggested = { allocations: {}, pool_monthly: 2000 };
        wzManualAllocations = Object.fromEntries(
            WZ_ALLOCATABLE_ACCOUNTS.map((account) => [account, 0])
        );
        try {
            return !wzValidateStep("strategia");
        } catch (error) {
            return /Rozdziel wpłaty/.test(error.message);
        }
    });
    check("ROI: brak powtarzanej notatki o domyślnej wartości", () => {
        wzShowStep("kapital");
        const row = document.querySelector('#wzSafeList .wz-cap-row[data-account="lokata"]');
        return Boolean(row)
            && !row.querySelector(".wz-cap-roi-note")
            && Boolean(row.querySelector(".wz-cap-roi-reset"));
    });
    check("wynik: optymalizator na dole i zwinięty", () => {
        const optimizer = document.getElementById("wzOptimizer");
        const details = document.getElementById("wzDetails");
        return Boolean(optimizer)
            && optimizer.tagName === "DETAILS"
            && !optimizer.open
            && Boolean(details)
            && Boolean(details.compareDocumentPosition(optimizer) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    check("wynik: odpowiedź, plan i szczegóły renderują się", () => {
        wzPlan = {
            path: 1,
            input: {
                gender: "m",
                stages: [
                    { stage_type: "akumulacja", name: "Akumulacja", start_age: 35, end_age: 55, accounts: { broker: {} } },
                    { stage_type: "realizacja", name: "Brydż", start_age: 55, end_age: 65, accounts: { broker: {} } },
                    { stage_type: "realizacja", name: "Emerytura ZUS", start_age: 65, end_age: 100, accounts: { zus: {} } },
                ],
            },
            projection: {
                met: true,
                min_monthly: 5000,
                mean_monthly: 5500,
                peak_wealth: 1200000,
                final_wealth: 0,
                final_wealth_net: 0,
                target_monthly: null,
                total_withdrawn: 600000,
                ikze_refund_total: 5000,
                ikze_refund_allocations: { broker: 5000 },
                early_return_total: 0,
                withdrawal_policy: "defer_tier",
                stage_metrics: [
                    { name: "Akumulacja", start_age: 35, end_age: 55, monthly: 2000 },
                    { name: "Brydż", start_age: 55, end_age: 65, monthly: 5000 },
                ],
                phase_metrics: [
                    { name: "Akumulacja", cashflow: "contribution", start_age: 35, end_age: 55, monthly: 2000, portfolio_monthly: 0, zus_monthly: 0 },
                    { name: "Brydż", cashflow: "payout", start_age: 55, end_age: 65, monthly: 5000, portfolio_monthly: 5000, zus_monthly: 0 },
                ],
                accumulation_phases: [{
                    account: "broker",
                    start_age: 35,
                    end_age: 55,
                    stage_name: "Akumulacja",
                    monthly_contribution: 2000,
                    annual_contribution: 24000,
                    total_contributions: 480000,
                    starting_balance: 0,
                    ending_balance: 1000000,
                    growth: 520000,
                }],
                capital_transfers: [{
                    age: 55,
                    from_account: "ikze",
                    to_account: "broker",
                    amount: 50000,
                    kind: "early_ikze_return",
                }],
                account_phases: [{
                    account: "broker",
                    accumulation_start_age: 35,
                    accumulation_end_age: 55,
                    accumulation_start_balance: 0,
                    accumulation_annual_contribution: 24000,
                    accumulation_total_contributions: 480000,
                    accumulation_end_balance: 1000000,
                    accumulation_growth: 520000,
                    start_age: 55,
                    last_age: 65,
                    years: 11,
                    months: 132,
                    starting_balance: 1000000,
                    ending_balance: 0,
                    total_net: 600000,
                    avg_monthly_net: 5000,
                    min_monthly_net: 5000,
                    max_monthly_net: 5000,
                    total_tax: 10000,
                    total_health: 0,
                    lump_tax: 0,
                }],
                chart: (() => {
                    const ages = Array.from({ length: 31 }, (_, index) => 35 + index);
                    return {
                        ages,
                        withdrawals_net: {
                            broker: ages.map((age) => (age >= 55 ? 50000 : 0)),
                        },
                        balances: {
                            broker: ages.map((age) => Math.max(0, 1000000 - Math.max(0, age - 55) * 100000)),
                        },
                    };
                })(),
                warnings: [],
            },
            solved: { feasible: true, retire_early_age: 55 },
            scenarios: {},
            scenario_inputs: {},
            scenario_projections: {},
            scenario_solved: {},
        };
        wzSelectedScenario = "realne";
        wzRenderResult(wzPlan);
        return document.getElementById("wzHeroAnswer").textContent.includes("5")
            && document.querySelectorAll("#wzMetrics .metric").length === 3
            && document.querySelectorAll("#wzTimeline .wz-timeline-segment").length === 2
            && document.querySelectorAll("#wzFlowsGantt .wz-gantt-row").length >= 3
            && Boolean(document.querySelector("#wzFlowsGantt .wz-gantt-transfer"))
            && document.querySelectorAll("#wzWealthDetails .wz-wealth-row").length === 3
            && document.querySelectorAll("#wzFacts .wz-fact").length >= 1
            && document.getElementById("wzPolicyNote").textContent.includes("Najpierw");
    });
    check("wynik: suma tylko z portfela, bez ZUS", () => {
        const note = document.getElementById("wzFlowsTotal");
        return Boolean(note)
            && note.textContent.includes("Łączna suma wypłat z portfela prywatnego FIRE")
            && !note.textContent.includes("Z ZUS");
    });
    check("wynik: tabela przepływów pod ganttem i zwinięta", () => {
        const details = document.getElementById("wzFlowsTableDetails");
        return Boolean(details)
            && details.tagName === "DETAILS"
            && !details.open
            && Boolean(details.closest("#wzFlowsWrap"))
            && Boolean(details.querySelector("#wzAccountFlows"))
            && details.querySelectorAll(".wz-phase-badge").length > 0
            && document.querySelectorAll("#wzAccumulationFlows tbody tr").length > 0
            && document.querySelectorAll("#wzTransferFlows tbody tr").length > 0;
    });
    check("wynik: wspólna legenda adnotacji", () => {
        return document.querySelectorAll("#wzChartAnnotations .wz-chart-annotation-chip").length > 0
            && document.querySelector(".wz-chart-annotations-label")?.textContent.trim()
                === "Kamienie milowe:"
            && !document.getElementById("wzWithdrawalsAnnotationsToggle");
    });
    check("wynik: aktywna adnotacja pokazuje linię i opis", () => {
        const chips = [...document.querySelectorAll("#wzChartAnnotations .wz-chart-annotation-chip")];
        const note = document.getElementById("wzChartAnnotationNote");
        if (chips.length < 2 || !note) return false;
        const visibleLines = () => document.querySelectorAll(
            ".wz-chart-annotation-line.is-visible"
        ).length;
        const initial = note.hidden && visibleLines() === 0;
        chips[0].click();
        const first = !note.hidden
            && visibleLines() === 2
            && chips[0].classList.contains("is-active");
        chips[1].click();
        const second = visibleLines() === 2
            && chips[1].classList.contains("is-active")
            && !chips[0].classList.contains("is-active");
        chips[1].click();
        const off = note.hidden && visibleLines() === 0;
        return initial && first && second && off;
    });
    check("adnotacja ZUS bierze etap realizacji, nie akumulacji", () => {
        const input = {
            gender: "m",
            max_age: 99,
            stages: [
                { stage_type: "akumulacja", start_age: 40, end_age: 55, accounts: { zus: {} } },
                { stage_type: "realizacja", start_age: 65, end_age: 100, accounts: { zus: {} } },
            ],
        };
        const projection = {
            chart: { ages: Array.from({ length: 61 }, (_, index) => 40 + index) },
            early_return_total: 0,
        };
        const zus = wzChartAnnotationsFor(input, projection)
            .find((annotation) => annotation.kind === "zus");
        return Boolean(zus)
            && zus.age === 65
            && zus.text.includes("65")
            && !zus.text.includes("40 r.ż.");
    });
    check("wynik: wykresy wypłat i kapitału renderują się", () => {
        return Boolean(document.querySelector("#wzWithdrawalsChart svg"))
            && Boolean(document.querySelector("#wzCapitalChart svg"))
            && document.querySelectorAll("#wzWithdrawalsLegend .wz-chart-legend-item").length > 0
            && document.querySelectorAll("#wzCapitalLegend .wz-chart-legend-item").length > 0;
    });
    check("optymalizator: tabela wariantów i rekomendacja renderują się", () => {
        const candidate = (age, ike, ikze, payout, final, baseline = false) => ({
            zus_start_age: age,
            allocations: { ike, ikze },
            withdrawal_policy: "defer_tier",
            payout_monthly: payout,
            min_monthly: payout,
            mean_monthly: payout + 100,
            total_withdrawn: payout * 12 * 20,
            final_wealth_net: final,
            met: true,
            feasible: true,
            break_even_age: null,
            is_baseline: baseline,
        });
        wzRenderOptimizer({
            objective: "payout",
            bequest_target: 0,
            baseline: candidate(65, 53, 47, 4000, 300000, true),
            recommended: candidate(65, 65, 35, 4500, 0),
            best_total: candidate(70, 100, 0, 4200, 0),
            candidates: [
                candidate(65, 53, 47, 4000, 300000, true),
                candidate(65, 65, 35, 4500, 0),
                candidate(70, 100, 0, 4200, 0),
            ],
            evaluated: 12,
            warnings: [],
        });
        return document.querySelectorAll("#wzOptimizerResult tbody tr").length === 2
            && !document.getElementById("wzOptimizerChip").classList.contains("hidden")
            && document.querySelectorAll("[data-optimizer-apply]").length === 0;
    });
    check("restore: ?restore=1 odtwarza krok wyniku z zapisanego planu", () => {
        localStorage.removeItem("fire.wizardState");
        localStorage.setItem("fire.wizardPlan", JSON.stringify({
            plan: wzPlan,
            path: 1,
            selectedScenario: "realne",
        }));
        window.history.replaceState({}, "", "/wizard?restore=1");
        const restored = wzRestoreIfRequested();
        return restored
            && !document.querySelector('.wz-step[data-step-id="wynik"]').classList.contains("hidden")
            && !document.getElementById("wzResult").classList.contains("hidden")
            && document.getElementById("wzHeroAnswer").textContent.length > 0;
    });

    const failed = results.filter((r) => !r.ok);
    const NL = String.fromCharCode(10);
    console.log(NL + "=== FIRE wizard.js — harness jsdom ===");
    for (const r of results) {
        console.log((r.ok ? "PASS" : "FAIL") + "  " + r.name + (r.err ? "  (" + r.err + ")" : ""));
    }
    console.log(NL + (failed.length === 0 ? "ALL CHECKS PASSED" : "FAILURES: " + failed.length));
    window.__fireFailed = failed.length;
})();
`;

try {
    window.eval(scripts + "\n;\n" + harness);
} catch (err) {
    console.error(err);
    process.exit(1);
}

setTimeout(() => {
    process.exit(window.__fireFailed ? 1 : 0);
}, 700);
