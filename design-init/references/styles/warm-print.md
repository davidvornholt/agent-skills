---
tagline: warm paper set completely flat and square; rules over boxes; cool-print's editorial spine at soft-print's temperature
---

# Warm print

## Essence

Warm print is a thoughtfully set periodical that happens to live on a screen: editorial bones, hospitable temperature, disciplined flatness. Structure comes from typography, hairline rules, and alignment — never from boxes, elevation, or decoration. It is emphatically not minimalism: the page is furnished with type, rhythm, and warmth rather than emptied.

## Typography

- Use an expressive, optical-sized serif for display type — headlines, statements, and a single italicized phrase that carries the warmth. Fraunces is the reference choice.
- Pair it with a quiet, competent sans for body and UI text. Inter is the reference choice.
- Uppercase, letterspaced eyebrows label sections; tabular numerals order times, dates, and any figures that must align.
- Italics mark emphasis and reverence, never volume. Display sizes stay rare: one per section.

## Color

- The palette is warm paper: parchment grounds and deep warm inks. Never pure white, never pure black.
- Anchor on one dignified primary that acts as the voice — links, buttons, active states. Forest green is the reference choice.
- Allow one warm accent reserved for moments of welcome; it never becomes structural UI. Clay is the reference choice.
- Most screens read as paper and ink; color emphasis is rare and earned.

## Shape and depth

- Corners are square. 0px radius everywhere — buttons, cards, inputs, images.
- Perfect circles are the one shape exception: elements that are genuinely circular (width equals height) — radio controls, status dots, spinners, avatars — may be fully round.
- Hairline rules and tabular alignment do the work that cards and shadows do elsewhere; where a surface exists, its border is one pixel.
- Shadows appear only under elements that genuinely float — navigation, popovers — never as card decoration or hierarchy.

## The deep register

- The style's signature device: one deep inverse surface — dark ground, light ink, the same rules — applied to at most one or two sections per page for gravity.
- The deep register is part of light mode, not a dark mode. Entering it should feel like turning a page, not changing themes.

## Motion and interaction

- Sections enter with a short fade-and-rise, once per viewport pass.
- Hovers prefer geometry over color: a rule extending, a chevron nudging.
- One easing curve everywhere; all motion collapses under reduced-motion preferences.

## Second mode (opt-in)

- This seed is light-first; the deep register already supplies its dark gravity. Build a full dark mode only on explicit repo opt-in.
- If opted in, grow it from the deep register's ground and foreground rather than inventing a second palette.

## Anti-patterns

- Do not drift into minimalism: pale, washed-out palettes and empty screens read as austerity, not restraint.
- No rounded corners on rectangles, and no pills: full rounding on anything wider than it is tall is a rounded corner, not a circle.
- No drop shadows as hierarchy, no gradients as decoration, no pure white or pure black.
- No stacked badges, eyebrows, and pills on one row; pick the one that earns its place.
- No print-production jargon — folio, masthead, deck, slug — surfacing in UI copy or code vocabulary.
