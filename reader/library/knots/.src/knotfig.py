"""Knot-diagram figures for the knots library.

A knot is given as a dense 3D polyline. It is projected to the xy-plane
(the viewer looks down the z-axis, larger z is nearer), the crossings of the
projection are found, and the under-strand is broken at each one. The pieces
between breaks are the arcs of the diagram, so they can be coloured, and the
crossings carry enough data to compute signs and Fox colourings.

Run:  python3 knotfig.py  -> writes figures into ../figures/*.svg
"""
import math
import os
from itertools import product

INK = "#222"
COLORS = ["#c0392b", "#2a6fdb", "#2e9e5b", "#d4a017", "#8e44ad"]


def sample(f, n=900, t0=0.0, t1=2 * math.pi, closed=True):
    m = n if closed else n + 1
    return [f(t0 + (t1 - t0) * i / n) for i in range(m)]


def torus_knot(p, q, n=900, R=2.0, r=1.0):
    def f(t):
        rr = R + r * math.cos(q * t)
        return (rr * math.cos(p * t), rr * math.sin(p * t), -r * math.sin(q * t))
    return sample(f, n)


def trefoil(n=900, mirror=False):
    s = -1 if mirror else 1
    return sample(lambda t: (math.sin(t) + 2 * math.sin(2 * t),
                             math.cos(t) - 2 * math.cos(2 * t),
                             -s * math.sin(3 * t)), n)


def figure_eight(n=900):
    return sample(lambda t: ((2 + math.cos(2 * t)) * math.cos(3 * t),
                             (2 + math.cos(2 * t)) * math.sin(3 * t),
                             math.sin(4 * t)), n)


def circle(cx=0.0, cy=0.0, r=1.0, n=300, z=lambda t: 0.0, phase=0.0):
    return sample(lambda t: (cx + r * math.cos(t + phase), cy + r * math.sin(t + phase), z(t)), n)


def seg_intersect(a, b, c, d):
    """2D intersection of segments ab and cd; returns (u, v) parameters or None."""
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-12:
        return None
    qx, qy = c[0] - a[0], c[1] - a[1]
    u = (qx * sy - qy * sx) / den
    v = (qx * ry - qy * rx) / den
    if 0 <= u < 1 and 0 <= v < 1:
        return u, v
    return None


