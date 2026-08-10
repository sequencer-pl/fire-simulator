import pytest

from app.core.pmt import pmt


def test_pmt_zero_rate():
    assert pmt(0, 10, -100000) == 10000.0


def test_pmt_zero_rate_with_fv():
    assert pmt(0, 10, -100000, 50000) == 5000.0


def test_pmt_invalid_nper():
    assert pmt(0.02, 0, -100000) == 0.0
    assert pmt(0.02, -5, -100000) == 0.0


def test_pmt_end_of_period():
    # Ręcznie: temp = 1.02^5
    # result = (1_000_000 * temp * 0.02) / (temp - 1)
    result = pmt(0.02, 5, -1000000, 0, when=0)
    temp = 1.02**5
    expected = (1000000 * temp * 0.02) / (temp - 1)
    assert result == pytest.approx(expected, rel=1e-12)


def test_pmt_beginning_of_period_identity():
    # when=1 to when=0 podzielone przez (1 + rate)
    when0 = pmt(0.02, 15, -1000000, 100000, when=0)
    when1 = pmt(0.02, 15, -1000000, 100000, when=1)
    assert when1 == pytest.approx(when0 / 1.02, rel=1e-9)


def test_pmt_beginning_smaller_than_end():
    when0 = pmt(0.02, 15, -1000000, 100000, when=0)
    when1 = pmt(0.02, 15, -1000000, 100000, when=1)
    assert when1 < when0


def test_pmt_known_value():
    # Weryfikacja znanej wartości z wcześniejszej sesji
    assert pmt(0.02, 5, -316690, 0, when=1) == pytest.approx(65871.02, rel=1e-4)
