# Aether expression sprites v2

Two replacement sheets provide 32 expression states in left- and right-facing variants: 64 sprites total. Each sheet is a transparent RGBA PNG, 887 x 1774 pixels, with four columns and eight rows. The orb and ring are smaller within each cell, leaving wider transparent gaps than v1.

- `public/aether-avatar-sprites-v2-a.png`: everyday, thinking, talking and positive reactions.
- `public/aether-avatar-sprites-v2-b.png`: surprise, stress, mistakes, recovery and sleep.
- `public/aether-avatar-sprites-v2.json`: named frame map with normalized UV coordinates.
- Original avatar and v1 assets are preserved.

Directions describe the whole orb facing toward screen left or screen right. Columns alternate left/right in each row. These are expression poses, not motion animation frames. Exact expressions and registration have small artistic variations.

## Sheet A

| Row | Column 1 | Column 2 | Column 3 | Column 4 |
| --- | --- | --- | --- | --- |
| 1 | neutral left | neutral right | blink left | blink right |
| 2 | curious left | curious right | thinking left | thinking right |
| 3 | calculating left | calculating right | eureka left | eureka right |
| 4 | explaining left | explaining right | listening left | listening right |
| 5 | happy left | happy right | laughing left | laughing right |
| 6 | excited left | excited right | proud left | proud right |
| 7 | confident left | confident right | wink left | wink right |
| 8 | smug left | smug right | skeptical left | skeptical right |

## Sheet B

| Row | Column 1 | Column 2 | Column 3 | Column 4 |
| --- | --- | --- | --- | --- |
| 1 | surprised left | surprised right | shocked left | shocked right |
| 2 | worried left | worried right | fuel-panic left | fuel-panic right |
| 3 | oops left | oops right | embarrassed left | embarrassed right |
| 4 | confused left | confused right | dizzy left | dizzy right |
| 5 | frustrated left | frustrated right | grumpy left | grumpy right |
| 6 | sad left | sad right | crying left | crying right |
| 7 | relieved left | relieved right | determined left | determined right |
| 8 | sleepy left | sleepy right | asleep left | asleep right |

## Integration

For CSS sprites, set `background-size: 400% 800%`. For zero-based column c and row r, use x position `c / 3 * 100%` and y position `r / 7 * 100%`. Use a square element. For a texture atlas, use the normalized UV rectangles in the JSON map. The actual output dimensions differ from the requested dimensions and do not divide into integer pixel frames, so prefer normalized coordinates.

## Provenance and prompts

Generated with the built-in image generation tool using `public/aether-avatar.png` as the character identity reference. Each sheet received a second generation pass to reduce sprite size within its cells. Alpha transparency and dimensions were checked.

### Sheet A prompt

