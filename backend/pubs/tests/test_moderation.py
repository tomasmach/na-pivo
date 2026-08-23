"""Contract tests for pubs.moderation.

moderate_ugc sends exactly one POST to the fixed OpenAI /v1/moderations
endpoint per call and never closes an injected session. Callers with nothing
to moderate skip the helper entirely: empty/whitespace-only total input fails
closed as sanitized invalid_input, never auto-approves. Texts are stripped,
joined with newlines and capped at 32000 chars including the separators;
images are bounded-read (max 10 MiB + 1 byte, one read), rejected by
len/nbytes before any copy, decoded via PIL with decompression-bomb guards,
EXIF-transposed and re-encoded to a max-edge-1024 WebP data URL. The whole
Pillow boundary sanitizes every ordinary Exception. Every failure path (bad
config, bad image/text/empty input, provider or network error) fails closed
with ModerationUnavailableError carrying only the sanitized message, and
emits exactly one privacy-safe structured log record.
"""

from __future__ import annotations

import base64
import contextlib
import io
import json
import logging

import pytest
import requests as requests_lib
from django.test import override_settings
from PIL import Image

from pubs.moderation import (
    ModerationOutcome,
    ModerationResult,
    ModerationSurface,
    ModerationUnavailableError,
    moderate_ugc,
)

URL = "https://api.openai.com/v1/moderations"
KEY = "sentinel-secret-key"
SURFACE = next(iter(ModerationSurface))


class FakeResponse:
    def __init__(self, payload=None, status_code=200, json_error=None):
        self.payload = payload
        self.status_code = status_code
        self.json_error = json_error

    def json(self):
        if self.json_error is not None:
            raise self.json_error
        return self.payload


class FakeSession:
    def __init__(self, response=None, post_error=None):
        self.response = response
        self.post_error = post_error
        self.calls = []
        self.closed = False

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "body": json, "headers": headers, "timeout": timeout})
        if self.post_error is not None:
            raise self.post_error
        return self.response

    def close(self):
        self.closed = True


def approved_response(flagged=False):
    return FakeResponse({"results": [{"flagged": flagged}]})


def run(session, *, texts=(), image=None):
    return moderate_ugc(surface=SURFACE, texts=texts, image=image, session=session)


SANITIZED = "Content moderation is temporarily unavailable."


def assert_sanitized(excinfo):
    assert str(excinfo.value) == SANITIZED
    assert excinfo.value.__cause__ is None
    assert excinfo.value.__context__ is None


@pytest.fixture(autouse=True)
def moderation_settings(settings):
    settings.OPENAI_MODERATION_API_KEY = KEY
    settings.OPENAI_MODERATION_MODEL = "omni-moderation-latest"
    settings.OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS = 2
    settings.OPENAI_MODERATION_READ_TIMEOUT_SECONDS = 5


class TestTextModeration:
    def test_empty_total_input_fails_closed_without_http(self, caplog):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, texts=("   ",))
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_input")

    def test_whitespace_only_texts_with_no_image_fail_closed(self, caplog):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, texts=("", "  ", "\t\n"))
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_input")

    def test_call_with_nothing_at_all_fails_closed_without_http(self):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError):
            run(s)
        assert s.calls == []

    def test_single_post_contract(self):
        s = FakeSession(approved_response())
        out = run(s, texts=("  jedno pivo  ",))
        [call] = s.calls
        assert call["url"] == URL
        assert call["headers"]["Authorization"] == f"Bearer {KEY}"
        assert call["timeout"] == (2.0, 5.0)
        assert call["body"]["model"] == "omni-moderation-latest"
        assert call["body"]["input"] == "jedno pivo"
        assert out.outcome is ModerationOutcome.APPROVED

    def test_flagged_text_is_rejected(self):
        s = FakeSession(approved_response(flagged=True))
        out = run(s, texts=("spam",))
        assert out.outcome is ModerationOutcome.REJECTED


class TestModerationResultContract:
    def test_result_is_frozen_dataclass(self):
        import dataclasses

        assert dataclasses.is_dataclass(ModerationResult)
        result = ModerationResult(outcome=ModerationOutcome.APPROVED)
        with pytest.raises(Exception):
            result.outcome = ModerationOutcome.REJECTED


class TestFailures:
    @pytest.mark.parametrize("status_code", [400, 401, 429, 500, 503])
    def test_http_errors_are_sanitized(self, status_code):
        s = FakeSession(FakeResponse(status_code=status_code))
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, texts=("pivo",))
        assert len(s.calls) == 1
        assert KEY not in str(excinfo.value)
        assert excinfo.value.__cause__ is None
        assert excinfo.value.__context__ is None

    @pytest.mark.parametrize(
        "response",
        [
            FakeResponse(json_error=ValueError("bad json")),
            FakeResponse(payload={}),
            FakeResponse(payload={"results": []}),
            FakeResponse(payload={"results": [{}]}),
            FakeResponse(payload={"results": [{"flagged": "yes"}]}),
        ],
        ids=["bad-json", "empty-obj", "no-results", "no-flagged", "non-bool"],
    )
    def test_malformed_payloads_are_unavailable(self, response):
        s = FakeSession(response)
        with pytest.raises(ModerationUnavailableError):
            run(s, texts=("pivo",))
        assert len(s.calls) == 1

    def test_injected_session_is_not_closed(self):
        s = FakeSession(approved_response())
        run(s, texts=("pivo",))
        assert s.closed is False


