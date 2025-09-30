import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { TestContext } from "../fixtures/test-context";

describe("Peerbot Integration Tests", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  beforeEach(() => {
    ctx.slackServer.clearMessages();
    ctx.claudeServer.clearResponses();
  });

  describe("Basic Functionality", () => {
    it("should handle simple math question (2+2) without buttons", async () => {
      // Setup Claude response
      ctx.claudeServer.onMessage("2+2").reply([{ type: "text", content: "4" }]);

      // Send message
      const { ts } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "What is 2+2?",
        "U123456"
      );

      // Wait for bot response
      await ctx.waitFor(async () => {
        const messages = ctx.slackServer.getThreadMessages(ts);
        return messages.length > 1;
      });

      // Check response
      const messages = ctx.slackServer.getThreadMessages(ts);
      const botMessage = messages.find((m) => m.user === "UBOT123");

      expect(botMessage?.text).toBe("4");
      expect(botMessage?.blocks).toBeUndefined(); // No blocks/buttons for simple answer

      // Check reactions
      const reactions = ctx.slackServer.getReactions("C123456", ts);
      expect(reactions).toContain("eyes");
    });

    it("should show file creation button when creating a file", async () => {
      // Setup Claude response with file creation
      ctx.claudeServer.onMessage(/create.*file/).reply([
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

      const { ts } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "Create a sample Python file",
        "U123456"
      );

      // Wait for bot response with buttons
      await ctx.waitFor(async () => {
        const messages = ctx.slackServer.getThreadMessages(ts);
        const botMessage = messages.find((m) => m.user === "UBOT123");
        return botMessage?.blocks?.length > 0;
      });

      const messages = ctx.slackServer.getThreadMessages(ts);
      const botMessage = messages.find((m) => m.user === "UBOT123");

      // Check for create PR button
      const createPrButton = ctx.findButton(botMessage, "create_pull_request");
      expect(createPrButton).toBeDefined();
      expect(createPrButton?.text?.text).toContain("Create Pull Request");
    });

    it("should show PR URL after creating pull request", async () => {
      // Setup Claude response for PR creation
      ctx.claudeServer.onMessage(/pull request/).reply([
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

      const { ts } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "Create a file and a pull request",
        "U123456"
      );

      await ctx.waitFor(async () => {
        const messages = ctx.slackServer.getThreadMessages(ts);
        const botMessage = messages.find((m) => m.user === "UBOT123");
        return botMessage?.text?.includes("github.com");
      });

      const messages = ctx.slackServer.getThreadMessages(ts);
      const botMessage = messages.find((m) => m.user === "UBOT123");

      // Check for View PR button
      const viewPrButton = ctx.findButton(botMessage, "view_pull_request");
      expect(viewPrButton).toBeDefined();

      // Check URL in message
      const prUrl = ctx.extractUrl(botMessage?.text || "");
      expect(prUrl).toContain("github.com/test/repo/pull/");
    });
  });

  describe("Repository Configuration", () => {
    it("should handle when user has no GitHub repository set", async () => {
      // Don't set any repository
      ctx.claudeServer.onMessage(/.*/).reply([
        {
          type: "text",
          content: "I notice you don't have a repository configured.",
        },
      ]);

      const { ts } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "Show me my files",
        "U123456_NOREPO"
      );

      await ctx.waitFor(async () => {
        const messages = ctx.slackServer.getThreadMessages(ts);
        return messages.length > 1;
      });

      // Check that no repository was set for this user
      const repo = await ctx.getUserRepository("U123456_NOREPO");
      expect(repo).toBeNull();
    });

    it("should handle repository access denied", async () => {
      // Set a repository the user can't access
      await ctx.setUserEnvironment(
        "U123456_NOACCESS",
        "GITHUB_REPOSITORY",
        "https://github.com/private/repo"
      );

      ctx.claudeServer
        .onMessage(/.*/)
        .reply([{ type: "error", content: "Repository access denied" }]);

      const { ts } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "Check my repository access",
        "U123456_NOACCESS"
      );

      await ctx.waitFor(async () => {
        const reactions = ctx.slackServer.getReactions("C123456", ts);
        return reactions.includes("x");
      });

      const messages = ctx.slackServer.getThreadMessages(ts);
      const errorMessage = messages.find(
        (m) => m.text?.includes("Error") || m.text?.includes("access")
      );
      expect(errorMessage).toBeDefined();

      // Should have x reaction instead of eyes
      const reactions = ctx.slackServer.getReactions("C123456", ts);
      expect(reactions).toContain("x");
      expect(reactions).not.toContain("eyes");
    });

    it("should work when user has valid repository access", async () => {
      // Set a valid repository
      await ctx.setUserEnvironment(
        "U123456_VALID",
        "GITHUB_REPOSITORY",
        "https://github.com/user/valid-repo"
      );

      ctx.claudeServer.onMessage(/.*/).reply([
        {
          type: "text",
          content: "I can access your repository at user/valid-repo",
        },
      ]);

      const { ts } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "List my files",
        "U123456_VALID"
      );

      await ctx.waitFor(async () => {
        const messages = ctx.slackServer.getThreadMessages(ts);
        return messages.some((m) => m.text?.includes("valid-repo"));
      });

      const messages = ctx.slackServer.getThreadMessages(ts);
      const botMessage = messages.find((m) => m.user === "UBOT123");
      expect(botMessage?.text).toContain("valid-repo");

      // Should have successful reaction
      const reactions = ctx.slackServer.getReactions("C123456", ts);
      expect(reactions).toContain("eyes");
    });
  });

  describe("Demo Flow", () => {
    it("should set repository correctly when clicking Try Demo button", async () => {
      // Simulate demo button click
      // This would normally come from a welcome message
      const demoPayload = {
        action_id: "try_demo",
        value: "demo_repo",
      };

      // First send a message to get a thread started
      const { ts } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "Hello",
        "U123456_DEMO"
      );

      // Click the demo button
      await ctx.slackServer.simulateButtonClick(
        "try_demo",
        "https://github.com/demo/sandbox",
        ts,
        "U123456_DEMO"
      );

      // Wait for repository to be set
      await ctx.waitFor(async () => {
        const repo = await ctx.getUserRepository("U123456_DEMO");
        return repo !== null;
      });

      // Check repository was set correctly
      const repo = await ctx.getUserRepository("U123456_DEMO");
      expect(repo).toContain("github.com/demo/sandbox");

      // Send a follow-up message to verify it's using the demo repo
      ctx.claudeServer
        .onMessage(/.*/)
        .reply([
          { type: "text", content: "Using demo repository: demo/sandbox" },
        ]);

      const { ts: ts2 } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "What repository am I using?",
        "U123456_DEMO"
      );

      await ctx.waitFor(async () => {
        const messages = ctx.slackServer.getThreadMessages(ts2);
        return messages.some((m) => m.text?.includes("demo/sandbox"));
      });

      const messages = ctx.slackServer.getThreadMessages(ts2);
      expect(messages.some((m) => m.text?.includes("demo/sandbox"))).toBe(true);
    });
  });

  describe("Queue and Worker Management", () => {
    it("should create pgboss job for each message", async () => {
      ctx.claudeServer
        .onMessage(/.*/)
        .reply([{ type: "text", content: "Processing your request" }]);

      const { ts } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "Test message",
        "U123456"
      );

      // Wait for job to be created
      await ctx.waitFor(async () => {
        const jobs = await ctx.getJobs("messages");
        return jobs.length > 0;
      });

      const jobs = await ctx.getJobs("messages");
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs[0].data.messageText).toBe("Test message");
      expect(jobs[0].data.userId).toBe("U123456");
      expect(jobs[0].data.threadId).toBe(ts);
    });

    it("should route thread messages to same worker", async () => {
      ctx.claudeServer
        .onMessage(/.*/)
        .reply([{ type: "text", content: "Response" }]);

      // First message
      const { ts: threadTs } = await ctx.slackServer.simulateUserMessage(
        "C123456",
        "Start thread",
        "U123456"
      );

      // Second message in same thread
      await ctx.slackServer.simulateUserMessage(
        "C123456",
        "Continue thread",
        "U123456",
        threadTs
      );

      await ctx.waitFor(async () => {
        const jobs = await ctx.getJobs("messages");
        return jobs.length >= 2;
      });

      const jobs = await ctx.getJobs("messages");
      // Both should have same threadId for routing
      expect(jobs[0].data.threadId).toBe(threadTs);
      expect(jobs[1].data.threadId).toBe(threadTs);
    });
  });
});
