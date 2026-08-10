/** 外部工具 IPC 封装（SPEC F15）。 */
import { Channel } from "@tauri-apps/api/core";
import { invoke } from "./invoke";
import type { ExternalTool, ExternalToolOutput } from "./config";

export interface RunExternalToolRequest {
  toolName: string;
  documentId?: string;
  selection?: string;
  workspaceRoot?: string;
  /** 首次执行时由确认对话框填入；持久化确认另写 `externalToolsConfirmed`。 */
  confirmedForThisRun: boolean;
}

export interface ExternalToolResult {
  stdout: string;
  output: ExternalToolOutput;
}

export function listExternalTools(): Promise<ExternalTool[]> {
  return invoke<ExternalTool[]>("list_external_tools");
}

export function runExternalTool(
  request: RunExternalToolRequest,
): Promise<ExternalToolResult> {
  return invoke<ExternalToolResult>("run_external_tool", { args: request });
}

export function cancelExternalTool(): Promise<void> {
  return invoke<void>("cancel_external_tool");
}

/**
 * 一次响应装不下的输出走这里（SPEC §3.5）。
 *
 * 分片经 `Channel` 回来，在这里拼回完整字符串；Rust 保证不切开字符。
 */
export async function runExternalToolStreamed(
  request: RunExternalToolRequest,
): Promise<ExternalToolResult> {
  const chunks: string[] = [];
  const channel = new Channel<string>();
  channel.onmessage = (chunk) => chunks.push(chunk);
  const output = await invoke<ExternalToolOutput>(
    "run_external_tool_streamed",
    {
      args: request,
      channel,
    },
  );
  return { stdout: chunks.join(""), output };
}