def _timeout_bad_values():
    return [
        ("none", None),
        ("nan", float("nan")),
        ("inf", float("inf")),
        ("-inf", float("-inf")),
        ("zero", 0),
        ("negative", -1),
        ("malformed-string", "soon"),
        ("bool-true", True),
        ("bool-false", False),
    ]


def _config_failure_cases():
    cases = [
        ("key-none", {"OPENAI_MODERATION_API_KEY": None}),
        ("key-empty", {"OPENAI_MODERATION_API_KEY": ""}),
        ("key-whitespace", {"OPENAI_MODERATION_API_KEY": "   "}),
        ("key-whitespace-mixed", {"OPENAI_MODERATION_API_KEY": " \t\n "}),
        ("model-none", {"OPENAI_MODERATION_MODEL": None}),
        ("model-empty", {"OPENAI_MODERATION_MODEL": ""}),
        ("model-wrong", {"OPENAI_MODERATION_MODEL": "gpt-4o"}),
        ("model-case-variant", {"OPENAI_MODERATION_MODEL": "Omni-Moderation-Latest"}),
    ]
    for setting_name, label in (
        ("OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS", "connect-timeout"),
        ("OPENAI_MODERATION_READ_TIMEOUT_SECONDS", "read-timeout"),
    ):
        for value_id, value in _timeout_bad_values():
            cases.append((f"{label}-{value_id}", {setting_name: value}))
    return cases


_CONFIG_FAILURE_PARAMS = [
    pytest.param(overrides, id=case_id) for case_id, overrides in _config_failure_cases()
]


class TestConfigGuards:
    def test_bad_config_fails_before_http_and_before_owned_session(self, monkeypatch):
        def forbidden_session(*args, **kwargs):
            raise AssertionError("requests.Session must not be constructed")

        monkeypatch.setattr(requests_lib, "Session", forbidden_session)
        for _case_id, overrides in _config_failure_cases():
            merged = {"OPENAI_MODERATION_API_KEY": KEY, **overrides}
            with override_settings(**merged):
                with pytest.raises(ModerationUnavailableError) as excinfo:
                    moderate_ugc(surface=SURFACE, texts=("pivo",), session=None)
            assert_sanitized(excinfo)

    @pytest.mark.parametrize("overrides", _CONFIG_FAILURE_PARAMS)
    def test_bad_config_never_reaches_http(self, overrides):
        s = FakeSession(approved_response())
        merged = {"OPENAI_MODERATION_API_KEY": KEY, **overrides}
        with override_settings(**merged):
            with pytest.raises(ModerationUnavailableError) as excinfo:
                run(s, texts=("pivo",))
        assert s.calls == []
        assert_sanitized(excinfo)

    @pytest.mark.parametrize("overrides", _CONFIG_FAILURE_PARAMS)
    def test_bad_config_stays_sanitized_with_debug_true(self, overrides):
        s = FakeSession(approved_response())
        merged = {"OPENAI_MODERATION_API_KEY": KEY, **overrides, "DEBUG": True}
        with override_settings(**merged):
            with pytest.raises(ModerationUnavailableError) as excinfo:
                run(s, texts=("pivo",))
        assert s.calls == []
        assert_sanitized(excinfo)

    @pytest.mark.parametrize("padding", ["  ", "\t", " \n\t "])
    def test_key_surrounding_whitespace_is_stripped_for_authorization(self, padding):
        s = FakeSession(approved_response())
        with override_settings(OPENAI_MODERATION_API_KEY=f"{padding}{KEY}{padding}"):
            out = run(s, texts=("pivo",))
        [call] = s.calls
        assert call["headers"]["Authorization"] == f"Bearer {KEY}"
        assert KEY + padding[:1] not in call["headers"]["Authorization"]
        assert out.outcome is ModerationOutcome.APPROVED


class TestLimits:
    def test_overlong_text_is_refused_without_http(self):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, texts=("a" * 32001,))
        assert s.calls == []
        assert_sanitized(excinfo)

    def test_exactly_32000_chars_including_separators_is_accepted(self):
        s = FakeSession(approved_response())
        out = run(s, texts=("x" * 16000, "y" * 15999))
        assert out.outcome is ModerationOutcome.APPROVED
        assert len(s.calls[0]["body"]["input"]) == 32000

    def test_newline_separators_count_toward_the_32000_cap(self):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, texts=("x" * 16000, "y" * 16000))
        assert s.calls == []
        assert_sanitized(excinfo)


