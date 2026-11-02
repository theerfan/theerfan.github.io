# Measure Theory for Macroeconomics

The measure theory a macroeconomist actually uses, built from intuition: sizes of sets, information as σ-algebras, integrals as aggregates and expectations, conditional expectation, Markov kernels, and the continuum of households. It ends with an Aiyagari economy solved from the definitions.

**Assumed:** calculus with the Riemann integral, a first course in probability (distributions, densities, expectation, independence), sequences and limits. No real analysis. Every symbol is defined before it is used.

## Contents

- <a href="1.%20Measuring%20sets.html"><strong>1. Measuring sets</strong></a>
  - <a href="1.%20Measuring%20sets.html#questions">1.1 Three questions a macro model asks</a>
  - <a href="1.%20Measuring%20sets.html#notation">1.2 Notation for sets</a>
  - <a href="1.%20Measuring%20sets.html#size">1.3 What a notion of size should do</a>
  - <a href="1.%20Measuring%20sets.html#sigma">1.4 Which sets get a size: σ-algebras</a>
  - <a href="1.%20Measuring%20sets.html#information">1.5 A σ-algebra is information</a>
  - <a href="1.%20Measuring%20sets.html#measures">1.6 Measures</a>
  - <a href="1.%20Measuring%20sets.html#null">1.7 Sets of measure zero</a>
  - <a href="1.%20Measuring%20sets.html#summary">1.8 Summary</a>
- <a href="2.%20Measurable%20functions%20and%20distributions.html"><strong>2. Measurable functions and distributions</strong></a>
  - <a href="2.%20Measurable%20functions%20and%20distributions.html#preimages">2.1 Preimages</a>
  - <a href="2.%20Measurable%20functions%20and%20distributions.html#measurable">2.2 Measurable functions and random variables</a>
  - <a href="2.%20Measurable%20functions%20and%20distributions.html#sigmaX">2.3 The information carried by a variable</a>
  - <a href="2.%20Measurable%20functions%20and%20distributions.html#distributions">2.4 Distributions as pushforwards</a>
  - <a href="2.%20Measurable%20functions%20and%20distributions.html#simple">2.5 Simple functions</a>
- <a href="3.%20Integration%20and%20expectation.html"><strong>3. Integration and expectation</strong></a>
  - <a href="3.%20Integration%20and%20expectation.html#idea">3.1 Cutting the range instead of the domain</a>
  - <a href="3.%20Integration%20and%20expectation.html#definition">3.2 The definition, in three steps</a>
  - <a href="3.%20Integration%20and%20expectation.html#expectation">3.3 Expectation, and computing it from a distribution</a>
  - <a href="3.%20Integration%20and%20expectation.html#limits">3.4 Limits and integrals do not always commute</a>
  - <a href="3.%20Integration%20and%20expectation.html#convergence">3.5 The convergence theorems</a>
  - <a href="3.%20Integration%20and%20expectation.html#fubini">3.6 Product measures and the order of integration</a>
- <a href="4.%20Densities%2C%20atoms%20and%20changes%20of%20measure.html"><strong>4. Densities, atoms and changes of measure</strong></a>
  - <a href="4.%20Densities%2C%20atoms%20and%20changes%20of%20measure.html#rn">4.1 What a density is</a>
  - <a href="4.%20Densities%2C%20atoms%20and%20changes%20of%20measure.html#atoms">4.2 Atoms, and why wealth distributions are measures</a>
  - <a href="4.%20Densities%2C%20atoms%20and%20changes%20of%20measure.html#change">4.3 Changing the measure: asset prices</a>
  - <a href="4.%20Densities%2C%20atoms%20and%20changes%20of%20measure.html#remember">4.4 What to remember</a>
- <a href="5.%20Information%20and%20conditional%20expectation.html"><strong>5. Information and conditional expectation</strong></a>
  - <a href="5.%20Information%20and%20conditional%20expectation.html#partition">5.1 Conditioning on a partition</a>
  - <a href="5.%20Information%20and%20conditional%20expectation.html#general">5.2 The general definition</a>
  - <a href="5.%20Information%20and%20conditional%20expectation.html#projection">5.3 The best forecast</a>
  - <a href="5.%20Information%20and%20conditional%20expectation.html#rules">5.4 Rules for computing</a>
  - <a href="5.%20Information%20and%20conditional%20expectation.html#filtrations">5.5 Filtrations and E<sub>t</sub></a>
  - <a href="5.%20Information%20and%20conditional%20expectation.html#euler">5.6 Reading an Euler equation</a>
- <a href="6.%20Markov%20processes%20and%20transition%20kernels.html"><strong>6. Markov processes and transition kernels</strong></a>
  - <a href="6.%20Markov%20processes%20and%20transition%20kernels.html#kernels">6.1 Transition kernels</a>
  - <a href="6.%20Markov%20processes%20and%20transition%20kernels.html#operators">6.2 Two directions: functions and measures</a>
  - <a href="6.%20Markov%20processes%20and%20transition%20kernels.html#bellman">6.3 The Bellman equation, with the measure theory visible</a>
  - <a href="6.%20Markov%20processes%20and%20transition%20kernels.html#invariant">6.4 Invariant distributions</a>
  - <a href="6.%20Markov%20processes%20and%20transition%20kernels.html#weak">6.5 In what sense distributions converge</a>
- <a href="7.%20A%20continuum%20of%20households.html"><strong>7. A continuum of households</strong></a>
  - <a href="7.%20A%20continuum%20of%20households.html#why">7.1 Why a continuum</a>
  - <a href="7.%20A%20continuum%20of%20households.html#labels">7.2 From labels to a distribution</a>
  - <a href="7.%20A%20continuum%20of%20households.html#lln">7.3 Does idiosyncratic risk average out?</a>
  - <a href="7.%20A%20continuum%20of%20households.html#equilibrium">7.4 A stationary equilibrium, assembled</a>
  - <a href="7.%20A%20continuum%20of%20households.html#aggregate">7.5 Aggregate shocks: distributions as state variables</a>
  - <a href="7.%20A%20continuum%20of%20households.html#next">7.6 Where to go from here</a>

Figures and the numbers quoted from the Aiyagari economy are generated by `.src/build.py` (pure Python, no dependencies).
