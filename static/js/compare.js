function $(id) {
    return document.getElementById(id);
}

function show(id, on) {
    $(id).classList.toggle("hidden", !on);
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
}

function fmtMoney(v) {
    if (v == null) return "—";
    return Math.round(v).toLocaleString("pl-PL") + " zł";
}

const METRICS = [
    { key: "peak_wealth", label: "Majątek szczytowy", money: true, better: "max" },
    { key: "final_wealth", label: "Majątek końcowy", money: true, better: "max" },
    { key: "total_withdrawn", label: "Suma wypłat", money: true, better: "max" },
    { key: "avg_monthly", label: "Średnia mies. wypłata", money: true, better: "max" },
    { key: "total_tax", label: "Suma podatków", money: true, better: "min" },
    { key: "years", label: "Lata symulacji", money: false, better: "max" },
    { key: "start_age", label: "Wiek startu", money: false, better: "min" },
    { key: "end_age", label: "Wiek końca", money: false, better: "max" },
    { key: "accounts", label: "Liczba kont", money: false, better: null },
    { key: "warnings", label: "Ostrzeżenia", money: false, better: "min" },
];

const COLORS = ["#00cec9", "#6c5ce7", "#e17055", "#00b894", "#f1c40f"];

function avgMonthly(sim) {
    const years = sim.result.years || [];
    const withWithdrawal = years.filter((y) => y.annual_withdrawal > 0).length;
    if (!withWithdrawal) return null;
    return sim.result.total_withdrawn / 12 / withWithdrawal;
}

function valueAt(sim, age) {
    const years = sim.result.years || [];
    const exact = years.find((y) => y.age === age);
    if (exact) return { age, wealth: exact.total_wealth, monthly: exact.monthly_withdrawal };
    let best = null;
    let bestDiff = Infinity;
    years.forEach((y) => {
        const d = Math.abs(y.age - age);
        if (d < bestDiff) {
            bestDiff = d;
            best = y;
        }
    });
    return best ? { age: best.age, wealth: best.total_wealth, monthly: best.monthly_withdrawal } : null;
}

async function loadCompare() {
    const params = new URLSearchParams(location.search);
    const ids = params.get("ids");
    if (!ids) {
        showError("Brak wybranych symulacji w adresie.");
        return;
    }
    try {
        const res = await fetch("/api/compare?ids=" + encodeURIComponent(ids));
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Błąd serwera");
        render(data);
    } catch (e) {
        showError(e.message);
    }
}

function showError(msg) {
    const el = $("errorMsg");
    el.textContent = "!" + " " + msg;
    show("errorMsg", true);
}

function render(sims) {
    if (!sims.length) return;
    $("compareSubtitle").textContent = sims.length + " symulacji" + (sims.length > 1 ? " — porównanie" : "");
    renderMetrics(sims);
    renderChart(sims);
    renderWithdrawalChart(sims);
    renderMilestones(sims);
}

function metricValue(s, m) {
    if (m.key === "avg_monthly") return avgMonthly(s);
    return s.summary[m.key];
}

function renderMetrics(sims) {
    const thead = document.querySelector("#metricsTable thead tr");
    const tbody = document.querySelector("#metricsTable tbody");
    thead.innerHTML = "<th class='col-name'>Symulacja</th>" + METRICS.map((m) => `<th>${m.label}</th>`).join("");
    tbody.innerHTML = "";

    const best = {};
    METRICS.forEach((m) => {
        if (!m.better) return;
        const vals = sims.map((s) => metricValue(s, m)).filter((v) => v != null);
        if (!vals.length) return;
        best[m.key] = m.better === "max" ? Math.max(...vals) : Math.min(...vals);
    });

    sims.forEach((s) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="col-name"><strong>${escapeHtml(s.name)}</strong></td>` +
            METRICS.map((m) => {
                const v = metricValue(s, m);
                if (v == null) return `<td class="amount">—</td>`;
                let txt = m.money ? fmtMoney(v) : v;
                const isBest = m.better && v === best[m.key];
                return `<td class="amount ${isBest ? "best" : ""}">${txt}</td>`;
            }).join("");
        tbody.appendChild(tr);
    });
    show("metricsSection", true);
}

function renderChart(sims) {
    const years = sims.map((s) => s.result.years || []);
    if (!years.some((y) => y.length)) return;
    const all = years.flat();
    const minAge = Math.min(...all.map((y) => y.age));
    const maxAge = Math.max(...all.map((y) => y.age));
    const maxWealth = Math.max(...all.map((y) => y.total_wealth));

    const W = 1000;
    const H = 340;
    const padX = 12;
    const padY = 24;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;

    const x = (age) => padX + ((age - minAge) / Math.max(1, maxAge - minAge)) * innerW;
    const y = (wealth) => H - padY - (wealth / Math.max(1, maxWealth)) * innerH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg">
        <g class="grid-lines">`;
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
        const gy = padY + (innerH * i) / steps;
        const val = maxWealth * (1 - i / steps);
        svg += `<line x1="${padX}" y1="${gy}" x2="${W - padX}" y2="${gy}"/>
                <text x="${padX}" y="${gy - 4}" class="axis-text">${Math.round(val / 1000)}k</text>`;
    }
    svg += "</g>";

    sims.forEach((s, i) => {
        const ys = s.result.years || [];
        if (!ys.length) return;
        const color = COLORS[i % COLORS.length];
        const points = ys.map((yr) => `${x(yr.age).toFixed(1)},${y(yr.total_wealth).toFixed(1)}`);
        svg += `<polyline class="chart-line" fill="none" stroke="${color}" points="${points.join(" ")}"/>`;
        ys.forEach((yr) => {
            svg += `<circle class="chart-dot" cx="${x(yr.age).toFixed(1)}" cy="${y(yr.total_wealth).toFixed(1)}" r="3" fill="${color}">
                <title>${escapeHtml(s.name)} · ${yr.age} r.ż. — ${fmtMoney(yr.total_wealth)}</title>
            </circle>`;
        });
    });

    svg += `<text x="${padX}" y="${H - 4}" class="axis-text">${minAge} r.ż.</text>
            <text x="${W - padX}" y="${H - 4}" text-anchor="end" class="axis-text">${maxAge} r.ż.</text>`;
    svg += "</svg>";

    const legend = sims.map((s, i) =>
        `<span class="legend-item"><i class="legend-dot" style="background:${COLORS[i % COLORS.length]}"></i>${escapeHtml(s.name)}</span>`
    ).join("");

    $("overlayChart").innerHTML = `<div class="chart-legend">${legend}</div>` + svg;
    show("chartSection", true);
}