```text
Use case: stylized-concept. Asset: a NEW replacement expression sprite atlas for the Aether space copilot.
Reference image 1 is ONLY the CHARACTER IDENTITY reference. Preserve this ivory spherical robot, glossy dark faceplate, lime digital eyes, slim Saturn-like orbital ring and small satellite bead. Do NOT copy the reference image's tight framing or edge noise.
Create one portrait transparent PNG atlas, ideally 2048 by 4096 pixels, aspect ratio 1:2. EXACTLY FOUR COLUMNS and EIGHT ROWS, 32 sprites. Strict uniform regular grid of SQUARE cells; no cell borders.
CRITICAL SPACING: Each COMPLETE sprite including the entire ring must fit within ONLY the central 60% of its cell's width and central 60% height. Empty transparent padding is 20% on EACH SIDE of EVERY cell. This produces a LARGE visible gap of roughly 40% of a cell between neighboring characters. Make the orbs SMALL within their cells. More empty space is essential. Equal scale and regular centered registration. No art in gutters, no external particles, no glow clouds, no decorative symbols.
CRITICAL DIRECTIONS: Each expression has TWO genuinely distinct viewing directions. In EVERY row, columns 1 and 3 show Aether turned 30 degrees toward SCREEN LEFT; the faceplate is on the LEFT half of the orb, visible ivory side shell on the RIGHT. Columns 2 and 4 show Aether turned 30 degrees toward SCREEN RIGHT; faceplate on the RIGHT half, visible ivory side shell on the LEFT. Both eyes visible in both views. LEFT, RIGHT, LEFT, RIGHT, in every row. Rotation of the WHOLE ORB, not merely sideways pupils. Ring and satellite follow the physical orientation. Preserve identical eye/mouth acting in each left/right pair.
All 32 sprites show the SAME original character. Rounded polished 3D mascot rendering, refined soft studio light, ivory shell and charcoal face, lively pale lime expressions. Clean simple materials, crisp clean alpha edges. Facial acting must be exaggerated, humorous, varied, and readable at small size. Express through eye shapes, digital eyebrows and small lime mouth on display. No limbs, no accessories, no props.
Transparent background with genuine alpha, including ring holes. No floor, shadows, text, labels, letters, numbers, panel lines, watermark or baked checkerboard. No stray translucent dust or edge fragments.

SHEET A, exact row-by-row expressions:
Row 1: col 1 neutral LEFT (attentive oval eyes and relaxed tiny smile); col 2 SAME neutral RIGHT; col 3 blink LEFT (both eyes fully closed in soft arcs); col 4 SAME blink RIGHT.
Row 2: col 1 curious LEFT (one eye larger and a raised eyebrow); col 2 SAME curious RIGHT; col 3 thinking LEFT (eyes rolled upward, tiny pursed mouth); col 4 SAME thinking RIGHT.
Row 3: col 1 calculating LEFT (narrow focused eyes, three tiny lime pixels ON the face display); col 2 SAME calculating RIGHT; col 3 eureka LEFT (wide bright eyes and a delighted open smile); col 4 SAME eureka RIGHT.
Row 4: col 1 explaining LEFT (engaged eyes and a small open talking mouth); col 2 SAME explaining RIGHT; col 3 listening LEFT (soft concentrated eyes, slightly raised brows, closed mouth); col 4 SAME listening RIGHT.
Row 5: col 1 happy LEFT (crescent eyes and a big smile); col 2 SAME happy RIGHT; col 3 laughing LEFT (squeezed laughing eyes, wide open laugh); col 4 SAME laughing RIGHT.
Row 6: col 1 excited LEFT (star-shaped eyes and delighted mouth); col 2 SAME excited RIGHT; col 3 proud LEFT (chin-up attitude, closed pleased smile); col 4 SAME proud RIGHT.
Row 7: col 1 confident LEFT (determined eyes with an asymmetric grin); col 2 SAME confident RIGHT; col 3 wink LEFT (one eye closed and one open, cheeky smile); col 4 SAME wink RIGHT.
Row 8: col 1 smug LEFT (very half-lidded eyes, comically self-satisfied crooked smile); col 2 SAME smug RIGHT; col 3 skeptical LEFT (one brow high, one eye half closed, flat unimpressed mouth); col 4 SAME skeptical RIGHT.
Check before finishing: 4 columns, 8 rows, 32 small sprites, broad consistent transparent gaps, alternating actual LEFT and RIGHT body views.
```

### Sheet B prompt

