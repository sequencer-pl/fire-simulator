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

function resolveBase(cfg, monthlyGross) {
    if (cfg.base_override_enabled) return cfg.monthly_base || 0;
    return monthlyGross || 0;
}

function computeTotalUserContributions(input) {
    if (!input || !input.stages) return 0;
    const monthlyGross = input.monthly_gross || 0;
    let total = 0;
    for (const stage of input.stages) {
        const years = Math.max(0, (stage.end_age || 0) - (stage.start_age || 0));
        if (years <= 0) continue;
        for (const [name, cfg] of Object.entries(stage.accounts || {})) {
            if (name === "gotowka" || name === "lokata" || name === "zus") continue;
            if (name === "ppk") {
                total += (cfg.employee_pct || 0) * resolveBase(cfg, monthlyGross) * years * 12;
            } else {
                total += (cfg.annual_contribution || 0) * years;
            }
        }
    }
    return total;
}

function computeInitialCapital(input) {
    if (!input || !input.stages) return 0;
    const seen = new Set();
    let total = 0;
    const sorted = [...input.stages].sort((a, b) => (a.start_age || 0) - (b.start_age || 0));
    for (const stage of sorted) {
        for (const [name, cfg] of Object.entries(stage.accounts || {})) {
            if (!seen.has(name) && (cfg.starting_balance || 0) > 0) {
                total += cfg.starting_balance;
                seen.add(name);
            }
        }
    }
    return total;
}

function _accountMonthly(name, cfg, monthlyGross) {
    if (name === "gotowka" || name === "lokata" || name === "zus") return 0;
    if (name === "ppk") return (cfg.employee_pct || 0) * resolveBase(cfg, monthlyGross);
    return (cfg.annual_contribution || 0) / 12;
}

function computeStageSummaries(input, result) {
    if (!input || !input.stages || !result || !result.years) return [];
    const yearsByAge = {};
    for (const y of result.years) yearsByAge[y.age] = y;

    // Collect unique age boundaries
    const bounds = new Set();
    for (const s of input.stages) {
        bounds.add(s.start_age);
        bounds.add(s.end_age);
    }
    const sorted = [...bounds].sort((a, b) => a - b);

    const segments = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (a >= b) continue;

        // Stages active for this entire segment
        const active = input.stages.filter((s) => s.start_age <= a && s.end_age >= b);
        if (active.length === 0) continue;

        const isAccum = active[0].stage_type === "akumulacja";

        // Merge accounts from all active stages (dedup by key)
        const accountMap = {};
        for (const stage of active) {
            for (const [key, cfg] of Object.entries(stage.accounts || {})) {
                accountMap[key] = cfg;
            }
        }

        const accounts = Object.entries(accountMap).map(([key, cfg]) => {
            const endAge = Math.min(b - 1, result.years[result.years.length - 1]?.age ?? b - 1);
            return {
                key,
                monthly: Math.round(_accountMonthly(key, cfg, input.monthly_gross || 0)),
                balance: Math.round(yearsByAge[endAge]?.balances?.[key] || 0),
            };
        });

        let totalMonthly = 0;
        let avgWithdrawal = 0;
        if (isAccum) {
            totalMonthly = accounts.reduce((s, a) => s + a.monthly, 0);
        } else {
            const yearsInRange = [];
            for (let age = a; age < b; age++) {
                if (yearsByAge[age]) yearsInRange.push(yearsByAge[age]);
            }
            const withW = yearsInRange.filter((y) => y.monthly_withdrawal > 0);
            if (withW.length > 0) {
                avgWithdrawal = Math.round(
                    withW.reduce((s, y) => s + y.monthly_withdrawal, 0) / withW.length
                );
            }
        }

        const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

        segments.push({
            type: isAccum ? "akumulacja" : "realizacja",
            label: isAccum ? "Akumulacja" : "Realizacja",
            start_age: a,
            end_age: b,
            duration: b - a,
            accounts,
            total_monthly: Math.round(totalMonthly),
            avg_withdrawal: avgWithdrawal,
            total_balance: Math.round(totalBalance),
        });
    }
    return segments;
}
