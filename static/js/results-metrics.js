// results-metrics.js — wspólna siatka metryk wyników.

(function () {
    function metricHtml(metric) {
        const classes = ["metric", metric.tone ? `is-${metric.tone}` : ""]
            .filter(Boolean)
            .join(" ");
        const label = metric.tip
            ? window.tipLabelHtml(metric.label, metric.tip)
            : window.escapeHtml(metric.label);
        const title = !metric.tip && metric.title
            ? ` title="${window.escapeHtml(metric.title)}"`
            : "";
        const note = metric.note
            ? `<span class="metric-note">${window.escapeHtml(metric.note)}</span>`
            : "";
        return `<div class="${classes}"${title}>
            <span class="metric-label">${label}</span>
            <span class="metric-value">${metric.formatted}${note}</span>
        </div>`;
    }

    function render(container, metrics, options = {}) {
        if (!container) return;
        container.classList.add("metric-grid");
        if (options.wide) container.classList.add("is-wide");
        if (options.className) container.classList.add(options.className);
        container.innerHTML = (metrics || []).map(metricHtml).join("");
    }

    function html(metrics, options = {}) {
        const classes = [
            "metric-grid",
            options.wide ? "is-wide" : "",
            options.className || "",
        ]
            .filter(Boolean)
            .join(" ");
        return `<div class="${classes}">${(metrics || []).map(metricHtml).join("")}</div>`;
    }

    window.ResultsMetrics = { metricHtml, render, html };
})();
