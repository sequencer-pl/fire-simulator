let stageIndex = 0;

// --- Tooltipy (ikona "?", dymek, opcjonalny link) ---

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const ACCOUNT_ICONS = {
    broker: "📈",
    lokata: "🏦",
    gotowka: "💵",
    ike: "🐷",
    ikze: "🧾",
    oipe: "🎯",
    ppk: "🏢",
    ppe: "💼",
    oki_inw: "📊",
    oki_osk: "💰",
    krypto: "₿",
    zus: "🏛️",
};

function tipHtml(text, url, icon = "?") {
    const link = url
        ? ` <a href="${url}" target="_blank" rel="noopener">Więcej…</a>`
        : "";
    return ` <span class="tip" tabindex="0">${icon}<span class="tooltip">${escapeHtml(text)}${link}</span></span>`;
}

function fieldLabelHtml(fieldDef) {
    const suffix = fieldDef.percent ? " (%)" : "";
    const tip = fieldDef.hint ? tipHtml(fieldDef.hint) : "";
    return `${fieldDef.label}${suffix}${tip}`;
}

function getAccountMeta(stageType, accountKey) {
    const meta = STAGE_TYPES[stageType];
    if (!meta || !meta.available_accounts) return null;
    return meta.available_accounts[accountKey] || null;
}

function getAvailableAccounts(stageType) {
    const meta = STAGE_TYPES[stageType];
    if (!meta || !meta.available_accounts) return {};
    return meta.available_accounts;
}

const FIELD_ORDER = [
    "starting_balance",
    "starting_balance_ofe",
    "ofe_member",
    "monthly_base",
    "annual_contribution",
    "employee_pct",
    "employer_pct",
    "state_topups",
    "roi",
    "waloryzacja_skladek",
    "waloryzacja_swiadczenia",
    "buffer",
    "monthly_pension",
];