```text
Use case: stylized-concept. Asset: a NEW replacement expression sprite atlas for the Aether space copilot.
Reference image 1 is ONLY the CHARACTER IDENTITY reference. Preserve this ivory spherical robot, glossy dark faceplate, lime digital eyes, slim Saturn-like orbital ring and small satellite bead. Do NOT copy the reference image's tight framing or edge noise.
Create one portrait transparent PNG atlas, ideally 2048 by 4096 pixels, aspect ratio 1:2. EXACTLY FOUR COLUMNS and EIGHT ROWS, 32 sprites. Strict uniform regular grid of SQUARE cells; no cell borders.
CRITICAL SPACING: Each COMPLETE sprite including the entire ring must fit within ONLY the central 60% of its cell's width and central 60% height. Empty transparent padding is 20% on EACH SIDE of EVERY cell. This produces a LARGE visible gap of roughly 40% of a cell between neighboring characters. Make the orbs SMALL within their cells. More empty space is essential. Equal scale and regular centered registration. No art in gutters, no external particles, no glow clouds, no decorative symbols.
CRITICAL DIRECTIONS: Each expression has TWO genuinely distinct viewing directions. In EVERY row, columns 1 and 3 show Aether turned 30 degrees toward SCREEN LEFT; the faceplate is on the LEFT half of the orb, visible ivory side shell on the RIGHT. Columns 2 and 4 show Aether turned 30 degrees toward SCREEN RIGHT; faceplate on the RIGHT half, visible ivory side shell on the LEFT. Both eyes visible in both views. LEFT, RIGHT, LEFT, RIGHT, in every row. Rotation of the WHOLE ORB, not merely sideways pupils. Ring and satellite follow the physical orientation. Preserve identical eye/mouth acting in each left/right pair.
All 32 sprites show the SAME original character. Rounded polished 3D mascot rendering, refined soft studio light, ivory shell and charcoal face, lively pale lime expressions. Clean simple materials, crisp clean alpha edges. Facial acting must be exaggerated, humorous, varied, and readable at small size. Express through eye shapes, digital eyebrows and small lime mouth on display. No limbs, no accessories, no props.
Transparent background with genuine alpha, including ring holes. No floor, shadows, text, labels, letters, numbers, panel lines, watermark or baked checkerboard. No stray translucent dust or edge fragments.

SHEET B, exact row-by-row expressions:
Row 1: col 1 surprised LEFT (huge round eyes and a small O mouth); col 2 SAME surprised RIGHT; col 3 shocked LEFT (very tall eyes and a large open O mouth); col 4 SAME shocked RIGHT.
Row 2: col 1 worried LEFT (raised inner brows and a small downturned mouth); col 2 SAME worried RIGHT; col 3 fuel-panic LEFT (asymmetric enormous eyes, wobbly zigzag mouth, one sweat mark ON the screen); col 4 SAME fuel-panic RIGHT.
Row 3: col 1 oops LEFT (sheepish sideways gaze and awkward crooked smile); col 2 SAME oops RIGHT; col 3 embarrassed LEFT (downward bashful eyes and tiny shy smile, two lime cheek marks ON the screen); col 4 SAME embarrassed RIGHT.
Row 4: col 1 confused LEFT (uneven eyes, one raised eyebrow, twisted mouth); col 2 SAME confused RIGHT; col 3 dizzy LEFT (two spiral eyes and wavy mouth); col 4 SAME dizzy RIGHT.
Row 5: col 1 frustrated LEFT (angled eyebrows and clenched little digital teeth); col 2 SAME frustrated RIGHT; col 3 grumpy LEFT (deeply lowered eyelids and exaggerated pout); col 4 SAME grumpy RIGHT.
Row 6: col 1 sad LEFT (large sorrowful eyes and downturned mouth); col 2 SAME sad RIGHT; col 3 crying LEFT (watery eyes and tiny tear shapes entirely ON the faceplate); col 4 SAME crying RIGHT.
Row 7: col 1 relieved LEFT (closed soft eyes and relieved little smile); col 2 SAME relieved RIGHT; col 3 determined LEFT (sharp focused eyes and firm confident mouth); col 4 SAME determined RIGHT.
Row 8: col 1 sleepy LEFT (heavy sleepy eyelids and small yawning mouth); col 2 SAME sleepy RIGHT; col 3 asleep LEFT (fully closed horizontal eyes and tiny relaxed mouth, no letters); col 4 SAME asleep RIGHT.
FINAL OVERRIDING LAYOUT REQUIREMENT: These must be SMALL floating orbs separated by HUGE transparent gaps. Each orb INCLUDING RING only HALF as wide as its grid cell. At a 2048px canvas width, each cell is512 wide but the orb INCLUDING RING is only256 wide; remaining256 pixels are empty. At any other output size preserve those ratios. Similar HALF-cell height. Do NOT enlarge sprites to fill grid cells. Do NOT let rings nearly touch. STRICT ALTERNATING LEFT / RIGHT physical turns.
```

### Spacing correction applied to both sheets

```text
Edit each sheet: preserve the exact 4-column by 8-row arrangement, all expressions and alternating left/right physical turns. Shrink each entire sprite including its ring to 55% of its current width and height, in place at the same cell center. Keep canvas size and transparency. Leave large transparent gaps. Remove stray edge fragments; add no art or text.
```

