# TextOverlay

Displays a centered text overlay with fade-in/fade-out animation.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| text | string | "Sample Text" | The text to display |
| color | color | #ffffff | Text color |
| backgroundColor | color | rgba(0,0,0,0.4) | Background color behind text |

## Behavior

- Text fades in during the first 10% of the clip duration
- Text fades out during the last 10% of the clip duration
- Font size scales proportionally to the preview dimensions

## Tags
#component #overlay #text
