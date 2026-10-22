import { useMemo, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { VfxCue } from '../../../../../src/vfxCues'
import type { VfxCuePanelProps } from '../types'
import { defaultVfxCue, editableVfxCue, type VfxCueForm } from '../utils'

export function useVfxCuePanel({ project, cues, frameRange, onAdd, onUpdate, onRemove }: VfxCuePanelProps, vi: boolean) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<VfxCueForm>(() => defaultVfxCue(project, frameRange))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const rangeCues = useMemo(() => cues.filter((cue) => !frameRange || cue.frameStart <= frameRange.endFrame && cue.frameEnd >= frameRange.startFrame), [cues, frameRange])
  const nodes = project.scene.content.nodes.filter((node) => node.type !== 'camera' && node.type !== 'path')
  const selectedNode = nodes.find((node) => node.id === form.attachNodeId)
  const character = selectedNode?.type === 'character' ? Object.values(project.characters).find((item) => item.nodeId === selectedNode.id) : undefined
  const bones = character ? project.skeletons[character.skeletonId]?.bones ?? [] : []

  const editCue = (cue: VfxCue) => {
    setEditingId(cue.id); setForm(editableVfxCue(cue)); setError('')
  }
  const cancelEdit = () => { setEditingId(null); setForm(defaultVfxCue(project, frameRange)); setError('') }
  const submit = async () => {
    setError('')
    if (!form.effect.trim()) { setError(vi ? 'Nhập tên hiệu ứng từ kho App 4.' : 'Enter an effect name from the App 4 library.'); return }
    setBusy(true)
    const payload = { ...form, effect: form.effect.trim() }
    try {
      if (editingId) await onUpdate(editingId, { ...payload, attachNodeId: form.attachNodeId ?? null, attachBone: form.attachBone ?? null })
      else await onAdd(payload)
      cancelEdit()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    setError(''); setBusy(true)
    try { await onRemove(id); if (editingId === id) cancelEdit() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const updatePosition = (axis: 'x' | 'y' | 'z', raw: string) => setForm((current) => ({ ...current, position: { ...current.position, [axis]: Number(raw) } }))
  const setField = <K extends keyof VfxCueForm>(key: K, value: VfxCueForm[K]) => setForm((current) => ({ ...current, [key]: value }))

  return { editingId, form, setForm, setField, error, busy, rangeCues, nodes, character, bones, editCue, cancelEdit, submit, remove, updatePosition }
}
