import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readRel = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const tpl = readRel("app/templates/wizard_v2.html");
const bodyStart = tpl.indexOf("{% block content %}") + "{% block content %}".length;
const bodyEnd = tpl.indexOf("{% endblock %}", bodyStart);
const content = tpl
    .slice(bodyStart, bodyEnd)
    .replace(/\{\{ version \}\}/g, "0")
    .replace(/\{\{ stage_types \| tojson \}\}/g, "{}");

const dom = new JSDOM(`<!DOCTYPE html><html><body>${content}</body></html>`, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/wizard-v2",
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
                    allocations: { ikze: 40, broker: 60 },
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
    "static/js/wizard-v2.js",
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

    v2Init();

    check("start: krok cel, 9 kroków, wstecz ukryty", () => {
        const cel = document.querySelector('.v2-step[data-step-id="cel"]');
        return !cel.classList.contains("hidden")
            && document.getElementById("v2StepCount").textContent === "Krok 1 / 9"
            && document.getElementById("v2BackBtn").classList.contains("hidden");
    });
    check("wynagrodzenie: domyślnie brutto rocznie z limitów", () => {
        return document.getElementById("v2EtatSalary").value === "113000"
            && v2Radio("v2EtatPeriod", "year") === "year"
            && v2Radio("v2EtatSalaryMode", "gross") === "gross";
    });
    check("nawigacja: cel -> profil", () => {
        document.getElementById("v2NextBtn").click();
        return !document.querySelector('.v2-step[data-step-id="profil"]').classList.contains("hidden");
    });
    check("B2B: krok etat znika, pojawia się b2b", () => {
        const radio = document.querySelector('input[name="v2Employment"][value="b2b"]');
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        document.getElementById("v2NextBtn").click();
        const b2b = document.querySelector('.v2-step[data-step-id="b2b"]');
        return !b2b.classList.contains("hidden")
            && document.querySelector('.v2-step[data-step-id="etat"]').classList.contains("hidden");
    });
    check("B2B: ryczałt pokazuje stawkę, liniowy chowa", () => {
        const linear = document.querySelector('input[name="v2B2bTaxForm"][value="liniowy"]');
        linear.checked = true;
        linear.dispatchEvent(new Event("change", { bubbles: true }));
        return document.getElementById("v2B2bLumpRow").classList.contains("hidden");
    });
    check("B2B: mały ZUS chowa pole własnej podstawy", () => {
        const maly = document.querySelector('input[name="v2B2bZusMode"][value="maly"]');
        maly.checked = true;
        maly.dispatchEvent(new Event("change", { bubbles: true }));
        return document.getElementById("v2B2bCustomZusRow").classList.contains("hidden");
    });
    check("PPK/PPE: etat pozwala zaznaczyć oba i wpisać salda", () => {
        const etat = document.querySelector('input[name="v2Employment"][value="etat"]');
        etat.checked = true;
        etat.dispatchEvent(new Event("change", { bubbles: true }));
        v2ShowStep("etat");
        const ppkActive = document.querySelector('input[name="v2PpkState"][value="active"]');
        const ppeActive = document.querySelector('input[name="v2PpeState"][value="active"]');
        ppkActive.checked = true;
        ppeActive.checked = true;
        ppkActive.dispatchEvent(new Event("change", { bubbles: true }));
        ppeActive.dispatchEvent(new Event("change", { bubbles: true }));
        document.getElementById("v2PpkBalance").value = "10000";
        document.getElementById("v2PpeBalance").value = "20000";
        const answers = v2CollectAnswers({ withAllocations: false });
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
        const ppkNever = document.querySelector('input[name="v2PpkState"][value="never"]');
        ppkNever.checked = true;
        ppkNever.dispatchEvent(new Event("change", { bubbles: true }));
        v2ShowStep("kapital");
        return document.getElementById("v2PpkBalanceField").classList.contains("hidden");
    });
    check("OFE: członkostwo niezależne od kapitału ZUS", () => {
        v2ShowStep("zus");
        const noZus = document.querySelector('input[name="v2HasZusCap"][value="no"]');
        noZus.checked = true;
        noZus.dispatchEvent(new Event("change", { bubbles: true }));
        const hasOfe = document.querySelector('input[name="v2HasOfe"][value="yes"]');
        hasOfe.checked = true;
        hasOfe.dispatchEvent(new Event("change", { bubbles: true }));
        document.getElementById("v2OfeBalance").value = "30000";
        const answers = v2CollectAnswers({ withAllocations: false });
        return !document.getElementById("v2OfeCapBox").classList.contains("hidden")
            && answers.ofe_member === true
            && answers.capital["zus:ofe"] === 30000;
    });
    check("horyzont: domyślny plan end wynika z płci i wieku", () => {
        return document.getElementById("v2PlanEnd").value === "81";
    });
    check("stan: zapis i odtworzenie wieku po ?restore=1", () => {
        localStorage.removeItem("fire.wizardV2Plan");
        const age = document.getElementById("v2Age");
        age.value = "47";
        age.dispatchEvent(new Event("input", { bubbles: true }));
        v2SaveState();
        age.value = "40";
        window.history.replaceState({}, "", "/wizard?restore=1");
        const restored = v2RestoreIfRequested();
        return restored && document.getElementById("v2Age").value === "47";
    });
    check("kapitał: pastylki IKE/IKZE/OIPE i wiersz z saldem", () => {
        document.querySelector('.v2-step[data-step-id="kapital"]');
        v2ShowStep("kapital");
        const pill = document.querySelector('#v2SheltersPicker .wz-pill[data-account="ikze"]');
        pill.click();
        const row = document.querySelector('#v2SheltersList .v2-cap-row[data-account="ikze"]');
        row.querySelector(".v2-cap-amount").value = "20000";
        const answers = v2CollectAnswers({ withAllocations: false });
        return !!row && answers.capital.ikze === 20000 && answers.use_ikze === true;
    });
    check("kapitał: wiele lokat dostaje numerowane instancje", () => {
        const add = document.querySelector('.v2-add-multi[data-base="lokata"]');
        add.click();
        add.click();
        const rows = [...document.querySelectorAll('#v2SafeList .v2-cap-row')];
        return rows.length === 2
            && rows[0].dataset.account === "lokata"
            && rows[1].dataset.account === "lokata:2";
    });
    check("ROI: brak powtarzanej notatki o domyślnej wartości", () => {
        v2ShowStep("kapital");
        const row = document.querySelector('#v2SafeList .v2-cap-row[data-account="lokata"]');
        return Boolean(row)
            && !row.querySelector(".v2-cap-roi-note")
            && Boolean(row.querySelector(".v2-cap-roi-reset"));
    });
    check("wynik: scenariusz i podsumowanie etapów renderują się", () => {
        v2Plan = {
            path: 1,
            input: {
                gender: "m",
                stages: [
                    { stage_type: "akumulacja", name: "Akumulacja", start_age: 35, end_age: 55, accounts: { broker: {} } },
                    { stage_type: "realizacja", name: "Brydż", start_age: 55, end_age: 65, accounts: { broker: {} } },
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
                warnings: [],
            },
            solved: { feasible: true, retire_early_age: 55 },
            scenarios: {},
            scenario_inputs: {},
            scenario_projections: {},
            scenario_solved: {},
        };
        v2SelectedScenario = "realne";
        v2RenderResult(v2Plan);
        return document.getElementById("v2HeroAnswer").textContent.includes("5")
            && document.querySelectorAll("#v2StageSummaryList .stage-line").length === 2
            && document.querySelectorAll("#v2PhaseTable tbody tr").length === 2
            && document.querySelectorAll("#v2FlowsGantt .wz-gantt-row").length >= 1
            && document.querySelectorAll("#v2Facts .wz-fact").length >= 1
            && document.getElementById("v2PolicyNote").textContent.includes("Kolejność wypłat");
    });
    check("restore: ?restore=1 odtwarza krok wyniku z zapisanego planu", () => {
        localStorage.removeItem("fire.wizardV2State");
        localStorage.setItem("fire.wizardV2Plan", JSON.stringify({
            plan: v2Plan,
            path: 1,
            selectedScenario: "realne",
        }));
        window.history.replaceState({}, "", "/wizard?restore=1");
        const restored = v2RestoreIfRequested();
        return restored
            && !document.querySelector('.v2-step[data-step-id="wynik"]').classList.contains("hidden")
            && !document.getElementById("v2Result").classList.contains("hidden")
            && document.getElementById("v2HeroAnswer").textContent.length > 0;
    });

    const failed = results.filter((r) => !r.ok);
    const NL = String.fromCharCode(10);
    console.log(NL + "=== FIRE wizard-v2.js — harness jsdom ===");
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
