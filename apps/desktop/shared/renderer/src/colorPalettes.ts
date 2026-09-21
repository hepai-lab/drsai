export type ColorPaletteId =
  | "classic-lilac"
  | "signal-vault"
  | "archive-cobalt"
  | "glacier"
  | "turquoise-lagoon"
  | "jade-imperial"
  | "olive-atelier"
  | "moss-stone"
  | "obsidian-amber"
  | "graphite-champagne"
  | "sand-dune"
  | "cinnabar-ink"
  | "bordeaux-velvet"
  | "dusk-rosewood"
  | "orchid-salon"
  | "amethyst-crown"
  | "indigo-scroll"
  | "navy-ledger"
  | "slate-harbor";

export type ColorPaletteMeta = {
  id: ColorPaletteId;
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
  /** Preview strip — paper / dock / accent / highlight / text */
  swatches: {
    surface: string;
    sidebar: string;
    accent: string;
    highlight: string;
    text: string;
  };
};

export const DEFAULT_COLOR_PALETTE: ColorPaletteId = "slate-harbor";

/** Featured strip in Settings — remaining palettes live behind "More". */
export const FEATURED_COLOR_PALETTE_IDS: readonly ColorPaletteId[] = [
  "slate-harbor",
  "classic-lilac",
  "glacier",
  "jade-imperial",
  "obsidian-amber",
  "cinnabar-ink",
] as const;

/**
 * Quiet Atelier — all eighteen palettes at the same quality bar.
 * Soft luminous paper × deeper jewel dock × clear accent × soft charcoal text.
 */
