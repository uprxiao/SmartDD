/** These are host-issued handles, not a wire format. Copies never carry authority. */
interface CallerBase {
  readonly operationId: string;
  readonly appId: string;
  readonly packageHash: string;
  readonly action: string;
}
export type ApplicationPlanReference = Readonly<{ kind: 'snapshot-v2' | 'run-plan'; hash: string }>;
export type CallerContext = CallerBase & (
  | { readonly kind: 'ui'; readonly projectId: string; readonly operations: readonly string[] }
  | { readonly kind: 'management'; readonly projectId: string | null }
  | { readonly kind: 'agent'; readonly projectId: string; readonly taskId: string; readonly runId: string; readonly entry: 'mcp' | 'cli'; readonly requestId: string; readonly plan: ApplicationPlanReference }
  | { readonly kind: 'internal'; readonly projectId: string; readonly job: string; readonly parentOperationId: string }
);
