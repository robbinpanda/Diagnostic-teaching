# Panda Welcome and Chat Avatar Integration Design

## Goal

Replace the empty "start Q&A" workspace with the approved panda welcome scene, carry the panda into the first assistant response, and reuse the panda as the assistant identity throughout chat without changing the existing composer workflow or backend session lifecycle.

## Scope

- The left navigation/sidebar remains visually unchanged.
- The empty start workspace receives the animated bamboo, welcome copy, book, and panda scene.
- The empty-state `新答疑` conversation header is removed; established sessions retain their normal header.
- The composer card, controls, image flow, model selection, and send/stop behavior remain unchanged.
- The visible helper line beneath the composer is removed. Speech progress remains available as an accessible live status rather than a visible footer.
- Main application canvases use the approved warm ivory background. The sidebar keeps its existing background and the composer retains its existing card styling.
- Existing lucide assistant robot avatars are replaced by a small panda-only SVG.

## Visual Composition

The welcome scene is a responsive, pointer-safe layer inside the message viewport:

- Three bamboo plants sit on the left and share the same bottom baseline as the book.
- The title and supporting copy sit between the bamboo and panda, closer to the panda than in the previous empty state.
- The title stays on one line at desktop widths. The supporting copy has an intentional line break only after the comma.
- The book and panda sit on the right. Book shadow, panda cast shadow, book, and panda are separate SVG groups so they can exit independently.
- The background is a flat warm ivory with subtle half-tone dots and paper-like texture; it does not use a gradient.
- The title uses the locally installed `爱点拍拍刷` face with explicit fallback fonts.

## Motion

### Entrance

1. The book falls first and settles with a soft squash-and-rebound.
2. The panda remains hidden until its own drop begins.
3. The panda falls onto the book and settles with stronger secondary spring motion in the ears, arms, and tail.
4. Bamboo and text enter with the welcome sequence. Title glyphs appear individually at a deliberately slower cadence.
5. After settling, the panda has subtle breathing, vertical buoyancy, and lateral sway. The bamboo sways continuously and its leaves move more than the stems.
6. Pointer movement within the welcome area adds a restrained gaze/body response. Motion is clamped and eased to avoid twitching.

### First-question transition

1. Once a valid first submission begins, bamboo and copy fade/slide away naturally.
2. The book, book ground shadow, and panda cast shadow fade and compress away; the panda body stays visible on the right while the first response is pending.
3. When the first assistant message element mounts, its avatar position becomes the destination for a FLIP-style overlay animation.
4. A panda-only overlay moves and scales from the hero position to the destination avatar. The source and destination copies are hidden during the flight to prevent double images.
5. On completion, the overlay is removed, the normal timeline avatar becomes visible, and the welcome layer unmounts.
6. If reduced motion is requested, or geometry cannot be measured, the transition completes immediately without spatial animation.

### Assistant reply feedback

Each assistant message uses the panda-only avatar. The newest assistant message performs one short hop when that message ID first appears. Streaming text changes do not restart the animation because the trigger is message identity, not content length. Restored/history messages render without replaying all previous hops.

## Component Architecture

- `PandaArtwork.tsx` owns reusable SVG primitives and exports the panda-only avatar artwork plus the complete hero character/book artwork.
- `PandaWelcome.tsx` owns entrance, idle, pointer-follow, and exit presentation for the empty workspace.
- `MessageTimeline.tsx` owns the welcome-to-avatar handoff because it can measure both the hero source and the first assistant avatar destination in the same viewport. It exposes one completion callback to the page.
- `page.tsx` owns the small welcome lifecycle state: visible, leaving/waiting for assistant, and hidden. Starting a new chat resets it; opening/restoring an existing session hides it.
- CSS lives with the existing workspace styles and uses shared color tokens. Motion is implemented with CSS and `requestAnimationFrame`; no new runtime dependency is introduced.

## State and Failure Handling

- Invalid submissions do not start the exit.
- A failed first-session request restores the welcome scene if no session was created and the draft is still active.
- Opening history or restoring a saved session never shows the welcome transition.
- Starting a new chat resets the entrance sequence.
- If the assistant response is interrupted before an assistant message exists, the panda remains as the waiting hero; retry can still complete the handoff.
- The overlay is non-interactive and is always removed on unmount or transition completion.

## Accessibility and Performance

- Decorative bamboo, shadows, and hero art are hidden from assistive technology.
- Assistant avatars have an accessible label supplied by surrounding message semantics; decorative SVG paths remain `aria-hidden`.
- `prefers-reduced-motion` disables continuous sway, pointer follow, per-character entrance, flight, and avatar hop.
- The idle loop pauses when the welcome layer is no longer active, and DOM measurements happen only at the first assistant handoff.
- Stable SVG geometry is shared rather than fetched over the network.

## Verification

- Add or update component tests for the panda avatar, welcome markup, empty header removal, and composer footer removal.
- Verify the first assistant avatar animation keys from a new message ID rather than stream deltas.
- Run frontend unit tests, TypeScript checking, linting, and a production build.
- Exercise the empty page, first-send transition, subsequent replies, history restoration, new-chat reset, and reduced-motion path in the browser.
