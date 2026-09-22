"""Value-free diagnostics for rejected offline drink writes."""

_FIELDS = {
    "name", "lat", "lng", "city", "client_id", "evening_client_id",
    "external_id", "place_context", "drink_type", "drank_at", "party_code",
    "beer", "beer.name", "beer.price_czk", "beer.volume_ml", "beer.serving_type",
    "non_field_errors",
}
_CODES = {
    "required", "null", "blank", "invalid", "invalid_choice", "max_length",
    "min_length", "min_value", "max_value", "overflow", "not_a_dict",
}


def drink_validation_errors(errors: dict) -> list[dict[str, str]]:
    """Only schema paths and known DRF codes; never stringify error messages."""
    result = []

    def collect(value, path=""):
        if isinstance(value, dict):
            for field, details in value.items():
                child = f"{path}.{field}" if path else field
                if child in _FIELDS:
                    collect(details, child)
        elif isinstance(value, list):
            for details in value:
                collect(details, path)
        elif path in _FIELDS:
            code = getattr(value, "code", "invalid")
            detail = {"field": path, "code": code if code in _CODES else "invalid"}
            if detail not in result and len(result) < 16:
                result.append(detail)

    collect(errors)
    return result
