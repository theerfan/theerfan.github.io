"""Build the knots chapters: fill <!--fig:NAME--> markers in *.tmpl with SVG.

python3 build.py   (from any directory)
"""
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from knotfig import (INK, COLORS, Diagram, Panel, label, svg_doc, trefoil,
                     figure_eight, torus_knot, circle, sample)

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.dirname(HERE)
ORANGE = "#e8892b"


def rotate(pts, ang, dx=0.0, dy=0.0, s=1.0):
    c, n = math.cos(ang), math.sin(ang)
    return [(s * (c * x - n * y) + dx, s * (n * x + c * y) + dy, z) for x, y, z in pts]


def line3(a, b, n=60):
    return [tuple(a[k] + (b[k] - a[k]) * i / n for k in range(3)) for i in range(n + 1)]


def arrow_glyph(x, y, text="⟷", size=24):
    return label(x, y, text, size=size)


# ---- figures ----------------------------------------------------------------
def fig_zoo():
    w, h = 640, 190
    items = [
        ([circle()], "0₁", "unknot"),
        ([trefoil(mirror=True)], "3₁", "trefoil"),
        ([figure_eight()], "4₁", "figure-eight"),
        ([torus_knot(2, 5)], "5₁", "cinquefoil"),
    ]
    body = []
    for i, (comps, name, word) in enumerate(items):
        x = i * 160
        p = Panel(Diagram(comps), x + 10, 5, 140, 140)
        body.append(p.svg())
        body.append(label(x + 80, 168, name, 16))
        body.append(label(x + 80, 185, word, 13, italic=True))
    return svg_doc(w, h, "\n".join(body),
                   "Diagrams of the four simplest knots: the unknot (a circle), the trefoil with three crossings, "
                   "the figure-eight knot with four, and the cinquefoil with five.")


def fig_shadow():
    w, h = 640, 195
    t = trefoil(mirror=True)
    panels = [
        (Diagram([t]), dict(shadow=True, dots=True), "shadow"),
        (Diagram([t]), {}, "right-handed trefoil"),
        (Diagram([trefoil()]), {}, "left-handed trefoil"),
        (Diagram([t], flip=[0]), {}, "unknot"),
    ]
    body = []
    for i, (d, kw, cap) in enumerate(panels):
        x = i * 160
        p = Panel(d, x + 12, 5, 136, 150)
        body.append(p.svg(**kw))
        body.append(label(x + 80, 180, cap, 13, italic=(i == 0)))
    return svg_doc(w, h, "\n".join(body),
                   "A projection with three double points, and three of the eight ways to choose which strand "
                   "goes over at each: the two alternating choices give the right- and left-handed trefoils, "
                   "and changing a single crossing gives a diagram of the unknot.")


def r1_strands():
    def cubic(s):
        return (s * s - 1, s ** 3 - s, s)
    core = [cubic(-1.32 + 2.64 * i / 400) for i in range(401)]
    top = line3((0.74, 2.0, 1.32), core[-1], 30)
    top = [(x, y, z) for x, y, z in top]
    a = line3((0.74, -2.0, -1.32), core[0], 30)
    before = a + core[1:] + list(reversed(top))[1:]
    after = line3((0.74, -2.0, 0), (0.74, 2.0, 0), 200)
    return before, after


def r2_strands(sep):
    ys = [-1.6 + 3.2 * i / 300 for i in range(301)]
    bump = lambda y: math.exp(-y * y / 0.35)
    a = [(-0.55 + sep * bump(y), y, 1.0) for y in ys]
    b = [(0.55 - sep * bump(y), y, 0.0) for y in ys]
    return [a, b]


def r3_strands(cy):
    a = line3((-1.0, -1.0, 2.0), (1.0, 1.0, 2.0), 200)
    b = line3((1.0, -1.0, 1.0), (-1.0, 1.0, 1.0), 200)
    c = line3((-1.25, cy, 0.0), (1.25, cy, 0.0), 200)
    return [a, b, c]


def fig_reidemeister():
    w, h = 640, 400
    body = []
    colw = 213
    gap = 8.0
    r1b, r1a = r1_strands()
    cols = [
        ("I", Diagram([r1b], closed=[False]), Diagram([r1a], closed=[False]),
         "add or remove a kink"),
        ("II", Diagram(r2_strands(0.95), closed=[False, False]),
         Diagram(r2_strands(0.0), closed=[False, False]), "slide one strand over another"),
        ("III", Diagram(r3_strands(-0.55), closed=[False] * 3),
         Diagram(r3_strands(0.55), closed=[False] * 3), "move a strand past a crossing"),
    ]
    for i, (name, before, after, cap) in enumerate(cols):
        x = i * colw
        body.append(label(x + colw / 2, 22, name, 18))
        # fix scale per column using a common frame so before/after match
        for j, d in enumerate((before, after)):
            y0 = 34 + j * 182
            p = Panel(d, x + 40, y0, colw - 80, 150, gap=gap, frame=before)
            body.append(p.svg())
        body.append(label(x + colw / 2, 207, "⇅", 24))
        body.append(label(x + colw / 2, 395, cap, 13, italic=True))
    return svg_doc(w, h, "\n".join(body),
                   "The three Reidemeister moves. I: a strand with a small kink equals a straight strand. "
                   "II: two strands overlapping with two crossings equal two separate strands. "
                   "III: a strand passing under a crossing can be slid to the other side of it.")


