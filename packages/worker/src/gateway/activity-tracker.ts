/**
 * ActivityTracker - Manages activity breadcrumbs for loading messages
 * Maintains a queue of recent activities to show in Slack's loading UI
 */
export class ActivityTracker {
  private activities: string[] = [];
  private maxActivities: number;

  constructor(maxActivities: number = 5) {
    this.maxActivities = maxActivities;
  }

  /**
   * Add a new activity to the tracker
   * Automatically removes oldest activity if queue is full
   */
  addActivity(activity: string): void {
    // Add emoji prefix if not already present
    const activityWithEmoji = this.ensureEmoji(activity);

    this.activities.push(activityWithEmoji);

    // Keep only the last N activities
    if (this.activities.length > this.maxActivities) {
      this.activities.shift();
    }
  }

  /**
   * Get all activities as an array for loading_messages
   */
  getActivities(): string[] {
    return [...this.activities];
  }

  /**
   * Ensure activity has an emoji prefix for better UX
   */
  private ensureEmoji(activity: string): string {
    // If already has emoji, return as-is
    if (/^[\u{1F300}-\u{1F9FF}]|^[\u{2600}-\u{26FF}]/u.test(activity)) {
      return activity;
    }

    // Add appropriate emoji based on activity type
    if (activity.includes("running") || activity.includes("executing")) {
      return `⚡ ${activity}`;
    }
    if (activity.includes("reading") || activity.includes("loading")) {
      return `📖 ${activity}`;
    }
    if (activity.includes("writing") || activity.includes("saving")) {
      return `📝 ${activity}`;
    }
    if (activity.includes("editing")) {
      return `✏️ ${activity}`;
    }
    if (activity.includes("searching") || activity.includes("finding")) {
      return `🔍 ${activity}`;
    }
    if (activity.includes("thinking") || activity.includes("analyzing")) {
      return `💭 ${activity}`;
    }
    if (activity.includes("launching") || activity.includes("starting")) {
      return `🚀 ${activity}`;
    }
    if (activity.includes("fetching") || activity.includes("downloading")) {
      return `🌐 ${activity}`;
    }
    if (activity.includes("asking")) {
      return `❓ ${activity}`;
    }
    if (activity.includes("updating")) {
      return `🔄 ${activity}`;
    }
    if (
      activity.includes("setting up") ||
      activity.includes("preparing") ||
      activity.includes("resuming")
    ) {
      return `⚙️ ${activity}`;
    }
    if (activity.includes("burning")) {
      return `🔥 ${activity}`;
    }

    // Default emoji for unknown activities
    return `🔧 ${activity}`;
  }
}