class TestSurfaceContract:
    def test_exactly_22_surfaces(self):
        expected = {
            "pub_name_correction",
            "user_pub",
            "pub_community",
            "pub_amenity_vote",
            "friend_pub_activity",
            "published_night",
            "published_night_comment",
            "community_event",
            "community_event_join",
            "community_event_team",
            "pub_event",
            "account_profile",
            "account_avatar",
            "auth_profile",
            "drink_publication",
            "beer_checkin",
            "beer_photo",
            "photo_contest_entry",
            "party_evening",
            "party_drink",
            "party_game",
            "party_event",
        }
        assert {m.value for m in ModerationSurface} == expected
        assert len(ModerationSurface) == 22


class _HostileSurface:
    def __repr__(self):
        return PROVIDER_BODY_SENTINEL

    def __str__(self):
        return PROVIDER_BODY_SENTINEL


class TestInvalidSurface:
    def test_non_surface_value_fails_closed_with_single_privacy_safe_log(self, caplog):
        s = FakeSession(approved_response())
        with caplog.at_level(logging.DEBUG, logger="pubs.moderation"):
            with pytest.raises(ModerationUnavailableError) as excinfo:
                moderate_ugc(surface=_HostileSurface(), texts=(TEXT_SENTINEL,), session=s)
        assert s.calls == []
        assert_sanitized(excinfo)
        records = [r for r in caplog.records if r.name == "pubs.moderation"]
        assert len(records) == 1
        record = records[0]
        obs = record.observability
        assert obs["surface"] == "invalid"
        assert obs["outcome"] == "unavailable"
        assert obs["failure_kind"] == "invalid_surface"
        assert isinstance(obs["latency_ms"], int) and not isinstance(obs["latency_ms"], bool)
        assert set(obs) == {"surface", "outcome", "latency_ms", "failure_kind"}
        blob = "\n".join([record.getMessage(), repr(record.args), repr(record.__dict__), caplog.text])
        for secret in (TEXT_SENTINEL, PROVIDER_BODY_SENTINEL, IMAGE_SENTINEL, KEY):
            as_text = secret if isinstance(secret, str) else secret.decode("utf-8", "backslashreplace")
            assert as_text not in blob
            assert repr(secret) not in blob

    @pytest.mark.parametrize("bad_surface", [None, 123, "pub_community", b"user_pub"], ids=["none", "int", "str", "bytes"])
    def test_other_invalid_surfaces_stay_sanitized_without_http(self, bad_surface):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            moderate_ugc(surface=bad_surface, texts=("pivo",), session=s)
        assert s.calls == []
        assert_sanitized(excinfo)


class TestTextValidation:
    def test_multiple_texts_are_stripped_and_joined(self):
        s = FakeSession(approved_response())
        out = run(s, texts=("  jedno pivo  ", "\tdvě piva\n", "", "   "))
        assert s.calls[0]["body"]["input"] == "jedno pivo\ndvě piva"
        assert out.outcome is ModerationOutcome.APPROVED

    @pytest.mark.parametrize("bad", [123, None, b"pivo", ["pivo"]], ids=["int", "none", "bytes", "list"])
    def test_non_string_text_is_refused_without_http(self, bad):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, texts=(bad,))
        assert s.calls == []
        assert_sanitized(excinfo)


class TestTimeoutGuards:
    bad_values = [None, float("nan"), float("inf"), float("-inf"), 0, -1]
    ids = ["none", "nan", "inf", "-inf", "zero", "negative"]

    @pytest.mark.parametrize("value", bad_values, ids=ids)
    def test_bad_connect_timeout_fails_closed_without_http(self, value):
        s = FakeSession(approved_response())
        with override_settings(OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=value):
            with pytest.raises(ModerationUnavailableError) as excinfo:
                run(s, texts=("pivo",))
        assert s.calls == []
        assert_sanitized(excinfo)

    @pytest.mark.parametrize("value", bad_values, ids=ids)
    def test_bad_read_timeout_fails_closed_without_http(self, value):
        s = FakeSession(approved_response())
        with override_settings(OPENAI_MODERATION_READ_TIMEOUT_SECONDS=value):
            with pytest.raises(ModerationUnavailableError) as excinfo:
                run(s, texts=("pivo",))
        assert s.calls == []
        assert_sanitized(excinfo)

    @pytest.mark.parametrize("value", [10.5, 11], ids=["over-max-float", "over-max-int"])
    def test_connect_timeout_over_maximum_fails_closed_without_http(self, value):
        s = FakeSession(approved_response())
        with override_settings(OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=value):
            with pytest.raises(ModerationUnavailableError) as excinfo:
                run(s, texts=("pivo",))
        assert s.calls == []
        assert_sanitized(excinfo)

    @pytest.mark.parametrize("value", [30.5, 31], ids=["over-max-float", "over-max-int"])
    def test_read_timeout_over_maximum_fails_closed_without_http(self, value):
        s = FakeSession(approved_response())
        with override_settings(OPENAI_MODERATION_READ_TIMEOUT_SECONDS=value):
            with pytest.raises(ModerationUnavailableError) as excinfo:
                run(s, texts=("pivo",))
        assert s.calls == []
        assert_sanitized(excinfo)


