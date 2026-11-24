// results-plan-time.js — wspólny blok "Twój plan w czasie":
// timeline faz, lista etapów, Gantt przepływów, tabela przepływów i tooltipy.
// Implementacja przeniesiona z Asystenta; używana przez Asystenta i Symulator.

(function () {
    function el(id) {
        return document.getElementById(id);
    }

    function accountLabel(account, customName = "") {
        if (typeof window.accountDisplayLabel === "function") {
            return window.accountDisplayLabel(account, customName);
        }
        return customName || account;
    }

    function accountIcon(account) {
        if (typeof window.accountIconFor === "function") return window.accountIconFor(account);
        return "";
    }

    function hideChartTips() {
        window.ResultsCharts?.hideTips?.();
    }

function wzFormatYears(years) {
    if (years === 1) return "1 rok";
    if (years >= 2 && years <= 4) return `${years} lata`;
    return `${years} lat`;
}

function wzInputHorizonAge(input) {
    return window.ResultsModel.horizonAge(input);
}

function wzRenderStageSummaryFromResult(input, result, projection, target = null) {
    const box = target || el("wzStageSummary");
    if (!box || !input || !result) return;
    const stages = typeof computeStageSummaries === "function"
        ? computeStageSummaries(input, result)
        : [];
    if (!stages.length) {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
    }
    const rows = stages.map((stage) => {
        const isAccum = stage.type === "akumulacja";
        const accountKeys = (stage.accounts || []).map((account) => account.key || account);
        const isZus = !isAccum && accountKeys.length > 0
            && accountKeys.every((key) => key === "zus");
        const stageClass = isAccum ? "is-accum" : isZus ? "is-zus" : "is-real";
        const accounts = (stage.accounts || [])
            .filter((account) => {
                const key = account.key || account;
                if (isAccum) {
                    if (key === "zus") return false;
                    return (account.monthly || 0) > 0 || (account.balance || 0) > 0;
                }
                return !(key === "zus" && stage.end_age <= 65 && accountKeys.length > 1);
            })
            .map((account) => `<span class="chip">${escapeHtml(accountDisplayLabel(account.key || account))}</span>`)
            .join("");
        const phase = (projection?.phase_metrics || []).find(
            (item) => item.cashflow === "payout"
                && item.start_age < stage.end_age
                && item.end_age > stage.start_age
        );
        const monthly = isAccum
            ? stage.total_monthly
            : (stage.avg_withdrawal || phase?.monthly || phase?.zus_monthly || 0);
        const finance = monthly > 0 ? `~${formatMoney(monthly)}/mies.` : "";
        return `<div class="stage-line ${stageClass}">
            <span class="stage-dot ${isAccum ? "accum" : "withdraw"}"></span>
            <span class="stage-label ${isAccum ? "accum" : "withdraw"}">${escapeHtml(stage.label)}</span>
            <span class="stage-age">${stage.start_age}→${stage.end_age} r.ż.</span>
            ${accounts}
            ${finance ? `<span class="stage-finance ${isAccum ? "accum" : "withdraw"}">${finance}</span>` : ""}
        </div>`;
    }).join("");
    box.classList.remove("hidden");
    box.innerHTML = `<h4 class="wz-plan-subhead">Etapy</h4>${rows}`;
}

function wzRenderTimeline(input, projection) {
    const box = el("wzTimeline");
    if (!box) return;
    box.innerHTML = "";
    const phases = projection?.phase_metrics || [];
    if (phases.length) {
        const ordered = [...phases].sort((a, b) => a.start_age - b.start_age);
        const min = Math.min(...ordered.map((phase) => phase.start_age));
        const max = Math.max(...ordered.map((phase) => phase.end_age));
        const width = max - min || 1;
        ordered.forEach((phase, index) => {
            const leftPct = ((phase.start_age - min) / width) * 100;
            const spanPct = Math.max(2, ((phase.end_age - phase.start_age) / width) * 100);
            const isAccum = phase.cashflow === "contribution";
            const seg = document.createElement("div");
            seg.className = `wz-timeline-segment ${isAccum ? "wz-tl-acc" : "wz-tl-real"}`;
            seg.style.left = `${leftPct}%`;
            seg.style.width = `${spanPct}%`;
            seg.dataset.phaseIndex = String(index);
            seg.setAttribute("role", "button");
            seg.tabIndex = 0;
            const phaseName = phase.key === "partial_fire" ? "Częściowe FIRE" : phase.name;
            seg.setAttribute(
                "aria-label",
                `${phaseName}, ${phase.start_age}–${phase.end_age} r.ż., `
                + `${isAccum ? "wpłaty" : "wypłata netto"} ${wzFmtZloty(phase.monthly)} zł/mies. — szczegóły`
            );
            seg.innerHTML = `
                <span class="wz-tl-name">${escapeHtml(phaseName)}</span>
                <span class="wz-tl-age">${phase.start_age}–${phase.end_age} r.ż.</span>
                <span class="wz-tl-amount">${phase.monthly > 0 ? `~${fmtMoney(phase.monthly)}/mies.` : "—"}</span>
                <span class="wz-tl-kind">${isAccum ? "wpłaty" : "wypłata netto"}</span>`;
            box.appendChild(seg);
        });
        const horizonAge = wzInputHorizonAge(input);
        if (Number.isFinite(horizonAge) && horizonAge >= min && horizonAge <= max) {
            const line = document.createElement("span");
            line.className = "wz-gantt-horizon";
            line.style.left = `${((horizonAge - min) / width) * 100}%`;
            line.title = `Horyzont planu: ${horizonAge} r.ż.`;
            line.setAttribute("role", "img");
            line.setAttribute("aria-label", `Horyzont planu: ${horizonAge} r.ż.`);
            box.appendChild(line);
        }
        setupTimelineDetails(box, ordered);
        return;
    }

    const stages = input?.stages || [];
    if (!stages.length) return;
    const spans = [];
    stages.forEach((stage) => {
        const kind = stage.stage_type === "realizacja" ? "realizacja" : "akumulacja";
        const label = stage.name || (kind === "realizacja" ? "Realizacja" : "Akumulacja");
        const existing = spans.find(
            (span) => span.kind === kind && span.start === stage.start_age && span.end === stage.end_age
        );
        if (existing) {
            if (!existing.label.includes(label)) existing.label += ` + ${label}`;
        } else {
            spans.push({ kind, label, start: stage.start_age, end: stage.end_age });
        }
    });
    const min = Math.min(...spans.map((span) => span.start));
    const max = Math.max(...spans.map((span) => span.end));
    const width = max - min || 1;
    spans.forEach((span) => {
        const seg = document.createElement("div");
        seg.className = `wz-timeline-segment ${span.kind === "realizacja" ? "wz-tl-real" : "wz-tl-acc"}`;
        seg.style.left = `${((span.start - min) / width) * 100}%`;
        seg.style.width = `${Math.max(2, ((span.end - span.start) / width) * 100)}%`;
        seg.title = `${span.label}: ${span.start} → ${span.end} r.ż.`;
        seg.innerHTML = `
            <span class="wz-tl-name">${escapeHtml(span.label)}</span>
            <span class="wz-tl-age">${span.start}–${span.end} r.ż.</span>`;
        box.appendChild(seg);
    });
    const horizonAge = wzInputHorizonAge(input);
    if (Number.isFinite(horizonAge) && horizonAge >= min && horizonAge <= max) {
        const line = document.createElement("span");
        line.className = "wz-gantt-horizon";
        line.style.left = `${((horizonAge - min) / width) * 100}%`;
        line.title = `Horyzont planu: ${horizonAge} r.ż.`;
        box.appendChild(line);
    }
}

let wzTimelinePhases = [];

function wzTimelineTipHtml(phase) {
    const rows = [];
    const years = Math.max(0, phase.end_age - phase.start_age);
    const period = `${phase.start_age}–${phase.end_age} r.ż.`;
    if (phase.cashflow === "contribution") {
        rows.push(wzGanttTipRow("Wpłaty miesięcznie", `${wzFmtZloty(phase.monthly)} zł`));
        rows.push(wzGanttTipRow("Okres", period, wzFormatYears(years)));
        rows.push(wzGanttTipRow(
            "Łącznie wpłacono (≈)",
            `${wzFmtZloty(phase.monthly * years * 12)} zł`
        ));
        return wzGanttTipPanel(phase.name, "Akumulacja", rows);
    }
    rows.push(wzGanttTipRow("Dochód netto", `${wzFmtZloty(phase.monthly)} zł/mies.`));
    rows.push(wzGanttTipRow("Okres", period, wzFormatYears(years)));
    if (phase.portfolio_monthly > 0.5) {
        rows.push(wzGanttTipRow("Portfel", `${wzFmtZloty(phase.portfolio_monthly)} zł/mies.`));
    }
    if (phase.zus_monthly > 0.5) {
        rows.push(wzGanttTipRow("ZUS", `${wzFmtZloty(phase.zus_monthly)} zł/mies.`));
    }
    if (phase.part_time_monthly > 0.5) {
        rows.push(wzGanttTipRow(
            "Część etatu",
            `${wzFmtZloty(phase.part_time_monthly)} zł/mies.`
        ));
    }
    if (phase.obligations_monthly > 0.5) {
        rows.push(wzGanttTipRow(
            "Zobowiązania",
            `−${wzFmtZloty(phase.obligations_monthly)} zł/mies.`
        ));
        rows.push(wzGanttTipRow(
            "Na życie",
            `${wzFmtZloty(phase.lifestyle_monthly || 0)} zł/mies.`
        ));
    }
    rows.push(wzGanttTipRow(
        "Razem dochód (≈)",
        `${wzFmtZloty(phase.monthly * years * 12)} zł`
    ));
    return wzGanttTipPanel(
        phase.key === "partial_fire" ? "Częściowe FIRE" : phase.name,
        "Wypłaty",
        rows
    );
}

function setupTimelineDetails(box, phases) {
    wzTimelinePhases = phases;
    if (box.dataset.timelineBound === "true") return;
    box.dataset.timelineBound = "true";
    const open = (segment) => {
        const phase = wzTimelinePhases[Number(segment.dataset.phaseIndex)];
        if (!phase) return;
        wzDetailShow(segment, wzTimelineTipHtml(phase), true);
    };
    box.addEventListener("click", (event) => {
        const segment = event.target.closest?.(".wz-timeline-segment");
        if (!segment) return;
        event.preventDefault();
        open(segment);
    });
    box.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const segment = event.target.closest?.(".wz-timeline-segment");
        if (!segment) return;
        event.preventDefault();
        open(segment);
    });
}

