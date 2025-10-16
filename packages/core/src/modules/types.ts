export interface ModuleInterface<_TModuleData = unknown> {
  /** Module identifier */
  name: string;

  /** Check if module should be enabled based on environment */
  isEnabled(): boolean;

  /** Initialize module - called once at startup */
  init(): Promise<void>;

  /** Register HTTP endpoints with Express app */
  registerEndpoints(app: any): void;
}

export interface HomeTabModule<TModuleData = unknown>
  extends ModuleInterface<TModuleData> {
  /** Render home tab elements */
  renderHomeTab(userId: string): Promise<any[]>;

  /** Handle home tab interactions */
  handleHomeTabAction(
    actionId: string,
    userId: string,
    value?: any
  ): Promise<void>;
}

export interface WorkerContext {
  workspaceDir: string;
  userId: string;
  threadId: string;
}

export interface WorkerModule<TModuleData = unknown>
  extends ModuleInterface<TModuleData> {
  /** Initialize workspace - called when worker starts session */
  initWorkspace(config: any): Promise<void>;

  /** Called at session start - can modify system prompt */
  onSessionStart(context: ModuleSessionContext): Promise<ModuleSessionContext>;

  /** Called at session end - can add action buttons */
  onSessionEnd(context: ModuleSessionContext): Promise<ActionButton[]>;

  /** Collect module-specific data before sending response. Return null if no data. */
  onBeforeResponse(context: WorkerContext): Promise<TModuleData | null>;
}

export interface OrchestratorModule<TModuleData = unknown>
  extends ModuleInterface<TModuleData> {
  /** Build environment variables for worker container */
  buildEnvVars(
    userId: string,
    baseEnv: Record<string, string>
  ): Promise<Record<string, string>>;

  /** Get container address for module-specific services */
  getContainerAddress(): string;
}

export interface DispatcherContext<TModuleData = unknown> {
  userId: string;
  channelId: string;
  threadTs: string;
  slackClient?: any;
  moduleData: TModuleData;
}

export interface DispatcherModule<TModuleData = unknown>
  extends ModuleInterface<TModuleData> {
  /** Generate action buttons. Return empty array if none. */
  generateActionButtons(
    context: DispatcherContext<TModuleData>
  ): Promise<ActionButton[]>;

  /** Handle action button clicks. Return true if handled. */
  handleAction(
    actionId: string,
    userId: string,
    context: any
  ): Promise<boolean>;

  /** Handle view submission (modal submitted). Optional. */
  handleViewSubmission?(
    viewId: string,
    userId: string,
    values: any,
    privateMetadata: string
  ): Promise<void>;
}

export interface ModuleSessionContext {
  userId: string;
  threadId: string;
  systemPrompt: string;
  workspace?: any;
}

export interface ActionButton {
  text: string;
  action_id: string;
  style?: "primary" | "danger";
  value?: string;
  url?: string;
}

export interface ThreadContext {
  userId: string;
  channelId: string;
  threadTs: string;
  slackClient?: any;
  moduleFields?: Record<string, any>; // Generic fields for modules to use
}
