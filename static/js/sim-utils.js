// sim-utils.js — Pure utility functions

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function tipHtml(text, url, icon = "?") {
    const link = url
        ? ` <a href="${url}" target="_blank" rel="noopener">Więcej…</a>`
        : "";
    return ` <span class="tip" tabindex="0">${icon}<span class="tooltip">${escapeHtml(text)}${link}</span></span>`;
}

function formatMoney(val) {
    if (val === 0) return "—";
    return val.toLocaleString("pl-PL", { maximumFractionDigits: 0 }) + " zł";
}

function countDecimals(value) {
    const s = String(value);
    const dot = s.indexOf(".");
    if (dot === -1) return 0;
    return s.length - dot - 1;
}

function stepInputValue(input, dir) {
    let step = parseFloat(input.step);
    if (!Number.isFinite(step) || step <= 0) step = 1;
    const min = input.min === "" ? null : parseFloat(input.min);
    const max = input.max === "" ? null : parseFloat(input.max);
    let val = (parseFloat(input.value) || 0) + dir * step;
    if (min !== null && Number.isFinite(min) && val < min) val = min;
    if (max !== null && Number.isFinite(max) && val > max) val = max;
    const places = Math.max(countDecimals(input.value), countDecimals(step));
    input.value = places > 0 ? val.toFixed(places) : String(Math.round(val));
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function computeTotalUserContributions(input) {
    if (!input || !input.stages) return 0;
    let total = 0;
    for (const stage of input.stages) {
        const years = Math.max(0, (stage.end_age || 0) - (stage.start_age || 0));
        if (years <= 0) continue;
        for (const [name, cfg] of Object.entries(stage.accounts || {})) {
            if (name === "gotowka" || name === "lokata" || name === "zus") continue;
            if (name === "ppk") {
                total += (cfg.employee_pct || 0) * (cfg.monthly_base || 0) * years * 12;
            } else {
                total += (cfg.annual_contribution || 0) * years;
            }
        }
    }
    return total;
}

function _accountMonthly(name, cfg) {
    if (name === "gotowka" || name === "lokata" || name === "zus") return 0;
    if (name === "ppk") return (cfg.employee_pct || 0) * (cfg.monthly_base || 0);
    return (cfg.annual_contribution || 0) / 12;
}

function computeStageSummaries(input, result) {
    if (!input || !input.stages || !result || !result.years) return [];
    const yearsByAge = {};
    for (const y of result.years) yearsByAge[y.age] = y;

    return input.stages.map((stage) => {
        const isAccum = stage.stage_type === "akumulacja";
        const duration = Math.max(0, (stage.end_age || 0) - (stage.start_age || 0));
        const endAge = Math.max(stage.start_age || 0, (stage.end_age || 1) - 1);

        // Per-account info from input config
        const accounts = Object.entries(stage.accounts || {})
            .map(([key, cfg]) => {
                const monthly = _accountMonthly(key, cfg);
                const bal = yearsByAge[endAge]?.balances?.[key] || 0;
                return { key, monthly: Math.round(monthly), balance: Math.round(bal) };
            })
            .filter((a) => a.balance > 0 || a.monthly > 0);

        // Result metrics from years in this age range
        const stageYears = [];
        for (let age = stage.start_age; age < endAge; age++) {
            if (yearsByAge[age]) stageYears.push(yearsByAge[age]);
        }

        let totalMonthly = 0;
        let avgWithdrawal = 0;
        let totalWithdrawn = 0;
        let totalTax = 0;

        if (isAccum) {
            totalMonthly = accounts.reduce((s, a) => s + a.monthly, 0);
        } else if (stageYears.length > 0) {
            const withWithdrawal = stageYears.filter((y) => y.monthly_withdrawal > 0);
            if (withWithdrawal.length > 0) {
                avgWithdrawal = Math.round(
                    withWithdrawal.reduce((s, y) => s + y.monthly_withdrawal, 0) / withWithdrawal.length
                );
            }
            totalWithdrawn = Math.round(stageYears.reduce((s, y) => s + y.annual_withdrawal, 0));
            totalTax = Math.round(stageYears.reduce((s, y) => s + y.tax_paid, 0));
        }

        const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

        return {
            type: stage.stage_type,
            label: isAccum ? "Akumulacja" : "Realizacja",
            start_age: stage.start_age,
            end_age: stage.end_age,
            duration,
            accounts,
            total_monthly: Math.round(totalMonthly),
            avg_withdrawal: avgWithdrawal,
            total_withdrawn: totalWithdrawn,
            total_tax: totalTax,
            total_balance: Math.round(totalBalance),
        };
    });
}
