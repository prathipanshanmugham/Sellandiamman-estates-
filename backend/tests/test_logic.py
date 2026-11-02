import sys
from datetime import date
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from logic import (calc_commission, calc_invoice, calc_shortstay, calc_owner_statement, can_transition,  # noqa: E402
                   ranges_overlap)


def test_percent_commission_is_commission_not_sale_value():
    r = calc_commission(8500000, {"type": "percent", "value": 2})
    assert r["gross"] == 170000.0 and r["company_net"] == 170000.0


def test_fixed_and_months_rent():
    assert calc_commission(0, {"type": "fixed", "value": 25000})["gross"] == 25000
    assert calc_commission(16000, {"type": "months_rent", "value": 1})["gross"] == 16000


def test_splits():
    r = calc_commission(1000000, {"type": "percent", "value": 2},
                        [{"party": "Co-broker", "percent": 25}, {"party": "Referrer", "kind": "referral", "percent": 10}])
    assert r["gross"] == 20000 and r["splits_total"] == 7000 and r["company_net"] == 13000


def test_invalid_commission():
    with pytest.raises(ValueError):
        calc_commission(100, {"type": "bogus", "value": 1})
    with pytest.raises(ValueError):
        calc_commission(100, {"type": "percent", "value": 150})
    with pytest.raises(ValueError):
        calc_commission(100, {"type": "percent", "value": 10}, [{"percent": 70}, {"percent": 40}])


def test_invoice_gst_configurable():
    r = calc_invoice([{"description": "Fee", "qty": 1, "rate": 10000}], 18, True)
    assert r["tax"] == 1800 and r["total"] == 11800
    r = calc_invoice([{"description": "Fee", "qty": 2, "rate": 5000}], 18, False)
    assert r["tax"] == 0 and r["total"] == 10000
    with pytest.raises(ValueError):
        calc_invoice([], 0, False)


def test_shortstay_separation():
    r = calc_shortstay(date(2026, 1, 1), date(2026, 1, 4), 3000, discount=500, cleaning_fee=800, platform_fee=1000,
                       operating_costs=700, mgmt_fee_pct=20)
    assert r["nights"] == 3 and r["room_revenue"] == 9000 and r["gross"] == 9300
    assert r["net_after_platform"] == 8300 and r["management_fee"] == 1660 and r["owner_payout"] == 5940
    assert r["management_fee"] + r["owner_payout"] + r["operating_costs"] + r["platform_fee"] == r["gross"]
    with pytest.raises(ValueError):
        calc_shortstay(date(2026, 1, 4), date(2026, 1, 4), 3000)


def test_owner_statement():
    r = calc_owner_statement([{"amount": 16000, "fee_pct": 8}], [{"amount": 1200}])
    assert r == {"rent_collected": 16000, "management_fee": 1280, "expenses": 1200, "charges_collected": 0, "net_payable": 13520}
    # bills collected from the tenant for the owner (EB, water) are passed on in full; no fee is taken on them
    r = calc_owner_statement([{"amount": 16000, "fee_pct": 8}], [{"amount": 1200}], [{"amount": 1850.5}])
    assert r["charges_collected"] == 1850.5 and r["management_fee"] == 1280 and r["net_payable"] == 15370.5


def test_property_workflow():
    assert can_transition("draft", "verification_pending")
    assert not can_transition("draft", "published")
    assert not can_transition("verification_pending", "published")
    assert can_transition("ready_to_market", "published")


def test_overlap():
    assert ranges_overlap("2026-01-01", "2026-01-05", "2026-01-04", "2026-01-06")
    assert not ranges_overlap("2026-01-01", "2026-01-05", "2026-01-05", "2026-01-06")
