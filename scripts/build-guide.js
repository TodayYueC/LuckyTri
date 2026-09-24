import { readFileSync, writeFileSync } from "node:fs";
import { marked } from "marked";
import { format } from "prettier";
const markdown = readFileSync("docs/使用教程.md", "utf8");
const headings = [];
const article = marked
  .parse(markdown)
  .replace(/<h2>(.*?)<\/h2>/g, (_, label) => {
    const id = "step-" + (headings.length + 1);
    headings.push({ id, label });
    return `<h2 id="${id}">${label}</h2>`;
  });
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LuckyBot v0.8.0 · 使用教程</title><style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f6f8f3;color:#34412f;font:14px/1.9 'Microsoft YaHei',system-ui,sans-serif}a{color:#638353;text-underline-offset:4px}header{background:#edf3e6;border-bottom:1px solid #dfe7d6;padding:24px max(24px,calc((100% - 1160px)/2));display:flex;justify-content:space-between;gap:20px;align-items:center}header b{font-size:20px;letter-spacing:2px}header small{display:block;color:#93a187;font-size:10px;letter-spacing:2px}header nav{display:flex;gap:14px;align-items:center;font-size:12px}button{font:inherit;background:white;border:1px solid #dce5d2;border-radius:7px;padding:7px 13px;color:#6e8760;cursor:pointer}.layout{max-width:1200px;margin:36px auto;display:grid;grid-template-columns:225px minmax(0,1fr);gap:32px;padding:0 24px}.toc{position:sticky;top:24px;align-self:start;font-size:12px}.toc p{font-size:10px;letter-spacing:2px;color:#a5b097}.toc a{display:block;text-decoration:none;color:#819176;padding:8px 0}.toc a:hover{color:#456638}article{background:#fff;border:1px solid #e5ebdf;border-radius:14px;padding:38px 44px;min-width:0}h1{font-size:27px;line-height:1.5;margin:0 0 20px;font-weight:600}h2{font-size:20px;scroll-margin-top:24px;border-top:1px solid #e9eee4;margin:38px 0 20px;padding-top:28px}h3{font-size:15px;margin-top:24px}p,li{color:#6f7d65}strong{color:#4e6442}pre{overflow:auto;background:#f4f7ef;padding:18px 20px;border:1px solid #e5ecdc;border-radius:8px;line-height:1.7;font-size:12px;color:#5d774e}code{font-family:Consolas,monospace;overflow-wrap:anywhere}p code,li code,td code{background:#f1f5ec;padding:2px 5px;border-radius:4px;font-size:12px}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:12px;margin:22px 0}th,td{border:1px solid #e4eadc;padding:10px 12px;text-align:left;overflow-wrap:anywhere}th{background:#eff4e9;color:#708462}td{color:#7d8974}ul,ol{padding-left:24px}blockquote{border-left:3px solid #b6c7a5;padding-left:18px}footer{text-align:center;font-size:10px;color:#a8b19f;padding:0 20px 35px}@media(max-width:760px){header{align-items:flex-start;flex-direction:column}.layout{grid-template-columns:1fr;margin:20px auto;padding:0 14px}.toc{position:static;display:flex;gap:10px;overflow:auto}.toc p{display:none}.toc a{white-space:nowrap;border:1px solid #e0e8d8;border-radius:7px;padding:7px 10px}article{padding:24px 20px}h1{font-size:23px}h2{font-size:18px}th,td{padding:7px}table{font-size:11px}}@media print{body{background:white}.toc,header nav{display:none}.layout{display:block;margin:0;max-width:none;padding:0}article{border:0;padding:0}header{padding:0 0 20px;background:white}a{color:inherit}h2{break-after:avoid}pre,tr{break-inside:avoid}footer{padding:20px 0}}
</style></head><body><header><div><b>LuckyBot · 上手手册</b><small>YOUR CHAT COMPANION / v0.8.0</small></div><nav><a href="/#setup">返回管理台</a><a href="/tutorial.md" download>下载 Markdown</a><button onclick="window.print()">打印 / 保存 PDF</button></nav></header><div class="layout"><nav class="toc" aria-label="教程目录"><p>CONTENTS</p>${headings.map((h) => `<a href="#${h.id}">${h.label}</a>`).join("")}</nav><article>${article}</article></div><footer>LuckyBot · 从本机试聊，到慢慢熟悉一个群。教程与 v0.8.0 界面同步。</footer></body></html>`;
writeFileSync("public/guide.html", await format(html, { parser: "html" }));
writeFileSync(
  "public/tutorial.md",
  await format(markdown, { parser: "markdown" }),
);
console.log("已生成 public/guide.html 与 public/tutorial.md");