function orderedFields(fields) {
    const entries = Object.entries(fields);
    const rank = (key) => {
        const i = FIELD_ORDER.indexOf(key);
        return i === -1 ? FIELD_ORDER.length : i;
    };
    const byRank = (a, b) => rank(a[0]) - rank(b[0]);

    const triggers = new Set();
    entries.forEach(([, def]) => {
        if (def.visible_when) triggers.add(def.visible_when);
    });

    const result = entries.filter(([key, def]) => !def.visible_when && !triggers.has(key)).sort(byRank);
    const triggerEntries = entries.filter(([key]) => triggers.has(key)).sort(byRank);

    triggerEntries.forEach(([tKey, tDef]) => {
        result.push([tKey, tDef]);
        const deps = entries.filter(([key, def]) => def.visible_when === tKey).sort(byRank);
        result.push(...deps);
    });

    return result;
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

function countDecimals(value) {
    const s = String(value);
    const dot = s.indexOf(".");
    if (dot === -1) return 0;
    return s.length - dot - 1;
}

function stepInputValue(input, dir) {
    let step = parseFloat(input.step);
    if (!Number.isFinite(step) || step <= 0) step = 1;
    const min = input.min === "" ? null : parseFloat(input.min);
    const max = input.max === "" ? null : parseFloat(input.max);
    let val = (parseFloat(input.value) || 0) + dir * step;
    if (min !== null && Number.isFinite(min) && val < min) val = min;
    if (max !== null && Number.isFinite(max) && val > max) val = max;
    const places = Math.max(countDecimals(input.value), countDecimals(step));
    input.value = places > 0 ? val.toFixed(places) : String(Math.round(val));
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function applyFieldVisibility(card) {
    card.querySelectorAll("[data-visible-when]").forEach((el) => {
        const trigger = card.querySelector(`[data-key="${el.dataset.visibleWhen}"]`);
        el.style.display = trigger && trigger.checked ? "" : "none";
    });
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

function getActiveAccounts(stageBlock) {
    const accounts = [];
    stageBlock.querySelectorAll(".accounts-grid .account-card").forEach(card => {
        accounts.push(card.dataset.account);
    });
    return accounts;
}

function updateStageName(stageBlock) {
    const stageType = stageTypeOf(stageBlock);
    const nameInput = stageBlock.querySelector(".stage-name");
    const accounts = getActiveAccounts(stageBlock);

    if (stageType === "akumulacja") {
        nameInput.value = "Akumulacja";
        return;
    }

    const labels = accounts.map(a => ACCOUNT_LABELS[a] || a);
    nameInput.value = labels.join("+") || "Realizacja";
}

function accumulatedAccounts(container) {
    const set = new Set();
    if (!container) return set;
    container.querySelectorAll('.stage-block[data-stage-type="akumulacja"] .account-card').forEach((card) => {
        set.add(card.dataset.account);
    });
    return set;
}

function refreshRealizationToggles(container) {
    if (!container) return;
    container.querySelectorAll('.stage-block[data-stage-type="realizacja"]').forEach((block) => {
        renderAccountToggles(block);
    });
}

function renderAccountToggles(stageBlock) {
    const stageType = stageTypeOf(stageBlock);
    const accountsContainer = stageBlock.querySelector(".accounts-grid");
    const togglesContainer = stageBlock.querySelector(".accounts-toggles");
    const available = getAvailableAccounts(stageType);

    const activeAccounts = new Set();
    accountsContainer.querySelectorAll(".account-card").forEach(card => {
        activeAccounts.add(card.dataset.account);
    });

    const accumulated = stageType === "realizacja"
        ? accumulatedAccounts(stageBlock.closest("#stages-container") || document.getElementById("stages-container"))
        : null;

    togglesContainer.innerHTML = "";
    for (const [key, meta] of Object.entries(available)) {
        if (stageType === "realizacja" && !activeAccounts.has(key) && !accumulated.has(key)) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "account-toggle" + (activeAccounts.has(key) ? " active" : "");
        btn.dataset.account = key;
        const tip = meta.description
            ? tipHtml(meta.description, meta.url, ACCOUNT_ICONS[key] || "?")
            : "";
        btn.innerHTML = `${tip}<span class="account-toggle-label">${meta.label}</span>`;

        btn.addEventListener("click", () => {
            if (btn.classList.contains("active")) {
                btn.classList.remove("active");
                const existing = accountsContainer.querySelector(`[data-account="${key}"]`);
                if (existing) accountsContainer.removeChild(existing);
            } else {
                btn.classList.add("active");
                const card = createAccountCard(stageType, key, {});
                if (card) accountsContainer.appendChild(card);
            }
            updateStageName(stageBlock);
            const container = document.getElementById("stages-container");
            updateStageHints(container);
            if (stageType === "akumulacja") refreshRealizationToggles(container);
        });

        togglesContainer.appendChild(btn);
    }
}

function stageKindClass(stageType) {
    const meta = STAGE_TYPES[stageType];
    return meta && meta.type === "withdrawal" ? "stage-realizacja" : "stage-akumulacja";
}

function createStageBlock(defaults) {
    const stageType = defaults?.stage_type || "akumulacja";
    const cfg = STAGE_TYPES[stageType] || {};
    const accounts = defaults?.accounts || {};
    const idx = stageIndex++;

    const block = document.createElement("div");
    block.className = "stage-block " + stageKindClass(stageType);
    block.dataset.index = idx;
    block.dataset.stageType = stageType;
    block.draggable = true;

    block.innerHTML = `
        <div class="stage-actions">
            <button type="button" class="move-btn move-up" title="Przesuń w górę">&uarr;</button>
            <button type="button" class="move-btn move-down" title="Przesuń w dół">&darr;</button>
            <button type="button" class="remove-btn" title="Usuń etap">&times;</button>
        </div>
        <div class="stage-header">
            <div class="field-group">
                <label>Typ etapu</label>
                <span class="stage-type-badge ${stageKindClass(stageType)}">${cfg.label || stageType}</span>
            </div>
            <div class="field-group">
                <label>Nazwa</label>
                <input type="text" class="stage-name" value="${defaults?.name || cfg.label || ""}" />
            </div>
            <div class="field-group">
                <label>Wiek start</label>
                <div class="num-control">
                    <button type="button" class="stepper stepper-down" tabindex="-1" aria-label="Zmniejsz wiek start">&minus;</button>
                    <input type="number" class="acc-field start-age" value="${defaults?.start_age ?? 40}" min="0" max="120" />
                    <button type="button" class="stepper stepper-up" tabindex="-1" aria-label="Zwiększ wiek start">+</button>
                </div>
            </div>
            <div class="field-group">
                <label>Wiek koniec${tipHtml("Wiek końca etapu (wyłączny) — etap obejmuje lata od wieku start do wieku koniec minus 1.")}</label>
                <div class="num-control">
                    <button type="button" class="stepper stepper-down" tabindex="-1" aria-label="Zmniejsz wiek koniec">&minus;</button>
                    <input type="number" class="acc-field end-age" value="${defaults?.end_age ?? 60}" min="0" max="120" />
                    <button type="button" class="stepper stepper-up" tabindex="-1" aria-label="Zwiększ wiek koniec">+</button>
                </div>
            </div>
        </div>
        <div class="accounts-toggles"></div>
        <div class="accounts-grid"></div>
        <div class="stage-hint hidden"></div>
    `;

    block.querySelector(".move-up").addEventListener("click", () => moveStage(block, "up"));
    block.querySelector(".move-down").addEventListener("click", () => moveStage(block, "down"));
    block.querySelector(".remove-btn").addEventListener("click", () => {
        block.remove();
        const container = document.getElementById("stages-container");
        updateStageButtons(container);
        updateStageHints(container);
        refreshRealizationToggles(container);
    });

    const grid = block.querySelector(".accounts-grid");
    for (const [key, accData] of Object.entries(accounts)) {
        const card = createAccountCard(stageType, key, accData);
        if (card) grid.appendChild(card);
    }

    renderAccountToggles(block);

    return block;
}

// --- Subtelne ostrzeżenia o konfiguracji etapu ---

function renderStageHints(hintEl, hints) {
    if (!hintEl) return;
    hintEl.classList.remove("error");
    hintEl.innerHTML = "";
    if (!hints.length) {
        hintEl.classList.add("hidden");
        return;
    }
    const list = document.createElement("ul");
    list.className = "stage-hint-list";
    hints.forEach((h) => {
        const li = document.createElement("li");
        li.className = "hint-" + (h.level || "info");
        li.textContent = h.text;
        list.appendChild(li);
    });
    hintEl.appendChild(list);
    hintEl.classList.remove("hidden");
}

function updateStageHints(container) {
    if (!container) return;
    const blocks = getStageBlocks(container);
    const lastEnd = lastAkumulacjaEnd(blocks);

    if (CONFIG) {
        const accumulated = accumulatedAccounts(container);
        blocks.forEach((block) => {
        const hint = block.querySelector(".stage-hint");
        if (!hint) return;
        const stageType = stageTypeOf(block);
        const startAge = parseInt(block.querySelector(".start-age").value) || 0;
        const hints = [];

        if (stageType === "realizacja") {
            const cards = block.querySelectorAll(".account-card");
            cards.forEach((card) => {
                const acc = card.dataset.account;
                if (!accumulated.has(acc)) {
                    hints.push({
                        level: "warning",
                        text:
                            `${ACCOUNT_LABELS[acc] || acc} nie ma etapu akumulacji — ` +
                            `nie ma skąd wypłacać kapitału.`
                    });
                }
                if (acc === "zus") {
                    const pensionInput = card.querySelector('[data-key="monthly_pension"]');
                    const pension = parseFloat(pensionInput?.value) || 0;
                    const em = pensionAge(CONFIG);
                    if (pension <= 0 && em !== null && startAge < em) {
                        hints.push({
                            level: "warning",
                            text:
                                `ZUS wyliczany z kapitału od ${startAge} r.ż. — przed powszechnym wiekiem ` +
                                `emerytalnym (${em} r.ż.). Realnie świadczenie nie przysługuje wcześniej.`
                        });
                    }
                    return;
                }
                const rules = CONFIG.accounts[acc];
                if (!rules || !rules.min_withdrawal_age) return;
                const label = ACCOUNT_LABELS[acc] || acc;
                if (startAge < rules.min_withdrawal_age) {
                    if (rules.early_tax_model === "scale") {
                        const lower = Math.round(CONFIG.rate_lower * 100);
                        const upper = Math.round(CONFIG.rate_upper * 100);
                        hints.push({
                            level: "warning",
                            text:
                                `${label} wypłacane od ${startAge} r.ż. — przed ${rules.min_withdrawal_age} r.ż. ` +
                                `jednorazowy zwrot całości w pierwszym roku (podatek wg skali ${lower}/${upper}% od całości); ` +
                                `wypłaty ratalne liczone od kapitału netto. Po ${rules.min_withdrawal_age} r.ż. ${normalTaxDescription(acc)}.`
                        });
                    } else {
                        hints.push({
                            level: "warning",
                            text:
                                `${label} wypłacane od ${startAge} r.ż. — przed ${rules.min_withdrawal_age} r.ż. ` +
                                `opodatkowanie ${earlyTaxDescription(acc)}. Po ${rules.min_withdrawal_age} r.ż. ${normalTaxDescription(acc)}.`
                        });
                    }
                }
            });
            if (!cards.length && accumulated.size === 0) {
                hints.push({
                    level: "info",
                    text:
                        "Najpierw dodaj etap akumulacji, aby wybrać konta do wypłaty."
                });
            }
        } else if (stageType === "akumulacja") {
            block.querySelectorAll(".account-card").forEach((card) => {
                const acc = card.dataset.account;
                if (acc === "zus") {
                    const baseInput = card.querySelector('[data-key="monthly_base"]');
                    const base = parseFloat(baseInput?.value) || 0;
                    if (CONFIG.zus && base > 0) {
                        const cap = CONFIG.zus.limit_base_annual;
                        const annual = Math.min(base * 12, cap && cap > 0 ? cap : Infinity);
                        const skladka = annual * CONFIG.zus.skladka_rate;
                        const walInput = card.querySelector('[data-key="waloryzacja_skladek"]');
                        const wal = parseFloat(walInput?.value) / 100;
                        hints.push({
                            level: "info",
                            text:
                                `Składka roczna ≈ ${skladka.toLocaleString("pl-PL")} zł ` +
                                `(19,52% podstawy), kapitał waloryzowany ` +
                                `${((Number.isFinite(wal) ? wal : CONFIG.zus.waloryzacja_skladek) * 100).toFixed(0)}% realnie.`
                        });
                        const ofeCb = card.querySelector('[data-key="ofe_member"]');
                        if (ofeCb && ofeCb.checked) {
                            hints.push({
                                level: "info",
                                text:
                                    `Członek OFE: ${(CONFIG.zus.ofe_rate * 100).toFixed(2)} pkt składki rośnie wg ROI w OFE, reszta waloryzowana w ZUS.`
                            });
                        }
                    }
                    return;
                }
                if (acc === "ppk") {
                    const base = parseFloat(card.querySelector('[data-key="monthly_base"]')?.value) || 0;
                    if (base > 0) {
                        const empPct = (parseFloat(card.querySelector('[data-key="employee_pct"]')?.value) || 0) / 100;
                        const emp = (parseFloat(card.querySelector('[data-key="employer_pct"]')?.value) || 0) / 100;
                        const totalPct = (empPct + emp) * 100;
                        const annual = base * 12 * (empPct + emp);
                        const stateCb = card.querySelector('[data-key="state_topups"]');
                        const state = CONFIG.ppk ? CONFIG.ppk.state_annual : 240;
                        const total = annual + (stateCb && stateCb.checked ? state : 0);
                        hints.push({
                            level: "info",
                            text:
                                `Wpłaty do PPK ≈ ${total.toLocaleString("pl-PL")} zł/rok ` +
                                `(pracownik + pracodawca = ${totalPct.toFixed(1)}% podstawy` +
                                `${stateCb && stateCb.checked ? ` + dopłata państwa ${state.toLocaleString("pl-PL")} zł` : ""}).`
                        });
                        if (totalPct > 8) {
                            hints.push({
                                level: "warning",
                                text: `Suma wpłat do PPK (${totalPct.toFixed(1)}%) przekracza ustawowy limit 8%.`
                            });
                        }
                    }
                    return;
                }
                if (acc === "ppe") {
                    const base = parseFloat(card.querySelector('[data-key="monthly_base"]')?.value) || 0;
                    const empPct = (parseFloat(card.querySelector('[data-key="employer_pct"]')?.value) || 0) / 100;
                    const add = parseFloat(card.querySelector('[data-key="annual_contribution"]')?.value) || 0;
                    const employer = base * 12 * empPct;
                    if (base > 0 || add > 0) {
                        hints.push({
                            level: "info",
                            text:
                                `Składki do PPE ≈ ${(employer + add).toLocaleString("pl-PL")} zł/rok ` +
                                `(podstawowa pracodawcy ${employer.toLocaleString("pl-PL")} zł, dodatkowa ${add.toLocaleString("pl-PL")} zł).`
                        });
                        if (empPct * 100 > 7) {
                            hints.push({
                                level: "warning",
                                text: `Składka podstawowa PPE (${(empPct * 100).toFixed(1)}%) przekracza ustawowy limit 7%.`
                            });
                        }
                        const addLimit = CONFIG.limits?.ppe_additional_annual;
                        if (addLimit && add > addLimit) {
                            hints.push({
                                level: "warning",
                                text:
                                    `Składka dodatkowa PPE (${add.toLocaleString("pl-PL")} zł/rok) przekracza roczny limit ${addLimit.toLocaleString("pl-PL")} zł.`
                            });
                        }
                    }
                    return;
                }
                if (acc === "gotowka") {
                    const roiInput = card.querySelector('[data-key="roi"]');
                    const roi = (parseFloat(roiInput?.value) || 0) / 100;
                    if (roi < 0) {
                        const bal = parseFloat(card.querySelector('[data-key="starting_balance"]')?.value) || 0;
                        const loss = bal > 0 ? ` (~${Math.round(bal * -roi).toLocaleString("pl-PL")} zł/rok od salda)` : "";
                        hints.push({
                            level: "info",
                            text: `Gotówka realnie traci ${(roi * 100).toFixed(1)}% wartości rocznie${loss}.`
                        });
                    }
                    return;
                }
                if (acc === "oki_inw" || acc === "oki_osk") {
                    const rules = CONFIG.accounts && CONFIG.accounts[acc];
                    if (rules && rules.tax_model === "assets") {
                        const exemption = rules.asset_exemption || 0;
                        const rate = (rules.asset_tax_rate * 100).toFixed(2);
                        const contrib = parseFloat(card.querySelector('[data-key="annual_contribution"]')?.value) || 0;
                        const bal = parseFloat(card.querySelector('[data-key="starting_balance"]')?.value) || 0;
                        const label = ACCOUNT_LABELS[acc] || acc;
                        const text =
                            acc === "oki_osk"
                                ? `${label}: w ramach wspólnego limitu OKI (100 000 zł) zwolnione do ${exemption.toLocaleString("pl-PL")} zł; nadwyżka — podatek od wartości aktywów ${rate}%/rok od nadwyżki średniego stanu (niezależnie od zysku).`
                                : `${label}: bez Belki do wspólnego limitu OKI (100 000 zł); powyżej — podatek od wartości aktywów ${rate}%/rok od nadwyżki średniego stanu (niezależnie od zysku).`;
                        const over = bal > exemption ? ` Obecne saldo przekracza próg ${exemption.toLocaleString("pl-PL")} zł.` : "";
                        hints.push({ level: "info", text: text + over });
                        if (contrib > exemption) {
                            hints.push({
                                level: "warning",
                                text: `Dopłata roczna (${contrib.toLocaleString("pl-PL")} zł) przekracza próg zwolnienia ${exemption.toLocaleString("pl-PL")} zł.`
                            });
                        }
                    }
                    return;
                }
                if (acc === "krypto") {
                    hints.push({
                        level: "info",
                        text:
                            "Krypto: 19% od zysku przy sprzedaży za złotówki (PIT-38, FIFO); " +
                            "zamiana krypto→krypto neutralna podatkowo (koszt nabycia przechodzi dalej)."
                    });
                    return;
                }
                const contribInput = card.querySelector('[data-key="annual_contribution"]');
                if (!contribInput) return;
                const contrib = parseFloat(contribInput.value) || 0;
                const limitKey =
                    acc === "ike"
                        ? "ike_annual"
                        : acc === "ikze"
                        ? ikzeLimitKey(card)
                        : acc === "oipe"
                        ? "oipe_annual"
                        : null;
                const limit = CONFIG.limits[limitKey];
                if (!limit || contrib <= limit) return;
                const label = ACCOUNT_LABELS[acc] || acc;
                hints.push({
                    level: "warning",
                    text:
                        `Dopłaty na ${label} (${contrib.toLocaleString("pl-PL")} zł/rok) przekraczają roczny limit ${limit.toLocaleString("pl-PL")} zł.`
                });
            });
        }

        renderStageHints(hint, hints);
        });
    }
    const valid = validateStageOrder(container);
    updateSimulateButton(valid);
}

// Miękka blokada: etap realizacji nie może zaczynać się przed końcem akumulacji.
function validateStageOrder(container) {
    let valid = true;
    const blocks = getStageBlocks(container);
    const lastEnd = lastAkumulacjaEnd(blocks);

    blocks.forEach((block) => {
        const startInput = block.querySelector(".start-age");
        const startControl = startInput ? startInput.closest(".num-control") : null;
        const hint = block.querySelector(".stage-hint");
        if (startInput) startInput.classList.remove("input-error");
        if (startControl) startControl.classList.remove("input-error");
        if (hint) hint.classList.remove("error");

        if (stageTypeOf(block) !== "realizacja") return;
        const startAge = parseInt(startInput.value, 10) || 0;
        const bad = lastEnd !== null && startAge < lastEnd;
        if (!bad) return;

        valid = false;
        if (startInput) startInput.classList.add("input-error");
        if (startControl) startControl.classList.add("input-error");
        if (hint) {
            const msg = `Etap realizacji musi zaczynać się ≥ ${lastEnd} r.ż. (koniec akumulacji).`;
            if (hint.firstChild) {
                const li = document.createElement("li");
                li.className = "hint-error";
                li.textContent = msg;
                hint.firstChild.appendChild(li);
            } else {
                const list = document.createElement("ul");
                list.className = "stage-hint-list";
                const li = document.createElement("li");
                li.className = "hint-error";
                li.textContent = msg;
                list.appendChild(li);
                hint.appendChild(list);
            }
            hint.classList.remove("hidden");
        }
    });

    if (!orderIsValid(blocks)) valid = false;
    return valid;
}

function updateSimulateButton(valid) {
    const btn = document.getElementById("simulateBtn");
    if (btn) btn.disabled = !valid;
}

function earlyTaxDescription(acc) {
    const rules = CONFIG.accounts[acc];
    if (rules.early_tax_model === "scale") {
        return `skalą ${(CONFIG.rate_lower * 100).toFixed(0)}/${(CONFIG.rate_upper * 100).toFixed(0)}% od całości`;
    }
    if (rules.early_tax_model === "flat") {
        return `ryczałtem ${(rules.early_tax_rate * 100).toFixed(0)}% od zysku`;
    }
    return "bez podatku";
}

function normalTaxDescription(acc) {
    const rules = CONFIG.accounts[acc];
    if (rules.tax_model === "scale") return `skala PIT`;
    if (rules.tax_model === "flat") {
        const basis = rules.tax_basis === "full" ? "całości" : "zysku";
        return `ryczałt ${(rules.tax_rate * 100).toFixed(0)}% od ${basis}`;
    }
    return "bez podatku";
}

// --- Reordering etapów ---

function stageTypeOf(block) {
    return block.dataset.stageType || "akumulacja";
}

function ikzeLimitKey(card) {
    const active = card.querySelector(".max-btn.active");
    return active && active.dataset.limit === "ikze_annual_self_employed"
        ? "ikze_annual_self_employed"
        : "ikze_annual";
}

function getStageBlocks(container) {
    return Array.from(container.querySelectorAll(".stage-block"));
}

// Realizacja musi być ciągłym sufiksem listy (żaden kafelek akumulacji pod realizacją).
function orderIsValid(blocks) {
    let seenRealizacja = false;
    for (const block of blocks) {
        if (stageTypeOf(block) === "realizacja") {
            seenRealizacja = true;
        } else if (seenRealizacja) {
            return false;
        }
    }
    return true;
}

// Najpóźniejszy wiek końca etapów akumulacji (null, gdy brak akumulacji).
function lastAkumulacjaEnd(blocks) {
    let maxEnd = null;
    for (const block of blocks) {
        if (stageTypeOf(block) !== "akumulacja") continue;
        const end = parseInt(block.querySelector(".end-age").value, 10) || 0;
        if (maxEnd === null || end > maxEnd) maxEnd = end;
    }
    return maxEnd;
}

function moveStage(block, direction) {
    const container = document.getElementById("stages-container");
    const blocks = getStageBlocks(container);
    const index = blocks.indexOf(block);
    const target = direction === "up" ? blocks[index - 1] : blocks[index + 1];
    if (!target) return;

    const simulated = blocks.slice();
    const [moved] = simulated.splice(index, 1);
    simulated.splice(direction === "up" ? index - 1 : index + 1, 0, moved);
    if (!orderIsValid(simulated)) return;

    if (direction === "up") {
        container.insertBefore(block, target);
    } else {
        container.insertBefore(target, block);
    }
    updateStageButtons(container);
    updateStageHints(container);
}

function updateStageButtons(container) {
    const blocks = getStageBlocks(container);
    blocks.forEach((block, i) => {
        const upBtn = block.querySelector(".move-up");
        const downBtn = block.querySelector(".move-down");
        const above = blocks[i - 1];
        const below = blocks[i + 1];
        const isRealizacja = stageTypeOf(block) === "realizacja";

        let upDisabled = i === 0;
        if (isRealizacja && above && stageTypeOf(above) === "akumulacja") upDisabled = true;
        if (upBtn) upBtn.disabled = upDisabled;

        let downDisabled = i === blocks.length - 1;
        if (!isRealizacja && below && stageTypeOf(below) === "realizacja") downDisabled = true;
        if (downBtn) downBtn.disabled = downDisabled;
    });
    updateDivider(container);
}

// Separator między fazami akumulacji i realizacji (linia wizualna).
function updateDivider(container) {
    container.querySelectorAll(".phase-divider").forEach((d) => d.remove());

    const blocks = getStageBlocks(container);
    const firstRealIndex = blocks.map(stageTypeOf).indexOf("realizacja");
    if (firstRealIndex === -1) return;

    const lastEnd = lastAkumulacjaEnd(blocks);
    const ageHtml = lastEnd === null
        ? ""
        : `<span class="phase-divider-age">wiek: <strong>${lastEnd}</strong> lat</span>`;

    const divider = document.createElement("div");
    divider.className = "phase-divider";
    divider.innerHTML = `
        <span class="phase-divider-label">Akumulacja <span class="phase-divider-arrow">&rarr;</span> Realizacja</span>
        ${ageHtml}
    `;
    container.insertBefore(divider, blocks[firstRealIndex]);
}

function addAccumulationStage(container) {
    const block = createStageBlock(null);
    const firstRealizacja = getStageBlocks(container).find((b) => stageTypeOf(b) === "realizacja");
    if (firstRealizacja) {
        container.insertBefore(block, firstRealizacja);
    } else {
        container.appendChild(block);
    }
    updateStageButtons(container);
    updateStageHints(container);
}

// --- Drag & drop etapów ---

let dragSource = null;

function clearDragMarkers(container) {
    container.querySelectorAll(".dragging, .drag-before, .drag-after, .drag-invalid").forEach((el) => {
        el.classList.remove("dragging", "drag-before", "drag-after", "drag-invalid");
    });
}

function dropWouldBreakOrder(dragSource, target, after) {
    const container = document.getElementById("stages-container");
    const blocks = getStageBlocks(container);
    const srcIdx = blocks.indexOf(dragSource);
    const tgtIdx = blocks.indexOf(target);
    const simulated = blocks.slice();
    const [moved] = simulated.splice(srcIdx, 1);
    let insertAt = tgtIdx + (after ? 1 : 0);
    if (insertAt > simulated.length) insertAt = simulated.length;
    simulated.splice(insertAt, 0, moved);
    return !orderIsValid(simulated);
}

function initDragDrop(container) {
    container.addEventListener("dragstart", (e) => {
        const block = e.target.closest(".stage-block");
        if (!block) return;
        dragSource = block;
        block.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "");
    });

    container.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        clearDragMarkers(container);
        if (dragSource) dragSource.classList.add("dragging");
        const block = e.target.closest(".stage-block");
        if (!block || block === dragSource) return;
        const rect = block.getBoundingClientRect();
        const after = e.clientY - rect.top > rect.height / 2;
        if (dropWouldBreakOrder(dragSource, block, after)) {
            e.dataTransfer.dropEffect = "none";
            block.classList.add("drag-invalid");
            return;
        }
        block.classList.toggle("drag-after", after);
        block.classList.toggle("drag-before", !after);
    });

    container.addEventListener("drop", (e) => {
        e.preventDefault();
        const block = e.target.closest(".stage-block");
        clearDragMarkers(container);
        if (!block || !dragSource || block === dragSource) return;
        const rect = block.getBoundingClientRect();
        const after = e.clientY - rect.top > rect.height / 2;
        if (dropWouldBreakOrder(dragSource, block, after)) return;
        if (after) {
            container.insertBefore(dragSource, block.nextSibling);
        } else {
            container.insertBefore(dragSource, block);
        }
        updateStageButtons(container);
        updateStageHints(container);
    });

    container.addEventListener("dragend", () => {
        clearDragMarkers(container);
        dragSource = null;
    });
}

