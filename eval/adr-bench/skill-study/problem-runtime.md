# Agent client problem brief

Quill needs an in-process desktop agent with streamed multi-turn tool calling, configurable model providers, a local or API model choice, and testable behavior without HTTP. Campaign mutations should remain in the shared business-tool layer. Prompt caching matters for cost, and errors, cancellation, provider parity and pre-1.0 dependency churn are material risks.

A contributor proposes using Rig's agent runtime and typed provider backends. Another option is using `rust-genai` as a provider-neutral client with a Quill-owned tool loop and a small test seam. Compare credible options, including the strongest case for Rig, and recommend a provisional direction. The current decision record and implementation manifest are deliberately unavailable in the first pass.
