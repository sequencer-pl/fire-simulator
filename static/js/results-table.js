// results-table.js — wspólna tabela "Rok po roku" z gęstością i kolumnami.

(function () {
    let counter = 0;

    function money(value) {
        return window.ResultsModel.fmtMoney(value, { dashZero: true });
    }

    function render(container, options = {}) {
        if (!container) return;
        const {
            result,
            title = "Rok po roku",
            density = 5,
            open = false,
            embedded = false,
            tableId = "",
        } = options;

        counter += 1;
        const uid = `res-year-table-${counter}`;
        const years = result?.years || [];
        const accounts = result?.accounts || [];
        const labels = result?.account_labels || {};
        if (!years.length) {
            container.innerHTML = `<p class="field-hint">Brak danych rocznych do pokazania.</p>`;
            return;
        }

        const columns = [
            ...accounts.map((account) => ({ key: account, label: labels[account] || account })),
            { key: "wealth", label: "Majątek" },
            { key: "annual", label: "Wypłata roczna" },
            { key: "monthly", label: "Wypłata mies." },
            { key: "tax", label: "Podatek" },
        ];

        const header = columns.map((column) => {
            const isAccount = accounts.includes(column.key);
            return `<th data-col="${window.escapeHtml(column.key)}"${isAccount ? "" : ' class="amount"'}>${window.escapeHtml(column.label)}</th>`;
        }).join("");

        const rows = years.map((year) => {
            const cells = accounts.map((account) => {
                const value = year.balances?.[account] || 0;
                return `<td class="amount" data-col="${window.escapeHtml(account)}">${money(value)}</td>`;
            }).join("");
            return `<tr class="${year.monthly_withdrawal > 0 ? "highlight" : "stage-accum"}" data-age="${year.age}">
                <td class="col-age">${year.age}</td>
                <td class="col-stage">${window.escapeHtml(year.stage_name || "")}</td>
                ${cells}
                <td class="amount" data-col="wealth"><strong>${money(year.total_wealth)}</strong></td>
                <td class="amount" data-col="annual">${money(year.annual_withdrawal)}</td>
                <td class="amount" data-col="monthly">${money(year.monthly_withdrawal)}</td>
                <td class="amount ${year.tax_paid < 0 ? "text-success" : ""}" data-col="tax">${money(year.tax_paid)}</td>
            </tr>`;
        }).join("");

        const columnOptions = columns.map((column) => `
            <label class="res-columns-option">
                <input type="checkbox" data-toggle-col="${window.escapeHtml(column.key)}" checked>
                <span>${window.escapeHtml(column.label)}</span>
            </label>`).join("");

        const body = `<div class="res-year-table-body">
            <div class="toolbar results-toolbar">
                <div class="toolbar-left">
                    <details class="res-columns">
                        <summary class="btn btn-ghost btn-sm" aria-label="Wybierz kolumny">Kolumny</summary>
                        <div class="res-columns-popover">${columnOptions}</div>
                    </details>
                </div>
                <div class="toolbar-right density-control">
                    <label class="dim" for="${uid}-density">Wiersze</label>
                    <select class="select" id="${uid}-density">
                        <option value="1"${density === 1 ? " selected" : ""}>co roku</option>
                        <option value="5"${density === 5 ? " selected" : ""}>co 5 lat</option>
                        <option value="10"${density === 10 ? " selected" : ""}>co 10 lat</option>
                    </select>
                </div>
            </div>
            <div class="table-wrap">
                <table${tableId ? ` id="${window.escapeHtml(tableId)}"` : ""}>
                    <thead><tr><th>Wiek</th><th>Etap</th>${header}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;

        container.innerHTML = embedded
            ? `<div class="res-year-table" id="${uid}">${body}</div>`
            : `<details class="wz-details res-year-table" id="${uid}"${open ? " open" : ""}>
                <summary>${window.escapeHtml(title)} <span class="dim">· ${years.length} lat</span></summary>
                ${body}
            </details>`;

        const root = container.querySelector(`#${uid}`);
        const table = root?.querySelector("table");
        const densitySelect = root?.querySelector(`#${uid}-density`);
        const applyDensity = () => {
            const value = parseInt(densitySelect?.value || "1", 10) || 1;
            const rows = table?.querySelectorAll("tbody tr") || [];
            rows.forEach((row, index) => {
                const isLast = index === rows.length - 1;
                row.classList.toggle(
                    "density-hidden",
                    value > 1 && !isLast && index % value !== 0
                );
            });
        };
        densitySelect?.addEventListener("change", applyDensity);
        applyDensity();

        root?.querySelectorAll("[data-toggle-col]").forEach((checkbox) => {
            checkbox.addEventListener("change", () => {
                const key = checkbox.dataset.toggleCol;
                root.querySelectorAll(`[data-col="${CSS.escape(key)}"]`).forEach((cell) => {
                    cell.classList.toggle("col-hidden", !checkbox.checked);
                });
            });
        });
    }

    window.ResultsTable = { render };
})();
