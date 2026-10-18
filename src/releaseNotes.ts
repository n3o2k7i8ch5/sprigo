// "What's new" (#41): a GitHub release body as plain text. Drafts carry the download note and GitHub's
// generated PR list (release.yml); the app keeps only what a learner reads. Tested by src/releaseNotes.test.ts.
export const cleanNotes = (body: string) => body.replace(/\r/g, "").split(/\n{2,}/)
  .filter((p) => !p.startsWith("Downloads for macOS"))
  .map((p) => p.split("\n")
    .filter((l) => !/^\*\*Full Changelog\*\*/.test(l))
    .map((l) => l.replace(/ by @\S+ in https:\/\/\S+$/, "").replace(/^#+\s*/, "").replace(/^[*-]\s+/, "• ").replace(/\*\*(.+?)\*\*/g, "$1"))
    .join("\n").trim())
  .filter(Boolean).join("\n\n");
