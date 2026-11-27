// results-table.js — wspólna tabela "Rok po roku" z gęstością i kolumnami.

(function () {
    let counter = 0;

    function money(value) {
        return window.ResultsModel.fmtMoney(value, { dashZero: true });
    }

    function baseKey(account) {
        if (typeof window.baseAccountKey === "function") return window.baseAccountKey(account);
        return String(account || "").split(":")[0];
    }

    function endingBalances(year) {
        const ending = year?.ending_balances;
        if (ending && Object.keys(ending).length) return ending;
        return year?.balances || {};
    }

    // Majątek prywatny = salda na koniec roku bez ZUS i OFE. ZUS pokazujemy
    // osobno, bo nie jest kapitałem, którym użytkownik zarządza.
    function privateWealth(year) {
        const source = endingBalances(year);
        if (!source || !Object.keys(source).length) {
            return Number(year?.total_wealth) || 0;
        }
        return Object.entries(source).reduce(
            (sum, [account, value]) => {
                const base = baseKey(account);
                return base === "zus" || base === "zus:ofe"
                    ? sum
                    : sum + (Number(value) || 0);
            },
            0
        );
    }

    function zusEndAge(input) {
        const stages = input?.stages || [];
        const ends = stages
            .filter((stage) => stage.stage_type === "realizacja" && (stage.accounts || {}).zus)
            .map((stage) => Number(stage.end_age))
            .filter((age) => Number.isFinite(age));
        return ends.length ? Math.max(...ends) : null;
    }

    function postHorizonFor(input, result) {
        const summary = result?.summary || {};
        if (!summary.has_pension) return null;
        const lastAge = Number(summary.end_age);
        const pensionEnd = zusEndAge(input);
        const monthly = Number(summary.zus_monthly) || 0;
        if (!Number.isFinite(lastAge) || pensionEnd == null || lastAge + 1 > pensionEnd) return null;
        if (monthly <= 0.5) return null;
        return {
            ageLabel: `${lastAge + 1}+`,
            stageName: "Tylko ZUS (po horyzoncie)",
            monthly,
            annual: monthly * 12,
            title: `Po horyzoncie planu pokazujemy samą emeryturę ZUS. Kwota netto miesięcznie: ${window.ResultsModel.fmtMoney(monthly)}.`,
        };
    }

    function render(container, options = {}) {
        if (!container) return;
        const {
            result,
            input = null,
            title = "Rok po roku",
            density = 5,
            open = false,
            embedded = false,
            tableId = "",
        } = options;
        const postHorizon = Object.prototype.hasOwnProperty.call(options, "postHorizon")
            ? options.postHorizon
            : postHorizonFor(input, result);

        counter += 1;
        const uid = `res-year-table-${counter}`;
        const years = result?.years || [];
        const accounts = (result?.accounts || []).filter(
            (account) => account !== "zus" && account !== "zus:ofe"
        );
        const labels = result?.account_labels || {};
        if (!years.length) {
            container.innerHTML = `<p class="field-hint">Brak danych rocznych do pokazania.</p>`;
            return;
        }
        const hasZus = years.some((year) => {
            const ending = endingBalances(year);
            return (Number(ending.zus) || 0) + (Number(ending["zus:ofe"]) || 0) > 0.5;
        });
        const hasObligations = (input?.obligations || []).length > 0
            || (Number(input?.mortgage_monthly) > 0 && input?.mortgage_end_age != null);
        const hasPartTime = (input?.stages || []).some(
            (stage) => Number(stage.part_time_net_monthly) > 0
        );
        const showLifestyle = hasObligations || hasPartTime;

        const columns = [
            { key: "monthly", label: "Wypłata mies." },
            ...(showLifestyle
                ? [{ key: "lifestyle", label: "Budżet na życie" }]
                : []),
            { key: "wealth", label: "Majątek" },
            { key: "annual", label: "Wypłata roczna" },
            { key: "tax", label: "Podatek" },
            ...accounts.map((account) => ({
                key: account,
                label: labels[account] || account,
                account: true,
            })),
            ...(hasZus ? [{ key: "zus", label: "ZUS (kapitał)", zus: true }] : []),
        ];

        const wealthTip = "Majątek prywatny: suma sald na koniec roku bez ZUS i OFE. ZUS pokazujemy w osobnej kolumnie. Kwoty są brutto — majątek końcowy netto jest po podatku wyjścia.";
        const lifestyleTip = "Budżet na życie: dochód netto (portfel + ZUS + praca) minus aktywne zobowiązania czasowe. W Asystencie planner dolicza zobowiązania do wypłaty, więc budżet pozostaje stabilny; w ręcznym Symulatorze zależy od ustawionych wypłat.";
        const header = columns.map((column) => {
            const classes = ["amount"];
            if (column.key === "monthly") classes.push("col-monthly");
            if (column.key === "lifestyle") classes.push("col-lifestyle");
            const title = column.key === "wealth"
                ? ` title="${window.escapeHtml(wealthTip)}"`
                : column.key === "lifestyle"
                    ? ` title="${window.escapeHtml(lifestyleTip)}"`
                    : "";
            return `<th data-col="${window.escapeHtml(column.key)}" class="${classes.join(" ")}"${title}>${window.escapeHtml(column.label)}</th>`;
        }).join("");

        const valueFor = (column, year) => {
            const ending = endingBalances(year);
            if (column.zus) {
                return money((Number(ending.zus) || 0) + (Number(ending["zus:ofe"]) || 0));
            }
            if (column.account) return money(ending[column.key] || 0);
            if (column.key === "monthly") return money(year.monthly_withdrawal);
            if (column.key === "lifestyle") return money(year.lifestyle_monthly);
            if (column.key === "wealth") return money(privateWealth(year));
            if (column.key === "annual") return money(year.annual_withdrawal);
            if (column.key === "tax") return money(year.tax_paid);
            return money(0);
        };

        const cellFor = (column, year, isPost = false) => {
            const classes = ["amount"];
            if (column.key === "monthly") classes.push("col-monthly");
            if (column.key === "lifestyle") classes.push("col-lifestyle");
            if (column.key === "tax" && (year.tax_paid || 0) < 0) classes.push("text-success");
            const postWealth = isPost && column.key === "wealth";
            const title = postWealth ? ' title="Poza modelem — po horyzoncie pokazujemy tylko ZUS."' : "";
            const value = postWealth ? "—" : valueFor(column, year);
            return `<td class="${classes.join(" ")}" data-col="${window.escapeHtml(column.key)}"${title}>${value}</td>`;
        };

        const rowHtml = (year, index, isPost = false) => {
            const cells = columns.map((column) => cellFor(column, year, isPost)).join("");
            const rowClass = isPost
                ? "highlight post-horizon"
                : (year.monthly_withdrawal > 0 ? "highlight" : "stage-accum");
            const keep = isPost || index === years.length - 1;
            const title = isPost
                ? ` title="${window.escapeHtml(postHorizon.title || "")}"`
                : "";
            return `<tr class="${rowClass}" data-age="${window.escapeHtml(String(year.age))}" data-keep="${keep}"${title}>
                <td class="col-age">${window.escapeHtml(String(year.age))}</td>
                <td class="col-stage">${window.escapeHtml(
                    typeof window.logicalStageName === "function"
                        ? window.logicalStageName(year.stage_name || "")
                        : (year.stage_name || "")
                )}</td>
                ${cells}
            </tr>`;
        };

        const postStart = Number(result?.summary?.end_age) + 1;
        const pensionEnd = zusEndAge(input);
        const postObligations = Array.isArray(input?.obligations) && input.obligations.length
            ? input.obligations
            : (Number(input?.mortgage_monthly) > 0 && input?.mortgage_end_age != null
                ? [{
                    monthly: Number(input.mortgage_monthly),
                    start_age: 0,
                    end_age: Number(input.mortgage_end_age),
                }]
                : []);
        const obligationsAfterHorizon = postHorizon
            && Number.isFinite(postStart)
            && postObligations.some((item) => Number(item.start_age) < (pensionEnd ?? postStart)
                && Number(item.end_age) > postStart);
        const postYear = postHorizon && postHorizon.monthly > 0.5
            ? {
                age: postHorizon.ageLabel,
                stage_name: postHorizon.stageName || "Tylko ZUS",
                balances: {},
                total_wealth: 0,
                annual_withdrawal: postHorizon.annual,
                monthly_withdrawal: postHorizon.monthly,
                lifestyle_monthly: obligationsAfterHorizon ? null : postHorizon.monthly,
                tax_paid: 0,
            }
            : null;
        const rows = years.map((year, index) => rowHtml(year, index)).join("")
            + (postYear ? rowHtml(postYear, years.length, true) : "");

        const columnOptions = columns.map((column) => `
            <label class="res-columns-option">
                <input type="checkbox" data-toggle-col="${window.escapeHtml(column.key)}" checked>
                <span>${window.escapeHtml(column.label)}</span>
            </label>`).join("");

        const body = `<div class="res-year-table-body">
            <div class="toolbar results-toolbar">
                <div class="toolbar-left">
                    <details class="res-columns">
                        <summary class="btn btn-ghost btn-sm" aria-label="Wybierz kolumny">
                            ${window.iconSvg ? window.iconSvg("sliders", "res-columns-icon") : ""}
                            <span class="res-columns-label">Kolumny</span>
                            ${window.iconSvg ? window.iconSvg("chevron", "res-columns-chevron") : ""}
                        </summary>
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
                const isKept = row.dataset.keep === "true";
                row.classList.toggle(
                    "density-hidden",
                    value > 1 && !isLast && !isKept && index % value !== 0
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

    window.ResultsTable = { render, postHorizonFor };
})();