class TestDebugModeStillFailsClosed:
    @pytest.mark.parametrize("status_code", [401, 500])
    def test_debug_true_keeps_sanitized_error(self, status_code):
        s = FakeSession(FakeResponse(status_code=status_code))
        with override_settings(DEBUG=True):
            with pytest.raises(ModerationUnavailableError) as excinfo:
                run(s, texts=("pivo",))
        assert_sanitized(excinfo)


class TestHttpStatusCodeContract:
    @pytest.mark.parametrize("status_code", [200, 201, 204])
    def test_any_2xx_with_valid_body_is_approved(self, status_code):
        s = FakeSession(FakeResponse({"results": [{"flagged": False}]}, status_code=status_code))
        out = run(s, texts=("pivo",))
        assert out.outcome is ModerationOutcome.APPROVED


class TestResponseShapeContract:
    @pytest.mark.parametrize(
        "payload",
        [
            [{"flagged": False}],
            {"results": [{"flagged": False}, {"flagged": True}]},
            {"results": ["not-a-dict"]},
            {"results": [{"flagged": 0}]},
            {"results": [{"flagged": 1}]},
            {"results": [{"flagged": "false"}]},
            {"results": [{"flagged": None}]},
        ],
        ids=["top-level-list", "two-results", "entry-non-dict", "flagged-0", "flagged-1", "flagged-str", "flagged-none"],
    )
    def test_invalid_shapes_are_unavailable(self, payload):
        s = FakeSession(FakeResponse(payload))
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, texts=("pivo",))
        assert len(s.calls) == 1
        assert_sanitized(excinfo)


class TestOwnedSessionLifecycle:
    def _run_owned(self, monkeypatch, session):
        monkeypatch.setattr(requests_lib, "Session", lambda: session)
        return moderate_ugc(surface=SURFACE, texts=("pivo",), session=None)

    def test_owned_session_closes_on_approved(self, monkeypatch):
        s = FakeSession(approved_response())
        self._run_owned(monkeypatch, s)
        assert s.closed is True

    def test_owned_session_closes_on_connection_error(self, monkeypatch):
        s = FakeSession(post_error=requests_lib.ConnectionError("boom"))
        with pytest.raises(ModerationUnavailableError) as excinfo:
            self._run_owned(monkeypatch, s)
        assert s.closed is True
        assert_sanitized(excinfo)

    def test_owned_session_closes_on_non_2xx(self, monkeypatch):
        s = FakeSession(FakeResponse(status_code=503))
        with pytest.raises(ModerationUnavailableError):
            self._run_owned(monkeypatch, s)
        assert s.closed is True

    def test_owned_session_closes_on_invalid_json(self, monkeypatch):
        s = FakeSession(FakeResponse(json_error=ValueError("bad json")))
        with pytest.raises(ModerationUnavailableError):
            self._run_owned(monkeypatch, s)
        assert s.closed is True


def _png(width, height):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (200, 60, 20)).save(buf, format="PNG")
    return buf.getvalue()


def _data_url(body):
    raw = json.dumps(body)
    marker = "data:image/webp;base64,"
    start = raw.index(marker)
    end = raw.index('"', start)
    return raw[start:end]


_MAX_IMAGE_BYTES = 10 * 1024 * 1024


def _jpeg(width, height, *, orientation=None):
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), (200, 60, 20))
    if orientation is not None:
        exif = Image.Exif()
        exif[274] = orientation
        img.save(buf, format="JPEG", exif=exif)
    else:
        img.save(buf, format="JPEG")
    return buf.getvalue()


def _jpeg_with_claimed_dims(jpeg_bytes, width, height):
    """Rewrite the SOF0 header so PIL reports huge dims without pixel data."""
    raw = bytearray(jpeg_bytes)
    sof = raw.index(b"\xff\xc0")
    offset = sof + 5  # marker(2) + segment length(2) + precision(1)
    raw[offset : offset + 2] = height.to_bytes(2, "big")
    raw[offset + 2 : offset + 4] = width.to_bytes(2, "big")
    return bytes(raw)


def _over_50mp_header_jpeg():
    return _jpeg_with_claimed_dims(_jpeg(16, 16), 9000, 9000)


class RecordingStream:
    def __init__(self, data):
        self._buf = io.BytesIO(data)
        self.read_sizes = []

    def read(self, n=-1):
        self.read_sizes.append(n)
        return self._buf.read(n)


