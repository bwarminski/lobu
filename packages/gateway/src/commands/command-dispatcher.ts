import {
  type CommandContext,
  type CommandRegistry,
  createLogger,
} from "@lobu/core";
import type { ChannelBindingService } from "../channels";
import { resolveSpace } from "../spaces";

const logger = createLogger("command-dispatcher");

export interface CommandDispatchInput {
  platform: string;
  userId: string;
  channelId: string;
  teamId?: string;
  isGroup: boolean;
  conversationId?: string;
  reply: CommandContext["reply"];
}

export interface CommandDispatcherDeps {
  registry: CommandRegistry;
  channelBindingService: ChannelBindingService;
}

export class CommandDispatcher {
  private registry: CommandRegistry;
  private channelBindingService: ChannelBindingService;

  constructor(deps: CommandDispatcherDeps) {
    this.registry = deps.registry;
    this.channelBindingService = deps.channelBindingService;
  }

  async tryHandleSlashText(
    rawText: string,
    input: CommandDispatchInput
  ): Promise<boolean> {
    const match = rawText.trim().match(/^\/(\w+)(?:\s+(.*))?$/);
    if (!match?.[1]) return false;
    return this.tryHandle(match[1], match[2]?.trim() || "", input);
  }

  async tryHandle(
    commandName: string,
    commandArgs: string,
    input: CommandDispatchInput
  ): Promise<boolean> {
    const agentId = await this.resolveAgentId(input);

    logger.info(
      {
        platform: input.platform,
        commandName,
        userId: input.userId,
        channelId: input.channelId,
        teamId: input.teamId,
        agentId,
      },
      "Dispatching command"
    );

    return this.registry.tryHandle(commandName, {
      userId: input.userId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      agentId,
      args: commandArgs,
      platform: input.platform,
      reply: input.reply,
    });
  }

  private async resolveAgentId(input: CommandDispatchInput): Promise<string> {
    const binding = await this.channelBindingService.getBinding(
      input.platform,
      input.channelId,
      input.teamId
    );
    if (binding?.agentId) {
      return binding.agentId;
    }

    return resolveSpace({
      platform: input.platform,
      userId: input.userId,
      channelId: input.channelId,
      isGroup: input.isGroup,
    }).agentId;
  }
}
