// sim-cards.js — Account card creation and field rendering

function fieldLabelHtml(fieldDef) {
    const suffix = fieldDef.percent ? " (%)" : "";
    const tip = fieldDef.hint ? tipHtml(fieldDef.hint) : "";
    return `${fieldDef.label}${suffix}${tip}`;
}

function limitButtonsHtml(accountKey, fieldKey) {
    if (fieldKey !== "annual_contribution") return "";
    const defs = {
        ike: [{ key: "ike_annual", label: "MAX", title: "Limit roczny IKE" }],
        ikze: [
            { key: "ikze_annual", label: "MAX etat", title: "Limit roczny IKZE (etat)" },
            {
                key: "ikze_annual_self_employed",
                label: "MAX przeds.",
                title: "Limit roczny IKZE (przedsiębiorca)",
            },
        ],
        oipe: [{ key: "oipe_annual", label: "MAX", title: "Limit roczny OIPE" }],
        ppe: [
            {
                key: "ppe_additional_annual",
                label: "MAX dodatk.",
                title: "Limit roczny składki dodatkowej PPE",
            },
        ],
    };
    const btns = defs[accountKey];
    if (!btns) return "";
    return btns
        .map((b) => `<button type="button" class="max-btn" data-limit="${b.key}" title="${b.title}">${b.label}</button>`)
        .join("");
}

function fieldDefault(accountKey, key) {
    if (accountKey === "zus" && CONFIG && CONFIG.zus) {
        if (key === "waloryzacja_skladek" || key === "waloryzacja_swiadczenia") {
            return CONFIG.zus[key] ?? 0;
        }
    }
    if (accountKey === "ppk" && CONFIG && CONFIG.ppk) {
        if (key === "employee_pct") return CONFIG.ppk.employee_pct ?? 0;
        if (key === "employer_pct") return CONFIG.ppk.employer_pct ?? 0;
    }
    if (accountKey === "ppe" && key === "employer_pct") {
        return 0.035;
    }
    if (accountKey === "gotowka" && key === "roi") {
        return -0.025;
    }
    return 0;
}

function applyZusWaloryzacjaDefaults() {
    if (!CONFIG || !CONFIG.zus) return;
    document.querySelectorAll('.account-card[data-account="zus"]').forEach((card) => {
        ["waloryzacja_skladek", "waloryzacja_swiadczenia"].forEach((key) => {
            const input = card.querySelector(`[data-key="${key}"]`);
            if (input && !parseFloat(input.value)) {
                input.value = (CONFIG.zus[key] ?? 0) * 100;
            }
        });
    });
}

function applyFieldVisibility(card) {
    card.querySelectorAll("[data-visible-when]").forEach((el) => {
        const trigger = card.querySelector(`[data-key="${el.dataset.visibleWhen}"]`);
        el.style.display = trigger && trigger.checked ? "" : "none";
    });
}

function ikzeLimitKey(card) {
    const active = card.querySelector(".max-btn.active");
    return active && active.dataset.limit === "ikze_annual_self_employed"
        ? "ikze_annual_self_employed"
        : "ikze_annual";
}

function createAccountCard(stageType, accountKey, accountData) {
    const meta = getAccountMeta(stageType, accountKey);
    if (!meta) return null;

    const card = document.createElement("div");
    card.className = "account-card";
    card.dataset.account = accountKey;

    let fieldsHtml = "";
    for (const [key, fieldDef] of orderedFields(meta.fields)) {
        const visibleWhen = fieldDef.visible_when
            ? `data-visible-when="${fieldDef.visible_when}"`
            : "";
        let rawVal = accountData?.[key];
        if (rawVal === undefined) {
            if (fieldDef.type === "checkbox") {
                rawVal = accountKey === "ppk" && key === "state_topups";
            } else {
                rawVal = fieldDefault(accountKey, key);
            }
        }
        const displayVal = fieldDef.percent ? Math.round(rawVal * 100 * 100) / 100 : rawVal;
        const maxBtns = limitButtonsHtml(accountKey, key);
        const chipsHtml = maxBtns ? `<div class="max-chips">${maxBtns}</div>` : "";

        if (fieldDef.type === "checkbox") {
            fieldsHtml += `
                <div class="field-group field-checkbox" ${visibleWhen}>
                    <label>${fieldLabelHtml(fieldDef)}</label>
                    <input type="checkbox"
                           class="acc-field"
                           data-account="${accountKey}"
                           data-key="${key}"
                           ${rawVal ? "checked" : ""} />
                </div>
            `;
            continue;
        }

        if (fieldDef.type === "select") {
            const selected = String(rawVal);
            const options = (fieldDef.options || [])
                .map((o) => `<option value="${o.value}" ${String(o.value) === selected ? "selected" : ""}>${o.label}</option>`)
                .join("");
            fieldsHtml += `
                <div class="field-group" ${visibleWhen}>
                    <label>${fieldLabelHtml(fieldDef)}</label>
                    <select class="acc-field"
                            data-account="${accountKey}"
                            data-key="${key}">${options}</select>
                </div>
            `;
            continue;
        }

        fieldsHtml += `
            <div class="field-group" ${visibleWhen}>
                <label>${fieldLabelHtml(fieldDef)}</label>
                <div class="num-control">
                    <button type="button" class="stepper stepper-down" tabindex="-1" aria-label="Zmniejsz">&minus;</button>
                    <input type="${fieldDef.type || 'number'}"
                           class="acc-field"
                           data-account="${accountKey}"
                           data-key="${key}"
                           ${fieldDef.percent ? 'data-percent="true"' : ''}
                           value="${displayVal}"
                           ${fieldDef.step ? `step="${fieldDef.step}"` : 'step="any"'}
                           min="${fieldDef.percent ? -99 : 0}" />
                    <button type="button" class="stepper stepper-up" tabindex="-1" aria-label="Zwiększ">+</button>
                </div>
                ${chipsHtml}
            </div>
        `;
    }

    const headerTip = meta.description ? tipHtml(meta.description, meta.url) : "";
    card.innerHTML = `
        <h4>${meta.label}${headerTip}</h4>
        <button type="button" class="remove-account-btn" title="Usuń konto">&times;</button>
        <div class="fields-row">${fieldsHtml}</div>
    `;

    card.querySelectorAll("[data-key]").forEach((el) => {
        if (el.type !== "checkbox") return;
        el.addEventListener("change", () => {
            applyFieldVisibility(card);
            updateStageHints(document.getElementById("stages-container"));
        });
    });
    applyFieldVisibility(card);

    card.querySelectorAll(".max-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (!CONFIG || !CONFIG.limits) return;
            const limit = CONFIG.limits[btn.dataset.limit];
            if (!limit) return;
            const chips = btn.closest(".max-chips");
            if (chips) chips.querySelectorAll(".max-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const input = card.querySelector('[data-key="annual_contribution"]');
            if (input) {
                input.value = limit;
                updateStageHints(document.getElementById("stages-container"));
            }
        });
    });

    card.querySelector(".remove-account-btn").addEventListener("click", () => {
        const stageBlock = card.closest(".stage-block");
        const accountKey = card.dataset.account;
        card.closest(".accounts-grid").removeChild(card);
        const toggle = stageBlock.querySelector(
            `.accounts-toggles .account-toggle[data-account="${accountKey}"]`
        );
        if (toggle) toggle.classList.remove("active");
        updateStageName(stageBlock);
        const container = document.getElementById("stages-container");
        updateStageHints(container);
        if (stageTypeOf(stageBlock) === "akumulacja") refreshRealizationToggles(container);
    });

    return card;
}
