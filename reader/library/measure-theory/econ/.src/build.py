"""Build the measure-theory-for-macro chapters: fill <!--fig:NAME--> markers in
*.tmpl with SVG and write the pages one folder up.

python3 build.py   (from any directory; solving the Aiyagari economy takes a few seconds)
"""
import glob
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from fig import (INK, BLUE, ORANGE, GREEN, RED, PURPLE, Axes, svg_doc, line, polyline,
                 polygon, rect, circle, text, arrow, curved_arrow, sample)
import aiyagari as AI


def wealth(i):
    """The asset holdings a(i) of household i in [0, 1], used in chapters 2-3 and 5."""
    return 1.25 + 0.75 * math.sin(2 * math.pi * 1.3 * i + 0.3) + 0.35 * math.sin(2 * math.pi * 3.4 * i + 1.0)


def runs(xs, pred):
    """Maximal intervals of a sorted sample where pred holds, as (start, end)."""
    out, start = [], None
    for x in xs:
        if pred(x):
            if start is None:
                start = x
            last = x
        elif start is not None:
            out.append((start, last))
            start = None
    if start is not None:
        out.append((start, last))
    return out


# ---- chapter 1 ------------------------------------------------------------
def fig_coins():
    w, h = 640, 215
    body = []
    cells = ["HH", "HT", "TH", "TT"]
    panels = [
        ("ℱ₀: nothing seen", [[0, 1, 2, 3]], [BLUE]),
        ("ℱ₁: first flip seen", [[0, 1], [2, 3]], [BLUE, ORANGE]),
        ("ℱ₂: both flips seen", [[0], [1], [2], [3]], [BLUE, ORANGE, GREEN, PURPLE]),
    ]
    s = 64
    for p, (title, groups, cols) in enumerate(panels):
        x0, y0 = 40 + p * 205, 40
        body.append(text(x0 + s, 24, title, 15))
        pos = {0: (0, 0), 1: (1, 0), 2: (0, 1), 3: (1, 1)}
        for g, col in zip(groups, cols):
            for c in g:
                cx, cy = pos[c]
                body.append(rect(x0 + cx * s, y0 + cy * s, s, s, fill=col, opacity=0.28, stroke="none"))
        for c in range(4):
            cx, cy = pos[c]
            body.append(text(x0 + cx * s + s / 2, y0 + cy * s + s / 2 + 5, cells[c], 15, italic=True))
        # outlines of the cells of the partition
        for g in groups:
            xs = [pos[c][0] for c in g]
            ys = [pos[c][1] for c in g]
            body.append(rect(x0 + min(xs) * s, y0 + min(ys) * s, (max(xs) - min(xs) + 1) * s,
                             (max(ys) - min(ys) + 1) * s, stroke=INK, width=2.0))
        n = 2 ** len(groups)
        body.append(text(x0 + s, y0 + 2 * s + 26, "%d events" % n, 14, italic=True))
        if p < 2:
            body.append(text(x0 + 2 * s + 38, y0 + s + 6, "⊆", 22))
    return svg_doc(w, h, body,
                   "Three squares of four outcomes HH, HT, TH, TT. Left: one block, nothing is known. "
                   "Middle: two blocks, rows split by the first flip. Right: four separate cells. "
                   "The sigma-algebras have 2, 4 and 16 events.")


def fig_cover():
    w, h = 640, 215
    ax = Axes(40, 20, 560, 150, (0, 1), (0, 1))
    body = [line(ax.X(0), 175, ax.X(1), 175, width=1.4)]
    for x, lab in [(0, "0"), (1, "1")]:
        body.append(line(ax.X(x), 170, ax.X(x), 180, width=1.4))
        body.append(text(ax.X(x), 198, lab, 14))
    qs = [(1, 2), (1, 3), (2, 3), (1, 4), (3, 4), (1, 5), (2, 5), (3, 5), (4, 5)]
    eps = 0.5
    cols = [BLUE, ORANGE, GREEN, PURPLE, RED]
    for n, (p, q) in enumerate(qs, start=1):
        c = p / q
        wd = eps * 2.0 ** (-n)
        y = 175 - 15 * n
        col = cols[(n - 1) % len(cols)]
        body.append(rect(ax.X(c - wd / 2), y - 4, max(ax.X(c + wd / 2) - ax.X(c - wd / 2), 1.2), 8,
                         fill=col, opacity=0.55, stroke="none"))
        if n <= 5:
            body.append(line(ax.X(c), y + 6, ax.X(c), 175, color=col, width=0.8, dash="2 3"))
        body.append(circle(ax.X(c), 175, 2.6, fill=col))
        if n <= 5:
            body.append(text(ax.X(c + wd / 2) + 6, y + 4, "q%s = %d/%d, width ε/%d" % (
                "₀₁₂₃₄₅₆₇₈₉"[n], p, q, 2 ** n), 12, "start", italic=True))
    body.append(text(ax.X(1), 30, "total width ≤ ε/2 + ε/4 + ε/8 + … = ε", 14, "end", italic=True))
    return svg_doc(w, h, body,
                   "The rationals in [0, 1] listed one after another, the n-th covered by an interval of width "
                   "epsilon over 2 to the n. The intervals shrink so fast that their total width is at most epsilon.")


