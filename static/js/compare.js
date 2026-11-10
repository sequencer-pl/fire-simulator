// compare.js — porównanie 1–4 symulacji (z bazy oraz z plików JSON):
// werdykt, karty legendy, tabela z deltami, wykresy, gantt, kamienie milowe.
// $, show, escapeHtml, fmtMoney, iconSvg — wspólne helpery z base.html.

const COMPARE_JSON_STORAGE_KEY = "fire.compareJsonItems";
const WIZARD_DRAFT_KEY = "fire.wizardDraft";
let currentSims = [];

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
    return v.toFixed(1).replace(".", ",") + "%";
}

function fmtSignedMoney(v) {
    if (v == null) return "—";
    const r = Math.round(v) || 0;
    const sign = r > 0 ? "+" : "";
    return sign + r.toLocaleString("pl-PL") + " zł";
}

/* ── data helpers ─────────────────────────────────────────────── */

function finalWealthNet(sim) {
    return (
        sim.summary?.final_wealth_net ??
        sim.result?.final_wealth_net ??
        sim.summary?.final_wealth ??
        sim.result?.final_wealth ??
        0
    );
}

function totalNetBenefit(sim) {
    const w = sim.result?.total_withdrawn ?? sim.summary?.total_withdrawn ?? 0;
    return w + finalWealthNet(sim);
}

function avgMonthly(sim) {
    const yrs = sim.result?.years || [];
    const n = yrs.filter((y) => y.annual_withdrawal > 0).length;
    return n ? sim.result.total_withdrawn / 12 / n : null;
}

function taxEfficiency(sim) {
    const { total_withdrawn: w, total_tax: t } = sim.result || {};
    const denom = (w || 0) + (t || 0);
    if (denom <= 0) return null;
    return Math.min(100, ((w || 0) / denom) * 100);
}

function roiMultiple(sim) {
    const contrib = sim.summary?.total_user_contributions || 0;
    const initCap = sim.summary?.initial_capital || 0;
    const totalInvested = initCap + contrib;
    if (totalInvested <= 0) return null;
    return totalNetBenefit(sim) / totalInvested;
}

function valueAt(sim, age) {
    const yrs = sim.result?.years || [];
    const exact = yrs.find((y) => y.age === age);
    if (exact) {
        return {
            age,
            wealth: exact.total_wealth,
            monthly: exact.monthly_withdrawal,
            tax: exact.tax_paid,
        };
    }
    let best = null;
    let bestD = Infinity;
    for (const y of yrs) {
        const d = Math.abs(y.age - age);
        if (d < bestD) {
            bestD = d;
            best = y;
        }
    }
    return best
        ? {
              age: best.age,
              wealth: best.total_wealth,
              monthly: best.monthly_withdrawal,
              tax: best.tax_paid,
          }
        : null;
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
                labels: {
                    color: cssVar("--text-2"),
                    boxWidth: 10,
                    boxHeight: 10,
                    usePointStyle: true,
                    pointStyle: "circle",
                    font: { size: 12 },
                },
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

/* ── Wczytywanie i obsługa JSON ──────────────────────────────── */

function extractJsonItems(parsed, fallbackName) {
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const out = [];
    list.forEach((entry, idx) => {
        if (!entry || typeof entry !== "object") return;
        const input = entry.input && Array.isArray(entry.input.stages) ? entry.input : entry;
        if (!input || !Array.isArray(input.stages)) return;
        const baseName =
            (typeof entry.name === "string" && entry.name.trim()) ||
            (list.length > 1 ? `${fallbackName} #${idx + 1}` : fallbackName);
        out.push({ name: baseName.slice(0, 200), input });
    });
    return out;
}

async function evaluateJsonItems(rawItems) {
    if (!rawItems || !rawItems.length) return [];
    const res = await fetch("/api/compare/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: rawItems.slice(0, 4) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Nie udało się przeliczyć pliku JSON.");
    return data;
}

async function handleJsonFiles(fileList) {
    if (!fileList || !fileList.length) return;
    show("errorMsg", false);
    const remainingSlots = 4 - currentSims.length;
    if (remainingSlots <= 0) {
        showError("Możesz porównywać maksymalnie 4 symulacje naraz. Usuń jedną z kart, aby dodać kolejną.");
        return;
    }
    const itemsToEvaluate = [];
    for (const file of Array.from(fileList)) {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const cleanName = file.name.replace(/\.json$/i, "") || "Symulacja z JSON";
            const extracted = extractJsonItems(parsed, cleanName);
            if (!extracted.length) {
                throw new Error(`Plik „${file.name}” nie zawiera poprawnych etapów symulacji.`);
            }
            itemsToEvaluate.push(...extracted);
        } catch (err) {
            showError(err.message || `Nieprawidłowy plik JSON: ${file.name}`);
            return;
        }
    }
    if (!itemsToEvaluate.length) return;
    try {
        const evaluated = await evaluateJsonItems(itemsToEvaluate.slice(0, remainingSlots));
        currentSims = [...currentSims, ...evaluated].slice(0, 4);
        render(currentSims);
    } catch (err) {
        showError(err.message);
    }
}

