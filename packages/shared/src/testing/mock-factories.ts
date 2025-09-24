#!/usr/bin/env bun

/**
 * Mock factories for test utilities
 */

import { jest } from "bun:test";

/**
 * Factory for creating mock worker job requests
 */
export function createMockWorkerJobRequest(
  overrides: any = {}
): any {
  return {
    sessionKey: "test-session-123",
    userId: "U123456789",
    username: "testuser",
    channelId: "C123456789",
    threadTs: "1234567890.123456",
    repositoryUrl: "https://github.com/test/repo",
    userPrompt: "Help me with this code",
    slackResponseChannel: "C123456789",
    slackResponseTs: "1234567890.123456",
    claudeOptions: {
      model: process.env.AGENT_DEFAULT_MODEL || "claude-3-sonnet",
    },

    ...overrides,
  };
}

/**
 * Factory for creating mock Slack events
 */
export function createMockSlackEvent(type: string, overrides: any = {}) {
  const baseEvent = {
    type,
    user: "U123456789",
    channel: "C123456789",
    ts: "1234567890.123456",
    team: "T123456789",
    ...overrides,
  };

  switch (type) {
    case "message":
      return {
        ...baseEvent,
        text: "Hello Claude",
        ...overrides,
      };
    case "app_mention":
      return {
        ...baseEvent,
        text: "<@U987654321> help me with this",
        ...overrides,
      };
    case "member_joined_channel":
      return {
        ...baseEvent,
        user: "U123456789",
        ...overrides,
      };
    default:
      return baseEvent;
  }
}

/**
 * Factory for creating mock Slack commands
 */
export function createMockSlackCommand(overrides: any = {}) {
  return {
    command: "/claude",
    text: "help me debug this",
    user_id: "U123456789",
    user_name: "testuser",
    channel_id: "C123456789",
    channel_name: "general",
    team_id: "T123456789",
    team_domain: "testteam",
    response_url: "https://hooks.slack.com/commands/123/456/789",
    trigger_id: "123.456.789",
    ...overrides,
  };
}

/**
 * Mock environment variables for testing
 */
export function createMockEnvironment(overrides: Record<string, string> = {}) {
  return {
    SESSION_KEY: "test-session-123",
    USER_ID: "U123456789",
    USERNAME: "testuser",
    CHANNEL_ID: "C123456789",
    THREAD_TS: "1234567890.123456",
    REPOSITORY_URL: "https://github.com/test/repo",
    USER_PROMPT: Buffer.from("Help me debug this code").toString("base64"),
    SLACK_RESPONSE_CHANNEL: "C123456789",
    SLACK_RESPONSE_TS: "1234567890.123456",
    SLACK_BOT_TOKEN: "xoxb-test-token",
    GITHUB_TOKEN: "ghp_test_token",
    WORKSPACE_DIR: "/workspace",
    RECOVERY_MODE: "false",
    CLAUDE_OPTIONS: JSON.stringify({
      model: process.env.AGENT_DEFAULT_MODEL || "claude-3-sonnet",
      temperature: 0.7,
    }),
    ...overrides,
  };
}

/**
 * Mock Slack app and event implementations
 */
