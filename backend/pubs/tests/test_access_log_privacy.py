from pathlib import Path

from django.conf import settings


def test_asgi_disables_uvicorn_raw_request_access_log() -> None:
    asgi_config = (Path(__file__).parents[2] / "config" / "asgi.py").read_text()

    assert 'logging.getLogger("uvicorn.access").disabled = True' in asgi_config


def test_django_logs_only_through_privacy_safe_json_handler() -> None:
    django_logger = settings.LOGGING["loggers"]["django"]

    assert django_logger == {
        "handlers": ["console"],
        "level": settings.LOG_LEVEL,
        "propagate": False,
    }
    assert settings.LOGGING["handlers"]["console"]["formatter"] == "json"


def test_production_access_log_never_includes_path_query_or_raw_ip() -> None:
    entrypoint = (Path(__file__).parents[2] / "docker-entrypoint.sh").read_text()
    format_line = next(
        line for line in entrypoint.splitlines() if "--access-logformat" in line
    )

    for unsafe_atom in ("%(r)s", "%(U)s", "%(q)s", "%(h)s", "%(f)s"):
        assert unsafe_atom not in format_line
    for safe_atom in ("%(m)s", "%(s)s", "%(L)s"):
        assert safe_atom in format_line
