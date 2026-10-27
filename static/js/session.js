// Wspólny widget sesji/konta (avatar + e-mail + Wyloguj / Zaloguj) dla wszystkich widoków.
let currentUserEmail = null;
function getCurrentUserEmail() { return currentUserEmail; }
window.getCurrentUserEmail = getCurrentUserEmail;

async function refreshSessionBar() {
    const widget = document.getElementById("accountWidget");
    if (!widget) return;
    try {
        const res = await fetch("/api/session");
        const session = await res.json();
        currentUserEmail = session.email || null;
        if (session.email) {
            const initial = escapeHtml(session.email.charAt(0).toUpperCase()) || "?";
            widget.innerHTML = `
                <span class="account-chip" title="${escapeHtml(session.email)}">
                    <span class="account-avatar">${initial}</span>
                    <span class="account-email">${escapeHtml(session.email)}</span>
                </span>
                <button type="button" class="btn btn-ghost btn-icon btn-sm" id="logoutBtn" title="Wyloguj" aria-label="Wyloguj">${iconSvg("logout")}</button>
            `;
            widget.querySelector("#logoutBtn").addEventListener("click", async () => {
                await fetch("/api/logout", { method: "POST" });
                if (window.location.pathname === "/") {
                    window.location.reload();
                } else {
                    window.location.href = "/";
                }
            });
        } else {
            const next = encodeURIComponent(window.location.pathname + window.location.search);
            widget.innerHTML = `
                <a href="/login?next=${next}" class="btn btn-secondary btn-sm" title="Zaloguj / zarejestruj"
                   aria-label="Zaloguj / zarejestruj">${iconSvg("login")}<span>Zaloguj</span></a>
            `;
        }
        document.body.classList.toggle("is-authenticated", Boolean(session.email));
    } catch (err) {
        console.error("Nie udało się odczytać sesji:", err);
    }
}

window.refreshSessionBar = refreshSessionBar;

// Primary nav: na /sim (edytor/konfiguracja) przełączamy widok bez przeładowania.
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".topnav a[data-nav], .tabbar a[data-nav]").forEach((a) => {
        a.addEventListener("click", (e) => {
            const section = document.body.dataset.section;
            const nav = a.dataset.nav;
            const switchable = nav === "edytor" || nav === "konfiguracja";
            if ((section === "edytor" || section === "konfiguracja") && switchable && typeof window.setNavSection === "function") {
                window.setNavSection(nav);
                e.preventDefault();
            }
        });
    });
    refreshSessionBar();
});
