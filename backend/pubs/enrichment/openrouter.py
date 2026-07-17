"""
pubs.enrichment.openrouter — AI vision client for the beer-menu scan helper.

WHY THIS EXISTS
---------------
``POST /v1/pub-menu-scan`` lets a user photograph a pub beer menu and get back a
parsed list of beers to review before contributing. The extraction itself is done
by a multimodal LLM reached through OpenRouter's OpenAI-compatible
chat-completions API. This module is the thin, testable client for that call.

It is structurally modelled on :mod:`pubs.enrichment.mapy`:
* a ``requests.Session`` (injectable for tests),
* a process-wide thread-safe daily request cap that resets at UTC midnight,
* one retry on a 429/5xx then give up,
* a context manager that closes a session it owns.

It is a PURE extraction helper: it performs no DB writes, awards no XP, and stores
no image. Privacy: the API key, the image bytes, and the raw model text are NEVER
logged — only counts / durations / status, consistent with pubs.observability.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from datetime import UTC, datetime

import requests

from ._daily_counter import DailyCounter

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# OpenRouter's OpenAI-compatible chat-completions endpoint.
_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"

# Default multimodal model; overridable via settings.OPENROUTER_MODEL. Picked for
# best vision-per-cost: newest-gen Gemini vision (robust on poor phone photos) at
# a cheap ~$0.0008/scan. Bump to google/gemini-3-flash-preview for max robustness.
_DEFAULT_MODEL = "google/gemini-3.1-flash-lite"

# Per-request HTTP timeout (seconds). Vision is slow, so this is generous.
_DEFAULT_TIMEOUT = 30

# Default process-wide daily request cap (cost guard).
_DEFAULT_DAILY_CAP = 2000

# Hard cap on output tokens per call. A <=12-beer JSON list is tiny, and the
# daily cap counts REQUESTS, not tokens — so this bounds the per-call cost a
# looping/verbose model (or default Gemini "thinking") would otherwise run up.
_MAX_OUTPUT_TOKENS = 2048

# A scan can include the beer list plus a small secondary selection of soft
# drinks, shots, and wine. The public beer menu still keeps its existing 12-row cap.
MAX_DRINKS = 24
MAX_BEERS = 12

# Optional ranking/attribution headers OpenRouter surfaces in its dashboard.
_APP_URL = "https://napivo.app"
_APP_TITLE = "Na pivo"

# The model is asked to return ONLY this JSON shape. Czech context because the
# menus are Czech/Slovak; the instructions are explicit so we can parse strictly.
_PROMPT = (
    "Jsi pomocník, který čte fotky nápojových a jídelních lístků z českých a "
    "slovenských hospod. Z přiložené fotky vytáhni nápoje ve čtyřech kategoriích: "
    "beer = točená, lahvová a plechovková piva včetně kategorie nealkoholická piva; "
    "patří sem i radlery a pivní mixy; soft_drink = nealkoholické nápoje jako voda, limonáda, Kofola, "
    "džus, káva nebo čaj (NE nealkoholické pivo); shot = samostatné panáky destilátů "
    "a likérů; wine = víno po skleničce nebo karafě, včetně rozlévaného sektu. "
    "Ignoruj jídlo a celé lahve vína i tvrdého alkoholu. "
    "Vrať STRIKTNĚ validní JSON přesně ve tvaru "
    '{"drinks":[{"drink_type":"beer"|"soft_drink"|"shot"|"wine",'
    '"name":<string>,"price_czk":<integer nebo null>,'
    '"volume_ml":<integer nebo null>}]}. '
    "Cena je celé číslo v korunách, nebo null, když není čitelná. "
    "Objem je celé číslo v mililitrech (např. 500, 400, 330, 300), nebo null. "
    "Když je u jednoho piva více objemů a cen (např. 0,3 l / 0,5 l), vrať "
    "přednostně půllitr 500 ml a jeho cenu. Pokud půllitr není uveden, vrať "
    "jasně spárovaný objem a cenu, včetně běžných 0,4 l sklenic jako 400 ml. "
    "Nehádej nečitelná jména, ceny ani objemy; nejasné hodnoty dej jako null. "
    "U panáků správně převáděj 0,02/0,04/0,05 l na 20/40/50 ml. "
    "U vína převáděj 0,1/0,15/0,2 l na 100/150/200 ml. "
    "Maximálně 24 nápojů, piva upřednostni. Nevracej nic jiného než tento JSON."
)


# ---------------------------------------------------------------------------
# Public exceptions (mirror mapy.py:111-121)
# ---------------------------------------------------------------------------


class OpenRouterDailyCapExceededError(RuntimeError):
    """Raised when the process-wide daily OpenRouter request cap is exhausted."""


class OpenRouterUnavailableError(RuntimeError):
    """Raised when OpenRouter is unreachable, errors out, or the key is unset.

    The view turns this into a 503 ``vision_unavailable`` so the feature degrades
    gracefully instead of 500-ing.
    """


# ---------------------------------------------------------------------------
# Daily-cap counter (process-wide, resets at midnight UTC) — shared DailyCounter
# ---------------------------------------------------------------------------

_global_counter = DailyCounter()


# ---------------------------------------------------------------------------
# Response parsing helpers
# ---------------------------------------------------------------------------


def _strip_code_fences(text: str) -> str:
    """Strip a leading ```json / ``` fence and trailing ``` from model output."""
    if not isinstance(text, str):
        return ""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped[3:]
        # An optional language hint immediately follows the opening fence.
        match = re.match(r"^[a-zA-Z0-9]+\s*\n", stripped)
        if match:
            stripped = stripped[match.end() :]
        if stripped.rstrip().endswith("```"):
            stripped = stripped.rstrip()[:-3]
    return stripped.strip()