function gatherFormData() {
    const stages = [];
    document.querySelectorAll(".stage-block").forEach((block) => {
        const accounts = {};
        block.querySelectorAll(".acc-field").forEach((input) => {
            const acc = input.dataset.account;
            const key = input.dataset.key;
            if (!acc || !key) return;
            if (!accounts[acc]) accounts[acc] = {};
            let val;
            if (input.type === "checkbox") {
                val = input.checked;
            } else if (input.tagName === "SELECT") {
                val = parseFloat(input.value) || 0;
            } else {
                val = parseFloat(input.value) || 0;
                if (input.dataset.percent) val /= 100;
            }
            accounts[acc][key] = val;
        });
        block.querySelectorAll(".account-card").forEach((card) => {
            const acc = card.dataset.account;
            if (acc !== "ikze" || !card.querySelector('[data-key="annual_contribution"]')) return;
            if (!accounts[acc]) accounts[acc] = {};
            accounts[acc].ikze_limit =
                ikzeLimitKey(card) === "ikze_annual_self_employed" ? "self_employed" : "etat";
        });

        stages.push({
            stage_type: block.dataset.stageType,
            name: block.querySelector(".stage-name").value,
            start_age: parseInt(block.querySelector(".start-age").value) || 0,
            end_age: parseInt(block.querySelector(".end-age").value) || 0,
            accounts: accounts,
        });
    });

    return { stages: stages, max_age: 100, gender: currentGender(), config: CONFIG };
}

