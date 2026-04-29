# Prompt Settings Verification

The live preview shows the new **Prompt settings** section rendered in the dashboard with a dedicated sidebar navigation entry labeled **Prompt**. The section contains the prompt editor, a **Use saved default prompt** option, a **Use one-time prompt override** option, and the **Reset to bundled default** plus **Save as default** actions.

The current runtime state confirms that when no saved prompt exists, the saved-default option is visibly disabled with helper text instructing the user to save a prompt first, while the one-time override option is active. This matches the intended fallback behavior for first-time use.

The preview also confirms that the master prompt is loaded into the editor and that the prompt mode selector is visible above it, satisfying the requirement for an explicit user-facing choice between saved default behavior and one-time override behavior.
