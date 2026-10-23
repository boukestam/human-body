// Layers shown in the UI. `ratio` is the simplification target, `error` the
// maximum relative deviation the simplifier may introduce.
export const LAYERS = {
  skin: { label: 'Skin', ratio: 0.45, error: 0.0006 },
  muscles: { label: 'Muscles', ratio: 0.4, error: 0.0007 },
  fasciae: { label: 'Tendons, fasciae & bursae', ratio: 0.4, error: 0.0008 },
  skeleton: { label: 'Bones & teeth', ratio: 0.45, error: 0.0006 },
  ligaments: { label: 'Joints & ligaments', ratio: 0.45, error: 0.0008 },
  heart: { label: 'Heart', ratio: 0.5, error: 0.0005 },
  arteries: { label: 'Arteries', ratio: 0.5, error: 0.0008 },
  veins: { label: 'Veins', ratio: 0.5, error: 0.0008 },
  cns: { label: 'Brain & spinal cord', ratio: 0.45, error: 0.0006 },
  nerves: { label: 'Nerves', ratio: 0.5, error: 0.0008 },
  senses: { label: 'Eye & ear', ratio: 0.6, error: 0.0005 },
  respiratory: { label: 'Respiratory system', ratio: 0.45, error: 0.0007 },
  digestive: { label: 'Digestive system', ratio: 0.45, error: 0.0007 },
  urinary: { label: 'Urinary system', ratio: 0.5, error: 0.0006 },
  reproductive: { label: 'Reproductive system', ratio: 0.5, error: 0.0006 },
  endocrine: { label: 'Endocrine glands', ratio: 0.6, error: 0.0005 },
  lymphatic: { label: 'Lymphatic system', ratio: 0.5, error: 0.0008 },
  attachments: { label: 'Muscle attachments', ratio: 0.35, error: 0.001 },
  references: { label: 'Reference lines & planes', ratio: 1, error: 0 },
};