# ---- chapter 2 ------------------------------------------------------------
def fig_threshold():
    w, h = 640, 250
    ax = Axes(60, 30, 520, 170, (0, 1), (0, 2.6))
    pts = sample(wealth, 0, 1, 600)
    c = 1.0
    body = ax.frame("i", "a(i)")
    body.append(polyline(ax.pts(pts), BLUE, 2.2))
    body.append(line(ax.X(0), ax.Y(c), ax.X(1), ax.Y(c), ORANGE, 1.4, dash="6 4"))
    body += ax.ytick(c, "c", italic=True)
    body += ax.xtick(0, "0") + ax.xtick(1, "1")
    xs = [x for x, _ in pts]
    for a, b in runs(xs, lambda x: wealth(x) <= c):
        body.append(line(ax.X(a), ax.Y(0) - 1, ax.X(b), ax.Y(0) - 1, ORANGE, 6))
        fill = [ax.px(x, 0) for x in (a, b)]
        seg = [(x, wealth(x)) for x in xs if a <= x <= b]
        body.append(polygon([ax.px(a, c)] + ax.pts(seg) + [ax.px(b, c)], ORANGE, 0.18))
    body.append(text(ax.X(0.5), 240, "the set {i : a(i) ≤ c}, marked on the axis", 14, italic=True, color=ORANGE))
    return svg_doc(w, h, body,
                   "A wiggly curve of assets a(i) against household index i from 0 to 1, a horizontal dashed "
                   "line at height c, and the parts of the horizontal axis where the curve lies below c marked in orange.")


def fig_pushforward():
    w, h = 660, 260
    ax = Axes(55, 30, 360, 170, (0, 1), (0, 2.6))
    hx = Axes(470, 30, 150, 170, (0, 1.0), (0, 2.6))
    n = 40000
    vals = [wealth((k + 0.5) / n) for k in range(n)]
    bins = 26
    width = 2.6 / bins
    counts = [0] * bins
    for v in vals:
        counts[min(int(v / width), bins - 1)] += 1
    dens = [c / n / width for c in counts]
    lo, hi = 1.6, 2.0
    body = ax.frame("i", "a")
    body.append(polygon([ax.px(0, lo), ax.px(1, lo), ax.px(1, hi), ax.px(0, hi)], GREEN, 0.12))
    pts = sample(wealth, 0, 1, 600)
    body.append(polyline(ax.pts(pts), BLUE, 2.2))
    xs = [x for x, _ in pts]
    for a, b in runs(xs, lambda x: lo <= wealth(x) <= hi):
        body.append(line(ax.X(a), ax.Y(0) - 1, ax.X(b), ax.Y(0) - 1, GREEN, 6))
    body += ax.xtick(0, "0") + ax.xtick(1, "1")
    body += ax.ytick(lo, "b₁", italic=True) + ax.ytick(hi, "b₂", italic=True)
    body.append(text(ax.X(0.5), 245, "households with a(i) in B = [b₁, b₂]", 14, italic=True, color=GREEN))
    # histogram of the pushforward, drawn sideways so it shares the vertical axis
    body.append(line(hx.X(0), hx.Y(0), hx.X(0), hx.Y(2.6) - 8, width=1.2))
    body.append(line(hx.X(0), hx.Y(0), hx.X(1.0) + 8, hx.Y(0), width=1.2))
    for k, d in enumerate(dens):
        y0, y1 = k * width, (k + 1) * width
        inside = lo - 1e-9 <= y0 and y1 <= hi + 1e-9
        body.append(rect(hx.X(0), hx.Y(y1), hx.X(d) - hx.X(0), hx.Y(y0) - hx.Y(y1),
                         fill=GREEN if inside else BLUE, opacity=0.55 if inside else 0.3,
                         stroke="none"))
    body.append(text(hx.X(0.5), 18, "distribution of a", 14, italic=True))
    body.append(text(hx.X(0.5), 245, "green area = length of green set", 13, italic=True, color=GREEN))
    body.append(arrow(ax.X(1) + 12, ax.Y(1.8), hx.X(0) - 8, hx.Y(1.8), GREEN, 1.4))
    return svg_doc(w, h, body,
                   "Left: assets a(i) against household index i, with a horizontal band between b1 and b2 and the "
                   "households whose assets fall in the band marked on the axis. Right: a sideways histogram of "
                   "assets; the bars inside the band have total area equal to the total length of the marked set.")


