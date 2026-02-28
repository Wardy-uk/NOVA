import OpenAI from 'openai';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const MAX_MESSAGES = 20;

// In-memory conversation store (per-user)
const conversations = new Map<string, ChatMessage[]>();

function getConversationKey(userId: number, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

export function getConversation(userId: number, conversationId: string): ChatMessage[] {
  return conversations.get(getConversationKey(userId, conversationId)) ?? [];
}

export function resetConversation(userId: number, conversationId: string): void {
  conversations.delete(getConversationKey(userId, conversationId));
}

export async function chat(
  apiKey: string,
  userId: number,
  conversationId: string,
  userMessage: string,
  contextSummary: string,
): Promise<string> {
  const key = getConversationKey(userId, conversationId);
  let messages = conversations.get(key) ?? [];

  // Add system prompt if conversation is fresh
  if (messages.length === 0) {
    messages.push({
      role: 'system',
      content: `You are N.O.V.A (Next-gen Onboarding & Virtual Assistant), a helpful AI assistant embedded in a project management dashboard. You help users understand their tasks, deliveries, milestones, and workload. Be concise, practical, and proactive in your suggestions.

Current context:
${contextSummary}

When referring to tickets or deliveries, be specific with names and dates when available.`,
    });
  }

  // Add user message
  messages.push({ role: 'user', content: userMessage });

  // Trim to max messages (keep system prompt)
  if (messages.length > MAX_MESSAGES) {
    const system = messages[0];
    messages = [system, ...messages.slice(-(MAX_MESSAGES - 1))];
  }

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.5,
    max_tokens: 1000,
    messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  });

  const reply = response.choices[0]?.message?.content ?? 'Sorry, I couldn\'t generate a response.';

  // Add assistant reply
  messages.push({ role: 'assistant', content: reply });
  conversations.set(key, messages);

  return reply;
}
