export const DEFAULT_TOOL_APPROVAL_TIMEOUT_MS = 60_000;

export type ApprovalRequest = {
  toolName: string;
  args: readonly unknown[];
  confirmPrompt: string;
};

export type ApprovalSurface = {
  onApprovalRequest: (request: ApprovalRequest) => Promise<boolean> | boolean;
};

export async function requestToolApproval(params: {
  surface: ApprovalSurface;
  toolName: string;
  args: readonly unknown[];
  confirmPrompt: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const timeoutMs =
    Number.isFinite(params.timeoutMs) && (params.timeoutMs ?? 0) > 0
      ? Math.floor(params.timeoutMs!)
      : DEFAULT_TOOL_APPROVAL_TIMEOUT_MS;

  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    Promise.resolve(
      params.surface.onApprovalRequest({
        toolName: params.toolName,
        args: params.args,
        confirmPrompt: params.confirmPrompt,
      }),
    ).then(
      (approved) => {
        clearTimeout(timer);
        resolve(approved === true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}
