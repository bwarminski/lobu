import { Pool } from "pg";
import PgBoss from "pg-boss";
import { MockSlackServer } from "../mocks/slack-server";
import { MockClaudeServer } from "../mocks/claude-server";

export class TestContext {
  public pgPool: Pool;
  public pgBoss: PgBoss;
  public slackServer: MockSlackServer;
  public claudeServer: MockClaudeServer;

  constructor() {
    this.slackServer = new MockSlackServer(4001);
    this.claudeServer = new MockClaudeServer(8081);

    const dbUrl =
      process.env.TEST_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5433/peerbot_test";
    this.pgPool = new Pool({ connectionString: dbUrl });
    this.pgBoss = new PgBoss(dbUrl);
  }

  async setup() {
    // Start mock servers
    await this.slackServer.start();
    await this.claudeServer.start();

    // Start pgBoss
    await this.pgBoss.start();

    // Clean database
    await this.cleanDatabase();

    console.log("Test context setup complete");
  }

  async teardown() {
    await this.slackServer.stop();
    await this.claudeServer.stop();
    await this.pgBoss.stop();
    await this.pgPool.end();
  }

  async cleanDatabase() {
    // Clean up test data
    await this.pgPool.query("DELETE FROM pgboss.job WHERE name LIKE 'test_%'");
    await this.pgPool.query(
      "DELETE FROM users WHERE platform_user_id LIKE 'U%TEST%'"
    );
  }

  // Helper to wait for a condition
  async waitFor(
    condition: () => Promise<boolean> | boolean,
    options = { timeout: 5000, interval: 100 }
  ): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < options.timeout) {
      if (await condition()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, options.interval));
    }

    throw new Error(`Timeout waiting for condition after ${options.timeout}ms`);
  }

  // Get pgboss jobs
  async getJobs(queueName: string = "messages") {
    const result = await this.pgPool.query(
      "SELECT * FROM pgboss.job WHERE name = $1 ORDER BY created_on DESC",
      [queueName]
    );
    return result.rows;
  }

  // Check if a worker was deployed
  async getDeployedWorkers() {
    // In test mode, check pgboss for worker deployment jobs
    const result = await this.pgPool.query(
      "SELECT * FROM pgboss.job WHERE name = 'worker_deployment' ORDER BY created_on DESC"
    );
    return result.rows;
  }

  // Set user environment variable
  async setUserEnvironment(
    userId: string,
    key: string,
    value: string,
    channelId?: string
  ) {
    // First ensure user exists
    await this.pgPool.query(
      `INSERT INTO users (platform, platform_user_id, username) 
       VALUES ('slack', $1, $2) 
       ON CONFLICT (platform, platform_user_id) DO NOTHING`,
      [userId, `test_${userId.toLowerCase()}`]
    );

    const userResult = await this.pgPool.query(
      "SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1",
      [userId]
    );

    const userDbId = userResult.rows[0].id;

    await this.pgPool.query(
      `INSERT INTO user_environ (user_id, name, value, channel_id) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, name, channel_id) DO UPDATE SET value = $3`,
      [userDbId, key, value, channelId]
    );
  }

  // Get user's repository setting
  async getUserRepository(userId: string): Promise<string | null> {
    const result = await this.pgPool.query(
      `SELECT ue.value 
       FROM user_environ ue 
       JOIN users u ON u.id = ue.user_id 
       WHERE u.platform_user_id = $1 AND ue.name = 'GITHUB_REPOSITORY'`,
      [userId]
    );
    return result.rows[0]?.value || null;
  }

  // Helper to find button in Slack message
  findButton(message: any, actionId: string): any {
    if (!message.blocks) return null;

    for (const block of message.blocks) {
      if (block.type === "actions" && block.elements) {
        const button = block.elements.find(
          (e: any) => e.action_id === actionId
        );
        if (button) return button;
      }
    }
    return null;
  }

  // Helper to extract URL from text
  extractUrl(text: string): string | null {
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    return urlMatch ? urlMatch[0] : null;
  }
}