class TestImageRequestShape:
    def test_image_only_input_is_exactly_one_image_url_part(self):
        s = FakeSession(approved_response())
        run(s, image=_png(64, 32))
        parts = s.calls[0]["body"]["input"]
        assert isinstance(parts, list)
        assert len(parts) == 1
        [part] = parts
        assert part["type"] == "image_url"
        assert part["image_url"]["url"].startswith("data:image/webp;base64,")

    def test_text_plus_image_input_is_text_then_image_url_parts(self):
        s = FakeSession(approved_response())
        run(s, texts=("jedno pivo",), image=_png(64, 32))
        parts = s.calls[0]["body"]["input"]
        assert isinstance(parts, list)
        assert [p["type"] for p in parts] == ["text", "image_url"]
        assert parts[0] == {"type": "text", "text": "jedno pivo"}
        assert parts[1]["image_url"]["url"].startswith("data:image/webp;base64,")


class TestImageInputTypes:
    @pytest.mark.parametrize("cast", [bytes, bytearray, memoryview], ids=["bytes", "bytearray", "memoryview"])
    def test_binary_types_are_accepted(self, cast):
        s = FakeSession(approved_response())
        out = run(s, image=cast(_png(64, 32)))
        assert out.outcome is ModerationOutcome.APPROVED
        assert len(s.calls) == 1

    def test_binary_stream_read_exactly_max_plus_one(self):
        s = FakeSession(approved_response())
        stream = RecordingStream(_png(64, 32))
        out = run(s, image=stream)
        assert out.outcome is ModerationOutcome.APPROVED
        assert stream.read_sizes == [_MAX_IMAGE_BYTES + 1]

    def test_unseekable_stream_with_valid_png_fails_closed_without_http(self, caplog):
        class UnseekableStream:
            def __init__(self, data):
                self._buf = io.BytesIO(data)
                self.read_sizes = []

            def seek(self, pos):
                raise OSError("unseekable")

            def read(self, n=-1):
                self.read_sizes.append(n)
                return self._buf.read(n)

        s = FakeSession(approved_response())
        stream = UnseekableStream(_png(64, 32))
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=stream)
        assert stream.read_sizes == []
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")

    @pytest.mark.parametrize(
        "cast",
        [bytes, bytearray, memoryview],
        ids=["bytes", "bytearray", "memoryview"],
    )
    @pytest.mark.parametrize(
        "blob",
        [b"", b"not-an-image"],
        ids=["empty", "corrupt"],
    )
    def test_bad_images_of_any_type_never_reach_http_and_stay_sanitized(self, cast, blob):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=cast(blob))
        assert s.calls == []
        assert_sanitized(excinfo)

    def test_oversize_stream_never_reaches_http(self):
        s = FakeSession(approved_response())
        stream = RecordingStream(b"\0" * (_MAX_IMAGE_BYTES + 1))
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=stream)
        assert stream.read_sizes == [_MAX_IMAGE_BYTES + 1]
        assert s.calls == []
        assert_sanitized(excinfo)


class TestDecodeGuard:
    def test_over_50mp_header_rejected_without_decoding_pixels(self, monkeypatch):
        real_open = Image.open
        load_calls = []

        def spying_open(fp, *args, **kwargs):
            img = real_open(fp, *args, **kwargs)
            original_load = img.load

            def counted_load():
                load_calls.append(True)
                return original_load()

            img.load = counted_load
            return img

        monkeypatch.setattr("pubs.moderation.Image.open", spying_open)
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=_over_50mp_header_jpeg())
        assert load_calls == []
        assert s.calls == []
        assert_sanitized(excinfo)

    def test_pil_max_image_pixels_never_mutated_on_success_or_failure(self):
        sentinel = Image.MAX_IMAGE_PIXELS
        s = FakeSession(approved_response())
        blobs = {
            "success": _png(64, 32),
            "empty": b"",
            "corrupt": b"not-an-image",
            "over-50mp-header": _over_50mp_header_jpeg(),
            "oversize": b"\0" * (_MAX_IMAGE_BYTES + 1),
        }
        try:
            for blob in blobs.values():
                with contextlib.suppress(Exception):
                    run(s, image=blob)
        finally:
            assert Image.MAX_IMAGE_PIXELS == sentinel


class TestExifOrientation:
    def test_orientation_6_jpeg_transposed_to_webp_without_crop_or_upscale(self):
        s = FakeSession(approved_response())
        out = run(s, image=_jpeg(800, 400, orientation=6))
        header, b64 = _data_url(s.calls[0]["body"]).split(",", 1)
        assert header == "data:image/webp;base64"
        img = Image.open(io.BytesIO(base64.b64decode(b64)))
        width, height = img.size
        assert img.format == "WEBP"
        assert img.mode == "RGB"
        assert height > width  # landscape source became portrait
        assert max(width, height) <= 1024
        assert (width / height) == pytest.approx(400 / 800)  # aspect kept, no crop
        assert max(width, height) <= max(800, 400)  # no upscale
        for key in ("exif", "comment", "icc_profile"):
            assert key not in img.info
        assert out.outcome is ModerationOutcome.APPROVED


