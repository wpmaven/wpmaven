/**
 * The chat's refusals, read from what the plugin's routes answer.
 *
 * - A refused turn (the site's hourly chat limit, a lost link, WPMaven out of
 *   reach) never answers on the stream, so the send itself must end the wait
 *   and say WPMaven's sentence (it says when the owner can write again). The
 *   kit's chat shows an error's `sentence` and gives the words back.
 * - A new chat WPMaven refused (the site's daily new-chat limit) leaves the
 *   owner where they were, with WPMaven's sentence saying why.
 */

export const SEND_FAILED_TEXT = 'Failed to send message. Please try again.';

/** A chat turn WPMaven or the site refused before it started. */
export class ChatTurnRefused extends Error {
  constructor(status, sentence, code) {
    super(sentence || SEND_FAILED_TEXT);
    this.name = 'ChatTurnRefused';
    this.status = status;
    this.sentence = sentence || null;
    this.code = code || null;
  }
}

function sentenceOf(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The refusal of a send, from the body the proxy answered: WordPress's error
 * ({code, message, data}), the API's ({success: false, code, error}), or the
 * API's inside the proxy's data.
 */
export function refusedTurn(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  const data = b.data && typeof b.data === 'object' ? b.data : {};
  const sentence = sentenceOf(b.message) || sentenceOf(b.error) || sentenceOf(data.error) || sentenceOf(data.message);
  const code = sentenceOf(b.code) || sentenceOf(data.code);
  return new ChatTurnRefused(status, sentence, code);
}

export const NEW_CHAT_FAILED_TEXT = 'A new chat could not be opened just now. Try again in a minute.';

/**
 * The conversation POST /conversations created, or a ChatTurnRefused with the
 * sentence to show. A refusal from WPMaven or the plugin comes as
 * {success: false, code, error} (the site's daily new-chat limit: "This site
 * opened many new chats today..."); any other failure (WordPress's own error,
 * an API out of reach, the proxy's "Failed to create conversation") reads as
 * the plain line.
 */
export function createdConversation(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (b.success) {
    const conv = (b.data && b.data.conversation) || b.data;
    if (conv && conv.id) return conv;
  }
  const code = sentenceOf(b.code);
  const sentence = code ? sentenceOf(b.error) : null;
  throw new ChatTurnRefused(0, sentence || NEW_CHAT_FAILED_TEXT, code);
}