function wzFmtZloty(value) {
    return Math.round(value || 0).toLocaleString("pl-PL");
}

function wzFlowMonthlyLabel(phase) {
    const avg = phase.avg_monthly_net || 0;
    const min = phase.min_monthly_net || avg;
    const max = phase.max_monthly_net || avg;
    if (max - min > Math.max(50, avg * 0.05)) {
        return `${wzFmtZloty(min)}–${wzFmtZloty(max)}`;
    }
    return wzFmtZloty(avg);
}

function wzPhaseBadge(n) {
    let out = "";
    while (n > 0) {
        n -= 1;
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26);
    }
    return out;
}

function wzFlowsRange(input, phases, extraAges = []) {
    const ages = [];
    (input?.stages || []).forEach((stage) => ages.push(stage.start_age, stage.end_age));
    phases.forEach((phase) => {
        if (phase.accumulation_start_age != null) ages.push(phase.accumulation_start_age);
    });
    phases.forEach((phase) => ages.push(phase.start_age, phase.last_age + 1));
    extraAges.filter((age) => Number.isFinite(Number(age))).forEach((age) => ages.push(Number(age)));
    if (!ages.length) return { min: 0, max: 1 };
    const min = Math.min(...ages);
    const max = Math.max(...ages);
    return { min, max: Math.max(min + 1, max) };
}

