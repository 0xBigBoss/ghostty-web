# TODO - Fix Resize Race Condition

## Completed
- [x] Analyzed race condition between render loop and resize (iteration 1)
- [x] Implemented fix: pause render loop during resize by canceling animationFrameId before WASM resize and restarting after (iteration 1)
- [x] Type check passes (`npx tsc --noEmit`)
- [x] All 322 tests pass (`npm test`)
- [x] Build succeeds (`npm run build`)
- [x] First fix still crashed - investigated further (iteration 2)
- [x] Found root cause: graphemeBuffer is a cached Uint32Array view of WASM memory that wasn't invalidated during resize (iteration 2)
- [x] Fixed: invalidateBuffers() now also clears graphemeBuffer and graphemeBufferPtr (iteration 2)
- [x] Verification passes: type check, 322 tests, build all succeed (iteration 2)

## In Progress
(none)

## Pending
- [ ] Manual verification: Build ghostty-terminal extension and test resize during cmatrix (requires user interaction)

## Blocked
- Manual verification cannot be performed in automated loop - requires user to test in VS Code Extension Development Host

## Notes
- The race condition occurred because the render loop (running at 60fps via requestAnimationFrame) would read from WASM buffers while resize() was reallocating them
- First fix (pause render loop) was necessary but not sufficient
- Root cause: WASM memory can grow during resize, which detaches the underlying ArrayBuffer. Cached TypedArray views (like graphemeBuffer) become invalid when this happens.
- Fix: Cancel the animation frame before resize, AND invalidate all cached buffer views in invalidateBuffers()
- ISSUE-2 from review: ghostty-terminal changes (theme priority, timing hacks) were made in a previous session and are out of scope for this ghostty-web fix task
