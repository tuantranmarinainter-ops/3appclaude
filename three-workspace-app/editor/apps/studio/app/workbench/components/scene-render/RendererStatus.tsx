type RenderDevice = {
  kind: 'gpu' | 'cpu'
  name: string
}

function readRenderDevice(value: unknown): RenderDevice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'gpu' && candidate.kind !== 'cpu') return null
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null
  return { kind: candidate.kind, name: candidate.name.trim() }
}

export function rendererStatusText(provenance: Record<string, unknown> | undefined): string | null {
  if (!provenance) return null
  const candidates = Array.isArray(provenance.renderDevices) ? provenance.renderDevices : []
  const devices = candidates.map(readRenderDevice).filter((device): device is RenderDevice => device !== null)
  if (!devices.length) return null
  const unique = [...new Map(devices.map((device) => [`${device.kind}:${device.name}`, device])).values()]
  if (unique.every((device) => device.kind === 'cpu')) return 'CPU'
  return unique.map((device) => device.kind === 'gpu' ? `GPU: ${device.name}` : 'CPU').join(' · ')
}

export function RendererStatus({ provenance }: { provenance: Record<string, unknown> | undefined }) {
  const text = rendererStatusText(provenance)
  return text ? <small aria-label="Render device">{text}</small> : null
}
