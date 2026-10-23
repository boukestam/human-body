# Human Body Atlas

An interactive, mobile-first 3D atlas of the complete adult human body — **male and female** — with over 3,700
individually selectable anatomical structures in toggleable layers, plus free-orbit, X-ray and cross-section views.

## Features

- **Male and female bodies** – switch with *Body: Male / Female* in the Layers panel (or `#sex=f` in the URL).
- **Complete anatomy** – every bone and tooth, 480 muscles with tendons, fasciae, bursae and tendon sheaths,
  ~400 joints & ligaments, the heart (chambers, valves, coronary vessels), ~420 arteries and ~230 veins,
  brain (gyri, sulci, nuclei, ventricles), brainstem nuclei and spinal cord tracts, cranial and spinal nerves and
  plexuses, eye and ear, respiratory, digestive (including caecum, ileum and rectum), urinary, endocrine and lymphatic
  organs, 160+ lymph node groups, skin regions, 459 muscle origin / insertion areas, and anatomical reference lines.
  - Male reproductive system: testes, epididymides, ductus deferentes, seminal glands, prostate, penis.
  - Female reproductive system: uterus (fundus, body, isthmus, cervix, walls), ovaries, uterine tubes (infundibulum,
    fimbriae, ampulla, isthmus), vagina, broad / round / cardinal / uterosacral / ovarian / suspensory ligaments,
    mesosalpinx, mesovarium, uterine arteries and veins, and the breasts (lobes, lactiferous ducts and sinuses,
    suspensory ligaments, fat, nipple, areola).
- **19 layers** with visibility and opacity controls, and a hierarchical anatomy tree where any group or structure can
  be shown or hidden.
- **Views**
  - *3D*: orbit / pan / zoom, camera presets, exploded view, solid / glass / wireframe styles.
  - *X-ray*: a simulated radiograph. Every visible closed surface contributes its density-weighted thickness (front
    faces subtract depth, back faces add it) and the line integral is mapped to film brightness with Beer–Lambert
    attenuation. Exposure, contrast, edge enhancement and negative film are adjustable.
  - *Slice*: transverse (horizontal), coronal and sagittal (vertical) cutting planes with solid cut surfaces in 3D,
    an optional slab thickness, and a live 2D cross-section computed exactly from the meshes, in atlas, CT or MRI
    style with labels, hover / tap identification and the vertebral level.
- **Mobile-first interface** – full-screen 3D view with a draggable bottom sheet (layers, anatomy tree, details),
  touch gestures (tap to select, double-tap to zoom, pinch / pan in the 2D section), and a sidebar layout on desktop.
- **Search**, selection with descriptions, focus, hide, isolate, fade-others, opposite side, colour schemes
  (realistic, by system, muscles by action) and shareable links.

## Running

```bash
npm install
npm run dev       # development server
npm run build     # static build in dist/ (can be hosted anywhere)
```

Keyboard: `1` 3D · `2` X-ray · `3` slice · `H` hide · `I` isolate · `A` show all · `F` focus · `G` fade others ·
`R` reset camera · `/` search · `↑`/`↓` move the slice plane.

## Rendering

Each layer is a single merged mesh per body (≈ 40 draw calls for the whole model). Per-structure state — visibility,
highlight, colour, explode offset and X-ray density — lives in small float textures indexed by a per-vertex part id,
so selection, hiding and fading never touch the geometry. Picking renders a 1×1-pixel id pass under the pointer.

## Data pipeline

```bash
npm run fetch:data   # downloads Z-Anatomy (FBX + descriptions) and the HuBMAP reference bodies
npm run build:data   # builds public/data for both bodies (~3 minutes)
```

`tools/build-models.mjs`:

1. Parses the Z-Anatomy FBX hierarchy into structures, layers and tissues (`tools/lib/za.mjs`).
2. Builds the **female body**: the Z-Anatomy model is warped onto the HuBMAP *Visible Human Female* body. Her arms
   are first matched with a shoulder rig (`pose.mjs`), then ~1,600 corresponding landmarks (vertebrae, pelvis, leg
   bones, and skin points sampled by rays around the torso, head, legs and arms; `landmarks.mjs`, `female.mjs`) drive
   a smooth radial-basis-function space warp (`rbf.mjs`). Male-only structures are removed; the female reproductive
   organs, breasts and uterine vessels are added from the female reference body, and her real skin surface replaces
   the warped one (split into the Z-Anatomy skin regions).
3. Adds the **caecum, ileum and rectum** (absent from Z-Anatomy) to both bodies from the HuBMAP male / female bodies,
   registered on the pelvic bones and snapped onto the colon (`supplement.mjs`).
4. Simplifies every part, merges each layer into one quantised, meshopt-compressed GLB per body (`gltf.mjs`) and writes
   `meta.json` and sharded descriptions.

## Credits & licences

- 3D anatomy: [Z-Anatomy](https://www.z-anatomy.com/) by Lluís Vinent and Gauthier Kervyn, licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), based on
  [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/), © The Database Center for Life Science,
  CC BY-SA 2.1 Japan.
- Female body, female reproductive organs and breasts, and gut segments: HuBMAP
  [Human Reference Atlas 3D Reference Object Library](https://humanatlas.io/3d-reference-library) (v1.3), Kristen Browne,
  Heidi Schlehlein et al., [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), created from the Visible Human
  Project data of the U.S. National Library of Medicine.
- Structure descriptions: Wikipedia contributors, CC BY-SA.
- The converted model and description files in `public/data` are distributed under CC BY-SA 4.0.

For education only — not for diagnosis.
