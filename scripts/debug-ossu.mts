import { fetchGitHubZipFiles } from "../packages/ingestor/dist/index.js";

const files = await fetchGitHubZipFiles("ossu", "computer-science", "master");
const readme = files.get("README.md");
console.log("README presente:", !!readme);
const text = new TextDecoder().decode(readme);
const lines = text.split("\n");
const tableRows = lines.filter((l) => /^\s*\|\s*\[/.test(l));
console.log("filas con | [ :", tableRows.length);
const re = /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|(.+)\|$/;
let matched = 0;
for (const l of tableRows) {
  if (re.test(l)) matched++;
}
console.log("match regex completo:", matched);
console.log("ejemplo raw:", JSON.stringify(tableRows[0]).slice(0, 200));
