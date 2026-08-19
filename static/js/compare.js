const COLORS = ["#00cec9", "#6c5ce7", "#e17055", "#00b894", "#f1c40f"];
const GRID_COLOR = "rgba(255,255,255,0.06)";
const TEXT_DIM = "#636e72";

function $(id) { return document.getElementById(id); }
function show(id, on) { $(id).classList.toggle("hidden", !on); }

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
}

function fmtMoney(v) {
    if (v == null) return "—";
    return Math.round(v).toLocaleString("pl-PL") + " zł";
}

function fmtPct(v) {
    if (v == null) return "—";
    return v.toFixed(1) + "%";
}

/* ── data helpers ─────────────────────────────────────────────── */

function avgMonthly(sim) {
    const yrs = sim.result.years || [];
    const n = yrs.filter(y => y.annual_withdrawal > 0).length;
    return n ? sim.result.total_withdrawn / 12 / n : null;
}

function taxEfficiency(sim) {
    const { total_withdrawn: w, total_tax: t } = sim.result;
    return (w + t) > 0 ? (w / (w + t)) * 100 : null;
}

function roiMultiple(sim) {
    const contrib = sim.summary.total_user_contributions || 0;
    const initCap = sim.summary.initial_capital || 0;
    const totalInvested = initCap + contrib;
    if (totalInvested <= 0) return null;
    return sim.result.total_withdrawn / totalInvested;
}

function valueAt(sim, age) {
    const yrs = sim.result.years || [];
    const exact = yrs.find(y => y.age === age);
    if (exact) return { age, wealth: exact.total_wealth, monthly: exact.monthly_withdrawal, tax: exact.tax_paid };
    let best = null, bestD = Infinity;
    for (const y of yrs) {
        const d = Math.abs(y.age - age);
        if (d < bestD) { bestD = d; best = y; }
    }
    return best ? { age: best.age, wealth: best.total_wealth, monthly: best.monthly_withdrawal, tax: best.tax_paid } : null;
}

/* ── Chart.js defaults for dark theme ─────────────────────────── */

function chartDefaults() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: "#1a1d2e",
                borderColor: "rgba(255,255,255,0.1)",
                borderWidth: 1,
                titleColor: "#dfe6e9",
                bodyColor: "#b2bec3",
                bodySpacing: 4,
                padding: 10,
                cornerRadius: 8,
                titleFont: { weight: "600" },
            },
        },
        scales: {
            x: {
                grid: { color: GRID_COLOR },
                ticks: { color: TEXT_DIM, font: { size: 11 } },
                title: { display: true, text: "Wiek (r.ż.)", color: TEXT_DIM, font: { size: 12 } },
            },
            y: {
                grid: { color: GRID_COLOR },
                ticks: { color: TEXT_DIM, font: { size: 11 } },
            },
        },
    };
}

/* ── load ─────────────────────────────────────────────────────── */

async function loadCompare() {
    const ids = new URLSearchParams(location.search).get("ids");
    if (!ids) { showError("Brak wybranych symulacji w adresie."); return; }
    try {
        const res = await fetch("/api/compare?ids=" + encodeURIComponent(ids));
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Błąd serwera");
        render(data);
    } catch (e) { showError(e.message); }
}

function showError(msg) {
    const el = $("errorMsg");
    el.textContent = "! " + msg;
    show("errorMsg", true);
}

/* ── orchestrator ─────────────────────────────────────────────── */

let wealthChartInst = null;
let withdrawalChartInst = null;

function render(sims) {
    if (!sims.length) return;
    renderCards(sims);
    renderMetricsTable(sims);
    renderWealthChart(sims);
    renderWithdrawalChart(sims);
    renderStageComparison(sims);
    renderMilestones(sims);
}

/* ── Section 2: Simulation cards (home-page style) ────────────── */

