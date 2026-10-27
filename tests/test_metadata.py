from app.stages.metadata import ROI_HINTS, STAGE_META


def _roi_hint(stage_type: str, account: str) -> str:
    return STAGE_META[stage_type]["available_accounts"][account]["fields"]["roi"]["hint"]


def test_roi_hints_are_gross_before_tax():
    assert "brutto" in ROI_HINTS["broker"]
    assert "przed Belką" in ROI_HINTS["broker"]
    assert "brutto" in ROI_HINTS["lokata"]
    assert "przed Belką" in ROI_HINTS["lokata"]
    assert "netto" not in ROI_HINTS["lokata"]
    assert "brutto" in ROI_HINTS["oki_inw"]


def test_stage_metadata_uses_account_specific_roi_hints():
    assert _roi_hint("akumulacja", "broker") == ROI_HINTS["broker"]
    assert _roi_hint("akumulacja", "lokata") == ROI_HINTS["lokata"]
    assert _roi_hint("realizacja", "lokata") == ROI_HINTS["lokata"]
    assert _roi_hint("akumulacja", "ikze") == ROI_HINTS["ikze"]