def fig_simple():
    w, h = 660, 220
    f = lambda x: 0.35 + 2.2 * x ** 1.4 * (1.15 - 0.6 * x) + 0.25 * math.sin(9 * x)
    body = []
    for p, n in enumerate([1, 2, 3]):
        ax = Axes(30 + p * 215, 30, 180, 150, (0, 1), (0, 2.4))
        body += ax.frame(None, None, arrows=False)
        pts = sample(f, 0, 1, 400)
        body.append(polyline(ax.pts(pts), BLUE, 1.8))
        step = 2.0 ** (-n)
        phi = lambda x: min(n, step * math.floor(f(x) / step))
        prev = None
        seg = []
        for x, _ in pts:
            v = phi(x)
            if prev is not None and v != prev:
                seg.append((x, prev))
            seg.append((x, v))
            prev = v
        body.append(polygon(ax.pts([(0, 0)] + seg + [(1, 0)]), ORANGE, 0.3))
        body.append(polyline(ax.pts(seg), ORANGE, 1.8))
        if n < 3:
            body.append(line(ax.X(0), ax.Y(n), ax.X(1), ax.Y(n), INK, 0.9, dash="3 3", opacity=0.6))
            body.append(text(ax.X(1) + 2, ax.Y(n) + 4, "cap %d" % n, 11, "start", italic=True))
        body.append(text(ax.X(0.5), 205, "φ%s: steps of %s" % ("₁₂₃"[n - 1], ["1/2", "1/4", "1/8"][n - 1]),
                         14, italic=True))
    return svg_doc(w, h, body,
                   "Three panels showing the same curve f with an orange staircase under it. The staircase rounds f "
                   "down to multiples of one half, one quarter and one eighth, and is capped at 1, 2 and 3; it rises "
                   "toward f from one panel to the next.")


# ---- chapter 3 ------------------------------------------------------------
def fig_slices():
    w, h = 660, 240
    f = lambda x: 0.4 + 1.6 * math.exp(-((x - 0.35) / 0.18) ** 2) + 0.9 * math.exp(-((x - 0.78) / 0.12) ** 2)
    body = []
    # Riemann
    ax = Axes(40, 30, 260, 160, (0, 1), (0, 2.2))
    body += ax.frame("x", None)
    k = 12
    for j in range(k):
        a, b = j / k, (j + 1) / k
        v = f((a + b) / 2)
        body.append(rect(ax.X(a), ax.Y(v), ax.X(b) - ax.X(a), ax.Y(0) - ax.Y(v), fill=BLUE, opacity=0.25,
                         stroke=BLUE, width=0.8))
    body.append(polyline(ax.pts(sample(f, 0, 1, 400)), INK, 1.8))
    body.append(text(ax.X(0.5), 225, "Riemann: cut the domain", 14, italic=True))
    # Lebesgue
    bx = Axes(370, 30, 260, 160, (0, 1), (0, 2.2))
    body += bx.frame("x", None)
    levels = [0.25 * j for j in range(9)]
    xs = [i / 600 for i in range(601)]
    cols = [ORANGE, BLUE]
    for j, y in enumerate(levels[:-1]):
        y2 = levels[j + 1]
        for a, b in runs(xs, lambda x: f(x) >= y2):
            body.append(rect(bx.X(a), bx.Y(y2), bx.X(b) - bx.X(a), bx.Y(y) - bx.Y(y2),
                             fill=cols[j % 2], opacity=0.28, stroke="none"))
    hl = 1.0
    for a, b in runs(xs, lambda x: f(x) >= hl):
        body.append(line(bx.X(a), bx.Y(0) - 1, bx.X(b), bx.Y(0) - 1, GREEN, 6))
        body.append(line(bx.X(a), bx.Y(hl), bx.X(b), bx.Y(hl), GREEN, 1.6))
    body.append(line(bx.X(0), bx.Y(hl), bx.X(1), bx.Y(hl), GREEN, 1, dash="4 4"))
    body += bx.ytick(hl, "y", italic=True)
    body.append(polyline(bx.pts(sample(f, 0, 1, 400)), INK, 1.8))
    body.append(text(bx.X(0.5), 225, "Lebesgue: cut the range", 14, italic=True))
    body.append(text(bx.X(1), 26, "green: {x : f(x) ≥ y}", 13, "end", italic=True, color=GREEN))
    return svg_doc(w, h, body,
                   "Left: area under a curve approximated by vertical strips. Right: the same area built from "
                   "horizontal bands; for one height y the set of x where the curve is at least y is marked in green "
                   "on the axis.")


