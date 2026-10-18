# Neural Networks Are Already Clean

*A working hypothesis about neurons, generalization, and the ecology of circuits.*

**Nick Cammarata**, Goodfire. An informal research essay, announced October 15, 2026.

> **Read the original:** <https://already-clean.goodfire.com/>. It is an interactive essay, with neuron microscopes, a circuit atlas, and live figures that only work there. This page is a summary with short quotes. All rights remain with the author and Goodfire.
>
> *In the Reader app:* an offline copy is under **offline › already-clean** in this library.

## The announcement

Nick Cammarata, [on X](https://x.com/nickcammarata/status/2110757819427574056) (October 15, 2026):

> interpretability might be the most important scientific problem in the world right now, as I don't think we can solve alignment if we don't know what we're building. I think I have good news about it. I co-authored early work in mechanistic interpretability at OpenAI and came away pessimistic, because neural networks appeared to fold into arbitrary tangled knots. years later, I started openai's first large-scale automated interpretability project, finding about 2% of neurons legible with the primitive tools we had
>
> with modern agentic tools and a much closer look, the picture looks totally different. the vast majority in models up to trillions of parameters are legible, and their circuits beautiful. many famous examples of tangled neurons turned out to be misunderstood. The roadblocks I expected mostly aren't there. I now think ambitious interpretability will be solved by the time we need it most, and possibly quite soon, as automated scientists keep improving. it may be a bitter lesson for interpretability: the simple thing, at absurd scale, works

## The short version

The essay opens like this:

> I think I have good news about the nature of neural networks. After many months studying neurons and circuits in image and language models, I've come to believe a network's own mechanisms are its legible building blocks, and that the outlook for mechanistic interpretability may be far better than I'd feared. The canonical evidence of polysemanticity and superposition that convinced much of the field, including me, that networks pack concepts arbitrarily was misread. What looked like arbitrary packing was mostly a motif I'll call recursive generalization, which is much less concerning. This means we can study networks directly, instead of first untangling them. Neural networks are already clean.

In outline, the argument is as follows:

- There are two ways to do mechanistic interpretability. One studies the network's own neurons and circuits directly. The other first decomposes the network, for example with sparse autoencoders, and then studies the decomposition.
- The field moved to the second approach because networks looked like tangled knots. The textbook example was a neuron that fired on both cat faces and car fronts, and the last layer of InceptionV1 seemed full of arbitrary mixtures.
- The essay argues that superposition was the wrong explanation for those cases. Most apparently polysemantic neurons follow *recursive generalization*: they reuse a shared distinction in different contexts.
- Looked at closely with agentic tools, the large majority of neurons are legible, in image models and in language models up to trillions of parameters, and their circuits are understandable.

## Outline of the essay

1. The Short Version
2. Cars and Animals
3. A History of Microscope Errors
4. Recursive Generalization
5. Superposition
6. Superposition of the Gaps
7. Exploring Image Models: how to think about neurons; what neurons do under pressure; late circuits; what dictionaries learn; rare things and memorization
8. Do Weak Activations Matter?
9. Exploring Language Models: the same circuit, in features and in neurons; worked examples; explanations that can lose; the residual stream; attention
10. Zooming Out: what "clean" means; motifs over monosemanticity; a city vs a knot; what a solution might look like
11. Appendix: about thirty notes, including superposition, simulation scores, sign regimes, adversarial examples, memorization, circuit racing, toy models, and the relation to meta-models and to neuroscience

## Citation

> Cammarata, N., 2026. *Neural Networks Are Already Clean.* Goodfire. <https://already-clean.goodfire.com/>

```bibtex
@article{cammarata2026clean,
  author    = {Cammarata, Nick},
  title     = {Neural Networks Are Already Clean},
  publisher = {Goodfire},
  year      = {2026},
  note      = {https://already-clean.goodfire.com/}
}
```
