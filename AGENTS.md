# Project UI requirement

- Every UI, visual, style, or interaction change must be designed and verified in both light mode and dark mode before delivery. Maintain readable contrast, legible text, distinct controls, and appropriate hover/focus/error states in each theme.
- Every asynchronous task added to a workspace must survive navigation to another module and back. Never keep in-flight status, user input, or completed results only in component-local state; use a persistent server task or a shared runtime store backed by localStorage, and verify the task remains visible after switching modules.
- Dark mode must use neutral charcoal, graphite, or violet-tinted surfaces only. Never introduce green-tinted panels, inputs, cards, overlays, or background blocks (including dark RGBA values whose green channel dominates). Verify new dark surfaces visually before delivery.
- AI generation tools must not make an optional planning or prompt-generation call a hard blocker for the primary generation action. When an upstream planning model times out, preserve the task and provide a deterministic editable fallback so the user can continue to image or video generation.
