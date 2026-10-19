import type { Contact, TranscriptSegment } from "./types";

export const normaliseIdentity = (value: string | null | undefined) =>
  (value || "").normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/gu, " ");

/** A name alone is never enough to merge private relationship histories. */
export function matchOwnedContact(
  participant: Pick<Contact, "name" | "company" | "email">,
  candidates: Contact[],
): Contact | null {
  const email = normaliseIdentity(participant.email);
  if (email) {
    const matches = candidates.filter((candidate) => normaliseIdentity(candidate.email) === email);
    return matches.length === 1 ? matches[0] : null;
  }
  const company = normaliseIdentity(participant.company);
  if (!company) return null;
  const matches = candidates.filter(
    (candidate) =>
      normaliseIdentity(candidate.name) === normaliseIdentity(participant.name) &&
      normaliseIdentity(candidate.company) === company &&
      !candidate.email,
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Explicit, unambiguous targets only. Group actions stay unassigned otherwise. */
export function resolveActionContact(
  contacts: Contact[],
  participantName?: string | null,
): string | null {
  if (participantName) {
    const target = normaliseIdentity(participantName);
    const matches = contacts.filter(
      (contact) =>
        normaliseIdentity(contact.name) === target || normaliseIdentity(contact.email) === target,
    );
    return matches.length === 1 ? matches[0].id : null;
  }
  return contacts.length === 1 ? contacts[0].id : null;
}

/** Corrections alter presentation only; the archived diarization label survives. */
export function applySpeakerIdentities(
  segments: TranscriptSegment[],
  contacts: Contact[],
  identifications: Array<{ speaker_label: string; contact_id: string | null }>,
): TranscriptSegment[] {
  const names = new Map(contacts.map((contact) => [contact.id, contact.name]));
  const confirmed = new Map(
    identifications.flatMap((item) =>
      item.contact_id && names.has(item.contact_id)
        ? [[item.speaker_label, item.contact_id] as const]
        : [],
    ),
  );
  return segments.map((segment) => {
    const original = segment.sourceSpeaker || segment.speaker;
    const contactId = confirmed.get(original);
    return contactId
      ? {
          ...segment,
          sourceSpeaker: original,
          speaker: names.get(contactId)!,
          identifiedContactId: contactId,
        }
      : { ...segment, speaker: original, identifiedContactId: null };
  });
}
