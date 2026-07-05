// Text imports (Bun `with { type: "text" }`) of embedded assets — e.g. the
// onboarding SKILL.md files bundled into the compiled binary by `aipe start`.
declare module "*.md" {
  const content: string;
  export default content;
}
