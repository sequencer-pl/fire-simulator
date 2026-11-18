// results-banners.js — wspólne banery ostrzeżeń i błędów wyników.

(function () {
    const ICONS = {
        info: "info",
        warn: "warning",
        danger: "danger",
        success: "success",
    };

    function bannerElement(messages, variant) {
        const banner = document.createElement("div");
        banner.className = `banner banner-${variant}`;
        banner.innerHTML = `${window.iconSvg(ICONS[variant] || "info")}<div class="banner-body"></div>`;
        const body = banner.querySelector(".banner-body");
        if (messages.length === 1) {
            body.textContent = messages[0];
        } else {
            const list = document.createElement("ul");
            list.className = "banner-list";
            messages.forEach((message) => {
                const item = document.createElement("li");
                item.textContent = message;
                list.appendChild(item);
            });
            body.appendChild(list);
        }
        return banner;
    }

    function render(container, messages, options = {}) {
        if (!container) return;
        const list = (Array.isArray(messages) ? messages : [messages])
            .filter((message) => message != null && String(message).trim() !== "")
            .map(String);
        container.innerHTML = "";
        if (!list.length) return;

        const variant = options.variant || "warn";
        if (options.mode === "stack") {
            list.forEach((message) => {
                container.appendChild(bannerElement([message], variant));
            });
            return;
        }
        container.appendChild(bannerElement(list, variant));
    }

    function error(container, message) {
        render(container, [message], { variant: "danger", mode: "stack" });
    }

    window.ResultsBanners = { render, error, bannerElement };
})();
