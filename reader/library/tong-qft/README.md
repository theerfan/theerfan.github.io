# Quantum Field Theory

<strong>David Tong</strong> — Lecture notes, University of Cambridge (Part III Mathematical Tripos).

> Source: the HTML edition of the notes at <a href="https://davidtong.org/teaching/quantum-field-theory/qfthtml/qfthtml">https://davidtong.org/teaching/quantum-field-theory/qfthtml/qfthtml</a>, converted for this reader (math rendered with KaTeX, figures on a white background so they stay legible in dark mode). The <a href="https://davidtong.org/pdfs/teaching/quantum-field-theory/qft.pdf">PDF version</a> remains the definitive text; see also the <a href="https://davidtong.org/teaching/quantum-field-theory">course page</a>. All content © David Tong.

> Feynman diagrams and figures are redrawn here as SVG from the PDF (the HTML edition left many of them out); they follow the reader's light/dark theme. Two figures (the 1910 photograph and the ALEPH data plot) are kept as images.

## Contents

- <a href="0.%20Introduction.md"><strong>0. Introduction</strong></a>
  - <a href="0.%20Introduction.md#SS1">0.1 Units and Scales</a>
- <a href="1.%20Classical%20Field%20Theory.md"><strong>1. Classical Field Theory</strong></a>
  - <a href="1.%20Classical%20Field%20Theory.md#SS1">1.1 The Dynamics of Fields</a>
  - <a href="1.%20Classical%20Field%20Theory.md#SS2">1.2 Lorentz Invariance</a>
  - <a href="1.%20Classical%20Field%20Theory.md#SS3">1.3 Symmetries</a>
  - <a href="1.%20Classical%20Field%20Theory.md#SS4">1.4 The Hamiltonian Formalism</a>
- <a href="2.%20Free%20Fields.md"><strong>2. Free Fields</strong></a>
  - <a href="2.%20Free%20Fields.md#SS1">2.1 Canonical Quantization</a>
  - <a href="2.%20Free%20Fields.md#SS2">2.2 The Free Scalar Field</a>
  - <a href="2.%20Free%20Fields.md#SS3">2.3 The Vacuum</a>
  - <a href="2.%20Free%20Fields.md#SS4">2.4 Particles</a>
  - <a href="2.%20Free%20Fields.md#SS5">2.5 Complex Scalar Fields</a>
  - <a href="2.%20Free%20Fields.md#SS6">2.6 The Heisenberg Picture</a>
  - <a href="2.%20Free%20Fields.md#SS7">2.7 Propagators</a>
  - <a href="2.%20Free%20Fields.md#SS8">2.8 Non-Relativistic Fields</a>
- <a href="3.%20Interacting%20Fields.md"><strong>3. Interacting Fields</strong></a>
  - <a href="3.%20Interacting%20Fields.md#SS1">3.1 The Interaction Picture</a>
  - <a href="3.%20Interacting%20Fields.md#SS2">3.2 A First Look at Scattering</a>
  - <a href="3.%20Interacting%20Fields.md#SS3">3.3 Wick’s Theorem</a>
  - <a href="3.%20Interacting%20Fields.md#SS4">3.4 Feynman Diagrams</a>
  - <a href="3.%20Interacting%20Fields.md#SS5">3.5 Examples of Scattering Amplitudes</a>
  - <a href="3.%20Interacting%20Fields.md#SS6">3.6 What We Measure: Cross Sections and Decay Rates</a>
  - <a href="3.%20Interacting%20Fields.md#SS7">3.7 Green’s Functions</a>
- <a href="4.%20The%20Dirac%20Equation.md"><strong>4. The Dirac Equation</strong></a>
  - <a href="4.%20The%20Dirac%20Equation.md#SS1">4.1 The Spinor Representation</a>
  - <a href="4.%20The%20Dirac%20Equation.md#SS2">4.2 Constructing an Action</a>
  - <a href="4.%20The%20Dirac%20Equation.md#SS3">4.3 The Dirac Equation</a>
  - <a href="4.%20The%20Dirac%20Equation.md#SS4">4.4 Chiral Spinors</a>
  - <a href="4.%20The%20Dirac%20Equation.md#SS5">4.5 Majorana Fermions</a>
  - <a href="4.%20The%20Dirac%20Equation.md#SS6">4.6 Symmetries and Conserved Currents</a>
  - <a href="4.%20The%20Dirac%20Equation.md#SS7">4.7 Plane Wave Solutions</a>
- <a href="5.%20Quantizing%20the%20Dirac%20Field.md"><strong>5. Quantizing the Dirac Field</strong></a>
  - <a href="5.%20Quantizing%20the%20Dirac%20Field.md#SS1">5.1 A Glimpse at the Spin-Statistics Theorem</a>
  - <a href="5.%20Quantizing%20the%20Dirac%20Field.md#SS2">5.2 Fermionic Quantization</a>
  - <a href="5.%20Quantizing%20the%20Dirac%20Field.md#SS3">5.3 Dirac’s Hole Interpretation</a>
  - <a href="5.%20Quantizing%20the%20Dirac%20Field.md#SS4">5.4 Propagators</a>
  - <a href="5.%20Quantizing%20the%20Dirac%20Field.md#SS5">5.5 The Feynman Propagator</a>
  - <a href="5.%20Quantizing%20the%20Dirac%20Field.md#SS6">5.6 Yukawa Theory</a>
  - <a href="5.%20Quantizing%20the%20Dirac%20Field.md#SS7">5.7 Feynman Rules for Fermions</a>
- <a href="6.%20Quantum%20Electrodynamics.md"><strong>6. Quantum Electrodynamics</strong></a>
  - <a href="6.%20Quantum%20Electrodynamics.md#SS1">6.1 Maxwell’s Equations</a>
  - <a href="6.%20Quantum%20Electrodynamics.md#SS2">6.2 The Quantization of the Electromagnetic Field</a>
  - <a href="6.%20Quantum%20Electrodynamics.md#SS3">6.3 Coupling to Matter</a>
  - <a href="6.%20Quantum%20Electrodynamics.md#SS4">6.4 QED</a>
  - <a href="6.%20Quantum%20Electrodynamics.md#SS5">6.5 Feynman Rules</a>
  - <a href="6.%20Quantum%20Electrodynamics.md#SS6">6.6 Scattering in QED</a>
  - <a href="6.%20Quantum%20Electrodynamics.md#SS7">6.7 Afterword</a>