async function loadCompare() {
    const ids = new URLSearchParams(location.search).get("ids");
    const storedJson = sessionStorage.getItem(COMPARE_JSON_STORAGE_KEY);
    const loaded = [];

    if (ids) {
        try {
            const res = await fetch("/api/compare?ids=" + encodeURIComponent(ids));
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Błąd serwera");
            loaded.push(...data);
        } catch (e) {
            showError(e.message);
        }
    }

    if (storedJson) {
        sessionStorage.removeItem(COMPARE_JSON_STORAGE_KEY);
        try {
            const rawItems = JSON.parse(storedJson);
            const slots = Math.max(0, 4 - loaded.length);
            if (slots > 0 && Array.isArray(rawItems) && rawItems.length) {
                const evaluated = await evaluateJsonItems(rawItems.slice(0, slots));
                loaded.push(...evaluated);
            }
        } catch (e) {
            showError(e.message);
        }
    }

    currentSims = loaded.slice(0, 4);
    render(currentSims);
}

function showError(msg) {
    const el = $("errorMsg");
    if (!el) return;
    el.innerHTML = `${iconSvg("danger")}<div class="banner-body">${escapeHtml(msg)}</div>`;
    show("errorMsg", true);
}

/* ── orchestrator ─────────────────────────────────────────────── */

let wealthChartInst = null;
let withdrawalChartInst = null;

function render(sims) {
    const hasSims = Array.isArray(sims) && sims.length > 0;
    show("cmpEmptyState", !hasSims);
    show("cmpClearBtn", hasSims);
    if (!hasSims) {
        show("verdictSection", false);
        show("cardsSection", false);
        show("metricsSection", false);
        show("chartSection", false);
        show("withdrawalSection", false);
        show("stagesSection", false);
        show("milestonesSection", false);
        if (typeof initTipAnchoring === "function") initTipAnchoring();
        return;
    }
    renderVerdict(sims);
    renderCards(sims);
    renderMetricsTable(sims);
    renderWealthChart(sims);
    renderWithdrawalChart(sims);
    renderStageComparison(sims);
    renderMilestones(sims);
    if (typeof initTipAnchoring === "function") initTipAnchoring();
}

/* ── Werdykt porównania ───────────────────────────────────────── */

