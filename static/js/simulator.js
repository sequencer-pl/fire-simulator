let stageIndex = 0;

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
    if (accountKey === "oki" && key === "asset_exemption") {
        return 100000;
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
    for (const [key, fieldDef] of Object.entries(meta.fields)) {
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
                    <label>${fieldDef.label}</label>
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
                    <label>${fieldDef.label}</label>
                    <select class="acc-field"
                            data-account="${accountKey}"
                            data-key="${key}">${options}</select>
                </div>
            `;
            continue;
        }

        fieldsHtml += `
            <div class="field-group" ${visibleWhen}>
                <label>${fieldDef.label}${fieldDef.percent ? " (%)" : ""}</label>
                <input type="${fieldDef.type || 'number'}"
                       class="acc-field"
                       data-account="${accountKey}"
                       data-key="${key}"
                       ${fieldDef.percent ? 'data-percent="true"' : ''}
                       value="${displayVal}"
                       ${fieldDef.step ? `step="${fieldDef.step}"` : 'step="any"'}
                       min="${fieldDef.percent ? -99 : 0}" />
                ${chipsHtml}
            </div>
        `;
    }

    card.innerHTML = `
        <h4>${meta.label}</h4>
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
        card.closest(".accounts-grid").removeChild(card);
        updateStageName(card.closest(".stage-block"));
        updateStageHints(document.getElementById("stages-container"));
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

    const labels = accounts.map(a => a.toUpperCase());
    nameInput.value = labels.join("+") || "Realizacja";
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

    togglesContainer.innerHTML = "";
    for (const [key, meta] of Object.entries(available)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "account-toggle" + (activeAccounts.has(key) ? " active" : "");
        btn.dataset.account = key;
        btn.textContent = meta.label;

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
            updateStageHints(document.getElementById("stages-container"));
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
                <input type="number" class="start-age" value="${defaults?.start_age ?? 40}" min="0" max="120" />
            </div>
            <div class="field-group">
                <label>Wiek koniec (exclusive)</label>
                <input type="number" class="end-age" value="${defaults?.end_age ?? 60}" min="0" max="120" />
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
        updateStageButtons(document.getElementById("stages-container"));
        updateStageHints(document.getElementById("stages-container"));
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

function updateStageHints(container) {
    if (!container) return;
    if (CONFIG) {
        container.querySelectorAll(".stage-block").forEach((block) => {
        const hint = block.querySelector(".stage-hint");
        if (!hint) return;
        const stageType = stageTypeOf(block);
        const startAge = parseInt(block.querySelector(".start-age").value) || 0;
        const hints = [];

        if (stageType === "realizacja") {
            block.querySelectorAll(".account-card").forEach((card) => {
                const acc = card.dataset.account;
                if (acc === "zus") {
                    const pensionInput = card.querySelector('[data-key="monthly_pension"]');
                    const pension = parseFloat(pensionInput?.value) || 0;
                    if (pension <= 0 && CONFIG.zus && startAge < CONFIG.zus.wiek_emerytalny) {
                        hints.push(
                            `ZUS wyliczany z kapitału od ${startAge} r.ż. — przed powszechnym wiekiem ` +
                            `emerytalnym (${CONFIG.zus.wiek_emerytalny} r.ż.). Realnie świadczenie nie przysługuje wcześniej.`
                        );
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
                        hints.push(
                            `${label} wypłacane od ${startAge} r.ż. — przed ${rules.min_withdrawal_age} r.ż. ` +
                            `jednorazowy zwrot całości w pierwszym roku (podatek wg skali ${lower}/${upper}% od całości); ` +
                            `wypłaty ratalne liczone od kapitału netto. Po ${rules.min_withdrawal_age} r.ż. ${normalTaxDescription(acc)}.`
                        );
                    } else {
                        hints.push(
                            `${label} wypłacane od ${startAge} r.ż. — przed ${rules.min_withdrawal_age} r.ż. ` +
                            `opodatkowanie ${earlyTaxDescription(acc)}. Po ${rules.min_withdrawal_age} r.ż. ${normalTaxDescription(acc)}.`
                        );
                    }
                }
            });
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
                        hints.push(
                            `Składka roczna ≈ ${skladka.toLocaleString("pl-PL")} zł ` +
                            `(19,52% podstawy), kapitał waloryzowany ` +
                            `${((Number.isFinite(wal) ? wal : CONFIG.zus.waloryzacja_skladek) * 100).toFixed(0)}% realnie.`
                        );
                        const ofeCb = card.querySelector('[data-key="ofe_member"]');
                        if (ofeCb && ofeCb.checked) {
                            hints.push(
                                `Członek OFE: ${(CONFIG.zus.ofe_rate * 100).toFixed(2)} pkt składki rośnie wg ROI w OFE, reszta waloryzowana w ZUS.`
                            );
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
                        hints.push(
                            `Wpłaty do PPK ≈ ${total.toLocaleString("pl-PL")} zł/rok ` +
                            `(pracownik + pracodawca = ${totalPct.toFixed(1)}% podstawy` +
                            `${stateCb && stateCb.checked ? ` + dopłata państwa ${state.toLocaleString("pl-PL")} zł` : ""}).`
                        );
                        if (totalPct > 8) {
                            hints.push(`Suma wpłat do PPK (${totalPct.toFixed(1)}%) przekracza ustawowy limit 8%.`);
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
                        hints.push(
                            `Składki do PPE ≈ ${(employer + add).toLocaleString("pl-PL")} zł/rok ` +
                            `(podstawowa pracodawcy ${employer.toLocaleString("pl-PL")} zł, dodatkowa ${add.toLocaleString("pl-PL")} zł).`
                        );
                        if (empPct * 100 > 7) {
                            hints.push(`Składka podstawowa PPE (${(empPct * 100).toFixed(1)}%) przekracza ustawowy limit 7%.`);
                        }
                        const addLimit = CONFIG.limits?.ppe_additional_annual;
                        if (addLimit && add > addLimit) {
                            hints.push(
                                `Składka dodatkowa PPE (${add.toLocaleString("pl-PL")} zł/rok) przekracza roczny limit ${addLimit.toLocaleString("pl-PL")} zł.`
                            );
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
                        hints.push(
                            `Gotówka realnie traci ${(roi * 100).toFixed(1)}% wartości rocznie${loss}.`
                        );
                    }
                    return;
                }
                if (acc === "oki") {
                    const rules = CONFIG.accounts && CONFIG.accounts.oki;
                    if (rules && rules.tax_model === "assets") {
                        const exemption = parseInt(card.querySelector('[data-key="asset_exemption"]')?.value) || rules.asset_exemption;
                        const rate = (rules.asset_tax_rate * 100).toFixed(2);
                        const contrib = parseFloat(card.querySelector('[data-key="annual_contribution"]')?.value) || 0;
                        const bal = parseFloat(card.querySelector('[data-key="starting_balance"]')?.value) || 0;
                        const over = bal > exemption ? ` Obecne saldo już przekracza próg.` : "";
                        hints.push(
                            `OKI: bez Belki do progu ${exemption.toLocaleString("pl-PL")} zł; powyżej — podatek od wartości aktywów ${rate}%/rok ` +
                            `od nadwyżki średniego stanu (niezależnie od zysku).${over}`
                        );
                        if (contrib > exemption) {
                            hints.push(`Dopłata roczna (${contrib.toLocaleString("pl-PL")} zł) przekracza próg zwolnienia ${exemption.toLocaleString("pl-PL")} zł.`);
                        }
                    }
                    return;
                }
                if (acc === "krypto") {
                    hints.push(
                        "Krypto: 19% od zysku przy sprzedaży za złotówki (PIT-38, FIFO); " +
                        "zamiana krypto→krypto neutralna podatkowo (koszt nabycia przechodzi dalej)."
                    );
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
                hints.push(
                    `Dopłaty na ${label} (${contrib.toLocaleString("pl-PL")} zł/rok) przekraczają roczny limit ${limit.toLocaleString("pl-PL")} zł.`
                );
            });
        }

        hint.textContent = hints.join(" ");
        hint.classList.toggle("hidden", hints.length === 0);
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
        const hint = block.querySelector(".stage-hint");
        if (startInput) startInput.classList.remove("input-error");
        if (hint) hint.classList.remove("error");

        if (stageTypeOf(block) !== "realizacja") return;
        const startAge = parseInt(startInput.value, 10) || 0;
        const bad = lastEnd !== null && startAge < lastEnd;
        if (!bad) return;

        valid = false;
        if (startInput) startInput.classList.add("input-error");
        if (hint) {
            const msg = `Etap realizacji musi zaczynać się ≥ ${lastEnd} r.ż. (koniec akumulacji).`;
            hint.textContent = hint.textContent ? `${hint.textContent} ${msg}` : msg;
            hint.classList.add("error");
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

// Separator między fazami akumulacji i realizacji z przyciskiem dodawania etapu akumulacji.
function updateDivider(container) {
    container.querySelectorAll(".phase-divider").forEach((d) => d.remove());

    const blocks = getStageBlocks(container);
    const divider = document.createElement("div");
    divider.className = "phase-divider";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary phase-divider-btn";
    btn.textContent = "+ Dodaj etap akumulacji";
    btn.addEventListener("click", () => {
        const block = createStageBlock(null);
        const firstRealizacja = getStageBlocks(container).find((b) => stageTypeOf(b) === "realizacja");
        if (firstRealizacja) {
            container.insertBefore(block, firstRealizacja);
        } else {
            container.appendChild(block);
        }
        updateStageButtons(container);
        updateStageHints(container);
    });
    divider.appendChild(btn);

    const firstRealIndex = blocks.map(stageTypeOf).indexOf("realizacja");
    if (firstRealIndex !== -1) {
        container.insertBefore(divider, blocks[firstRealIndex]);
    } else {
        container.appendChild(divider);
    }
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

    return { stages: stages, max_age: 100, config: CONFIG };
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
        <th>Wiek</th>
        <th>Etap</th>
        ${accounts.map(a => `<th>${a.toUpperCase()}</th>`).join("")}
        <th>Majątek</th>
        <th>Wypłata roczna</th>
        <th>Wypłata mies.</th>
        <th>Podatek</th>
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
            return `<td class="amount">${formatMoney(val)}</td>`;
        }).join("");

        const isLast = i === total - 1;
        tr.innerHTML = `
            <td>${y.age}${isLast && hasPension ? '<span class="plus-suffix">+</span>' : ''}</td>
            <td>${y.stage_name}</td>
            ${balanceCells}
            <td class="amount"><strong>${formatMoney(y.total_wealth)}</strong></td>
            <td class="amount">${formatMoney(y.annual_withdrawal)}</td>
            <td class="amount">${formatMoney(y.monthly_withdrawal)}</td>
            <td class="amount">${formatMoney(y.tax_paid)}</td>
        `;
        tbody.appendChild(tr);
    });

    container.style.display = "block";
    container.scrollIntoView({ behavior: "smooth" });
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("stages-container");
    const defaults = DEFAULTS.stages || [];

    defaults.forEach((s) => container.appendChild(createStageBlock(s)));

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
    container.addEventListener("input", () => updateStageHints(container));

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

    document.getElementById("simForm").addEventListener("submit", async (e) => {
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
            }
        } catch (err) {
            alert("Błąd połączenia: " + err.message);
        }
    });

    initModeToggle();
    initConfig();
});

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
    oki: "OKI",
    ppe: "PPE",
    ppk: "PPK",
    zus: "ZUS (emerytura)",
};

