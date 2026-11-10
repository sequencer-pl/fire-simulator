// sim-metadata.js — Account and stage registry data

const _stageTypesData = document.getElementById("stageTypesData");
function _readStageTypes() {
    if (!_stageTypesData) return {};
    try {
        return JSON.parse(_stageTypesData.dataset.stageTypes || "{}");
    } catch (err) {
        console.error("Nie udało się odczytać STAGE_TYPES:", err);
        return {};
    }
}
const STAGE_TYPES = _readStageTypes();

// Ikony kont: liniowe SVG z icons.js (jeden język ikon w całej aplikacji).
const ACCOUNT_ICON_NAMES = [
    "broker", "lokata", "obligacje", "gotowka", "ike", "ikze", "oipe",
    "ppk", "ppe", "oki_inw", "oki_osk", "krypto", "zus", "nieruchomosc",
];
const ACCOUNT_ICONS = Object.fromEntries(ACCOUNT_ICON_NAMES.map((k) => [k, iconSvg(k)]));

const ACCOUNT_LABELS = {
    broker: "Broker",
    gotowka: "Gotówka",
    ike: "IKE",
    ikze: "IKZE",
    krypto: "Krypto",
    lokata: "Lokata",
    nieruchomosc: "Nieruchomość",
    obligacje: "Obligacje",
    oipe: "OIPE",
    oki_inw: "OKI inwestycyjne",
    oki_osk: "OKI oszczędnościowe",
    ppe: "PPE",
    ppk: "PPK",
    zus: "ZUS (emerytura)",
};

const MULTI_INSTANCE_ACCOUNTS = new Set([
    "broker",
    "lokata",
    "obligacje",
    "krypto",
    "gotowka",
    "nieruchomosc",
]);

function baseAccountKey(accountKey) {
    if (!accountKey || accountKey === "zus:ofe") return accountKey || "";
    return String(accountKey).split(":")[0];
}

function accountIconFor(accountKey) {
    const base = baseAccountKey(accountKey);
    return ACCOUNT_ICONS[accountKey] || ACCOUNT_ICONS[base] || "";
}

function accountDisplayLabel(accountKey, customName = "") {
    if (customName && String(customName).trim()) return String(customName).trim();
    if (ACCOUNT_LABELS[accountKey]) return ACCOUNT_LABELS[accountKey];
    const base = baseAccountKey(accountKey);
    if (ACCOUNT_LABELS[base] && String(accountKey).includes(":")) {
        const suffix = String(accountKey).split(":")[1];
        return `${ACCOUNT_LABELS[base]} #${suffix}`;
    }
    return ACCOUNT_LABELS[base] || accountKey;
}

const FIELD_ORDER = [
    "custom_name",
    "starting_balance",
    "starting_balance_ofe",
    "rental_income_monthly",
    "cost_basis_enabled",
    "cost_basis",
    "ofe_member",
    "base_override_enabled",
    "monthly_base",
    "annual_contribution",
    "employee_pct",
    "employer_pct",
    "state_topups",
    "roi",
    "lokata_term_months",
    "liquidation_age",
    "waloryzacja_skladek",
    "waloryzacja_swiadczenia",
    "buffer",
    "monthly_pension",
];

function getAccountMeta(stageType, accountKey) {
    const meta = STAGE_TYPES[stageType];
    if (!meta || !meta.available_accounts) return null;
    if (meta.available_accounts[accountKey]) return meta.available_accounts[accountKey];
    const base = baseAccountKey(accountKey);
    const baseMeta = meta.available_accounts[base];
    if (!baseMeta) return null;
    return {
        ...baseMeta,
        label: accountDisplayLabel(accountKey),
    };
}

function getAvailableAccounts(stageType) {
    const meta = STAGE_TYPES[stageType];
    if (!meta || !meta.available_accounts) return {};
    return meta.available_accounts;
}

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

function getAccountInfo(accountKey) {
    const base = baseAccountKey(accountKey);
    for (const meta of Object.values(STAGE_TYPES)) {
        const acc =
            meta &&
            meta.available_accounts &&
            (meta.available_accounts[accountKey] || meta.available_accounts[base]);
        if (acc && acc.description) return acc.description;
    }
    return null;
}

function earlyTaxDescription(acc) {
    const base = baseAccountKey(acc);
    const rules = CONFIG.accounts[acc] || CONFIG.accounts[base];
    if (rules.early_tax_model === "scale") {
        if (CONFIG.prog2 != null && CONFIG.rate_middle != null) {
            return `skalą ${(CONFIG.rate_lower * 100).toFixed(0)}/${(CONFIG.rate_middle * 100).toFixed(0)}/${(CONFIG.rate_upper * 100).toFixed(0)}% od całości`;
        }
        return `skalą ${(CONFIG.rate_lower * 100).toFixed(0)}/${(CONFIG.rate_upper * 100).toFixed(0)}% od całości`;
    }
    if (rules.early_tax_model === "flat") {
        return `ryczałtem ${(rules.early_tax_rate * 100).toFixed(0)}% od zysku`;
    }
    return "bez podatku";
}

function normalTaxDescription(acc) {
    const base = baseAccountKey(acc);
    const rules = CONFIG.accounts[acc] || CONFIG.accounts[base];
    if (rules.tax_model === "scale") return `skala PIT`;
    if (rules.tax_model === "flat") {
        const basis = rules.tax_basis === "full" ? "całości" : "zysku";
        return `ryczałt ${(rules.tax_rate * 100).toFixed(0)}% od ${basis}`;
    }
    return "bez podatku";
}