class Diagram:
    """Projection of one or more components, with crossings and arcs.

    components: list of 3D point lists. closed: per component.
    flip: set of crossing indices whose over/under is swapped.
    """

    def __init__(self, components, closed=None, flip=()):
        self.comps = components
        self.closed = closed or [True] * len(components)
        segs = []
        for ci, pts in enumerate(components):
            n = len(pts)
            m = n if self.closed[ci] else n - 1
            for i in range(m):
                segs.append((ci, i, pts[i], pts[(i + 1) % n]))
        # cumulative 2D arclength at each vertex, per component
        self.cum = []
        for ci, pts in enumerate(components):
            c = [0.0]
            n = len(pts)
            m = n if self.closed[ci] else n - 1
            for i in range(m):
                a, b = pts[i], pts[(i + 1) % n]
                c.append(c[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
            self.cum.append(c)
        crossings = []
        # bucket segments on a grid for speed
        grid = {}
        cell = 0.25
        for k, (ci, i, a, b) in enumerate(segs):
            for gx in range(int(math.floor(min(a[0], b[0]) / cell)), int(math.floor(max(a[0], b[0]) / cell)) + 1):
                for gy in range(int(math.floor(min(a[1], b[1]) / cell)), int(math.floor(max(a[1], b[1]) / cell)) + 1):
                    grid.setdefault((gx, gy), []).append(k)
        seen = set()
        for bucket in grid.values():
            for x in range(len(bucket)):
                for y in range(x + 1, len(bucket)):
                    k1, k2 = bucket[x], bucket[y]
                    if (k1, k2) in seen:
                        continue
                    seen.add((k1, k2))
                    c1, i1, a, b = segs[k1]
                    c2, i2, c, d = segs[k2]
                    if c1 == c2:
                        n = len(components[c1])
                        if abs(i1 - i2) <= 1 or (self.closed[c1] and abs(i1 - i2) == n - 1):
                            continue
                    r = seg_intersect(a, b, c, d)
                    if not r:
                        continue
                    u, v = r
                    z1 = a[2] + u * (b[2] - a[2])
                    z2 = c[2] + v * (d[2] - c[2])
                    s1 = self.cum[c1][i1] + u * (self.cum[c1][i1 + 1] - self.cum[c1][i1])
                    s2 = self.cum[c2][i2] + v * (self.cum[c2][i2 + 1] - self.cum[c2][i2])
                    d1 = (b[0] - a[0], b[1] - a[1])
                    d2 = (d[0] - c[0], d[1] - c[1])
                    pt = (a[0] + u * d1[0], a[1] + u * d1[1])
                    one = (c1, s1, d1)
                    two = (c2, s2, d2)
                    over, under = (one, two) if z1 > z2 else (two, one)
                    crossings.append({"pt": pt, "over": over, "under": under})
        crossings.sort(key=lambda c: (c["pt"][0], c["pt"][1]))
        for k in flip:
            c = crossings[k]
            c["over"], c["under"] = c["under"], c["over"]
        for c in crossings:
            o, u = c["over"][2], c["under"][2]
            c["sign"] = 1 if o[0] * u[1] - o[1] * u[0] > 0 else -1
        self.crossings = crossings

    def writhe(self):
        return sum(c["sign"] for c in self.crossings)

    def linking(self, a=0, b=1):
        tot = sum(c["sign"] for c in self.crossings
                  if {c["over"][0], c["under"][0]} == {a, b})
        return tot // 2

    # ---- arcs -------------------------------------------------------------
    def pieces(self, gap):
        """Per component: list of (s0, s1) arclength intervals that are drawn.
        For a closed component the pieces are arcs of the diagram (over-arcs
        running from one under-crossing to the next)."""
        out = []
        for ci in range(len(self.comps)):
            L = self.cum[ci][-1]
            cuts = sorted(c["under"][1] for c in self.crossings if c["under"][0] == ci)
            if not cuts:
                out.append([(0.0, L)])
                continue
            if self.closed[ci]:
                ivs = []
                for j, s in enumerate(cuts):
                    t = cuts[(j + 1) % len(cuts)]
                    if t <= s:
                        t += L
                    ivs.append((s + gap, t - gap))
                out.append(ivs)
            else:
                ivs = []
                prev = 0.0
                for s in cuts:
                    ivs.append((prev, s - gap))
                    prev = s + gap
                ivs.append((prev, L))
                out.append(ivs)
        return out

    def point_at(self, ci, s):
        pts, cum = self.comps[ci], self.cum[ci]
        L = cum[-1]
        if self.closed[ci]:
            s %= L
        lo, hi = 0, len(cum) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        n = len(pts)
        a, b = pts[lo % n], pts[(lo + 1) % n]
        seg = cum[lo + 1] - cum[lo] or 1
        u = (s - cum[lo]) / seg
        return (a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]))

    def arc_of(self, ci, s, ivs, L):
        for k, (a, b) in enumerate(ivs):
            for shift in (0, L, -L):
                if a <= s + shift <= b:
                    return k
        return None

    def fox(self, n):
        """All Fox n-colourings of a one-component closed diagram (arc labels)."""
        ivs = self.pieces(1e-9)[0]
        L = self.cum[0][-1]
        rel = []
        for c in self.crossings:
            o = self.arc_of(0, c["over"][1], ivs, L)
            s = c["under"][1]
            u1 = self.arc_of(0, s - 1e-6, ivs, L)
            u2 = self.arc_of(0, s + 1e-6, ivs, L)
            rel.append((o, u1, u2))
        sols = []
        for col in product(range(n), repeat=len(ivs)):
            if all((2 * col[o] - col[a] - col[b]) % n == 0 for o, a, b in rel):
                sols.append(col)
        return sols, rel


