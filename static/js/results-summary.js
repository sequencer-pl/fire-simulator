// results-summary.js — wspólne hero, metryki i fakty ekranu wyników.
// Nie liczy metryk finansowych: czyta je z ResultsModel / backendu.

(function () {
    function esc(value) {
        return window.escapeHtml ? window.escapeHtml(value) : String(value ?? "");
    }

    function money(value) {
        return window.ResultsModel.fmtMoney(value);
    }

    function pct(value) {
        return window.ResultsModel.fmtPct(value);
    }

    function label(account) {
        return window.accountDisplayLabel?.(account) || account;
    }

    function tip(text) {
        return typeof window.tipHtml === "function" ? window.tipHtml(text) : "";
    }

    function metricsFor(planView) {
        const metrics = [
            window.ResultsModel.metric(planView, "totalWithdrawnPrivate"),
            window.ResultsModel.metric(planView, "avgMonthly"),
            window.ResultsModel.metric(planView, "minMonthly"),
            window.ResultsModel.metric(planView, "portfolioMinMonthly", {
                label: "Minimalna wypłata z portfela",
            }),
            window.ResultsModel.metric(planView, "finalWealthNet"),
            window.ResultsModel.metric(planView, "taxAndHealth", { label: "Podatki i składki" }),
        ];
        if ((planView?.summary?.zus_monthly ?? 0) > 0) {
            metrics.push(window.ResultsModel.metric(planView, "zusMonthly"));
        } else {
            metrics.push(window.ResultsModel.metric(planView, "peakWealth", { label: "Majątek szczytowy" }));
        }
        return metrics;
    }

    function renderHero(container, hero) {
        if (!container) return;
        if (!hero) {
            container.innerHTML = "";
            container.className = "wz-hero-answer hidden";
            return;
        }
        container.className = `wz-hero-answer${hero.warn ? " is-warn" : ""}`;
        container.innerHTML = `<div class="wz-hero-kicker">${hero.kicker || ""}</div>
            <div class="wz-hero-headline">${hero.headline || ""}</div>
            <div class="wz-hero-desc">${hero.desc || ""}</div>`;
    }

    function renderWarnings(container, warnings) {
        if (!container) return;
        window.ResultsBanners.render(container, warnings || [], {
            variant: "warn",
            mode: "list",
        });
    }

    function renderMetrics(container, metrics) {
        if (!container) return;
        window.ResultsMetrics.render(container, metrics || []);
    }

    function renderFacts(container, facts) {
        if (!container) return;
        const list = (facts || []).filter(Boolean);
        container.innerHTML = list.join("");
        container.classList.toggle("hidden", !list.length);
    }

    function renderWhy(container, why) {
        if (!container) return;
        if (!why) {
            container.innerHTML = "";
            container.classList.add("hidden");
            return;
        }
        container.innerHTML = why;
        container.classList.remove("hidden");
    }

    function policyText(policy) {
        const value = String(policy || "");
        const early = value.startsWith("early");
        const roi = value.endsWith("_roi");
        const tax = value.endsWith("_tax");
        let text = "Najpierw konta dostępne bez kary, potem wcześniejsze z 19% "
            + "(IKE/PPK/PPE przed 60), na końcu IKZE przed 65 (skala).";
        text += early
            ? " W tym planie IKZE jest opodatkowane wcześniej, a IKE/PPK schodzą później."
            : " W tym planie nie wymuszamy wcześniejszego zwrotu IKZE — najpierw schodzą IKE/PPK i konta dostępne. Jeśli portfel nie wystarcza, silnik może odblokować IKZE wcześniej.";
        text += tax
            ? " W obrębie progu najpierw konta najtańsze podatkowo (np. OKI, IKE po 60)."
            : roi
                ? " W obrębie progu najpierw konta z niższym ROI."
                : " W obrębie progu wypłaty idą proporcjonalnie do sald.";
        return text;
    }

    function ikzeFacts(projection) {
        const facts = [];
        if (!projection) return facts;

        const earlyTotal = Number(projection.early_return_total) || 0;
        if (earlyTotal > 0.5) {
            const entries = Object.entries(projection.early_return_allocations || {})
                .filter(([, amount]) => amount > 0.5);
            const parts = entries.map(([account, amount]) => `${label(account)}: ${money(amount)}`);
            const targets = entries.map(([account]) => label(account));
            const tax = Number(projection.early_return_tax_total) || 0;
            const targetLabel = targets.length ? targets.join(" + ") : "konto docelowe";
            const tipText = `Podatek jednorazowy: ${money(tax)}. Netto ${money(earlyTotal)}${
                parts.length ? `; reinwestycja: ${parts.join(", ")}` : ""
            }.`;
            facts.push(
                `<span class="chip wz-fact">Wcześniejszy zwrot IKZE: ${money(earlyTotal)} → ${esc(targetLabel)}${tip(tipText)}</span>`
            );
        }

        const refundTotal = Number(projection.ikze_refund_total) || 0;
        if (refundTotal > 0) {
            const entries = Object.entries(projection.ikze_refund_allocations || {})
                .filter(([, amount]) => amount > 0.5);
            const parts = entries.map(([account, amount]) => `${label(account)}: ${money(amount)}`);
            const targets = entries.map(([account]) => label(account));
            const allocated = entries.reduce((sum, [, amount]) => sum + amount, 0);
            let tipText = parts.length
                ? `Zainwestowano: ${parts.join(", ")}.`
                : "Brak celu reinwestycji — kwota pozostaje jako obniżenie podatku.";
            if (parts.length) tipText += " Ulga wraca co roku i powiększa kapitał.";
            const unallocated = refundTotal - allocated;
            if (parts.length && unallocated > 0.5) {
                tipText += ` Nierozdysponowane ${money(unallocated)} pozostaje jako obniżenie podatku.`;
            }
            const targetSuffix = targets.length === 1 ? ` → ${esc(targets[0])}` : "";
            facts.push(
                `<span class="chip wz-fact">Ulga IKZE: ${money(refundTotal)}${targetSuffix}${tip(tipText)}</span>`
            );
        }
        return facts;
    }

    function obligationsFor(input) {
        if (Array.isArray(input?.obligations) && input.obligations.length) {
            return input.obligations;
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

    function fireAgeFor(input) {
        const starts = (input?.stages || [])
            .filter((stage) => stage.stage_type === "realizacja"
                && Object.keys(stage.accounts || {}).some((key) => {
                    const base = window.baseAccountKey ? window.baseAccountKey(key) : key;
                    return base !== "zus" && base !== "zus:ofe";
                }))
            .map((stage) => Number(stage.start_age))
            .filter(Number.isFinite);
        return starts.length ? Math.min(...starts) : null;
    }

    function obligationFacts(input) {
        const obligations = obligationsFor(input);
        if (!obligations.length) return [];
        const total = obligations.reduce((sum, item) => sum + (Number(item.monthly) || 0), 0);
        const startAges = obligations.map((item) => Number(item.start_age)).filter(Number.isFinite);
        const endAges = obligations.map((item) => Number(item.end_age)).filter(Number.isFinite);
        const firstAge = startAges.length ? Math.min(...startAges) : 0;
        const lastAge = endAges.length ? Math.max(...endAges) : firstAge;
        let peak = 0;
        for (let age = firstAge; age <= lastAge; age += 1) {
            const active = obligations.reduce(
                (sum, item) => sum
                    + ((Number(item.start_age) <= age && age < Number(item.end_age))
                        ? (Number(item.monthly) || 0)
                        : 0),
                0
            );
            peak = Math.max(peak, active);
        }
        peak = peak || total;
        const fireAge = fireAgeFor(input);
        const details = obligations.map((item) => {
            const from = Number(item.start_age) || 0;
            const to = Number(item.end_age) || 0;
            const afterFire = Number.isFinite(fireAge) && to >= fireAge;
            const redirect = afterFire
                ? "po zakończeniu wypłata wraca do budżetu"
                : item.redirect_to_savings === false
                    ? "po zakończeniu zostaje w budżecie"
                    : "po zakończeniu na oszczędności";
            return `${item.name || "Zobowiązanie"}: ${money(item.monthly)}/mies. od ${from} do ${to} r.ż., ${redirect}.`;
        }).join(" ");
        const endLabel = endAges.length ? ` do ${Math.max(...endAges)} r.ż.` : "";
        return [
            `<span class="chip wz-fact">Zobowiązania: do ${money(peak)}/mies.${endLabel}${tip(`Zobowiązania czasowe są dodatkowym kosztem poza budżetem. W Asystencie planner dolicza je do wypłaty w latach ich trwania; w ręcznym Symulatorze budżet to faktyczna kwota po ich opłaceniu. ${details}`)}</span>`
        ];
    }

    function budgetFact(input, summary) {
        const obligations = obligationsFor(input);
        if (!obligations.length) return "";
        const avgRaw = summary?.avg_monthly;
        const minRaw = summary?.min_monthly;
        const avg = avgRaw == null ? null : Number(avgRaw);
        const min = minRaw == null ? null : Number(minRaw);
        if (!Number.isFinite(avg)) return "";
        const label = Number.isFinite(min)
            ? `min. ${money(min)}/mies.`
            : `średnio ${money(avg)}/mies.`;
        const detail = Number.isFinite(min)
            ? ` Minimalny budżet: ${money(min)}/mies., średni: ${money(avg)}/mies.`
            : ` Średni budżet: ${money(avg)}/mies.`;
        return `<span class="chip wz-fact">Budżet na życie: ${label}${tip(`Dochód netto z planu (portfel + ZUS + praca) po odjęciu aktywnych zobowiązań czasowych. To kwota na życie, a nie wypłata z portfela.${detail} Spadek wypłaty po zakończeniu zobowiązania zobaczysz w tabeli rok po roku.`)}</span>`;
    }

    function factsForSimulator(input, projection, summary) {
        const obligationChips = obligationFacts(input);
        const facts = ikzeFacts(projection).concat(obligationChips);
        const budget = budgetFact(input, summary);
        if (budget) facts.push(budget);
        const peak = Number(summary?.peak_wealth);
        if (Number.isFinite(peak) && peak > 0 && (summary?.zus_monthly ?? 0) > 0) {
            facts.push(
                `<span class="chip wz-fact">Majątek szczytowy: ${money(peak)}${tip("Najwyższy majątek prywatny w trakcie planu, brutto. Nie zawiera ZUS — ten pokazujemy osobno.")}</span>`
            );
        }
        const finalGross = Number(summary?.final_wealth);
        const finalNet = Number(summary?.final_wealth_net);
        if (Number.isFinite(finalGross) && finalGross > 0.5
            && (!Number.isFinite(finalNet) || Math.abs(finalGross - finalNet) > 0.5)) {
            facts.push(
                `<span class="chip wz-fact">Na koniec brutto: ${money(finalGross)}${tip("Majątek na koniec horyzontu przed podatkiem wyjścia. Wartość netto jest w kluczowych liczbach.")}</span>`
            );
        }
        if (summary?.tax_efficiency != null) {
            const taxEfficiency = Number(summary.tax_efficiency);
            if (Number.isFinite(taxEfficiency)) {
                facts.push(
                    `<span class="chip wz-fact">Efektywność podatkowa: ${pct(taxEfficiency)}${tip("Ile z wypłat i podatków zostaje netto. Liczymy jako wypłaty netto podzielone przez wypłaty netto plus podatki i składki.")}</span>`
                );
            }
        }
        const taxRefund = Number(summary?.total_tax_refund);
        if (Number.isFinite(taxRefund) && taxRefund > 0.5
            && !(Number(projection?.ikze_refund_total) > 0.5)) {
            facts.push(
                `<span class="chip wz-fact">Zwrot IKZE: ${money(taxRefund)}${tip("Suma ulgi podatkowej z wpłat na IKZE w całym planie.")}</span>`
            );
        }
        const policy = projection?.withdrawal_policy || input?.withdrawal_policy;
        if (policy) {
            facts.push(
                `<span class="chip wz-fact">Kolejność wypłat${tip(policyText(policy))}</span>`
            );
        }
        return facts;
    }

    function render(root, view = {}) {
        if (!root) return;
        const hero = data => root.querySelector(`[data-results-${data}]`);
        renderHero(hero("hero"), view.hero);
        renderWarnings(hero("warnings"), view.warnings);
        renderMetrics(hero("metrics"), view.metrics || metricsFor(view.planView));
        renderFacts(hero("facts"), view.facts);
        renderWhy(hero("why"), view.why);
    }

    window.ResultsSummary = {
        metricsFor,
        factsForSimulator,
        obligationFacts,
        budgetFact,
        ikzeFacts,
        policyText,
        render,
        renderHero,
        renderWarnings,
        renderMetrics,
        renderFacts,
        renderWhy,
        fmtPct: pct,
    };
})();
