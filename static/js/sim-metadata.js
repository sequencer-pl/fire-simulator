// sim-metadata.js — Account and stage registry data

const ACCOUNT_ICONS = {
    broker: "📈",
    lokata: "🏦",
    obligacje: "📜",
    gotowka: "💵",
    ike: "🐷",
    ikze: "🧾",
    oipe: "🎯",
    ppk: "🏢",
    ppe: "💼",
    oki_inw: "📊",
    oki_osk: "💰",
    krypto: "₿",
    zus: "🏛️",
};

const ACCOUNT_LABELS = {
    broker: "Broker",
    gotowka: "Gotówka",
    ike: "IKE",
    ikze: "IKZE",
    krypto: "Krypto",
    lokata: "Lokata",
    obligacje: "Obligacje",
    oipe: "OIPE",
    oki_inw: "OKI inwestycyjne",
    oki_osk: "OKI oszczędnościowe",
    ppe: "PPE",
    ppk: "PPK",
    zus: "ZUS (emerytura)",
};

const FIELD_ORDER = [
    "starting_balance",
    "starting_balance_ofe",
    "cost_basis_enabled",
    "cost_basis",
    "ofe_member",
    "monthly_base",
    "annual_contribution",
    "employee_pct",
    "employer_pct",
    "state_topups",
    "roi",
    "waloryzacja_skladek",
    "waloryzacja_swiadczenia",
    "buffer",
    "monthly_pension",
];

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
    for (const meta of Object.values(STAGE_TYPES)) {
        const acc = meta && meta.available_accounts && meta.available_accounts[accountKey];
        if (acc && acc.description) return acc.description;
    }
    return null;
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