def fig_tricolour():
    w, h = 640, 215
    body = []
    t = rotate(trefoil(mirror=True), 0)
    p = Panel(Diagram([t]), 10, 10, 190, 175, width=4)
    body.append(p.svg(colors=[[COLORS[0], COLORS[1], COLORS[2]]]))
    body.append(label(105, 208, "a 3-colouring of the trefoil", 13, italic=True))

    def crossing(x, cols, cap):
        a = line3((-1, -1, 1), (1, 1, 1), 50)
        b = line3((1, -1, 0), (-1, 1, 0), 50)
        q = Panel(Diagram([a, b], closed=[False, False]), x, 45, 110, 110, gap=9.0, width=4)
        out = []
        # over strand one colour, the two halves of the under strand their own
        ivs = q.d.pieces(q.gap)
        out.append('<path d="%s" fill="none" stroke="%s" stroke-width="4" stroke-linecap="round"/>'
                   % (q.path(0, *ivs[0][0]), cols[0]))
        out.append('<path d="%s" fill="none" stroke="%s" stroke-width="4" stroke-linecap="round"/>'
                   % (q.path(1, *ivs[1][0]), cols[1]))
        out.append('<path d="%s" fill="none" stroke="%s" stroke-width="4" stroke-linecap="round"/>'
                   % (q.path(1, *ivs[1][1]), cols[2]))
        out.append(label(x + 55, 190, cap, 13, italic=True))
        return "\n".join(out)

    body.append(crossing(250, [COLORS[0]] * 3, "all three the same"))
    body.append(crossing(410, [COLORS[0], COLORS[1], COLORS[2]], "all three different"))
    body.append(label(445, 30, "allowed at every crossing:", 13))
    return svg_doc(w, h, "\n".join(body),
                   "Left: the trefoil with its three arcs coloured red, blue and green, so each crossing sees all "
                   "three colours. Right: the two patterns allowed at a crossing, all one colour or all different.")


def arc_labels(panel, values, offset=15, size=15):
    d = panel.d
    ivs = d.pieces(panel.gap)[0]
    pts = [panel.tx(p) for p in d.comps[0]]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    out = []
    for k, (a, b) in enumerate(ivs):
        best = None
        # place the label at the point of the arc farthest from the centre
        for i in range(1, 20):
            s = a + (b - a) * i / 20
            q = panel.tx(d.point_at(0, s))
            r = math.hypot(q[0] - cx, q[1] - cy)
            if best is None or r > best[0]:
                best = (r, q)
        r, q = best
        ux, uy = (q[0] - cx) / r, (q[1] - cy) / r
        out.append(label(q[0] + ux * offset, q[1] + uy * offset + size * 0.35, str(values[k]), size))
    return "\n".join(out)


def fig_fox():
    w, h = 640, 225
    body = []
    d8 = Diagram([figure_eight()])
    sols, rel = d8.fox(5)
    nontriv = [s for s in sols if len(set(s)) > 1]
    col = min(nontriv, key=lambda s: (s[0] != 0, s))
    p = Panel(d8, 40, 25, 220, 165, width=3.4)
    body.append(p.svg())
    body.append(arc_labels(p, col))
    body.append(label(150, 215, "figure-eight, labels mod 5", 13, italic=True))
    dt = Diagram([trefoil(mirror=True)])
    sols3, _ = dt.fox(3)
    col3 = [s for s in sols3 if len(set(s)) > 1][0]
    q = Panel(dt, 380, 25, 200, 165, width=3.4)
    body.append(q.svg())
    body.append(arc_labels(q, col3))
    body.append(label(480, 215, "trefoil, labels mod 3", 13, italic=True))
    return svg_doc(w, h, "\n".join(body),
                   "Fox colourings. The figure-eight knot with its four arcs labelled %s, which satisfies "
                   "2·over = under + under mod 5 at every crossing; the trefoil with arcs labelled %s mod 3."
                   % (", ".join(map(str, col)), ", ".join(map(str, col3)))), col, col3