def fig_bump():
    w, h = 640, 230
    ax = Axes(60, 20, 520, 170, (0, 1.05), (0, 8.6))
    body = ax.frame("x", "fₙ(x)")
    cols = [BLUE, ORANGE, GREEN, PURPLE]
    for n, col in zip([1, 2, 4, 8], cols):
        body.append(rect(ax.X(0), ax.Y(n), ax.X(1 / n) - ax.X(0), ax.Y(0) - ax.Y(n), fill=col,
                         opacity=0.18, stroke=col, width=1.8))
        body.append(text(ax.X(1 / n) + 6, ax.Y(n) + 16, "n = %d" % n, 13, "start", italic=True, color=col))
        body += ax.ytick(n, str(n))
    body += ax.xtick(1, "1") + ax.xtick(0.5, "1/2") + ax.xtick(0.25, "1/4")
    body.append(text(ax.X(0.62), ax.Y(6.5), "every rectangle has area 1", 14, "start", italic=True))
    body.append(text(ax.X(0.62), ax.Y(5.5), "yet fₙ(x) → 0 at every x", 14, "start", italic=True))
    return svg_doc(w, h, body,
                   "Rectangles of height n over the interval from 0 to 1 over n, for n = 1, 2, 4, 8. Each has area 1, "
                   "but they get narrower and taller, so at every fixed point the function is eventually zero.")


# ---- chapter 4 ------------------------------------------------------------
_EQ = None


def eq():
    global _EQ
    if _EQ is None:
        _EQ = AI.equilibrium()
    return _EQ


def wealth_density(psi, upto, nb):
    """Mass per unit of assets on (0, upto]. Each grid point's mass (away from a = 0)
    is spread evenly over the cell between the midpoints to its neighbours, then binned."""
    width = upto / nb
    d = [0.0] * nb
    G = AI.GRID
    for i in range(1, AI.N - 1):
        lo, hi = (G[i - 1] + G[i]) / 2, (G[i] + G[i + 1]) / 2
        m = sum(psi[iz][i] for iz in range(len(AI.Z)))
        for k in range(nb):
            a, b = k * width, (k + 1) * width
            ov = min(b, hi) - max(a, lo)
            if ov > 0:
                d[k] += m * ov / (hi - lo)
    return [(width * (k + 0.5), v / width) for k, v in enumerate(d)], width


def fig_atom():
    r, k, psi, _ = eq()
    atom = psi[0][0] + psi[1][0]
    w, h = 660, 250
    upto = 9.0
    dens, width = wealth_density(psi, upto, 36)
    top = max(v for _, v in dens)
    ax = Axes(50, 30, 270, 170, (0, upto), (0, top * 1.35))
    body = ax.frame("a", None)
    for (m, v) in dens:
        body.append(rect(ax.X(m - width / 2), ax.Y(v), ax.X(width) - ax.X(0), ax.Y(0) - ax.Y(v),
                         fill=BLUE, opacity=0.35, stroke="none"))
    # the atom, drawn as a spike that is not on the density scale
    body.append(line(ax.X(0) + 2, ax.Y(0), ax.X(0) + 2, ax.Y(top * 1.25), ORANGE, 3))
    body.append(circle(ax.X(0) + 2, ax.Y(top * 1.25), 5, ORANGE))
    body.append(text(ax.X(0) + 12, ax.Y(top * 1.25) + 5, "mass %.1f%% exactly at a = 0" % (100 * atom), 13,
                     "start", italic=True, color=ORANGE))
    for x in [0, 2, 4, 6, 8]:
        body += ax.xtick(x, str(x))
    body.append(text(ax.X(upto / 2), 240, "density on a > 0, plus a point mass", 14, italic=True))
    # CDF
    bx = Axes(390, 30, 240, 170, (0, upto), (0, 1))
    body += bx.frame("a", "F(a)")
    cum, pts = atom, [(0, atom)]
    for i in range(1, AI.N):
        a = AI.GRID[i]
        if a > upto:
            break
        cum += psi[0][i] + psi[1][i]
        pts.append((a, cum))
    body.append(polyline(bx.pts(pts), BLUE, 2.2))
    body.append(circle(bx.X(0), bx.Y(atom), 3.5, BLUE))
    body.append(circle(bx.X(0), bx.Y(0), 3.5, "none", stroke=BLUE, width=1.5))
    body.append(line(bx.X(0) + 9, bx.Y(0), bx.X(0) + 9, bx.Y(atom), ORANGE, 1.4))
    body.append(text(bx.X(0) + 14, bx.Y(atom / 2) + 4, "jump %.3f" % atom, 12, "start", italic=True, color=ORANGE))
    body += bx.ytick(1, "1") + bx.ytick(0.5, "0.5")
    for x in [0, 4, 8]:
        body += bx.xtick(x, str(x))
    body.append(text(bx.X(upto / 2), 240, "distribution function: a jump at 0", 14, italic=True))
    return svg_doc(w, h, body,
                   "Left: a histogram of household assets above zero together with a separate spike at zero, "
                   "where about %.0f percent of households sit at the borrowing limit. Right: the distribution "
                   "function, which jumps at zero by that amount and then rises smoothly." % (100 * atom))


