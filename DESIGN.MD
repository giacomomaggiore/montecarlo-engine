**Design Style**

The visual style is a quiet, text-led digital notebook: minimal, editorial, and intentionally unbranded. It relies on typography and whitespace for hierarchy instead of imagery, cards, dashboards, gradients, or decorative effects.

**Overall Character**

- Calm, intellectual, personal, and utilitarian.
- Content feels like a well-maintained personal archive rather than a product or marketing site.
- The UI stays out of the way: plain navigation, restrained links, sparse metadata, and low-contrast supporting elements.
- Surfaces are largely flat. Borders appear only where interaction or data separation needs them.

**Typography**

- Use a clean neo-grotesque sans-serif such as `Geist Sans`.
- Keep body copy natural and readable, without display typography or decorative font pairing.
- Use slightly heavier weights and tight letter spacing for headings.
- Headings should feel concise and compact, not oversized or promotional.
- Use muted small text for secondary information such as dates, attribution, sources, and helper copy.
- Prefer bold, italics, and underlines inside prose to create emphasis.

**Color System**

- The palette is almost entirely neutral:
  - Light: white background, near-black text.
  - Dark: black background, white text.
  - Secondary information: middle neutral grays.
  - Borders: subtle light/dark gray.
- No branded accent color is used across UI. The only vivid color is blue text-selection feedback.
- Code syntax can use restrained semantic colors: blue, teal, red, orange, violet, and gray.

**Dark Mode**

- Dark mode follows the operating-system color preference.
- It is a true inversion of the interface, not a tinted dark theme:
  - White becomes black.
  - Black becomes white.
  - Neutral metadata and borders shift to darker/lighter gray equivalents.
- Inputs, code blocks, and buttons also invert rather than acquiring new theme colors.

**Spacing and Rhythm**

- The site uses generous empty space around primary content.
- Vertical spacing is the main hierarchy tool: headings have clear separation, paragraphs breathe, and list items have modest gaps.
- The experience should feel uncluttered even when content is long.
- Avoid visually dense clusters of controls, multiple bordered panels, or repeated containers.

**Links and Interaction**

- Links feel editorial rather than app-like:
  - Underlines are thin and offset slightly from text.
  - Decorations use muted gray instead of a saturated accent color.
  - Hover feedback is subtle, usually a small text-color shift or underline.
- Navigation uses plain text links rather than tabs, pills, or buttons.
- Interactive controls use calm neutral fills and borders, with no gradients, shadows, or animated flourishes.

**Containers and Corners**

- Do not use cards as the default composition method.
- Reserve borders for meaningful interaction: forms, inputs, code blocks, tables, and dividers.
- Use small-to-medium rounded corners on practical surfaces only:
  - Inputs and buttons: modest rounding.
  - Code blocks and images: slightly more rounding.
- Avoid heavy shadows, glass effects, color washes, and floating panels.

**Rich Content**

- Article prose is designed as a polished reading surface:
  - Clear heading hierarchy.
  - Paragraph spacing.
  - Thin, muted underlined links.
  - Ordered/unordered lists with conventional markers.
  - Code blocks with neutral background, subtle border, compact padding, and hidden scrollbars.
  - Tables use simple collapsed grid borders.
  - Quotes use a gray left rule, a very pale background, and italic text.
  - Images have modest rounded corners.
- Heading anchors appear only on hover, so the reading flow remains clean.

**Forms**

- Inputs are plain, compact, and functional:
  - Neutral background.
  - Thin gray border.
  - Small readable text.
  - Focus state changes border emphasis instead of adding colorful rings.
- Primary actions use a near-black fill with light text, inverted in dark mode.
- Secondary actions remain outlined.
- Disabled states lower opacity rather than changing to an unrelated color.

**Icons**

- Icons are simple monochrome glyphs, usually unframed.
- Use icon-only actions for familiar external/social destinations.
- Avoid icon containers, colorful icon tiles, or decorative illustrations.

**What To Avoid**

- Marketing hero sections.
- Gradients, glow effects, colorful surfaces, or ornamental backgrounds.
- Large image banners unless the content itself requires imagery.
- Heavy card layouts.
- Bright CTA colors.
- Oversized rounded pills.
- Drop shadows as a primary hierarchy device.
- Dense sidebars, dashboard widgets, or excessive chrome.

The key principle is: make the content feel authored and durable, while the interface feels almost invisible.