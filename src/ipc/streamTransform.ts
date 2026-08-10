/** Tier C 只读流式变换：预览、过滤导出和替换后另存。 */
import { Channel } from "@tauri-apps/api/core";
import type { FilterRule } from "./filter";
import { invoke } from "./invoke";
import type { SearchOptions } from "./search";

export interface StreamProgress {
  processedLines: number;
  totalLines: number;
}

export interface StreamReplaceSample {
  line: number;
  before: string;
  after: string;
}

export interface StreamReplacePreview {
  previewId: string;
  replacementCount: number;
  outputBytes: number;
  samples: StreamReplaceSample[];
}

export interface StreamTransformReport {
  affectedLines: number;
  bytesWritten: number;
}

function progressChannel(onProgress: (progress: StreamProgress) => void) {
  const channel = new Channel<StreamProgress>();
  channel.onmessage = onProgress;
  return channel;
}

export function previewStreamReplace(
  documentId: string,
  query: string,
  replacement: string,
  options: SearchOptions,
  preserveCase: boolean,
  onProgress: (progress: StreamProgress) => void,
): Promise<StreamReplacePreview> {
  return invoke<StreamReplacePreview>("preview_stream_replace", {
    args: { documentId, query, replacement, options, preserveCase },
    progress: progressChannel(onProgress),
  });
}

export function applyStreamReplace(
  previewId: string,
  outputPath: string,
  onProgress: (progress: StreamProgress) => void,
): Promise<StreamTransformReport> {
  return invoke<StreamTransformReport>("apply_stream_replace", {
    args: { previewId, outputPath },
    progress: progressChannel(onProgress),
  });
}

export function exportStreamFilter(
  documentId: string,
  rules: FilterRule[],
  outputPath: string,
  onProgress: (progress: StreamProgress) => void,
): Promise<StreamTransformReport> {
  return invoke<StreamTransformReport>("export_stream_filter", {
    args: { documentId, rules, outputPath },
    progress: progressChannel(onProgress),
  });
}

export function cancelStreamTransform(documentId: string): Promise<void> {
  return invoke<void>("cancel_stream_transform", { documentId });
}
