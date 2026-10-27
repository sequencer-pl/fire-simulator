// helpers.js — wspólne, czysto funkcjonalne helpery dla WSZYSTKICH stron.
// Ładowany w base.html przed skryptami strony; nie zawiera logiki UI ani auth.

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

// Data i godzina bez sekund (27.10.2026, 15:06).
function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" });
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
