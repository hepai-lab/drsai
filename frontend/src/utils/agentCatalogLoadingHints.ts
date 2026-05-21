const BASE_HINTS = [
  "正在同步平台上的最新智能体…",
  "正在为你准备智能体…",
  "马上就好，先喝口水 ☕",
  "列表快出来了，再稍等片刻～",
];

export function buildCatalogLoadingHints(
  defaultAgentName?: string | null,
): string[] {
  const name = (defaultAgentName || "").trim();
  if (!name) return [...BASE_HINTS];
  return [
    BASE_HINTS[0],
    BASE_HINTS[1],
    `正在寻找「${name}」…`,
    BASE_HINTS[2],
    BASE_HINTS[3],
  ];
}
