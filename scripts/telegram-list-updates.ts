#!/usr/bin/env tsx
/**
 * telegram-list-updates.ts
 *
 * Calls Telegram getUpdates and prints each sender's chat ID, user ID,
 * username, and first name — the minimum needed to link a staff member to
 * a staff_profiles row.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=<token> npx tsx scripts/telegram-list-updates.ts
 *
 * The script does NOT print the bot token, message contents, or any PII
 * beyond the Telegram account identifiers listed above.
 *
 * Setup process:
 *   1. Create a bot via @BotFather and copy the token.
 *   2. Each staff member opens the bot and sends /start.
 *   3. Run this script to retrieve their chat IDs.
 *   4. Insert into staff_profiles: jira_account_id + telegram_chat_id + role.
 */

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
  };
}

interface GetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
  description?: string;
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN environment variable is not set.');
    console.error('Usage: TELEGRAM_BOT_TOKEN=<token> npx tsx scripts/telegram-list-updates.ts');
    process.exit(1);
  }

  const url = `https://api.telegram.org/bot${token}/getUpdates?limit=100&timeout=0`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    console.error('Network error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const data = (await response.json()) as GetUpdatesResponse;

  if (!data.ok) {
    console.error('Telegram API error:', data.description ?? 'unknown error');
    process.exit(1);
  }

  if (data.result.length === 0) {
    console.log('No updates found.');
    console.log('Make sure each staff member has sent /start to the bot, then run again.');
    return;
  }

  // Deduplicate by chat ID — keep the latest entry per sender
  const seen = new Map<number, TelegramUpdate>();
  for (const update of data.result) {
    const chatId = update.message?.chat.id;
    if (chatId !== undefined) {
      seen.set(chatId, update);
    }
  }

  console.log(`\nFound ${seen.size} unique sender(s):\n`);
  console.log('─'.repeat(60));

  for (const update of seen.values()) {
    const msg = update.message;
    if (!msg) continue;
    const from = msg.from;

    console.log(`Chat ID (telegram_chat_id) : ${msg.chat.id}`);
    console.log(`User ID                    : ${from?.id ?? 'n/a'}`);
    console.log(`Username (telegram_username): ${from?.username ? '@' + from.username : '—'}`);
    console.log(`First name                 : ${from?.first_name ?? '—'}`);
    console.log('─'.repeat(60));
  }

  console.log('\nNext step: insert these into staff_profiles:');
  console.log('  INSERT INTO public.staff_profiles');
  console.log('    (display_name, jira_account_id, telegram_chat_id, telegram_username, role)');
  console.log("  VALUES ('Name', 'jira-account-id-here', 'CHAT_ID_ABOVE', '@username', 'translator');");
  console.log('\nSee docs/TELEGRAM_NOTIFICATIONS_SETUP.md for full instructions.');
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