function renderCards(sims) {
    const el = $("cardsSection");
    el.innerHTML = "";

    sims.forEach((s, i) => {
        const c = COLORS[i % COLORS.length];
        const sum = s.summary || {};
        const stages = sum.stages || [];
        const mult = roiMultiple(s);

        const card = document.createElement("div");
        card.className = "sim-card cmp-color-card";
        card.style.borderColor = c;

        /* --- header --- */
        let headHtml = `
            <div class="sim-card-head">
                <div class="cmp-color-dot" style="background:${c}"></div>
                <div class="sim-card-title">
                    <h3>${escapeHtml(s.name)}</h3>
                    <span class="sim-card-date">${mult != null ? `×${mult.toFixed(1)} mnożnik` : ""}</span>
                </div>
            </div>`;

        /* --- metrics (same 5-column grid as home page) --- */
        let metricsHtml = `<div class="sim-card-metrics">
            <div class="sim-metric"><span class="sim-metric-value purple">${fmtMoney(sum.initial_capital)}</span><span class="sim-metric-label">Kapitał początkowy</span></div>
            <div class="sim-metric"><span class="sim-metric-value primary">${fmtMoney(sum.total_user_contributions)}</span><span class="sim-metric-label">Wpłaty własne</span></div>
            <div class="sim-metric"><span class="sim-metric-value green">${fmtMoney(sum.peak_wealth)}</span><span class="sim-metric-label">Szczyt</span></div>
            <div class="sim-metric"><span class="sim-metric-value">${fmtMoney(sum.final_wealth)}</span><span class="sim-metric-label">Na koniec</span></div>
            <div class="sim-metric"><span class="sim-metric-value accent">${fmtMoney(sum.total_withdrawn)}</span><span class="sim-metric-label">Wypłaty netto</span></div>
            <div class="sim-metric"><span class="sim-metric-value red">${fmtMoney(sum.total_tax)}</span><span class="sim-metric-label">Podatki</span></div>
        </div>`;

        /* --- info line --- */
        let infoParts = [];
        if (sum.start_age != null && sum.end_age != null)
            infoParts.push(`${sum.start_age}→${sum.end_age} r.ż.`);
        if (sum.years) infoParts.push(`${sum.years} lat`);
        if (sum.accounts && sum.accounts.length)
            infoParts.push(`${sum.accounts.length} kont`);
        if (sum.has_pension) infoParts.push("emerytura ZUS");
        let infoHtml = "";
        if (infoParts.length || sum.warnings) {
            infoHtml = `<div class="sim-card-info"><span>${infoParts.join(" · ")}</span>`;
            if (sum.warnings) infoHtml += `<span class="warn">⚠ ${sum.warnings} ostrzeż.</span>`;
            infoHtml += `</div>`;
        }

        /* --- stages timeline (same as home page) --- */
        let stagesHtml = "";
        if (stages.length > 0) {
            stagesHtml = `<div class="sim-card-stages"><div class="sim-timeline">`;
            stages.forEach((st) => {
                const kind = /akumulacja/i.test(st.label) ? "accum" : "withdraw";
                const accounts = (st.accounts || [])
                    .map(a => `<span class="sim-acc-pill">${escapeHtml(a)}</span>`)
                    .join("");
                let financeHtml = "";
                if (st.monthly_contribution) {
                    financeHtml = `<span class="sim-timeline-finance accum">~${fmtMoney(st.monthly_contribution)}/mies.</span>`;
                } else if (st.avg_monthly_withdrawal) {
                    financeHtml = `<span class="sim-timeline-finance withdraw">~${fmtMoney(st.avg_monthly_withdrawal)}/mies.</span>`;
                }
                stagesHtml += `
                    <div class="sim-timeline-row">
                        <div class="sim-timeline-marker">
                            <div class="sim-timeline-dot ${kind === "withdraw" ? "realizacja" : ""}"></div>
                            <div class="sim-timeline-line"></div>
                        </div>
                        <div class="sim-timeline-body">
                            <span class="sim-timeline-label ${kind}">${escapeHtml(st.label)}</span>
                            <span class="sim-timeline-age">${st.start_age}→${st.end_age} r.ż.</span>
                            ${accounts}
                            ${financeHtml}
                        </div>
                    </div>`;
            });
            stagesHtml += `</div></div>`;
        }

        card.innerHTML = headHtml + metricsHtml + infoHtml + stagesHtml;
        el.appendChild(card);
    });
    show("cardsSection", true);
}

/* ── Section 3: Metrics comparison table ───────────────────────── */

