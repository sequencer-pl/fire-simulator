// simulations.js — lista zapisanych symulacji (karty, zaznaczanie, akcje zbiorcze).

let sims = [];

function fmtDate(s) {
    const parts = [];
    if (s.updated_at) parts.push(fmtDateTime(s.updated_at));
    if (s.created_at && s.updated_at !== s.created_at) parts.push("utw. " + fmtDateTime(s.created_at));
    return parts.join(" · ");
}

async function loadSims() {
    sims = await api("/api/simulations");
    renderSims();
}

// Jedna karta symulacji — używana też przez porównanie (compare.js) w wariancie kompaktowym.
function simMetricsHtml(sum) {
    const taxClass = sum.total_tax < 0 ? " is-positive" : "";
    return `<div class="metric-grid is-compact">
        <div class="metric"><span class="metric-label">Kapitał początkowy</span><span class="metric-value">${fmtMoney(sum.initial_capital)}</span></div>
        <div class="metric"><span class="metric-label">Wpłaty własne</span><span class="metric-value">${fmtMoney(sum.total_user_contributions)}</span></div>
        <div class="metric"><span class="metric-label">Szczyt majątku</span><span class="metric-value">${fmtMoney(sum.peak_wealth)}</span></div>
        <div class="metric"><span class="metric-label">Na koniec brutto</span><span class="metric-value">${fmtMoney(sum.final_wealth)}</span></div>
        <div class="metric"><span class="metric-label">Na koniec netto</span><span class="metric-value">${fmtMoney(sum.final_wealth_net ?? sum.final_wealth)}</span></div>
        <div class="metric"><span class="metric-label">Wypłaty netto</span><span class="metric-value">${fmtMoney(sum.total_withdrawn)}</span></div>
        <div class="metric${taxClass}"><span class="metric-label">Podatki</span><span class="metric-value">${fmtMoney(sum.total_tax)}</span></div>
    </div>`;
}

function simInfoHtml(sum, extra = []) {
    const chips = [];
    if (sum.start_age != null && sum.end_age != null) chips.push(`${sum.start_age}–${sum.end_age} r.ż.`);
    if (sum.years) chips.push(`${sum.years} lat`);
    if (sum.accounts && sum.accounts.length) chips.push(`${sum.accounts.length} kont`);
    if (sum.has_pension) chips.push("emerytura ZUS");
    extra.forEach((e) => chips.push(e));
    let html = chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("");
    if (sum.warnings) {
        const n = sum.warnings;
        const noun = n === 1 ? "ostrzeżenie" : (n >= 2 && n <= 4 ? "ostrzeżenia" : "ostrzeżeń");
        html += `<span class="chip chip-warn">${iconSvg("warning")}${n} ${noun}</span>`;
    }
    return html ? `<div class="chip-row sim-card-info">${html}</div>` : "";
}

function simStagesHtml(stages) {
    if (!stages || !stages.length) return "";
    return `<div class="sim-timeline">${stages.map((st) => {
        const kind = /akumulacja/i.test(st.label) ? "accum" : "real";
        const accounts = (st.accounts || []).map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join("");
        let finance = "";
        if (st.monthly_contribution) {
            finance = `<span class="stage-finance accum">~${fmtMoney(st.monthly_contribution)}/mies.</span>`;
        } else if (st.avg_monthly_withdrawal) {
            finance = `<span class="stage-finance real">~${fmtMoney(st.avg_monthly_withdrawal)}/mies.</span>`;
        }
        return `
            <div class="stage-line">
                <span class="stage-dot ${kind}"></span>
                <span class="stage-label ${kind}">${escapeHtml(st.label)}</span>
                <span class="stage-age">${st.start_age}–${st.end_age} r.ż.</span>
                ${accounts}
                ${finance}
            </div>`;
    }).join("")}</div>`;
}

