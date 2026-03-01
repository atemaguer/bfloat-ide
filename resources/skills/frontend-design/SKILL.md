---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality
version: 1.0.0
license: MIT
---

# Frontend Design Skill

This skill enables creation of distinctive, production-grade frontend interfaces that prioritize design quality and avoid generic aesthetics.

## When to Use This Skill

Use this skill when building:
- Web components and pages
- React applications
- HTML/CSS layouts
- Dashboards and admin panels
- Landing pages and marketing sites
- Any web UI requiring visual polish

### Primary Scope

- This skill is primarily for **new projects** and greenfield interfaces.
- For existing products with an established design system, use this skill in **adaptation mode**: preserve current visual language and only extend it where needed.

### Existing System Rule

Before making visual changes in an existing project:

1. Identify the established tokens/patterns (typography, spacing scale, colors, components, motion style).
2. Reuse those patterns first; avoid introducing a conflicting style direction.
3. Limit changes to the requested surface area unless the user explicitly asks for a redesign.

Do not overwrite a mature design system with a new aesthetic direction unless explicitly requested.

## Core Design Philosophy

**Avoid generic AI-generated aesthetics.** The key is intentionality, not intensity. Commit to bold, intentional design directions rather than safe, middle-ground choices.

### Before Implementation

1. **Understand Context**: What problem are we solving? Who are the users? What are the technical constraints?

2. **Commit to a Direction**: Choose a clear aesthetic and commit to it:
   - Brutalist
   - Maximalist
   - Minimalist
   - Retro-futuristic
   - Luxury/editorial
   - Playful/whimsical
   - Corporate/professional
   - Organic/natural

3. **Identify Differentiation**: What makes this design memorable? What's the "signature" element?

## Execution Workflow

Follow this sequence for every frontend design task:

1. **Classify Project Type**
   - New/greenfield project: choose and commit to a bold design direction.
   - Existing product: preserve design system and operate in adaptation mode.

2. **Audit Existing UI Inputs**
   - Check tokens and conventions: typography, color variables, spacing scale, radii, shadows, motion rules.
   - Check component patterns: buttons, inputs, cards, nav, page shells, empty/loading/error states.
   - Check implementation constraints: framework, design system library, performance limits, browser support.

3. **Define a Design Intent Brief**
   - One-sentence visual direction.
   - One signature element (layout, type treatment, motion moment, or background treatment).
   - One non-goal (what to avoid).

4. **Implement in Layers**
   - Foundations first: tokens, type scale, spacing rhythm.
   - Layout and hierarchy second.
   - Motion and polish last.

5. **Run Acceptance Checks**
   - Validate the quality checklist in this document before finishing.

## Implementation Standards

All code should be production-grade and functional. Focus on these areas to achieve visual distinction:

### Typography

- Use distinctive, characterful fonts that elevate the design
- Create intentional font pairings (display + body)
- Avoid defaulting to generic system typography without intent
- Do not replace an established brand/system font unless explicitly requested
- Consider: variable fonts, custom @font-face, Google Fonts with character
- **Anti-convergence**: Never reuse the same "safe creative" fonts across designs (e.g. Space Grotesk, Outfit, Sora). Each project should feel typographically unique.

### Color & Theme

- Establish a cohesive palette with CSS variables
- Use dominant colors boldly with sharp accents
- Implement proper dark/light modes when needed
- Avoid: purple gradients on white, generic blue CTAs

### Motion & Animation

- Prioritize high-impact moments over scattered micro-interactions
- Use staggered reveals on page load (`animation-delay`)
- Implement scroll-triggered animations
- Add subtle state transitions (hover, focus, active)
- Prefer CSS-only solutions for plain HTML; use **Motion** (formerly Framer Motion) for React when available
- Avoid: generic fade-ins everywhere, unnecessary bounces

### Spatial Composition

- Use unexpected asymmetry and overlap
- Break the grid intentionally
- Employ diagonal flow and tension
- Use negative space strategically
- Avoid: predictable centered layouts, symmetry by default

### Visual Details

- Create atmosphere and depth rather than defaulting to solid colors
- Use specific techniques: gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, grain overlays
- Implement shadows and highlights for dimensionality
- Add context-specific visual effects that match the overall aesthetic
- Avoid: flat designs without hierarchy, generic card patterns, solid-color backgrounds without texture

## What to Avoid

These patterns create generic, forgettable interfaces:

- Overused font families (Inter, Arial, Roboto by default)
- Purple/blue gradients on white backgrounds
- Generic card-based layouts without character
- Predictable header/hero/features/CTA structure
- Cookie-cutter designs lacking context-specific character
- Safe, middle-ground aesthetic choices

## Implementation Complexity

Match complexity to vision:

- **Maximalist designs** warrant elaborate code, multiple effects, rich interactions
- **Minimalist designs** require precision, restraint, perfect proportions
- **Refined simplicity** is often harder than complexity

The right amount of code is whatever achieves the intended design impact—no more, no less.

**Creative ambition**: Don't hold back. Each design should feel genuinely crafted for its context—no two projects should look alike. Commit fully to the chosen vision and execute it with conviction.

## Code Quality

- Write semantic, accessible HTML
- Use CSS custom properties for theming
- Implement responsive design from mobile-first
- Ensure keyboard navigation works
- Test across browsers and devices
- Optimize for performance (lazy loading, code splitting)

## Acceptance Checklist

A task is not complete until all applicable checks pass:

- **Design consistency**:
  - Greenfield: clear visual direction and a visible signature element are present.
  - Existing system: all new UI aligns with existing tokens/components unless redesign was explicitly requested.
- **Accessibility**:
  - Text and interactive UI meet WCAG AA contrast (normal text 4.5:1, large text 3:1).
  - Icon-only interactive controls maintain at least 3:1 contrast against their background.
  - Every interactive control has a visible focus state.
  - Keyboard-only navigation can reach and trigger all core interactions.
  - Motion-heavy experiences provide reduced-motion behavior (`prefers-reduced-motion`).
- **Responsiveness**:
  - Layout works at minimum 360px mobile width and a common desktop width (>= 1280px).
  - No horizontal overflow on primary pages/components at those sizes.
- **Performance basics**:
  - No obviously avoidable large render-blocking assets for above-the-fold UI.
  - Animations prioritize transform/opacity where possible.
- **Implementation quality**:
  - Uses existing component/system primitives when present.
  - CSS variables/tokens are used for theme-critical values (colors, spacing, type scale).