const METRIC_GROUPS = [
    { label: "Majątek", metrics: [
        { key: "peak_wealth", label: "Szczytowy", money: true, better: "max",
          hint: "Najwyższy łączny stan kont w trakcie symulacji." },
        { key: "final_wealth", label: "Końcowy", money: true, better: "max",
          hint: "Majątek na koniec symulacji (po wszystkich wypłatach i podatkach)." },
    ]},
    { label: "Wypłaty", metrics: [
        { key: "total_withdrawn", label: "Suma netto", money: true, better: "max",
          hint: "Łączna kwota wypłacona netto (po podatku) ze wszystkich kont." },
        { key: "avg_monthly", label: "Średnia mies.", money: true, better: "max",
          hint: "Średnia miesięczna wypłata netto w latach, gdy były jakiekolwiek wypłaty." },
    ]},
    { label: "Podatki", metrics: [
        { key: "total_tax", label: "Suma podatków", money: true, better: "min",
          hint: "Łączna kwota zapłaconych podatków od wypłat." },
        { key: "tax_eff", label: "Efektywność", pct: true, better: "max",
          hint: "Udział wypłat netto w sumie wypłat brutto (netto + podatek). Im wyższy, tym mniej podatku." },
    ]},
    { label: "Inne", metrics: [
        { key: "initial_capital", label: "Kapitał początkowy", money: true, better: "max",
          hint: "Suma sald startowych wszystkich kont (pierwsze wystąpienie chronologicznie)." },
        { key: "total_user_contributions", label: "Wpłaty własne", money: true, better: "max",
          hint: "Suma wpłat własnych (roczne + PPK pracownicze) przez cały okres symulacji." },
        { key: "roi_mult", label: "Mnożnik", mult: true, better: "max",
          hint: "Ile razy suma wypłat netto przewyższa łączne zainwestowane środki (kapitał początkowy + wpłaty własne)." },
        { key: "years", label: "Lata symulacji", money: false, better: "max",
          hint: "Liczba lat objętych symulacją." },
        { key: "warnings", label: "Ostrzeżenia", money: false, better: "min",
          hint: "Liczba ostrzeżeń wygenerowanych podczas symulacji." },
    ]},
];

function metricValue(s, m) {
    if (m.key === "avg_monthly") return avgMonthly(s);
    if (m.key === "tax_eff") return taxEfficiency(s);
    if (m.key === "roi_mult") return roiMultiple(s);
    return s.summary[m.key];
}

