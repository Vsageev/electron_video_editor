# Video Editor Dark Design System

A modern dark design system for professional video editing. Clean, focused, and built for creative workflows.

## Philosophy

Speed and clarity. Every interaction feels instant. The dark palette reduces eye strain while subtle borders and typography guide attention naturally.

## Color Palette

### Backgrounds
- **Primary** `#000000` - Main background
- **Secondary** `#0a0a0a` - Elevated surfaces
- **Card** `#111111` - Cards and panels
- **Card Hover** `#151515` - Interactive hover states

### Borders
- **Subtle** `rgba(255, 255, 255, 0.08)` - Default borders
- **Default** `rgba(255, 255, 255, 0.12)` - Interactive borders

### Text
- **Primary** `#ffffff` - Headlines, important content
- **Secondary** `rgba(255, 255, 255, 0.6)` - Body text
- **Tertiary** `rgba(255, 255, 255, 0.4)` - Labels, metadata

### Accent Colors
- **Purple** `#a78bfa` / `rgba(139, 92, 246, 0.15)` - Tags, highlights
- **Green** `#86efac` / `rgba(34, 197, 94, 0.15)` - Success states
- **Yellow** `#fde047` / `rgba(234, 179, 8, 0.15)` - Warnings
- **Blue** `#93c5fd` / `rgba(59, 130, 246, 0.15)` - Info states

## Typography

### Font Family
```
'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
```

### Scale
- **Hero Title**: 64px / Semi-bold (600) / -0.03em tracking
- **Section Title**: 48px / Semi-bold (600) / -0.02em tracking
- **Card Title**: 18px / Medium (500)
- **Body**: 17px / Regular (400) / 1.7 line-height
- **Small**: 14px / Medium (500)
- **Label**: 13px / Semi-bold (600) / uppercase / 0.1em tracking

## Components

### Buttons

**Primary**
- Background: White
- Text: Black
- Border-radius: 8px
- Padding: 10px 16px (nav) / 14px 24px (hero)
- Hover: opacity 0.9

**Secondary**
- Background: Transparent
- Text: Secondary color
- Hover: Text white

### Cards
- Background: #111111
- Border: 1px solid rgba(255, 255, 255, 0.08)
- Border-radius: 16px (feature) / 12px (component)
- Hover: Border brightens, background #151515

### Inputs
- Background: #0a0a0a
- Border: 1px solid rgba(255, 255, 255, 0.12)
- Border-radius: 8px
- Focus: Border rgba(255, 255, 255, 0.3)

### Badges
- Border-radius: 6px
- Padding: 4px 10px
- Background: Accent color at 15% opacity
- Text: Accent color at full saturation

## Layout Principles

1. **Generous Whitespace** - Let content breathe
2. **Grid Structure** - 3-column feature cards, 4-column stats
3. **Visual Hierarchy** - Large headlines, muted descriptions
4. **Subtle Interactions** - Border highlights on hover

## Animation

- Duration: 0.15s for micro-interactions, 0.2s for transitions
- Easing: ease
- Transform on hover: subtle border/background changes only
