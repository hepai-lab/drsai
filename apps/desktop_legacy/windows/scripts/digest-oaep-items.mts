import { readFileSync } from "node:fs";

import { oaepItemsDigest } from "../../shared/main/oaepDigest.ts";
import type { OaepItem } from "../../shared/api/oaep.generated.ts";

const value = JSON.parse(readFileSync(0, "utf8")) as { items?: OaepItem[] };
if (!Array.isArray(value.items)) throw new Error("oaep_digest_items_invalid");
process.stdout.write(oaepItemsDigest(value.items));
