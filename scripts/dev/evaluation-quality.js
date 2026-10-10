const REQUIRED_QUALITY = ["understanding", "clarity", "engagement"];

// Reviewers may add wording suggestions; those are notes, not extra score axes.
export function meetsDialogueQuality(quality) {
  return (
    quality !== null &&
    typeof quality === "object" &&
    REQUIRED_QUALITY.every((key) => Number(quality[key]) >= 4)
  );
}