def fig_riskneutral():
    w, h = 520, 210
    ax = Axes(80, 30, 360, 140, (0, 4), (0, 0.65))
    body = [line(ax.X(0), ax.Y(0), ax.X(4), ax.Y(0), width=1.2)]
    data = [("boom", 0.5, 0.45), ("bust", 0.5, 0.55)]
    for j, (name, p, q) in enumerate(data):
        x = 0.5 + 2 * j
        body.append(rect(ax.X(x), ax.Y(p), ax.X(0.6) - ax.X(0), ax.Y(0) - ax.Y(p), fill=BLUE, opacity=0.45,
                         stroke="none"))
        body.append(rect(ax.X(x + 0.7), ax.Y(q), ax.X(0.6) - ax.X(0), ax.Y(0) - ax.Y(q), fill=ORANGE,
                         opacity=0.55, stroke="none"))
        body.append(text(ax.X(x + 0.3), ax.Y(p) - 6, "%.2f" % p, 13))
        body.append(text(ax.X(x + 1.0), ax.Y(q) - 6, "%.2f" % q, 13))
        body.append(text(ax.X(x + 0.65), ax.Y(0) + 20, name, 14, italic=True))
    body.append(rect(300, 190, 12, 12, fill=BLUE, opacity=0.45, stroke="none"))
    body.append(text(318, 200, "P", 14, "start", italic=True))
    body.append(rect(350, 190, 12, 12, fill=ORANGE, opacity=0.55, stroke="none"))
    body.append(text(368, 200, "Q", 14, "start", italic=True))
    return svg_doc(w, h, body,
                   "Bar chart of two states, boom and bust. Under P each has probability one half. Under the "
                   "risk-neutral measure Q, boom has 0.45 and bust 0.55.")


# ---- chapter 5 ------------------------------------------------------------
def fig_condexp():
    w, h = 640, 240
    ax = Axes(60, 25, 520, 170, (0, 1), (0, 2.6))
    body = ax.frame("ω", None)
    cuts = [0, 0.3, 0.45, 0.75, 1]
    cols = [BLUE, ORANGE, GREEN, PURPLE]
    n = 4000
    for j in range(4):
        a, b = cuts[j], cuts[j + 1]
        body.append(rect(ax.X(a), ax.Y(2.6), ax.X(b) - ax.X(a), ax.Y(0) - ax.Y(2.6), fill=cols[j],
                         opacity=0.08, stroke="none"))
        m = sum(wealth(a + (b - a) * (k + 0.5) / n) for k in range(n)) / n
        body.append(line(ax.X(a), ax.Y(m), ax.X(b), ax.Y(m), cols[j], 3.2))
        body.append(text(ax.X((a + b) / 2), 214, "G%s" % "₁₂₃₄"[j], 14, italic=True, color=cols[j]))
        if j:
            body.append(line(ax.X(a), ax.Y(0), ax.X(a), ax.Y(2.6), INK, 0.8, dash="3 3", opacity=0.6))
    body.append(polyline(ax.pts(sample(wealth, 0, 1, 600)), INK, 1.6))
    body.append(text(ax.X(1), 18, "thin: X     thick: E[X | 𝒢]", 13, "end", italic=True))
    body += ax.xtick(0, "0") + ax.xtick(1, "1")
    return svg_doc(w, h, body,
                   "A wiggly random variable X on the interval, divided into four cells G1 to G4. On each cell a "
                   "thick horizontal segment sits at the average of X over that cell; together they form the "
                   "step function E[X | G].")


