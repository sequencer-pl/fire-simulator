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

function createAccountCard(stageType, accountKey, accountData) {
    const meta = getAccountMeta(stageType, accountKey);
    if (!meta) return null;

    const card = document.createElement("div");
    card.className = "account-card";
    card.dataset.account = accountKey;

    let fieldsHtml = "";
    for (const [key, fieldDef] of Object.entries(meta.fields)) {
        const rawVal = accountData?.[key] ?? 0;
        const displayVal = fieldDef.percent ? rawVal * 100 : rawVal;
        fieldsHtml += `
            <div class="field-group">
                <label>${fieldDef.label}${fieldDef.percent ? " (%)" : ""}</label>
                <input type="${fieldDef.type || 'number'}"
                       class="acc-field"
                       data-account="${accountKey}"
                       data-key="${key}"
                       ${fieldDef.percent ? 'data-percent="true"' : ''}
                       value="${displayVal}"
                       ${fieldDef.step ? `step="${fieldDef.step}"` : 'step="any"'}
                       min="0" />
            </div>
        `;
    }

    card.innerHTML = `
        <h4>${meta.label}</h4>
        <button type="button" class="remove-account-btn" title="Usuń konto">&times;</button>
        <div class="fields-row">${fieldsHtml}</div>
    `;

    card.querySelector(".remove-account-btn").addEventListener("click", () => {
        card.closest(".accounts-grid").removeChild(card);
        updateStageName(card.closest(".stage-block"));
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
    const stageType = stageBlock.querySelector(".stage-type-select").value;
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
    const stageType = stageBlock.querySelector(".stage-type-select").value;
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
        });

        togglesContainer.appendChild(btn);
    }
}

function createStageBlock(defaults) {
    const stageType = defaults?.stage_type || "akumulacja";
    const cfg = STAGE_TYPES[stageType] || {};
    const accounts = defaults?.accounts || {};
    const idx = stageIndex++;

    const block = document.createElement("div");
    block.className = "stage-block";
    block.dataset.index = idx;

    block.innerHTML = `
        <button type="button" class="remove-btn" title="Usuń etap">&times;</button>
        <div class="stage-header">
            <div class="field-group">
                <label>Typ etapu</label>
                <select class="stage-type-select">
                    ${Object.entries(STAGE_TYPES).map(
                        ([k, v]) =>
                            `<option value="${k}" ${k === stageType ? "selected" : ""}>${v.label}</option>`
                    ).join("")}
                </select>
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
    `;

    block.querySelector(".remove-btn").addEventListener("click", () => block.remove());

    const stageTypeSelect = block.querySelector(".stage-type-select");
    stageTypeSelect.addEventListener("change", () => {
        const newType = stageTypeSelect.value;
        const meta = STAGE_TYPES[newType];
        const grid = block.querySelector(".accounts-grid");
        grid.innerHTML = "";
        renderAccountToggles(block);
        updateStageName(block);
    });

    const grid = block.querySelector(".accounts-grid");
    for (const [key, accData] of Object.entries(accounts)) {
        const card = createAccountCard(stageType, key, accData);
        if (card) grid.appendChild(card);
    }

    renderAccountToggles(block);

    return block;
}

function gatherFormData() {
    const stages = [];
    document.querySelectorAll(".stage-block").forEach((block) => {
        const accounts = {};
        block.querySelectorAll(".acc-field").forEach((input) => {
            const acc = input.dataset.account;
            const key = input.dataset.key;
            if (!accounts[acc]) accounts[acc] = {};
            let val = parseFloat(input.value) || 0;
            if (input.dataset.percent) val /= 100;
            accounts[acc][key] = val;
        });

        stages.push({
            stage_type: block.querySelector(".stage-type-select").value,
            name: block.querySelector(".stage-name").value,
            start_age: parseInt(block.querySelector(".start-age").value) || 0,
            end_age: parseInt(block.querySelector(".end-age").value) || 0,
            accounts: accounts,
        });
    });

    return { stages: stages, max_age: 100 };
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
    `;
    thead.appendChild(headerRow);

    tbody.innerHTML = "";

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

    document.getElementById("addStageBtn").addEventListener("click", () => {
        container.appendChild(createStageBlock(null));
    });

    document.getElementById("simForm").addEventListener("submit", async (e) => {
        e.preventDefault();
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
});
