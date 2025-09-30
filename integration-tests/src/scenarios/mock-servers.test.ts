import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { MockSlackServer } from "../mocks/slack-server";
import { MockClaudeServer } from "../mocks/claude-server";

describe("Mock Servers Test", () => {
  let slackServer: MockSlackServer;
  let claudeServer: MockClaudeServer;

  beforeAll(async () => {
    slackServer = new MockSlackServer(4001);
    claudeServer = new MockClaudeServer(8081);

    await slackServer.start();
    await claudeServer.start();
  });

  afterAll(async () => {
    await slackServer.stop();
    await claudeServer.stop();
  });

  describe("Slack Mock Server", () => {
    it("should handle auth.test", async () => {
      const response = await fetch("http://localhost:4001/api/auth.test", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.user_id).toBe("UBOT123");
      expect(data.bot_id).toBe("BBOT123");
    });

    it("should handle chat.postMessage", async () => {
      const response = await fetch(
        "http://localhost:4001/api/chat.postMessage",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: "C123456",
            text: "Test message",
          }),
        }
      );

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.channel).toBe("C123456");
      expect(data.ts).toBeDefined();
    });

    it("should store messages and allow retrieval", async () => {
      const { ts } = await slackServer.simulateUserMessage(
        "C123456",
        "Test message",
        "U123456"
      );

      const messages = slackServer.getThreadMessages(ts);
      expect(messages.length).toBe(1);
      expect(messages[0].text).toBe("Test message");
      expect(messages[0].user).toBe("U123456");
    });

    it("should handle reactions", async () => {
      const response = await fetch("http://localhost:4001/api/reactions.add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: "C123456",
          timestamp: "1234567890.123456",
          name: "thumbsup",
        }),
      });

      const data = await response.json();
      expect(data.ok).toBe(true);

      const reactions = slackServer.getReactions(
        "C123456",
        "1234567890.123456"
      );
      expect(reactions).toContain("thumbsup");
    });
  });

  describe("Claude Mock Server", () => {
    beforeEach(() => {
      claudeServer.clearResponses();
    });

    it("should handle simple math question", async () => {
      // Define response for this specific test
      claudeServer.onMessage("2+2").reply([{ type: "text", content: "4" }]);

      const response = await fetch("http://localhost:8081/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "What is 2+2?" }],
        }),
      });

      const text = await response.text();
      expect(text).toContain("4");
      expect(text).toContain("message_stop");
    });

    it("should handle file creation request", async () => {
      // Define response for this specific test
      claudeServer.onMessage(/create.*file/).reply([
        { type: "text", content: "I'll create that file for you.\n\n" },
        {
          type: "tool_use",
          content: "",
          toolName: "str_replace_editor",
          toolInput: {
            command: "create",
            path: "example.py",
            file_text: "def hello():\n    return 'Hello, World!'",
          },
        },
        {
          type: "text",
          content:
            "\n\nI've created `example.py` with a simple hello function.",
        },
      ]);

      const response = await fetch("http://localhost:8081/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "create a file" }],
        }),
      });

      const text = await response.text();
      expect(text).toContain("str_replace_editor");
      expect(text).toContain("example.py");
      expect(text).toContain("tool_use");
    });

    it("should handle pull request creation", async () => {
      // Define response for this specific test
      claudeServer.onMessage(/pull request/).reply([
        { type: "text", content: "I'll create a pull request for you.\n\n" },
        {
          type: "tool_use",
          content: "",
          toolName: "github_create_pull_request",
          toolInput: {
            title: "Add example file",
            body: "This PR adds an example Python file",
            base: "main",
          },
        },
        {
          type: "text",
          content:
            "\n\nI've created a pull request: https://github.com/test/repo/pull/1",
        },
      ]);

      const response = await fetch("http://localhost:8081/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "create a pull request" }],
        }),
      });

      const text = await response.text();
      expect(text).toContain("github_create_pull_request");
      expect(text).toContain("github.com/test/repo/pull/1");
    });

    it("should handle error responses", async () => {
      // Define error response for this specific test
      claudeServer
        .onMessage(/repository access/)
        .reply([{ type: "error", content: "Repository access denied" }]);

      const response = await fetch("http://localhost:8081/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "check my repository access" }],
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error.message).toBe("Repository access denied");
    });
  });

  describe("Mock Server Integration", () => {
    it("should simulate a complete flow", async () => {
      // Clear previous state
      slackServer.clearMessages();
      claudeServer.clearResponses();

      // Setup new response
      claudeServer
        .onMessage(/hello/)
        .reply([{ type: "text", content: "Hello! How can I help you today?" }]);

      // Simulate user message
      const { ts } = await slackServer.simulateUserMessage(
        "C123456",
        "hello bot",
        "U123456"
      );

      // Verify message was stored
      const messages = slackServer.getThreadMessages(ts);
      expect(messages.length).toBe(1);
      expect(messages[0].text).toBe("hello bot");

      // Test Claude would respond correctly
      const response = await fetch("http://localhost:8081/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      const text = await response.text();
      expect(text).toContain("Hello! How can I help you today?");
    });
  });
});