function currentGender() {
    const checked = document.querySelector('input[name="gender"]:checked');
    return checked ? checked.value : "m";
}

function setGender(value) {
    const radio = document.querySelector(`input[name="gender"][value="${value}"]`);
    if (radio) radio.checked = true;
}

function pensionAge(config) {
    if (!config || !config.zus) return null;
    const z = config.zus;
    if (currentGender() === "k") {
        return z.wiek_emerytalny_k ?? z.wiek_emerytalny ?? 60;
    }
    return z.wiek_emerytalny_m ?? z.wiek_emerytalny ?? 65;
}

function formatMoney(val) {
    if (val === 0) return "—";
    return val.toLocaleString("pl-PL", { maximumFractionDigits: 0 }) + " zł";
}

function renderResults(data) {
    const container = document.getElementById("results");
    const thead = document.querySelector("#resultsTable thead");
    const tbody = document.querySelector("#resultsTable tbody");
    const summary = document.getElementById("summary");
    const warnings = document.getElementById("warnings");

    const accounts = data.accounts || [];

    thead.innerHTML = "";
    const headerRow = document.createElement("tr");
    headerRow.innerHTML = `
        <th class="col-age">Wiek</th>
        <th class="col-stage">Etap</th>
        ${accounts.map(a => `<th data-col="${a}">${ACCOUNT_LABELS[a] || a}</th>`).join("")}
        <th data-col="wealth">Majątek</th>
        <th data-col="annual">Wypłata roczna</th>
        <th data-col="monthly">Wypłata mies.</th>
        <th data-col="tax">Podatek</th>
    `;
    thead.appendChild(headerRow);

    tbody.innerHTML = "";

    warnings.innerHTML = "";
    (data.warnings || []).forEach((w) => {
        const div = document.createElement("div");
        div.className = "warning-item";
        div.textContent = "!" + " " + w;
        warnings.appendChild(div);
    });

    summary.innerHTML = `
        <div class="summary-card">
            <div class="label">Majątek szczytowy</div>
            <div class="value accent">${formatMoney(data.peak_wealth)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Majątek końcowy</div>
            <div class="value accent">${formatMoney(data.final_wealth)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Suma wypłat</div>
            <div class="value green">${formatMoney(data.total_withdrawn)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Suma podatków</div>
            <div class="value red">${formatMoney(data.total_tax)}</div>
        </div>
    `;

    const total = data.years.length;
    const hasPension = data.has_pension;
    data.years.forEach((y, i) => {
        const tr = document.createElement("tr");
        if (y.annual_withdrawal > 0) tr.classList.add("highlight");

        if (hasPension) {
            const fadeIndex = total - 3;
            if (i >= fadeIndex && total > 3) {
                const fadeLevel = i - fadeIndex;
                tr.classList.add(`fade-${fadeLevel}`);
            }
        }

        const balanceCells = accounts.map(a => {
            const val = y.balances?.[a] || 0;
            return `<td class="amount" data-col="${a}">${formatMoney(val)}</td>`;
        }).join("");

        const isLast = i === total - 1;
        tr.innerHTML = `
            <td class="col-age">${y.age}${isLast && hasPension ? '<span class="plus-suffix">+</span>' : ''}</td>
            <td class="col-stage">${y.stage_name}</td>
            ${balanceCells}
            <td class="amount" data-col="wealth"><strong>${formatMoney(y.total_wealth)}</strong></td>
            <td class="amount" data-col="annual">${formatMoney(y.annual_withdrawal)}</td>
            <td class="amount" data-col="monthly">${formatMoney(y.monthly_withdrawal)}</td>
            <td class="amount" data-col="tax">${formatMoney(y.tax_paid)}</td>
        `;
        tbody.appendChild(tr);
    });

    renderColumnToggles(accounts);
    applyColVisibility();
    applyDensity();
    renderWealthChart(data);

    container.style.display = "block";
    container.scrollIntoView({ behavior: "smooth" });
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("stages-container");
    const params = new URLSearchParams(location.search);
    const simId = params.get("id");

    initModeToggle();
    initConfig();
    refreshSessionBar();
    initSaveButton();
    initResultsControls();
    initStageEventHandlers(container);

    if (simId) {
        loadSimulation(simId, container);
    } else {
        (DEFAULTS.stages || []).forEach((s) => container.appendChild(createStageBlock(s)));
        updateStageButtons(container);
        updateStageHints(container);
        refreshRealizationToggles(container);
    }
});