def fig_tree():
    w, h = 640, 290
    body = []
    xs = [70, 270, 470]
    nodes = {(): (xs[0], 135)}
    for t, span in ((1, 160), (2, 60)):
        for path in [p for p in list(nodes) if len(p) == t - 1]:
            x0, y0 = nodes[path]
            for k, s_ in enumerate("HT"):
                nodes[path + (s_,)] = (xs[t], y0 + (-span / 2 if k == 0 else span / 2))
    # boxes for the cells of F1, drawn around the outcomes at date 2
    for k, s_ in enumerate("HT"):
        ys = [nodes[(s_, u)][1] for u in "HT"]
        col = [BLUE, ORANGE][k]
        body.append(rect(xs[2] - 22, min(ys) - 20, 100, max(ys) - min(ys) + 40, fill=col,
                         opacity=0.12, stroke=col, width=1.2, rx=8))
        body.append(text(xs[2] + 88, (min(ys) + max(ys)) / 2 + 5, "first flip %s" % s_, 13, "start",
                         italic=True, color=col))
    for path, (x, y) in nodes.items():
        if path:
            px, py = nodes[path[:-1]]
            body.append(line(px + 8, py, x - 8, y, INK, 1.3))
            body.append(text((px + x) / 2, (py + y) / 2 - 8, path[-1], 13, italic=True))
    for path, (x, y) in nodes.items():
        body.append(circle(x, y, 7, fill="none", stroke=INK, width=1.6))
        if len(path) == 2:
            body.append(text(x + 16, y + 5, "".join(path), 14, "start", italic=True))
    for t, x in enumerate(xs):
        body.append(text(x, 284, "t = %d" % t, 14, italic=True))
    return svg_doc(w, h, body,
                   "An event tree. From the root at t = 0 two branches H and T lead to two nodes at t = 1, and each "
                   "of those branches again to the four outcomes HH, HT, TH, TT at t = 2. The outcomes are grouped in "
                   "two shaded boxes by the first flip.")


# ---- chapter 6 ------------------------------------------------------------
def fig_chain():
    w, h = 520, 200
    L, H = (150, 105), (370, 105)
    body = []
    for (x, y), name, col in [(L, "low", ORANGE), (H, "high", BLUE)]:
        body.append(circle(x, y, 34, fill=col, opacity=0.18, stroke=col, width=2))
        body.append(text(x, y + 5, name, 16, italic=True))
    body.append(curved_arrow(L[0] + 30, L[1] - 16, H[0] - 30, H[1] - 16, -34))
    body.append(text(260, 52, "0.10", 14))
    body.append(curved_arrow(H[0] - 30, H[1] + 16, L[0] + 30, L[1] + 16, -34))
    body.append(text(260, 168, "0.05", 14))
    # self loops
    for (x, y), p, side in [(L, "0.90", -1), (H, "0.95", 1)]:
        sx = x + side * 31
        ex, ey = sx, y + 14
        c2x, c2y = sx + side * 50, y + 45
        n = math.hypot(ex - c2x, ey - c2y)
        ux, uy = (ex - c2x) / n, (ey - c2y) / n
        bx, by = ex - 8 * ux, ey - 8 * uy
        body.append('<path d="M %d %d C %d %d, %d %d, %.1f %.1f" fill="none" stroke="%s" stroke-width="1.5"/>' % (
            sx, y - 14, sx + side * 50, y - 45, c2x, c2y, bx, by, INK))
        body.append(arrow(bx - ux, by - uy, ex, ey, head=8))
        body.append(text(sx + side * 52, y + 5, p, 14, "start" if side > 0 else "end"))
    return svg_doc(w, h, body,
                   "Two circles, low and high. Low stays low with probability 0.90 and moves to high with 0.10; "
                   "high stays high with 0.95 and moves to low with 0.05.")


def normal_pdf(x, m, s):
    return math.exp(-0.5 * ((x - m) / s) ** 2) / (s * math.sqrt(2 * math.pi))


def fig_ar1():
    rho, sig, z0 = 0.8, 0.3, 2.0
    w, h = 640, 250
    ax = Axes(50, 30, 540, 170, (-1.6, 2.4), (0, 1.45))
    body = ax.frame("z", None)
    cols = [PURPLE, GREEN, ORANGE, BLUE]
    for t, col in zip([1, 2, 4, 8], cols):
        m = rho ** t * z0
        s = sig * math.sqrt((1 - rho ** (2 * t)) / (1 - rho ** 2))
        pts = sample(lambda x: normal_pdf(x, m, s), -1.6, 2.4, 400)
        body.append(polyline(ax.pts(pts), col, 2))
        body.append(text(ax.X(m), ax.Y(normal_pdf(m, m, s)) - 6, "t = %d" % t, 13, italic=True, color=col))
    s_inf = sig / math.sqrt(1 - rho ** 2)
    body.append(polyline(ax.pts(sample(lambda x: normal_pdf(x, 0, s_inf), -1.6, 2.4, 400)), INK, 2, dash="6 4"))
    body.append(text(ax.X(-0.62), ax.Y(0.62), "invariant", 13, "end", italic=True))
    body.append(arrow(ax.X(z0), ax.Y(0), ax.X(z0), ax.Y(1.42), RED, 2.4))
    body.append(text(ax.X(z0) - 8, ax.Y(1.36), "t = 0: all mass at z₀ = 2", 13, "end", italic=True, color=RED))
    for x in [-1, 0, 1, 2]:
        body += ax.xtick(x, str(x))
    return svg_doc(w, h, body,
                   "Densities of an AR(1) process started at z0 = 2: a spike at 2 at t = 0, then bell curves at "
                   "t = 1, 2, 4, 8 that drift toward zero and widen, approaching the dashed invariant normal "
                   "distribution centred at zero.")


