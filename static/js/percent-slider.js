// percent-slider.js — suwak ze snapem do predefiniowanych wartości procentowych.
// Gęste kroki przy wartościach realistycznych, rzadkie przy ekstremach (snap do ticków).
// Pole liczbowe (.acc-field) pozostaje kanonem wartości; suwak tylko go synchronizuje.

const INFLATION_TICKS = [-1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 5, 10, 30];

function formatPctTick(v) {
    return String(v).replace(".", ",");
}

function nearestTickIndex(ticks, value) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < ticks.length; i++) {
        const d = Math.abs(ticks[i] - value);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

function snapToTick(ticks, value) {
    if (!ticks.length) return value;
    return ticks[nearestTickIndex(ticks, value)];
}

function tickStep(ticks, value, dir) {
    if (dir > 0) {
        for (let i = 0; i < ticks.length; i++) {
            if (ticks[i] > value + 1e-9) return ticks[i];
        }
        return ticks[ticks.length - 1];
    }
    for (let i = ticks.length - 1; i >= 0; i--) {
        if (ticks[i] < value - 1e-9) return ticks[i];
    }
    return ticks[0];
}

// Stepper −/+: jeśli pole ma data-ticks, porusza się po siatce ticków;
// w przeciwnym razie używa klasycznego stepInputValue (input.step).
function guardedNumberInputStep(input, dir) {
    const ticksJson = input && input.dataset ? input.dataset.ticks : null;
    if (!ticksJson) {
        stepInputValue(input, dir);
        return;
    }
    let ticks = null;
    try {
        ticks = JSON.parse(ticksJson);
    } catch (err) {
        stepInputValue(input, dir);
        return;
    }
    const raw = input.value === "" ? null : parseFloat(input.value);
    let next;
    if (Number.isFinite(raw)) {
        next = tickStep(ticks, raw, dir);
    } else {
        next = tickStep(ticks, snapToTick(ticks, 0), dir);
    }
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

// percentSlider(container, opts) — renderuje suwak do containera.
// opts: { ticks, value (%|null = dziedziczenie), fallback (%), onChange(tick) }
// Zwraca { setValue(v) } aby odzwierciedlić wpisane/załadowane wartości z zewnątrz.
function percentSlider(container, opts) {
    const ticks = opts.ticks || [];
    const wrap = document.createElement("div");
    wrap.className = "pct-slider";

    const row = document.createElement("div");
    row.className = "pct-slider-row";

    const range = document.createElement("input");
    range.type = "range";
    range.className = "pct-slider-range";
    range.min = 0;
    range.max = String(ticks.length - 1);
    range.step = 1;

    const chip = document.createElement("span");
    chip.className = "pct-slider-value";
    chip.textContent = "—";

    row.appendChild(range);
    row.appendChild(chip);

    const labels = document.createElement("div");
    labels.className = "pct-slider-labels";
    const shown = [ticks[0], ticks[Math.floor(ticks.length / 2)], ticks[ticks.length - 1]];
    for (const t of shown) {
        const s = document.createElement("span");
        s.textContent = formatPctTick(t) + "%";
        labels.appendChild(s);
    }

    wrap.appendChild(row);
    wrap.appendChild(labels);

    function setValue(v) {
        if (typeof v === "number" && Number.isFinite(v)) {
            range.value = String(nearestTickIndex(ticks, v));
            chip.textContent = formatPctTick(v) + "%";
            chip.classList.remove("is-inherit");
        } else {
            const fallback = typeof opts.fallback === "number" ? opts.fallback : 0;
            range.value = String(nearestTickIndex(ticks, fallback));
            chip.textContent = "—";
            chip.classList.add("is-inherit");
        }
    }

    range.addEventListener("input", () => {
        const t = ticks[parseInt(range.value, 10)];
        if (t === undefined) return;
        chip.textContent = formatPctTick(t) + "%";
        chip.classList.remove("is-inherit");
        if (typeof opts.onChange === "function") opts.onChange(t);
    });

    container.appendChild(wrap);
    setValue(opts.value != null ? opts.value : null);

    return { setValue };
}