export const COLOR_PALETTES: ColorPaletteMeta[] = [
  {
    id: "classic-lilac",
    nameZh: "经典丁香",
    nameEn: "Classic Lilac",
    descZh: "系统配色前的原版：淡紫灰底 · 长春花强调。",
    descEn: "Original pre-palette theme: soft lilac · periwinkle accent.",
    swatches: { surface: "#f7f8fb", sidebar: "#f0f1f7", accent: "#6d7fdb", highlight: "#c4c8f0", text: "#2d2d3f" },
  },
  {
    id: "signal-vault",
    nameZh: "信号台",
    nameEn: "Signal Vault",
    descZh: "冷珍珠纸面 · 青绿码头 · 仪器宝石强调。",
    descEn: "Cool pearl · teal dock · instrument jewel.",
    swatches: { surface: "#f1f4f4", sidebar: "#c9deda", accent: "#2f746e", highlight: "#68a8a0", text: "#2c3434" },
  },
  {
    id: "archive-cobalt",
    nameZh: "档案馆",
    nameEn: "Archive Cobalt",
    descZh: "冷雾纸面 · 钴蓝码头 · 蓝图宝石强调。",
    descEn: "Cool mist · cobalt dock · blueprint jewel.",
    swatches: { surface: "#f2f3f6", sidebar: "#d2dced", accent: "#3a5688", highlight: "#7a92b8", text: "#2e343e" },
  },
  {
    id: "glacier",
    nameZh: "冰川",
    nameEn: "Glacier",
    descZh: "冰雾纸面 · 极地码头 · 冰川宝石强调。",
    descEn: "Ice mist · polar dock · glacier jewel.",
    swatches: { surface: "#f1f4f6", sidebar: "#c7dfe8", accent: "#2f6f86", highlight: "#6aa0b4", text: "#2c363c" },
  },
  {
    id: "turquoise-lagoon",
    nameZh: "泻湖",
    nameEn: "Turquoise Lagoon",
    descZh: "水雾纸面 · 泻湖码头 · 松石宝石强调。",
    descEn: "Water mist · lagoon dock · turquoise jewel.",
    swatches: { surface: "#f1f4f3", sidebar: "#c5e0d8", accent: "#2f7a6a", highlight: "#68a898", text: "#2c3634" },
  },
  {
    id: "jade-imperial",
    nameZh: "帝青玉",
    nameEn: "Imperial Jade",
    descZh: "青瓷纸面 · 翡翠码头 · 帝玉宝石强调。",
    descEn: "Celadon · jade dock · imperial jewel.",
    swatches: { surface: "#f1f4f2", sidebar: "#c6e0d2", accent: "#2f7a54", highlight: "#68a888", text: "#2c3630" },
  },
  {
    id: "olive-atelier",
    nameZh: "橄榄作坊",
    nameEn: "Olive Atelier",
    descZh: "亚麻纸面 · 画室码头 · 橄榄宝石强调。",
    descEn: "Linen · atelier dock · olive jewel.",
    swatches: { surface: "#f3f3ee", sidebar: "#d8dcc4", accent: "#646a40", highlight: "#949c70", text: "#32342c" },
  },
  {
    id: "moss-stone",
    nameZh: "苔石",
    nameEn: "Moss Stone",
    descZh: "石雾纸面 · 苔绿码头 · 庭园宝石强调。",
    descEn: "Stone mist · moss dock · garden jewel.",
    swatches: { surface: "#f2f3f1", sidebar: "#cdd8ce", accent: "#4e6c58", highlight: "#82a090", text: "#2e3430" },
  },
  {
    id: "obsidian-amber",
    nameZh: "曜石琥珀",
    nameEn: "Obsidian Amber",
    descZh: "骨色纸面 · 琥珀码头 · 干邑宝石强调。",
    descEn: "Bone · amber dock · cognac jewel.",
    swatches: { surface: "#f4f2ed", sidebar: "#e4d6be", accent: "#8f5e32", highlight: "#c09860", text: "#343028" },
  },
  {
    id: "graphite-champagne",
    nameZh: "石墨香槟",
    nameEn: "Graphite Champagne",
    descZh: "铂金纸面 · 香槟码头 · 腕表宝石强调。",
    descEn: "Platinum · champagne dock · watch jewel.",
    swatches: { surface: "#f3f2ee", sidebar: "#e0d6c0", accent: "#7e6440", highlight: "#b09870", text: "#322e28" },
  },
  {
    id: "sand-dune",
    nameZh: "沙丘",
    nameEn: "Sand Dune",
    descZh: "沙雾纸面 · 沙丘码头 · 旅舍宝石强调。",
    descEn: "Sand mist · dune dock · lodge jewel.",
    swatches: { surface: "#f4f2eb", sidebar: "#e4d8c0", accent: "#7e6a46", highlight: "#b0a080", text: "#343028" },
  },
  {
    id: "cinnabar-ink",
    nameZh: "朱砂墨",
    nameEn: "Cinnabar Ink",
    descZh: "宣纸纸面 · 朱红码头 · 印章宝石强调。",
    descEn: "Rice paper · vermilion dock · seal jewel.",
    swatches: { surface: "#f4f1f0", sidebar: "#e2cece", accent: "#8e444c", highlight: "#c07880", text: "#343030" },
  },
  {
    id: "bordeaux-velvet",
    nameZh: "波尔多绒",
    nameEn: "Bordeaux Velvet",
    descZh: "丝绒纸面 · 酒红码头 · 剧院宝石强调。",
    descEn: "Velvet · wine dock · theatre jewel.",
    swatches: { surface: "#f3f0f2", sidebar: "#e0ced8", accent: "#7e3e54", highlight: "#b07088", text: "#322e32" },
  },
  {
    id: "dusk-rosewood",
    nameZh: "暮色红木",
    nameEn: "Dusk Rosewood",
    descZh: "暮色纸面 · 红木码头 · 书房宝石强调。",
    descEn: "Dusk · rosewood dock · study jewel.",
    swatches: { surface: "#f3f1ef", sidebar: "#e0d2c8", accent: "#6e4e40", highlight: "#a08070", text: "#322e2a" },
  },
  {
    id: "orchid-salon",
    nameZh: "兰沙龙",
    nameEn: "Orchid Salon",
    descZh: "兰雾纸面 · 品红码头 · 沙龙宝石强调。",
    descEn: "Orchid mist · magenta dock · salon jewel.",
    swatches: { surface: "#f3f0f4", sidebar: "#e0d0e0", accent: "#7e4a6e", highlight: "#b080a0", text: "#322e32" },
  },
  {
    id: "amethyst-crown",
    nameZh: "紫晶冠",
    nameEn: "Amethyst Crown",
    descZh: "银紫纸面 · 紫晶码头 · 王冠宝石强调。",
    descEn: "Silver-lilac · amethyst dock · crown jewel.",
    swatches: { surface: "#f2f0f5", sidebar: "#d8cce8", accent: "#5e4e88", highlight: "#9484b4", text: "#302e38" },
  },
  {
    id: "indigo-scroll",
    nameZh: "靛卷轴",
    nameEn: "Indigo Scroll",
    descZh: "古籍纸面 · 靛蓝码头 · 卷轴宝石强调。",
    descEn: "Manuscript · indigo dock · scroll jewel.",
    swatches: { surface: "#f1f2f5", sidebar: "#d0d8e8", accent: "#425688", highlight: "#7888b0", text: "#2e323c" },
  },
  {
    id: "navy-ledger",
    nameZh: "海军账册",
    nameEn: "Navy Ledger",
    descZh: "账册纸面 · 海军码头 · 旗舰宝石强调。",
    descEn: "Ledger · navy dock · flagship jewel.",
    swatches: { surface: "#f1f3f5", sidebar: "#ced8e4", accent: "#364a6a", highlight: "#6a7e98", text: "#2e343c" },
  },
  {
    id: "slate-harbor",
    nameZh: "石板港",
    nameEn: "Slate Harbor",
    descZh: "冷珍珠纸面 · 雾蓝码头 · 钢蓝宝石强调。",
    descEn: "Cool pearl · mist dock · steel jewel.",
    swatches: { surface: "#f2f3f5", sidebar: "#d9e1ec", accent: "#3f6a94", highlight: "#7a98b8", text: "#303640" },
  },
];

export function isColorPaletteId(value: string | null | undefined): value is ColorPaletteId {
  return COLOR_PALETTES.some((palette) => palette.id === value);
}
