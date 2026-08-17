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
        const card = document.createElement("div");
        card.className = "sim-card";
        card.innerHTML = `
            <label class="sim-select">
                <input type="checkbox" class="sim-check" data-id="${s.id}" title="Wybierz do porównania">
            </label>
            <div class="sim-main" data-id="${s.id}" role="button" tabindex="0">
                <h3>${escapeHtml(s.name)}</h3>
                <p class="sim-meta">${s.updated_at ? new Date(s.updated_at).toLocaleString("pl-PL") : ""}${s.updated_at !== s.created_at && s.created_at ? " · zapisana " + new Date(s.created_at).toLocaleString("pl-PL") : ""}</p>
                <div class="sim-metrics">
                    <span><b>${fmtMoney(sum.peak_wealth)}</b> szczyt</span>
                    <span><b>${fmtMoney(sum.final_wealth)}</b> koniec</span>
                    <span><b>${fmtMoney(sum.total_withdrawn)}</b> wypłaty</span>
                    <span><b>${fmtMoney(sum.total_tax)}</b> podatki</span>
                </div>
                <p class="sim-meta">${sum.start_age != null ? "Wiek " + sum.start_age + "→" + sum.end_age : ""}${sum.years ? " · " + sum.years + " lat" : ""}${sum.warnings ? " · ⚠ " + sum.warnings : ""}</p>
                ${sum.stages && sum.stages.length > 0 ? '<div class="sim-stages">' + sum.stages.map(st => '<span class="sim-stage-badge">' + escapeHtml(st.label) + ' ' + st.start_age + '→' + st.end_age + ': ' + st.accounts.join(', ') + '</span>').join('') + '</div>' : ''}
            </div>
            <div class="sim-actions">
                <button type="button" class="btn btn-secondary sim-open" data-id="${s.id}" style="margin:0;">Otwórz</button>
                <button type="button" class="btn btn-secondary sim-dup" data-id="${s.id}" style="margin:0;">Duplikuj</button>
                <button type="button" class="btn btn-danger sim-del" data-id="${s.id}" style="margin:0;">Usuń</button>
            </div>
        `;
        card.querySelector(".sim-main").addEventListener("click", () => openSim(s.id));
        card.querySelector(".sim-main").addEventListener("keydown", (e) => {
            if (e.key === "Enter") openSim(s.id);
        });
        card.querySelector(".sim-open").addEventListener("click", () => openSim(s.id));
        card.querySelector(".sim-dup").addEventListener("click", async () => {
            await api(`/api/simulations/${s.id}/duplicate`, { method: "POST" });
            await loadSims();
        });
        card.querySelector(".sim-del").addEventListener("click", async () => {
            if (!confirm(`Usunąć symulację „${s.name}”?`)) return;
            await api(`/api/simulations/${s.id}`, { method: "DELETE" });
            await loadSims();
        });
        card.querySelector(".sim-check").addEventListener("change", updateCompareBtn);
        list.appendChild(card);
    });
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