const TAX_MODEL_LABELS = { none: "Brak", flat: "Ryczałt", scale: "Skala PIT", assets: "Od wartości aktywów" };
const TAX_BASIS_LABELS = { gains: "od zysku", full: "od całości" };
let CONFIG = null;

async function initConfig() {
    try {
        const res = await fetch("/api/config");
        CONFIG = await res.json();
        applyZusWaloryzacjaDefaults();
        renderConfigView();
        updateStageHints(document.getElementById("stages-container"));
    } catch (err) {
        console.error("Nie udało się wczytać konfiguracji:", err);
    }
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
        configNumberField("kwota_wolna", "Kwota wolna od podatku (zł)", CONFIG.kwota_wolna, 0),
        configNumberField("prog", "Próg podatkowy (zł)", CONFIG.prog, 0),
        configPercentField("rate_lower", "Stawka niższa (%)", CONFIG.rate_lower, 0),
        configPercentField("rate_upper", "Stawka wyższa (%)", CONFIG.rate_upper, 0),
    ]));

    root.appendChild(configSection("Limity rocznych wpłat", [
        configNumberField("limits.ike_annual", "IKE (zł)", CONFIG.limits.ike_annual, 0),
        configNumberField("limits.ikze_annual", "IKZE — etat (zł)", CONFIG.limits.ikze_annual, 0),
        configNumberField("limits.ikze_annual_self_employed", "IKZE — przedsiębiorca (zł)", CONFIG.limits.ikze_annual_self_employed, 0),
        configNumberField("limits.oipe_annual", "OIPE (zł)", CONFIG.limits.oipe_annual, 0),
        configNumberField("limits.ppe_additional_annual", "PPE — składka dodatkowa (zł)", CONFIG.limits.ppe_additional_annual, 0),
    ]));

    root.appendChild(configSection("PPK — parametry", [
        configPercentField("ppk.employee_pct", "Wpłata pracownika (%)", CONFIG.ppk.employee_pct),
        configPercentField("ppk.employer_pct", "Wpłata pracodawcy (%)", CONFIG.ppk.employer_pct),
        configPercentField("ppk.max_total_pct", "Limit sumy wpłat (%)", CONFIG.ppk.max_total_pct),
        configNumberField("ppk.state_welcoming", "Dopłata powitalna (zł)", CONFIG.ppk.state_welcoming),
        configNumberField("ppk.state_annual", "Dopłata roczna (zł)", CONFIG.ppk.state_annual),
    ]));

    root.appendChild(configSection("PPE — parametry", [
        configPercentField("ppe.max_employer_pct", "Limit składki podstawowej (%)", CONFIG.ppe.max_employer_pct),
    ]));

    root.appendChild(configSection("ZUS — parametry", [
        configPercentField("zus.skladka_rate", "Składka emerytalna (%)", CONFIG.zus.skladka_rate),
        configPercentField("zus.ofe_rate", "Część składki do OFE (%)", CONFIG.zus.ofe_rate),
        configNumberField("zus.limit_base_annual", "Limit rocznej podstawy, 30× (zł; 0 = brak)", CONFIG.zus.limit_base_annual),
        configPercentField("zus.waloryzacja_skladek", "Waloryzacja składek (%)", CONFIG.zus.waloryzacja_skladek),
        configPercentField("zus.waloryzacja_swiadczenia", "Waloryzacja świadczenia (%)", CONFIG.zus.waloryzacja_swiadczenia),
        configNumberField("zus.wiek_emerytalny", "Powszechny wiek emerytalny (lata)", CONFIG.zus.wiek_emerytalny),
        configNumberField("zus.min_emerytura", "Emerytura minimalna (zł)", CONFIG.zus.min_emerytura),
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

    document.getElementById("configResetBtn").addEventListener("click", resetConfig);
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

function configField(path, label, value, percent) {
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    wrap.innerHTML = `<label>${label}</label>`;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "any";
    input.value = percent ? value * 100 : value;
    input.addEventListener("input", () => {
        const parsed = parseFloat(input.value) || 0;
        setConfigPath(path, percent ? parsed / 100 : parsed);
        updateStageHints(document.getElementById("stages-container"));
    });
    wrap.appendChild(input);
    return wrap;
}

function configNumberField(path, label, value) {
    return configField(path, label, value, false);
}

function configPercentField(path, label, value) {
    return configField(path, label, value, true);
}

function renderAccountRulesCard(key, rules) {
    const card = document.createElement("div");
    card.className = "account-rules-card";
    card.innerHTML = `<h4>${ACCOUNT_LABELS[key] || key}</h4>`;

    card.appendChild(configSelect("accounts." + key + ".tax_model", "Model podatkowy", rules.tax_model, TAX_MODEL_LABELS));
    card.appendChild(configPercentField("accounts." + key + ".tax_rate", "Stawka ryczałtowa (%)", rules.tax_rate));
    card.appendChild(configSelect("accounts." + key + ".tax_basis", "Podstawa", rules.tax_basis, TAX_BASIS_LABELS));
    card.appendChild(configNumberField("accounts." + key + ".min_withdrawal_age", "Wiek zmiany reżimu", rules.min_withdrawal_age));
    card.appendChild(configSelect("accounts." + key + ".early_tax_model", "Model przed wiekiem", rules.early_tax_model, TAX_MODEL_LABELS));
    card.appendChild(configPercentField("accounts." + key + ".early_tax_rate", "Stawka przed wiekiem (%)", rules.early_tax_rate));
    card.appendChild(configPercentField("accounts." + key + ".asset_tax_rate", "Podatek od wartości aktywów (%)", rules.asset_tax_rate));
    card.appendChild(configNumberField("accounts." + key + ".asset_exemption", "Próg zwolnienia aktywów (zł)", rules.asset_exemption));

    return card;
}

function configSelect(path, label, value, options) {
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    wrap.innerHTML = `<label>${label}</label>`;
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
