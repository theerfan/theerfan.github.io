# Natural Language Autoencoders Produce Unsupervised Explanations of LLM Activations

**Kit Fraser-Taliente\*, Subhash Kantamneni\*‡, Euan Ong\***, Dan Mossing, Christina Lu, Paul C. Bogdan, Emmanuel Ameisen, James Chen, Dzmitry Kishylau, Adam Pearce, Julius Tarng, Alex Wu, Jeff Wu, Yang Zhang, Daniel M. Ziegler, Evan Hubinger, Joshua Batson, Jack Lindsey, Samuel Zimmerman, Samuel Marks

Anthropic, *Transformer Circuits Thread*. Published May 7, 2026.
<small>\* Equal contribution, author order alphabetical. ‡ Correspondence to subhash@anthropic.com</small>

> **Read the original:** <https://transformer-circuits.pub/2026/nla/index.html>. Also see the [blog post](https://www.anthropic.com/research/natural-language-autoencoders), the [announcement on X](https://x.com/AnthropicAI/status/2052435436157452769), and the [training code and released NLAs](https://github.com/kitft/natural_language_autoencoders). This page is a summary with the abstract quoted. All rights remain with the authors and Anthropic.
>
> *In the Reader app:* an offline copy is under **offline › nla** in this library.

## Abstract

> We introduce Natural Language Autoencoders (NLAs), an unsupervised method for generating natural language explanations of LLM activations. An NLA consists of two LLM modules: an activation verbalizer (AV) that maps an activation to a text description and an activation reconstructor (AR) that maps the description back to an activation. We jointly train the AV and AR with reinforcement learning to reconstruct residual stream activations. Although we optimize for activation reconstruction, the resulting NLA explanations read as plausible interpretations of model internals that, according to our quantitative evaluations, grow more informative over training. We apply NLAs to model auditing. During our pre-deployment audit of Claude Opus 4.6, NLAs helped diagnose safety-relevant behaviors and surfaced unverbalized evaluation awareness—cases where Claude believed, but did not say, that it was being evaluated. We present these audit findings as case studies and corroborate them using independent methods. On an automated auditing benchmark requiring end-to-end investigation of an intentionally-misaligned model, NLA-equipped agents outperform baselines and can succeed even without access to the misaligned model's training data. NLAs offer a convenient interface for interpretability, with expressive natural language explanations that we can directly read. To support further work, we release training code and trained NLAs for popular open models.

## The idea in one diagram

```text
activation h  ──►  AV (verbalizer)  ──►  "explanation" (text)  ──►  AR (reconstructor)  ──►  ĥ
                      └──────────── trained with RL so that ĥ ≈ h ────────────┘
```

Both modules start as copies of the target model. The only training signal is how well the reconstruction ĥ matches the original activation h. Nothing in the objective rewards the text for being readable, and yet the explanations become more informative as training goes on.

## Outline of the paper

1. **Introduction**: initializing the AV and AR; NLA training
2. **Case Studies**: planning in poetry; language switching; misreported tool calls; reasoning about rewards
3. **Evaluating NLAs during training**: evaluations improve with training; measuring behavioural properties
4. **Characterizing NLA confabulations**
5. **NLAs can detect unverbalized evaluation awareness**
6. **NLAs are competitive on a downstream auditing task**
7. **Using NLAs for supervised activation oracle training**
8. **Discussion and Limitations**, and **Future Work**
9. **Appendix**: methods details, steering details, answer thrashing, automated auditing on Opus 4.6, the reward-sycophancy model organism, and NLAs for open models

## Citation

> Fraser-Taliente, Kantamneni, Ong et al., "Natural Language Autoencoders Produce Unsupervised Explanations of LLM Activations", Transformer Circuits, 2026.

```bibtex
@article{frasertaliente2026nla,
  author  = {Fraser-Taliente, Kit and Kantamneni, Subhash and Ong, Euan and Mossing, Dan and Lu, Christina and Bogdan, Paul C. and Ameisen, Emmanuel and Chen, James and Kishylau, Dzmitry and Pearce, Adam and Tarng, Julius and Wu, Alex and Wu, Jeff and Zhang, Yang and Ziegler, Daniel M. and Hubinger, Evan and Batson, Joshua and Lindsey, Jack and Zimmerman, Samuel and Marks, Samuel},
  title   = {Natural Language Autoencoders Produce Unsupervised Explanations of LLM Activations},
  journal = {Transformer Circuits Thread},
  year    = {2026},
  url     = {https://transformer-circuits.pub/2026/nla/index.html}
}
```