function initStageEventHandlers(container) {
    document.getElementById("addAccumulationBtn").addEventListener("click", () => addAccumulationStage(container));

    document.getElementById("addRealizationBtn").addEventListener("click", () => {
        const blocks = getStageBlocks(container);
        const last = blocks[blocks.length - 1];
        const prevEnd = last ? parseInt(last.querySelector(".end-age").value, 10) : NaN;
        const start = Number.isFinite(prevEnd) ? prevEnd : 40;
        const block = createStageBlock({
            stage_type: "realizacja",
            name: "Realizacja",
            start_age: start,
            end_age: start + 5,
        });
        container.appendChild(block);
        updateStageButtons(container);
        updateStageHints(container);
    });

    document.getElementById("clearStagesBtn").addEventListener("click", () => {
        if (!confirm("Na pewno wyczyścić wszystkie etapy?")) return;
        container.querySelectorAll(".stage-block").forEach((b) => b.remove());
        const results = document.getElementById("results");
        if (results) results.style.display = "none";
        updateStageButtons(container);
        updateStageHints(container);
    });

    initDragDrop(container);
    updateStageButtons(container);
    updateStageHints(container);

    // Odświeżanie subtelnych podpowiedzi przy edycji pól
    container.addEventListener("input", () => {
        updateStageHints(container);
        updateDivider(container);
    });

    // Steppery −/+ we wszystkich kontrolkach numerycznych (pola kont i wiek etapów)
    container.addEventListener("click", (e) => {
        const btn = e.target.closest(".num-control .stepper");
        if (!btn) return;
        const input = btn.parentElement.querySelector(".acc-field");
        if (!input) return;
        stepInputValue(input, btn.classList.contains("stepper-up") ? 1 : -1);
    });

    // Kliknięcie w pole zaznacza całą wartość (wpisywanie nadpisuje, bez backspace)
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

    const simForm = document.getElementById("simForm");
    document.getElementById("simulateBtn").addEventListener("click", () => {
        simForm.requestSubmit();
    });

    simForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!validateStageOrder(container)) {
            alert("Etap realizacji nie może zaczynać się przed końcem etapu akumulacji.");
            return;
        }
        const data = gatherFormData();

        try {
            const res = await fetch("/api/simulate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            const result = await res.json();
            if (result.error) {
                alert("Błąd: " + result.error);
            } else {
                renderResults(result);
                lastInput = data;
                lastResult = result;
                document.getElementById("saveSimBtn").disabled = false;
            }
        } catch (err) {
            alert("Błąd połączenia: " + err.message);
        }
    });
}