function renderMetricsTable(sims) {
    const thead = document.querySelector("#metricsTable thead tr");
    const tbody = document.querySelector("#metricsTable tbody");
    thead.innerHTML = "<th class='col-name'>Wskaźnik</th>" + sims.map(s => `<th>${escapeHtml(s.name)}</th>`).join("");
    tbody.innerHTML = "";

    const best = {};
    METRIC_GROUPS.forEach(g => g.metrics.forEach(m => {
        if (!m.better) return;
        const vals = sims.map(s => metricValue(s, m)).filter(v => v != null);
        if (!vals.length) return;
        best[m.key] = m.better === "max" ? Math.max(...vals) : Math.min(...vals);
    }));

    METRIC_GROUPS.forEach(g => {
        const grpTr = document.createElement("tr");
        grpTr.className = "cmp-metrics-group";
        grpTr.innerHTML = `<td class="col-name" colspan="${sims.length + 1}">${g.label}</td>`;
        tbody.appendChild(grpTr);

        g.metrics.forEach(m => {
            const tr = document.createElement("tr");
            const tip = m.hint ? ` <span class="tip" tabindex="0">?<span class="tooltip">${escapeHtml(m.hint)}</span></span>` : "";
            let html = `<td class="col-name">${m.label}${tip}</td>`;
            sims.forEach(s => {
                const v = metricValue(s, m);
                if (v == null) { html += `<td class="amount">—</td>`; return; }
                let txt;
                if (m.pct) txt = fmtPct(v);
                else if (m.mult) txt = "×" + v.toFixed(1);
                else if (m.money) txt = fmtMoney(v);
                else txt = v;
                const isBest = m.better && v === best[m.key] && sims.length > 1;
                html += `<td class="amount ${isBest ? "best" : ""}">${txt}</td>`;
            });
            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    });
    show("metricsSection", true);
}

/* ── Section 4: Wealth chart (Chart.js) ───────────────────────── */

function renderWealthChart(sims) {
    const allYears = sims.map(s => s.result.years || []);
    if (!allYears.some(y => y.length)) return;
    const all = allYears.flat();
    const minAge = Math.min(...all.map(y => y.age));
    const maxAge = Math.max(...all.map(y => y.age));

    const ageLabels = [];
    for (let a = minAge; a <= maxAge; a++) ageLabels.push(a);

    const datasets = sims.map((s, i) => {
        const yrs = s.result.years || [];
        const byAge = {};
        yrs.forEach(y => { byAge[y.age] = y.total_wealth; });
        return {
            label: s.name,
            data: ageLabels.map(a => byAge[a] != null ? Math.round(byAge[a]) : null),
            borderColor: COLORS[i % COLORS.length],
            backgroundColor: COLORS[i % COLORS.length] + "14",
            fill: true,
            tension: 0.3,
            pointRadius: 1.5,
            pointHoverRadius: 5,
            borderWidth: 2.5,
            spanGaps: false,
        };
    });

    const cfg = {
        type: "line",
        data: { labels: ageLabels, datasets },
        options: {
            ...chartDefaults(),
            plugins: {
                ...chartDefaults().plugins,
                tooltip: {
                    ...chartDefaults().plugins.tooltip,
                    callbacks: {
                        title: (items) => items[0].label + " r.ż.",
                        label: (item) => " " + item.dataset.label + ": " + fmtMoney(item.parsed.y),
                    },
                },
            },
            scales: {
                ...chartDefaults().scales,
                y: {
                    ...chartDefaults().scales.y,
                    ticks: {
                        ...chartDefaults().scales.y.ticks,
                        callback: (v) => {
                            if (v >= 1000000) return (v / 1000000).toFixed(1) + "M";
                            if (v >= 1000) return (v / 1000).toFixed(0) + "k";
                            return v;
                        },
                    },
                },
            },
        },
    };

    if (wealthChartInst) wealthChartInst.destroy();
    wealthChartInst = new Chart($("wealthChart"), cfg);
    show("chartSection", true);
}

/* ── Section 5: Withdrawal chart (Chart.js) ───────────────────── */

function renderWithdrawalChart(sims) {
    const allYears = sims.map(s => s.result.years || []);
    const hasWithdrawals = allYears.some(y => y.some(yr => yr.monthly_withdrawal > 0));
    if (!hasWithdrawals) { show("withdrawalSection", false); return; }
    const all = allYears.flat();
    const minAge = Math.min(...all.map(y => y.age));
    const maxAge = Math.max(...all.map(y => y.age));

    const ageLabels = [];
    for (let a = minAge; a <= maxAge; a++) ageLabels.push(a);

    const datasets = sims.map((s, i) => {
        const yrs = s.result.years || [];
        const byAge = {};
        yrs.forEach(y => { byAge[y.age] = y.monthly_withdrawal; });
        return {
            label: s.name,
            data: ageLabels.map(a => byAge[a] != null && byAge[a] > 0 ? Math.round(byAge[a]) : null),
            borderColor: COLORS[i % COLORS.length],
            backgroundColor: COLORS[i % COLORS.length] + "10",
            fill: true,
            tension: 0.3,
            pointRadius: 1.5,
            pointHoverRadius: 5,
            borderWidth: 2.5,
            spanGaps: false,
        };
    });

    const cfg = {
        type: "line",
        data: { labels: ageLabels, datasets },
        options: {
            ...chartDefaults(),
            plugins: {
                ...chartDefaults().plugins,
                tooltip: {
                    ...chartDefaults().plugins.tooltip,
                    callbacks: {
                        title: (items) => items[0].label + " r.ż.",
                        label: (item) => " " + item.dataset.label + ": " + fmtMoney(item.parsed.y) + "/mies.",
                    },
                },
            },
            scales: {
                ...chartDefaults().scales,
                y: {
                    ...chartDefaults().scales.y,
                    beginAtZero: true,
                    ticks: {
                        ...chartDefaults().scales.y.ticks,
                        callback: (v) => fmtMoney(v),
                    },
                },
            },
        },
    };

    if (withdrawalChartInst) withdrawalChartInst.destroy();
    withdrawalChartInst = new Chart($("withdrawalChart"), cfg);
    show("withdrawalSection", true);
}

/* ── Section 6: Stage structure Gantt chart ───────────────────── */

function renderStageComparison(sims) {
    const container = $("ganttContainer");
    container.innerHTML = "";

    let globalMin = Infinity, globalMax = -Infinity;
    sims.forEach(s => {
        const stages = (s.summary.stages || []);
        stages.forEach(st => {
            if (st.start_age < globalMin) globalMin = st.start_age;
            if (st.end_age > globalMax) globalMax = st.end_age;
        });
    });
    if (globalMin === Infinity) { show("stagesSection", false); return; }

    const range = globalMax - globalMin || 1;
    const inner = document.createElement("div");
    inner.className = "cmp-gantt-inner";

    sims.forEach((s, i) => {
        const c = COLORS[i % COLORS.length];
        const stages = s.summary.stages || [];
        const row = document.createElement("div");
        row.className = "cmp-gantt-row";

        const label = document.createElement("div");
        label.className = "cmp-gantt-label";
        label.style.borderColor = c;
        label.textContent = s.name;

        const track = document.createElement("div");
        track.className = "cmp-gantt-track";

        stages.forEach(st => {
            const kind = /akumulacja/i.test(st.label) ? "accum" : "withdraw";
            const left = ((st.start_age - globalMin) / range) * 100;
            const width = ((st.end_age - st.start_age) / range) * 100;

            const seg = document.createElement("div");
            seg.className = `cmp-gantt-segment ${kind}`;
            seg.style.left = left + "%";
            seg.style.width = Math.max(width, 0.5) + "%";
            seg.title = `${st.label}: ${st.start_age}→${st.end_age} r.ż.`;
            if (width > 5) seg.textContent = st.label;
            track.appendChild(seg);

            const pills = document.createElement("div");
            pills.className = "cmp-gantt-pills";
            pills.style.left = left + "%";
            pills.style.width = width + "%";
            (st.accounts || []).forEach(a => {
                const pill = document.createElement("span");
                pill.className = "cmp-pill";
                pill.textContent = a;
                pills.appendChild(pill);
            });
            track.appendChild(pills);
        });

        row.appendChild(label);
        row.appendChild(track);
        inner.appendChild(row);
    });

    const axis = document.createElement("div");
    axis.className = "cmp-gantt-row";
    axis.innerHTML = `<div></div>`;
    const ageTrack = document.createElement("div");
    ageTrack.className = "cmp-gantt-age-axis";
    const step = range <= 20 ? 1 : range <= 40 ? 5 : 10;
    const ticks = [];
    for (let a = Math.ceil(globalMin / step) * step; a <= globalMax; a += step) ticks.push(a);
    if (!ticks.includes(globalMax)) ticks.push(globalMax);
    ageTrack.style.gridTemplateColumns = `repeat(${ticks.length}, 1fr)`;
    ticks.forEach(a => {
        const lbl = document.createElement("span");
        lbl.className = "cmp-gantt-age-label";
        lbl.textContent = a + " r.ż.";
        ageTrack.appendChild(lbl);
    });
    axis.appendChild(ageTrack);
    inner.appendChild(axis);

    container.appendChild(inner);
    show("stagesSection", true);
}

/* ── Section 7: Milestones table ──────────────────────────────── */

function renderMilestones(sims) {
    const all = sims.map(s => s.result.years || []).flat();
    if (!all.length) return;
    const minAge = Math.min(...all.map(y => y.age));
    const maxAge = Math.max(...all.map(y => y.age));
    const fixed = [minAge, 55, 60, 65, 70, maxAge];
    const milestones = [...new Set(fixed)].filter(a => a >= minAge && a <= maxAge).sort((a, b) => a - b);

    const tip = (text) => ` <span class="tip" tabindex="0">?<span class="tooltip">${escapeHtml(text)}</span></span>`;
    const thead = document.querySelector("#milestonesTable thead");
    thead.innerHTML = "";
    const headRow1 = document.createElement("tr");
    headRow1.innerHTML = "<th rowspan='2'>Wiek</th>" + sims.map(s => `<th colspan="3">${escapeHtml(s.name)}</th>`).join("");
    thead.appendChild(headRow1);
    const headRow2 = document.createElement("tr");
    headRow2.innerHTML = sims.map(() =>
        `<th class="cmp-col-sub">Majątek${tip("Łączna wartość wszystkich kont.")}</th>` +
        `<th class="cmp-col-sub">Wypłata mies.${tip("Miesięczna wypłata netto (po podatku).")}</th>` +
        `<th class="cmp-col-sub">Podatek${tip("Suma podatków zapłaconych w danym roku.")}</th>`
    ).join("");
    thead.appendChild(headRow2);
    const tbody = document.querySelector("#milestonesTable tbody");
    tbody.innerHTML = "";

    milestones.forEach(age => {
        const cells = sims.map(s => valueAt(s, age));
        const bestW = Math.max(...cells.map(c => c ? c.wealth : -Infinity));
        const bestM = Math.max(...cells.map(c => c ? c.monthly : -Infinity));
        const ageLabel = age === maxAge ? maxAge + " (koniec)" : age;

        const tr = document.createElement("tr");
        let html = `<td><strong>${ageLabel}</strong></td>`;
        cells.forEach(c => {
            if (!c) { html += `<td class="amount">—</td><td class="amount">—</td><td class="amount">—</td>`; return; }
            const approx = c.age !== age ? ` <span class="dim">~${c.age}</span>` : "";
            const wBest = c.wealth === bestW && sims.length > 1;
            const mBest = c.monthly > 0 && c.monthly === bestM && sims.length > 1;
            html += `<td class="amount ${wBest ? "best" : ""}">${fmtMoney(c.wealth)}${approx}</td>`;
            html += `<td class="amount ${mBest ? "best" : ""}">${fmtMoney(c.monthly)}${approx}</td>`;
            html += `<td class="amount">${fmtMoney(c.tax)}</td>`;
        });
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
    show("milestonesSection", true);
}

/* ── init ─────────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", loadCompare);
