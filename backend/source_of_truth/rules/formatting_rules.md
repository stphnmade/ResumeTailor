# Formatting Rules

- Preserve all preamble content before `\\begin{document}` verbatim.
- Keep Jake-style macro usage intact (`\\resumeSubheading`, `\\resumeProjectHeading`, `\\resumeItem`, list start/end macros).
- Treat the canonical source resume as the visual baseline for spacing, section order, heading style, and one-page composition.
- Keep the rendered PDF very close to the canonical layout; tailor content by swapping, trimming, reordering, and rewriting bullets rather than redesigning structure.
- Output must be valid LaTeX and compile-ready.
- Keep section naming consistent with source style.
- Maintain ATS-friendly plain text extraction (no image-only content, no malformed characters).
- Avoid introducing non-standard macro dependencies.
