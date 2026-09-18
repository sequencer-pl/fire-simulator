// helpers.js — wspólne, czysto funkcjonalne helpery dla WSZYSTKICH stron.
// Ładowany w base.html przed skryptami strony; nie zawiera logiki UI ani auth.

function $(id) {
    return document.getElementById(id);
}

function show(id, on) {
    $(id).classList.toggle("hidden", !on);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function fmtMoney(v) {
    if (v == null) return "—";
    return Math.round(v).toLocaleString("pl-PL") + " zł";
}

async function api(path, options) {
    const res = await fetch(path, options);
    let data = null;
    try {
        data = await res.json();
    } catch (e) {
        data = {};
    }
    if (!res.ok) {
        const msg = data.detail || data.error || "Błąd serwera";
        const err = new Error(msg);
        err.status = res.status;
        throw err;
    }
    return data;
}