// controls.js — wspólna obsługa kontrolek liczbowych (.num-control / .pct-control).
// Budowa HTML i delegowane wiązanie stepperów w jednym miejscu (4 kopie → 1).
// Zależności: stepInputValue (sim-utils.js) albo guardedNumberInputStep (percent-slider.js).

// Standardowy blok .num-control: steppery −/+ z etykietami a11y i pole liczbowe.
function numControlsHtml({
    type = "number",
    value = "0",
    min = "0",
    max = "",
    step = "",
    fieldClass = "",
    aria = "wartość",
    attrs = "",
    dataEmpty = null,
    name = "",
} = {}) {
    const de = dataEmpty != null ? ` data-empty="${dataEmpty}"` : "";
    const nm = name ? ` name="${name}"` : "";
    return `
        <div class="num-control">
            <button type="button" class="stepper stepper-down" tabindex="-1" aria-label="Zmniejsz ${aria}">&minus;</button>
            <input type="${type}" class="acc-field${fieldClass ? " " + fieldClass : ""}"${nm}
                   value="${value}" min="${min}" max="${max}" step="${step}"${de}${attrs}
                   aria-label="${aria}">
            <button type="button" class="stepper stepper-up" tabindex="-1" aria-label="Zwiększ ${aria}">+</button>
        </div>`;
}

// Delegowane wiązanie stepperów dla całego scope (document / .wizard / container).
// Opcjonalny stepFn precyzuje dziedziczenie (np. guardedNumberInputStep dla suwaków %).
function initNumControls(scope, stepFn) {
    scope.addEventListener("click", (e) => {
        const btn = e.target.closest(".num-control .stepper, .pct-control .stepper");
        if (!btn) return;
        const input = btn.closest(".pct-row, .num-control, .pct-control")?.querySelector(".acc-field");
        if (!input) return;
        if (input.value === "" && input.dataset.empty != null) {
            input.value = input.dataset.empty;
        }
        const fn = stepFn || stepInputValue;
        fn(input, btn.classList.contains("stepper-up") ? 1 : -1);
    });
}

// Kliknięcie w pole liczbowe/tekstowe zaznacza całą wartość — wpisywanie
// nadpisuje, zamiast dopisywać się do domyślnego „0” (Asystent i edytor).
document.addEventListener(
    "focusin",
    (e) => {
        const input = e.target;
        if (!input || !input.matches || !input.matches('input[type="number"], input[type="text"]')) return;
        if (typeof input.select !== "function") return;
        setTimeout(() => {
            if (document.activeElement === input) input.select();
        }, 0);
    },
    true
);