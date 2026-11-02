'use client'

import type { useBbsInstall } from './hooks/useBbsInstall'

/** B50/B51/B29/B33: step ① — the game folder (picked or remembered), worlds read automatically, mods checked. */
export function GameFolderStep({ install, vi }: { install: ReturnType<typeof useBbsInstall>; vi: boolean }) {
  const capabilities = install.capabilities
  const recent = install.recentDirs.filter((dir) => dir !== install.gameDir)
  return (
    <fieldset className="wb-film-step" disabled={install.busy}>
      <legend><span className="wb-film-step-no">1</span>{vi ? 'Game Minecraft' : 'Minecraft game'}</legend>
      <label>{vi ? 'Thư mục game' : 'Game folder'}
        <span className="wb-film-row">
          <input value={install.gameDir} onChange={(event) => install.setGameDir(event.target.value)} placeholder="S:\Minecraft\Minecraft Forge-1.20.1" spellCheck={false} />
          <button type="button" onClick={() => void install.chooseFolder()}>{vi ? 'Chọn…' : 'Browse…'}</button>
        </span>
        <small>{vi ? 'Thư mục gốc của game (có saves, mods, config). Chọn nhầm thư mục con thì app tự lùi về gốc.' : 'The game root (with saves, mods, config). A sub-folder is walked back to the root.'}</small>
      </label>
      {recent.length > 0 && <label>{vi ? 'Dùng gần đây' : 'Recent'}
        <select value="" onChange={(event) => { if (event.target.value) install.setGameDir(event.target.value) }}>
          <option value="">{vi ? 'Chọn thư mục đã dùng…' : 'Pick a recent folder…'}</option>
          {recent.map((dir) => <option key={dir} value={dir}>{dir}</option>)}
        </select>
      </label>}
      {install.gameDir.trim() && <p className="wb-film-step-note" role="status" aria-live="polite">
        {install.scanning ? (vi ? 'Đang tìm world trong game…' : 'Looking for worlds…')
          : install.scanned ? (vi
            ? `Tìm thấy ${install.worlds.length} world · BBS ${capabilities?.bbs ? `${capabilities.bbs.version} ✓` : '✗'} · AAA (hiệu ứng) ${capabilities?.aaa ? '✓' : '✗'}`
            : `${install.worlds.length} worlds · BBS ${capabilities?.bbs ? `${capabilities.bbs.version} ✓` : '✗'} · AAA ${capabilities?.aaa ? '✓' : '✗'}`)
          : <button type="button" onClick={() => void install.loadWorlds()}>{vi ? 'Tìm world trong game' : 'Find worlds'}</button>}
      </p>}
      {install.scanned && <label>{vi ? 'World sẽ nhận phim' : 'World to install into'}
        <select value={install.worldName} onChange={(event) => install.setWorldName(event.target.value)} disabled={!install.worlds.length}>
          {install.worlds.map((world) => <option key={world.name} value={world.name}>{world.name}</option>)}
        </select>
        <small>{vi ? 'App nhớ world này cho thư mục game này.' : 'Remembered for this game folder.'}</small>
      </label>}
      {install.gameRunning && <p role="alert" className="wb-film-warn">{vi
        ? 'Minecraft đang chạy từ thư mục này. Hãy thoát world (hoặc đóng bảng Film trong BBS) trước khi cài, để game không bị lỗi.'
        : 'Minecraft is running from this folder. Leave the world (or close the BBS Film panel) before installing.'}</p>}
    </fieldset>
  )
}