def _content_of(data: dict) -> str:
    """Pull the assistant text out of an OpenAI-style chat-completion body."""
    choices = data.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    # Some providers return content as a list of typed parts.
    if isinstance(content, list):
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return ""


def _parse_drinks(content: str) -> list[dict]:
    """Parse model output, accepting both the new and legacy JSON shape.

    Tolerates markdown code fences. On any unparseable output returns an empty
    list (the caller must NOT 500 on a bad model response).
    """
    text = _strip_code_fences(content)
    if not text:
        return []
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return []
    if isinstance(data, dict):
        drinks = data.get("drinks")
        if not isinstance(drinks, list):
            drinks = data.get("beers")
    elif isinstance(data, list):
        drinks = data
    else:
        drinks = None
    if not isinstance(drinks, list):
        return []
    return [drink for drink in drinks if isinstance(drink, dict)]


# ---------------------------------------------------------------------------
# OpenRouterVisionSource
# ---------------------------------------------------------------------------


class OpenRouterVisionSource:
    """
    Extract a beer list from a JPEG menu photo via an OpenRouter vision model.

    Parameters
    ----------
    api_key : str
        OpenRouter API key (settings.OPENROUTER_API_KEY). Required — an empty key
        raises :class:`OpenRouterUnavailableError` on use.
    model : str
        Chat-completions model id (settings.OPENROUTER_MODEL).
    session : requests.Session | None
        Supply a pre-configured session (e.g. a mocked adapter in tests). If None,
        a plain session is created and owned by this instance.
    timeout : int
        Per-request HTTP timeout in seconds.
    daily_cap : int
        Hard cap on chat requests per UTC calendar day, counted across the whole
        process.
    """

    def __init__(
        self,
        api_key: str,
        model: str = _DEFAULT_MODEL,
        session: requests.Session | None = None,
        timeout: int = _DEFAULT_TIMEOUT,
        daily_cap: int = _DEFAULT_DAILY_CAP,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout
        self._daily_cap = daily_cap

        if session is not None:
            self._session = session
            self._owns_session = False
        else:
            self._session = requests.Session()
            self._owns_session = True

    @property
    def model(self) -> str:
        return self._model

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _check_cap(self) -> None:
        if not _global_counter.increment_and_check(self._daily_cap):
            raise OpenRouterDailyCapExceededError(
                f"openrouter: daily request cap of {self._daily_cap} exceeded — "
                "not making further requests today."
            )

    def _request(self, headers: dict, payload: dict) -> requests.Response:
        try:
            return self._session.post(
                _CHAT_URL, json=payload, headers=headers, timeout=self._timeout
            )
        except requests.RequestException as exc:
            # Do not include response bodies / payloads in the message.
            raise OpenRouterUnavailableError("openrouter request failed") from exc

    def _post_chat(self, payload: dict) -> str:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": _APP_URL,
            "X-Title": _APP_TITLE,
        }

        self._check_cap()
        resp = self._request(headers, payload)
        if resp.status_code == 429 or resp.status_code >= 500:
            logger.warning(
                "openrouter: chat returned retryable HTTP %d — retrying once",
                resp.status_code,
            )
            # The retried request also counts against the daily cap.
            self._check_cap()
            resp = self._request(headers, payload)

        try:
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise OpenRouterUnavailableError(
                f"openrouter: chat HTTP {resp.status_code}"
            ) from exc

        try:
            data = resp.json()
        except ValueError as exc:
            raise OpenRouterUnavailableError("openrouter: non-JSON response body") from exc

        return _content_of(data)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract_drinks(self, jpeg_bytes: bytes) -> list[dict]:
        """Send a JPEG menu photo to the model; return categorized drink dicts.

        Each dict contains ``drink_type`` / ``name`` / ``price_czk`` /
        ``volume_ml`` exactly as returned (the caller validates and bounds it).

        Raises
        ------
        OpenRouterUnavailableError
            The key is unset or the request failed / errored.
        OpenRouterDailyCapExceededError
            The process-wide daily request cap was hit.
        """
        if not self._api_key:
            raise OpenRouterUnavailableError("openrouter: API key not configured")

        started = datetime.now(tz=UTC)
        b64 = base64.b64encode(jpeg_bytes).decode("ascii")
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                        },
                    ],
                }
            ],
            # Ask for a JSON object; we ALSO parse defensively if the model wraps
            # it in prose / fences.
            "response_format": {"type": "json_object"},
            "temperature": 0,
            # Bound worst-case output cost (the daily cap counts requests only).
            "max_tokens": _MAX_OUTPUT_TOKENS,
            # Deterministic strict-JSON OCR gains nothing from reasoning; disabling
            # it avoids billed "thinking" tokens (Gemini reasons by default).
            "reasoning": {"enabled": False},
            # Privacy: only route to providers that do NOT log/train on the
            # request — a menu photo can incidentally contain faces, handwriting,
            # or other PII (see AGENTS.md on conservative image/PII handling).
            "provider": {"data_collection": "deny"},
        }

        content = self._post_chat(payload)
        drinks = _parse_drinks(content)
        duration_ms = round((datetime.now(tz=UTC) - started).total_seconds() * 1000)
        # Privacy: log counts/durations only — never the key, image, or raw text.
        logger.info(
            "openrouter: menu scan extracted %d drinks in %d ms (model=%s)",
            len(drinks),
            duration_ms,
            self._model,
        )
        return drinks

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    def __enter__(self) -> OpenRouterVisionSource:
        return self

    def __exit__(self, *_: object) -> None:
        if self._owns_session:
            self._session.close()
