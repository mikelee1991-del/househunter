import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
});
const apiHits = [];
page.on("response", (r) => {
  const u = r.url();
  if (/graphql|rdc|search|homes|listings|apollo/i.test(u)) {
    apiHits.push(`${r.status()} ${u.slice(0, 180)}`);
  }
});
const url =
  "https://www.realtor.com/realestateandhomes-search/Manhattan-Beach_CA/type-single-family-home/price-1500000-5000000";
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(6000);
console.log("TITLE", await page.title());
console.log("URL", page.url());
const text = await page.locator("body").innerText().catch(() => "");
console.log("BODY", text.slice(0, 1200));
console.log("API HITS\n" + apiHits.slice(0, 40).join("\n"));
const next = await page.locator("#__NEXT_DATA__").count();
console.log("NEXT_DATA", next);
if (next) {
  const raw = await page.locator("#__NEXT_DATA__").textContent();
  console.log("NEXT len", raw.length);
  const ids = [...raw.matchAll(/"property_id"\s*:\s*"?(\d+)/g)].map((m) => m[1]);
  console.log("unique property_ids", new Set(ids).size);
}
await browser.close();
