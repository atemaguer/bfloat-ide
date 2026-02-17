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

## Implementation Standards

All code should be production-grade and functional. Focus on these areas to achieve visual distinction:

### Typography

- Use distinctive, characterful fonts that elevate the design
- Create intentional font pairings (display + body)
- Avoid: Arial, Inter, generic system fonts
- Consider: variable fonts, custom @font-face, Google Fonts with character

### Color & Theme

- Establish a cohesive palette with CSS variables
- Use dominant colors boldly with sharp accents
- Implement proper dark/light modes when needed
- Avoid: purple gradients on white, generic blue CTAs

### Motion & Animation

- Prioritize high-impact moments over scattered micro-interactions
- Use staggered reveals on page load
- Implement scroll-triggered animations
- Add subtle state transitions (hover, focus, active)
- Avoid: generic fade-ins everywhere, unnecessary bounces

### Spatial Composition

- Use unexpected asymmetry and overlap
- Break the grid intentionally
- Employ diagonal flow and tension
- Use negative space strategically
- Avoid: predictable centered layouts, symmetry by default

### Visual Details

- Add atmospheric depth through textures and gradients
- Use patterns and backgrounds with purpose
- Implement shadows and highlights for dimensionality
- Add context-specific visual effects
- Avoid: flat designs without hierarchy, generic card patterns

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

## Code Quality

- Write semantic, accessible HTML
- Use CSS custom properties for theming
- Implement responsive design from mobile-first
- Ensure keyboard navigation works
- Test across browsers and devices
- Optimize for performance (lazy loading, code splitting)
