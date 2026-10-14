/** Short contact label used by workspace avatars and conversation identities. */
export function initials(name: string) {
  return name
    .split(" ")
    .filter((word) => !["Mr", "Ms", "Mrs"].includes(word))
    .map((word) => word[0])
    .slice(0, 2)
    .join("");
}
