// sim-cards.js — Account card creation and field rendering

function fieldLabelHtml(fieldDef) {
    const suffix = fieldDef.percent ? (fieldDef.noNetto ? " (%)" : " (realne, %)") : "";
    return tipLabelHtml(fieldDef.label + suffix, fieldDef.hint);
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

const FIELD_DEFAULTS = {
    zus: {
        waloryzacja_skladek: () => CONFIG?.zus?.waloryzacja_skladek ?? 0,
        waloryzacja_swiadczenia: () => CONFIG?.zus?.waloryzacja_swiadczenia ?? 0,
        roi: () => CONFIG?.accounts?.zus?.default_roi ?? 0.04,
    },
    ppk: {
        employee_pct: () => CONFIG?.ppk?.employee_pct ?? 0,
        employer_pct: () => CONFIG?.ppk?.employer_pct ?? 0,
        roi: () => CONFIG?.accounts?.ppk?.default_roi ?? 0.04,
    },
    ppe: {
        employer_pct: 0.035,
        roi: () => CONFIG?.accounts?.ppe?.default_roi ?? 0.04,
    },
    lokata: {
        lokata_term_months: 12,
        roi: () => CONFIG?.accounts?.lokata?.default_roi ?? 0.01,
    },
};

let _genderCardSeq = 0;

function fieldDefault(accountKey, key) {
    const table = FIELD_DEFAULTS[accountKey];
    if (table && table[key] !== undefined) {
        const val = table[key];
        return typeof val === "function" ? val() : val;
    }
    if (key === "roi") {
        return CONFIG?.accounts?.[accountKey]?.default_roi ?? 0.04;
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
        const isStartingBalance = key === "starting_balance" || key === "starting_balance_ofe";

        if (fieldDef.type === "gender") {
            const uid = "gender-" + accountKey + "-" + (++_genderCardSeq);
            fieldsHtml += `
                <div class="field" ${visibleWhen}>
                    <label>${fieldLabelHtml(fieldDef)}</label>
                    <div class="segmented gender-options">
                        <label class="seg-option gender-option"><input type="radio" name="${uid}" value="k" /> Kobieta</label>
                        <label class="seg-option gender-option"><input type="radio" name="${uid}" value="m" checked /> Mężczyzna</label>
                    </div>
                </div>
            `;
            continue;
        }

        if (fieldDef.type === "checkbox") {
            fieldsHtml += `
                <div class="field field-checkbox" ${visibleWhen}>
                    <label>${fieldLabelHtml(fieldDef)}</label>
                    <input type="checkbox"
                           class="acc-field switch"
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
                <div class="field" ${visibleWhen}>
                    <label>${fieldLabelHtml(fieldDef)}</label>
                    <select class="acc-field select"
                            data-account="${accountKey}"
                            data-key="${key}">${options}</select>
                </div>
            `;
            continue;
        }

        fieldsHtml += `
            <div class="field${isStartingBalance ? " starting-balance-field" : ""}" ${visibleWhen}>
                <label>${fieldLabelHtml(fieldDef)}</label>
                ${numControlsHtml({
                    type: fieldDef.type || "number",
                    value: displayVal,
                    min: fieldDef.percent ? "-99" : "0",
                    step: fieldDef.step || "any",
                    aria: fieldDef.label || key,
                    attrs: ` data-account="${accountKey}" data-key="${key}"${fieldDef.percent ? ' data-percent="true"' : ""}${isStartingBalance ? ' data-starting-balance="true"' : ""}`,
                })}
                ${isStartingBalance ? '<div class="starting-balance-note" role="status" hidden></div>' : ""}
                ${chipsHtml}
            </div>
        `;
    }

    const headerTip = tipLabelHtml(meta.label, meta.description, meta.url);
    card.innerHTML = `
        <div class="account-card-header">
            <span class="account-card-icon">${ACCOUNT_ICONS[accountKey] || ""}</span>
            <h4>${headerTip}</h4>
            <button type="button" class="btn btn-ghost btn-icon btn-sm remove-account-btn" title="Usuń konto" aria-label="Usuń konto ${escapeHtml(meta.label)}">${iconSvg("x")}</button>
        </div>
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
        if (toggle) {
            toggle.classList.remove("active");
            toggle.setAttribute("aria-pressed", "false");
        }
        updateStageName(stageBlock);
        const container = document.getElementById("stages-container");
        updateStageHints(container);
        if (stageTypeOf(stageBlock) === "akumulacja") refreshRealizationToggles(container);
    });

    if (typeof _positionAllTips === "function") queueMicrotask(_positionAllTips);
    return card;
}
