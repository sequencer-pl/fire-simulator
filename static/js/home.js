let sims = [];

function $(id) {
    return document.getElementById(id);
}

function show(id, on) {
    $(id).classList.toggle("hidden", !on);
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

async function refreshSession() {
    try {
        const session = await api("/api/session");
        const email = session.email;
        show("authPanel", !email);
        show("simsPanel", !!email);
        if (email) {
            await loadSims();
        }
        if (window.refreshSessionBar) refreshSessionBar();
    } catch (e) {
        console.error(e);
    }
}

async function loadSims() {
    sims = await api("/api/simulations");
    renderSims();
}

function renderSims() {
    const list = $("simsList");
    list.innerHTML = "";
    show("emptyMsg", sims.length === 0);
    show("simFooter", sims.length > 0);
    updateCompareBtn();

    sims.forEach((s) => {
        const sum = s.summary || {};
        const stages = sum.stages || [];
        const card = document.createElement("div");
        card.className = "sim-card";

        /* --- header --- */
        let headHtml = `
            <div class="sim-card-head">
                <label class="sim-card-check">
                    <input type="checkbox" class="sim-check" data-id="${s.id}" title="Wybierz do porównania">
                </label>
                <div class="sim-card-title">
                    <h3>${escapeHtml(s.name)}</h3>
                    <span class="sim-card-date">${fmtDate(sum, s)}</span>
                </div>
                <div class="sim-card-head-actions">
                    <button type="button" class="btn btn-primary sim-open" data-id="${s.id}">Otwórz</button>
                    <button type="button" class="btn btn-secondary sim-dup" data-id="${s.id}">Duplikuj</button>
                    <button type="button" class="btn btn-danger sim-del" data-id="${s.id}">Usuń</button>
                </div>
            </div>`;

        /* --- metrics --- */
        let metricsHtml = `<div class="sim-card-metrics">
            <div class="sim-metric"><span class="sim-metric-value green">${fmtMoney(sum.peak_wealth)}</span><span class="sim-metric-label">Szczyt</span></div>
            <div class="sim-metric"><span class="sim-metric-value">${fmtMoney(sum.final_wealth)}</span><span class="sim-metric-label">Na koniec</span></div>
            <div class="sim-metric"><span class="sim-metric-value accent">${fmtMoney(sum.total_withdrawn)}</span><span class="sim-metric-label">Wypłaty netto</span></div>
            <div class="sim-metric"><span class="sim-metric-value red">${fmtMoney(sum.total_tax)}</span><span class="sim-metric-label">Podatki</span></div>
        </div>`;

        /* --- info line --- */
        let infoParts = [];
        if (sum.start_age != null && sum.end_age != null)
            infoParts.push(`${sum.start_age}→${sum.end_age} r.ż.`);
        if (sum.years) infoParts.push(`${sum.years} lat`);
        if (sum.accounts && sum.accounts.length)
            infoParts.push(`${sum.accounts.length} kont`);
        if (sum.has_pension) infoParts.push("emerytura ZUS");
        let infoHtml = "";
        if (infoParts.length || sum.warnings) {
            infoHtml = `<div class="sim-card-info"><span>${infoParts.join(" · ")}</span>`;
            if (sum.warnings) infoHtml += `<span class="warn">⚠ ${sum.warnings} ostrzeż.</span>`;
            infoHtml += `</div>`;
        }

        /* --- stages timeline --- */
        let stagesHtml = "";
        if (stages.length > 0) {
            stagesHtml = `<div class="sim-card-stages"><div class="sim-timeline">`;
            stages.forEach((st) => {
                const kind = /akumulacja/i.test(st.label) ? "accum" : "withdraw";
                const accounts = (st.accounts || [])
                    .map(a => `<span class="sim-acc-pill">${escapeHtml(a)}</span>`)
                    .join("");
                let financeHtml = "";
                if (st.monthly_contribution) {
                    financeHtml = `<span class="sim-timeline-finance accum">~${fmtMoney(st.monthly_contribution)} zł/mies.</span>`;
                } else if (st.avg_monthly_withdrawal) {
                    financeHtml = `<span class="sim-timeline-finance withdraw">~${fmtMoney(st.avg_monthly_withdrawal)} zł/mies.</span>`;
                }
                stagesHtml += `
                    <div class="sim-timeline-row">
                        <div class="sim-timeline-marker">
                            <div class="sim-timeline-dot ${kind === "withdraw" ? "realizacja" : ""}"></div>
                            <div class="sim-timeline-line"></div>
                        </div>
                        <div class="sim-timeline-body">
                            <span class="sim-timeline-label ${kind}">${escapeHtml(st.label)}</span>
                            <span class="sim-timeline-age">${st.start_age}→${st.end_age} r.ż.</span>
                            ${accounts}
                            ${financeHtml}
                        </div>
                    </div>`;
            });
            stagesHtml += `</div></div>`;
        }

        card.innerHTML = headHtml + metricsHtml + infoHtml + stagesHtml;

        /* --- events --- */
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
        card.querySelector(".sim-check").addEventListener("change", updateCompareBtn);
        card.addEventListener("click", (e) => {
            if (e.target.closest("button") || e.target.closest("input")) return;
            openSim(s.id);
        });
        list.appendChild(card);
    });
}

function fmtDate(sum, s) {
    const parts = [];
    if (s.updated_at) parts.push(new Date(s.updated_at).toLocaleString("pl-PL"));
    if (s.created_at && s.updated_at !== s.created_at)
        parts.push("utw. " + new Date(s.created_at).toLocaleString("pl-PL"));
    return parts.join(" · ");
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
}

function updateCompareBtn() {
    const checked = document.querySelectorAll(".sim-check:checked");
    const count = checked.length;
    $("compareBtn").disabled = count === 0 || count > 4;
    $("compareCount").textContent = count === 0 ? "" : "zaznaczono: " + count;
}

function openSim(id) {
    window.location.href = "/sim?id=" + id;
}

function switchAuthTab(tab) {
    const login = tab === "login";
    $("tabLogin").classList.toggle("active", login);
    $("tabRegister").classList.toggle("active", !login);
    show("loginForm", login);
    show("registerForm", !login);
}

function setMsg(id, text, ok) {
    const el = $(id);
    if (!text) {
        el.textContent = "";
        show(id, false);
        return;
    }
    el.textContent = text;
    el.className = "form-msg " + (ok ? "ok" : "err");
    show(id, true);
}

async function submitAuth(form, path, msgId) {
    const data = new FormData(form);
    setMsg(msgId, "");
    try {
        const res = await api(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: data.get("email"),
                password: data.get("password"),
            }),
        });
        setMsg(msgId, "Zalogowano jako " + res.email + ".", true);
        await refreshSession();
    } catch (e) {
        setMsg(msgId, e.message, false);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    $("tabLogin").addEventListener("click", () => switchAuthTab("login"));
    $("tabRegister").addEventListener("click", () => switchAuthTab("register"));
    $("loginForm").addEventListener("submit", (e) => {
        e.preventDefault();
        submitAuth(e.target, "/api/login", "loginMsg");
    });
    $("registerForm").addEventListener("submit", (e) => {
        e.preventDefault();
        submitAuth(e.target, "/api/register", "registerMsg");
    });
    $("compareBtn").addEventListener("click", () => {
        const ids = Array.from(document.querySelectorAll(".sim-check:checked"))
            .map((c) => c.dataset.id)
            .join(",");
        if (ids) window.location.href = "/compare?ids=" + ids;
    });
    refreshSession();
});
