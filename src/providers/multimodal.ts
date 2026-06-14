import { Attachment, ChatMessage } from './types';

/** Adjuntos de imagen de un mensaje. */
export function imageAttachments(m: ChatMessage): Attachment[] {
  return (m.attachments ?? []).filter((a) => a.kind === 'image');
}

/** Adjuntos de documento (PDF, etc.) de un mensaje. */
export function documentAttachments(m: ChatMessage): Attachment[] {
  return (m.attachments ?? []).filter((a) => a.kind === 'document');
}

/** data URL para una imagen (formato OpenAI/Gemini en image_url). */
export function dataUrl(a: Attachment): string {
  return `data:${a.mime};base64,${a.data}`;
}
