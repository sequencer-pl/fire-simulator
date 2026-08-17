"""Average remaining life expectancy table (SDTZ).

Source: Announcement of the President of GUS dated 25 March 2026 (M.P. 2026 item 319),
effective from 2026-04-01 to 2027-03-31.

Values are remaining life expectancy in MONTHS for "0 completed months
above a full year of life" (column for full years). Pension in the new
system = accumulated capital / SDTZ(age), e.g. 500,000 / 222.7 ≈ 2,245 PLN.
"""

# {wiek w latach: miesiące dalszego trwania życia}
TABLICA_SDTZ = {
    30: 594.8, 31: 583.3, 32: 571.8, 33: 560.4, 34: 548.9, 35: 537.5,
    36: 526.2, 37: 514.8, 38: 503.5, 39: 492.2, 40: 481.0, 41: 469.8,
    42: 458.6, 43: 447.5, 44: 436.4, 45: 425.4, 46: 414.4, 47: 403.4,
    48: 392.5, 49: 381.7, 50: 370.9, 51: 360.2, 52: 349.7, 53: 339.2,
    54: 328.8, 55: 318.6, 56: 308.4, 57: 298.3, 58: 288.5, 59: 278.6,
    60: 268.9, 61: 259.4, 62: 250.0, 63: 240.7, 64: 231.7, 65: 222.7,
    66: 214.1, 67: 205.4, 68: 197.0, 69: 188.8, 70: 180.6, 71: 172.6,
    72: 164.6, 73: 156.8, 74: 149.2, 75: 141.7, 76: 134.3, 77: 127.1,
    78: 120.0, 79: 113.2, 80: 106.4, 81: 100.0, 82: 93.7, 83: 87.7,
    84: 82.0, 85: 76.6, 86: 71.5, 87: 66.7, 88: 62.3, 89: 58.1,
    90: 54.2,
}

MIN_AGE = min(TABLICA_SDTZ)
MAX_AGE = max(TABLICA_SDTZ)


def sdtz_months(age: int) -> float:
    """Remaining life expectancy (months) for a completed year of life."""
    if age <= MIN_AGE:
        return TABLICA_SDTZ[MIN_AGE]
    if age >= MAX_AGE:
        return TABLICA_SDTZ[MAX_AGE]
    return TABLICA_SDTZ[age]
