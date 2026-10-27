// landing.js — strona startowa: dla zalogowanych lista trzech ostatnich symulacji.

async function renderRecent(email) {
    let recents = [];
    try {
        recents = await api("/api/simulations");
    } catch (e) {
        console.error(e);
    }

    const shown = recents.slice(0, 3);
    const count = recents.length;
    const noun = count === 1 ? "symulację" : (count >= 2 && count <= 4 ? "symulacje" : "symulacji");
    $("greetingText").textContent = `Cześć, ${email}. Masz ${count} ${noun}.`;
    show("recentEmpty", shown.length === 0);

    const list = $("recentList");
    list.innerHTML = "";
    shown.forEach((s) => {
        const sum = s.summary || {};
        const item = document.createElement("a");
        item.className = "card card-link recent-item";
        item.href = "/sim?id=" + s.id;
        const stages = (sum.stages || []).map((st) => {
            const kind = /akumulacja/i.test(st.label) ? "chip-accum" : "chip-real";
            return `<span class="chip ${kind}">${escapeHtml(st.label)} ${st.start_age}–${st.end_age}</span>`;
        }).join("");
        item.innerHTML = `
            <div class="recent-item-main">
                <div class="recent-item-name">${escapeHtml(s.name)}</div>
                <div class="recent-item-meta">${s.updated_at ? "Aktualizacja " + fmtDateTime(s.updated_at) : ""}</div>
                <div class="chip-row">${stages}</div>
            </div>
            <div class="recent-item-side">
                <span class="metric-label">Wypłaty netto</span>
                <span class="recent-item-value">${fmtMoney(sum.total_withdrawn)}</span>
            </div>
            ${iconSvg("arrow", "recent-item-arrow")}
        `;
        list.appendChild(item);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initAuth(async (email) => {
        show("recentSection", true);
        await renderRecent(email);
    });
});
