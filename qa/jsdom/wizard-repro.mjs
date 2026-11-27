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
    "static/js/results-model.js",
    "static/js/results-metrics.js",
    "static/js/results-banners.js",
    "static/js/results-view.js",
    "static/js/results-summary.js",
    "static/js/results-plan-time.js",
    "static/js/results-charts.js",
    "static/js/results-table.js",
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

    check("init: wejście bez ?restore nie zapisuje stanu", () => {
        return localStorage.getItem("fire.wizardState") == null;
    });
    check("draft: zawiera pełny input i skalary kredytu/pensji", () => {
        const input = {
            gender: "m",
            stages: [{ stage_type: "akumulacja", name: "A", start_age: 40, end_age: 50, accounts: {} }],
            max_age: 80,
            mortgage_monthly: 3200,
            mortgage_end_age: 57,
            monthly_gross: 9000,
            start_year: 2026,
            inflation: 0.025,
            withdrawal_policy: "auto",
        };
        const draft = wzBuildDraft(input);
        return draft.input === input
            && draft.max_age === 80
            && draft.mortgage_monthly === 3200
            && draft.mortgage_end_age === 57
            && draft.monthly_gross === 9000
            && draft.start_year === 2026
            && draft.inflation === 0.025
            && draft.stages === input.stages
            && draft.withdrawal_policy === "auto";
    });
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
    check("IKZE: kolejność reinwestycji bez krypto", () => {
        wzRenderIkzeRefundNote([["ikze", 40]]);
        const note = document.getElementById("wzIkzeRefundNote");
        const text = note.textContent.replace(/\\s+/g, " ");
        return !note.classList.contains("hidden")
            && !/krypto/i.test(text)
            && text.includes("IKE → OIPE → Obligacje → Lokata → OKI oszczędnościowe → Broker → Gotówka");
    });
    check("copy: 'nie pracuję' opisuje inne źródło utrzymania", () => {
        const radio = document.querySelector('input[name="wzEmployment"][value="niepracujacy"]');
        const card = radio?.closest(".wz-path");
        const text = (card?.textContent || "").replace(/\\s+/g, " ");
        return text.includes("inne źródło utrzymania")
            && text.includes("Wpłaty pochodzą spoza modelowanego portfela")
            && text.includes("kapitał rośnie");
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
    check("loader: bez spinnera, z paskiem postępu", () => {
        return !document.querySelector("#wzPlanLoader .spinner")
            && Boolean(document.querySelector("#wzPlanLoader .progress"));
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
            summary: {
                min_monthly: 5000,
                avg_monthly: 5500,
                min_monthly_portfolio: 4100,
                avg_monthly_portfolio: 4700,
                total_withdrawn: 600000,
                end_age: 65,
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
            && document.querySelectorAll("#wzMetrics .metric").length === 7
            && document.querySelectorAll("#wzTimeline .wz-timeline-segment").length === 2
            && document.querySelectorAll("#wzFlowsGantt .wz-gantt-row").length >= 3
            && Boolean(document.querySelector("#wzFlowsGantt .wz-gantt-transfer"))
            && document.querySelectorAll("#wzFacts .wz-fact").length >= 1
            && document.getElementById("wzPolicyTipText").textContent.includes("Najpierw");
    });
    check("metryki: min/średnia to budżet na życie, portfel osobno z summary", () => {
        const metricByLabel = (label) => [...document.querySelectorAll("#wzMetrics .metric")]
            .find((node) => node.textContent.includes(label));
        const min = metricByLabel("Minimalny budżet na życie");
        const avg = metricByLabel("Średni budżet na życie");
        const portfolio = metricByLabel("Minimalna wypłata z portfela");
        return Boolean(min && avg && portfolio)
            && min.textContent.includes("5")
            && min.textContent.includes("000")
            && avg.textContent.includes("5")
            && avg.textContent.includes("500")
            && portfolio.textContent.includes("4")
            && portfolio.textContent.includes("100");
    });
    check("fakty: brak metryki budżetu nie pokazuje 0 zł", () => {
        const html = ResultsSummary.budgetFact(
            { obligations: [{ monthly: 100, start_age: 40, end_age: 50 }] },
            { avg_monthly: null, min_monthly: null }
        );
        return html === "";
    });
    check("rok po roku: wiersz po horyzoncie pokazuje sam ZUS", () => {
        const row = ResultsTable.postHorizonFor(
            {
                max_age: 80,
                stages: [
                    { stage_type: "realizacja", start_age: 65, end_age: 100, accounts: { zus: {} } },
                ],
            },
            {
                summary: {
                    has_pension: true,
                    end_age: 80,
                    zus_monthly: 1841.69,
                },
            }
        );
        const beyond = ResultsTable.postHorizonFor(
            {
                max_age: 100,
                stages: [
                    { stage_type: "realizacja", start_age: 65, end_age: 100, accounts: { zus: {} } },
                ],
            },
            {
                summary: {
                    has_pension: true,
                    end_age: 100,
                    zus_monthly: 1841.69,
                },
            }
        );
        return Boolean(row)
            && row.ageLabel === "81+"
            && row.stageName.includes("Tylko ZUS")
            && Math.round(row.monthly) === 1842
            && Math.round(row.annual) === 22100
            && beyond == null;
    });
    check("rok po roku: po horyzoncie z aktywnym zobowiązaniem budżet to —", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        window.ResultsTable.render(host, {
            input: {
                obligations: [{ monthly: 1000, start_age: 42, end_age: 50 }],
                stages: [
                    { stage_type: "realizacja", start_age: 65, end_age: 100, accounts: { zus: {} } },
                ],
            },
            result: {
                summary: { end_age: 41, has_pension: true, zus_monthly: 1900 },
                accounts: ["zus"],
                account_labels: { zus: "ZUS" },
                years: [
                    {
                        age: 41,
                        stage_name: "Realizacja",
                        balances: {},
                        ending_balances: {},
                        total_wealth: 0,
                        annual_withdrawal: 24000,
                        monthly_withdrawal: 2000,
                        lifestyle_monthly: 2000,
                        tax_paid: 0,
                    },
                ],
            },
            embedded: true,
            postHorizon: {
                ageLabel: "42+",
                stageName: "Tylko ZUS",
                monthly: 1900,
                annual: 22800,
                title: "test",
            },
        });
        const post = host.querySelector("tr.post-horizon");
        const cell = post?.querySelector('td[data-col="lifestyle"]');
        return Boolean(post && cell) && cell.textContent.trim() === "—";
    });
    check("rok po roku: kluczowe kolumny są pierwsze i miesięczna wypłata jest wyróżniona", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        window.ResultsTable.render(host, {
            result: {
                accounts: ["ike"],
                account_labels: { ike: "IKE" },
                years: [
                    {
                        age: 40,
                        stage_name: "Akumulacja",
                        balances: { ike: 1000, zus: 200 },
                        ending_balances: { ike: 1100, zus: 300, "zus:ofe": 150 },
                        total_wealth: 1550,
                        annual_withdrawal: 0,
                        monthly_withdrawal: 0,
                        tax_paid: 0,
                    },
                    {
                        age: 41,
                        stage_name: "Realizacja",
                        balances: { ike: 900, zus: 200 },
                        ending_balances: { ike: 800, zus: 250 },
                        total_wealth: 1050,
                        annual_withdrawal: 60000,
                        monthly_withdrawal: 5000,
                        tax_paid: 100,
                    },
                ],
            },
            embedded: true,
            postHorizon: {
                ageLabel: "42+",
                stageName: "Tylko ZUS",
                monthly: 2000,
                annual: 24000,
                title: "test",
            },
        });
        const headers = [...host.querySelectorAll("thead th")].map((th) => th.textContent.trim());
        const rows = [...host.querySelectorAll("tbody tr")];
        const firstRow = rows[0];
        const secondRow = rows[1];
        const monthlyCell = firstRow?.querySelector("td.col-monthly");
        const monthlyHeader = host.querySelector("th.col-monthly");
        const post = host.querySelector("tr.post-horizon");
        const text = (row, col) => (row?.querySelector('td[data-col="' + col + '"]')?.textContent || "")
            .replace(/\\s+/g, " ")
            .trim();
        const ok = headers.slice(0, 6).join("|")
                === "Wiek|Etap|Wypłata mies.|Majątek|Wypłata roczna|Podatek"
            && Boolean(monthlyCell)
            && Boolean(monthlyHeader)
            && firstRow.querySelectorAll("td")[2] === monthlyCell
            && Boolean(post?.querySelector("td.col-monthly"))
            && post?.dataset.keep === "true"
            && !firstRow.querySelector("strong")
            // Salda i majątek liczone z ending_balances; ZUS poza majątkiem.
            && text(firstRow, "ike").startsWith("1100")
            && text(secondRow, "ike").startsWith("800")
            && text(firstRow, "wealth").startsWith("1100")
            && text(secondRow, "wealth").startsWith("800")
            && headers.includes("ZUS (kapitał)")
            && text(firstRow, "zus").startsWith("450")
            && text(post, "wealth") === "—"
            && !host.textContent.includes("majątek prywatny jest poza modelem")
            && document.getElementById("wzYearTable")?.previousElementSibling
                ?.querySelector(".tooltip")?.textContent
                .includes("majątek prywatny jest poza modelem");
        host.remove();
        return ok;
    });
    check("etapy: techniczne segmenty wracają do jednego logicznego etapu", () => {
        const input = {
            monthly_gross: 0,
            stages: [
                { stage_type: "realizacja", origin_stage_id: "r1", name: "Realizacja (z zobowiązaniem)", start_age: 45, end_age: 48, accounts: {} },
                { stage_type: "realizacja", origin_stage_id: "r1", name: "Realizacja (po zobowiązaniu)", start_age: 48, end_age: 50, accounts: {} },
                { stage_type: "realizacja", origin_stage_id: "r1", name: "Realizacja", start_age: 50, end_age: 55, accounts: {} },
            ],
        };
        const result = {
            years: [45, 46, 47, 48, 49, 50, 51, 52, 53, 54].map((age) => ({
                age,
                monthly_withdrawal: 3000,
                zus_monthly: 0,
                balances: {},
            })),
        };
        const segments = computeStageSummaries(input, result);
        return segments.length === 1
            && segments[0].start_age === 45
            && segments[0].end_age === 55
            && segments[0].label === "Realizacja";
    });
    check("wynik: scenariusze są osobną sekcją pod hero", () => {
        const hero = document.getElementById("wzHeroAnswer");
        const scenarios = document.getElementById("wzScenariosSection");
        const warnings = document.getElementById("wzWarnings");
        const heroCard = hero?.closest(".wz-result-card");
        const scenarioCard = scenarios?.closest(".wz-result-card");
        return Boolean(heroCard && scenarioCard)
            && heroCard !== scenarioCard
            && warnings?.closest(".wz-result-card") === heroCard
            && Boolean(scenarios.querySelector("#wzScenariosBox"));
    });
    check("wynik: tabela przepływów pod ganttem i rozwinięta", () => {
        const details = document.getElementById("wzFlowsTableDetails");
        return Boolean(details)
            && details.tagName === "DETAILS"
            && details.open
            && Boolean(details.closest("#wzFlowsWrap"))
            && Boolean(details.querySelector("#wzAccountFlows"))
            && details.querySelectorAll(".wz-phase-badge").length > 0
            && document.querySelectorAll("#wzAccumulationFlows tbody tr").length > 0
            && document.querySelectorAll("#wzTransferFlows tbody tr").length > 0;
    });
    check("wynik: kamienie milowe domyślnie widoczne", () => {
        const toggle = document.getElementById("wzChartMilestonesToggle");
        const labels = document.querySelectorAll(".wz-chart-milestone");
        const lines = document.querySelectorAll(".wz-chart-milestone-line");
        return Boolean(toggle)
            && !toggle.classList.contains("hidden")
            && toggle.getAttribute("aria-pressed") === "true"
            && toggle.textContent.includes("Ukryj kamienie milowe")
            && labels.length > 0
            && lines.length === labels.length;
    });
    check("wynik: wyłączenie chowa adnotacje", () => {
        const toggle = document.getElementById("wzChartMilestonesToggle");
        toggle.click();
        return toggle.getAttribute("aria-pressed") === "false"
            && toggle.textContent.includes("Pokaż kamienie milowe")
            && document.querySelectorAll(".wz-chart-milestone").length === 0
            && document.querySelectorAll(".wz-chart-milestone-line").length === 0
            && document.getElementById("wzChartMilestoneTip").classList.contains("hidden");
    });
    check("wynik: ponowne włączenie pokazuje adnotacje na obu wykresach", () => {
        const toggle = document.getElementById("wzChartMilestonesToggle");
        toggle.click();
        const labels = document.querySelectorAll(".wz-chart-milestone");
        const lines = document.querySelectorAll(".wz-chart-milestone-line");
        return toggle.getAttribute("aria-pressed") === "true"
            && toggle.textContent.includes("Ukryj kamienie milowe")
            && labels.length > 0
            && lines.length === labels.length
            && document.querySelectorAll(".wz-chart-milestone-line.is-active").length === 0;
    });
    check("wynik: kliknięcie kamienia pokazuje opis w popoverze", () => {
        const labels = [...document.querySelectorAll(".wz-chart-milestone")];
        const tip = document.getElementById("wzChartMilestoneTip");
        const body = document.getElementById("wzChartMilestoneTipBody");
        if (labels.length < 2 || !tip || !body) return false;
        labels[0].click();
        const first = !tip.classList.contains("hidden")
            && body.textContent.trim().length > 0
            && labels[0].getAttribute("aria-expanded") === "true"
            && document.querySelectorAll(".wz-chart-milestone.is-active").length === 2;
        labels[1].click();
        const second = !tip.classList.contains("hidden")
            && labels[1].getAttribute("aria-expanded") === "true"
            && labels[0].getAttribute("aria-expanded") === "false"
            && document.querySelectorAll(".wz-chart-milestone.is-active").length === 2;
        labels[1].click();
        const off = tip.classList.contains("hidden")
            && document.querySelectorAll(".wz-chart-milestone.is-active").length === 0;
        return first && second && off;
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
        const zus = ResultsCharts.annotationsFor(input, projection)
            .find((annotation) => annotation.kind === "zus");
        return Boolean(zus)
            && zus.age === 65
            && zus.text.includes("65")
            && !zus.text.includes("40 r.ż.");
    });
    check("adnotacja zobowiązania po FIRE zależy od trybu", () => {
        const input = {
            stages: [
                { stage_type: "realizacja", start_age: 55, end_age: 65, accounts: { broker: {} } },
            ],
            obligations: [
                { name: "Kredyt", monthly: 2000, start_age: 55, end_age: 60, redirect_to_savings: true },
            ],
        };
        const projection = {
            chart: { ages: Array.from({ length: 61 }, (_, index) => 40 + index) },
            early_return_total: 0,
        };
        const wizard = ResultsCharts.annotationsFor(input, projection, "wizard")
            .find((item) => item.kind === "obligation");
        const simulator = ResultsCharts.annotationsFor(input, projection, "simulator")
            .find((item) => item.kind === "obligation");
        return Boolean(wizard && simulator)
            && wizard.text.includes("wraca do poziomu budżetu")
            && !wizard.text.includes("Uwalnia")
            && simulator.text.includes("nie spada automatycznie")
            && !simulator.text.includes("pozostaje na poziomie celu");
    });
    check("adnotacja zobowiązania na FIRE nie obiecuje spadku wypłaty", () => {
        const input = {
            stages: [
                { stage_type: "realizacja", start_age: 55, end_age: 65, accounts: { broker: {} } },
            ],
            obligations: [
                { name: "Kredyt", monthly: 2000, start_age: 55, end_age: 55, redirect_to_savings: true },
            ],
        };
        const projection = {
            chart: { ages: Array.from({ length: 61 }, (_, index) => 40 + index) },
            early_return_total: 0,
        };
        const annotation = ResultsCharts.annotationsFor(input, projection, "wizard")
            .find((item) => item.kind === "obligation");
        return Boolean(annotation)
            && annotation.text.includes("To wiek FIRE")
            && !annotation.text.includes("Uwalnia");
    });
    check("wynik: wykresy wypłat i kapitału renderują się", () => {
        return Boolean(document.querySelector("#wzWithdrawalsChart svg"))
            && Boolean(document.querySelector("#wzCapitalChart svg"))
            && document.querySelectorAll("#wzWithdrawalsLegend .wz-chart-legend-item").length > 0
            && document.querySelectorAll("#wzCapitalLegend .wz-chart-legend-item").length > 0;
    });
    check("wynik: wykresy mają czytelne etykiety osi Y", () => {
        const axisLabels = (id) => [...document.querySelectorAll("#" + id + " .wz-chart-axis-y")]
            .map((el) => el.textContent);
        const withdrawals = axisLabels("wzWithdrawalsChart");
        const capital = axisLabels("wzCapitalChart");
        return withdrawals.length > 0
            && new Set(withdrawals).size === withdrawals.length
            && !withdrawals.some((label) => label.includes("tys."))
            && capital.length > 0
            && new Set(capital).size === capital.length
            && document.querySelector("#wzCapitalChart .wz-chart-unit")
                ?.textContent.includes("tys. zł");
    });
    check("wynik: wykresy pokazują kluczowe wartości", () => {
        const capitalLabel = document.querySelector("#wzCapitalChart .wz-chart-reference-label");
        const peakDot = document.querySelector("#wzCapitalChart .wz-chart-reference-dot");
        const refs = ResultsCharts.references({
            kind: "withdrawals",
            ages: [40, 41],
            totals: [5000, 6000],
            references: { avgMonthly: 5500, minMonthly: 5000 },
        });
        return Boolean(capitalLabel)
            && capitalLabel.textContent.includes("szczyt")
            && Boolean(peakDot)
            && refs.some((ref) => ref.key === "avg")
            && refs.some((ref) => ref.key === "min");
    });
    check("wykres: prawdziwe zero portfela nie jest traktowane jak brak danych", () => {
        const values = ResultsCharts.referenceValues(
            { avg_monthly_portfolio: 0, min_monthly_portfolio: 0 },
            { peak_wealth: 0 }
        );
        const refs = ResultsCharts.references({
            kind: "withdrawals",
            ages: [40, 41],
            totals: [0, 0],
            references: values,
        });
        return values.minMonthly === 0
            && values.avgMonthly === 0
            && refs.some((ref) => ref.key === "min" && ref.value === 0);
    });
    check("wynik: dlaczego ten plan?", () => {
        ResultsSummary.renderWhy(document.getElementById("wzPlanWhy"), wzPlanWhyHtml({
            optimization: {
                objective: "total",
                baseline: { total_withdrawn: 1000000 },
                recommended: {
                    zus_start_age: 67,
                    allocations: { ike: 30, ikze: 20, broker: 50 },
                    total_withdrawn: 1015000,
                    payout_monthly: 4800,
                },
            },
        }));
        const box = document.getElementById("wzPlanWhy");
        return Boolean(box)
            && !box.classList.contains("hidden")
            && box.textContent.includes("ZUS od 67")
            && box.textContent.includes("Dlaczego ten plan?");
    });
    check("przekierowanie: Coast liczy akumulację do pełnego FIRE, Barista do części etatu", () => {
        const list = document.getElementById("wzObligationsList");
        const row = document.createElement("div");
        row.className = "obligation-row";
        row.innerHTML = '<input class="obligation-end" value="50">'
            + '<div class="obligation-redirect"><p class="obligation-redirect-hint"></p></div>'
            + '<p class="obligation-redirect-note hidden"></p>';
        list.appendChild(row);
        document.getElementById("wzSemiAge").value = "45";
        document.getElementById("wzRe").value = "55";
        const style = (value) => {
            const input = document.querySelector('input[name="wzFireStyle"][value="' + value + '"]');
            input.checked = true;
            wzSyncObligationRedirects();
            return !row.querySelector(".obligation-redirect").classList.contains("hidden");
        };
        const coastVisible = style("coast");
        const baristaVisible = style("barista");
        document.querySelector('input[name="wzFireStyle"][value="full"]').checked = true;
        row.remove();
        return coastVisible && !baristaVisible;
    });
    check("cache: stara wersja planu jest odrzucana", () => {
        localStorage.removeItem("fire.wizardState");
        localStorage.setItem("fire.wizardPlan", JSON.stringify({
            version: WZ_PLAN_VERSION - 1,
            plan: wzPlan,
            path: 1,
            selectedScenario: "realne",
        }));
        window.history.replaceState({}, "", "/wizard?restore=1");
        return wzRestoreIfRequested() === false;
    });
    check("restore: ?restore=1 odtwarza krok wyniku z zapisanego planu", () => {
        localStorage.removeItem("fire.wizardState");
        localStorage.setItem("fire.wizardPlan", JSON.stringify({
            version: WZ_PLAN_VERSION,
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
