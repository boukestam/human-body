// Structures taken from the HuBMAP Human Reference Atlas to fill gaps in
// Z-Anatomy: the female reproductive organs and breast, and gut segments that
// Z-Anatomy lacks (both sexes).

const FEMALE_GENITAL = ['Visceral systems', 'Genital systems', 'Female genital system'];
const INTERNAL = [...FEMALE_GENITAL, 'Female internal genitalia'];
const LIGS = [...INTERNAL, 'Ligaments of uterus and ovaries'];
const BREAST = ['Integumentary system', 'Breast'];
const LARGE = ['Visceral systems', 'Digestive system', 'Digestive canal', 'Large intestine'];
const SMALL = ['Visceral systems', 'Digestive system', 'Digestive canal', 'Small intestine'];

// [node name (without VH_F_ / VH_M_ prefix), display name, side, layer, tissue, path]
const female = [
  ['body_of_uterus', 'Body of uterus', '', 'reproductive', 'uterus', [...INTERNAL, 'Uterus']],
  ['fundus_of_uterus', 'Fundus of uterus', '', 'reproductive', 'uterus', [...INTERNAL, 'Uterus']],
  ['cornua', 'Uterine horn', '', 'reproductive', 'uterus', [...INTERNAL, 'Uterus']],
  ['lower_uterine_segment', 'Isthmus of uterus', '', 'reproductive', 'uterus', [...INTERNAL, 'Uterus']],
  ['anterior_wall_of_uterus', 'Anterior wall of uterus', '', 'reproductive', 'uterus', [...INTERNAL, 'Uterus']],
  ['posterior_wall_of_uterus', 'Posterior wall of uterus', '', 'reproductive', 'uterus', [...INTERNAL, 'Uterus']],
  ['cervix', 'Cervix of uterus', '', 'reproductive', 'uterus', [...INTERNAL, 'Uterus']],
  ['internal_cervical_os', 'Internal os of uterus', '', 'reproductive', 'mucosa', [...INTERNAL, 'Uterus']],
  ['external_cervical_os', 'External os of uterus', '', 'reproductive', 'mucosa', [...INTERNAL, 'Uterus']],
  ['abdominal_ostium_of_uterine_tube', 'Abdominal ostium of uterine tube', '', 'reproductive', 'mucosa', [...INTERNAL, 'Uterine tube']],
  ['left_ovary', 'Ovary', 'l', 'reproductive', 'ovary', [...INTERNAL, 'Ovary']],
  ['right_ovary', 'Ovary', 'r', 'reproductive', 'ovary', [...INTERNAL, 'Ovary']],
  ...['L', 'R'].flatMap((S) => [
    [`ampulla_of_uterine_tube_${S}`, 'Ampulla of uterine tube'],
    [`isthmus_of_fallopian_tube_${S}`, 'Isthmus of uterine tube'],
    [`uterine_tube_infundibulum_${S}`, 'Infundibulum of uterine tube'],
    [`fibria_of_uterine_tube_${S}`, 'Fimbriae of uterine tube'],
  ].map(([n, d]) => [n, d, S.toLowerCase(), 'reproductive', 'tube', [...INTERNAL, 'Uterine tube']])),
  ['vagina', 'Vagina', '', 'reproductive', 'mucosa', [...INTERNAL, 'Vagina']],
  ['cervicovaginal_junction', 'Vaginal fornix', '', 'reproductive', 'mucosa', [...INTERNAL, 'Vagina']],
  ['broad_ligament', 'Broad ligament of uterus', '', 'reproductive', 'peritoneum', LIGS],
  ['uterovesical_pouch', 'Vesico-uterine pouch', '', 'reproductive', 'peritoneum', LIGS],
  ['left_round_ligament_of_uterus', 'Round ligament of uterus', 'l', 'reproductive', 'ligament', LIGS],
  ['right_round_ligament_of_uterus', 'Round ligament of uterus', 'r', 'reproductive', 'ligament', LIGS],
  ['left_uterosacral_ligament', 'Uterosacral ligament', 'l', 'reproductive', 'ligament', LIGS],
  ['right_uterosacral_ligament', 'Uterosacral ligament', 'r', 'reproductive', 'ligament', LIGS],
  ['left_cardinal_ligament_of_uterus', 'Cardinal ligament', 'l', 'reproductive', 'ligament', LIGS],
  ['right_cardinal_ligament_of_uterus', 'Cardinal ligament', 'r', 'reproductive', 'ligament', LIGS],
  ...['L', 'R'].flatMap((S) => [
    [`suspensory_ligament_of_ovary_${S}`, 'Suspensory ligament of ovary', 'ligament'],
    [`ovarian_ligament_${S}`, 'Ligament of ovary', 'ligament'],
    [`mesosalpinx_${S}`, 'Mesosalpinx', 'peritoneum'],
    [`mesovarium_${S}`, 'Mesovarium', 'peritoneum'],
  ].map(([n, d, t]) => [n, d, S.toLowerCase(), 'reproductive', t, LIGS])),
  ...['L', 'R'].flatMap((S) => [
    [`fat_${S}`, 'Fatty tissue of breast', 'breastFat'],
    [`mammary_lobes_${S}`, 'Lobes of mammary gland', 'gland'],
    [`main_lactiferous_ducts_${S}`, 'Lactiferous ducts', 'duct'],
    [`main_lactiferous_sinuses_${S}`, 'Lactiferous sinuses', 'duct'],
    [`suspensory_ligaments_${S}`, 'Suspensory ligaments of breast', 'ligament'],
    [`nipple_${S}`, 'Nipple', 'nipple'],
    [`areola_${S}`, 'Areola', 'nipple'],
    [`areolar_tubercles_${S}`, 'Areolar glands', 'nipple'],
  ].map(([n, d, t]) => [n, d, S.toLowerCase(), 'reproductive', t, [...BREAST, 'Mammary gland']])),
  ['left_uterine_artery', 'Uterine artery', 'l', 'arteries', 'artery', ['Cardiovascular system', 'Arterial system', 'Systemic arteries', 'Arteries of pelvis']],
  ['right_uterine_artery', 'Uterine artery', 'r', 'arteries', 'artery', ['Cardiovascular system', 'Arterial system', 'Systemic arteries', 'Arteries of pelvis']],
  ['left_uterine_vein', 'Uterine vein', 'l', 'veins', 'vein', ['Cardiovascular system', 'Venous system', 'Systemic veins', 'Veins of pelvis']],
  ['right_uterine_vein', 'Uterine vein', 'r', 'veins', 'vein', ['Cardiovascular system', 'Venous system', 'Systemic veins', 'Veins of pelvis']],
];

