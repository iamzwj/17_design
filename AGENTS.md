# Project UI requirement

- Every UI, visual, style, or interaction change must be designed and verified in both light mode and dark mode before delivery. Maintain readable contrast, legible text, distinct controls, and appropriate hover/focus/error states in each theme.
- Every asynchronous task added to a workspace must survive navigation to another module and back. Never keep in-flight status, user input, or completed results only in component-local state; use a persistent server task or a shared runtime store backed by localStorage, and verify the task remains visible after switching modules.
