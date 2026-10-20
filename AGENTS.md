# Project UI requirement

- 全项目所有下拉选择控件必须使用统一的箭头样式和定位：箭头尺寸12–14px，在控件内垂直居中，距右侧内边缘至少12px，文字预留至少36px右侧空间；禁止箭头贴边、偏移、与文字重叠或在不同模块随意摆放。原生select必须隐藏系统箭头并使用统一封装，已有统一组件优先复用，不得出现双箭头。任何新增或修改的下拉控件都必须在深色、浅色、桌面和窄屏下实际检查箭头间距、对齐及交互状态；修复某个下拉时也要检查同模块同类控件。此要求适用于整个D-Gen项目，包括筛选器、表单、参数面板和弹窗。

- Every UI, visual, style, or interaction change must be designed and verified in both light mode and dark mode before delivery. Maintain readable contrast, legible text, distinct controls, and appropriate hover/focus/error states in each theme.
- Every asynchronous task added to a workspace must survive navigation to another module and back. Never keep in-flight status, user input, or completed results only in component-local state; use a persistent server task or a shared runtime store backed by localStorage, and verify the task remains visible after switching modules.
- Dark mode must use neutral charcoal, graphite, or violet-tinted surfaces only. Never introduce green-tinted panels, inputs, cards, overlays, or background blocks (including dark RGBA values whose green channel dominates). Verify new dark surfaces visually before delivery.
- AI generation tools must not make one planning-model timeout a hard blocker for the primary generation action. Preserve the task and use a tested high-quality model fallback; never silently substitute a low-quality local template for an intelligent prompt model.
- In the Pulin festival and solar-term poster tool, one submit must run planning and then start both poster images automatically; never add a prompt-confirmation gate or expose a prompt display/editing module in the task card. The style selector must offer 3D cartoon, photorealistic, color ink (default), and paper-cut while preserving all composition, character, collar, service-scene, text, safety-area, overlay, and two-variant rules. Regeneration must retain the task's selected style.
- A failed Pulin festival or solar-term poster task may remain visible in the current live session so the user can retry it, but failed tasks must be omitted when history is reloaded after a page refresh. Keep running and successful tasks in refreshed history.

# Project deployment requirement

- After completing and validating a user-requested change in this project, automatically commit only the scoped changes, push, deploy through the current production workflow, and verify production without asking for separate deployment approval. Do not deploy when the user explicitly requests local-only work, preview-only work, or waiting for confirmation. Keep unrelated worktree changes out of the deployment commit.
