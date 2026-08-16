// Wspólny pasek sesji (e-mail + Wyloguj / Zaloguj) dla wszystkich widoków.
async function refreshSessionBar() {
    const bar = document.getElementById("sessionBar");
    if (!bar) return;
    try {
        const res = await fetch("/api/session");
        const session = await res.json();
        if (session.email) {
            bar.innerHTML = `
                <span class="session-email">${escapeHtml(session.email)}</span>
                <button type="button" class="btn btn-secondary" style="margin:0;">Wyloguj</button>
            `;
            bar.querySelector("button").addEventListener("click", async () => {
                await fetch("/api/logout", { method: "POST" });
                if (window.location.pathname === "/") {
                    window.location.reload();
                } else {
                    window.location.href = "/";
                }
            });
        } else {
            bar.innerHTML = `<a href="/" class="btn btn-secondary" style="margin:0;">Zaloguj</a>`;
        }
    } catch (err) {
        console.error("Nie udało się odczytać sesji:", err);
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

window.refreshSessionBar = refreshSessionBar;

document.addEventListener("DOMContentLoaded", () => {
    refreshSessionBar();
});
