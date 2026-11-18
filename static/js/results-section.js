// results-section.js — wspólny nagłówek sekcji wyników.

(function () {
    function head(title, options = {}) {
        const level = options.level || "h3";
        const className = options.className || "section-title";
        const label = options.tip
            ? window.tipLabelHtml(title, options.tip)
            : window.escapeHtml(title);
        const actions = options.actionsHtml
            ? `<div class="res-section-actions">${options.actionsHtml}</div>`
            : "";
        const id = options.id ? ` id="${window.escapeHtml(options.id)}"` : "";
        return `<div class="res-section-head">
            <${level}${id} class="${className}">${label}</${level}>
            ${actions}
        </div>`;
    }

    window.ResultsSection = { head };
})();