// Gut segments for both sexes. The HRA geometry is registered onto the colon of
// the body it is added to (see supplement.mjs).
const gut = [
  ['caecum', 'Caecum', '', 'digestive', 'intestine', LARGE],
  ['rectum', 'Rectum', '', 'digestive', 'intestine', LARGE],
  ['ileocecal_valve', 'Ileal orifice', '', 'digestive', 'mucosa', LARGE],
  ['ileum', 'Ileum', '', 'digestive', 'intestine', SMALL],
  ['ileum_terminal', 'Terminal ileum', '', 'digestive', 'intestine', SMALL],
];

export const FEMALE_STRUCTURES = female.map(([node, name, side, layer, tissue, path]) => ({ node: `VH_F_${node}`, name, side, layer, tissue, path, sex: 'f' }));
export const GUT_STRUCTURES = gut.map(([node, name, side, layer, tissue, path]) => ({ node, name, side, layer, tissue, path }));

// Z-Anatomy structures that only exist in the male body.
export const MALE_ONLY = /\bpenis|penile|testicular|^testis|scrot|prostat|sperm|seminal|ejaculat|epididym|deferens|cremaster|glans|corpus (cavernosum|spongiosum)|^urethra$|bulbourethral/i;

// Nicer description lookups for names that differ from the description files.
export const DESC_ALIASES = { Caecum: 'Cecum', 'Ileal orifice': 'Ileocecal valve', 'Uterine horn': 'Uterus', 'Isthmus of uterus': 'Uterus' };
