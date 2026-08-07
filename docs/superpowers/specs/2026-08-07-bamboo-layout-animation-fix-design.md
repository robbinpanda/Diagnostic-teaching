# Bamboo Layout and Animation Fix Design

## Scope

Fix only the three decorative bamboo instances in the standalone panda welcome preview. Preserve the panda animation, copy, original SVG files, and `apps/web`.

## Problem

The current implementation mixes SVG layout transforms with CSS animation transforms. This makes placement depend on browser SVG transform-origin behavior, while the low-amplitude slow idle motion is visually indistinguishable from a static illustration.

## Design

- Keep one verbatim bamboo geometry template in SVG `<defs>` and clone it into exactly three instances.
- Give each instance three independent layers:
  - `bamboo-layout`: fixed translate, scale, and initial rotation only.
  - `bamboo-sway`: runtime whole-stalk rotation around the explicit root pivot `(120, 455)`.
  - leaf paths: runtime rotations around explicit attachment pivots.
- Position the large bamboo at the far left with its base below the title; place two smaller variants beneath the title with different scales and angles.
- Increase visible idle motion to approximately ±3.8° for the whole bamboo and ±10°/±8.5° for the leaves, with separate phases and a roughly five-second cycle.
- Retain the GSAP entrance reveal on the outer instance only. GSAP must not continuously animate the bamboo sway or leaves.
- Under reduced-motion preferences, keep all bamboo transforms at their fixed layout state.

## Acceptance Criteria

- The large bamboo no longer begins outside the intended left margin.
- Both small bamboos sit beneath the copy rather than drifting toward the center of the page.
- Runtime inspection shows changing SVG `transform` attributes on the sway and leaf layers.
- Leaf movement is visibly greater than stalk movement.
- The three entrance reveals remain staggered with the text.
- Original panda and bamboo SVG hashes remain unchanged, and `apps/web` has no diff.