// --- Tryby: Symulator / Konfiguracja ---

function initModeToggle() {
    document.getElementById("modeSimBtn").addEventListener("click", () => switchMode("sim"));
    document.getElementById("modeConfigBtn").addEventListener("click", () => switchMode("config"));
}

function switchMode(mode) {
    document.getElementById("modeSimBtn").classList.toggle("active", mode === "sim");
    document.getElementById("modeConfigBtn").classList.toggle("active", mode === "config");
    document.getElementById("simulatorView").classList.toggle("hidden", mode !== "sim");
    document.getElementById("configView").classList.toggle("hidden", mode !== "config");
}

// --- Konfiguracja (podatki, limity, reguły kont) ---

const ACCOUNT_LABELS = {
    broker: "Broker",
    gotowka: "Gotówka",
    ike: "IKE",
    ikze: "IKZE",
    krypto: "Krypto",
    lokata: "Lokata",
    oipe: "OIPE",
    oki_inw: "OKI inwestycyjne",
    oki_osk: "OKI oszczędnościowe",
    ppe: "PPE",
    ppk: "PPK",
    zus: "ZUS (emerytura)",
};

const TAX_MODEL_LABELS = { none: "Brak", flat: "Ryczałt", scale: "Skala PIT", assets: "Od wartości aktywów" };
const TAX_BASIS_LABELS = { gains: "od zysku", full: "od całości" };
let CONFIG = null;
let DEFAULT_CONFIG = null;

async function initConfig() {
    try {
        const res = await fetch("/api/config");
        DEFAULT_CONFIG = await res.json();
        CONFIG = DEFAULT_CONFIG;
        applyZusWaloryzacjaDefaults();
        renderConfigView();
        updateStageHints(document.getElementById("stages-container"));
        document.getElementById("configResetBtn").addEventListener("click", resetConfig);
    } catch (err) {
        console.error("Nie udało się wczytać konfiguracji:", err);
    }
}

// Uzupełnia brakujące klucze wczytanego configu domyślnymi (stare zapisane symulacje).
function backfillConfig(config) {
    if (!DEFAULT_CONFIG) return config;
    const out = {};
    for (const [section, defaults] of Object.entries(DEFAULT_CONFIG)) {
        const loaded = config[section];
        if (loaded && typeof defaults === "object" && defaults !== null && !Array.isArray(defaults)) {
            out[section] = { ...defaults, ...loaded };
        } else {
            out[section] = loaded !== undefined ? loaded : defaults;
        }
    }
    return out;
}

function setConfigPath(path, value) {
    const parts = path.split(".");
    let obj = CONFIG;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
}

