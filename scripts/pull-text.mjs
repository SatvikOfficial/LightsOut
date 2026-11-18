#!/usr/bin/env node
/**
 * pull-text.mjs — pull ALL ingested text from the Qdrant collection
 * `v3_document_ingest` for a given key/value (patientId, ehrId, userId,
 * tenant_id, encounterId, documentId, recordType, sourceType, ... any
 * payload key).
 *
 * Backend: http://10.10.110.24:6333  (Qdrant 1.15.1)
 *
 * Usage:
 *   node scripts/pull-text.mjs <key> <value> [options]
 *   node scripts/pull-text.mjs <key> <value> --out all.txt      # also save to file
 *   node scripts/pull-text.mjs <key> <value> --meta             # print payload meta per chunk
 *
 * Examples:
 *   node scripts/pull-text.mjs patientId JINI-2026-USTN-FTMB
 *   node scripts/pull-text.mjs ehrId     EHR-2026-XXXX-XXXX
 *   node scripts/pull-text.mjs any       JINI-2026-USTN-FTMB    # search ALL id-like keys
 */

const QDRANT_URL = process.env.QDRANT_URL || "http://10.10.110.24:6333";
const COLLECTION = process.env.QDRANT_COLLECTION || "v3_document_ingest";

// id-like payload keys — used by the "any" pseudo-key
const ID_KEYS = ["patientId", "ehrId", "userId", "tenant_id", "encounterId", "documentId"];

// ---------------------------------------------------------------- CLI parse
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const pos = argv.filter((a) => !a.startsWith("--"));

function flagVal(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (pos.length < 2 || flags.has("--help") || flags.has("-h")) {
  console.log(`Pull all text from Qdrant collection '${COLLECTION}' for a payload key.

Usage:
  node scripts/pull-text.mjs <key> <value> [options]

Keys: patientId, ehrId, userId, tenant_id, encounterId, documentId,
      recordType, sourceType, type, recordName  — or "any" to search all id-like keys.

Options:
  --out <file>     also write the full text to a file
  --meta           print document/chunk metadata before each chunk's text
  --url <url>      override Qdrant base URL (default ${QDRANT_URL})
  --limit <n>      safety cap on number of chunks (default: no cap)

Examples:
  node scripts/pull-text.mjs patientId JINI-2026-USTN-FTMB
  node scripts/pull-text.mjs any JINI-2026-USTN-FTMB --meta --out ftmb.txt`);
  process.exit(pos.length < 2 ? 1 : 0);
}

const [keyArg, valueArg] = pos;
const url = (flagVal("--url") || QDRANT_URL).replace(/\/+$/, "");
const outPath = flagVal("--out");
const limit = flagVal("--limit") ? Number(flagVal("--limit")) : Infinity;
const wantMeta = flags.has("--meta");

// ---------------------------------------------------------------- helpers
async function post(path, body) {
  const res = await fetch(url + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${json.detail || json.error || JSON.stringify(json)}`);
  return json.result;
}

function matchFilter(key, value) {
  return { must: [{ key, match: { value } }] };
}

function sortPoints(points) {
  // deterministic order: document -> chunk -> topic
  return [...points].sort((a, b) => {
    const A = a.payload, B = b.payload;
    return (
      (A.documentId || "").localeCompare(B.documentId || "") ||
      (A.chunkIndex ?? 0) - (B.chunkIndex ?? 0) ||
      (A.topicIndex ?? 0) - (B.topicIndex ?? 0)
    );
  });
}

async function scrollFor(filter, label) {
  const points = [];
  let offset;
  do {
    const result = await post(`/collections/${COLLECTION}/points/scroll`, {
      filter,
      limit: 500,
      offset: offset,
      with_payload: true,
      with_vector: false,
    });
    points.push(...result.points);
    offset = result.next_page_offset || null;
  } while (offset && points.length < limit);
  console.error(`[match ${label}] ${Math.min(points.length, limit)} chunk(s)`);
  return points.slice(0, limit);
}

// ---------------------------------------------------------------- main
const keysToSearch = keyArg === "any" ? ID_KEYS : [keyArg];

let all = [];
for (const k of keysToSearch) {
  const pts = await scrollFor(matchFilter(k, valueArg), `${k}=${valueArg}`);
  const seen = new Set(all.map((p) => p.id));
  for (const p of pts.filter((p) => !seen.has(p.id))) {
    p._matchedKey = k;
    all.push(p);
  }
}

if (all.length === 0) {
  console.error(`No points found in '${COLLECTION}' for ${keyArg}=${valueArg}.`);
  console.error('Tip: try `node scripts/pull-text.mjs any <value>` to search all id-like keys.');
  process.exit(2);
}

all = sortPoints(all).slice(0, limit);
const totalChars = all.reduce((s, p) => s + (p.payload.text || "").length, 0);
const docs = new Set(all.map((p) => p.payload.documentId)).size;
console.error(`\n== ${COLLECTION}: ${all.length} chunk(s), ${docs} document(s), ${totalChars} chars ==\n`);

let output = "";
for (const p of all) {
  const pl = p.payload;
  if (wantMeta) {
    const header = [
      `----- [${p._matchedKey}] doc=${pl.documentId} chunk=${pl.chunkIndex}/${pl.chunkCount || "?"}`,
      `  record=${pl.recordName || "?"} type=${pl.recordType || "?"}/${pl.type || "?"}`,
      `  patient=${pl.patientId || "?"} ehr=${pl.ehrId || "?"} date=${pl.documentDate || "?"}`,
      `  pages=${Array.isArray(pl.pages) ? pl.pages.join(",") : "?"} words=${pl.wordCount ?? "?"}`,
    ].join("\n");
    console.log(header);
    output += header + "\n";
  }
  const text = pl.text || "";
  console.log(text);
  console.log();
  output += text + "\n\n";
}

if (outPath) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, output, "utf8");
  console.error(`Saved ${output.length} chars to ${outPath}`);
}
