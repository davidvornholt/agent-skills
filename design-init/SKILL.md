---
name: design-init
description: Initialize or re-initialize a repository's design system from a style seed. Generates the root DESIGN.md, the theme in packages/ui/src/theme.css, and the project-local ux-ui skill.
disable-model-invocation: true
argument-hint: [seed | path/to/DESIGN.md]
---

# Design init

Seed this repository's design system. A seed is repo-agnostic creative direction — it guides generation, then steps out of the way. The generated `DESIGN.md` stands alone: agents working in the repo never need the seed, and nothing in the repo may depend on it.

## Available seeds

!`grep -H '^tagline:' ~/.claude/skills/design-init/references/styles/*.md | sed -E 's|.*/([^/]+)\.md:tagline: *|\1 — |'`

## Existing design system

!`test -f DESIGN.md && echo "DESIGN.md exists — this is a re-initialization" || echo "No DESIGN.md — this is a fresh initialization"`

## Workflow

1. **Resolve the seed.** `$ARGUMENTS` names a seed from the list above, or is a path to another repository's `DESIGN.md` to use as an exemplar seed. If empty or unmatched, show the seeds with their taglines and ask the user to pick one.
2. **Read the seed** at `~/.claude/skills/design-init/references/styles/<seed>.md`. It is creative direction, not a checklist: design from its essence and anti-patterns rather than transcribing bullet points. An exemplar `DESIGN.md` additionally carries repo residue — product tone, copy language, domain-specific devices; keep the visual character, strip the residue.
3. **Interview the user** about repo decisions the seed cannot make. Keep it to a few focused questions: existing brand/CI colors to honor, audience and tone, and hard constraints. Modes: a design has one mode — light, unless the seed declares itself dark-first. Generate a second mode only when the user explicitly opts in during this interview; never ship one by default.
4. **Generate the root `DESIGN.md`.** It must be self-contained: a reader with no access to this skill or its seeds must be able to follow it completely, so never require it to name its seed — an optional provenance comment ("Seeded from warm-print.") is welcome but never load-bearing. It must describe how the design should feel and reference `packages/ui/src/theme.css` as the single source of design values. Recurring design decisions are welcome and make the document operative: a pattern vocabulary of composed primitives, layout rhythms and named grid spans, foreground rules per surface, and references to semantic token names. Do not include raw values (hex/oklch), utility classes, selectors, lint/guardrail mechanics, or changelog prose about previous states — the line is between what is decided (in) and how it is technically expressed or how it evolved (out). Write it imperatively, with one declarative identity paragraph at the top.
5. **Generate `packages/ui/src/theme.css`** (create `packages/ui` first if missing, following the repo's monorepo conventions). Define all colors with `oklch(...)`, build primitive ramps plus semantic aliases, disable the default Tailwind palette with `--color-*: initial` inside `@theme`, and keep the token names semantic.
6. **On re-initialization,** treat the existing `DESIGN.md` and `theme.css` as the previous instance: summarize what changes, migrate token names only where meaning changed, and warn about consumers of removed tokens.
7. **Report** what was created or changed, and list follow-ups the user must decide (e.g. replacing palette classes still used in code).

Keep `DESIGN.md` and `theme.css` aligned: every semantic concept named in one must exist in the other.

## Growing the seed library

Add a seed only when a design is expected to seed another repository — the library is a set of starting points, not an inventory of every shipped design. When a proven repo design is worth reusing, distill it: keep the visual character, strip the repo residue.

Name seeds `<character>-<medium>`. The medium word names the structural family (`print` = flat, rule-based, typographic; `product` = carded, layered, interactive); the character word is the sharpest discriminator within that family. Every seed carries a `tagline:` frontmatter line written contrastively — it states what separates this seed from its nearest neighbor, not what it looks like in isolation.