function renderConfigView() {
    const root = document.getElementById("config-content");
    root.innerHTML = "";

    root.appendChild(configSection("Skala podatkowa", [
        configNumberField("kwota_wolna", "Kwota wolna od podatku", CONFIG.kwota_wolna, "Kwota wolna od podatku (2026 r.: 30 000 zł)."),
        configNumberField("prog", "Próg podatkowy", CONFIG.prog, "Próg dochodowy: powyżej kwoty obowiązuje wyższa stawka (2026 r.: 120 000 zł)."),
        configPercentField("rate_lower", "Stawka niższa", CONFIG.rate_lower, "Stawka podatku do progu (2026 r.: 12%)."),
        configPercentField("rate_upper", "Stawka wyższa", CONFIG.rate_upper, "Stawka podatku powyżej progu (2026 r.: 32%)."),
    ]));

    root.appendChild(configSection("Limity rocznych wpłat", [
        configNumberField("limits.ike_annual", "IKE", CONFIG.limits.ike_annual, "Limit roczny wpłat na IKE (2026 r.: 28 260 zł)."),
        configNumberField("limits.ikze_annual", "IKZE — etat", CONFIG.limits.ikze_annual, "Limit roczny IKZE dla zatrudnionych (2026 r.: 11 304 zł)."),
        configNumberField("limits.ikze_annual_self_employed", "IKZE — przedsiębiorca", CONFIG.limits.ikze_annual_self_employed, "Limit roczny IKZE dla przedsiębiorców (2026 r.: 16 956 zł)."),
        configNumberField("limits.oipe_annual", "OIPE", CONFIG.limits.oipe_annual, "Limit roczny wpłat na OIPE (2026 r.: 28 260 zł)."),
        configNumberField("limits.ppe_additional_annual", "PPE — składka dodatkowa", CONFIG.limits.ppe_additional_annual, "Limit roczny składki dodatkowej PPE (2026 r.: 42 390 zł)."),
    ]));

    root.appendChild(configSection("PPK — parametry", [
        configPercentField("ppk.employee_pct", "Wpłata pracownika", CONFIG.ppk.employee_pct, "Ustawowo min. 2% wynagrodzenia; można obniżyć do 0,5%."),
        configPercentField("ppk.employer_pct", "Wpłata pracodawcy", CONFIG.ppk.employer_pct, "Ustawowo min. 1,5%, max 4% wynagrodzenia."),
        configPercentField("ppk.max_total_pct", "Limit sumy wpłat", CONFIG.ppk.max_total_pct, "Ustawowy limit łącznej sumy wpłat pracownika i pracodawcy (8%)."),
        configNumberField("ppk.state_welcoming", "Dopłata powitalna", CONFIG.ppk.state_welcoming, "Jednorazowa dopłata państwa w pierwszym roku akumulacji (250 zł)."),
        configNumberField("ppk.state_annual", "Dopłata roczna", CONFIG.ppk.state_annual, "Coroczna dopłata państwa przy wpłacie min. 0,5% (240 zł)."),
    ]));

    root.appendChild(configSection("PPE — parametry", [
        configPercentField("ppe.max_employer_pct", "Limit składki podstawowej", CONFIG.ppe.max_employer_pct, "Ustawowy limit składki podstawowej pracodawcy (7% wynagrodzenia)."),
    ]));

    root.appendChild(configSection("ZUS — parametry", [
        configPercentField("zus.skladka_rate", "Składka emerytalna", CONFIG.zus.skladka_rate, "Część składki na ubezpieczenie emerytalne (19,52% podstawy)."),
        configPercentField("zus.ofe_rate", "Część składki do OFE", CONFIG.zus.ofe_rate, "Punkt procentowy składki trafiający do OFE dla członków OFE (2,92 pkt)."),
        configNumberField("zus.limit_base_annual", "Limit rocznej podstawy (30×)", CONFIG.zus.limit_base_annual, "Roczna podstawa wymiaru składek (30× przeciętne wynagrodzenie; 0 = brak limitu)."),
        configPercentField("zus.waloryzacja_skladek", "Waloryzacja składek", CONFIG.zus.waloryzacja_skladek, "Roczna waloryzacja kapitału zgromadzonego w ZUS."),
        configPercentField("zus.waloryzacja_swiadczenia", "Waloryzacja świadczenia", CONFIG.zus.waloryzacja_swiadczenia, "Roczna waloryzacja wypłacanej emerytury."),
        configNumberField("zus.wiek_emerytalny_k", "Wiek emerytalny — kobiety", CONFIG.zus.wiek_emerytalny_k, "Powszechny wiek emerytalny kobiet (60 r.ż. od 1.10.2017)."),
        configNumberField("zus.wiek_emerytalny_m", "Wiek emerytalny — mężczyźni", CONFIG.zus.wiek_emerytalny_m, "Powszechny wiek emerytalny mężczyzn (65 r.ż. od 1.10.2017)."),
        configNumberField("zus.min_emerytura", "Emerytura minimalna", CONFIG.zus.min_emerytura, "Najniższa gwarantowana emerytura (2026 r.: 1 740 zł)."),
    ]));

    const accountsSection = document.createElement("div");
    accountsSection.className = "config-section";
    accountsSection.innerHTML = "<h3>Konta — reguły wypłat i podatków</h3>";
    const grid = document.createElement("div");
    grid.className = "config-accounts";
    for (const [key, rules] of Object.entries(CONFIG.accounts)) {
        grid.appendChild(renderAccountRulesCard(key, rules));
    }
    accountsSection.appendChild(grid);
    root.appendChild(accountsSection);
}

function configSection(title, fields) {
    const section = document.createElement("div");
    section.className = "config-section";
    section.innerHTML = `<h3>${title}</h3>`;
    const grid = document.createElement("div");
    grid.className = "config-fields";
    fields.forEach((f) => grid.appendChild(f));
    section.appendChild(grid);
    return section;
}

function configField(path, label, value, percent, hint) {
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    wrap.innerHTML = `<label>${label}${hint ? tipHtml(hint) : ""}</label>`;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "any";
    const raw = percent ? value * 100 : value;
    input.value = Math.round(raw * 1e4) / 1e4;
    input.addEventListener("input", () => {
        const parsed = parseFloat(input.value) || 0;
        setConfigPath(path, percent ? parsed / 100 : parsed);
        updateStageHints(document.getElementById("stages-container"));
    });
    wrap.appendChild(input);
    return wrap;
}

function configNumberField(path, label, value, hint) {
    return configField(path, label, value, false, hint);
}

function configPercentField(path, label, value, hint) {
    return configField(path, label, value, true, hint);
}

function renderAccountRulesCard(key, rules) {
    const info = getAccountInfo(key);
    const card = document.createElement("div");
    card.className = "account-rules-card";
    card.innerHTML = `<h4>${ACCOUNT_LABELS[key] || key}${info ? tipHtml(info) : ""}</h4>`;

    card.appendChild(configSelect("accounts." + key + ".tax_model", "Model podatkowy", rules.tax_model, TAX_MODEL_LABELS, "Sposób opodatkowania wypłat z konta."));
    card.appendChild(configPercentField("accounts." + key + ".tax_rate", "Stawka ryczałtowa", rules.tax_rate, "Stawka podatku od zysku/całości po osiągnięciu docelowego wieku."));
    card.appendChild(configSelect("accounts." + key + ".tax_basis", "Podstawa", rules.tax_basis, TAX_BASIS_LABELS, "Podstawa opodatkowania ryczałtem: zysk albo cała wypłata."));
    card.appendChild(configNumberField("accounts." + key + ".min_withdrawal_age", "Wiek zmiany reżimu", rules.min_withdrawal_age, "Wiek, od którego wypłaty nie są już objęte reżimem „przed wiekiem” (np. 60 dla IKE, 65 dla IKZE)."));
    card.appendChild(configSelect("accounts." + key + ".early_tax_model", "Model przed wiekiem", rules.early_tax_model, TAX_MODEL_LABELS, "Opodatkowanie wypłat przed osiągnięciem docelowego wieku (np. skala PIT dla IKZE)."));
    card.appendChild(configPercentField("accounts." + key + ".early_tax_rate", "Stawka przed wiekiem", rules.early_tax_rate, "Stawka podatku obowiązująca przed osiągnięciem docelowego wieku."));
    card.appendChild(configPercentField("accounts." + key + ".asset_tax_rate", "Podatek od wartości aktywów", rules.asset_tax_rate, "Roczny podatek od wartości aktywów ponad próg zwolnienia (OKI: 0,85%)."));
    card.appendChild(configNumberField("accounts." + key + ".asset_exemption", "Próg zwolnienia aktywów", rules.asset_exemption, "Kwota, poniżej której aktywa nie podlegają corocznemu podatkowi od wartości."));

    return card;
}

function getAccountInfo(accountKey) {
    for (const meta of Object.values(STAGE_TYPES)) {
        const acc = meta && meta.available_accounts && meta.available_accounts[accountKey];
        if (acc && acc.description) return acc.description;
    }
    return null;
}

function configSelect(path, label, value, options, hint) {
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    wrap.innerHTML = `<label>${label}${hint ? tipHtml(hint) : ""}</label>`;
    const select = document.createElement("select");
    for (const [val, text] of Object.entries(options)) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = text;
        if (val === value) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener("change", () => {
        setConfigPath(path, select.value);
        updateStageHints(document.getElementById("stages-container"));
    });
    wrap.appendChild(select);
    return wrap;
}

async function resetConfig() {
    const res = await fetch("/api/config");
    CONFIG = await res.json();
    renderConfigView();
    updateStageHints(document.getElementById("stages-container"));
}

// --- Sesja i zapis symulacji ---

