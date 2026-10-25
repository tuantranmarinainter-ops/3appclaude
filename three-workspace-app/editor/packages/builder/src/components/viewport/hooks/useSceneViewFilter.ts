import { useEffect } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'

/**
 * Đẩy bộ lọc xem N5 từ store xuống Stage. Stage chỉ áp nó trong vòng render tương tác;
 * đổi lọc không chạm vào tài liệu nên project không bị đánh dấu đã sửa và khung xuất không đổi.
 */
export function useSceneViewFilter(charactersOnly: boolean, backgroundHidden: boolean): void {
  const { stage } = useDirector()
  useEffect(() => {
    stage.setSceneViewFilter({ charactersOnly, backgroundHidden })
  }, [stage, charactersOnly, backgroundHidden])
}
