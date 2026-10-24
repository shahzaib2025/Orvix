# Public design choices in chat

New website/hero design briefs now publish their recorded storyboard through the existing `model_progress` / `agent_update` event on both execution routes. The shared composition skill already requests option A, option B, the chosen direction and a public selection reason. This displays those recorded summaries before construction, without another generation call or approval stage. It does not expose provider reasoning or invent missing options.

The update states whether construction can proceed, needs revision, or has no available originality comparison. A revised proposal replaces the same turn-local update. None, disabled design workflows and existing-site repairs do not automatically publish it.

The existing chat timeline renders this as ordinary assistant text outside collapsed work/thinking groups. History condensation preserves the latest design-options update and up to 4,000 characters, covering the existing 3,000-character storyboard plus its display/status wrapper.

The chat now presents clearly labeled A/B summaries in two equal-width bordered cards, with the selected direction, reason and construction status underneath. Cards stack on small screens or inside a narrow chat pane. The full original brief remains expandable. Unstructured historical briefs retain their original text instead of inventing missing alternatives. This is presentation only; no extra model calls or approval stage were added.

Focused tests cover all three active profiles with review off, None/repair exclusions, blocked proposals, saved-history condensation, and actual server rendering of the chat timeline. These tests do not constitute another live model generation. Restart the desktop app to load changed main-process code for a fresh chat.
