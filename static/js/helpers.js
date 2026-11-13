// helpers.js — wspólne, czysto funkcjonalne helpery dla WSZYSTKICH stron.
// Ładowany w base.html przed skryptami strony; nie zawiera logiki UI.

function $(id) {
    return document.getElementById(id);
}

function show(id, on) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("hidden", !on);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Kwota w złotych; `Math.round(v) || 0` normalizuje -0 (np. -0.3 zł) do 0.
function fmtMoney(v) {
    if (v == null) return "—";
    return (Math.round(v) || 0).toLocaleString("pl-PL") + " zł";
}

document.addEventListener("DOMContentLoaded", () => {
    if (typeof initTipAnchoring === "function") initTipAnchoring();
});
