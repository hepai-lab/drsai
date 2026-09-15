import { runtimeConversationDigest } from "../../shared/main/threadRuntimeProjection.ts";
import type { RuntimeConversationItem } from "../../shared/main/runtimeClient.ts";

process.stdin.setEncoding("utf8");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const value = JSON.parse(input) as { items?: RuntimeConversationItem[] };
if (!Array.isArray(value.items)) throw new Error("conversation_digest_items_missing");
process.stdout.write(`${runtimeConversationDigest(value.items)}\n`);
