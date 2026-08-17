// sim-stages.js — Stage block management and drag-drop

let stageIndex = 0;

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

// --- Reordering etapów ---

function stageTypeOf(block) {
    return block.dataset.stageType || "akumulacja";
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
