async function renderRecent(email) {
    let recents = [];
    try {
        recents = await api("/api/simulations");
    } catch (e) {
        console.error(e);
    }

    const shown = recents.slice(0, 3);
    $("greetingText").textContent = "Cześć, " + email + "! Masz " + recents.length + " symulacji.";
    show("recentEmpty", shown.length === 0);

    const list = $("recentList");
    list.innerHTML = "";
    shown.forEach((s) => {
        const item = document.createElement("a");
        item.className = "recent-item";
        item.href = "/sim?id=" + s.id;

        const name = document.createElement("div");
        name.className = "recent-item-name";
        name.textContent = String(s.name);

        const date = document.createElement("div");
        date.className = "recent-item-date";
        date.textContent = s.updated_at
            ? "Aktualizacja: " + new Date(s.updated_at).toLocaleString("pl-PL")
            : "";

        const main = document.createElement("div");
        main.className = "recent-item-main";
        main.appendChild(name);
        main.appendChild(date);

        const open = document.createElement("span");
        open.className = "recent-item-open";
        open.textContent = "Otwórz →";

        item.appendChild(main);
        item.appendChild(open);
        list.appendChild(item);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initAuth(async (email) => {
        show("recentSection", true);
        await renderRecent(email);
    });
});