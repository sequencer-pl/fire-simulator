// results-view.js — wspólny szkielet ekranu wyników.
// Tworzy identyczne karty i kontenery dla Asystenta i Symulatora.
// Moduły results-* wypełniają poszczególne sekcje.

(function () {
    function esc(value) {
        return window.escapeHtml ? window.escapeHtml(value) : String(value ?? "");
    }

    function tip(title, text) {
        if (typeof window.tipLabelHtml === "function") {
            return window.tipLabelHtml(title, text);
        }
        return esc(title);
    }

    function chartCard(kind, title) {
        const containerId = kind === "withdrawals" ? "wzWithdrawalsChart" : "wzCapitalChart";
        const legendId = kind === "withdrawals" ? "wzWithdrawalsLegend" : "wzCapitalLegend";
        const titleId = kind === "withdrawals" ? "wzWithdrawalsTitle" : "wzCapitalTitle";
        const titleHtml = kind === "withdrawals"
            ? tip(
                title,
                "Przerywana linia „Budżet na życie” pokazuje, ile zostaje po odjęciu aktywnych zobowiązań czasowych od dochodu netto (portfel + ZUS + praca). Rysujemy ją tylko w latach, w których różni się od wypłat netto; po zakończeniu zobowiązań łączy się z górną linią. Szczegóły roku znajdziesz w tabeli „Rok po roku”."
            )
            : esc(title);
        return `<section class="wz-chart-card" data-results-chart-card="${kind}" aria-labelledby="${titleId}">
            <div class="wz-chart-head">
                <h4 class="wz-plan-subhead" id="${titleId}">${titleHtml}</h4>
                <div class="wz-chart-legend" id="${legendId}" data-results-legend="${kind}"></div>
            </div>
            <div class="wz-chart" id="${containerId}" data-results-chart="${kind}"></div>
        </section>`;
    }

    function shellHtml(options = {}) {
        const scenarios = Boolean(options.scenarios);
        const scenariosHtml = scenarios
            ? `<section class="wz-result-card" id="wzScenariosSection" data-results-section="scenarios">
                    <div id="wzScenariosBox" data-results-scenarios></div>
                </section>`
            : "";
        return `<div class="wz-result" data-results-root>
            <section class="wz-result-card" data-results-section="hero">
                <div id="wzHeroAnswer" data-results-hero></div>
                <div id="wzWarnings" class="wz-warnings" data-results-warnings aria-live="polite"></div>
            </section>
            ${scenariosHtml}
            <section class="wz-result-card" data-results-section="metrics">
                <h3 class="wz-section-title">Kluczowe liczby</h3>
                <div id="wzMetrics" class="metric-grid wz-summary" data-results-metrics></div>
                <div id="wzFacts" class="wz-fact-row" data-results-facts></div>
                <p id="wzPlanWhy" class="wz-plan-why hidden" data-results-why></p>
            </section>
            <section class="wz-result-card" data-results-section="plan-time">
                <h3 class="wz-section-title">
                    ${tip("Twój plan w czasie", "Górna oś pokazuje etapy życia. Pasek kont pokazuje, z których kont pochodzą wpłaty i wypłaty w danym wieku. Kliknij etap albo pasek, aby zobaczyć szczegóły.")}
                </h3>
                <div data-results-plan-time></div>
                <div class="wz-gantt-tip hidden" id="wzGanttTip" role="tooltip">
                    <button type="button" class="wz-gantt-tip-close" id="wzGanttTipClose" aria-label="Zamknij podpowiedź">×</button>
                    <div id="wzGanttTipBody"></div>
                </div>
            </section>
            <section class="wz-result-card" data-results-section="charts">
                <div class="wz-section-head">
                    <h3 class="wz-section-title">Wykresy</h3>
                    <button type="button" class="pill-toggle hidden" id="wzChartMilestonesToggle" aria-pressed="true">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>
                        <span id="wzChartMilestonesToggleLabel">Ukryj kamienie milowe</span>
                    </button>
                </div>
                <div class="wz-charts-wrap" id="wzChartsWrap" data-results-charts>
                    ${chartCard("withdrawals", "Wypłaty netto w czasie")}
                    ${chartCard("capital", "Kapitał prywatny FIRE")}
                </div>
                <div class="wz-gantt-tip hidden" id="wzChartTip" role="tooltip">
                    <button type="button" class="wz-gantt-tip-close" id="wzChartTipClose" aria-label="Zamknij podpowiedź">×</button>
                    <div id="wzChartTipBody"></div>
                </div>
                <div class="wz-gantt-tip wz-chart-milestone-tip hidden" id="wzChartMilestoneTip" role="tooltip">
                    <button type="button" class="wz-gantt-tip-close" id="wzChartMilestoneTipClose" aria-label="Zamknij opis kamienia milowego">×</button>
                    <div id="wzChartMilestoneTipBody"></div>
                </div>
            </section>
            <section class="wz-result-card" data-results-section="year-table">
                <h3 class="wz-section-title">
                    ${tip("Rok po roku", "Majątek prywatny: suma sald na koniec roku bez ZUS i OFE; ZUS pokazujemy w osobnej kolumnie. Kwoty są brutto — majątek końcowy netto jest po podatku wyjścia. Wiersz po horyzoncie pokazuje tylko ZUS — majątek prywatny jest poza modelem.")}
                </h3>
                <div id="wzYearTable" data-results-year-table></div>
            </section>
        </div>`;
    }

    function mount(container, options = {}) {
        if (!container) return null;
        container.innerHTML = shellHtml(options);
        return container.querySelector("[data-results-root]");
    }

    function section(root, name) {
        return root?.querySelector(`[data-results-section="${name}"]`) || null;
    }

    function role(root, name) {
        return root?.querySelector(`[data-results-${name}]`) || null;
    }

    window.ResultsView = { mount, shellHtml, section, role };
})();
