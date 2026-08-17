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
