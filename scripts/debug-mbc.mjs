const UA = "Mozilla/5.0";
const url =
  "https://www.mbconfidential.com/2516-the-strand-manhattan-beach-90266-mls-sb26105156/";
const html = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
console.log("len", html.length);
console.log("Active?", /Active Status/i.test(html));
console.log("Pending?", /Pending/i.test(html));
console.log("Closed?", /Closed/i.test(html));
console.log("Current Price snippet", html.match(/Current Price[\s\S]{0,120}/)?.[0]);
console.log(
  "h1",
  html
    .match(/<h1[^>]*>[\s\S]*?<\/h1>/i)?.[0]
    ?.replace(/<[^>]+>/g, " ")
    .trim(),
);
console.log(
  "money",
  [...html.matchAll(/\$[\d,]+/g)].slice(0, 15).map((m) => m[0]),
);
console.log("Status block", html.match(/Status[\s\S]{0,80}(?:Active|Pending|Sold|Closed)/i)?.[0]);

const home = await (
  await fetch("https://www.mbconfidential.com/", { headers: { "User-Agent": UA } })
).text();
const nav = [...home.matchAll(/href="(\/[^"]+)"/g)]
  .map((m) => m[1])
  .filter((h) =>
    /beach|sale|search|listing|palos|torrance|playa|hermosa|redondo|manhattan|homes/i.test(
      h,
    ),
  );
console.log("nav", [...new Set(nav)].slice(0, 80));