class TestImages:
    def test_image_normalized_to_webp_data_url_max_edge_1024(self):
        s = FakeSession(approved_response())
        out = run(s, image=_png(2048, 1024))
        header, b64 = _data_url(s.calls[0]["body"]).split(",", 1)
        assert header == "data:image/webp;base64"
        img = Image.open(io.BytesIO(base64.b64decode(b64)))
        assert img.format == "WEBP"
        assert img.size == (1024, 512)
        assert out.outcome is ModerationOutcome.APPROVED

    @pytest.mark.parametrize(
        "blob",
        [b"", b"not-an-image", _png(8, 8) + b"\0" * (10 * 1024 * 1024)],
        ids=["empty", "corrupt", "oversized"],
    )
    def test_bad_images_never_reach_http(self, blob):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError):
            run(s, image=blob)
        assert s.calls == []


def test_key_never_leaks_into_logs(caplog):
    s = FakeSession(FakeResponse(status_code=401))
    with override_settings(OPENAI_MODERATION_API_KEY=KEY):
        with caplog.at_level(logging.DEBUG):
            with pytest.raises(ModerationUnavailableError):
                run(s, texts=("pivo",))
    assert KEY not in caplog.text


TEXT_SENTINEL = "sentinel-text-⚠"
IMAGE_SENTINEL = b"SENTINEL_IMAGE_BYTES\x00\xff"
PROVIDER_BODY_SENTINEL = "sentinel-provider-body"
CATEGORIES_SENTINEL = "sentinel-categories"
_OK_IMAGE_SENTINEL = _png(64, 32)

_SECRETS = (
    KEY,
    TEXT_SENTINEL,
    IMAGE_SENTINEL,
    PROVIDER_BODY_SENTINEL,
    CATEGORIES_SENTINEL,
    _OK_IMAGE_SENTINEL,
)

ALLOWED_FAILURE_KINDS = frozenset(
    {"network_error", "invalid_response", "config", "invalid_image", "invalid_text", "invalid_input", "invalid_surface"}
)


def _provider_body(flagged):
    return {
        "results": [
            {
                "flagged": flagged,
                "categories": {"harassment": CATEGORIES_SENTINEL},
                "note": PROVIDER_BODY_SENTINEL,
            }
        ]
    }


def _case_empty_input_unavailable():
    return FakeSession(approved_response()), {}, {}


def _case_provider_approved():
    return FakeSession(FakeResponse(_provider_body(False))), {"texts": (TEXT_SENTINEL,)}, {}


def _case_provider_rejected():
    return FakeSession(FakeResponse(_provider_body(True))), {"texts": (TEXT_SENTINEL,)}, {}


def _case_provider_approved_sentinel_image_and_text():
    return (
        FakeSession(FakeResponse(_provider_body(False))),
        {"texts": (TEXT_SENTINEL,), "image": _OK_IMAGE_SENTINEL},
        {},
    )


def _case_connection_error():
    return (
        FakeSession(post_error=requests_lib.ConnectionError(f"{PROVIDER_BODY_SENTINEL} refused")),
        {"texts": (TEXT_SENTINEL,)},
        {},
    )


def _case_http_401_sentinel_payload():
    payload = {"error": {"message": PROVIDER_BODY_SENTINEL, "categories": CATEGORIES_SENTINEL}}
    return FakeSession(FakeResponse(payload, status_code=401)), {"texts": (TEXT_SENTINEL,), "image": _OK_IMAGE_SENTINEL}, {}


def _case_invalid_json():
    return FakeSession(FakeResponse(json_error=ValueError(PROVIDER_BODY_SENTINEL))), {"texts": (TEXT_SENTINEL,)}, {}


def _case_invalid_shape():
    return (
        FakeSession(FakeResponse({"results": [{"flagged": "false"}]})),
        {"texts": (TEXT_SENTINEL,)},
        {},
    )


def _case_missing_key_config():
    return FakeSession(approved_response()), {"texts": (TEXT_SENTINEL,)}, {"OPENAI_MODERATION_API_KEY": None}


def _case_invalid_image():
    return FakeSession(approved_response()), {"image": IMAGE_SENTINEL}, {}


def _case_overlong_text():
    return FakeSession(approved_response()), {"texts": (TEXT_SENTINEL * 4000,)}, {}


_PRIVACY_CASES = [
    (_case_empty_input_unavailable, "unavailable", ("failure_kind", "invalid_input")),
    (_case_provider_approved, "approved", ("status_code", 200)),
    (_case_provider_rejected, "rejected", ("status_code", 200)),
    (
        _case_provider_approved_sentinel_image_and_text,
        "approved",
        ("status_code", 200),
    ),
    (_case_connection_error, "unavailable", ("failure_kind", "network_error")),
    (_case_http_401_sentinel_payload, "unavailable", ("status_code", 401)),
    (_case_invalid_json, "unavailable", ("failure_kind", "invalid_response")),
    (_case_invalid_shape, "unavailable", ("failure_kind", "invalid_response")),
    (_case_missing_key_config, "unavailable", ("failure_kind", "config")),
    (_case_invalid_image, "unavailable", ("failure_kind", "invalid_image")),
    (_case_overlong_text, "unavailable", ("failure_kind", "invalid_text")),
]


