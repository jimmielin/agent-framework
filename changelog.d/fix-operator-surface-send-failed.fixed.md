- A turn woken from an operator surface (TUI, web console, CLI, headless IPC:
  an `external-message` trigger) with no channel locus keeps its plain prose
  in the chronicle without attempting channel delivery. The surface displays
  the reply, so no `[send-undeliverable]` notice or `mcpl:speech-route-failed`
  trace is emitted for it. This applies to live, text-only and trailing prose,
  with one stderr note per turn. Other triggers with no channel locus retain
  their failure notices and traces. `proseStaysOnOperatorSurface` and
  `OPERATOR_SURFACE_TRIGGER` are exported.
