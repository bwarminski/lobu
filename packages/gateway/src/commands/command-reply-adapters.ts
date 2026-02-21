import type { CommandContext } from "@lobu/core";
import type { WebClient } from "@slack/web-api";
import type { Bot } from "grammy";

export function createSlackThreadReply(
  client: WebClient,
  channelId: string,
  threadTs: string
): CommandContext["reply"] {
  return async (text: string) => {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text,
    });
  };
}

export function createSlackEphemeralReply(
  client: WebClient,
  channelId: string,
  userId: string
): CommandContext["reply"] {
  return async (text: string) => {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text,
    });
  };
}

export function createTelegramReply(
  bot: Bot,
  chatId: number
): CommandContext["reply"] {
  return async (text: string) => {
    await bot.api.sendMessage(chatId, text);
  };
}