function wzFlowPct(age, range) {
    return ((age - range.min) / (range.max - range.min)) * 100;
}

let wzGanttTips = [];
let wzGanttBound = false;
let wzGanttPinned = false;
let wzGanttActive = null;
let wzGanttHideTimer = null;
let wzGanttShowTimer = null;
const WZ_GANTT_TIP_HOVER_DELAY = 900;

function wzGanttTipHide(force = false) {
    if (wzGanttPinned && !force) return;
    clearTimeout(wzGanttShowTimer);
    wzGanttPinned = false;
    wzGanttActive = null;
    el("wzGanttTip")?.classList.add("hidden");
}

function wzGanttTipPlace() {
    const tip = el("wzGanttTip");
    const anchor = wzGanttActive;
    if (!tip || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - height - 8);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function wzGanttTipCancelShow() {
    clearTimeout(wzGanttShowTimer);
    wzGanttShowTimer = null;
}

function wzDetailShow(anchor, html, pin = false) {
    const tip = el("wzGanttTip");
    const body = el("wzGanttTipBody");
    if (!html || !tip || !body) return;
    hideChartTips();
    wzGanttTipCancelShow();
    body.innerHTML = html;
    tip.classList.remove("hidden");
    wzGanttActive = anchor;
    wzGanttPinned = pin;
    requestAnimationFrame(wzGanttTipPlace);
}

function wzGanttTipShow(anchor, pin = false) {
    const html = wzGanttTips[Number(anchor.dataset.tipId)];
    if (!html) return;
    wzDetailShow(anchor, html, pin);
}

function wzGanttTipScheduleHide() {
    clearTimeout(wzGanttHideTimer);
    wzGanttHideTimer = setTimeout(() => {
        if (!wzGanttPinned) wzGanttTipHide();
    }, 140);
}

function setupGanttTips(gantt, tips) {
    wzGanttTips = tips;
    wzGanttTipHide(true);
    const anchorOf = (event) => event.target.closest?.("[data-tip-id]");
    if (gantt.dataset.tipsBound !== "true") {
        gantt.dataset.tipsBound = "true";
        gantt.addEventListener("mouseover", (event) => {
            const anchor = anchorOf(event);
            if (!anchor || wzGanttPinned) return;
            if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
            if (wzGanttActive === anchor) return;
            wzGanttTipCancelShow();
            clearTimeout(wzGanttHideTimer);
            wzGanttShowTimer = setTimeout(() => {
                wzGanttShowTimer = null;
                if (!wzGanttPinned && anchor.isConnected) wzGanttTipShow(anchor);
            }, WZ_GANTT_TIP_HOVER_DELAY);
        });
        gantt.addEventListener("mouseout", (event) => {
            const anchor = anchorOf(event);
            if (!anchor) return;
            if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
            wzGanttTipCancelShow();
            wzGanttTipScheduleHide();
        });
        gantt.addEventListener("click", (event) => {
            const anchor = anchorOf(event);
            if (!anchor) return;
            event.preventDefault();
            wzGanttTipCancelShow();
            if (wzGanttActive === anchor && wzGanttPinned) {
                wzGanttTipHide(true);
            } else {
                wzGanttTipShow(anchor, true);
            }
        });
        gantt.addEventListener("focusin", (event) => {
            const anchor = anchorOf(event);
            if (anchor) {
                wzGanttTipCancelShow();
                wzGanttTipShow(anchor, wzGanttPinned);
            }
        });
        gantt.addEventListener("focusout", (event) => {
            if (anchorOf(event)) wzGanttTipScheduleHide();
        });
    }
    if (wzGanttBound) return;
    wzGanttBound = true;
    const tip = el("wzGanttTip");
    const close = el("wzGanttTipClose");
    if (tip) {
        tip.addEventListener("mouseenter", () => clearTimeout(wzGanttHideTimer));
        tip.addEventListener("mouseleave", wzGanttTipScheduleHide);
    }
    if (close) close.addEventListener("click", () => wzGanttTipHide(true));
    document.addEventListener("pointerdown", (event) => {
        wzGanttTipCancelShow();
        if (!wzGanttActive) return;
        if (tip && (tip.contains(event.target) || event.target.closest?.("[data-tip-id]"))) return;
        wzGanttTipHide(true);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") wzGanttTipHide(true);
    });
    window.addEventListener(
        "scroll",
        () => {
            wzGanttTipCancelShow();
            if (!wzGanttPinned) wzGanttTipHide(true);
            else if (wzGanttActive) requestAnimationFrame(wzGanttTipPlace);
        },
        true
    );
    window.addEventListener("resize", () => {
        if (wzGanttActive) requestAnimationFrame(wzGanttTipPlace);
    });
}

function wzGanttTipRow(label, value, note = "") {
    const noteHtml = note ? `<span class="wz-gantt-tip-note">${escapeHtml(note)}</span>` : "";
    return `<div class="wz-gantt-tip-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}${noteHtml}</dd></div>`;
}

function wzGanttTipPanel(title, subtitle, rows) {
    return `<div class="wz-gantt-tip-title">${escapeHtml(title)}</div>
        <div class="wz-gantt-tip-sub">${escapeHtml(subtitle)}</div>
        <dl class="wz-gantt-tip-list">${rows.join("")}</dl>`;
}

function wzAccumulationTipHtml(input, phase, accountLabel) {
    const rows = [];
    rows.push(wzGanttTipRow("Kapitał startowy", `${wzFmtZloty(phase.accumulation_start_balance)} zł`));

    let annual = phase.accumulation_annual_contribution || 0;
    if (phase.account === "ppk") {
        const ppkCfg = input?.config?.ppk || {};
        const ppkStage = (input?.stages || []).find(
            (stage) => stage.stage_type === "akumulacja" && stage.accounts?.ppk
        );
        const topups = ppkStage?.accounts?.ppk?.state_topups !== false;
        const stateAnnual = topups ? ppkCfg.state_annual ?? 240 : 0;
        const welcoming = topups ? ppkCfg.state_welcoming ?? 250 : 0;
        annual = Math.max(0, annual - stateAnnual);
        if (annual > 0.5) {
            rows.push(wzGanttTipRow(
                "Wpłaty roczne",
                `${wzFmtZloty(annual)} zł`,
                `≈ ${wzFmtZloty(annual / 12)} zł/mies. (pracownik + pracodawca)`
            ));
        }
        if (topups) {
            rows.push(wzGanttTipRow(
                "Dopłaty państwa",
                `${wzFmtZloty(stateAnnual)} zł/rok`,
                `+ ${wzFmtZloty(welcoming)} zł jednorazowo`
            ));
        }
    } else if (annual > 0.5) {
        rows.push(wzGanttTipRow(
            "Wpłaty roczne",
            `${wzFmtZloty(annual)} zł`,
            `≈ ${wzFmtZloty(annual / 12)} zł/mies.`
        ));
    }

    if (phase.accumulation_total_contributions > 0.5) {
        rows.push(wzGanttTipRow(
            "Wpłaty łącznie",
            `${wzFmtZloty(phase.accumulation_total_contributions)} zł`
        ));
    }
    const endAge = phase.accumulation_end_age;
    rows.push(wzGanttTipRow(
        endAge != null ? `Kapitał na koniec wpłat (${endAge} r.ż.)` : "Kapitał na koniec",
        `${wzFmtZloty(phase.accumulation_end_balance)} zł`
    ));
    rows.push(wzGanttTipRow(
        phase.account === "zus" ? "Wzrost (składki + waloryzacja)" : "Wzrost (odsetki)",
        `${wzFmtZloty(phase.accumulation_growth)} zł`
    ));
    if (endAge != null && phase.start_age > endAge) {
        const note = phase.starting_balance < phase.accumulation_end_balance
            ? `po podatkach lub przepadku (${phase.start_age} r.ż.)`
            : `po dalszym wzroście lub transferach (${phase.start_age} r.ż.)`;
        rows.push(wzGanttTipRow(
            "Saldo przed 1. wypłatą",
            `${wzFmtZloty(phase.starting_balance)} zł`,
            note
        ));
    }

    const start = phase.accumulation_start_age;
    const years = start != null && endAge != null ? Math.max(0, endAge - start) : null;
    const period = start != null && endAge != null ? `${start}–${endAge} r.ż.` : "";
    const subtitle = `Akumulacja · ${period}${years ? ` · wpłaty przez ${wzFormatYears(years)}` : ""}`;
    return wzGanttTipPanel(accountLabel, subtitle, rows);
}

function wzPhaseTipHtml(phase, accountLabel, phaseLabel) {
    const rows = [];
    rows.push(wzGanttTipRow("Miesięcznie netto", `${wzFlowMonthlyLabel(phase)} zł`));
    rows.push(wzGanttTipRow("Razem netto", `${wzFmtZloty(phase.total_net)} zł`));
    rows.push(wzGanttTipRow(
        phase.account === "zus" ? "Kapitał ZUS" : "Saldo na start",
        `${wzFmtZloty(phase.starting_balance)} zł`
    ));
    rows.push(wzGanttTipRow("Saldo na koniec", `${wzFmtZloty(phase.ending_balance)} zł`));

    if (phase.total_tax > 0.5) {
        rows.push(wzGanttTipRow("PIT", `${wzFmtZloty(phase.total_tax)} zł`));
    }
    if (phase.total_health > 0.5) {
        rows.push(wzGanttTipRow("Składka zdrowotna", `${wzFmtZloty(phase.total_health)} zł`));
    }
    if (phase.lump_tax > 0.5) {
        rows.push(wzGanttTipRow("Podatek jednorazowy IKZE", `${wzFmtZloty(phase.lump_tax)} zł`));
    }

    const subtitle = `Faza ${phaseLabel} · ${phase.start_age}–${phase.last_age} r.ż. · ${wzFormatYears(phase.years)}`;
    return wzGanttTipPanel(accountLabel, subtitle, rows);
}

function wzTotalTipHtml(phase) {
    const years = Math.max(0, phase.end_age - phase.start_age);
    const rows = [];
    rows.push(wzGanttTipRow("Dochód netto", `${wzFmtZloty(phase.monthly || 0)} zł`));
    rows.push(wzGanttTipRow("Okres", `${phase.start_age}–${phase.end_age} r.ż.`, wzFormatYears(years)));
    if (phase.portfolio_monthly > 0.5) {
        rows.push(wzGanttTipRow("Portfel", `${wzFmtZloty(phase.portfolio_monthly)} zł/mies.`));
    }
    if (phase.zus_monthly > 0.5) {
        rows.push(wzGanttTipRow("ZUS", `${wzFmtZloty(phase.zus_monthly)} zł/mies.`));
    }
    if (phase.part_time_monthly > 0.5) {
        rows.push(wzGanttTipRow(
            "Część etatu",
            `${wzFmtZloty(phase.part_time_monthly)} zł/mies.`
        ));
    }
    if (phase.obligations_monthly > 0.5) {
        rows.push(wzGanttTipRow(
            "Zobowiązania",
            `−${wzFmtZloty(phase.obligations_monthly)} zł/mies.`
        ));
        rows.push(wzGanttTipRow(
            "Na życie",
            `${wzFmtZloty(phase.lifestyle_monthly || 0)} zł/mies.`
        ));
    }
    rows.push(wzGanttTipRow(
        "Razem dochód (≈)",
        `${wzFmtZloty((phase.monthly || 0) * years * 12)} zł`
    ));
    return wzGanttTipPanel(
        phase.key === "partial_fire" ? "Częściowe FIRE" : (phase.name || "Razem"),
        "Wypłaty łączne",
        rows
    );
}

function wzAccumulationPhaseTipHtml(phase, accountLabel) {
    const rows = [
        wzGanttTipRow("Wpłata miesięcznie", `${wzFmtZloty(phase.monthly_contribution)} zł`),
        wzGanttTipRow(
            "Okres",
            `${phase.start_age}–${phase.end_age} r.ż.`,
            wzFormatYears(Math.max(0, phase.end_age - phase.start_age))
        ),
        wzGanttTipRow("Wpłaty łącznie", `${wzFmtZloty(phase.total_contributions)} zł`),
        wzGanttTipRow("Kapitał startowy", `${wzFmtZloty(phase.starting_balance)} zł`),
        wzGanttTipRow(
            `Kapitał na koniec (${phase.end_age - 1} r.ż.)`,
            `${wzFmtZloty(phase.ending_balance)} zł`
        ),
        wzGanttTipRow("Wzrost", `${wzFmtZloty(phase.growth)} zł`),
    ];
    return wzGanttTipPanel(`${accountLabel} — akumulacja`, "Akumulacja", rows);
}

function wzTransferTipHtml(transfers, projection, accountLabel) {
    const age = transfers[0]?.age;
    const rows = transfers.map((transfer) => wzGanttTipRow(
        `${accountLabel(transfer.from_account)} → ${accountLabel(transfer.to_account)}`,
        `${wzFmtZloty(transfer.amount)} zł netto`
    ));
    if (projection?.early_return_tax_total > 0.5) {
        rows.push(wzGanttTipRow(
            "Podatek od wcześniejszego zwrotu IKZE",
            `${wzFmtZloty(projection.early_return_tax_total)} zł`
        ));
    }
    return wzGanttTipPanel(`Transfery — ${age} r.ż.`, "Przepływ kapitału", rows);
}

function wzRenderAccumulationTable(phases, accountLabel) {
    if (!phases.length) return "";
    const rows = phases.map((phase) => `
        <tr>
            <td data-label="Konto">${escapeHtml(accountLabel(phase.account))}</td>
            <td data-label="Okres">${phase.start_age}–${phase.end_age} r.ż.</td>
            <td data-label="Wpłata miesięcznie">${fmtMoney(phase.monthly_contribution)}/mies.</td>
            <td data-label="Wpłaty łącznie">${fmtMoney(phase.total_contributions)}</td>
            <td data-label="Wzrost">${fmtMoney(phase.growth)}</td>
            <td data-label="Saldo końcowe">${fmtMoney(phase.ending_balance)}</td>
        </tr>`).join("");
    return `
        <h5 class="wz-flows-subtitle">Akumulacja</h5>
        <div class="wz-flows-table-wrap">
            <table class="wz-flows-table">
                <thead><tr><th>Konto</th><th>Okres</th><th>Wpłata miesięcznie</th><th>Wpłaty łącznie</th><th>Wzrost</th><th>Saldo końcowe</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function wzRenderTransferTable(transfers, projection, accountLabel) {
    if (!transfers.length) return "";
    const rows = transfers.map((transfer) => `
        <tr>
            <td data-label="Wiek">${transfer.age} r.ż.</td>
            <td data-label="Z konta">${escapeHtml(accountLabel(transfer.from_account))}</td>
            <td data-label="Na konto">${escapeHtml(accountLabel(transfer.to_account))}</td>
            <td data-label="Kwota netto">${fmtMoney(transfer.amount)}</td>
        </tr>`).join("");
    const taxNote = projection?.early_return_tax_total > 0.5
        ? `<p class="field-hint">Podatek od wcześniejszego zwrotu IKZE: ${fmtMoney(projection.early_return_tax_total)} łącznie.</p>`
        : "";
    return `
        <h5 class="wz-flows-subtitle">Transfery kapitału</h5>
        <div class="wz-flows-table-wrap">
            <table class="wz-flows-table">
                <thead><tr><th>Wiek</th><th>Z konta</th><th>Na konto</th><th>Kwota netto</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${taxNote}`;
}

function wzRenderAccountFlows(input, projection) {
    const wrap = el("wzAccountFlows");
    const gantt = el("wzFlowsGantt");
    const flowsWrap = el("wzFlowsWrap");
    const tableDetails = el("wzFlowsTableDetails");
    const phases = projection?.account_phases || [];
    const accumulationPhases = projection?.accumulation_phases || [];
    const transfers = projection?.capital_transfers || [];
    if (!wrap || !gantt || (!phases.length && !accumulationPhases.length && !transfers.length)) {
        flowsWrap?.classList.add("hidden");
        tableDetails?.classList.add("hidden");
        if (wrap) {
            wrap.innerHTML = "<p class=\"field-hint\">Brak szczegółowych danych o wypłatach z kont w tym planie.</p>";
        }
        return;
    }
    flowsWrap?.classList.remove("hidden");
    tableDetails?.classList.remove("hidden");

    const range = wzFlowsRange(input, phases, [
        ...accumulationPhases.flatMap((phase) => [phase.start_age, phase.end_age]),
        ...transfers.map((transfer) => transfer.age),
    ]);
    const flowLabels = new Map();
    phases.forEach((phase, index) => {
        flowLabels.set(phase, wzPhaseBadge(index + 1));
    });
    const customNames = new Map();
    (input?.stages || []).forEach((stage) => {
        Object.entries(stage.accounts || {}).forEach(([account, config]) => {
            if (config?.custom_name) customNames.set(account, config.custom_name);
        });
    });
    const accountName = (account) => account === "zus"
        ? "ZUS (emerytura)"
        : accountLabel(account, customNames.get(account) || "");
    const tips = [];
    const addTip = (html) => {
        tips.push(html);
        return tips.length - 1;
    };

    const baseAccounts = [...new Set(phases.map((phase) => phase.account))];
    const allAccounts = new Set(baseAccounts);
    accumulationPhases.forEach((phase) => allAccounts.add(phase.account));
    transfers.forEach((transfer) => {
        allAccounts.add(transfer.from_account);
        allAccounts.add(transfer.to_account);
    });
    const extraAccounts = [...allAccounts].filter((account) => !baseAccounts.includes(account));
    const zusIndex = baseAccounts.indexOf("zus");
    const accounts = zusIndex >= 0
        ? [...baseAccounts.slice(0, zusIndex), ...extraAccounts, ...baseAccounts.slice(zusIndex)]
        : [...baseAccounts, ...extraAccounts];
    const step = range.max - range.min <= 20 ? 2 : 5;
    let ganttHtml = `<div class="wz-gantt-axis"><span class="wz-gantt-axis-label">Konto</span><div class="wz-gantt-axis-track">`;
    for (let age = Math.ceil(range.min / step) * step; age <= range.max; age += step) {
        ganttHtml += `<span class="wz-gantt-tick" style="left:${wzFlowPct(age, range).toFixed(2)}%">${age}</span>`;
    }
    ganttHtml += `</div></div>`;

    accounts.forEach((account) => {
        const list = phases.filter((phase) => phase.account === account);
        const accumList = accumulationPhases.filter((phase) => phase.account === account);
        let bars = "";
        if (accumList.length) {
            accumList.forEach((phase) => {
                if (phase.end_age <= phase.start_age) return;
                const left = wzFlowPct(phase.start_age, range);
                const width = Math.max(
                    0.8,
                    wzFlowPct(phase.end_age, range) - left
                );
                const tipIdx = addTip(
                    wzAccumulationPhaseTipHtml(phase, accountName(account))
                );
                const tipLabel = `Akumulacja ${phase.start_age}–${phase.end_age} r.ż., ${wzFmtZloty(phase.monthly_contribution)} zł/mies. — szczegóły`;
                bars += `<span class="wz-gantt-accum" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}"></span>`;
            });
        } else if (list.length && account !== "zus") {
            // Zgodność ze starymi zapisanymi planami bez accumulation_phases.
            const starts = list.map((phase) => phase.accumulation_start_age).filter((value) => value != null);
            const accumStart = starts.length ? Math.min(...starts) : null;
            const firstStart = Math.min(...list.map((phase) => phase.start_age));
            const firstPhase = list[0];
            if (accumStart != null && firstStart > accumStart && accumStart >= range.min) {
                const left = wzFlowPct(accumStart, range);
                const width = wzFlowPct(firstStart, range) - left;
                const tipIdx = addTip(wzAccumulationTipHtml(input, firstPhase, accountName(account)));
                const accumEnd = firstPhase.accumulation_end_age ?? firstStart;
                const tipLabel = `Akumulacja ${accumStart}–${accumEnd} r.ż. — szczegóły`;
                bars += `<span class="wz-gantt-accum" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}"></span>`;
            }
        }
        list.forEach((phase) => {
            const left = wzFlowPct(phase.start_age, range);
            const width = Math.max(0.8, wzFlowPct(phase.last_age + 1, range) - left);
            const short = Math.round(phase.avg_monthly_net).toLocaleString("pl-PL");
            const showUnit = width >= 11;
            const showAmount = width >= 7.5;
            const amountText = showUnit ? `${short} zł` : showAmount ? short : "";
            const phaseLabel = flowLabels.get(phase) || "";
            const label = `<span class="wz-gantt-phase-letter">${phaseLabel}</span>`
                + (amountText ? `<span class="wz-gantt-phase-value">${amountText}</span>` : "");
            const cls = showAmount ? "" : " is-index";
            const tipIdx = addTip(wzPhaseTipHtml(phase, accountName(account), phaseLabel));
            const tipLabel = `${accountName(account)}: faza ${phaseLabel}, ${phase.start_age}–${phase.last_age} r.ż., ${wzFlowMonthlyLabel(phase)} zł/mies. netto — szczegóły`;
            bars += `<span class="wz-gantt-phase${cls}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}">${label}</span>`;
        });
        ganttHtml += `<div class="wz-gantt-row"><span class="wz-gantt-label">${accountIcon(account)}<span>${escapeHtml(account === "zus" ? "ZUS" : accountName(account))}</span></span><div class="wz-gantt-track">${bars}</div></div>`;
    });

    if (transfers.length) {
        const byAge = new Map();
        transfers.forEach((transfer) => {
            if (!byAge.has(transfer.age)) byAge.set(transfer.age, []);
            byAge.get(transfer.age).push(transfer);
        });
        let transferBars = "";
        byAge.forEach((items, age) => {
            const left = wzFlowPct(age, range);
            const tipIdx = addTip(wzTransferTipHtml(items, projection, accountName));
            const summary = items
                .map((transfer) => `${accountName(transfer.from_account)} → ${accountName(transfer.to_account)}`)
                .join(", ");
            const sources = [...new Set(
                items.map((transfer) => accountName(transfer.from_account))
            )].join(", ");
            const tipLabel = `Transfery ${age} r.ż.: ${summary} — szczegóły`;
            transferBars += `<span class="wz-gantt-transfer" style="left:${left.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}">${escapeHtml(sources)} ${iconSvg("arrow")}</span>`;
        });
        ganttHtml += `<div class="wz-gantt-row wz-gantt-transfer-row"><span class="wz-gantt-label">${iconSvg("arrow")}<span>Transfery</span></span><div class="wz-gantt-track">${transferBars}</div></div>`;
    }

    const payouts = (projection.phase_metrics || []).filter(
        (phase) => phase.cashflow === "payout" && phase.end_age > phase.start_age
    );
    if (payouts.length) {
        let totalBars = "";
        payouts.forEach((phase) => {
            const left = wzFlowPct(phase.start_age, range);
            const width = Math.max(0.8, wzFlowPct(phase.end_age, range) - left);
            const label = width >= 8
                ? `${Math.round(phase.monthly || 0).toLocaleString("pl-PL")} zł/mies.`
                : "";
            const tipIdx = addTip(wzTotalTipHtml(phase));
            const phaseName = phase.key === "partial_fire" ? "Częściowe FIRE" : phase.name;
            const tipLabel = `${phaseName}: ${phase.start_age}–${phase.end_age} r.ż., ${Math.round(phase.monthly || 0).toLocaleString("pl-PL")} zł/mies. netto — szczegóły`;
            totalBars += `<span class="wz-gantt-phase is-total" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tip-id="${tipIdx}" tabindex="0" aria-label="${escapeHtml(tipLabel)}">${label}</span>`;
        });
        ganttHtml += `<div class="wz-gantt-row wz-gantt-total"><span class="wz-gantt-label">Razem</span><div class="wz-gantt-track">${totalBars}</div></div>`;
    }
    gantt.innerHTML = ganttHtml;
    setupGanttTips(gantt, tips);


    const rows = phases.map((phase, index) => {
        const account = accountName(phase.account);
        const phaseLabel = flowLabels.get(phase) || wzPhaseBadge(index + 1);
        const period = `${phase.start_age}–${phase.last_age} r.ż. (${wzFormatYears(phase.years)})`;
        const health = Number(phase.total_health || 0);
        const pit = Number(phase.total_tax || 0);
        const lump = Number(phase.lump_tax || 0);
        let taxSub = "";
        if (lump > 0.5) {
            taxSub = Math.abs(pit - lump) < 0.5
                ? "jednorazowo"
                : `w tym ${wzFmtZloty(lump)} zł jednorazowo`;
        } else if (health > 0.5) {
            taxSub = pit > 0.5
                ? `PIT ${wzFmtZloty(pit)} zł + zdrowotna ${wzFmtZloty(health)} zł`
                : "zdrowotna 9%";
        }
        const tax = `<span class="wz-flow-tax-cell"><span class="wz-flow-tax-main">${wzFmtZloty(pit + health)} zł</span>${taxSub ? tipHtml(taxSub) : ""}</span>`;
        return `
            <tr>
                <td data-label="Faza"><span class="wz-phase-badge">${escapeHtml(phaseLabel)}</span></td>
                <td data-label="Konto">${escapeHtml(account)}</td>
                <td data-label="Okres">${escapeHtml(period)}</td>
                <td data-label="Średnio netto">${fmtMoney(phase.avg_monthly_net)}/mies.</td>
                <td data-label="Łącznie netto">${fmtMoney(phase.total_net)}</td>
                <td data-label="Podatki i składki">${tax}</td>
                <td data-label="Saldo końcowe">${fmtMoney(phase.ending_balance)}</td>
            </tr>`;
    }).join("");

    const accumulationBox = el("wzAccumulationFlows");
    if (accumulationBox) {
        accumulationBox.innerHTML = wzRenderAccumulationTable(
            accumulationPhases,
            accountName
        );
    }
    const transferBox = el("wzTransferFlows");
    if (transferBox) {
        transferBox.innerHTML = wzRenderTransferTable(
            transfers,
            projection,
            accountName
        );
    }
    wrap.innerHTML = phases.length
        ? `<h5 class="wz-flows-subtitle">Wypłaty</h5>
        <div class="wz-flows-table-wrap">
            <table class="wz-flows-table">
                <thead><tr><th>Faza</th><th>Konto</th><th>Okres</th><th>Średnio netto</th><th>Łącznie netto</th><th>Podatki i składki</th><th>Saldo końcowe</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`
        : "";
}

