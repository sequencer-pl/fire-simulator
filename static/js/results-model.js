// results-model.js — wspólny model i formatowanie wyników.
// Ładowany po helpers.js/sim-utils.js; nie zależy od konkretnego ekranu.

(function () {
    function asNumber(value) {
        if (value == null || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function fmtMoney(value, options = {}) {
        const number = asNumber(value);
        if (number == null) return "—";
        if (options.dashZero && Math.round(number) === 0) return "—";
        const rounded = Math.round(number) || 0;
        const sign = options.signed && rounded > 0 ? "+" : "";
        return sign + rounded.toLocaleString("pl-PL") + " zł";
    }

    function fmtMoneyCompact(value) {
        const number = asNumber(value);
        if (number == null) return "—";
        const absolute = Math.abs(number);
        if (absolute >= 1_000_000) {
            return `${(number / 1_000_000).toLocaleString("pl-PL", {
                maximumFractionDigits: 1,
            })} mln`;
        }
        if (absolute >= 1_000) {
            return `${Math.round(number / 1_000).toLocaleString("pl-PL")} tys.`;
        }
        return Math.round(number).toLocaleString("pl-PL");
    }

    function fmtPct(value, digits = 1) {
        const number = asNumber(value);
        if (number == null) return "—";
        return `${number.toLocaleString("pl-PL", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        })}%`;
    }

    function fmtMultiple(value) {
        const number = asNumber(value);
        if (number == null) return "—";
        return `×${number.toLocaleString("pl-PL", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
        })}`;
    }

    function fmtNumber(value) {
        const number = asNumber(value);
        if (number == null) return "—";
        return Math.round(number).toLocaleString("pl-PL");
    }

    function horizonAge(input, summary = null) {
        const maxAge = Number(input?.max_age);
        if (Number.isFinite(maxAge)) return maxAge + 1;
        const endAge = Number(summary?.end_age);
        return Number.isFinite(endAge) ? endAge + 1 : null;
    }

    function summaryOf(plan) {
        if (!plan) return {};
        return plan.summary || plan.projection?.summary || {};
    }

    function metricValue(plan, key) {
        const summary = summaryOf(plan);
        const result = plan?.result || {};
        const projection = plan?.projection || {};
        switch (key) {
            case "totalNetBenefit":
                return (
                    summary.total_net_benefit ??
                    (summary.total_withdrawn ?? result.total_withdrawn ?? 0) +
                        (summary.final_wealth_net ??
                            result.final_wealth_net ??
                            0)
                );
            case "totalWithdrawn":
                return (
                    summary.total_withdrawn ??
                    result.total_withdrawn ??
                    projection.total_withdrawn ??
                    0
                );
            case "totalWithdrawnPrivate":
                return (
                    summary.total_withdrawn_private ??
                    summary.total_withdrawn ??
                    result.total_withdrawn ??
                    0
                );
            // Wszystkie metryki liczy summary.py — front tylko je czyta.
            case "avgMonthly":
                return summary.avg_monthly ?? null;
            case "minMonthly":
                return summary.min_monthly ?? null;
            case "avgIncome":
                return summary.avg_income ?? summary.avg_monthly ?? null;
            case "minIncome":
                return summary.min_income ?? summary.min_monthly ?? null;
            case "avgObligations":
                return summary.avg_obligations ?? 0;
            case "portfolioAvgMonthly":
                return summary.avg_monthly_portfolio ?? null;
            case "portfolioMinMonthly":
                return summary.min_monthly_portfolio ?? null;
            case "zusMonthly":
                return summary.zus_monthly ?? null;
            case "taxAndHealth":
                return (summary.total_tax ?? 0) + (summary.total_health ?? 0);
            case "finalWealth":
                return (
                    summary.final_wealth ??
                    result.final_wealth ??
                    projection.final_wealth ??
                    0
                );
            case "finalWealthNet":
                return (
                    summary.final_wealth_net ??
                    result.final_wealth_net ??
                    projection.final_wealth_net ??
                    0
                );
            case "peakWealth":
                return (
                    summary.peak_wealth ??
                    result.peak_wealth ??
                    projection.peak_wealth ??
                    0
                );
            case "totalTax":
                return summary.total_tax ?? result.total_tax ?? 0;
            case "taxRefund":
                return (
                    summary.total_tax_refund ??
                    result.total_tax_refund ??
                    projection.ikze_refund_total ??
                    0
                );
            case "roiMultiple":
                return summary.roi_multiple ?? null;
            case "taxEfficiency":
                return summary.tax_efficiency ?? null;
            case "initialCapital":
                return summary.initial_capital ?? 0;
            case "contributions":
                return summary.total_user_contributions ?? 0;
            case "years":
                return summary.years ?? result.years?.length ?? null;
            case "warnings":
                return (
                    summary.warnings_count ??
                    summary.warnings ??
                    result.warnings?.length ??
                    0
                );
            default:
                return summary[key] ?? result[key] ?? null;
        }
    }

    const METRIC_DEFS = {
        totalNetBenefit: {
            label: "Łącznie na rękę",
            tip: "Suma wypłat netto w całym horyzoncie plus majątek końcowy netto po podatku wyjścia.",
            kind: "money",
            tone: "positive",
        },
        totalWithdrawn: {
            label: "Suma wypłat netto",
            tip: "Łączna kwota wypłacona na rękę po podatkach i składce zdrowotnej.",
            kind: "money",
        },
        totalWithdrawnPrivate: {
            label: "Suma wypłat z portfela",
            tip: "Wypłaty netto z kont prywatnych (broker, IKE, IKZE, PPK itd.), bez ZUS. ZUS pokazujemy osobno.",
            kind: "money",
        },
        minMonthly: {
            label: "Minimalny budżet na życie",
            tip: "Najniższy miesięczny budżet na życie netto po zobowiązaniach: dochód z portfela, ZUS i pracy minus aktywne zobowiązania czasowe. To realna gwarancja, a nie średnia.",
            kind: "money",
            suffix: "/mies.",
        },
        minIncome: {
            label: "Minimalna wypłata netto",
            tip: "Najniższy łączny miesięczny dochód netto z planu (portfel + ZUS + praca) przed zobowiązaniami czasowymi.",
            kind: "money",
            suffix: "/mies.",
        },
        avgIncome: {
            label: "Średnia wypłata netto",
            tip: "Średni łączny miesięczny dochód netto z planu (portfel + ZUS + praca) przed zobowiązaniami czasowymi.",
            kind: "money",
            suffix: "/mies.",
        },
        avgObligations: {
            label: "Zobowiązania mies.",
            tip: "Średnia miesięczna kwota aktywnych zobowiązań czasowych w horyzoncie planu.",
            kind: "money",
            suffix: "/mies.",
        },
        portfolioMinMonthly: {
            label: "Minimalna wypłata z portfela",
            tip: "Najniższa miesięczna wypłata netto z portfela i ZUS w horyzoncie planu — bez części etatu i korekty kredytu. 0 oznacza rok bez wypłat z portfela (np. ZUS albo praca pokrywają życie) lub wyczerpanie portfela.",
            kind: "money",
            suffix: "/mies.",
        },
        portfolioAvgMonthly: {
            label: "Średnia wypłata z portfela",
            tip: "Średnia miesięczna wypłata netto z portfela i ZUS w horyzoncie planu. Bez pracy na część etatu i bez korekty kredytu.",
            kind: "money",
            suffix: "/mies.",
        },
        zusMonthly: {
            label: "ZUS mies.",
            tip: "Miesięczna emerytura ZUS na koniec horyzontu planu. Pokazujemy ją osobno, bo nie jest kapitałem prywatnym.",
            kind: "money",
            suffix: "/mies.",
        },
        taxAndHealth: {
            label: "Podatki i składki",
            tip: "Suma podatków (PIT/Belka/ryczałt) i składki zdrowotnej ZUS w całym horyzoncie.",
            kind: "money",
        },
        avgMonthly: {
            label: "Średni budżet na życie",
            tip: "Średni miesięczny budżet na życie netto po zobowiązaniach: portfel i ZUS plus praca na część etatu, minus aktywne zobowiązania czasowe.",
            kind: "money",
            suffix: "/mies.",
        },
        finalWealth: {
            label: "Majątek na koniec",
            tip: "Majątek na koniec horyzontu przed podatkiem od likwidacji kont.",
            kind: "money",
        },
        finalWealthNet: {
            label: "Majątek końcowy netto",
            tip: "Majątek na koniec horyzontu po podatku od likwidacji kont.",
            kind: "money",
        },
        peakWealth: {
            label: "Szczyt majątku",
            tip: "Najwyższy łączny stan wszystkich kont w trakcie symulacji.",
            kind: "money",
        },
        totalTax: {
            label: "Suma podatków",
            tip: "Łączna kwota podatków po odliczeniu ulg IKZE. Wartość ujemna oznacza oszczędność.",
            kind: "money",
        },
        taxRefund: {
            label: "Zwrot IKZE",
            tip: "Suma ulg IKZE odliczonych od dochodu w całym okresie.",
            kind: "money",
        },
        roiMultiple: {
            label: "Mnożnik kapitału",
            tip: "Łączna korzyść netto podzielona przez kapitał początkowy i wpłaty własne.",
            kind: "multiple",
        },
        taxEfficiency: {
            label: "Efektywność podatkowa",
            tip: "Udział wypłat netto w wypłatach netto, podatkach i składce zdrowotnej. Im wyższy, tym mniej oddajesz fiskusowi.",
            kind: "percent",
        },
        initialCapital: {
            label: "Kapitał początkowy",
            tip: "Suma sald startowych wszystkich kont.",
            kind: "money",
        },
        contributions: {
            label: "Wpłaty własne",
            tip: "Suma wpłat własnych przez cały okres symulacji.",
            kind: "money",
        },
        years: {
            label: "Lata symulacji",
            tip: "Liczba lat objętych symulacją.",
            kind: "number",
        },
        warnings: {
            label: "Ostrzeżenia",
            tip: "Liczba ostrzeżeń wygenerowanych podczas symulacji.",
            kind: "number",
        },
    };

    function formatMetricValue(value, kind, def = {}) {
        if (kind === "multiple") return fmtMultiple(value);
        if (kind === "percent") return fmtPct(value);
        if (kind === "number") return fmtNumber(value);
        const formatted = fmtMoney(value);
        if (formatted === "—") return formatted;
        return formatted + (def.suffix || "");
    }

    function metric(plan, key, overrides = {}) {
        const def = { ...(METRIC_DEFS[key] || {}), ...overrides };
        const value = metricValue(plan, key);
        const formatted = formatMetricValue(value, def.kind || "money", def);
        let tone = def.tone || "";
        if (key === "totalTax" && (asNumber(value) ?? 0) < 0) tone = "positive";
        if (key === "finalWealthNet" && (asNumber(value) ?? 0) <= 0) tone = "muted";
        return {
            key,
            label: def.label || key,
            tip: def.tip || "",
            value,
            formatted: def.formatted ?? formatted,
            tone,
            note: def.note || "",
            title: def.title || "",
        };
    }

    function fromWizard(plan, scenarioKey = "realne") {
        const key = scenarioKey || "realne";
        return {
            id: "wizard",
            name: "Plan z Asystenta",
            source: "wizard",
            color: null,
            input: plan?.scenario_inputs?.[key] || plan?.input || null,
            result: null,
            projection: plan?.scenario_projections?.[key] || plan?.projection || null,
            summary:
                plan?.scenario_summaries?.[key] ||
                plan?.summary ||
                plan?.scenario_projections?.[key]?.summary ||
                plan?.projection?.summary ||
                {},
            scenarios: plan?.scenarios || {},
            scenarioSummaries: plan?.scenario_summaries || {},
            optimization: plan?.optimization || null,
            path: plan?.path ?? null,
            solved: plan?.solved || null,
            scenarioKey: key,
        };
    }

    function fromSimulator(input, result, meta = {}) {
        return {
            id: meta.id || "simulator",
            name: meta.name || "Plan z Symulatora",
            source: "simulator",
            color: meta.color || null,
            input: input || null,
            result: result || null,
            projection: meta.projection || null,
            summary: meta.summary || result?.summary || {},
            scenarios: {},
            optimization: null,
            path: null,
            solved: null,
        };
    }

    function fromCompare(item, index = 0) {
        return {
            id: item?.id ?? `file-${index}`,
            name: item?.name || `Plan ${index + 1}`,
            source: "file",
            color: item?.color || null,
            input: item?.input || null,
            result: item?.result || null,
            projection: item?.projection || null,
            summary: item?.summary || item?.result?.summary || {},
            scenarios: {},
            optimization: null,
            path: null,
            solved: null,
        };
    }

    window.ResultsModel = {
        asNumber,
        fmtMoney,
        fmtMoneyCompact,
        fmtPct,
        fmtMultiple,
        fmtNumber,
        horizonAge,
        summaryOf,
        metricValue,
        metric,
        METRIC_DEFS,
        fromWizard,
        fromSimulator,
        fromCompare,
    };
})();