function renderVerdict(sims) {
    const el = $("verdictSection");
    if (!el) return;
    if (sims.length < 2) {
        el.innerHTML = "";
        show("verdictSection", false);
        return;
    }

    const scored = sims.map((s, idx) => ({
        sim: s,
        idx,
        color: seriesColor(idx),
        netBenefit: totalNetBenefit(s),
        avg: avgMonthly(s) || 0,
        finalNet: finalWealthNet(s),
        tax: s.result?.total_tax ?? s.summary?.total_tax ?? 0,
        taxEff: taxEfficiency(s),
    }));

    const byBenefit = [...scored].sort((a, b) => b.netBenefit - a.netBenefit);
    const winner = byBenefit[0];
    const runnerUp = byBenefit[1];
    const worst = byBenefit[byBenefit.length - 1];
    const diffRunner = winner.netBenefit - runnerUp.netBenefit;
    const diffWorst = winner.netBenefit - worst.netBenefit;
    const pctRunner =
        runnerUp.netBenefit > 0 ? (diffRunner / runnerUp.netBenefit) * 100 : null;

    const byAvg = [...scored].sort((a, b) => b.avg - a.avg);
    const bestAvg = byAvg[0];
    const secondAvg = byAvg[1];

    const byFinal = [...scored].sort((a, b) => b.finalNet - a.finalNet);
    const bestFinal = byFinal[0];
    const secondFinal = byFinal[1];

    const byTax = [...scored].sort((a, b) => a.tax - b.tax);
    const bestTax = byTax[0];
    const worstTax = byTax[byTax.length - 1];

    let leadHtml = "";
    if (Math.abs(diffRunner) < 1) {
        leadHtml = `Scenariusze <strong>${escapeHtml(winner.sim.name)}</strong> oraz <strong>${escapeHtml(runnerUp.sim.name)}</strong> przynoszą identyczną łączną korzyść netto (<strong>${fmtMoney(winner.netBenefit)}</strong>).`;
    } else {
        const pctPart = pctRunner != null ? ` (${pctRunner >= 0 ? "+" : ""}${fmtPct(pctRunner)})` : "";
        const vsThird =
            sims.length > 2 && diffWorst > diffRunner + 1
                ? ` oraz o <strong>${fmtSignedMoney(diffWorst)}</strong> więcej niż „${escapeHtml(worst.sim.name)}”`
                : "";
        leadHtml = `Scenariusz <strong>${escapeHtml(winner.sim.name)}</strong> przynosi łącznie <strong>${fmtMoney(winner.netBenefit)}</strong> na rękę (suma wypłat netto + majątek końcowy netto) — to o <strong>${fmtSignedMoney(diffRunner)}</strong>${pctPart} więcej niż „${escapeHtml(runnerUp.sim.name)}”${vsThird}.`;
    }

    const avgDelta = bestAvg.avg - secondAvg.avg;
    const finalDelta = bestFinal.finalNet - secondFinal.finalNet;
    const taxSaved = worstTax.tax - bestTax.tax;

    el.innerHTML = `
        <div class="card cmp-verdict" style="--winner:${winner.color}">
            <div class="cmp-verdict-head">
                <div class="cmp-verdict-title-row">
                    <span class="cmp-swatch" style="--series:${winner.color}" aria-hidden="true"></span>
                    <span class="chip chip-success">${iconSvg("check")}Najkorzystniejszy scenariusz</span>
                    <h3 class="cmp-verdict-winner">${escapeHtml(winner.sim.name)}</h3>
                    ${tipHtml("Głównym kryterium oceny jest łączna korzyść netto w dzisiejszej sile nabywczej: suma wszystkich wypłat na rękę w trakcie symulacji powiększona o majątek końcowy netto (po potrąceniu podatku wyjścia z kont).")}
                </div>
                <p class="cmp-verdict-lead">${leadHtml}</p>
            </div>
            <div class="metric-grid is-wide cmp-verdict-metrics">
                <div class="metric is-positive">
                    <span class="metric-label">${tipLabelHtml("Łącznie na rękę (Lider)", "Suma wypłat netto z całego okresu + majątek końcowy netto po podatku wyjścia.")}</span>
                    <span class="metric-value">${fmtMoney(winner.netBenefit)}</span>
                    <span class="cmp-verdict-sub">${escapeHtml(winner.sim.name)}${diffRunner >= 1 ? ` · ${fmtSignedMoney(diffRunner)} vs #2` : ""}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">${tipLabelHtml("Najwyższa wypłata mies.", "Scenariusz zapewniający najwyższą średnią miesięczną wypłatę netto w latach realizacji.")}</span>
                    <span class="metric-value">${bestAvg.avg > 0 ? fmtMoney(bestAvg.avg) + "/mies." : "—"}</span>
                    <span class="cmp-verdict-sub">${bestAvg.avg > 0 ? `${escapeHtml(bestAvg.sim.name)}${avgDelta >= 1 ? ` · ${fmtSignedMoney(avgDelta)}/mies. vs #2` : ""}` : "Brak etapu wypłat"}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">${tipLabelHtml("Najwyższy majątek na koniec", "Majątek pozostały na koniec planu po odliczeniu podatku wyjścia.")}</span>
                    <span class="metric-value">${fmtMoney(bestFinal.finalNet)}</span>
                    <span class="cmp-verdict-sub">${escapeHtml(bestFinal.sim.name)}${finalDelta >= 1 ? ` · ${fmtSignedMoney(finalDelta)} vs #2` : ""}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">${tipLabelHtml("Najniższe podatki", "Scenariusz z najniższą łączną sumą zapłaconych podatków (po odliczeniu ulg IKZE).")}</span>
                    <span class="metric-value">${fmtMoney(bestTax.tax)}</span>
                    <span class="cmp-verdict-sub">${escapeHtml(bestTax.sim.name)}${taxSaved >= 1 ? ` · o ${fmtMoney(taxSaved)} mniej niż max` : ""}</span>
                </div>
            </div>
        </div>
    `;
    show("verdictSection", true);
}

/* ── Karty legendy (kompaktowe) ───────────────────────────────── */

function renderCards(sims) {
    const el = $("cardsSection");
    el.innerHTML = "";

    const benefits = sims.map(totalNetBenefit);
    const maxBenefit = Math.max(...benefits);
    const hasDistinctWinner = sims.length > 1 && new Set(benefits.map((v) => Math.round(v))).size > 1;

    sims.forEach((s, i) => {
        const c = seriesColor(i);
        const sum = s.summary || {};
        const mult = roiMultiple(s);
        const avg = avgMonthly(s);
        const netBen = benefits[i];
        const isWinner = hasDistinctWinner && Math.round(netBen) === Math.round(maxBenefit);
        const diffToWinner = netBen - maxBenefit;

        const card = document.createElement("article");
        card.className = "card cmp-card" + (isWinner ? " is-winner" : "");
        card.style.setProperty("--series", c);

        const info = [];
        if (s.from_json) info.push("Plik JSON");
        if (sum.start_age != null && sum.end_age != null) info.push(`${sum.start_age}–${sum.end_age} r.ż.`);
        const effInfl = s.input?.inflation ?? s.input?.config?.inflation;
        if (effInfl != null) info.push(`inflacja ${(effInfl * 100).toFixed(1).replace(".", ",")}%`);
        if (sum.has_pension) info.push("ZUS");

        let rankBadge = "";
        if (isWinner) {
            rankBadge = `<span class="chip chip-success" title="Najwyższa łączna korzyść netto (wypłaty + majątek końcowy netto)">${iconSvg("check")}Najkorzystniejsza</span>`;
        } else if (hasDistinctWinner && diffToWinner < -0.5) {
            rankBadge = `<span class="chip" title="Różnica w łącznej korzyści netto względem najlepszego scenariusza">${fmtSignedMoney(diffToWinner)} vs lider</span>`;
        }

        card.innerHTML = `
            <div class="cmp-card-head">
                <span class="cmp-swatch" aria-hidden="true"></span>
                <h3 class="cmp-card-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</h3>
                ${mult != null ? `<span class="chip chip-primary" title="Mnożnik: łączna korzyść netto / (kapitał początkowy + wpłaty własne)">×${mult.toFixed(1).replace(".", ",")}</span>` : ""}
                <button type="button" class="btn btn-ghost btn-icon btn-sm cmp-card-remove" data-index="${i}" title="Usuń z porównania" aria-label="Usuń ${escapeHtml(s.name)} z porównania">${iconSvg("x")}</button>
            </div>
            <div class="cmp-card-badges">${rankBadge}</div>
            <dl class="cmp-card-metrics">
                <div><dt>Łącznie netto</dt><dd>${fmtMoney(netBen)}</dd></div>
                <div><dt>Wypłata mies.</dt><dd>${fmtMoney(avg)}</dd></div>
                <div><dt>Podatki</dt><dd>${fmtMoney(sum.total_tax)}</dd></div>
            </dl>
            <div class="cmp-card-foot">
                <div class="chip-row">${info.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}${sum.warnings ? `<span class="chip chip-warn">${iconSvg("warning")}${sum.warnings}</span>` : ""}</div>
                <button type="button" class="btn btn-ghost btn-sm cmp-card-open" data-index="${i}">Otwórz w symulatorze</button>
            </div>
        `;

        card.querySelector(".cmp-card-remove").addEventListener("click", (e) => {
            e.stopPropagation();
            currentSims.splice(i, 1);
            render(currentSims);
        });

        card.querySelector(".cmp-card-open").addEventListener("click", () => {
            if (s.id != null) {
                window.location.href = "/sim?id=" + s.id;
            } else if (s.input) {
                localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(s.input));
                window.location.href = "/sim?wizard=1";
            }
        });

        el.appendChild(card);
    });
    show("cardsSection", true);
}

/* ── Tabela wskaźników ─────────────────────────────────────────── */

const METRIC_GROUPS = [
    {
        label: "Werdykt (Podsumowanie)",
        metrics: [
            {
                key: "total_net_benefit",
                label: "Łączna korzyść netto",
                money: true,
                better: "max",
                hint: "Główny wskaźnik opłacalności: suma wszystkich wypłat netto w trakcie symulacji + majątek końcowy netto po podatku wyjścia.",
            },
            {
                key: "roi_mult",
                label: "Mnożnik kapitału",
                mult: true,
                better: "max",
                hint: "Ile razy łączna korzyść netto (wypłaty + majątek końcowy netto) przewyższa wpłacony kapitał własny (kapitał początkowy + wpłaty).",
            },
        ],
    },
    {
        label: "Wypłaty",
        metrics: [
            {
                key: "total_withdrawn",
                label: "Suma wypłat netto",
                money: true,
                better: "max",
                hint: "Łączna kwota wypłacona na rękę (po podatku i składce zdrowotnej ZUS) ze wszystkich kont.",
            },
            {
                key: "avg_monthly",
                label: "Średnia miesięcznie",
                money: true,
                better: "max",
                hint: "Średnia miesięczna wypłata netto w latach, w których realizowane były wypłaty.",
            },
        ],
    },
    {
        label: "Majątek",
        metrics: [
            {
                key: "peak_wealth",
                label: "Szczytowy",
                money: true,
                better: "max",
                hint: "Najwyższy łączny stan wszystkich kont w trakcie symulacji.",
            },
            {
                key: "final_wealth",
                label: "Końcowy brutto",
                money: true,
                better: "max",
                hint: "Majątek na koniec symulacji przed podatkiem od likwidacji kont.",
            },
            {
                key: "final_wealth_net",
                label: "Końcowy netto",
                money: true,
                better: "max",
                hint: "Majątek po podatku wyjścia: IKZE 10% po 65 r.ż. (skala przed), IKE 0%, broker 19% od zysku.",
            },
        ],
    },
    {
        label: "Podatki",
        metrics: [
            {
                key: "total_tax",
                label: "Suma podatków",
                money: true,
                better: "min",
                hint: "Łączna kwota podatków (po odliczeniu ulg IKZE). Ujemna wartość oznacza, że ulgi przewyższyły podatki.",
            },
            {
                key: "total_tax_refund",
                label: "Zwrot z ulgi IKZE",
                money: true,
                better: "max",
                hint: "Suma ulg podatkowych z wpłat na IKZE w całym okresie akumulacji.",
            },
            {
                key: "tax_eff",
                label: "Efektywność podatkowa",
                pct: true,
                better: "max",
                hint: "Udział wypłat netto w sumie wypłat brutto (netto + podatek). Im wyższy, tym mniej oddajesz fiskusowi.",
            },
        ],
    },
    {
        label: "Wkład i parametry",
        metrics: [
            {
                key: "initial_capital",
                label: "Kapitał początkowy",
                money: true,
                better: null,
                hint: "Suma sald startowych wszystkich kont (pierwsze wystąpienie chronologicznie).",
            },
            {
                key: "total_user_contributions",
                label: "Wpłaty własne",
                money: true,
                better: null,
                hint: "Suma wpłat własnych (roczne + PPK pracownicze) przez cały okres symulacji.",
            },
            {
                key: "years",
                label: "Lata symulacji",
                money: false,
                better: null,
                hint: "Liczba lat objętych symulacją.",
            },
            {
                key: "warnings",
                label: "Ostrzeżenia",
                money: false,
                better: "min",
                hint: "Liczba ostrzeżeń wygenerowanych podczas symulacji.",
            },
        ],
    },
];

function metricValue(s, m) {
    if (m.key === "total_net_benefit") return totalNetBenefit(s);
    if (m.key === "avg_monthly") return avgMonthly(s);
    if (m.key === "tax_eff") return taxEfficiency(s);
    if (m.key === "roi_mult") return roiMultiple(s);
    if (m.key === "final_wealth_net") return finalWealthNet(s);
    return s.summary?.[m.key] ?? s.result?.[m.key];
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
    METRIC_GROUPS.forEach((g) =>
        g.metrics.forEach((m) => {
            if (!m.better) return;
            const vals = sims.map((s) => metricValue(s, m)).filter((v) => v != null);
            if (!vals.length) return;
            best[m.key] = m.better === "max" ? Math.max(...vals) : Math.min(...vals);
        })
    );

    METRIC_GROUPS.forEach((g) => {
        const grpTr = document.createElement("tr");
        grpTr.className = "table-group";
        grpTr.innerHTML = `<td class="col-name" colspan="${sims.length + 1}">${escapeHtml(g.label)}</td>`;
        tbody.appendChild(grpTr);

        g.metrics.forEach((m) => {
            const tr = document.createElement("tr");
            let html = `<td class="col-name">${tipLabelHtml(m.label, m.hint)}</td>`;
            const vals = sims.map((s) => metricValue(s, m));
            const nonNull = vals.filter((v) => v != null);
            const distinct = new Set(nonNull.map((v) => Number(v).toFixed(2))).size > 1;
            const targetBest = best[m.key];

            vals.forEach((v) => {
                if (v == null) {
                    html += `<td class="amount">—</td>`;
                    return;
                }
                let txt;
                if (m.pct) txt = fmtPct(v);
                else if (m.mult) txt = "×" + v.toFixed(1).replace(".", ",");
                else if (m.money) txt = fmtMoney(v);
                else txt = v;

                const isBest =
                    m.better &&
                    distinct &&
                    Math.abs(v - targetBest) < 1e-4 &&
                    sims.length > 1;

                let deltaHtml = "";
                if (distinct && sims.length > 1 && m.money && !isBest && targetBest != null) {
                    const diff = v - targetBest;
                    if (Math.abs(diff) >= 1) {
                        deltaHtml = `<span class="cmp-cell-delta">${fmtSignedMoney(diff)}</span>`;
                    }
                } else if (isBest) {
                    deltaHtml = `<span class="cmp-cell-best-tag">Lider</span>`;
                }

                html += `<td class="amount ${isBest ? "best" : ""}"><div class="cmp-cell-val">${txt}</div>${deltaHtml}</td>`;
            });
            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    });
    show("metricsSection", true);
}

/* ── Wykresy (Chart.js) ────────────────────────────────────────── */

function ageLabelsFor(sims) {
    const all = sims.map((s) => s.result?.years || []).flat();
    const minAge = Math.min(...all.map((y) => y.age));
    const maxAge = Math.max(...all.map((y) => y.age));
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
    const allYears = sims.map((s) => s.result?.years || []);
    if (!allYears.some((y) => y.length)) {
        show("chartSection", false);
        return;
    }
    const ageLabels = ageLabelsFor(sims);

    const datasets = sims.map((s, i) => {
        const byAge = {};
        (s.result?.years || []).forEach((y) => {
            byAge[y.age] = y.total_wealth;
        });
        return lineDataset(
            s,
            i,
            ageLabels.map((a) => (byAge[a] != null ? Math.round(byAge[a]) : null))
        );
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
    if (typeof Chart !== "undefined") {
        wealthChartInst = new Chart($("wealthChart"), cfg);
    }
    show("chartSection", true);
}

function renderWithdrawalChart(sims) {
    const allYears = sims.map((s) => s.result?.years || []);
    const hasWithdrawals = allYears.some((y) => y.some((yr) => yr.monthly_withdrawal > 0));
    if (!hasWithdrawals) {
        show("withdrawalSection", false);
        return;
    }
    const ageLabels = ageLabelsFor(sims);

    const datasets = sims.map((s, i) => {
        const byAge = {};
        (s.result?.years || []).forEach((y) => {
            byAge[y.age] = y.monthly_withdrawal;
        });
        return lineDataset(
            s,
            i,
            ageLabels.map((a) => (byAge[a] != null && byAge[a] > 0 ? Math.round(byAge[a]) : null))
        );
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
                        label: (item) =>
                            " " + item.dataset.label + ": " + fmtMoney(item.parsed.y) + "/mies.",
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
    if (typeof Chart !== "undefined") {
        withdrawalChartInst = new Chart($("withdrawalChart"), cfg);
    }
    show("withdrawalSection", true);
}

/* ── Struktura etapów (gantt) ──────────────────────────────────── */

function renderStageComparison(sims) {
    const container = $("ganttContainer");
    container.innerHTML = "";

    let globalMin = Infinity;
    let globalMax = -Infinity;
    sims.forEach((s) => {
        (s.summary?.stages || []).forEach((st) => {
            if (st.start_age < globalMin) globalMin = st.start_age;
            if (st.end_age > globalMax) globalMax = st.end_age;
        });
    });
    if (globalMin === Infinity) {
        show("stagesSection", false);
        return;
    }

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

        (s.summary?.stages || []).forEach((st) => {
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
    const all = sims.map((s) => s.result?.years || []).flat();
    if (!all.length) {
        show("milestonesSection", false);
        return;
    }
    const minAge = Math.min(...all.map((y) => y.age));
    const maxAge = Math.max(...all.map((y) => y.age));
    const fixed = [minAge, 55, 60, 65, 70, maxAge];
    const milestones = [...new Set(fixed)]
        .filter((a) => a >= minAge && a <= maxAge)
        .sort((a, b) => a - b);

    const tip = (label, text) => tipLabelHtml(label, text);
    const thead = document.querySelector("#milestonesTable thead");
    thead.innerHTML = "";
    const headRow1 = document.createElement("tr");
    headRow1.innerHTML =
        "<th rowspan='2' class='col-name'>Wiek</th>" +
        sims
            .map(
                (s, i) =>
                    `<th colspan="3" class="cmp-group-th"><span class="cmp-th"><span class="cmp-swatch cmp-swatch-sm" style="--series:${seriesColor(i)}"></span>${escapeHtml(s.name)}</span></th>`
            )
            .join("");
    thead.appendChild(headRow1);
    const headRow2 = document.createElement("tr");
    headRow2.innerHTML = sims
        .map(
            () =>
                `<th class="amount cmp-col-sub">${tip("Majątek", "Łączna wartość wszystkich kont.")}</th>` +
                `<th class="amount cmp-col-sub">${tip("Wypłata mies.", "Miesięczna wypłata netto (po podatku).")}</th>` +
                `<th class="amount cmp-col-sub">${tip("Podatek", "Suma podatków zapłaconych w danym roku.")}</th>`
        )
        .join("");
    thead.appendChild(headRow2);
    const tbody = document.querySelector("#milestonesTable tbody");
    tbody.innerHTML = "";

    milestones.forEach((age) => {
        const cells = sims.map((s) => valueAt(s, age));
        const bestW = Math.max(...cells.map((c) => (c ? c.wealth : -Infinity)));
        const bestM = Math.max(...cells.map((c) => (c ? c.monthly : -Infinity)));
        const ageLabel = age === maxAge ? maxAge + " (koniec)" : age;

        const tr = document.createElement("tr");
        let html = `<td class="col-name"><strong>${ageLabel}</strong></td>`;
        cells.forEach((c) => {
            if (!c) {
                html += `<td class="amount">—</td><td class="amount">—</td><td class="amount">—</td>`;
                return;
            }
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

document.addEventListener("DOMContentLoaded", () => {
    const jsonInput = $("cmpJsonInput");
    if (jsonInput) {
        jsonInput.addEventListener("change", async (e) => {
            await handleJsonFiles(e.target.files);
            jsonInput.value = "";
        });
    }
    const clearBtn = $("cmpClearBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            currentSims = [];
            show("errorMsg", false);
            if (location.search) {
                window.history.replaceState({}, "", "/compare");
            }
            render(currentSims);
        });
    }
    loadCompare();
});
