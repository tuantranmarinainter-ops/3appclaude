import { useEffect, useState } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'

export function useCharacterInspectorTab(nodeId: string) {
  const { useStore } = useDirector()
  const editingPose = useStore((s) => s.poseEditingId === nodeId)
  const [tab, setTab] = useState<'props' | 'pose'>(() => editingPose ? 'pose' : 'props')

  useEffect(() => {
    if (editingPose) setTab('pose')
  }, [editingPose, nodeId])

  return [tab, setTab] as const
}
