"""SVG helpers for the measure theory figures.

Line art and text use currentColor, so figures follow the reader's light or
dark theme. The accent colours are mid-tones that read on either background.
"""
import math

INK = "currentColor"
BLUE = "#3b82f6"
ORANGE = "#e8892b"
GREEN = "#2e9e5b"
RED = "#d9534f"
PURPLE = "#8e5bd0"


def _num(v):
    return ("%.1f" % v).rstrip("0").rstrip(".")


def svg_doc(w, h, body, aria):
    return ('<svg viewBox="0 0 %d %d" width="100%%" style="max-width:%dpx" role="img" aria-label="%s" '
            'xmlns="http://www.w3.org/2000/svg" font-family="serif">\n%s\n</svg>'
            % (w, h, w, aria, "\n".join(body) if isinstance(body, list) else body))


def line(x1, y1, x2, y2, color=INK, width=1.5, dash=None, opacity=None):
    extra = ""
    if dash:
        extra += ' stroke-dasharray="%s"' % dash
    if opacity is not None:
        extra += ' stroke-opacity="%.2f"' % opacity
    return '<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="%.1f"%s/>' % (
        _num(x1), _num(y1), _num(x2), _num(y2), color, width, extra)


def polyline(pts, color=INK, width=1.8, dash=None, opacity=None):
    extra = ""
    if dash:
        extra += ' stroke-dasharray="%s"' % dash
    if opacity is not None:
        extra += ' stroke-opacity="%.2f"' % opacity
    d = " ".join("%s,%s" % (_num(x), _num(y)) for x, y in pts)
    return ('<polyline points="%s" fill="none" stroke="%s" stroke-width="%.1f" '
            'stroke-linejoin="round" stroke-linecap="round"%s/>' % (d, color, width, extra))


def polygon(pts, fill, opacity=0.25, stroke="none", width=1.0):
    d = " ".join("%s,%s" % (_num(x), _num(y)) for x, y in pts)
    return '<polygon points="%s" fill="%s" fill-opacity="%.2f" stroke="%s" stroke-width="%.1f"/>' % (
        d, fill, opacity, stroke, width)


def rect(x, y, w, h, fill="none", opacity=1.0, stroke=INK, width=1.2, rx=0):
    return ('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="%s" fill-opacity="%.2f" '
            'stroke="%s" stroke-width="%.1f"/>' % (_num(x), _num(y), _num(w), _num(h), _num(rx),
                                                   fill, opacity, stroke, width))


def circle(x, y, r, fill=INK, stroke="none", width=1.2, opacity=1.0):
    return '<circle cx="%s" cy="%s" r="%s" fill="%s" fill-opacity="%.2f" stroke="%s" stroke-width="%.1f"/>' % (
        _num(x), _num(y), _num(r), fill, opacity, stroke, width)


def text(x, y, s, size=14, anchor="middle", italic=False, color=INK, weight=None):
    st = ' font-style="italic"' if italic else ""
    if weight:
        st += ' font-weight="%s"' % weight
    return '<text x="%s" y="%s" font-size="%d" text-anchor="%s" fill="%s"%s>%s</text>' % (
        _num(x), _num(y), size, anchor, color, st, s)


def arrow(x1, y1, x2, y2, color=INK, width=1.5, head=8, dash=None):
    """A straight arrow with a filled head at (x2, y2)."""
    ang = math.atan2(y2 - y1, x2 - x1)
    bx, by = x2 - head * math.cos(ang), y2 - head * math.sin(ang)
    l = (bx - head * 0.45 * math.sin(ang), by + head * 0.45 * math.cos(ang))
    r = (bx + head * 0.45 * math.sin(ang), by - head * 0.45 * math.cos(ang))
    return (line(x1, y1, bx, by, color, width, dash) +
            polygon([(x2, y2), l, r], color, opacity=1.0))


def curved_arrow(x1, y1, x2, y2, bend, color=INK, width=1.5, head=8):
    """Quadratic arc from (x1,y1) to (x2,y2); bend is the control point's offset
    perpendicular to the chord (positive = to the left of the direction of travel)."""
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy) or 1
    cx, cy = mx - bend * dy / n, my + bend * dx / n
    ang = math.atan2(y2 - cy, x2 - cx)
    bx, by = x2 - head * math.cos(ang), y2 - head * math.sin(ang)
    l = (bx - head * 0.45 * math.sin(ang), by + head * 0.45 * math.cos(ang))
    r = (bx + head * 0.45 * math.sin(ang), by - head * 0.45 * math.cos(ang))
    return ('<path d="M %s %s Q %s %s %s %s" fill="none" stroke="%s" stroke-width="%.1f"/>'
            % (_num(x1), _num(y1), _num(cx), _num(cy), _num(bx), _num(by), color, width) +
            polygon([(x2, y2), l, r], color, opacity=1.0))


class Axes:
    """Maps data coordinates in [x0, x1] x [y0, y1] to a pixel box."""

    def __init__(self, left, top, width, height, xr, yr):
        self.left, self.top, self.w, self.h = left, top, width, height
        self.x0, self.x1 = xr
        self.y0, self.y1 = yr

    def px(self, x, y):
        X = self.left + (x - self.x0) / (self.x1 - self.x0) * self.w
        Y = self.top + self.h - (y - self.y0) / (self.y1 - self.y0) * self.h
        return X, Y

    def X(self, x):
        return self.px(x, self.y0)[0]

    def Y(self, y):
        return self.px(self.x0, y)[1]

    def pts(self, xy):
        return [self.px(x, y) for x, y in xy]

    def frame(self, xlabel=None, ylabel=None, arrows=True):
        out = []
        bl = (self.left, self.top + self.h)
        if arrows:
            out.append(arrow(bl[0], bl[1], self.left + self.w + 10, bl[1], width=1.2, head=7))
            out.append(arrow(bl[0], bl[1], bl[0], self.top - 10, width=1.2, head=7))
        else:
            out.append(line(bl[0], bl[1], self.left + self.w, bl[1], width=1.2))
            out.append(line(bl[0], bl[1], bl[0], self.top, width=1.2))
        if xlabel:
            out.append(text(self.left + self.w + 14, bl[1] + 5, xlabel, 15, "start", italic=True))
        if ylabel:
            out.append(text(self.left, self.top - 16, ylabel, 15, "middle", italic=True))
        return out

    def xtick(self, x, label=None, size=13, italic=False):
        X, Y = self.px(x, self.y0)
        out = [line(X, Y, X, Y + 5, width=1.1)]
        if label is not None:
            out.append(text(X, Y + 19, label, size, italic=italic))
        return out

    def ytick(self, y, label=None, size=13, italic=False):
        X, Y = self.px(self.x0, y)
        out = [line(X - 5, Y, X, Y, width=1.1)]
        if label is not None:
            out.append(text(X - 8, Y + 4, label, size, "end", italic=italic))
        return out


def sample(f, a, b, n=300):
    return [(a + (b - a) * i / n, f(a + (b - a) * i / n)) for i in range(n + 1)]
