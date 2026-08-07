# Bamboo Proportion and Copy Alignment Design

## Scope

Adjust only the bamboo rendering proportions and the desktop horizontal position of the welcome copy in the standalone preview. Preserve all character motion, text content, SVG source files, and `apps/web`.

## Design

- Change the bamboo decoration canvas from non-uniform `preserveAspectRatio="none"` scaling to uniform `xMinYMin meet` scaling. This keeps the source bamboo width-to-height ratio stable at every preview size and keeps the existing SVG animation pivots valid.
- Keep the three approved bamboo layout transforms and animation amplitudes unchanged.
- Move `.panda-copy` to the right with `translateX(clamp(28px, 3.8vw, 46px))` on desktop, matching the reference image's approximately 120px left edge.
- Reset the copy translation to zero at widths up to 720px to prevent the one-line title from clipping.
- Wrap all three bamboo instances in one `bamboo-position-group` translated by `(0, 192)` SVG units. This value is derived from the rendered screenshot: the bamboo composition baseline is about 110 screen pixels above the green book cover baseline. The group translation corrects that gap while preserving the approved per-instance transforms and animation pivots.

## Acceptance Criteria

- The bamboo canvas uses uniform aspect-ratio preservation.
- Bamboo geometry is not corrected with arbitrary `scaleX` or `scaleY` distortion.
- Desktop copy shifts right by up to 46px and remains above the bamboo layer.
- The narrow layout keeps the copy at its original horizontal position.
- All three bamboo instances move down together while preserving their relative spacing.
- The standalone preview and source fragment stay synchronized.
- Original SVG hashes and `apps/web` remain unchanged.