let lastInput = null;
let lastResult = null;

function defaultSimName() {
    return "Symulacja " + new Date().toLocaleDateString("pl-PL");
}

function initSaveButton() {
    const btn = document.getElementById("saveSimBtn");
    btn.addEventListener("click", async () => {
        if (!lastInput) return;
        const session = await fetch("/api/session").then((r) => r.json()).catch(() => ({ email: null }));
        if (!session.email) {
            alert("Aby zapisać symulację, zaloguj się lub zarejestruj.");
            window.location.href = "/";
            return;
        }
        const name = prompt("Nazwa symulacji:", defaultSimName());
        if (name === null || !name.trim()) return;
        btn.disabled = true;
        try {
            const res = await fetch("/api/simulations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), input: lastInput }),
            });
            const result = await res.json();
            if (!res.ok) {
                alert("Błąd zapisu: " + (result.detail || result.error || "nieznany"));
            } else {
                alert(`Zapisano symulację „${result.name}”.`);
            }
        } catch (err) {
            alert("Błąd zapisu: " + err.message);
        } finally {
            btn.disabled = false;
        }
    });
}

// --- Wczytywanie zapisanej symulacji (/sim?id=N) ---

function migrateLegacyAccounts(stage) {
    // Stare zapisy miały jedno konto "oki" z wyborem typu aktywów
    // (asset_exemption: 100000 inwestycyjne / 25000 oszczędnościowe).
    if (!stage.accounts || !stage.accounts["oki"]) return;
    const legacy = stage.accounts["oki"];
    const target =
        legacy.asset_exemption === 25000 ? "oki_osk" : "oki_inw";
    const { asset_exemption, ...rest } = legacy;
    delete stage.accounts["oki"];
    stage.accounts[target] = rest;
}

function populateStages(inputData) {
    const container = document.getElementById("stages-container");
    if (inputData.config) CONFIG = backfillConfig(inputData.config);
    if (inputData.gender) setGender(inputData.gender);
    container.innerHTML = "";
    (inputData.stages || []).forEach((stage) => {
        migrateLegacyAccounts(stage);
        container.appendChild(createStageBlock(stage));
    });
    if (inputData.config) renderConfigView();
    applyZusWaloryzacjaDefaults();
    updateStageButtons(container);
    updateStageHints(container);
    refreshRealizationToggles(container);
}

async function loadSimulation(simId, container) {
    try {
        const res = await fetch("/api/simulations/" + simId);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Nie można wczytać symulacji");
        populateStages(data.input);
        if (data.name) document.title = "FIRE Simulator — " + data.name;
    } catch (err) {
        alert("Błąd: " + err.message);
        (DEFAULTS.stages || []).forEach((s) => container.appendChild(createStageBlock(s)));
        updateStageButtons(container);
        updateStageHints(container);
        refreshRealizationToggles(container);
    }
}

// --- Czytelność wyników: kolumny, gęstość, wykres ---

const COLUMN_TOGGLES_KEY = "fire.columnToggles";
const DENSITY_KEY = "fire.density";

function initResultsControls() {
    const density = document.getElementById("densitySelect");
    const saved = localStorage.getItem(DENSITY_KEY);
    if (saved) density.value = saved;
    density.addEventListener("change", () => {
        localStorage.setItem(DENSITY_KEY, density.value);
        applyDensity();
    });
}

function renderColumnToggles(accounts) {
    const container = document.getElementById("columnToggles");
    container.innerHTML = "";
    const hidden = new Set(JSON.parse(localStorage.getItem(COLUMN_TOGGLES_KEY) || "[]"));

    const cols = accounts.map((a) => ({ col: a, label: ACCOUNT_LABELS[a] || a }));
    cols.push(
        { col: "wealth", label: "Majątek" },
        { col: "annual", label: "Wypłata roczna" },
        { col: "monthly", label: "Wypłata mies." },
        { col: "tax", label: "Podatek" }
    );

    cols.forEach(({ col, label }) => {
        const toggle = document.createElement("label");
        toggle.className = "col-toggle" + (hidden.has(col) ? " off" : "");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !hidden.has(col);
        cb.dataset.col = col;
        cb.addEventListener("change", () => {
            if (cb.checked) hidden.delete(col);
            else hidden.add(col);
            localStorage.setItem(COLUMN_TOGGLES_KEY, JSON.stringify([...hidden]));
            toggle.classList.toggle("off", !cb.checked);
            applyColVisibility();
        });
        toggle.appendChild(cb);
        toggle.appendChild(document.createTextNode(" " + label));
        container.appendChild(toggle);
    });
}

function applyColVisibility() {
    const hidden = new Set(JSON.parse(localStorage.getItem(COLUMN_TOGGLES_KEY) || "[]"));
    document.querySelectorAll("#resultsTable [data-col]").forEach((cell) => {
        cell.classList.toggle("col-hidden", hidden.has(cell.dataset.col));
    });
}

function applyDensity() {
    const tbody = document.querySelector("#resultsTable tbody");
    if (!tbody) return;
    const rows = tbody.querySelectorAll("tr");
    const density = parseInt(document.getElementById("densitySelect").value, 10) || 1;
    rows.forEach((tr, i) => {
        const isLast = i === rows.length - 1;
        tr.classList.toggle("density-hidden", density > 1 && !isLast && i % density !== 0);
    });
}

function renderWealthChart(data) {
    const container = document.getElementById("wealthChart");
    const years = data.years || [];
    if (years.length < 2) {
        container.classList.add("hidden");
        container.innerHTML = "";
        return;
    }

    const W = 1000;
    const H = 320;
    const padX = 14;
    const padY = 26;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;

    const ages = years.map((y) => y.age);
    const minAge = Math.min(...ages);
    const maxAge = Math.max(...ages);
    const maxWealth = Math.max(...years.map((y) => y.total_wealth));
    const x = (age) => padX + ((age - minAge) / Math.max(1, maxAge - minAge)) * innerW;
    const y = (wealth) => H - padY - (wealth / Math.max(1, maxWealth)) * innerH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg"><g class="grid-lines">`;
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
        const gy = padY + (innerH * i) / steps;
        const val = maxWealth * (1 - i / steps);
        svg += `<line x1="${padX}" y1="${gy}" x2="${W - padX}" y2="${gy}"/>
                <text x="${padX}" y="${gy - 4}" class="axis-text">${Math.round(val / 1000)}k</text>`;
    }
    svg += "</g>";

    const points = years.map((yr) => `${x(yr.age).toFixed(1)},${y(yr.total_wealth).toFixed(1)}`);
    svg += `<polyline class="chart-line wealth-line" fill="none" points="${points.join(" ")}"/>`;
    years.forEach((yr) => {
        svg += `<circle class="chart-dot" cx="${x(yr.age).toFixed(1)}" cy="${y(yr.total_wealth).toFixed(1)}" r="3">
            <title>${yr.age} r.ż. — ${formatMoney(yr.total_wealth)}</title>
        </circle>`;
    });
    svg += `<text x="${padX}" y="${H - 4}" class="axis-text">${minAge} r.ż.</text>
            <text x="${W - padX}" y="${H - 4}" text-anchor="end" class="axis-text">${maxAge} r.ż.</text>`;
    svg += "</svg>";

    container.innerHTML = svg;
    container.classList.remove("hidden");
}