def fig_weak():
    w, h = 640, 200
    ax = Axes(50, 30, 540, 120, (-0.08, 1.08), (0, 1.2))
    body = [line(ax.X(-0.08), ax.Y(0), ax.X(1.08), ax.Y(0), width=1.2)]
    f = lambda x: 0.35 + 0.4 * math.cos(3 * x) + 0.15 * x
    body.append(polyline(ax.pts(sample(f, -0.08, 1.08, 300)), GREEN, 1.6, dash="5 4"))
    body.append(text(ax.X(1.07), ax.Y(f(1.07)) - 8, "f", 14, "end", italic=True, color=GREEN))
    for n in range(1, 13):
        x = 1 / n
        op = 1.0 if n <= 4 else 0.55
        body.append(line(ax.X(x), ax.Y(0), ax.X(x), ax.Y(1), BLUE, 2, opacity=op))
        body.append(circle(ax.X(x), ax.Y(1), 3, BLUE, opacity=op))
        if n <= 4:
            body += ax.xtick(x, ["1", "1/2", "1/3", "1/4"][n - 1])
    body.append(line(ax.X(0), ax.Y(0), ax.X(0), ax.Y(1), RED, 2.4))
    body.append(circle(ax.X(0), ax.Y(1), 3.5, RED))
    body.append(text(ax.X(0), ax.Y(1) - 10, "δ₀", 13, italic=True, color=RED))
    body.append(text(ax.X(0.6), ax.Y(1) - 10, "point masses at 1, 1/2, 1/3, …", 13, italic=True, color=BLUE))
    body += ax.xtick(0, "0")
    body.append(text(ax.X(0.55), 192, "∫ f d(mass at 1/n) = f(1/n) → f(0) = ∫ f dδ₀, for every continuous f", 14, italic=True))
    return svg_doc(w, h, body,
                   "Unit point masses at 1, 1/2, 1/3, and so on, crowding toward a red point mass at 0, with a dashed "
                   "continuous curve f drawn behind them.")


# ---- chapter 7 ------------------------------------------------------------
def fig_market():
    r_eq, k_eq, _, _ = eq()
    rmax = 1 / AI.BETA - 1
    rs = [rmax * (1 - (1 - j / 18) ** 1.6) for j in range(18)] + [rmax - 0.002, rmax - 0.0008]
    sup = [(AI.capital_supply(r)[0], r) for r in rs]
    w, h = 600, 280
    ax = Axes(70, 30, 460, 200, (0, 8.5), (0, 0.1))
    body = ax.frame("K", "r")
    dem = [(AI.capital_demand(r), r) for r in [0.01 + 0.09 * j / 100 for j in range(101)]]
    body.append(polyline(ax.pts([p for p in dem if p[0] <= 8.5]), ORANGE, 2.2))
    body.append(polyline(ax.pts([p for p in sup if p[0] <= 8.5]), BLUE, 2.2))
    body.append(line(ax.X(0), ax.Y(rmax), ax.X(8.5), ax.Y(rmax), INK, 1.1, dash="5 4", opacity=0.7))
    body.append(text(ax.X(8.4), ax.Y(rmax) - 6, "1/β − 1", 13, "end", italic=True))
    body.append(circle(ax.X(k_eq), ax.Y(r_eq), 5, RED))
    body.append(line(ax.X(k_eq), ax.Y(r_eq), ax.X(k_eq), ax.Y(0), RED, 1, dash="3 3"))
    body.append(line(ax.X(0), ax.Y(r_eq), ax.X(k_eq), ax.Y(r_eq), RED, 1, dash="3 3"))
    body += ax.xtick(k_eq, "K* = %.2f" % k_eq, 12) + ax.ytick(r_eq, "%.3f" % r_eq, 12)
    lab_s = [p for p in sup if p[0] <= 8.5][-1]
    body.append(text(ax.X(lab_s[0]) - 8, ax.Y(lab_s[1]) + 22, "households: ∫ a dΨ", 13, "end",
                     italic=True, color=BLUE))
    body.append(text(ax.X(6.6), ax.Y(0.024), "firms: MPK = r + δ", 13, "start", italic=True, color=ORANGE))
    for x in [0, 2, 4, 6, 8]:
        if abs(x - k_eq) > 0.6:
            body += ax.xtick(x, str(x))
    return svg_doc(w, h, body,
                   "Capital on the horizontal axis and the interest rate on the vertical. A downward-sloping orange "
                   "demand curve from firms and an upward-sloping blue supply curve from households, which shoots up "
                   "toward the dashed line at 1/beta - 1. They cross at the equilibrium marked in red.")