export const mockSlackApi = {
  app: {
    event: jest.fn(),
    message: jest.fn(),
    command: jest.fn(),
    action: jest.fn(),
    view: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  },
  client: {
    chat: {
      postMessage: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    users: {
      info: jest.fn(),
      profile: {
        get: jest.fn(),
      },
    },
    channels: {
      info: jest.fn(),
    },
    conversations: {
      info: jest.fn(),
      history: jest.fn(),
      replies: jest.fn(),
    },
  },
  event: {
    ack: jest.fn(),
    say: jest.fn(),
    respond: jest.fn(),
    client: null as any,
  },
  command: {
    ack: jest.fn(),
    respond: jest.fn(),
    client: null as any,
  },
  action: {
    ack: jest.fn(),
    respond: jest.fn(),
    client: null as any,
  },
};

/**
 * Mock Slack client implementation
 */
export const mockSlackClient = {
  chat: {
    postMessage: jest.fn().mockResolvedValue({
      ok: true,
      ts: "1234567890.123456",
      channel: "C123456789",
    }),
    update: jest.fn().mockResolvedValue({
      ok: true,
      ts: "1234567890.123456",
      channel: "C123456789",
    }),
    delete: jest.fn().mockResolvedValue({
      ok: true,
    }),
  },
  conversations: {
    info: jest.fn().mockResolvedValue({
      ok: true,
      channel: {
        id: "C123456789",
        name: "general",
        is_private: false,
      },
    }),
    history: jest.fn().mockResolvedValue({
      ok: true,
      messages: [],
    }),
    replies: jest.fn().mockResolvedValue({
      ok: true,
      messages: [],
    }),
  },
  users: {
    info: jest.fn().mockResolvedValue({
      ok: true,
      user: {
        id: "U123456789",
        name: "testuser",
        real_name: "Test User",
        profile: {
          email: "test@example.com",
        },
      },
    }),
  },
  files: {
    upload: jest.fn().mockResolvedValue({
      ok: true,
      file: {
        id: "F123456789",
        name: "output.txt",
      },
    }),
  },
};

/**
 * Mock GitHub API implementations
 */
export const mockGitHubApi = {
  repos: {
    get: jest.fn(),
    getContent: jest.fn(),
    createOrUpdateFileContents: jest.fn(),
  },
  pulls: {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  issues: {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    createComment: jest.fn(),
  },
  git: {
    createRef: jest.fn(),
    getRef: jest.fn(),
    updateRef: jest.fn(),
  },
};

/**
 * Mock workspace setup implementation
 */
export const mockWorkspaceSetup = {
  createWorkspace: jest.fn().mockResolvedValue("/workspace/user-123"),
  cloneRepository: jest.fn().mockResolvedValue("/workspace/user-123/repo"),
  setupEnvironment: jest.fn().mockResolvedValue(undefined),
  validateSetup: jest.fn().mockResolvedValue(true),
  cleanup: jest.fn().mockResolvedValue(undefined),
  getDiskUsage: jest.fn().mockResolvedValue(1024 * 1024), // 1MB
  createSecureDirectory: jest.fn().mockResolvedValue(undefined),
  sanitizeUserInput: jest
    .fn()
    .mockImplementation((input: string) => input.replace(/[<>"`]/g, "")),
};

/**
 * Mock Claude session runner implementation
 */
export const mockSessionRunner = {
  executePrompt: jest.fn().mockResolvedValue("Claude response"),
  getSessionState: jest.fn().mockResolvedValue({
    sessionKey: "test-session",
    status: "active",
    conversation: [],
  }),
  addProgressCallback: jest.fn(),
  cleanup: jest.fn().mockResolvedValue(undefined),
  persistSession: jest.fn().mockResolvedValue("/gcs/path/session"),
  recoverSession: jest.fn().mockResolvedValue(true),
};

/**
 * Mock file system operations
 */
export const mockFileSystem = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from("mock file content")),
  access: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({
    isDirectory: () => true,
    isFile: () => false,
    size: 1024,
  }),
  readdir: jest.fn().mockResolvedValue([]),
  copyFile: jest.fn().mockResolvedValue(undefined),
  symlink: jest.fn().mockResolvedValue(undefined),
};

/**
 * Mock child process for git operations
 */
export const mockChildProcess = {
  spawn: jest.fn().mockReturnValue({
    stdout: {
      on: jest.fn(),
      pipe: jest.fn(),
    },
    stderr: {
      on: jest.fn(),
      pipe: jest.fn(),
    },
    on: jest.fn().mockImplementation((event: string, callback: any) => {
      if (event === "exit") {
        setTimeout(() => callback(0), 10); // Success exit code
      }
    }),
    kill: jest.fn(),
    pid: 12345,
  }),
  exec: jest.fn().mockImplementation((_command: string, callback: any) => {
    setTimeout(() => callback(null, "command output", ""), 10);
  }),
};

/**
 * Mock environment setup
 */
export function setupMockEnvironment() {
  // Mock environment variables
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  process.env.SLACK_SIGNING_SECRET = "test-signing-secret";
  process.env.GITHUB_TOKEN = "ghp_test_token";

  return () => {
    // Cleanup
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.GITHUB_TOKEN;
  };
}