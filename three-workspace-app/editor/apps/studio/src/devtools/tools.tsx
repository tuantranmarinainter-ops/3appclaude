'use client'

import type { ReactNode } from 'react'
import { ExportDraftPanel } from './tools/ExportDraftPanel'
import { DiagnosticsPanel } from './tools/DiagnosticsPanel'

export interface DevToolDefinition {
  id: string
  /** Catalog keys, translated where they are shown. */
  title: string
  description: string
  render: () => ReactNode
}

export const DEV_TOOLS: DevToolDefinition[] = [
  {
    id: 'export-draft',
    title: '导出草稿',
    description: '下载当前打开草稿的 JSON 与用户关键帧。',
    render: () => <ExportDraftPanel />,
  },
  {
    id: 'unified-diagnostics',
    title: '项目诊断',
    description: '检查本地运行环境与当前项目，并下载脱敏诊断报告。',
    render: () => <DiagnosticsPanel />,
  },
]
