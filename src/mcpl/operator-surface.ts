/**
 * Operator-surface turns and plain prose.
 *
 * The host's operator surfaces — TUI, web console, CLI, headless IPC — wake
 * an agent with an `external-message` event and render the turn's text
 * themselves. When such a turn has no channel locus, routing its plain prose
 * can only fail, adding a `[send-undeliverable]` notice and a route-failed
 * trace even though the operator surface displays it. Leave that prose in
 * the chronicle without a channel-routing attempt.
 *
 * Channel-less turns woken by anything else — heartbeat, timers, push events
 * — keep the failure notice and trace: no operator surface is known to be
 * displaying their output.
 */

import type { InferenceRequest } from '../types/index.js';

/** The ProcessEvent type operator surfaces wake agents with; the framework
 *  records it as the turn trigger's `reason`. */
export const OPERATOR_SURFACE_TRIGGER = 'external-message';

/** True when a turn's plain prose should stay in the chronicle, unrouted and
 *  unmarked: the turn froze with no channel locus AND was woken from an
 *  operator surface that displays it. */
export function proseStaysOnOperatorSurface(
  trigger: Pick<InferenceRequest, 'reason'> | undefined,
  locus: string | null,
): boolean {
  return locus === null && trigger?.reason === OPERATOR_SURFACE_TRIGGER;
}
