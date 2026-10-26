export interface MinecraftTp { dimension: string; x: number; y: number; z: number; yaw: number; pitch: number }

/** F3+C uses absolute coordinates. Relative (~ / ^) coordinates cannot locate an offline film. */
export function parseMinecraftTp(text: string): MinecraftTp {
  const match = text.trim().match(/^(?:\/execute\s+in\s+([a-z0-9_.-]+:[a-z0-9_./-]+)\s+run\s+)?\/?tp\s+@s\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*$/i)
  if (!match) throw new TypeError('Không đọc được vị trí. Hãy dán nguyên dòng F3+C hoặc /tp @s X Y Z yaw pitch.')
  const values = match.slice(2).map((value) => /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value!) ? Number(value!.replace(',', '.')) : NaN)
  if (!values.every(Number.isFinite) || values.slice(0, 3).some((n) => Math.abs(n) > 30_000_000) || Math.abs(values[4]!) > 90) throw new TypeError('Tọa độ hoặc hướng nhìn không hợp lệ; cần số tuyệt đối trong biên giới thế giới.')
  return { dimension: match[1] ?? 'minecraft:overworld', x: values[0]!, y: values[1]!, z: values[2]!, yaw: values[3]!, pitch: values[4]! }
}
