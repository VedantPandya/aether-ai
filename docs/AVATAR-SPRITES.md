# Aether avatar expressions

Generated with the built-in image generation tool using `public/aether-avatar.png` as the character reference. The transparent PNG is saved at `public/aether-avatar-sprites-v1.png` (1254 by 1254 pixels, RGBA; transparency verified).

The sheet contains 16 expression poses in a 4 by 4 grid, read left to right, top to bottom. These are discrete expressions, rather than consecutive frames of a movement animation.

| Row | Column 1 | Column 2 | Column 3 | Column 4 |
| --- | --- | --- | --- | --- |
| 1 | Idle | Blink | Curious | Thinking |
| 2 | Calculating | Explaining | Confident wink | Excited |
| 3 | Celebrating | Smug | Surprised | Worried |
| 4 | Fuel panic | Oops | Skeptical | Sleepy |

For CSS background sprites, use `background-size: 400% 400%`; columns and rows use background positions `0%`, `33.333333%`, `66.666667%`, and `100%`. Poses have slight artistic variation in scale and position. The generated resolution differs from the requested 2048 pixels and is not divisible by four, so use percentage positions rather than assuming integer 512-pixel frames.

## Generation prompt

```text
Use case: stylized-concept.
Asset type: production expression sprite sheet for Aether, a cute humorous autonomous space-exploration AI copilot.
Input image 1: character identity reference, the existing Aether avatar. Preserve this character's ivory spherical shell, oversized glossy charcoal faceplate, luminous pale-lime eyes, thin metallic orbital ring with lime edge and a tiny orbiting satellite bead, and refined rounded 3D materials. This is the SAME character in every cell.
Primary request: Create ONE transparent PNG sprite atlas, square 2048x2048 pixels if possible, arranged as an EXACT 4-column by 4-row uniform grid, 16 separate full-character sprites. Each cell is 512x512 at that resolution. No gutters between cells, but generous transparent padding WITHIN each cell. Sprite center exactly at the center of its cell. Keep the full orbital ring and all effects comfortably within each cell's central 84%. No cropping, no overlaps, no layout drift. Consistent character size, camera, shell proportions, ring design, lighting, and faceplate. Floating orb only, no added arms, legs or bodies.
Style: polished playful sculptural 3D game mascot, clear silhouettes and exaggerated readable expressions, warm Pixar-like charm without copying an existing character. Cute, witty, slightly mischievous space nerd. Eyes should be big enough to read at small UI size. Let the lime eye shapes, tiny luminous mouth/brow marks on the screen and subtle tilt/squash of the orb carry the acting. Mouth and expressive digital eyebrows are allowed on the faceplate. Humour comes from character acting, not written jokes. Maintain original sophisticated ivory, charcoal, pale-lime palette.
Exact row-major cell contents, left to right:
Row 1: (1) idle: friendly attentive oval eyes, tiny smile; (2) blink: eyes closed in relaxed arcs; (3) curious: head cocked slightly, one eye bigger, tiny questioning mouth; (4) thinking: narrowed eyes glancing upward, tiny pursed mouth, slight ring tilt.
Row 2: (5) calculating: intensely focused eyes, tiny lime data specks contained on face screen; (6) explaining: bright engaged eyes and cheerful small open talking mouth; (7) confident: cheeky one-eye wink and asymmetric grin; (8) excited: delighted star-shaped eyes, huge joyful screen smile.
Row 3: (9) celebrating: happy squeezed eye arcs, joyful mouth, four tiny lime confetti flecks contained inside cell; (10) smug: half-lidded eyes and hilariously self-satisfied tiny grin; (11) surprised: huge round eyes, tiny O mouth, slight backward tilt; (12) worried: upward angled brows and uneasy little mouth.
Row 4: (13) fuel panic: comically huge uneven eyes, anxious zigzag mouth and ONE little lime digital sweat drop beside face; (14) oops: sheepish sideways eyes, awkward tiny smile, tilted ring; (15) skeptical: one eyebrow raised, one eye half closed, unimpressed mouth; (16) sleepy: heavy-lidded eyes, tiny yawning mouth, slightly drooping ring, no text.
Scene/backdrop: actual transparent alpha background throughout the sheet including spaces between each orb and inside ring gaps. No floor or environment. Soft consistent studio highlights on each character, no background shadow.
Constraints: exactly sixteen sprites in a strict uniform 4x4 grid. No labels, captions, numbers, letters, grid lines, panel borders, watermark, logos, props, background, gradients behind sprites or checkerboard baked into image. Every cell contains the same original Aether orb with a different clearly distinct expression.
```

