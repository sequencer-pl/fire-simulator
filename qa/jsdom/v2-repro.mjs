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
                stage_metrics: [
                    { name: "Akumulacja", start_age: 35, end_age: 55, monthly: 2000 },
                    { name: "Brydż", start_age: 55, end_age: 65, monthly: 5000 },
                ],
                phase_metrics: [],
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
            && document.querySelectorAll("#v2StageSummaryList .stage-line").length === 2;
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
