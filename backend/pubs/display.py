from django.utils import timezone


def czech_day(value) -> str:
    if value is None:
        return "bez data"
    if hasattr(value, "hour") and timezone.is_aware(value):
        value = timezone.localtime(value)
    return f"{value.day}. {value.month}. {value.year}"


def czech_moment(value) -> str:
    if value is None:
        return "bez data"
    local = timezone.localtime(value) if timezone.is_aware(value) else value
    return f"{czech_day(local)} {local:%H:%M}"


def account_label(instance, field: str = "account") -> str:
    if getattr(instance, f"{field}_id") is None:
        return "bez účtu"
    return str(getattr(instance, field))


def with_city(name: str, city: str | None) -> str:
    name = name or "Hospoda bez názvu"
    return f"{name}, {city}" if city else name


def clip(text: str, limit: int = 40) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else f"{text[:limit - 1].rstrip()}…"