function renderSims() {
    const list = $("simsList");
    list.innerHTML = "";
    const empty = sims.length === 0;
    show("emptyState", empty);
    document.querySelector(".sims-toolbar").classList.toggle("hidden", empty);
    $("simsTotal").textContent = empty ? "" : `${sims.length} ${sims.length === 1 ? "symulacja" : (sims.length >= 2 && sims.length <= 4 ? "symulacje" : "symulacji")}`;

    sims.forEach((s) => {
        const sum = s.summary || {};
        const card = document.createElement("article");
        card.className = "card sim-card";
        card.innerHTML = `
            <div class="sim-card-head">
                <label class="sim-card-check">
                    <input type="checkbox" class="checkbox sim-check" data-id="${s.id}" title="Zaznacz do porównania">
                </label>
                <div class="sim-card-title">
                    <h3>${escapeHtml(s.name)}</h3>
                    <span class="sim-card-date">${fmtDate(s)}</span>
                </div>
                <div class="btn-row sim-card-actions">
                    <button type="button" class="btn btn-ghost btn-sm btn-icon sim-dup" data-id="${s.id}" title="Duplikuj" aria-label="Duplikuj">${iconSvg("copy")}</button>
                    <button type="button" class="btn btn-ghost btn-sm btn-icon sim-del" data-id="${s.id}" title="Usuń" aria-label="Usuń">${iconSvg("trash")}</button>
                    <button type="button" class="btn btn-secondary btn-sm sim-open" data-id="${s.id}">Otwórz</button>
                </div>
            </div>
            ${simMetricsHtml(sum)}
            ${simInfoHtml(sum)}
            ${simStagesHtml(sum.stages)}
        `;

        card.querySelector(".sim-open").addEventListener("click", () => openSim(s.id));
        card.querySelector(".sim-dup").addEventListener("click", async () => {
            await api(`/api/simulations/${s.id}/duplicate`, { method: "POST" });
            await loadSims();
        });
        card.querySelector(".sim-del").addEventListener("click", async () => {
            if (!confirm(`Usunąć symulację „${s.name}"?`)) return;
            await api(`/api/simulations/${s.id}`, { method: "DELETE" });
            await loadSims();
        });
        const cb = card.querySelector(".sim-check");
        cb.addEventListener("change", () => {
            card.classList.toggle("is-selected", cb.checked);
            updateCompareBtn();
        });
        card.addEventListener("click", (e) => {
            if (e.target.closest("button") || e.target.closest("input") || e.target.closest("a")) return;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event("change"));
        });
        list.appendChild(card);
    });
    updateCompareBtn();
}

function selectedIds() {
    return Array.from(document.querySelectorAll(".sim-check:checked")).map((c) => c.dataset.id);
}

function updateCompareBtn() {
    const count = selectedIds().length;
    const total = document.querySelectorAll(".sim-check").length;
    const tooMany = count > 4;
    $("compareBtn").disabled = count < 2 || tooMany;
    $("compareBtn").title = tooMany ? "Porównać można najwyżej 4 symulacje" : (count < 2 ? "Zaznacz co najmniej 2 symulacje" : "");
    $("exportBtn").disabled = count === 0;
    $("deleteBulkBtn").disabled = count === 0;
    $("compareCount").textContent = count === 0 ? "" : `zaznaczono ${count}`;
    $("selectionLabel").textContent = count === 1 ? "1 symulacja" : `${count} ${count >= 2 && count <= 4 ? "symulacje" : "symulacji"}`;
    $("selectAllCb").checked = total > 0 && count === total;
    $("selectAllCb").indeterminate = count > 0 && count < total;
    show("simFooter", count > 0);
    document.body.classList.toggle("has-action-bar", count > 0);
}

function openSim(id) {
    window.location.href = "/sim?id=" + id;
}

document.addEventListener("DOMContentLoaded", () => {
    $("compareBtn").addEventListener("click", () => {
        const ids = selectedIds().join(",");
        if (ids) window.location.href = "/compare?ids=" + ids;
    });
    $("selectAllCb").addEventListener("change", (e) => {
        document.querySelectorAll(".sim-check").forEach((c) => {
            c.checked = e.target.checked;
            c.closest(".sim-card").classList.toggle("is-selected", c.checked);
        });
        updateCompareBtn();
    });
    $("clearSelectionBtn").addEventListener("click", () => {
        document.querySelectorAll(".sim-check").forEach((c) => {
            c.checked = false;
            c.closest(".sim-card").classList.remove("is-selected");
        });
        updateCompareBtn();
    });
    $("deleteBulkBtn").addEventListener("click", async () => {
        const ids = selectedIds();
        if (!ids.length) return;
        if (!confirm(`Usunąć ${ids.length} symulacji?`)) return;
        await api("/api/simulations/delete-bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
        });
        await loadSims();
    });
    $("exportBtn").addEventListener("click", async () => {
        const ids = selectedIds();
        if (!ids.length) return;
        const selected = await Promise.all(
            ids.map((id) => api(`/api/simulations/${id}`).catch(() => sims.find((s) => String(s.id) === String(id))))
        );
        const blob = new Blob([JSON.stringify(selected.filter(Boolean), null, 2)], {
            type: "application/json",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "symulacje_" + new Date().toISOString().slice(0, 10) + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
    });
    initAuth(async () => {
        show("simsPanel", true);
        await loadSims();
    });
});
