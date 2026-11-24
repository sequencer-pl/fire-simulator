// results-charts.js — prototyp wspólnego silnika wykresów SVG.
// Obsługuje stacked area (jeden plan) i multi-line (porównanie planów).
// Docelowo trafi do produkcyjnych ekranów wyników.

(function () {
    const NS = "http://www.w3.org/2000/svg";
    const PAD = { top: 16, right: 18, bottom: 30, left: 58 };
    const instances = new WeakMap();
    let gradientSeq = 0;

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function accountColor(key) {
        const normalized = String(key || "other").replace(/_/g, "-");
        return cssVar(`--acct-${normalized}`) || cssVar("--acct-other");
    }

    function planColor(index) {
        return [
            cssVar("--primary"),
            cssVar("--stage-real"),
            cssVar("--warning"),
            cssVar("--acct-krypto"),
        ][index % 4];
    }

    function niceMax(value) {
        if (!(value > 0)) return 1;
        const exponent = Math.floor(Math.log10(value));
        const base = 10 ** exponent;
        const normalized = value / base;
        const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
        const step = steps.find((item) => normalized <= item) || 10;
        return step * base;
    }

    function compact(value) {
        return window.ResultsModel.fmtMoneyCompact(value);
    }

    function formatValue(value, spec) {
        if (spec.valueFormat) return spec.valueFormat(value);
        return window.ResultsModel.fmtMoney(value);
    }

    function clear(container) {
        const state = instances.get(container);
        if (state?.observer) state.observer.disconnect();
        instances.delete(container);
        container.innerHTML = "";
    }

    function makeSvg(width, height) {
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", String(height));
        svg.setAttribute("role", "img");
        svg.setAttribute("tabindex", "0");
        svg.classList.add("res-chart-svg");
        return svg;
    }

    function el(name, attrs = {}) {
        const node = document.createElementNS(NS, name);
        Object.entries(attrs).forEach(([key, value]) => {
            node.setAttribute(key, String(value));
        });
        return node;
    }

    function legend(target, series, options = {}) {
        if (!target) return;
        target.innerHTML = "";
        target.classList.add("res-chart-legend");
        series.forEach((item) => {
            const node = document.createElement("span");
            node.className = "res-chart-legend-item";
            node.innerHTML = `<span class="res-chart-swatch" style="--chart-color:${item.color}"></span><span>${window.escapeHtml(item.label)}</span>`;
            target.appendChild(node);
        });
        if (options.note) {
            const note = document.createElement("span");
            note.className = "res-chart-legend-note";
            note.textContent = options.note;
            target.appendChild(note);
        }
    }

    function tipHtml(age, series, values, spec, mode = "stacked") {
        const rows = series
            .map((item, index) => {
                const value = values[index] || 0;
                if (Math.abs(value) < 0.5) return "";
                return `<div class="res-chart-tip-row">
                    <span class="res-chart-tip-dot" style="background:${item.color}"></span>
                    <span class="res-chart-tip-label">${window.escapeHtml(item.label)}</span>
                    <span class="res-chart-tip-value">${formatValue(value, spec)}</span>
                </div>`;
            })
            .join("");
        let totalRow = "";
        if (mode === "line") {
            if (values.length >= 2) {
                totalRow = `<div class="res-chart-tip-total">
                    <span>Różnica</span>
                    <strong>${formatValue(values[0] - values[1], spec)}</strong>
                </div>`;
            }
        } else {
            const total = values.reduce((sum, value) => sum + value, 0);
            totalRow = `<div class="res-chart-tip-total">
                <span>Razem</span>
                <strong>${formatValue(total, spec)}</strong>
            </div>`;
        }
        return `<div class="res-chart-tip-title">Wiek ${age} r.ż.</div>${rows}${totalRow}`;
    }

    function bindTooltip(container, svg, spec, geometry, mode) {
        const tip = document.createElement("div");
        tip.className = "res-chart-tip";
        container.appendChild(tip);
        const hover = el("line", {
            class: "res-chart-hover-line",
            x1: 0,
            x2: 0,
            y1: geometry.top,
            y2: geometry.bottom,
            opacity: 0,
        });
        svg.appendChild(hover);

        let activeIndex = spec.ages.findIndex((_, index) =>
            spec.series.some((item) => Math.abs(item.values[index] || 0) > 0.5)
        );
        if (activeIndex < 0) activeIndex = 0;

        const showIndex = (index) => {
            const safeIndex = Math.max(0, Math.min(spec.ages.length - 1, index));
            activeIndex = safeIndex;
            const px = geometry.left +
                (safeIndex / Math.max(1, spec.ages.length - 1)) * geometry.plotWidth;
            hover.setAttribute("x1", px);
            hover.setAttribute("x2", px);
            hover.setAttribute("opacity", 0.55);
            const values = spec.series.map((item) => item.values[safeIndex] || 0);
            tip.innerHTML = tipHtml(spec.ages[safeIndex], spec.series, values, spec, mode);
            tip.classList.add("is-visible");
            const tipWidth = tip.offsetWidth || 190;
            const left = Math.max(8, Math.min(px + 14, geometry.width - tipWidth - 8));
            tip.style.left = `${left}px`;
            tip.style.top = "10px";
        };

        const show = (clientX) => {
            const rect = svg.getBoundingClientRect();
            const ratio = (clientX - rect.left) / Math.max(1, rect.width);
            const x = ratio * geometry.width;
            const index = Math.round(
                ((x - geometry.left) / Math.max(1, geometry.plotWidth)) *
                    (spec.ages.length - 1)
            );
            showIndex(index);
        };

        const hide = () => {
            tip.classList.remove("is-visible");
            hover.setAttribute("opacity", 0);
        };

        svg.addEventListener("mousemove", (event) => show(event.clientX));
        svg.addEventListener("mouseleave", hide);
        svg.addEventListener("focus", () => showIndex(activeIndex));
        svg.addEventListener("blur", hide);
        svg.addEventListener("keydown", (event) => {
            let next = null;
            if (event.key === "ArrowRight") next = activeIndex + 1;
            else if (event.key === "ArrowLeft") next = activeIndex - 1;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = spec.ages.length - 1;
            else if (event.key === "Escape") {
                hide();
                return;
            } else {
                return;
            }
            event.preventDefault();
            showIndex(next);
        });
        svg.addEventListener("touchstart", (event) => {
            const touch = event.touches[0];
            if (touch) show(touch.clientX);
        }, { passive: true });
        svg.addEventListener("touchmove", (event) => {
            const touch = event.touches[0];
            if (touch) show(touch.clientX);
        }, { passive: true });
    }

    function drawAxes(svg, spec, geometry) {
        const { left, top, plotWidth, plotHeight, maxValue, width, height } = geometry;
        const gridCount = 4;
        for (let index = 0; index <= gridCount; index += 1) {
            const ratio = index / gridCount;
            const y = top + plotHeight - ratio * plotHeight;
            const value = maxValue * ratio;
            svg.appendChild(el("line", {
                x1: left,
                x2: width - PAD.right,
                y1: y,
                y2: y,
                class: "res-chart-grid",
            }));
            const label = el("text", {
                x: left - 8,
                y: y + 4,
                "text-anchor": "end",
                class: "res-chart-axis-label",
            });
            label.textContent = compact(value);
            svg.appendChild(label);
        }

        const range = spec.ages[spec.ages.length - 1] - spec.ages[0];
        const step = range <= 20 ? 2 : range <= 40 ? 5 : 10;
        const first = Math.ceil(spec.ages[0] / step) * step;
        for (let age = first; age <= spec.ages[spec.ages.length - 1]; age += step) {
            const ratio = (age - spec.ages[0]) / Math.max(1, range);
            const x = left + ratio * plotWidth;
            const label = el("text", {
                x,
                y: height - 8,
                "text-anchor": "middle",
                class: "res-chart-axis-label",
            });
            label.textContent = age;
            svg.appendChild(label);
        }
    }

    function drawAnnotations(svg, spec, geometry) {
        if (!spec.annotations?.length) return;
        spec.annotations.forEach((annotation) => {
            const index = spec.ages.indexOf(annotation.age);
            if (index < 0) return;
            const range = spec.ages[spec.ages.length - 1] - spec.ages[0];
            const x = geometry.left +
                ((annotation.age - spec.ages[0]) / Math.max(1, range)) * geometry.plotWidth;
            svg.appendChild(el("line", {
                x1: x,
                x2: x,
                y1: geometry.top,
                y2: geometry.bottom,
                class: "res-chart-annotation-line",
            }));
            const label = el("text", {
                x: x + 4,
                y: geometry.top + 10,
                class: "res-chart-annotation-label",
            });
            label.textContent = annotation.label;
            svg.appendChild(label);
        });
    }

    function stackedArea(container, spec) {
        if (!container) return;
        clear(container);
        container.classList.add("res-chart-container");
        const width = Math.max(320, container.clientWidth || 640);
        const height = spec.height || 280;
        const ages = spec.ages;
        const series = spec.series.filter((item) =>
            item.values.some((value) => Math.abs(value) > 0.5)
        );
        if (!ages?.length || !series.length) return;

        const plotWidth = width - PAD.left - PAD.right;
        const plotHeight = height - PAD.top - PAD.bottom;
        const totals = ages.map((_, index) =>
            series.reduce((sum, item) => sum + (item.values[index] || 0), 0)
        );
        const maxValue = niceMax(Math.max(...totals));
        const geometry = {
            width,
            height,
            left: PAD.left,
            top: PAD.top,
            bottom: PAD.top + plotHeight,
            plotWidth,
            plotHeight,
            maxValue,
        };
        const x = (index) => PAD.left + (index / Math.max(1, ages.length - 1)) * plotWidth;
        const y = (value) => PAD.top + plotHeight - (value / maxValue) * plotHeight;

        const svg = makeSvg(width, height);
        svg.setAttribute("aria-label", `${spec.ariaLabel || "Wykres warstwowy"} Użyj strzałek, aby czytać wartości.`);
        drawAxes(svg, spec, geometry);
        drawAnnotations(svg, spec, geometry);

        const defs = el("defs");
        svg.appendChild(defs);
        let lower = new Array(ages.length).fill(0);
        series.forEach((item) => {
            gradientSeq += 1;
            const gradientId = `res-chart-gradient-${gradientSeq}`;
            const gradient = el("linearGradient", {
                id: gradientId,
                x1: 0,
                y1: 0,
                x2: 0,
                y2: 1,
            });
            gradient.appendChild(el("stop", {
                offset: "0%",
                "stop-color": item.color,
                "stop-opacity": 0.64,
            }));
            gradient.appendChild(el("stop", {
                offset: "100%",
                "stop-color": item.color,
                "stop-opacity": 0.12,
            }));
            defs.appendChild(gradient);

            const upper = lower.map((value, index) => value + (item.values[index] || 0));
            const topPath = upper.map((value, index) =>
                `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`
            ).join(" ");
            const bottomPath = [...lower].reverse().map((value, reverseIndex) => {
                const index = ages.length - 1 - reverseIndex;
                return `L${x(index).toFixed(2)},${y(value).toFixed(2)}`;
            }).join(" ");
            svg.appendChild(el("path", {
                d: `${topPath} ${bottomPath} Z`,
                fill: `url(#${gradientId})`,
                stroke: item.color,
                "stroke-width": 1.1,
                "stroke-opacity": 0.9,
                class: "res-chart-area",
            }));
            lower = upper;
        });

        bindTooltip(container, svg, { ...spec, series }, geometry, "stacked");
        container.appendChild(svg);
    }

    function multiLine(container, spec) {
        if (!container) return;
        clear(container);
        container.classList.add("res-chart-container");
        const width = Math.max(320, container.clientWidth || 640);
        const height = spec.height || 280;
        const ages = spec.ages;
        const series = spec.series.filter((item) =>
            item.values.some((value) => Math.abs(value) > 0.5)
        );
        if (!ages?.length || !series.length) return;

        const plotWidth = width - PAD.left - PAD.right;
        const plotHeight = height - PAD.top - PAD.bottom;
        const maxValue = niceMax(Math.max(...series.flatMap((item) => item.values)));
        const geometry = {
            width,
            height,
            left: PAD.left,
            top: PAD.top,
            bottom: PAD.top + plotHeight,
            plotWidth,
            plotHeight,
            maxValue,
        };
        const x = (index) => PAD.left + (index / Math.max(1, ages.length - 1)) * plotWidth;
        const y = (value) => PAD.top + plotHeight - (value / maxValue) * plotHeight;

        const svg = makeSvg(width, height);
        svg.setAttribute("aria-label", `${spec.ariaLabel || "Wykres porównawczy"} Użyj strzałek, aby czytać wartości.`);
        drawAxes(svg, spec, geometry);
        drawAnnotations(svg, spec, geometry);

        series.forEach((item) => {
            const path = item.values.map((value, index) =>
                `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value || 0).toFixed(2)}`
            ).join(" ");
            svg.appendChild(el("path", {
                d: path,
                fill: "none",
                stroke: item.color,
                "stroke-width": 2.4,
                "stroke-linecap": "round",
                "stroke-linejoin": "round",
                class: "res-chart-line",
            }));
        });

        bindTooltip(container, svg, { ...spec, series }, geometry, "line");
        container.appendChild(svg);
    }

    function observe(container, spec, mode) {
        if (typeof ResizeObserver === "undefined") return;
        const state = instances.get(container) || {};
        state.observer?.disconnect();
        state.width = container.clientWidth || 0;
        let timer = null;
        const observer = new ResizeObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const width = container.clientWidth || 0;
                if (width === state.width) return;
                // Pełny render odtwarza obserwator po clear() — bez tego
                // ResizeObserver zostawał rozłączony po pierwszej zmianie.
                render(container, spec, mode);
            }, 80);
        });
        observer.observe(container);
        state.observer = observer;
        instances.set(container, state);
    }

    function render(container, spec, mode = "stacked") {
        if (!container) return;
        if (mode === "line") multiLine(container, spec);
        else stackedArea(container, spec);
        observe(container, spec, mode);
    }

    window.ResultsCharts = {
        accountColor,
        planColor,
        legend,
        stackedArea: (container, spec) => render(container, spec, "stacked"),
        multiLine: (container, spec) => render(container, spec, "line"),
        destroy: clear,
    };
})();