# ---- SVG output -------------------------------------------------------------
class Panel:
    def __init__(self, diagram, x, y, w, h, gap=7.0, pad=8, width=3.2, frame=None):
        self.d = diagram
        src = frame.comps if frame else diagram.comps
        xs = [p[0] for c in src for p in c]
        ys = [p[1] for c in src for p in c]
        sx = (w - 2 * pad) / (max(xs) - min(xs))
        sy = (h - 2 * pad) / (max(ys) - min(ys))
        self.k = min(sx, sy)
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        self.tx = lambda p: (x + w / 2 + (p[0] - cx) * self.k, y + h / 2 - (p[1] - cy) * self.k)
        self.gap = gap / self.k  # gap is given in pixels, stored in curve units
        self.width = width

    def path(self, ci, a, b, step=None):
        step = step or 2.5 / self.k  # about one vertex per 2.5 px
        n = max(2, int((b - a) / step))
        pts = [self.tx(self.d.point_at(ci, a + (b - a) * i / n)) for i in range(n + 1)]
        return "M" + " L".join("%.1f,%.1f" % p for p in pts)

    def svg(self, colors=None, stroke=INK, shadow=False, arrows=None, dots=False):
        """colors: per component, list of colours per arc (or one colour).
        shadow: draw the projection with no breaks.
        arrows: per component, list of arclength fractions to put an arrowhead."""
        out = []
        if shadow:
            for ci in range(len(self.d.comps)):
                out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%.1f" stroke-linejoin="round"/>'
                           % (self.path(ci, 0, self.d.cum[ci][-1]), stroke, self.width))
            if dots:
                for c in self.d.crossings:
                    p = self.tx(c["pt"])
                    out.append('<circle cx="%.1f" cy="%.1f" r="4.5" fill="#e8892b"/>' % p)
            return "\n".join(out)
        allp = self.d.pieces(self.gap)
        for ci, ivs in enumerate(allp):
            for k, (a, b) in enumerate(ivs):
                col = stroke
                if colors:
                    cc = colors[ci]
                    col = cc[k % len(cc)] if isinstance(cc, list) else cc
                out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%.1f" stroke-linecap="round" stroke-linejoin="round"/>'
                           % (self.path(ci, a, b), col, self.width))
        if arrows:
            for ci, fr in enumerate(arrows):
                for f in fr or []:
                    out.append(self.arrow(ci, f * self.d.cum[ci][-1],
                                          stroke if not colors else (colors[ci] if isinstance(colors[ci], str) else stroke)))
        return "\n".join(out)

    def arrow(self, ci, s, col, size=9):
        p = self.tx(self.d.point_at(ci, s))
        q = self.tx(self.d.point_at(ci, s + 0.05))
        ang = math.atan2(q[1] - p[1], q[0] - p[0])
        tip = (p[0] + size * 0.6 * math.cos(ang), p[1] + size * 0.6 * math.sin(ang))
        l = (tip[0] - size * math.cos(ang - 0.45), tip[1] - size * math.sin(ang - 0.45))
        r = (tip[0] - size * math.cos(ang + 0.45), tip[1] - size * math.sin(ang + 0.45))
        return '<path d="M%.1f,%.1f L%.1f,%.1f L%.1f,%.1f z" fill="%s"/>' % (tip + l + r + (col,))


def label(x, y, text, size=14, anchor="middle", italic=False, color=INK):
    st = ' font-style="italic"' if italic else ""
    return '<text x="%.1f" y="%.1f" font-size="%d" text-anchor="%s" fill="%s"%s>%s</text>' % (
        x, y, size, anchor, color, st, text)


def svg_doc(w, h, body, aria):
    return ('<svg viewBox="0 0 %d %d" width="100%%" style="max-width:%dpx" role="img" aria-label="%s" '
            'xmlns="http://www.w3.org/2000/svg" font-family="serif">\n%s\n</svg>' % (w, h, w, aria, body))
