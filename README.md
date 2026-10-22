# Human Body Atlas

An interactive, browser-based 3D atlas of the complete adult human body. Over 3,600 individually selectable
anatomical structures, organised into toggleable layers, with free-orbit, X-ray and cross-section views.

## Features

- **Complete anatomy** – every bone and tooth, 480 muscles with tendons, fasciae, bursae and tendon sheaths,
  ~400 joints & ligaments, the heart (chambers, valves, coronary vessels), ~420 arteries and ~230 veins,
  brain (gyri, sulci, nuclei, ventricles), brainstem nuclei and spinal cord tracts, cranial and spinal nerves and
  plexuses, eye and ear, respiratory, digestive, urinary, reproductive and endocrine organs, 160+ lymph node groups,
  skin regions, plus 459 muscle origin / insertion areas and anatomical reference lines and planes.
- **19 layers** (skin, muscles, tendons & fasciae, bones, ligaments, heart, arteries, veins, brain & spinal cord, nerves,
  eye & ear, respiratory, digestive, urinary, reproductive, endocrine, lymphatic, muscle attachments, references), each
  with visibility and opacity controls, plus a full hierarchical anatomy tree where any group or structure can be shown
  or hidden.
- **Views**
  - *3D Anatomy*: orbit / pan / zoom, camera presets (front, back, left, right, top, bottom), exploded view.
  - *X-ray*: a simulated radiograph. Every visible closed surface contributes its density-weighted thickness
    (front faces subtract depth, back faces add it) and the line integral is mapped to film brightness with
    Beer–Lambert attenuation. Exposure, contrast, edge enhancement and negative film are adjustable.
  - *Slice*: transverse (axial / horizontal), coronal and sagittal (vertical) cutting planes with solid cut surfaces
    in 3D, an optional slab thickness, and a live 2D cross-section computed exactly from the meshes, shown in atlas,
    CT or MRI (T1) style with labels, hover identification and the vertebral level.
- **Mobile-first interface** – full-screen 3D view with a draggable bottom sheet (layers, anatomy tree, details), touch gestures (tap to select, double-tap to zoom, pinch/pan in the 2D section), and a sidebar layout on desktop.
- **Search** across all structures and groups, selection with descriptions (from Wikipedia), focus, hide, isolate,
  fade-others, jump to the opposite side, colour schemes (realistic, by system, muscles by action).

## Running

```bash
npm install
npm run dev       # development server
npm run build     # static build in dist/ (can be hosted anywhere)
```

Keyboard: `1` 3D · `2` X-ray · `3` slice · `H` hide · `I` isolate · `A` show all · `F` focus · `G` fade others ·
`R` reset camera · `/` search · `↑`/`↓` move the slice plane.

## Data pipeline

The optimised models in `public/data` are generated from the Z-Anatomy source files:

```bash
npm run fetch:data   # downloads the Z-Anatomy FBX models and descriptions to /tmp/za
npm run build:data   # converts them into per-layer meshopt-compressed GLB files + metadata
```

`tools/build-models.mjs` parses the FBX hierarchy, classifies every object into a layer and tissue type, fixes
mirrored geometry, welds and simplifies meshes, tags watertightness (for the X-ray renderer), and writes
`public/data/models/*.glb`, `public/data/meta.json` and sharded descriptions.

## Credits & licence

- 3D anatomy: [Z-Anatomy](https://www.z-anatomy.com/) by Lluís Vinent and Gauthier Kervyn, licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), itself based on
  [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/), © The Database Center for Life Science,
  licensed CC BY-SA 2.1 Japan.
- Structure descriptions: Wikipedia contributors, CC BY-SA.
- The converted model and description files in `public/data` are therefore distributed under CC BY-SA 4.0.

For education only — not for diagnosis.