function wzRenderPolicy(projection) {
    const note = el("wzPolicyTipText");
    if (!note) return;
    note.textContent = window.ResultsSummary?.policyText?.(projection?.withdrawal_policy)
        || "Kolejność wypłat zależy od polityki planu.";
}

    function render(container, options = {}) {
        if (!container) return;
        const {
            input,
            projection,
            summary,
            result,
            loading = false,
        } = options;
        const phases = projection?.phase_metrics || [];
        const allAges = [
            ...phases.flatMap((phase) => [phase.start_age, phase.end_age]),
            ...(projection?.account_phases || []).flatMap((phase) => [phase.start_age, phase.last_age + 1]),
            ...(input?.stages || []).flatMap((stage) => [stage.start_age, stage.end_age]),
        ];
        if (!allAges.length) {
            wzGanttTipHide(true);
            container.innerHTML = "";
            return;
        }

        container.innerHTML = `<div class="res-plan-time">
            <div class="wz-plan-block">
                <div class="wz-timeline" id="wzTimeline" role="group" aria-label="Etapy planu na osi wieku"></div>
            </div>
            <div class="res-stage-summary" id="wzStageSummary"></div>
            <div class="wz-flows-wrap" id="wzFlowsWrap">
                <h4 class="wz-plan-subhead">
                    <span class="tip-label-row">
                        <span class="tip-label-text">Z czego żyjesz w kolejnych latach</span>
                        <span class="tip" tabindex="0" aria-label="Kolejność wypłat">?<span class="tooltip" id="wzPolicyTipText">Kolejność wypłat zależy od polityki planu.</span></span>
                    </span>
                </h4>
                <div class="wz-flows-gantt-scroll" tabindex="0" role="group" aria-label="Gantt przepływów: wpłaty, wypłaty i transfery według wieku">
                    <div class="wz-flows-gantt" id="wzFlowsGantt"></div>
                </div>
                <p class="field-hint wz-flows-scroll-hint">Przewiń w poziomie, aby zobaczyć cały horyzont.</p>
                <details class="wz-flows-table-details" id="wzFlowsTableDetails" open>
                    <summary>Tabela przepływów</summary>
                    <div id="wzAccumulationFlows"></div>
                    <div id="wzTransferFlows"></div>
                    <div id="wzAccountFlows"></div>
                </details>
            </div>
        </div>`;

        const timelineInput = input && !Number.isFinite(Number(input.max_age))
            && Number.isFinite(Number(summary?.end_age))
            ? { ...input, max_age: Number(summary.end_age) }
            : input;
        wzRenderTimeline(timelineInput, projection);
        const stageBox = container.querySelector("#wzStageSummary");
        if (result) {
            wzRenderStageSummaryFromResult(input, result, projection, stageBox);
        } else if (loading && stageBox) {
            stageBox.classList.remove("hidden");
            stageBox.innerHTML = '<p class="field-hint">Liczę etapy…</p>';
        }
        if (projection) {
            wzRenderAccountFlows(input, projection);
            wzRenderPolicy(projection);
        }
    }

    function renderStages(container, options = {}) {
        const { input, projection, result } = options;
        if (!container || !result) return;
        const stageBox = container.querySelector("#wzStageSummary");
        if (stageBox) {
            wzRenderStageSummaryFromResult(input, result, projection, stageBox);
        }
    }

    function hideTips() {
        wzGanttTipHide(true);
    }

    window.ResultsPlanTime = { render, renderStages, hideTips };
})();
