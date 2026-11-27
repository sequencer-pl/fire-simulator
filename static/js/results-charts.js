// results-charts.js — wspólny silnik wykresów wyników (Asystent i Symulator).
// Obsługuje wypłaty netto i kapitał prywatny: stosy kont, linie referencyjne,
// tooltipy, kamienie milowe i toggle widoczności.

(function () {
    const RETIREMENT_DEFAULT = { k: 60, m: 65 };

    function el(id) {
        return document.getElementById(id);
    }

    function wzFmtZloty(value) {
        return Math.round(value || 0).toLocaleString("pl-PL");
    }

    function wzInputHorizonAge(input) {
        return window.ResultsModel.horizonAge(input);
    }

    function accountColor(key) {
        const normalized = String(key || "other").replace(/_/g, "-");
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue(`--acct-${normalized}`)
            .trim();
        return value || getComputedStyle(document.documentElement)
            .getPropertyValue("--acct-other")
            .trim();
    }

const WZ_CHART_ORDER = [
    "ike", "ikze", "oipe", "ppk", "ppe", "broker", "obligacje", "lokata",
    "oki_inw", "oki_osk", "gotowka", "krypto", "nieruchomosc", "zus",
];
const WZ_CHART_LABELS = {
    ike: "IKE",
    ikze: "IKZE",
    oipe: "OIPE",
    ppk: "PPK",
    ppe: "PPE",
    broker: "Broker",
    obligacje: "Obligacje",
    lokata: "Lokata",
    oki_inw: "OKI inw.",
    oki_osk: "OKI oszcz.",
    gotowka: "Gotówka",
    krypto: "Krypto",
    nieruchomosc: "Nieruchomość",
    zus: "ZUS",
    other: "Pozostałe",
};
const WZ_CHART_MAX_SERIES = 10;

let wzChartData = null;
let wzChartModels = {};
let wzChartGeom = {};
let wzChartPinned = false;
let wzChartPinnedAt = 0;
let wzChartActive = null;
let wzChartHideTimer = null;
let wzChartResizeTimer = null;
let wzChartBound = false;
let wzChartFocusIndex = {};

function wzChartColorKey(key) {
    return WZ_CHART_ORDER.includes(key) || key === "other" ? key : "other";
}

function wzChartOrder(key) {
    const index = WZ_CHART_ORDER.indexOf(key);
    return index === -1 ? WZ_CHART_ORDER.length : index;
}

function wzChartCustomNames(input) {
    const names = new Map();
    (input?.stages || []).forEach((stage) => {
        Object.entries(stage.accounts || {}).forEach(([account, config]) => {
            if (config?.custom_name) names.set(account, config.custom_name);
        });
    });
    return names;
}

function wzChartGroups(raw, input, kind, count) {
    const customNames = wzChartCustomNames(input);
    const groups = new Map();
    Object.entries(raw || {}).forEach(([account, values]) => {
        if (account === "zus:ofe") return;
        const base = baseAccountKey(account);
        if (kind === "capital" && base === "zus") return;
        let group = groups.get(base);
        if (!group) {
            group = {
                key: base,
                label: "",
                values: new Array(count).fill(0),
                accounts: [],
                total: 0,
            };
            groups.set(base, group);
        }
        const clean = Array.from({ length: count }, (_, index) => Number(values?.[index]) || 0);
        clean.forEach((value, index) => { group.values[index] += value; });
        group.accounts.push({
            key: account,
            name: accountDisplayLabel(account, customNames.get(account) || ""),
            values: clean,
        });
    });

    const list = [...groups.values()].filter((group) => {
        group.total = group.values.reduce((sum, value) => sum + value, 0);
        return group.total > 0.5;
    });
    list.forEach((group) => {
        const single = group.accounts.length === 1 ? group.accounts[0] : null;
        const custom = single ? customNames.get(single.key) : "";
        group.label = custom || WZ_CHART_LABELS[group.key] || (single ? single.name : group.key);
    });
    list.sort((a, b) => wzChartOrder(a.key) - wzChartOrder(b.key));
    return list;
}

function wzLimitChartGroups(groups) {
    if (groups.length <= WZ_CHART_MAX_SERIES) return groups;
    const ordered = [...groups].sort((a, b) => b.total - a.total);
    const keep = new Set(ordered.slice(0, WZ_CHART_MAX_SERIES - 1).map((group) => group.key));
    const rest = groups.filter((group) => !keep.has(group.key));
    if (!rest.length) return groups;

    const other = {
        key: "other",
        label: WZ_CHART_LABELS.other,
        values: new Array(groups[0].values.length).fill(0),
        accounts: [],
        total: 0,
    };
    rest.forEach((group) => {
        group.values.forEach((value, index) => { other.values[index] += value; });
        other.accounts.push(...group.accounts);
        other.total += group.total;
    });
    const kept = groups.filter((group) => keep.has(group.key));
    kept.sort((a, b) => wzChartOrder(a.key) - wzChartOrder(b.key));
    kept.push(other);
    return kept;
}

function wzScaleChartGroups(groups, factor) {
    if (factor === 1) return groups;
    return groups.map((group) => ({
        ...group,
        values: group.values.map((value) => value * factor),
        accounts: group.accounts.map((account) => ({
            ...account,
            values: account.values.map((value) => value * factor),
        })),
        total: group.total * factor,
    }));
}

function wzChartTotals(groups, count) {
    return Array.from({ length: count }, (_, index) => (
        groups.reduce((sum, group) => sum + (group.values[index] || 0), 0)
    ));
}

function wzChartCompact(value) {
    const rounded = Math.abs(value) >= 1_000_000
        ? `${(value / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln`
        : Math.abs(value) >= 1_000
            ? `${Math.round(value / 1_000).toLocaleString("pl-PL")} tys.`
            : Math.round(value).toLocaleString("pl-PL");
    return rounded;
}

function wzChartAxisNumber(value) {
    const text = value.toLocaleString("pl-PL", { maximumFractionDigits: 2 });
    const [integer, fraction] = text.split(",");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    return fraction ? `${grouped},${fraction}` : grouped;
}

function wzNiceStep(value, targetTicks) {
    if (!(value > 0)) return 1;
    const raw = value / Math.max(1, targetTicks);
    const power = 10 ** Math.floor(Math.log10(raw));
    const normalized = raw / power;
    const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
    return factor * power;
}

function wzChartAreaPath(x, y, lower, upper, start = 0, end = lower.length - 1) {
    let path = `M ${x(start).toFixed(2)} ${y(lower[start]).toFixed(2)}`;
    for (let index = start + 1; index <= end; index += 1) {
        path += ` L ${x(index).toFixed(2)} ${y(lower[index]).toFixed(2)}`;
    }
    for (let index = end; index >= start; index -= 1) {
        path += ` L ${x(index).toFixed(2)} ${y(upper[index]).toFixed(2)}`;
    }
    return `${path} Z`;
}

function wzChartLinePath(x, y, values, start = 0, end = values.length - 1) {
    let path = `M ${x(start).toFixed(2)} ${y(values[start]).toFixed(2)}`;
    for (let index = start + 1; index <= end; index += 1) {
        path += ` L ${x(index).toFixed(2)} ${y(values[index]).toFixed(2)}`;
    }
    return path;
}

function wzChartVisibleRange(values) {
    let first = -1;
    let last = -1;
    values.forEach((value, index) => {
        if (value <= 0.005) return;
        if (first === -1) first = index;
        last = index;
    });
    return { first, last };
}

function wzChartLegendHtml(groups) {
    return groups.map((group) => {
        const colorKey = wzChartColorKey(group.key);
        return `<span class="wz-chart-legend-item wz-chart-c-${colorKey}"><span class="wz-chart-swatch"></span>${escapeHtml(group.label)}</span>`;
    }).join("");
}

function wzChartGradientId(kind, index) {
    return `wz-chart-grad-${kind}-${index}`;
}

function wzChartReferences(model) {
    if (model.kind === "withdrawals") {
        const positive = model.totals.filter((value) => value > 0.5);
        const fallbackAvg = positive.length
            ? positive.reduce((sum, value) => sum + value, 0) / positive.length
            : null;
        const fallbackMin = positive.length ? Math.min(...positive) : null;
        const rawAvg = model.references?.avgMonthly;
        const rawMin = model.references?.minMonthly;
        const avg = rawAvg == null ? null : Number(rawAvg);
        const min = rawMin == null ? null : Number(rawMin);
        const refs = [];
        if (Number.isFinite(avg) && avg > 0.5) {
            refs.push({ key: "avg", label: "średnia", value: avg });
        } else if (fallbackAvg) {
            refs.push({ key: "avg", label: "średnia", value: fallbackAvg });
        }
        if (Number.isFinite(min) && min >= 0) {
            refs.push({ key: "min", label: "min", value: min });
        } else if (fallbackMin) {
            refs.push({ key: "min", label: "min", value: fallbackMin });
        }
        return refs;
    }
    const peak = Math.max(...model.totals);
    if (!(peak > 0.5)) return [];
    const index = model.totals.indexOf(peak);
    return [{
        key: "peak",
        label: "szczyt",
        value: peak,
        age: model.ages[index],
        index,
    }];
}

function wzChartReferenceSvg(model, refs, geometry) {
    const {
        x, y, margin, plotW, yMax,
    } = geometry;
    const avg = refs.find((ref) => ref.key === "avg");
    const visible = refs.filter((ref) => {
        if (!(ref.value > 0) || ref.value > yMax * 1.001) return false;
        if (ref.key === "min" && avg && avg.value - ref.value < yMax * 0.08) return false;
        return true;
    });
    if (!visible.length) return "";
    const labels = visible.map((ref) => {
        const lineY = y(ref.value);
        const labelY = lineY < margin.top + 18 ? lineY + 14 : lineY - 5;
        const amount = model.kind === "withdrawals"
            ? wzChartAxisNumber(Math.round(ref.value))
            : wzChartCompact(ref.value);
        const label = model.kind === "withdrawals"
            ? `${ref.label} ${amount} zł/mies.`
            : `${ref.label} ${wzChartCompact(ref.value)} zł · ${ref.age} r.ż.`;
        const dot = ref.key === "peak"
            ? `<circle class="wz-chart-reference-dot" cx="${x(ref.index).toFixed(2)}" cy="${lineY.toFixed(2)}" r="4"/>`
            : "";
        return `<line class="wz-chart-reference-line is-${ref.key}" x1="${margin.left}" y1="${lineY.toFixed(2)}" x2="${margin.left + plotW}" y2="${lineY.toFixed(2)}"/>
            ${dot}
            <text class="wz-chart-reference-label is-${ref.key}" x="${margin.left + plotW - 4}" y="${labelY.toFixed(2)}" text-anchor="end">${escapeHtml(label)}</text>`;
    }).join("");
    return `<g class="wz-chart-reference-layer" aria-hidden="true">${labels}</g>`;
}

function wzChartSummary(model) {
    const first = model.ages[0];
    const last = model.ages[model.ages.length - 1];
    const peak = Math.max(...model.totals);
    if (model.kind === "withdrawals") {
        const horizon = Number(model.horizonAge);
        const total = model.totals.reduce(
            (sum, value, index) => (
                Number.isFinite(horizon) && model.ages[index] >= horizon ? sum : sum + value
            ),
            0
        ) * 12;
        const refs = wzChartReferences(model);
        const avg = refs.find((ref) => ref.key === "avg");
        const min = refs.find((ref) => ref.key === "min");
        const extra = [];
        if (avg) extra.push(`Średnia wypłata ${wzChartAxisNumber(Math.round(avg.value))} zł/mies.`);
        if (min) extra.push(`Minimalna wypłata ${wzChartAxisNumber(Math.round(min.value))} zł/mies.`);
        const horizonText = Number.isFinite(horizon)
            ? ` Horyzont planu: ${horizon} r.ż.; dalsze lata pokazują sam ZUS.`
            : "";
        return `Wykres miesięcznych wypłat netto według kont, wiek ${first}–${last}. Łącznie w horyzoncie ${wzFmtZloty(total)} zł netto.${horizonText} ${extra.join(" ")} Użyj strzałek, aby czytać szczegóły.`;
    }
    const peakIndex = model.totals.indexOf(peak);
    return `Wykres kapitału prywatnego według kont, wiek ${first}–${last}. Kapitał szczytowy ${wzFmtZloty(peak)} zł w wieku ${model.ages[peakIndex]}.${model.truncated ? " Wykres ucięty na horyzoncie planu." : ""} Użyj strzałek, aby czytać szczegóły.`;
}

let wzChartMilestones = [];
let wzChartMilestonesVisible = true;
let wzActiveChartMilestone = null;
let wzMilestoneAnchor = null;

function wzFireAge(input) {
    const starts = (input?.stages || [])
        .filter((stage) => stage.stage_type === "realizacja"
            && Object.keys(stage.accounts || {}).some((key) => baseAccountKey(key) !== "zus"))
        .map((stage) => Number(stage.start_age))
        .filter(Number.isFinite);
    return starts.length ? Math.min(...starts) : null;
}

function wzChartAnnotationsFor(input, projection) {
    const ages = (projection?.chart?.ages || []).map(Number);
    if (!ages.length) return [];
    const minAge = ages[0];
    const maxAge = ages[ages.length - 1];
    const stages = input?.stages || [];
    const portfolioStages = stages.filter(
        (stage) => stage.stage_type === "realizacja"
            && Object.keys(stage.accounts || {})
                .some((key) => baseAccountKey(key) !== "zus")
    );
    // FIRE to pełne zakończenie pracy, a nie etap części etatu. Etapy
    // Coast/Barista mają dodatni part_time_* i nie mogą przejąć etykiety FIRE.
    const fireStage = portfolioStages.find(
        (stage) => !(Number(stage.part_time_net_monthly) > 0)
            && !(Number(stage.part_time_gross_monthly) > 0)
    );
    const zusStage = stages.find(
        (stage) => stage.stage_type === "realizacja"
            && Object.keys(stage.accounts || {}).length === 1
            && stage.accounts.zus
    ) || stages.find(
        (stage) => stage.stage_type === "realizacja"
            && "zus" in (stage.accounts || {})
    );
    const statutoryAge = RETIREMENT_DEFAULT[input?.gender]
        || (input?.gender === "k" ? 60 : 65);
    const horizonAge = wzInputHorizonAge(input);
    const annotations = [];

    const add = (kind, label, age, text, short = label) => {
        const numeric = Number(age);
        if (!Number.isFinite(numeric) || numeric < minAge || numeric > maxAge) return;
        annotations.push({
            id: `${kind}-${numeric}`,
            kind,
            label,
            short,
            age: numeric,
            text,
        });
    };

    if (fireStage?.start_age != null) {
        add(
            "fire",
            "FIRE",
            fireStage.start_age,
            `Pełne FIRE: ${fireStage.start_age} r.ż. Od tego roku portfel finansuje życie zamiast pensji.`
        );
    }
    if (projection?.early_return_total > 0 && projection?.early_return_age != null) {
        add(
            "ikze",
            "Zwrot IKZE",
            projection.early_return_age,
            `W wieku ${projection.early_return_age} r.ż. IKZE zostało zamknięte: ${fmtMoney(projection.early_return_total)} netto przeniesione do kont docelowych po podatku ${fmtMoney(projection.early_return_tax_total)}. Pionowa linia oznacza ten transfer.`,
            "IKZE"
        );
    }
    if (zusStage?.start_age != null) {
        const zusText = zusStage.start_age !== statutoryAge
            ? `ZUS startuje od ${zusStage.start_age} r.ż. Ustawowy wiek emerytalny to ${statutoryAge} lat.`
            : `ZUS startuje od ${zusStage.start_age} r.ż. To ustawowy wiek emerytalny (${statutoryAge} lat).`;
        add("zus", "ZUS", zusStage.start_age, zusText);
    }
    const obligations = Array.isArray(input?.obligations) && input.obligations.length
        ? input.obligations
        : (Number(input?.mortgage_monthly) > 0 && input?.mortgage_end_age != null
            ? [{
                name: "Kredyt hipoteczny",
                monthly: Number(input.mortgage_monthly),
                end_age: Number(input.mortgage_end_age),
                redirect_to_savings: input.redirect_mortgage_to_savings !== false,
            }]
            : []);
    const obligationsByEnd = new Map();
    obligations.forEach((obligation) => {
        const endAge = Number(obligation.end_age);
        if (!Number.isFinite(endAge)) return;
        if (!obligationsByEnd.has(endAge)) obligationsByEnd.set(endAge, []);
        obligationsByEnd.get(endAge).push(obligation);
    });
    const fireAge = wzFireAge(input);
    obligationsByEnd.forEach((items, endAge) => {
        const total = items.reduce((sum, item) => sum + (Number(item.monthly) || 0), 0);
        const afterFire = Number.isFinite(fireAge) && endAge >= fireAge;
        const details = items.map((item) => {
            const redirect = afterFire
                ? "wypłata z portfela wraca do budżetu"
                : item.redirect_to_savings === false
                    ? "zostaje w budżecie"
                    : "na oszczędności";
            return `${item.name || "Zobowiązanie"}: ${wzFmtZloty(item.monthly)} zł/mies. (${redirect})`;
        }).join("; ");
        const text = afterFire
            ? `Od ${endAge} r.ż. kończy się: ${details}. Wypłata z portfela spada o ${wzFmtZloty(total)} zł/mies., a budżet pozostaje na poziomie celu.`
            : `Od ${endAge} r.ż. kończy się: ${details}. Uwalnia to ${wzFmtZloty(total)} zł/mies.`;
        add(
            "obligation",
            "Koniec zobowiązania",
            endAge,
            text,
            "Koniec zob."
        );
    });
    if (horizonAge != null) {
        const lastYear = Math.max(minAge, horizonAge - 1);
        add(
            "horizon",
            "Horyzont",
            lastYear,
            `Horyzont planu: ${horizonAge} r.ż. — ostatni pełny rok symulacji to ${lastYear}. Metryki i podatek wyjścia liczą się do tego wieku; wykresy pokazują ZUS do 100 r.ż.`
        );
    }

    const byAge = new Map();
    annotations.forEach((annotation) => {
        if (!byAge.has(annotation.age)) byAge.set(annotation.age, []);
        byAge.get(annotation.age).push(annotation);
    });
    byAge.forEach((items) => {
        items.forEach((annotation, index) => {
            annotation.offset = (index - (items.length - 1) / 2) * 3;
        });
    });
    return annotations;
}

function wzUpdateMilestoneToggle() {
    const button = el("wzChartMilestonesToggle");
    const label = el("wzChartMilestonesToggleLabel");
    if (!button || !label) return;
    const hasMilestones = wzChartMilestones.length > 0;
    button.classList.toggle("hidden", !hasMilestones);
    button.setAttribute("aria-pressed", String(wzChartMilestonesVisible));
    label.textContent = wzChartMilestonesVisible
        ? "Ukryj kamienie milowe"
        : "Pokaż kamienie milowe";
}

function wzMilestoneLayout(model, geom) {
    const compact = geom.width < 560;
    const laneHeight = compact ? 28 : 30;
    const railWidth = geom.actualWidth || geom.width;
    const scale = railWidth / Math.max(1, geom.width);
    const items = [];
    (model.annotations || []).forEach((annotation) => {
        const index = model.ages.indexOf(Number(annotation.age));
        if (index < 0) return;
        const lineX = geom.x(index) + (annotation.offset || 0);
        const x = lineX * scale;
        const text = `${annotation.short || annotation.label} ${annotation.age}`;
        const width = Math.min(
            Math.max(40, railWidth - 8),
            Math.max(56, Math.ceil(text.length * 6.4 + 26))
        );
        const left = Math.max(4, Math.min(x - width / 2, railWidth - width - 4));
        items.push({ annotation, lineX, x, text, width, left, top: 0 });
    });
    items.sort((a, b) => a.left - b.left);
    const laneRight = [];
    items.forEach((item) => {
        let lane = 0;
        while (lane < laneRight.length && item.left < laneRight[lane] + 6) {
            lane += 1;
        }
        item.lane = lane;
        item.top = lane * laneHeight;
        laneRight[lane] = item.left + item.width;
    });
    return {
        items,
        height: Math.max(24, laneRight.length * laneHeight),
    };
}

function wzUpdateMilestoneState() {
    document.querySelectorAll(".wz-chart-milestone").forEach((button) => {
        const isActive = button.dataset.annotationId === wzActiveChartMilestone;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-expanded", String(isActive));
        if (isActive) button.setAttribute("aria-describedby", "wzChartMilestoneTipBody");
        else button.removeAttribute("aria-describedby");
    });
    document.querySelectorAll(".wz-chart-milestone-line, .wz-chart-milestone-band").forEach((node) => {
        node.classList.toggle("is-active", node.dataset.annotationId === wzActiveChartMilestone);
    });
}

function wzMilestoneTipHide() {
    const tip = el("wzChartMilestoneTip");
    const anchor = wzMilestoneAnchor;
    const hadActive = Boolean(wzActiveChartMilestone)
        || Boolean(tip && !tip.classList.contains("hidden"));
    const focusInside = Boolean(tip && tip.contains(document.activeElement));
    tip?.classList.add("hidden");
    wzActiveChartMilestone = null;
    wzMilestoneAnchor = null;
    if (hadActive) wzUpdateMilestoneState();
    if (focusInside && anchor?.isConnected) anchor.focus({ preventScroll: true });
}

function wzMilestoneBottomInset() {
    let inset = 8;
    const actionBar = document.querySelector(".action-bar");
    if (actionBar) {
        const rect = actionBar.getBoundingClientRect();
        if (rect.height > 0) inset = Math.max(inset, window.innerHeight - rect.top + 8);
    }
    const tabbar = document.querySelector(".tabbar");
    if (tabbar) {
        const rect = tabbar.getBoundingClientRect();
        if (rect.height > 0) inset = Math.max(inset, window.innerHeight - rect.top + 8);
    }
    return inset;
}

function wzMilestoneTipPlace(anchor) {
    const tip = el("wzChartMilestoneTip");
    if (!tip || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const margin = 8;
    const bottomLimit = window.innerHeight - wzMilestoneBottomInset();
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    const spaceBelow = bottomLimit - rect.bottom;
    const spaceAbove = rect.top;
    const placeBelow = spaceBelow >= height + margin || spaceBelow >= spaceAbove;
    let top = placeBelow ? rect.bottom + margin : rect.top - height - margin;
    top = Math.max(margin, Math.min(top, Math.max(margin, bottomLimit - height - margin)));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function wzMilestoneTipShow(annotation, anchor) {
    const tip = el("wzChartMilestoneTip");
    const body = el("wzChartMilestoneTipBody");
    if (!tip || !body || !anchor) return;
    wzChartTipHide(true);
    window.ResultsPlanTime?.hideTips?.();
    body.innerHTML = `<div class="wz-gantt-tip-title wz-chart-milestone-tip-title">
            <span class="wz-chart-milestone-dot is-${annotation.kind}" aria-hidden="true"></span>
            <span>${escapeHtml(annotation.label)} · ${annotation.age} r.ż.</span>
        </div>
        <p class="wz-chart-milestone-tip-text">${escapeHtml(annotation.text)}</p>`;
    tip.classList.remove("hidden");
    wzActiveChartMilestone = annotation.id;
    wzMilestoneAnchor = anchor;
    wzUpdateMilestoneState();
    requestAnimationFrame(() => wzMilestoneTipPlace(anchor));
}

function wzMilestoneTipOnScroll() {
    if (!wzMilestoneAnchor) return;
    if (!wzMilestoneAnchor.isConnected) {
        wzMilestoneTipHide();
        return;
    }
    const rect = wzMilestoneAnchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
        wzMilestoneTipHide();
        return;
    }
    requestAnimationFrame(() => wzMilestoneTipPlace(wzMilestoneAnchor));
}

function wzToggleMilestone(annotationId, anchor) {
    if (wzActiveChartMilestone === annotationId && wzMilestoneAnchor === anchor) {
        wzMilestoneTipHide();
        return;
    }
    const annotation = wzChartMilestones.find((item) => item.id === annotationId);
    if (annotation) wzMilestoneTipShow(annotation, anchor);
}

function wzToggleMilestonesVisibility() {
    wzChartMilestonesVisible = !wzChartMilestonesVisible;
    wzMilestoneTipHide();
    wzUpdateMilestoneToggle();
    Object.entries(wzChartModels).forEach(([kind, model]) => {
        const container = kind === "withdrawals"
            ? el("wzWithdrawalsChart")
            : el("wzCapitalChart");
        if (container) wzRenderMilestoneLayer(container, model);
    });
}

function wzRenderMilestoneLayer(container, model) {
    if (!container) return;
    const geom = wzChartGeom[model.kind];
    if (!geom) return;
    container.querySelector(".wz-chart-milestones")?.remove();
    geom.svg.querySelector(".wz-chart-milestone-layer")?.remove();
    if (!wzChartMilestonesVisible || !model.annotations?.length) return;

    const layout = wzMilestoneLayout(model, geom);
    if (!layout.items.length) return;

    const rail = document.createElement("div");
    rail.className = "wz-chart-milestones";
    rail.style.height = `${layout.height}px`;
    rail.setAttribute("role", "group");
    rail.setAttribute(
        "aria-label",
        `Kamienie milowe — ${model.kind === "withdrawals" ? "wypłaty netto" : "kapitał prywatny"}`
    );
    layout.items.forEach(({ annotation, left, top, width }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `wz-chart-milestone is-${annotation.kind}`;
        button.dataset.annotationId = annotation.id;
        button.style.left = `${left}px`;
        button.style.top = `${top}px`;
        button.style.width = `${width}px`;
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", "wzChartMilestoneTip");
        button.setAttribute(
            "aria-label",
            `${annotation.label}, ${annotation.age} r.ż. — pokaż szczegóły`
        );
        button.innerHTML = `<span class="wz-chart-milestone-dot" aria-hidden="true"></span>
            <span class="wz-chart-milestone-label">${escapeHtml(annotation.short || annotation.label)}</span>
            <span class="wz-chart-milestone-age">${annotation.age}</span>`;
        rail.appendChild(button);
    });
    container.insertBefore(rail, container.firstChild);

    const NS = "http://www.w3.org/2000/svg";
    const layer = document.createElementNS(NS, "g");
    layer.setAttribute("class", "wz-chart-milestone-layer");
    layer.setAttribute("aria-hidden", "true");
    layout.items.forEach(({ annotation, lineX }) => {
        const band = document.createElementNS(NS, "rect");
        band.setAttribute("class", `wz-chart-milestone-band is-${annotation.kind}`);
        band.setAttribute("data-annotation-id", annotation.id);
        band.setAttribute("x", String(lineX - 7));
        band.setAttribute("y", String(geom.top));
        band.setAttribute("width", "14");
        band.setAttribute("height", String(geom.plotH));
        band.setAttribute("rx", "4");
        layer.appendChild(band);

        const line = document.createElementNS(NS, "line");
        line.setAttribute("class", `wz-chart-milestone-line is-${annotation.kind}`);
        line.setAttribute("data-annotation-id", annotation.id);
        line.setAttribute("x1", String(lineX));
        line.setAttribute("x2", String(lineX));
        line.setAttribute("y1", String(lineX < geom.left + 56 ? geom.top : 0));
        line.setAttribute("y2", String(geom.top + geom.plotH));
        layer.appendChild(line);
    });
    const hover = geom.svg.querySelector(".wz-chart-hover");
    if (hover) geom.svg.insertBefore(layer, hover);
    else geom.svg.appendChild(layer);
    wzUpdateMilestoneState();
}

function wzChartIndexFromEvent(svg, event) {
    const geom = wzChartGeom[svg?.dataset.chart];
    if (!geom) return 0;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width ? geom.width / rect.width : 1;
    const x = (event.clientX - rect.left) * scale;
    const ratio = (x - geom.left) / geom.plotW;
    return Math.max(0, Math.min(geom.n - 1, Math.round(ratio * (geom.n - 1))));
}

function wzChartFirstActiveIndex(model) {
    const index = model.totals.findIndex((value) => value > 0.5);
    return index === -1 ? 0 : index;
}

function wzChartSetHover(key, index) {
    const geom = wzChartGeom[key];
    if (!geom) return;
    Object.entries(wzChartGeom).forEach(([otherKey, other]) => {
        if (otherKey !== key) other.hover?.classList.remove("is-visible");
    });
    const band = geom.band(index);
    const x = geom.x(index);
    geom.hoverBand.setAttribute("x", band.x.toFixed(2));
    geom.hoverBand.setAttribute("width", band.width.toFixed(2));
    geom.hoverLine.setAttribute("x1", x.toFixed(2));
    geom.hoverLine.setAttribute("x2", x.toFixed(2));
    geom.hoverDot.setAttribute("cx", x.toFixed(2));
    geom.hoverDot.setAttribute("cy", geom.totalY[index].toFixed(2));
    geom.hover?.classList.add("is-visible");
}

function wzChartClearHover() {
    Object.values(wzChartGeom).forEach((geom) => {
        geom.hover?.classList.remove("is-visible");
    });
}

function wzChartTooltipHtml(model, index) {
    const total = model.totals[index] || 0;
    const entries = model.groups
        .map((group) => ({ group, value: group.values[index] || 0 }))
        .filter((entry) => entry.value > 0.5)
        .sort((a, b) => b.value - a.value);

    let totalCard;
    if (model.kind === "withdrawals") {
        totalCard = `<div class="metric wz-chart-tip-total">
            <span class="metric-label">Wypłaty netto</span>
            <span class="metric-value">${wzFmtZloty(total)} zł<span class="wz-chart-tip-unit">/mies.</span></span>
            <span class="wz-chart-tip-total-sub">${total > 0.5 ? `≈ ${wzFmtZloty(total * 12)} zł rocznie` : "brak wypłat w tym roku"}</span>
        </div>`;
    } else {
        totalCard = `<div class="metric wz-chart-tip-total">
            <span class="metric-label">Kapitał prywatny</span>
            <span class="metric-value">${wzFmtZloty(total)} zł</span>
            <span class="wz-chart-tip-total-sub">${total > 0.5 ? "na koniec roku · brutto" : "brak kapitału w tym roku"}</span>
        </div>`;
    }

    const rows = entries.map(({ group, value }) => {
        const percent = total > 0 ? (value / total) * 100 : 0;
        const percentLabel = percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
        const colorKey = wzChartColorKey(group.key);
        const row = `<div class="wz-chart-tip-row wz-chart-c-${colorKey}">
            <span class="wz-chart-tip-label"><span class="wz-chart-swatch"></span><span>${escapeHtml(group.label)}</span></span>
            <span class="wz-chart-tip-value">${wzFmtZloty(value)} zł <span class="wz-chart-tip-share">${percentLabel}</span></span>
        </div>`;
        if (group.accounts.length <= 1) return `<div class="wz-chart-tip-group">${row}</div>`;
        const subs = group.accounts
            .map((account) => ({ name: account.name, value: account.values[index] || 0 }))
            .filter((account) => account.value > 0.5)
            .sort((a, b) => b.value - a.value)
            .map((account) => `<div class="wz-chart-tip-subrow"><span>${escapeHtml(account.name)}</span><span>${wzFmtZloty(account.value)} zł</span></div>`)
            .join("");
        return `<div class="wz-chart-tip-group">${row}${subs ? `<div class="wz-chart-tip-subrows">${subs}</div>` : ""}</div>`;
    }).join("");

    let obligationRow = "";
    if (model.kind === "withdrawals" && model.obligations) {
        const obligations = Number(model.obligations[index]) || 0;
        if (obligations > 0.5) {
            obligationRow = `<div class="wz-chart-tip-group wz-chart-tip-obligations">
                <div class="wz-chart-tip-subrow"><span>zobowiązania w tym roku (dodatkowy koszt)</span><span>${wzFmtZloty(obligations)} zł</span></div>
            </div>`;
        }
    }

    return `<div class="wz-gantt-tip-title">Wiek ${model.ages[index]}</div>
        ${totalCard}
        ${obligationRow}
        ${rows ? `<div class="wz-chart-tip-list">${rows}</div>` : ""}`;
}

function wzChartTipPlace(event, key, index) {
    const tip = el("wzChartTip");
    const geom = wzChartGeom[key];
    if (!tip || !geom) return;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let clientX;
    let clientY;
    if (event && Number.isFinite(event.clientX)) {
        clientX = event.clientX;
        clientY = event.clientY;
    } else {
        const rect = geom.svg.getBoundingClientRect();
        clientX = rect.left + (geom.x(index) / geom.width) * rect.width;
        clientY = rect.top + (geom.top / geom.height) * rect.height + 12;
    }
    let left = clientX + 14;
    let top = clientY - height - 12;
    if (left + width > window.innerWidth - 8) left = clientX - width - 14;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top < 8) top = clientY + 16;
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function wzChartTipShow(key, index, event, pin = false) {
    const model = wzChartModels[key];
    const tip = el("wzChartTip");
    const body = el("wzChartTipBody");
    if (!model || !tip || !body) return;
    const safeIndex = Math.max(0, Math.min(
        Math.max(0, (model.ages?.length || 1) - 1),
        Number(index) || 0
    ));
    if (wzActiveChartMilestone) wzMilestoneTipHide();
    window.ResultsPlanTime?.hideTips?.();
    body.innerHTML = wzChartTooltipHtml(model, safeIndex);
    tip.classList.remove("hidden");
    wzChartActive = { key, index: safeIndex };
    wzChartPinned = Boolean(pin);
    if (wzChartPinned) wzChartPinnedAt = Date.now();
    wzChartSetHover(key, safeIndex);
    requestAnimationFrame(() => wzChartTipPlace(event, key, safeIndex));
}

function wzChartTipHide(force = false) {
    if (wzChartPinned && !force) return;
    clearTimeout(wzChartHideTimer);
    wzChartPinned = false;
    wzChartActive = null;
    el("wzChartTip")?.classList.add("hidden");
    wzChartClearHover();
}

function wzChartTipScheduleHide() {
    clearTimeout(wzChartHideTimer);
    wzChartHideTimer = setTimeout(() => {
        if (!wzChartPinned) wzChartTipHide();
    }, 140);
}

function wzBindChartGlobalEvents() {
    if (wzChartBound) return;
    wzChartBound = true;
    el("wzChartMilestonesToggle")?.addEventListener("click", wzToggleMilestonesVisibility);
    const chartsWrap = el("wzChartsWrap");
    chartsWrap?.addEventListener("click", (event) => {
        const button = event.target.closest?.(".wz-chart-milestone");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        wzToggleMilestone(button.dataset.annotationId, button);
    });
    const milestoneTip = el("wzChartMilestoneTip");
    const milestoneClose = el("wzChartMilestoneTipClose");
    if (milestoneTip) {
        milestoneTip.addEventListener("pointerdown", (event) => event.stopPropagation());
    }
    if (milestoneClose) milestoneClose.addEventListener("click", wzMilestoneTipHide);
    document.addEventListener("pointerdown", (event) => {
        if (!wzActiveChartMilestone) return;
        if (event.target.closest?.(".wz-chart-milestone, #wzChartMilestoneTip")) return;
        wzMilestoneTipHide();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") wzMilestoneTipHide();
    });
    const tip = el("wzChartTip");
    const close = el("wzChartTipClose");
    if (tip) {
        tip.addEventListener("mouseenter", () => clearTimeout(wzChartHideTimer));
        tip.addEventListener("mouseleave", wzChartTipScheduleHide);
    }
    if (close) close.addEventListener("click", () => wzChartTipHide(true));
    document.addEventListener("pointerdown", (event) => {
        if (!wzChartActive) return;
        if (event.target.closest?.(".wz-chart-svg, #wzChartTip")) return;
        wzChartTipHide(true);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") wzChartTipHide(true);
    });
    window.addEventListener("scroll", () => {
        wzMilestoneTipOnScroll();
        // Auto-scroll tuż po kliknięciu nie może od razu zamykać przypiętego dymku.
        if (wzChartPinned && Date.now() - wzChartPinnedAt < 500) return;
        wzChartTipHide(true);
    }, true);
    window.addEventListener("resize", () => {
        wzMilestoneTipHide();
        wzChartTipHide(true);
        clearTimeout(wzChartResizeTimer);
        wzChartResizeTimer = setTimeout(() => {
            if (wzChartData) wzRenderCharts(wzChartData.input, wzChartData.projection);
        }, 180);
    });
}

function wzRenderChartSvg(container, model) {
    const width = Math.max(280, Math.round(container.clientWidth || container.parentElement?.clientWidth || 640));
    const compact = width < 560;
    const height = compact ? 210 : 260;
    const margin = { top: 18, right: 12, bottom: 28, left: compact ? 64 : 60 };
    const plotW = Math.max(40, width - margin.left - margin.right);
    const plotH = height - margin.top - margin.bottom;
    const count = model.ages.length;
    const maxTotal = Math.max(0, ...model.totals);
    const step = wzNiceStep(Math.max(1, maxTotal * 1.08), 5);
    const yMax = Math.max(step, Math.ceil((maxTotal * 1.08) / step) * step);
    const capitalInThousands = model.kind === "capital" && yMax >= 10_000;
    const axisUnit = model.kind === "withdrawals"
        ? "zł/mies."
        : (capitalInThousands ? "tys. zł" : "zł");
    const axisLabel = (value) => {
        if (capitalInThousands) {
            const thousands = value / 1000;
            const digits = Math.abs(thousands) < 10 ? 2 : 0;
            return wzChartAxisNumber(Number(thousands.toFixed(digits)));
        }
        return wzChartAxisNumber(Math.round(value));
    };
    const x = (index) => margin.left + (count <= 1 ? plotW / 2 : (index / (count - 1)) * plotW);
    const y = (value) => margin.top + plotH - (Math.max(0, value) / yMax) * plotH;
    const upperBounds = [];
    let running = new Array(count).fill(0);
    model.groups.forEach((group) => {
        running = running.map((value, index) => value + (group.values[index] || 0));
        upperBounds.push(running);
    });

    let svg = `<svg class="wz-chart-svg" data-chart="${model.kind}" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" tabindex="0" aria-label="${escapeHtml(wzChartSummary(model))}">`;
    svg += `<defs>`;
    model.groups.forEach((group, index) => {
        const colorKey = wzChartColorKey(group.key);
        const { first, last } = wzChartVisibleRange(group.values);
        const upper = upperBounds[index];
        const lower = index === 0 ? new Array(count).fill(0) : upperBounds[index - 1];
        let bandTop = margin.top;
        let bandBottom = margin.top + 1;
        if (first !== -1 && last >= first) {
            bandTop = Math.min(...upper.slice(first, last + 1).map((value) => y(value)));
            bandBottom = Math.max(...lower.slice(first, last + 1).map((value) => y(value)));
        }
        if (bandBottom - bandTop < 1) bandBottom = bandTop + 1;
        svg += `<linearGradient id="${wzChartGradientId(model.kind, index)}" class="wz-chart-c-${colorKey}" gradientUnits="userSpaceOnUse" x1="0" y1="${bandTop.toFixed(2)}" x2="0" y2="${bandBottom.toFixed(2)}">
            <stop offset="0%" class="wz-chart-stop-top"/>
            <stop offset="100%" class="wz-chart-stop-bottom"/>
        </linearGradient>`;
    });
    svg += `</defs>`;
    svg += `<rect class="wz-chart-plot-bg" x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" rx="8"/>`;

    for (let tick = 0; tick * step <= yMax + 0.0001; tick += 1) {
        const value = tick * step;
        const yPos = y(value);
        svg += `<line class="wz-chart-grid" x1="${margin.left}" y1="${yPos.toFixed(2)}" x2="${margin.left + plotW}" y2="${yPos.toFixed(2)}"/>`;
        svg += `<text class="wz-chart-axis-text wz-chart-axis-y" x="${margin.left - 8}" y="${yPos.toFixed(2)}" text-anchor="end">${axisLabel(value)}</text>`;
    }

    const span = count > 1 ? model.ages[count - 1] - model.ages[0] : 1;
    let ageStep = span <= 12 ? 1 : span <= 24 ? 2 : 5;
    if (compact) ageStep = span <= 12 ? 2 : 10;
    const firstTick = Math.ceil(model.ages[0] / ageStep) * ageStep;
    for (let age = firstTick; age <= model.ages[count - 1]; age += ageStep) {
        const index = model.ages.indexOf(age);
        if (index === -1) continue;
        const xPos = x(index);
        svg += `<line class="wz-chart-grid-v" x1="${xPos.toFixed(2)}" y1="${margin.top}" x2="${xPos.toFixed(2)}" y2="${margin.top + plotH}"/>`;
        const anchor = xPos < margin.left + 20 ? "start" : xPos > margin.left + plotW - 20 ? "end" : "middle";
        svg += `<text class="wz-chart-axis-text" x="${xPos.toFixed(2)}" y="${height - 8}" text-anchor="${anchor}">${age}</text>`;
    }

    svg += `<text class="wz-chart-unit" x="${margin.left}" y="11">${axisUnit}</text>`;

    model.groups.forEach((group, index) => {
        const upper = upperBounds[index];
        const lower = index === 0 ? new Array(count).fill(0) : upperBounds[index - 1];
        const colorKey = wzChartColorKey(group.key);
        const { first, last } = wzChartVisibleRange(group.values);
        if (first !== -1 && last >= first) {
            const start = Math.max(0, first - 1);
            const end = Math.min(count - 1, last + 1);
            svg += `<path class="wz-chart-area wz-chart-c-${colorKey}" fill="url(#${wzChartGradientId(model.kind, index)})" d="${wzChartAreaPath(x, y, lower, upper, start, end)}"/>`;
            svg += `<path class="wz-chart-edge wz-chart-c-${colorKey}" d="${wzChartLinePath(x, y, upper, start, end)}"/>`;
        }
    });
    svg += `<path class="wz-chart-total" d="${wzChartLinePath(x, y, model.totals)}"/>`;
    svg += wzChartReferenceSvg(model, wzChartReferences(model), {
        x, y, margin, plotW, yMax,
    });

    svg += `<g class="wz-chart-hover" aria-hidden="true">`;
    svg += `<rect class="wz-chart-hover-band" x="${margin.left}" y="${margin.top}" width="0" height="${plotH}" rx="4"/>`;
    svg += `<line class="wz-chart-hover-line" x1="0" y1="${margin.top}" x2="0" y2="${margin.top + plotH}"/>`;
    svg += `<circle class="wz-chart-hover-dot" cx="0" cy="0" r="4"/>`;
    svg += `</g>`;
    svg += `<rect class="wz-chart-hit" x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}"/>`;
    svg += `</svg>`;

    container.innerHTML = svg;
    const svgEl = container.querySelector(".wz-chart-svg");
    if (!svgEl) return;

    const geom = {
        key: model.kind,
        width,
        actualWidth: container.clientWidth || width,
        height,
        left: margin.left,
        top: margin.top,
        plotW,
        plotH,
        n: count,
        svg: svgEl,
        x,
        totalY: model.totals.map((value) => y(value)),
        hover: svgEl.querySelector(".wz-chart-hover"),
        hoverBand: svgEl.querySelector(".wz-chart-hover-band"),
        hoverLine: svgEl.querySelector(".wz-chart-hover-line"),
        hoverDot: svgEl.querySelector(".wz-chart-hover-dot"),
        band: (index) => {
            const left = index <= 0 ? margin.left : (x(index - 1) + x(index)) / 2;
            const right = index >= count - 1 ? margin.left + plotW : (x(index) + x(index + 1)) / 2;
            return { x: left, width: Math.max(1, right - left) };
        },
    };
    wzChartGeom[model.kind] = geom;

    svgEl.addEventListener("pointermove", (event) => {
        if (wzActiveChartMilestone) return;
        if (wzChartPinned || event.pointerType === "touch") return;
        wzChartTipShow(model.kind, wzChartIndexFromEvent(svgEl, event), event, false);
    });
    svgEl.addEventListener("pointerleave", () => {
        if (!wzChartPinned) wzChartTipScheduleHide();
    });
    svgEl.addEventListener("click", (event) => {
        const index = wzChartIndexFromEvent(svgEl, event);
        if (wzChartActive && wzChartActive.key === model.kind && wzChartActive.index === index && wzChartPinned) {
            wzChartTipHide(true);
        } else {
            wzChartTipShow(model.kind, index, event, true);
        }
    });
    svgEl.addEventListener("focus", () => {
        const index = wzChartFocusIndex[model.kind] ?? wzChartFirstActiveIndex(model);
        wzChartFocusIndex[model.kind] = index;
        wzChartTipShow(model.kind, index, null, false);
    });
    svgEl.addEventListener("blur", () => {
        if (!wzChartPinned) wzChartTipHide(true);
    });
    svgEl.addEventListener("keydown", (event) => {
        let next = null;
        const current = wzChartFocusIndex[model.kind] ?? 0;
        if (event.key === "ArrowRight") next = Math.min(count - 1, current + 1);
        else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = count - 1;
        else if (event.key === "Escape") {
            wzChartTipHide(true);
            return;
        } else {
            return;
        }
        event.preventDefault();
        wzChartFocusIndex[model.kind] = next;
        wzChartTipShow(model.kind, next, null, false);
    });

    wzRenderMilestoneLayer(container, model);
}

function wzCostObligations(input) {
    if (Array.isArray(input?.obligations) && input.obligations.length) {
        return input.obligations.filter((item) => Number(item.monthly) > 0);
    }
    if (Number(input?.mortgage_monthly) > 0 && input?.mortgage_end_age != null) {
        return [{
            name: "Kredyt hipoteczny",
            monthly: Number(input.mortgage_monthly),
            start_age: 0,
            end_age: Number(input.mortgage_end_age),
        }];
    }
    return [];
}

function wzRenderObligationCosts(input, projection) {
    const card = el("wzObligationsCosts");
    if (!card) return;
    const obligations = wzCostObligations(input);
    const ages = (projection?.chart?.ages || []).map(Number);
    if (!obligations.length || !ages.length) {
        card.classList.add("hidden");
        card.innerHTML = "";
        return;
    }
    const minAge = ages[0];
    const maxAge = ages[ages.length - 1];
    if (maxAge <= minAge) {
        card.classList.add("hidden");
        card.innerHTML = "";
        return;
    }
    const fireAge = wzFireAge(input);
    const pct = (age) => ((Math.max(minAge, Math.min(maxAge, age)) - minAge) / (maxAge - minAge)) * 100;
    const rows = obligations.map((obligation) => {
        const start = Number(obligation.start_age) || 0;
        const end = Number(obligation.end_age) || 0;
        if (end <= minAge || start >= maxAge || end <= start) return "";
        const left = pct(start);
        const width = Math.max(0.8, pct(end) - left);
        const funding = fireAge == null
            ? "źródło zależne od etapu"
            : end <= fireAge
                ? "z pensji"
                : start >= fireAge
                    ? "z portfela"
                    : "z pensji, potem z portfela";
        const title = `${obligation.name || "Zobowiązanie"}: ${wzFmtZloty(obligation.monthly)} zł/mies., ${start}–${end} r.ż., ${funding}.`;
        return `<div class="wz-cost-row" title="${escapeHtml(title)}">
            <div class="wz-cost-meta">
                <span class="wz-cost-name">${escapeHtml(obligation.name || "Zobowiązanie")}</span>
                <span class="wz-cost-amount">${wzFmtZloty(obligation.monthly)} zł/mies.</span>
            </div>
            <div class="wz-cost-track">
                <span class="wz-cost-bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>
            </div>
            <span class="wz-cost-age">${start}–${end} r.ż.</span>
        </div>`;
    }).join("");
    if (!rows) {
        card.classList.add("hidden");
        card.innerHTML = "";
        return;
    }
    const tickAges = Array.from({ length: 5 }, (_, index) => (
        Math.round(minAge + ((maxAge - minAge) * index) / 4)
    ));
    const axis = tickAges.map((age, index) => {
        const left = (index / 4) * 100;
        const justify = index === 0 ? "translateX(0)" : index === 4 ? "translateX(-100%)" : "translateX(-50%)";
        return `<span style="left:${left}%;transform:${justify}">${age}</span>`;
    }).join("");
    card.innerHTML = `<div class="wz-costs-head">
            <h4 class="wz-plan-subhead">Zobowiązania</h4>
            <span class="dim">Koszty poza budżetem życia</span>
        </div>
        <div class="wz-costs-list">${rows}</div>
        <div class="wz-costs-axis"><span></span><div class="wz-costs-axis-track">${axis}</div><span></span></div>`;
    card.classList.remove("hidden");
}

function wzRenderCharts(input, projection, summary = {}) {
    const wrap = el("wzChartsWrap");
    if (!wrap) return;
    wzChartFocusIndex = {};
    const chart = projection?.chart;
    const ages = Array.isArray(chart?.ages) ? chart.ages.map(Number) : [];
    if (!ages.length) {
        wrap.classList.add("hidden");
        wzChartMilestones = [];
        wzMilestoneTipHide();
        wzUpdateMilestoneToggle();
        wzChartData = null;
        wzChartTipHide(true);
        wzRenderObligationCosts(input, projection);
        return;
    }
    const series = (values) => Array.from(
        { length: ages.length },
        (_, index) => Number(values?.[index]) || 0
    );
    const obligations = series(chart?.obligations_monthly);
    const hasObligations = obligations.some((value) => value > 0.5);

    const withdrawalGroups = wzScaleChartGroups(
        wzLimitChartGroups(
            wzChartGroups(chart.withdrawals_net, input, "withdrawals", ages.length)
        ),
        1 / 12
    );
    const inputHorizon = wzInputHorizonAge(input);
    const summaryEnd = summary?.end_age;
    const horizonAge = Number.isFinite(inputHorizon)
        ? inputHorizon
        : (summaryEnd != null && Number.isFinite(Number(summaryEnd))
            ? Number(summaryEnd) + 1
            : null);
    // Wykresy wypłat pokazują ZUS do 100 r.ż.; kapitał prywatny urywamy na
    // horyzoncie planu (plan_end jest wiekiem ekskluzywnym — ostatni rok to
    // plan_end - 1), żeby nie sugerować, że poza modelem nadal rośnie.
    const capitalAges = horizonAge == null
        ? ages
        : ages.filter((age) => age < horizonAge);
    const capitalLimit = capitalAges.length;
    let capitalGroups = wzLimitChartGroups(
        wzChartGroups(chart.balances, input, "capital", ages.length)
    ).map((group) => ({
        ...group,
        values: group.values.slice(0, capitalLimit),
    }));
    if (!capitalLimit) capitalGroups = [];
    if (!withdrawalGroups.length && !capitalGroups.length) {
        wrap.classList.add("hidden");
        wzChartMilestones = [];
        wzMilestoneTipHide();
        wzUpdateMilestoneToggle();
        wzChartData = null;
        wzChartTipHide(true);
        wzRenderObligationCosts(input, projection);
        return;
    }

    wrap.classList.remove("hidden");
    const annotations = wzChartAnnotationsFor(input, projection);
    const references = {
        // Linie referencyjne to wypłata z portfela i ZUS, nie lifestyle
        // (mean/min z projekcji zawierają część etatu i kredyt).
        avgMonthly: Number(summary?.avg_monthly_portfolio ?? summary?.avg_monthly) || null,
        minMonthly: Number(summary?.min_monthly_portfolio ?? summary?.min_monthly) || null,
        peakWealth: Number(projection?.peak_wealth) || null,
    };
    wzChartMilestones = annotations;
    wzMilestoneTipHide();
    wzUpdateMilestoneToggle();
    wzChartData = { input, projection };
    wzChartModels = {
        withdrawals: {
            kind: "withdrawals",
            ages,
            annotations,
            references,
            horizonAge,
            groups: withdrawalGroups,
            totals: wzChartTotals(withdrawalGroups, ages.length),
            obligations: hasObligations ? obligations : null,
        },
        capital: {
            kind: "capital",
            ages: capitalAges,
            annotations,
            references,
            horizonAge,
            truncated: capitalAges.length < ages.length,
            groups: capitalGroups,
            totals: wzChartTotals(capitalGroups, capitalAges.length),
        },
    };
    wzChartTipHide(true);

    const withdrawalLegend = el("wzWithdrawalsLegend");
    const capitalLegend = el("wzCapitalLegend");
    if (withdrawalLegend) {
        withdrawalLegend.innerHTML = wzChartLegendHtml(withdrawalGroups);
    }
    if (capitalLegend) capitalLegend.innerHTML = wzChartLegendHtml(capitalGroups);

    const withdrawalChart = el("wzWithdrawalsChart");
    if (withdrawalChart) {
        if (withdrawalGroups.length) {
            wzRenderChartSvg(withdrawalChart, wzChartModels.withdrawals);
        } else {
            delete wzChartGeom.withdrawals;
            withdrawalChart.innerHTML = `<div class="wz-chart-empty">Brak wypłat w tym planie.</div>`;
        }
    }

    const capitalChart = el("wzCapitalChart");
    if (capitalChart) {
        if (capitalGroups.length) {
            wzRenderChartSvg(capitalChart, wzChartModels.capital);
        } else {
            delete wzChartGeom.capital;
            capitalChart.innerHTML = `<div class="wz-chart-empty">Brak kapitału prywatnego w tym planie.</div>`;
        }
    }

    wzBindChartGlobalEvents();
    wzRenderObligationCosts(input, projection);
}


    function render(options = {}) {
        const { input, projection, summary } = options;
        wzRenderCharts(input, projection, summary);
    }

    function hideTips() {
        wzChartTipHide(true);
        wzMilestoneTipHide();
    }

    window.ResultsCharts = {
        render,
        hideTips,
        accountColor,
        color: accountColor,
        annotationsFor: wzChartAnnotationsFor,
        references: wzChartReferences,
    };
})();