class TestPrivacyLogContract:
    @pytest.mark.parametrize(
        ("prepare", "outcome", "extra"),
        [pytest.param(p, o, e, id=p.__name__.removeprefix("_case_")) for p, o, e in _PRIVACY_CASES],
    )
    def test_exactly_one_sanitized_record(self, caplog, prepare, outcome, extra):
        session, call_kwargs, setting_overrides = prepare()
        with override_settings(**setting_overrides):
            with caplog.at_level(logging.DEBUG, logger="pubs.moderation"):
                with contextlib.suppress(ModerationUnavailableError):
                    run(session, **call_kwargs)

        records = [r for r in caplog.records if r.name == "pubs.moderation"]
        assert len(records) == 1
        record = records[0]

        assert record.getMessage() == "ugc moderation"
        assert record.event == "ugc_moderation"
        assert record.exc_info is None
        assert record.args == ()

        obs = record.observability
        base_keys = {"surface", "outcome", "latency_ms"}
        assert base_keys <= set(obs)
        assert len(obs) - len(base_keys) == 1

        assert obs["surface"] == SURFACE.value
        assert obs["outcome"] == outcome
        assert isinstance(obs["latency_ms"], int) and not isinstance(obs["latency_ms"], bool)
        assert obs["latency_ms"] >= 0

        kind, value = extra
        other = "failure_kind" if kind == "status_code" else "status_code"
        assert other not in obs
        assert obs[kind] == value
        if kind == "status_code":
            assert isinstance(obs["status_code"], int) and not isinstance(obs["status_code"], bool)
        else:
            assert obs["failure_kind"] in ALLOWED_FAILURE_KINDS

        blob = "\n".join([record.getMessage(), repr(record.args), repr(record.__dict__), caplog.text])
        for secret in _SECRETS:
            as_text = secret if isinstance(secret, str) else secret.decode("utf-8", "backslashreplace")
            assert as_text not in blob
            assert repr(secret) not in blob


class _BrokenReadStream:
    def __init__(self, exc):
        self._exc = exc

    def read(self, n=-1):
        raise self._exc

class _BrokenSeekStream:
    def __init__(self, exc):
        self._exc = exc
        self._buf = io.BytesIO(_png(64, 32))
        self.read_sizes = []

    def seek(self, pos):
        raise self._exc

    def read(self, n=-1):
        self.read_sizes.append(n)
        return self._buf.read(n)


class _MissingStatusCodeResponse:
    status_code = None

    def __init__(self, *, with_status=False, value=None):
        if with_status:
            self.status_code = value

    def json(self):
        return {"results": [{"flagged": False}]}


def _assert_single_invalid_log(caplog, failure_kind):
    records = [r for r in caplog.records if r.name == "pubs.moderation"]
    assert len(records) == 1
    assert records[0].observability["failure_kind"] == failure_kind


class TestBrokenImageInputs:
    @pytest.mark.parametrize(
        "image",
        [
            object(),
            _BrokenReadStream(AttributeError("no read result")),
            _BrokenReadStream(TypeError("bad read arg")),
        ],
        ids=["bare-object", "read-attribute-error", "read-type-error"],
    )
    def test_unusable_stream_is_sanitized_invalid_image_without_http(self, caplog, image):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=image)
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")

    @pytest.mark.parametrize(
        "stream",
        [
            _BrokenSeekStream(AttributeError("seek broke")),
            _BrokenSeekStream(TypeError("seek broke")),
        ],
        ids=["seek-attribute-error", "seek-type-error"],
    )
    def test_failing_seek_is_sanitized_invalid_image_without_http(self, caplog, stream):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=stream)
        assert stream.read_sizes == []
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")

    def test_failing_read_runtime_error_never_escapes_raw(self, caplog):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=_BrokenReadStream(RuntimeError(f"read broke {PROVIDER_BODY_SENTINEL}")))
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")
        assert PROVIDER_BODY_SENTINEL not in caplog.text

    def test_failing_seek_runtime_error_never_escapes_raw(self, caplog):
        stream = _BrokenSeekStream(RuntimeError(f"seek broke {PROVIDER_BODY_SENTINEL}"))
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=stream)
        assert stream.read_sizes == []
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")
        assert PROVIDER_BODY_SENTINEL not in caplog.text


