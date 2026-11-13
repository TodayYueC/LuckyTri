// Exercise the public navigation rather than relying on hidden legacy links.
export async function control(page, name) {
  const trigger = page.locator(`[data-control="${name}"]`);
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
}
export async function navigate(page, area, sub = "") {
  if (["nature", "system", "plugins"].includes(area)) {
    await control(page, "settings");
    await page
      .locator(`.control-popover:popover-open [data-page="${area}"]`)
      .click();
  } else {
    const primary =
      area === "time"
        ? "life"
        : area === "life" && sub === "shelf"
          ? "memory"
          : area;
    await page.locator(`.dock-link[data-page="${primary}"]`).click();
    if (area === "life")
      await page
        .locator(
          `.workspace-tabs [data-tab="${sub === "shelf" ? "reading" : sub === "ahead" ? "ahead" : ["reviews", "story"].includes(sub) ? "review" : "diary"}"]`,
        )
        .click();
    if (area === "time")
      await page
        .locator(
          `.workspace-tabs [data-tab="${["works", "projects"].includes(sub) ? "creation" : "schedule"}"]`,
        )
        .click();
    if (area === "memory")
      await page
        .locator(
          `.workspace-tabs [data-tab="${sub === "shelf" ? "knowledge" : "archive"}"]`,
        )
        .click();
  }
  if (sub && !["life", "memory"].includes(area)) {
    const tab = page.locator(`.route-page [data-tab="${sub}"]`);
    if (await tab.count()) await tab.click();
  }
}
export async function timeTab(page, name) {
  const creation = ["作品库", "长期项目", "持续项目"].includes(name);
  await page
    .locator(
      `.workspace-tabs [data-tab="${creation ? "creation" : "schedule"}"]`,
    )
    .click();
  await page.getByRole("tab", { name, exact: true }).click();
}
