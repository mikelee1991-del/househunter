/**
 * Wide-net South Bay inventory refresh from every free source we have:
 *   1) Sereno CRMLS neighborhood search (primary, reliable)
 *   2) Redfin GIS scrape (merge — never wipe)
 *   3) MB Confidential IDX (best-effort; often 403 from cloud IPs)
 *
 * Then optional verify + precompute when flags are set.
 *
 *   npm run ingest:all
 *   INGEST_PRECOMPUTE=1 npm run ingest:all
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
  // Sereno is the most reliable CRMLS surface from this environment
  await run("node", ["scripts/scrape-sereno-areas.mjs"]);

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

  if (process.env.INGEST_VERIFY === "1") {
    await run("node", ["scripts/verify-listings-sereno.mjs"]);
  }

  if (process.env.INGEST_PRECOMPUTE === "1") {
    await run("npx", ["tsx", "scripts/precompute-listing-scores.ts"]);
    await run("npx", ["tsx", "scripts/refresh-default-scores.mts"]);
  }

  console.log("\n✓ ingest:all finished");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
