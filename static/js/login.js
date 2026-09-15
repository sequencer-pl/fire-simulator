// Dedykowana strona logowania: po poprawnym logowaniu/rejestracji wracamy
// na stronę, z której user przeszedł (?next=). Tylko ścieżki samego originu.
function _safeNext(raw) {
    if (!raw) return "/moje-symulacje";
    try {
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return "/moje-symulacje";
        if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return "/moje-symulacje";
        if (url.pathname === "/login" || url.pathname.startsWith("/login")) return "/moje-symulacje";
        return url.pathname + url.search + url.hash;
    } catch (e) {
        return "/moje-symulacje";
    }
}

function _loginRedirect() {
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = _safeNext(next);
}

document.addEventListener("DOMContentLoaded", () => {
    initAuth(_loginRedirect);
});