class TestPillowBoundarySanitizesEveryOrdinaryException:
    @pytest.mark.parametrize(
        ("exc", "exc_id"),
        [
            (EOFError("truncated image"), "eof-error"),
            (RuntimeError("decoder exploded"), "runtime-error"),
        ],
    )
    def test_open_failure_is_sanitized_invalid_image(self, monkeypatch, caplog, exc, exc_id):
        def failing_open(fp, *args, **kwargs):
            raise exc

        monkeypatch.setattr("pubs.moderation.Image.open", failing_open)
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=_png(64, 32))
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")

    def test_transpose_failure_is_sanitized_invalid_image(self, monkeypatch, caplog):
        def failing_transpose(image):
            raise RuntimeError("transpose exploded")

        monkeypatch.setattr("pubs.moderation.ImageOps.exif_transpose", failing_transpose)
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=_png(64, 32))
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")

    def test_save_failure_is_sanitized_invalid_image(self, monkeypatch, caplog):
        blob = _png(64, 32)

        def failing_save(*args, **kwargs):
            raise RuntimeError("webp encoder exploded")

        monkeypatch.setattr(Image.Image, "save", failing_save)
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=blob)
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")

    def test_keyboard_interrupt_is_never_swallowed(self, monkeypatch, caplog):
        def interrupting_open(fp, *args, **kwargs):
            raise KeyboardInterrupt

        monkeypatch.setattr("pubs.moderation.Image.open", interrupting_open)
        s = FakeSession(approved_response())
        with pytest.raises(KeyboardInterrupt):
            run(s, image=_png(64, 32))
        assert s.calls == []


class TestOversizeBinaryRejectedBeforeCopy:
    @pytest.mark.parametrize("cast", [bytearray, memoryview], ids=["bytearray", "memoryview"])
    def test_oversized_binary_never_reaches_pil_or_http(self, monkeypatch, caplog, cast):
        def forbidden_open(fp, *args, **kwargs):
            raise AssertionError("PIL must not be reached for oversized input")

        monkeypatch.setattr("pubs.moderation.Image.open", forbidden_open)
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=cast(bytearray(b"\0" * (_MAX_IMAGE_BYTES + 1))))
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")


class TestDecompressionBombGuards:
    @pytest.mark.parametrize(
        ("id_suffix", "bomb_exc"),
        [
            ("warning", Image.DecompressionBombWarning("too many pixels")),
            ("error", Image.DecompressionBombError("too many pixels")),
        ],
    )
    def test_pil_bomb_exceptions_are_sanitized_invalid_image(self, monkeypatch, caplog, id_suffix, bomb_exc):
        def bombing_open(fp, *args, **kwargs):
            raise bomb_exc

        monkeypatch.setattr("pubs.moderation.Image.open", bombing_open)
        sentinel = Image.MAX_IMAGE_PIXELS
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, image=_png(64, 32))
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_image")
        assert Image.MAX_IMAGE_PIXELS == sentinel


class TestNonIterableTexts:
    @pytest.mark.parametrize("bad_texts", [None, 123], ids=["none", "int"])
    def test_non_iterable_texts_are_sanitized_invalid_text_without_http(self, caplog, bad_texts):
        s = FakeSession(approved_response())
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, texts=bad_texts)
        assert s.calls == []
        assert_sanitized(excinfo)
        _assert_single_invalid_log(caplog, "invalid_text")


class TestSessionConstructorFailure:
    def test_session_constructor_connection_error_is_sanitized_network_error(self, monkeypatch, caplog):
        def broken_session(*args, **kwargs):
            raise requests_lib.ConnectionError(f"{PROVIDER_BODY_SENTINEL} refused")

        monkeypatch.setattr(requests_lib, "Session", broken_session)
        with pytest.raises(ModerationUnavailableError) as excinfo:
            moderate_ugc(surface=SURFACE, texts=("pivo",), session=None)
        assert_sanitized(excinfo)
        records = [r for r in caplog.records if r.name == "pubs.moderation"]
        assert len(records) == 1
        assert records[0].observability["failure_kind"] == "network_error"


class TestBadStatusCodeAttribute:
    @pytest.mark.parametrize(
        "response",
        [
            _MissingStatusCodeResponse(),
            _MissingStatusCodeResponse(with_status=True, value=None),
            _MissingStatusCodeResponse(with_status=True, value="soon"),
        ],
        ids=["missing-status", "none-status", "text-status"],
    )
    def test_missing_or_non_numeric_status_code_is_sanitized_without_raw_error(self, response):
        s = FakeSession(response)
        with pytest.raises(ModerationUnavailableError) as excinfo:
            run(s, texts=("pivo",))
        assert len(s.calls) == 1
        assert_sanitized(excinfo)


_PROVIDER_FAILURE_FACTORIES = [
    ("connection-error", lambda: FakeSession(post_error=requests_lib.ConnectionError("refused"))),
    ("http-500", lambda: FakeSession(FakeResponse(status_code=500))),
    ("invalid-json", lambda: FakeSession(FakeResponse(json_error=ValueError("bad json")))),
    ("invalid-shape", lambda: FakeSession(FakeResponse({"results": []}))),
    ("bad-status-attr", lambda: FakeSession(_MissingStatusCodeResponse())),
]


class TestInjectedSessionNeverClosedOnProviderFailure:
    @pytest.mark.parametrize(
        ("case_id", "make_session"),
        [pytest.param(cid, fac, id=cid) for cid, fac in _PROVIDER_FAILURE_FACTORIES],
    )
    def test_injected_session_stays_open_on_every_provider_failure(self, case_id, make_session):
        s = make_session()
        with contextlib.suppress(ModerationUnavailableError):
            run(s, texts=("pivo",))
        assert s.closed is False
