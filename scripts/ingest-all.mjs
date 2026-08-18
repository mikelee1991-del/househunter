/**
 * Wide-net South Bay inventory refresh from every free source we have:
 *   1) Sereno CRMLS (primary) — neighborhoods + ZIP pass + price-band splits
 *   2) Redfin GIS scrape (merge — never wipe; often 0 from cloud/bot walls)
 *   3) MB Confidential IDX (best-effort; often 403 from cloud IPs)
 *
 * Prefer running locally (residential IP). Cloud/datacenter IPs get weak
 * Redfin/MBC results; Sereno usually still works.
 *
 *   npm run ingest:all
 *   INGEST_SERENO_ONLY=1 npm run ingest:all
 *   INGEST_PRECOMPUTE=1 npm run ingest:all
 *   SERENO_SKIP_ENRICH=1 npm run ingest:sereno   # faster search-only pass
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function main() {
  // Sereno is the most reliable free CRMLS surface
  await run("node", ["scripts/scrape-sereno-areas.mjs"]);

  const serenoOnly = process.env.INGEST_SERENO_ONLY === "1";

  if (!serenoOnly) {
    // Redfin merge — keep going even if bot-walled
    try {
      await run("node", ["scripts/scrape-redfin-market.mjs"]);
    } catch (e) {
      console.warn("Redfin scrape failed (inventory kept):", e.message);
    }

    // MB Confidential — often blocked; never fatal
    try {
      await run("node", ["scripts/scrape-mbconfidential.mjs"]);
    } catch (e) {
      console.warn("MB Confidential scrape failed (inventory kept):", e.message);
    }
  } else {
    console.log("INGEST_SERENO_ONLY=1 — skipped Redfin / MB Confidential");
  }

  if (process.env.INGEST_VERIFY === "1") {
    await run("node", ["scripts/verify-listings-sereno.mjs"]);
  }

  if (process.env.INGEST_PRECOMPUTE === "1") {
    await run("npx", ["tsx", "scripts/precompute-listing-scores.ts"]);
    await run("npx", ["tsx", "scripts/enrich-listing-condition.mts"]);
    await run("node", ["scripts/enrich-listing-air.mjs"]);
    await run("npx", ["tsx", "scripts/refresh-default-scores.mts"]);
  }

  console.log("\n✓ ingest:all finished");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
