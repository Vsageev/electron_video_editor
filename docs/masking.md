# Masking

## Shapes

None (default), Rectangle (with border radius), Ellipse.

## Parameters

| Parameter | Range | Notes |
|-----------|-------|-------|
| Center X / Y | 0–1 | Normalized to clip size |
| Width / Height | 0–1 | 1.0 = full clip |
| Feather | 0+ px | Blur radius for soft edges |
| Border Radius | 0–0.5 | Rectangle only, fraction of mask size |
| Invert | on/off | Shows outside instead of inside |

## Interactive Editing

In the preview panel:

- Drag center to move.
- Drag corners to resize both dimensions.
- Drag edges to resize a single dimension.

## Animation

All mask parameters (center, size, feather) are keyframeable with the same easing options as transforms. **Reset Mask** removes the shape and clears all mask keyframes.