def fig_signs():
    w, h = 640, 200
    body = []

    def crossing(x, sign, cap):
        a = line3((-1, -1, 1), (1, 1, 1), 50) if sign > 0 else line3((1, -1, 1), (-1, 1, 1), 50)
        b = line3((1, -1, 0), (-1, 1, 0), 50) if sign > 0 else line3((-1, -1, 0), (1, 1, 0), 50)
        d = Diagram([a, b], closed=[False, False])
        assert d.crossings[0]["sign"] == sign
        q = Panel(d, x, 20, 120, 120, gap=9.0, width=3.4)
        out = [q.svg(arrows=[[0.97], [0.97]])]
        out.append(label(x + 60, 168, cap, 15))
        return "\n".join(out)

    body.append(crossing(20, 1, "+1"))
    body.append(crossing(190, -1, "−1"))
    c1 = circle(0, 0, 1, z=lambda t: 0.3 * math.sin(t))
    c2 = circle(1.1, 0, 1, z=lambda t: 0.3 * math.sin(t), phase=math.pi)
    hd = Diagram([c1, c2])
    assert hd.linking() == 1
    q = Panel(hd, 370, 15, 250, 140, width=3.4)
    body.append(q.svg(colors=[COLORS[0], COLORS[1]], arrows=[[0.25], [0.25]]))
    body.append(label(495, 172, "Hopf link, lk = +1", 15))
    body.append(label(495, 192, "both crossings +1", 13, italic=True))
    return svg_doc(w, h, "\n".join(body),
                   "Crossing signs for oriented strands: a positive crossing, where the over-strand runs from "
                   "lower left to upper right with the under-strand going up to the left, and its mirror, "
                   "a negative crossing. Right: an oriented Hopf link whose two crossings are both positive, "
                   "so its linking number is +1.")


def connected_sum(left, right, half=0.55):
    """Join two knots by a band: cut the rightmost arc of `left` and the
    leftmost arc of `right` where they reach height +-half, and connect the
    four ends by two horizontal strands. Both knots should be symmetric
    about the x-axis near the cut."""
    n, m = len(left), len(right)
    i = max(range(n), key=lambda k: left[k][0])
    j = min(range(m), key=lambda k: right[k][0])

    def reach(pts, c, step):
        k = 0
        while abs(pts[(c + k * step) % len(pts)][1]) < half:
            k += 1
        return k

    a, b = reach(left, i, 1), reach(left, i, -1)
    path_l = [left[(i + a + k) % n] for k in range(n - a - b + 1)]  # ends at i - b
    c, d = reach(right, j, -1), reach(right, j, 1)
    e1 = right[(j - c) % m]
    if (e1[1] > 0) == (path_l[-1][1] > 0):
        path_r = [right[(j - c - k) % m] for k in range(m - c - d + 1)]
    else:
        path_r = [right[(j + d + k) % m] for k in range(m - c - d + 1)]
    bridge1 = line3(path_l[-1], path_r[0], 40)[1:-1]
    bridge2 = line3(path_r[-1], path_l[0], 40)[1:-1]
    return path_l + bridge1 + path_r + bridge2


def fig_sum():
    w, h = 640, 330
    L = rotate(trefoil(mirror=True), math.pi / 2, -3.6, 0)
    R = rotate(figure_eight(), 0, 3.6, 0, 0.8)
    body = []
    p = Panel(Diagram([L, R]), 60, 10, 520, 130)
    body.append(p.svg())
    s = connected_sum(L, R)
    d = Diagram([s])
    assert len(d.crossings) == 7, len(d.crossings)
    q = Panel(d, 60, 170, 520, 130, frame=Diagram([L, R]))
    body.append(q.svg())
    body.append(label(320, 160, "cut each open at an outer arc, then join the loose ends in pairs:", 13, italic=True))
    body.append(label(320, 322, "3₁ # 4₁, seven crossings", 13, italic=True))
    return svg_doc(w, h, "\n".join(body),
                   "Connected sum: a trefoil and a figure-eight knot are each cut at an outer arc and the four "
                   "loose ends joined by two parallel strands, giving one knot with seven crossings.")


def build():
    figs = {}
    figs["zoo"] = fig_zoo()
    figs["shadow"] = fig_shadow()
    figs["reidemeister"] = fig_reidemeister()
    figs["tricolour"] = fig_tricolour()
    fox, col, col3 = fig_fox()
    figs["fox"] = fox
    figs["signs"] = fig_signs()
    figs["sum"] = fig_sum()
    out = os.path.join(HERE, "out")
    os.makedirs(out, exist_ok=True)
    for k, v in figs.items():
        with open(os.path.join(out, k + ".svg"), "w") as f:
            f.write(v)
    print("fox labels:", col, col3)
    for name in os.listdir(HERE):
        if not name.endswith(".tmpl"):
            continue
        src = open(os.path.join(HERE, name)).read()
        html = re.sub(r"<!--fig:(\w+)-->", lambda m: figs[m.group(1)], src)
        dst = os.path.join(LIB, name[:-5])
        with open(dst, "w") as f:
            f.write(html)
        print("wrote", dst)


if __name__ == "__main__":
    build()
