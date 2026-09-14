"""ASGI config for na-pivo backend."""

import logging
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_asgi_application()

# Uvicorn's default access logger includes the raw request target. Party join
# codes are part of a legacy URL, so request logging stays in Django's
# structured, redacted middleware instead.
logging.getLogger("uvicorn.access").disabled = True