function renderWithdrawalChart(sims) {
    const years = sims.map((s) => s.result.years || []);
    if (!years.some((y) => y.some((yr) => yr.monthly_withdrawal > 0))) {
        show("withdrawalSection", false);
        return;
    }
    const all = years.flat();
    const minAge = Math.min(...all.map((y) => y.age));
    const maxAge = Math.max(...all.map((y) => y.age));
    const maxMonthly = Math.max(...all.map((y) => y.monthly_withdrawal));

    const W = 1000;
    const H = 260;
    const padX = 12;
    const padY = 24;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;

    const x = (age) => padX + ((age - minAge) / Math.max(1, maxAge - minAge)) * innerW;
    const y = (monthly) => H - padY - (monthly / Math.max(1, maxMonthly)) * innerH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg">
        <g class="grid-lines">`;
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
        const gy = padY + (innerH * i) / steps;
        const val = maxMonthly * (1 - i / steps);
        svg += `<line x1="${padX}" y1="${gy}" x2="${W - padX}" y2="${gy}"/>
                <text x="${padX}" y="${gy - 4}" class="axis-text">${Math.round(val).toLocaleString("pl-PL")}</text>`;
    }
    svg += "</g>";

    sims.forEach((s, i) => {
        const ys = s.result.years || [];
        if (!ys.length) return;
        const color = COLORS[i % COLORS.length];
        const points = ys.map((yr) => `${x(yr.age).toFixed(1)},${y(yr.monthly_withdrawal).toFixed(1)}`);
        svg += `<polyline class="chart-line" fill="none" stroke="${color}" points="${points.join(" ")}"/>`;
        ys.forEach((yr) => {
            if (yr.monthly_withdrawal <= 0) return;
            svg += `<circle class="chart-dot" cx="${x(yr.age).toFixed(1)}" cy="${y(yr.monthly_withdrawal).toFixed(1)}" r="3" fill="${color}">
                <title>${escapeHtml(s.name)} · ${yr.age} r.ż. — ${fmtMoney(yr.monthly_withdrawal)}/mies.</title>
            </circle>`;
        });
    });

    svg += `<text x="${padX}" y="${H - 4}" class="axis-text">${minAge} r.ż.</text>
            <text x="${W - padX}" y="${H - 4}" text-anchor="end" class="axis-text">${maxAge} r.ż.</text>`;
    svg += "</svg>";

    const legend = sims.map((s, i) =>
        `<span class="legend-item"><i class="legend-dot" style="background:${COLORS[i % COLORS.length]}"></i>${escapeHtml(s.name)}</span>`
    ).join("");

    $("withdrawalChart").innerHTML = `<div class="chart-legend">${legend}</div>` + svg;
    show("withdrawalSection", true);
}

function renderMilestones(sims) {
    const all = sims.map((s) => s.result.years || []).flat();
    if (!all.length) return;
    const minAge = Math.min(...all.map((y) => y.age));
    const maxAge = Math.max(...all.map((y) => y.age));
    const fixed = [minAge, 55, 60, 65, 70, maxAge];
    const milestones = [...new Set(fixed)].filter((a) => a >= minAge && a <= maxAge).sort((a, b) => a - b);

    const thead = document.querySelector("#milestonesTable thead tr");
    const tbody = document.querySelector("#milestonesTable tbody");
    thead.innerHTML = "<th>Wiek</th>" + sims.map((s) => `<th colspan="2">${escapeHtml(s.name)}</th>`).join("");
    tbody.innerHTML = "";

    milestones.forEach((age) => {
        const tr = document.createElement("tr");
        const cells = sims.map((s) => valueAt(s, age));
        const bestWealth = Math.max(...cells.map((c) => (c ? c.wealth : -Infinity)));
        const bestMonthly = Math.max(...cells.map((c) => (c ? c.monthly : -Infinity)));
        const ageLabel = age === maxAge ? maxAge + " (koniec)" : age;
        tr.innerHTML = `<td><strong>${ageLabel}</strong></td>` +
            cells.map((c) => {
                if (!c) return `<td class="amount">—</td><td class="amount">—</td>`;
                const bestW = c.wealth === bestWealth;
                const bestM = c.monthly > 0 && c.monthly === bestMonthly;
                return `<td class="amount ${bestW ? "best" : ""}">${fmtMoney(c.wealth)}${c.age !== age ? ` <span class="dim">~${c.age}</span>` : ""}</td>` +
                    `<td class="amount ${bestM ? "best" : ""}">${fmtMoney(c.monthly)}${c.age !== age ? ` <span class="dim">~${c.age}</span>` : ""}</td>`;
            }).join("");
        tbody.appendChild(tr);
    });
    show("milestonesSection", true);
}

document.addEventListener("DOMContentLoaded", loadCompare);
