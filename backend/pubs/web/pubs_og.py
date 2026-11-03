"""Share image of one pub page, 1200 × 630, drawn with the same helpers as /ceny and /pivo."""

from __future__ import annotations

from io import BytesIO

from django.utils import formats, translation
from django.utils.translation import gettext
from PIL import Image, ImageDraw

from pubs.price_map import _FOAM, _FOAM_MUTED, _GROUND, _HAIR, _MUTED, _fitted, _font
from pubs.web.words import plural

_YELLOW = (255, 196, 0)




def _figures(data: dict) -> list[tuple[str, str]]:
    """Up to three (value, label) pairs; a missing number gives way to the next one."""

    figures = []
    if data["price"]:
        figures.append((f"{data['price']} {gettext('Kč')}", data["price_beer"] or gettext("nejlevnější pivo")))
    if data["tank"]:
        figures.append((gettext("tankové"), gettext("čepují")))
    if data["week_beers"]:
        count = data["week_beers"]
        figures.append((str(count), plural(count, gettext("pivo minulý týden"), gettext("piva minulý týden"), gettext("piv minulý týden"))))
    if data["beers"]:
        count = data["beers"]
        figures.append((str(count), plural(count, gettext("pivo na lístku"), gettext("piva na lístku"), gettext("piv na lístku"))))
    return figures[:3]


def render_pub_og(data: dict) -> bytes:
    image = Image.new("RGB", (1200, 630), _GROUND)
    draw = ImageDraw.Draw(image)
    with translation.override(data["lang"]):
        draw.text((64, 92), "Na pivo", font=_font("ExtraBold", 40), fill=_FOAM, anchor="ls")
        draw.text(
            (1136, 92), data["address"], font=_fitted(draw, data["address"], "SemiBold", 26, 640),
            fill=_MUTED, anchor="rs",
        )

        name_width = 1072
        if data["rating"]:
            rating = formats.number_format(data["rating"], 1)
            draw.text((1136, 360), rating, font=_font("ExtraBold", 150), fill=_YELLOW, anchor="rs")
            draw.text((1136, 400), gettext("hodnocení piv"), font=_font("SemiBold", 28), fill=_FOAM_MUTED, anchor="rs")
            name_width = 1072 - int(draw.textlength(rating, font=_font("ExtraBold", 150))) - 48
        if data["place"]:
            draw.text((64, 250), data["place"], font=_fitted(draw, data["place"], "SemiBold", 34, name_width), fill=_FOAM_MUTED, anchor="ls")
        draw.text((64, 360), data["name"], font=_fitted(draw, data["name"], "ExtraBold", 96, name_width), fill=_FOAM, anchor="ls")

        figures = _figures(data)
        if figures:
            draw.line((64, 470, 1136, 470), fill=_HAIR, width=2)
            for index, (value, label) in enumerate(figures):
                x = 64 + index * 360
                draw.text((x, 540), value, font=_fitted(draw, value, "ExtraBold", 52, 320), fill=_FOAM, anchor="ls")
                draw.text((x, 580), label, font=_fitted(draw, label, "SemiBold", 26, 320), fill=_MUTED, anchor="ls")
        else:
            text = gettext("Co tu čepují a kolik to stojí, ti řekne Na pivo.")
            draw.text((64, 560), text, font=_fitted(draw, text, "SemiBold", 32, 1072), fill=_FOAM_MUTED, anchor="ls")

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
