#!/usr/bin/env bun

/**
 * Slack-specific type definitions
 * These types are used throughout the Slack integration
 */

export interface SlackContext {
  channelId: string;
  userId: string;
  userDisplayName?: string;
  teamId: string;
  threadTs?: string;
  messageTs: string;
  text: string;
  messageUrl?: string;
}

// Slack Event Types - properly typed to replace 'any'
export interface SlackUser {
  id: string;
  name: string;
  display_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    email?: string;
  };
}

export interface SlackMessage {
  type: string;
  subtype?: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  channel_type?: string;
  team?: string;
  user_profile?: {
    display_name?: string;
    real_name?: string;
  };
}

export interface SlackAppMentionEvent extends SlackMessage {
  type: "app_mention";
}

export interface SlackBlock {
  type: string;
  block_id?: string;
  text?: {
    type: string;
    text: string;
  };
  elements?: SlackBlockElement[];
  accessory?: SlackBlockElement;
}

export interface SlackBlockElement {
  type: string;
  action_id?: string;
  text?: {
    type: string;
    text: string;
  };
  value?: string;
  style?: string;
  url?: string;
}

export interface SlackAction {
  type: string;
  action_id: string;
  block_id?: string;
  text?: {
    type: string;
    text: string;
  };
  value?: string;
  style?: string;
  action_ts?: string;
}

export interface SlackActionBody {
  type: string;
  user: SlackUser;
  team: {
    id: string;
    domain: string;
  };
  channel?: {
    id: string;
    name: string;
  };
  message?: {
    type: string;
    text: string;
    ts: string;
    thread_ts?: string;
    blocks?: SlackBlock[];
  };
  container?: {
    type: string;
    message_ts: string;
    channel_id: string;
    is_ephemeral: boolean;
  };
  trigger_id: string;
  actions: SlackAction[];
  response_url?: string;
  view?: SlackView;
}

export interface SlackView {
  id: string;
  team_id: string;
  type: string;
  blocks: SlackBlock[];
  private_metadata?: string;
  callback_id?: string;
  state?: {
    values: Record<string, Record<string, SlackStateValue>>;
  };
  hash?: string;
  title?: {
    type: string;
    text: string;
  };
  submit?: {
    type: string;
    text: string;
  };
  close?: {
    type: string;
    text: string;
  };
}

export interface SlackStateValue {
  type: string;
  value?: string;
  selected_option?: {
    text: {
      type: string;
      text: string;
    };
    value: string;
  };
  selected_options?: Array<{
    text: {
      type: string;
      text: string;
    };
    value: string;
  }>;
  selected_date?: string;
  selected_time?: string;
  selected_date_time?: number;
}

export interface SlackViewSubmissionBody {
  type: "view_submission";
  team: {
    id: string;
    domain: string;
  };
  user: SlackUser;
  view: SlackView;
  trigger_id: string;
  response_urls?: Array<{
    block_id: string;
    action_id: string;
    channel_id: string;
    response_url: string;
  }>;
}

export interface SlackAppHomeEvent {
  type: "app_home_opened";
  user: string;
  channel: string;
  tab: "home" | "messages";
  event_ts: string;
}

export interface SlackTeamJoinEvent {
  type: "team_join";
  user: SlackUser;
}

export interface SlackFileSharedEvent {
  type: "file_shared";
  file_id: string;
  user_id: string;
  file: {
    id: string;
    name?: string;
    title?: string;
    mimetype?: string;
    filetype?: string;
    url_private?: string;
    url_private_download?: string;
  };
  channel_id?: string;
  event_ts: string;
}

// Slack Web API Client interface (minimal subset we use)
// Import the full type from @slack/web-api when needed
export interface SlackWebClient {
  chat: {
    postMessage(options: {
      channel: string;
      text?: string;
      blocks?: SlackBlock[];
      thread_ts?: string;
      mrkdwn?: boolean;
      metadata?: unknown;
    }): Promise<{
      ok: boolean;
      ts?: string;
      message?: SlackMessage;
      error?: string;
    }>;
    update(options: {
      channel: string;
      ts: string;
      text?: string;
      blocks?: SlackBlock[];
      metadata?: unknown;
    }): Promise<{
      ok: boolean;
      ts?: string;
      message?: SlackMessage;
      error?: string;
    }>;
    delete(options: {
      channel: string;
      ts: string;
    }): Promise<{ ok: boolean; error?: string }>;
  };
  users: {
    info(options: { user: string }): Promise<{
      ok: boolean;
      user?: SlackUser;
      error?: string;
    }>;
  };
  views: {
    publish(options: {
      user_id: string;
      view: SlackView;
    }): Promise<{ ok: boolean; error?: string }>;
    open(options: {
      trigger_id: string;
      view: SlackView;
    }): Promise<{ ok: boolean; error?: string }>;
  };
  conversations: {
    history(options: {
      channel: string;
      latest?: string;
      oldest?: string;
      limit?: number;
    }): Promise<{
      ok: boolean;
      messages?: SlackMessage[];
      error?: string;
    }>;
  };
}

// Module action context
export interface ModuleActionContext {
  channelId: string;
  client: SlackWebClient;
  body: SlackActionBody;
  updateAppHome: (userId: string, client: SlackWebClient) => Promise<void>;
  messageHandler: {
    handleUserRequest: (
      context: SlackContext,
      userRequest: string,
      client: SlackWebClient
    ) => Promise<void>;
  };
}
