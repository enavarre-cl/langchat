import { Attachment, ChatMessage } from './types';

/** Image attachments of a message. */
export function imageAttachments(m: ChatMessage): Attachment[] {
  return (m.attachments ?? []).filter((a) => a.kind === 'image');
}

/** Document attachments (PDF, etc.) of a message. */
export function documentAttachments(m: ChatMessage): Attachment[] {
  return (m.attachments ?? []).filter((a) => a.kind === 'document');
}

/** data URL for an image (OpenAI/Gemini format in image_url). */
export function dataUrl(a: Attachment): string {
  return `data:${a.mime};base64,${a.data}`;
}
