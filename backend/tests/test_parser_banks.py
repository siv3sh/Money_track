"""SMS parser coverage for newly allowed banks (HDFC, SBI, Axis, Kotak)."""

from parser import ALLOWED_BANKS, parse_sms


def test_allowed_banks_include_nationals():
    for name in (
        "HDFC Bank",
        "State Bank of India",
        "Axis Bank",
        "Kotak Mahindra Bank",
        "Federal Bank",
        "ICICI Bank",
        "South Indian Bank",
    ):
        assert name in ALLOWED_BANKS


def test_hdfc_debit_sms():
    # Avoid DEMO_PATTERNS (xx1234 / amazon / 23-07-26)
    txn = parse_sms(
        "HDFCBK",
        "Rs.750.50 debited from a/c XX4321 at SWIGGY on 12-09-26. Avl Bal Rs.8,100.00",
        use_llm=False,
    )
    assert txn is not None
    assert txn["bank"] == "HDFC Bank"
    assert txn["type"] == "debit"
    assert abs(float(txn["amount"]) - 750.50) < 0.01


def test_sbi_credit_sms():
    txn = parse_sms(
        "SBIINB",
        "Rs 2000 credited to a/c XX5678 from RAVI KUMAR on 12-Sep-26",
        use_llm=False,
    )
    assert txn is not None
    assert txn["bank"] == "State Bank of India"
    assert txn["type"] == "credit"
    assert abs(float(txn["amount"]) - 2000.0) < 0.01


def test_axis_credit_card_sms():
    txn = parse_sms(
        "AXISBK",
        "Rs.3,499 spent on your Axis Bank Credit Card XX9876 at FLIPKART on 12-09-26",
        use_llm=False,
    )
    assert txn is not None
    assert txn["bank"] == "Axis Bank"
    assert txn["type"] == "debit"
    assert abs(float(txn["amount"]) - 3499.0) < 0.01


def test_kotak_upi_sms():
    txn = parse_sms(
        "KOTAKB",
        "Rs.120.00 debited via UPI to merchant@okaxis on 12-09-26 from Kotak a/c XX2211. Ref 112233445566",
        use_llm=False,
    )
    assert txn is not None
    assert txn["bank"] == "Kotak Mahindra Bank"
    assert txn["type"] == "debit"


def test_otp_still_rejected():
    assert (
        parse_sms("VM-HDFCBK", "Your OTP is 123456. Do not share with anyone.", use_llm=False)
        is None
    )
