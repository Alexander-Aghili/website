"""Shared palette and helpers for the CUDA article animations.

Every scene renders at 1280x720, 30 fps, on the same warm paper background the
article's figures use. Scenes subclass CudaScene, narrate with ``self.say`` and
end with ``self.finish`` so the clips loop cleanly and the poster frame (taken
just before the final fade) shows the completed diagram.
"""
from manim import *

PAPER = "#fbfaf7"
INK = "#26354a"
MUTED = "#6a7a8c"
LINE = "#bac6d1"
IDLE = "#e9edf1"

BLUE = "#4475aa"
BLUE_FILL = "#c4dbf0"
TEAL = "#2f8f75"
TEAL_FILL = "#bce0d4"
CORAL = "#c8603c"
CORAL_FILL = "#f0c2ad"
GOLD = "#c98a1b"
GOLD_FILL = "#f6dfa8"
RED = "#b94a48"
RED_FILL = "#f2c9c7"

SERIF = "Charis SIL"
MONO = "DejaVu Sans Mono"

config.background_color = PAPER


# Pango lays out small text with collapsed spacing, so text is set at 4x and
# scaled down. Always build text through T, code or M.
_OVERSET = 4


def _set(**kw):
    # Manim hands config.pixel_width to Pango as the layout width, so overset
    # text wider than the frame would wrap. Widen it only while laying out.
    saved = config.pixel_width
    config.pixel_width = 40000
    try:
        return Text(**kw).scale(1 / _OVERSET)
    finally:
        config.pixel_width = saved


def T(s, size=24, color=INK, font=SERIF, **kw):
    """Plain text in a serif face with lining numerals."""
    return _set(text=s, font=font, font_size=size * _OVERSET, color=color, **kw)


def code(s, size=18, color=INK):
    """One or more lines of monospace source."""
    return _set(text=s, font=MONO, font_size=size * _OVERSET, color=color, line_spacing=0.8)


def M(tex, size=32, color=INK):
    return MathTex(tex, font_size=size, color=color)


def cell(w=0.5, h=0.5, fill=BLUE_FILL, stroke=LINE, sw=1.2, opacity=1.0):
    return Rectangle(width=w, height=h, fill_color=fill, fill_opacity=opacity,
                     stroke_color=stroke, stroke_width=sw)


def grid(rows, cols, w=0.4, h=0.4, fill=BLUE_FILL, **kw):
    """A rows x cols VGroup of VGroups; index as g[r][c]."""
    g = VGroup(*[VGroup(*[cell(w, h, fill, **kw) for _ in range(cols)]).arrange(RIGHT, buff=0)
                 for _ in range(rows)]).arrange(DOWN, buff=0)
    return g


def chip(label, fill=BLUE_FILL, w=None, h=0.5, size=20, font=SERIF, stroke=LINE, radius=0.08):
    """A rounded box with centred text, sized to the text unless w is given."""
    t = T(label, size, INK, font=font)
    box = RoundedRectangle(width=w or t.width + 0.35, height=h, corner_radius=radius,
                           fill_color=fill, fill_opacity=1, stroke_color=stroke, stroke_width=1.2)
    t.move_to(box)
    return VGroup(box, t)


def valued(box, value, size=18, color=INK, font=SERIF):
    """Text centred on a box; returned separately so values can be swapped."""
    return T(str(value), size, color, font=font).move_to(box)


def arrow(a, b, color=MUTED, sw=2.5, buff=0.08, tip=0.14, **kw):
    return Arrow(a, b, color=color, stroke_width=sw, buff=buff, tip_length=tip,
                 max_tip_length_to_length_ratio=0.35, **kw)


# Z-order pitfall: in one self.play call, an opaque cell introduced by FadeIn can
# be added after (and so drawn over) text introduced by TransformFromCopy. Add
# cells in an earlier play, or call self.add(cells) first.


class CudaScene(Scene):
    """Base scene: a title in the top-left and a narration line at the bottom."""

    title = ""
    subtitle = ""

    def setup(self):
        self._caption = None
        head = T(self.title, 30, INK)
        head.to_corner(UL, buff=0.45)
        parts = [head]
        if self.subtitle:
            sub = T(self.subtitle, 20, MUTED).next_to(head, DOWN, aligned_edge=LEFT, buff=0.12)
            parts.append(sub)
        self.header = VGroup(*parts)

    def intro(self, run_time=0.8):
        self.play(FadeIn(self.header, shift=0.1 * DOWN), run_time=run_time)

    def caption_mob(self, text):
        c = T(text, 22, INK)
        if c.width > 12.6:
            c.scale_to_fit_width(12.6)
        return c.to_edge(DOWN, buff=0.38)

    def say(self, text, run_time=0.6, wait=0.0):
        """Replace the narration line. Returns nothing; plays immediately."""
        new = self.caption_mob(text)
        if self._caption is None:
            self.play(FadeIn(new, shift=0.08 * UP), run_time=run_time)
        else:
            self.play(FadeOut(self._caption, shift=0.08 * UP), FadeIn(new, shift=0.08 * UP), run_time=run_time)
        self._caption = new
        if wait:
            self.wait(wait)

    def finish(self, hold=2.6):
        """Hold the completed diagram (the poster frame), then fade for the loop."""
        self.wait(hold)
        self.play(*[FadeOut(m) for m in self.mobjects], run_time=0.8)
        self.wait(0.3)
