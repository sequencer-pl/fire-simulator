// results-plan-time.js — wspólny blok "Twój plan w czasie":
// timeline faz, lista etapów i Gantt przepływów.

(function () {
    let counter = 0;

    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html != null) node.innerHTML = html;
        return node;
    }

    function labelOf(account, labels) {
        if (account === "zus") return "ZUS";
        return labels?.[account] || window.accountDisplayLabel?.(account) || account;
    }

    function money(value) {
        return window.ResultsModel.fmtMoney(value);
    }

    function rangePct(age, min, max) {
        return ((age - min) / Math.max(1, max - min)) * 100;
    }

    function phaseName(phase) {
        return phase?.key === "partial_fire" ? "Częściowe FIRE" : (phase?.name || "");
    }

    function horizonMark(age, min, max) {
        if (!Number.isFinite(Number(age)) || age < min || age > max) return "";
        return `<span class="wz-gantt-horizon" style="left:${rangePct(age, min, max)}%" role="img" aria-label="Horyzont planu: ${age} r.ż." title="Horyzont planu: ${age} r.ż."></span>`;
    }

    function timelineHtml(phases, min, max, horizonAge) {
        const legend = horizonMark(horizonAge, min, max);
        return legend + phases.map((phase) => {
            const left = rangePct(phase.start_age, min, max);
            const width = Math.max(1.8, rangePct(phase.end_age, min, max) - left);
            const cls = phase.cashflow === "contribution" ? "wz-tl-acc" : "wz-tl-real";
            const partTime = phase.part_time_monthly > 0.5
                ? ` Część etatu: ${money(phase.part_time_monthly)}/mies.`
                : "";
            return `<div class="wz-timeline-segment ${cls}" style="left:${left}%;width:${width}%" title="${window.escapeHtml(phaseName(phase))}: ${phase.start_age}–${phase.end_age} r.ż.${window.escapeHtml(partTime)}">
                <span class="wz-tl-name">${window.escapeHtml(phaseName(phase))}</span>
                <span class="wz-tl-age">${phase.start_age}–${phase.end_age} r.ż.</span>
                <span class="wz-tl-amount">${phase.monthly > 0 ? `~${money(phase.monthly)}/mies.` : "—"}</span>
                <span class="wz-tl-kind">${phase.cashflow === "contribution" ? "wpłaty" : "wypłata netto"}</span>
            </div>`;
        }).join("");
    }

    function stageRows(stages, labels, projection) {
        if (!stages?.length) return "";
        return stages.map((stage) => {
            const isAccum = stage.type === "akumulacja";
            const accountKeys = (stage.accounts || []).map((account) =>
                typeof account === "string" ? account : account.key
            );
            const isZus = !isAccum && accountKeys.length > 0
                && accountKeys.every((key) => key === "zus");
            const stageClass = isAccum ? "is-accum" : isZus ? "is-zus" : "is-real";
            const accounts = (stage.accounts || [])
                .filter((account) => {
                    const key = typeof account === "string" ? account : account.key;
                    if (isAccum) {
                        if (key === "zus") return false;
                        return (account.monthly || 0) > 0 || (account.balance || 0) > 0;
                    }
                    return !(key === "zus" && stage.end_age <= 65 && accountKeys.length > 1);
                })
                .map((account) => {
                    const key = typeof account === "string" ? account : account.key;
                    return `<span class="chip">${window.escapeHtml(labelOf(key, labels))}</span>`;
                })
                .join("");
            const phase = (projection?.phase_metrics || []).find(
                (item) => item.cashflow === "payout"
                    && item.start_age < stage.end_age
                    && item.end_age > stage.start_age
            );
            const monthly = isAccum
                ? stage.total_monthly
                : (stage.avg_withdrawal || phase?.monthly || phase?.zus_monthly || 0);
            const finance = monthly > 0 ? `~${money(monthly)}/mies.` : "";
            return `<div class="stage-line ${stageClass}">
                <span class="stage-dot ${isAccum ? "accum" : "withdraw"}"></span>
                <span class="stage-label ${isAccum ? "accum" : "withdraw"}">${window.escapeHtml(stage.label)}</span>
                <span class="stage-age">${stage.start_age}→${stage.end_age} r.ż.</span>
                ${accounts}
                ${finance ? `<span class="stage-finance ${isAccum ? "accum" : "withdraw"}">${finance}</span>` : ""}
            </div>`;
        }).join("");
    }

    function ganttHtml(projection, stages, labels, min, max, input, horizonAge) {
        const accountPhases = projection?.account_phases || [];
        const accumulationPhases = projection?.accumulation_phases || [];
        const transfers = projection?.capital_transfers || [];
        const payoutPhases = (projection?.phase_metrics || []).filter(
            (phase) => phase.cashflow === "payout"
        );

        let accounts = [...new Set(accountPhases.map((phase) => phase.account))];
        [...new Set(accumulationPhases.map((phase) => phase.account))].forEach((account) => {
            if (!accounts.includes(account)) accounts.push(account);
        });
        const chartKeys = new Set([
            ...Object.keys(projection?.chart?.balances || {}),
            ...Object.keys(projection?.chart?.withdrawals_net || {}),
        ]);
        (input?.stages || []).forEach((stage) => {
            Object.keys(stage.accounts || {}).forEach((account) => {
                const key = typeof window.baseAccountKey === "function"
                    ? window.baseAccountKey(account)
                    : account;
                if (chartKeys.has(key) && !accounts.includes(key)) accounts.push(key);
            });
        });
        transfers.forEach((transfer) => {
            if (!accounts.includes(transfer.from_account)) accounts.push(transfer.from_account);
            if (!accounts.includes(transfer.to_account)) accounts.push(transfer.to_account);
        });
        if (!accounts.includes("zus") && accountPhases.some((phase) => phase.account === "zus")) {
            accounts.push("zus");
        }

        const step = max - min <= 20 ? 2 : max - min <= 40 ? 5 : 10;
        let html = `<div class="wz-gantt-axis"><span class="wz-gantt-axis-label">Konto</span><div class="wz-gantt-axis-track">`;
        for (let age = Math.ceil(min / step) * step; age <= max; age += step) {
            html += `<span class="wz-gantt-tick" style="left:${rangePct(age, min, max)}%">${age}</span>`;
        }
        html += `</div></div>`;

        let phaseLetterIndex = 0;
        accountPhases.forEach((phase) => {
            phase._letter = String.fromCharCode(65 + (phaseLetterIndex % 26));
            phaseLetterIndex += 1;
        });

        accounts.forEach((account) => {
            const phases = accountPhases.filter((phase) => phase.account === account);
            const accum = accumulationPhases.filter((phase) => phase.account === account);
            let bars = "";
            if (accum.length) {
                accum.forEach((phase) => {
                    if (phase.end_age <= phase.start_age) return;
                    const left = rangePct(phase.start_age, min, max);
                    const width = Math.max(0.8, rangePct(phase.end_age, min, max) - left);
                    bars += `<span class="wz-gantt-accum" style="left:${left}%;width:${width}%" title="Akumulacja ${phase.start_age}–${phase.end_age} r.ż., ${money(phase.monthly_contribution)}/mies."></span>`;
                });
            } else if (phases.length) {
                const starts = phases.map((phase) => phase.accumulation_start_age).filter((value) => value != null);
                const accumStart = starts.length ? Math.min(...starts) : null;
                const firstStart = Math.min(...phases.map((phase) => phase.start_age));
                if (accumStart != null && firstStart > accumStart) {
                    const left = rangePct(accumStart, min, max);
                    const width = Math.max(0.8, rangePct(firstStart, min, max) - left);
                    bars += `<span class="wz-gantt-accum" style="left:${left}%;width:${width}%" title="Akumulacja ${accumStart}–${firstStart} r.ż."></span>`;
                }
            }
            phases.forEach((phase) => {
                const left = rangePct(phase.start_age, min, max);
                const width = Math.max(0.8, rangePct(phase.last_age + 1, min, max) - left);
                const showAmount = width >= 8;
                const amount = `${Math.round(phase.avg_monthly_net).toLocaleString("pl-PL")} zł`;
                const label = `<span class="wz-gantt-phase-letter">${phase._letter || ""}</span>${showAmount ? `<span class="wz-gantt-phase-value">${amount}</span>` : ""}`;
                bars += `<span class="wz-gantt-phase${showAmount ? "" : " is-index"}" style="left:${left}%;width:${width}%" title="${window.escapeHtml(labelOf(account, labels))}: faza ${phase._letter || ""}, ${phase.start_age}–${phase.last_age} r.ż., ${money(phase.avg_monthly_net)}/mies. netto">${label}</span>`;
            });
            html += `<div class="wz-gantt-row">
                <span class="wz-gantt-label">${window.iconSvg(account)}<span>${window.escapeHtml(labelOf(account, labels))}</span></span>
                <div class="wz-gantt-track">${bars}${horizonMark(horizonAge, min, max)}</div>
            </div>`;
        });

        if (transfers.length) {
            let bars = "";
            const byAge = new Map();
            transfers.forEach((transfer) => {
                if (!byAge.has(transfer.age)) byAge.set(transfer.age, []);
                byAge.get(transfer.age).push(transfer);
            });
            byAge.forEach((items, age) => {
                const left = rangePct(age, min, max);
                const summary = items
                    .map((transfer) => `${labelOf(transfer.from_account, labels)} → ${labelOf(transfer.to_account, labels)}`)
                    .join(", ");
                bars += `<span class="wz-gantt-transfer" style="left:${left}%" title="Transfery ${age} r.ż.: ${window.escapeHtml(summary)}">${window.iconSvg("arrow")}</span>`;
            });
            html += `<div class="wz-gantt-row wz-gantt-transfer-row">
                <span class="wz-gantt-label">${window.iconSvg("arrow")}<span>Transfery</span></span>
                <div class="wz-gantt-track">${bars}${horizonMark(horizonAge, min, max)}</div>
            </div>`;
        }

        if (payoutPhases.length) {
            let bars = "";
            payoutPhases.forEach((phase) => {
                const left = rangePct(phase.start_age, min, max);
                const width = Math.max(0.8, rangePct(phase.end_age, min, max) - left);
                const label = width >= 8 ? `${Math.round(phase.monthly).toLocaleString("pl-PL")} zł/mies.` : "";
                const partTime = phase.part_time_monthly > 0.5
                    ? ` Część etatu: ${money(phase.part_time_monthly)}/mies.`
                    : "";
                bars += `<span class="wz-gantt-phase is-total" style="left:${left}%;width:${width}%" title="${window.escapeHtml(phaseName(phase))}: ${phase.start_age}–${phase.end_age} r.ż., ${money(phase.monthly)}/mies.${window.escapeHtml(partTime)}">${label}</span>`;
            });
            html += `<div class="wz-gantt-row wz-gantt-total"><span class="wz-gantt-label">Razem</span><div class="wz-gantt-track">${bars}${horizonMark(horizonAge, min, max)}</div></div>`;
        }

        return html;
    }

    function render(container, options = {}) {
        if (!container) return;
        const {
            input,
            projection,
            summary,
            result,
            stages,
            labels = {},
            title = "Twój plan w czasie",
            tip = "Górna oś pokazuje etapy życia. Pasek kont pokazuje, z których kont pochodzą wpłaty i wypłaty w danym wieku.",
            collapsed = false,
        } = options;

        const phases = projection?.phase_metrics || [];
        const allAges = [
            ...phases.flatMap((phase) => [phase.start_age, phase.end_age]),
            ...(projection?.account_phases || []).flatMap((phase) => [phase.start_age, phase.last_age + 1]),
            ...(input?.stages || []).flatMap((stage) => [stage.start_age, stage.end_age]),
        ];
        if (!allAges.length) {
            container.innerHTML = "";
            return;
        }
        const min = Math.min(...allAges);
        const max = Math.max(...allAges);
        const horizonAge = summary?.end_age != null
            ? Number(summary.end_age) + 1
            : null;

        counter += 1;
        const uid = `res-plan-time-${counter}`;
        container.innerHTML = `<section class="res-plan-time" id="${uid}">
            ${window.ResultsSection.head(title, {
                className: "eyebrow wz-panel-title",
                tip,
                actionsHtml: summary?.total_withdrawn
                    ? `<span class="chip">${money(summary.total_withdrawn)} łącznie netto</span>`
                    : "",
            })}
            <div class="wz-plan-block">
                <div class="wz-timeline" tabindex="0" role="group" aria-label="Etapy planu na osi wieku">${timelineHtml(phases, min, max, horizonAge)}</div>
            </div>
            <div class="res-stage-summary">
                <h4 class="wz-plan-subhead">Etapy</h4>
                ${stages?.length
                    ? stageRows(stages, labels, projection)
                    : `<p class="field-hint">Etapy policzą się po wczytaniu pełnego wyniku.</p>`}
            </div>
            <div class="wz-flows-wrap">
                <h4 class="wz-plan-subhead">Z czego żyjesz w kolejnych latach</h4>
                <div class="wz-flows-gantt-scroll" tabindex="0" role="group" aria-label="Gantt przepływów: wpłaty, wypłaty i transfery według wieku">
                    <div class="wz-flows-gantt">${ganttHtml(projection, stages, labels, min, max, input, horizonAge)}</div>
                </div>
            </div>
        </section>`;
    }

    window.ResultsPlanTime = { render };
})();
