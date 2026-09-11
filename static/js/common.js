// Wspólne helpery oraz logika autoryzacji dla stron landing/simulations.
function $(id) {
    return document.getElementById(id);
}

function show(id, on) {
    $(id).classList.toggle("hidden", !on);
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
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

async function submitAuth(form, path, msgId, onAuthenticated) {
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
        show("authPanel", false);
        if (onAuthenticated) await onAuthenticated(res.email);
        if (window.refreshSessionBar) refreshSessionBar();
    } catch (e) {
        setMsg(msgId, e.message, false);
    }
}

function bindAuthForms(onAuthenticated) {
    if (!$("tabLogin")) return;
    $("tabLogin").addEventListener("click", () => switchAuthTab("login"));
    $("tabRegister").addEventListener("click", () => switchAuthTab("register"));
    $("loginForm").addEventListener("submit", (e) => {
        e.preventDefault();
        submitAuth(e.target, "/api/login", "loginMsg", onAuthenticated);
    });
    $("registerForm").addEventListener("submit", (e) => {
        e.preventDefault();
        submitAuth(e.target, "/api/register", "registerMsg", onAuthenticated);
    });
}

// Ustalanie stanu sesji: pokazuje panel auth lub woła onAuthenticated(email).
async function initAuth(onAuthenticated) {
    bindAuthForms(onAuthenticated);
    let email = null;
    try {
        const session = await api("/api/session");
        email = session.email || null;
    } catch (e) {
        console.error("Nie udało się odczytać sesji:", e);
    }
    show("authPanel", !email);
    if (email && onAuthenticated) await onAuthenticated(email);
    if (window.refreshSessionBar) refreshSessionBar();
    return email;
}

window.initAuth = initAuth;