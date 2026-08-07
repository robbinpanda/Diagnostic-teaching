# Bamboo Proportion and Copy Alignment Design

## Scope

Adjust only the bamboo rendering proportions and the desktop horizontal position of the welcome copy in the standalone preview. Preserve all character motion, text content, SVG source files, and `apps/web`.

## Design

- Change the bamboo decoration canvas from non-uniform `preserveAspectRatio="none"` scaling to uniform `xMinYMin meet` scaling. This keeps the source bamboo width-to-height ratio stable at every preview size and keeps the existing SVG animation pivots valid.
- Keep the three approved bamboo layout transforms and animation amplitudes unchanged.
- Move `.panda-copy` to the right with `translateX(clamp(28px, 3.8vw, 46px))` on desktop, matching the reference image's approximately 120px left edge.
- Reset the copy translation to zero at widths up to 720px to prevent the one-line title from clipping.

## Acceptance Criteria

- The bamboo canvas uses uniform aspect-ratio preservation.
- Bamboo geometry is not corrected with arbitrary `scaleX` or `scaleY` distortion.
- Desktop copy shifts right by up to 46px and remains above the bamboo layer.
- The narrow layout keeps the copy at its original horizontal position.
- The standalone preview and source fragment stay synchronized.
- Original SVG hashes and `apps/web` remain unchanged.
