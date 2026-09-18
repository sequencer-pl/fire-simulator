// Wspólny widget sesji/konta (avatar + e-mail + Wyloguj / Zaloguj) dla wszystkich widoków.
let currentUserEmail = null;
function getCurrentUserEmail() { return currentUserEmail; }
window.getCurrentUserEmail = getCurrentUserEmail;

const NAV_ICONS = {
    user: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    login: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',
    logout: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
};

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
                </span>
                <button type="button" class="icon-btn" id="logoutBtn" title="Wyloguj" aria-label="Wyloguj">${NAV_ICONS.logout}</button>
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
                <a href="/login?next=${next}" class="nav-item" title="Zaloguj / zarejestruj"
                   aria-label="Zaloguj / zarejestruj">${NAV_ICONS.login}<span>Zaloguj</span></a>
            `;
        }
    } catch (err) {
        console.error("Nie udało się odczytać sesji:", err);
    }
}

window.refreshSessionBar = refreshSessionBar;

// Primary nav: na /sim (edytor/konfiguracja) przełączamy widok bez przeładowania.
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".topnav a[data-nav]").forEach((a) => {
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