def fig_policy():
    r, k, psi, ap = eq()
    w, h = 600, 260
    upto = 1.0
    ax = Axes(70, 25, 420, 200, (0, upto), (0, upto))
    body = ax.frame("a", "a′")
    body.append(line(ax.X(0), ax.Y(0), ax.X(upto), ax.Y(upto), INK, 1, dash="5 4", opacity=0.7))
    body.append(text(ax.X(upto) + 8, ax.Y(upto) + 4, "a′ = a", 13, "start", italic=True))
    for iz, col, name in [(0, ORANGE, "low z"), (1, BLUE, "high z")]:
        pts = [(AI.GRID[i], ap[iz][i]) for i in range(AI.N) if AI.GRID[i] <= upto]
        body.append(polyline(ax.pts(pts), col, 2.2))
        last = pts[-1]
        dy = -10 if iz else 14
        body.append(text(ax.X(last[0]) + 8, ax.Y(last[1]) + dy, name, 13, "start", italic=True, color=col))
    # constrained region for the low state
    kink = max(AI.GRID[i] for i in range(AI.N) if ap[0][i] <= 1e-12)
    body.append(line(ax.X(0), ax.Y(0) - 1, ax.X(kink), ax.Y(0) - 1, ORANGE, 6))
    body.append(text(ax.X(0.03), ax.Y(0.93), "low z: flat at a′ = 0, the constraint binds", 13, "start",
                     italic=True, color=ORANGE))
    body.append(arrow(ax.X(0.05), ax.Y(0.88), ax.X(kink / 2) + 2, ax.Y(0) - 8, ORANGE, 1.2, head=7))
    for x in [0, 0.5, 1]:
        body += ax.xtick(x, ("%g" % x))
    for y in [0.5, 1]:
        body += ax.ytick(y, ("%g" % y))
    return svg_doc(w, h, body,
                   "Next-period assets against current assets for the low and the high earnings state, with the "
                   "45-degree line dashed. The high-state line lies above the diagonal at low assets, so those "
                   "households save; the low-state line lies below it and is flat at zero for small assets, where "
                   "the borrowing limit binds.")


FIGS = {
    "coins": fig_coins, "cover": fig_cover,
    "threshold": fig_threshold, "pushforward": fig_pushforward, "simple": fig_simple,
    "slices": fig_slices, "bump": fig_bump,
    "atom": fig_atom, "riskneutral": fig_riskneutral,
    "condexp": fig_condexp, "tree": fig_tree,
    "chain": fig_chain, "ar1": fig_ar1, "weak": fig_weak,
    "market": fig_market, "policy": fig_policy,
}

# numbers quoted in the text, filled from the solved economy: {{eq:NAME}}
def eq_numbers():
    r, k, psi, ap = eq()
    atom = psi[0][0] + psi[1][0]
    y = k ** AI.ALPHA * AI.labour() ** (1 - AI.ALPHA)
    return {
        "r": "%.3f" % r, "r_pct": "%.1f" % (100 * r), "w": "%.3f" % AI.wage(r), "K": "%.2f" % k,
        "atom_pct": "%.1f" % (100 * atom), "atom_low_pct": "%.1f" % (100 * psi[0][0]),
        "rmax_pct": "%.1f" % (100 * (1 / AI.BETA - 1)), "KY": "%.2f" % (k / y),
    }


def main():
    cache = {}
    nums = None
    for tmpl in sorted(glob.glob(os.path.join(HERE, "*.html.tmpl"))):
        src = open(tmpl, encoding="utf-8").read()

        def fill(m):
            name = m.group(1)
            if name not in cache:
                cache[name] = FIGS[name]()
            return cache[name]

        out = re.sub(r"<!--fig:([a-z0-9]+)-->", fill, src)
        if "{{eq:" in out:
            nums = nums or eq_numbers()
            out = re.sub(r"\{\{eq:([a-zA-Z_]+)\}\}", lambda m: nums[m.group(1)], out)
        dest = os.path.join(OUT, os.path.basename(tmpl)[:-5])
        open(dest, "w", encoding="utf-8").write(out)
        print("wrote", os.path.relpath(dest, OUT))


if __name__ == "__main__":
    main()
