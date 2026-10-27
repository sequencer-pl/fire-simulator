// compare.js — porównanie 2–4 zapisanych symulacji (karty legendy, tabela, wykresy, gantt, kamienie milowe).
// $, show, escapeHtml, fmtMoney, iconSvg — wspólne helpery z base.html.

function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const SERIES = () => [1, 2, 3, 4, 5].map((i) => cssVar(`--series-${i}`));

function seriesColor(i) {
    const list = SERIES();
    return list[i % list.length];
}

function withAlpha(color, alpha) {
    return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
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
    const denom = w + t;
    if (denom <= 0) return null;
    return Math.min(100, (w / denom) * 100);
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

/* ── Chart.js — motyw z tokenów ───────────────────────────────── */

function chartDefaults() {
    const text3 = cssVar("--text-3");
    const border = cssVar("--border");
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: {
                display: true,
                position: "top",
                align: "end",
                labels: { color: cssVar("--text-2"), boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle", font: { size: 12 } },
            },
            tooltip: {
                backgroundColor: cssVar("--surface-hover"),
                borderColor: cssVar("--border-strong"),
                borderWidth: 1,
                titleColor: cssVar("--text"),
                bodyColor: cssVar("--text-2"),
                bodySpacing: 4,
                padding: 10,
                cornerRadius: 8,
                titleFont: { weight: "600" },
            },
        },
        scales: {
            x: {
                grid: { color: border },
                ticks: { color: text3, font: { size: 11 }, maxTicksLimit: 14 },
                title: { display: true, text: "Wiek (r.ż.)", color: text3, font: { size: 12 } },
            },
            y: {
                grid: { color: border },
                ticks: { color: text3, font: { size: 11 } },
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
    el.innerHTML = `${iconSvg("danger")}<div class="banner-body">${escapeHtml(msg)}</div>`;
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
    initTipAnchoring();
}

/* ── Karty legendy (kompaktowe) ───────────────────────────────── */

function renderCards(sims) {
    const el = $("cardsSection");
    el.innerHTML = "";

    sims.forEach((s, i) => {
        const c = seriesColor(i);
        const sum = s.summary || {};
        const mult = roiMultiple(s);
        const avg = avgMonthly(s);
        const card = document.createElement("a");
        card.className = "card cmp-card";
        card.href = "/sim?id=" + s.id;
        card.style.setProperty("--series", c);
        const info = [];
        if (sum.start_age != null && sum.end_age != null) info.push(`${sum.start_age}–${sum.end_age} r.ż.`);
        const effInfl = s.input?.inflation ?? s.input?.config?.inflation;
        if (effInfl != null) info.push(`inflacja ${(effInfl * 100).toFixed(1)}%`);
        if (sum.has_pension) info.push("ZUS");
        card.innerHTML = `
            <div class="cmp-card-head">
                <span class="cmp-swatch" aria-hidden="true"></span>
                <h3 class="cmp-card-name">${escapeHtml(s.name)}</h3>
                ${mult != null ? `<span class="chip chip-primary" title="Suma wypłat netto / (kapitał początkowy + wpłaty własne)">×${mult.toFixed(1)}</span>` : ""}
            </div>
            <dl class="cmp-card-metrics">
                <div><dt>Wypłata mies.</dt><dd>${fmtMoney(avg)}</dd></div>
                <div><dt>Szczyt majątku</dt><dd>${fmtMoney(sum.peak_wealth)}</dd></div>
                <div><dt>Podatki</dt><dd>${fmtMoney(sum.total_tax)}</dd></div>
            </dl>
            <div class="chip-row">${info.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}${sum.warnings ? `<span class="chip chip-warn">${iconSvg("warning")}${sum.warnings}</span>` : ""}</div>
        `;
        el.appendChild(card);
    });
    show("cardsSection", true);
}

/* ── Tabela wskaźników ─────────────────────────────────────────── */

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
          hint: "Łączna kwota podatków. Ujemna wartość oznacza oszczędności z odliczenia IKZE od dochodu." },
        { key: "tax_eff", label: "Efektywność", pct: true, better: "max",
          hint: "Udział wypłat netto w sumie wypłat brutto (netto + podatek). Im wyższy, tym mniej podatku." },
    ]},
    { label: "Inne", metrics: [
        { key: "initial_capital", label: "Kapitał początkowy", money: true, better: null,
          hint: "Suma sald startowych wszystkich kont (pierwsze wystąpienie chronologicznie)." },
        { key: "total_user_contributions", label: "Wpłaty własne", money: true, better: null,
          hint: "Suma wpłat własnych (roczne + PPK pracownicze) przez cały okres symulacji." },
        { key: "roi_mult", label: "Mnożnik", mult: true, better: "max",
          hint: "Ile razy suma wypłat netto przewyższa łączne zainwestowane środki (kapitał początkowy + wpłaty własne)." },
        { key: "years", label: "Lata symulacji", money: false, better: null,
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

function seriesHeader(s, i) {
    return `<th class="amount"><span class="cmp-th"><span class="cmp-swatch cmp-swatch-sm" style="--series:${seriesColor(i)}"></span>${escapeHtml(s.name)}</span></th>`;
}

function renderMetricsTable(sims) {
    const thead = document.querySelector("#metricsTable thead tr");
    const tbody = document.querySelector("#metricsTable tbody");
    thead.innerHTML = "<th class='col-name'>Wskaźnik</th>" + sims.map(seriesHeader).join("");
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
        grpTr.className = "table-group";
        grpTr.innerHTML = `<td class="col-name" colspan="${sims.length + 1}">${g.label}</td>`;
        tbody.appendChild(grpTr);

        g.metrics.forEach(m => {
            const tr = document.createElement("tr");
            let html = `<td class="col-name">${tipLabelHtml(m.label, m.hint)}</td>`;
            const vals = sims.map(s => metricValue(s, m));
            const distinct = new Set(vals.filter(v => v != null)).size > 1;
            vals.forEach(v => {
                if (v == null) { html += `<td class="amount">—</td>`; return; }
                let txt;
                if (m.pct) txt = fmtPct(v);
                else if (m.mult) txt = "×" + v.toFixed(1);
                else if (m.money) txt = fmtMoney(v);
                else txt = v;
                const isBest = m.better && distinct && v === best[m.key] && sims.length > 1;
                html += `<td class="amount ${isBest ? "best" : ""}">${txt}</td>`;
            });
            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    });
    show("metricsSection", true);
}

/* ── Wykresy (Chart.js) ────────────────────────────────────────── */

function ageLabelsFor(sims) {
    const all = sims.map(s => s.result.years || []).flat();
    const minAge = Math.min(...all.map(y => y.age));
    const maxAge = Math.max(...all.map(y => y.age));
    const labels = [];
    for (let a = minAge; a <= maxAge; a++) labels.push(a);
    return labels;
}

function lineDataset(s, i, data) {
    const c = seriesColor(i);
    return {
        label: s.name,
        data,
        borderColor: c,
        backgroundColor: withAlpha(c, 0.08),
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: c,
        borderWidth: 2.2,
        spanGaps: false,
    };
}

function renderWealthChart(sims) {
    const allYears = sims.map(s => s.result.years || []);
    if (!allYears.some(y => y.length)) return;
    const ageLabels = ageLabelsFor(sims);

    const datasets = sims.map((s, i) => {
        const byAge = {};
        (s.result.years || []).forEach(y => { byAge[y.age] = y.total_wealth; });
        return lineDataset(s, i, ageLabels.map(a => byAge[a] != null ? Math.round(byAge[a]) : null));
    });

    const base = chartDefaults();
    const cfg = {
        type: "line",
        data: { labels: ageLabels, datasets },
        options: {
            ...base,
            plugins: {
                ...base.plugins,
                tooltip: {
                    ...base.plugins.tooltip,
                    callbacks: {
                        title: (items) => items[0].label + " r.ż.",
                        label: (item) => " " + item.dataset.label + ": " + fmtMoney(item.parsed.y),
                    },
                },
            },
            scales: {
                ...base.scales,
                y: {
                    ...base.scales.y,
                    ticks: {
                        ...base.scales.y.ticks,
                        callback: (v) => {
                            if (v >= 1000000) return (v / 1000000).toFixed(1).replace(".", ",") + " mln";
                            if (v >= 1000) return (v / 1000).toFixed(0) + " tys.";
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

function renderWithdrawalChart(sims) {
    const allYears = sims.map(s => s.result.years || []);
    const hasWithdrawals = allYears.some(y => y.some(yr => yr.monthly_withdrawal > 0));
    if (!hasWithdrawals) { show("withdrawalSection", false); return; }
    const ageLabels = ageLabelsFor(sims);

    const datasets = sims.map((s, i) => {
        const byAge = {};
        (s.result.years || []).forEach(y => { byAge[y.age] = y.monthly_withdrawal; });
        return lineDataset(s, i, ageLabels.map(a => byAge[a] != null && byAge[a] > 0 ? Math.round(byAge[a]) : null));
    });

    const base = chartDefaults();
    const cfg = {
        type: "line",
        data: { labels: ageLabels, datasets },
        options: {
            ...base,
            plugins: {
                ...base.plugins,
                tooltip: {
                    ...base.plugins.tooltip,
                    callbacks: {
                        title: (items) => items[0].label + " r.ż.",
                        label: (item) => " " + item.dataset.label + ": " + fmtMoney(item.parsed.y) + "/mies.",
                    },
                },
            },
            scales: {
                ...base.scales,
                y: {
                    ...base.scales.y,
                    beginAtZero: true,
                    ticks: {
                        ...base.scales.y.ticks,
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

/* ── Struktura etapów (gantt) ──────────────────────────────────── */

function renderStageComparison(sims) {
    const container = $("ganttContainer");
    container.innerHTML = "";

    let globalMin = Infinity, globalMax = -Infinity;
    sims.forEach(s => {
        (s.summary.stages || []).forEach(st => {
            if (st.start_age < globalMin) globalMin = st.start_age;
            if (st.end_age > globalMax) globalMax = st.end_age;
        });
    });
    if (globalMin === Infinity) { show("stagesSection", false); return; }

    const range = globalMax - globalMin || 1;
    const inner = document.createElement("div");
    inner.className = "cmp-gantt-inner";

    sims.forEach((s, i) => {
        const row = document.createElement("div");
        row.className = "cmp-gantt-row";

        const label = document.createElement("div");
        label.className = "cmp-gantt-label";
        label.innerHTML = `<span class="cmp-swatch cmp-swatch-sm" style="--series:${seriesColor(i)}"></span><span class="cmp-gantt-name">${escapeHtml(s.name)}</span>`;

        const track = document.createElement("div");
        track.className = "cmp-gantt-track";

        (s.summary.stages || []).forEach(st => {
            const kind = /akumulacja/i.test(st.label) ? "accum" : "real";
            const left = ((st.start_age - globalMin) / range) * 100;
            const width = ((st.end_age - st.start_age) / range) * 100;

            const seg = document.createElement("div");
            seg.className = `cmp-gantt-segment ${kind}`;
            seg.style.left = left + "%";
            seg.style.width = Math.max(width, 0.5) + "%";
            seg.title = `${st.label}: ${st.start_age}–${st.end_age} r.ż. · ${(st.accounts || []).join(", ")}`;
            if (width > 8) {
                seg.innerHTML = `<span class="cmp-gantt-seg-label">${escapeHtml(st.label)}</span><span class="cmp-gantt-seg-age">${st.start_age}–${st.end_age}</span>`;
            }
            track.appendChild(seg);
        });

        row.appendChild(label);
        row.appendChild(track);
        inner.appendChild(row);
    });

    const axis = document.createElement("div");
    axis.className = "cmp-gantt-row cmp-gantt-axis-row";
    axis.innerHTML = `<div></div>`;
    const ageTrack = document.createElement("div");
    ageTrack.className = "cmp-gantt-age-axis";
    const step = range <= 20 ? 1 : range <= 40 ? 5 : 10;
    for (let a = Math.ceil(globalMin / step) * step; a <= globalMax; a += step) {
        const lbl = document.createElement("span");
        lbl.className = "cmp-gantt-age-label";
        lbl.style.left = ((a - globalMin) / range) * 100 + "%";
        lbl.textContent = a;
        if (a === globalMax || a + step > globalMax) lbl.classList.add("is-last");
        ageTrack.appendChild(lbl);
    }
    axis.appendChild(ageTrack);
    inner.appendChild(axis);

    const legend = document.createElement("div");
    legend.className = "chip-row cmp-gantt-legend";
    legend.innerHTML = `<span class="chip chip-accum">Akumulacja</span><span class="chip chip-real">Realizacja</span><span class="dim">Oś: wiek w latach</span>`;

    container.appendChild(inner);
    container.appendChild(legend);
    show("stagesSection", true);
}

/* ── Kamienie milowe ───────────────────────────────────────────── */

function renderMilestones(sims) {
    const all = sims.map(s => s.result.years || []).flat();
    if (!all.length) return;
    const minAge = Math.min(...all.map(y => y.age));
    const maxAge = Math.max(...all.map(y => y.age));
    const fixed = [minAge, 55, 60, 65, 70, maxAge];
    const milestones = [...new Set(fixed)].filter(a => a >= minAge && a <= maxAge).sort((a, b) => a - b);

    const tip = (label, text) => tipLabelHtml(label, text);
    const thead = document.querySelector("#milestonesTable thead");
    thead.innerHTML = "";
    const headRow1 = document.createElement("tr");
    headRow1.innerHTML = "<th rowspan='2' class='col-name'>Wiek</th>" + sims.map((s, i) => `<th colspan="3" class="cmp-group-th"><span class="cmp-th"><span class="cmp-swatch cmp-swatch-sm" style="--series:${seriesColor(i)}"></span>${escapeHtml(s.name)}</span></th>`).join("");
    thead.appendChild(headRow1);
    const headRow2 = document.createElement("tr");
    headRow2.innerHTML = sims.map(() =>
        `<th class="amount cmp-col-sub">${tip("Majątek", "Łączna wartość wszystkich kont.")}</th>` +
        `<th class="amount cmp-col-sub">${tip("Wypłata mies.", "Miesięczna wypłata netto (po podatku).")}</th>` +
        `<th class="amount cmp-col-sub">${tip("Podatek", "Suma podatków zapłaconych w danym roku.")}</th>`
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
        let html = `<td class="col-name"><strong>${ageLabel}</strong></td>`;
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
