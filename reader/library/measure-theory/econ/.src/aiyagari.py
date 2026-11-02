"""A small Aiyagari (1994) economy, solved in pure Python for the figures.

Households: CRRA utility (log, at SIGMA = 1), two earnings states (low, high)
following a Markov chain, a borrowing limit a >= 0. Policy by the endogenous grid method;
stationary distribution by iterating the transition on a grid, splitting each
next-period asset choice between its two neighbouring grid points.

python3 aiyagari.py   prints the equilibrium.
"""
import bisect

BETA = 0.92
SIGMA = 1.0
ALPHA = 0.36
DELTA = 0.08
Z = [0.4, 1.0]                       # earnings in the low and the high state
PI = [[0.90, 0.10],                  # P(z' | z): rows z, columns z'
      [0.05, 0.95]]
N = 220
A_MAX = 20.0
GRID = [A_MAX * (i / (N - 1)) ** 2 for i in range(N)]


def stationary_z():
    pu = PI[1][0] / (PI[1][0] + PI[0][1])
    return [pu, 1 - pu]


def labour():
    s = stationary_z()
    return s[0] * Z[0] + s[1] * Z[1]


def wage(r):
    return (1 - ALPHA) * (ALPHA / (r + DELTA)) ** (ALPHA / (1 - ALPHA))


def capital_demand(r):
    return labour() * (ALPHA / (r + DELTA)) ** (1 / (1 - ALPHA))


def mu(c):
    return c ** (-SIGMA)


def _interp(xs, ys, x):
    j = bisect.bisect_right(xs, x) - 1
    j = max(0, min(j, len(xs) - 2))
    t = (x - xs[j]) / (xs[j + 1] - xs[j])
    return ys[j] + t * (ys[j + 1] - ys[j])


def policy(r, w, tol=1e-9, maxit=5000):
    """Consumption c[z][i] at assets GRID[i]; returns next-period assets too."""
    c = [[r * a + w * z + 1e-3 for a in GRID] for z in Z]
    R = 1 + r
    for _ in range(maxit):
        new = []
        for iz, z in enumerate(Z):
            ce, ae = [], []
            for i, ap in enumerate(GRID):
                emu = sum(PI[iz][jz] * mu(c[jz][i]) for jz in range(len(Z)))
                cc = (BETA * R * emu) ** (-1 / SIGMA)
                ce.append(cc)
                ae.append((cc + ap - w * z) / R)
            row = []
            for a in GRID:
                if a <= ae[0]:
                    row.append(R * a + w * z)          # constrained: a' = 0
                else:
                    row.append(_interp(ae, ce, a))
            new.append(row)
        err = max(abs(new[iz][i] - c[iz][i]) for iz in range(len(Z)) for i in range(N))
        c = new
        if err < tol:
            break
    ap = [[min(max(R * GRID[i] + w * Z[iz] - c[iz][i], 0.0), A_MAX) for i in range(N)]
          for iz in range(len(Z))]
    return c, ap


def distribution(ap, tol=1e-12, maxit=20000):
    """Stationary mass psi[z][i] on (GRID[i], Z[z])."""
    nz = len(Z)
    lot = []                                     # (lower index, weight on lower)
    for iz in range(nz):
        row = []
        for i in range(N):
            x = ap[iz][i]
            j = max(0, min(bisect.bisect_right(GRID, x) - 1, N - 2))
            wl = (GRID[j + 1] - x) / (GRID[j + 1] - GRID[j])
            row.append((j, min(max(wl, 0.0), 1.0)))
        lot.append(row)
    sz = stationary_z()
    psi = [[sz[iz] / N] * N for iz in range(nz)]
    for _ in range(maxit):
        new = [[0.0] * N for _ in range(nz)]
        for iz in range(nz):
            for i in range(N):
                m = psi[iz][i]
                if m == 0.0:
                    continue
                j, wl = lot[iz][i]
                for jz in range(nz):
                    p = m * PI[iz][jz]
                    new[jz][j] += p * wl
                    new[jz][j + 1] += p * (1 - wl)
        err = sum(abs(new[iz][i] - psi[iz][i]) for iz in range(nz) for i in range(N))
        psi = new
        if err < tol:
            break
    return psi


def capital_supply(r):
    w = wage(r)
    _, ap = policy(r, w)
    psi = distribution(ap)
    k = sum(psi[iz][i] * GRID[i] for iz in range(len(Z)) for i in range(N))
    return k, psi, ap


def equilibrium(lo=0.0, hi=None, steps=30):
    hi = hi if hi is not None else 1 / BETA - 1 - 1e-4
    for _ in range(steps):
        r = (lo + hi) / 2
        k, _, _ = capital_supply(r)
        if k > capital_demand(r):
            hi = r
        else:
            lo = r
    r = (lo + hi) / 2
    k, psi, ap = capital_supply(r)
    return r, k, psi, ap


if __name__ == "__main__":
    r, k, psi, ap = equilibrium()
    atom = psi[0][0] + psi[1][0]
    print("r = %.4f  w = %.4f  K = %.3f  K_d = %.3f  L = %.4f" % (r, wage(r), k, capital_demand(r), labour()))
    print("mass at a = 0: %.4f  (low %.4f, high %.4f)" % (atom, psi[0][0], psi[1][0]))
    print("share in the low state %.4f" % stationary_z()[0])
