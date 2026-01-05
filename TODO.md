# TODO - Fix Resize Race Condition

## Completed
- [x] Analyzed race condition between render loop and resize (iteration 1)
- [x] Implemented fix: pause render loop during resize by canceling animationFrameId before WASM resize and restarting after (iteration 1)
- [x] Type check passes (`npx tsc --noEmit`)
- [x] All 322 tests pass (`npm test`)
- [x] Build succeeds (`npm run build`)

## In Progress
(none)

## Pending
- [ ] Manual verification: Build ghostty-terminal extension and test resize during cmatrix

## Blocked
(none)

## Notes
- The race condition occurred because the render loop (running at 60fps via requestAnimationFrame) would read from WASM buffers while resize() was reallocating them
- Fix: Cancel the animation frame before resize, perform all resize operations atomically, then restart the render loop
- This approach is cleaner than using a flag because it completely eliminates any possibility of concurrent access
