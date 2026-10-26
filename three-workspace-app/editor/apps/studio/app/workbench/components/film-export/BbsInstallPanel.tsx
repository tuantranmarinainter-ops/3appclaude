'use client'

import { useStudioLocale } from '../../../../src/devtools/localePreference'
import { useBbsInstall } from './hooks/useBbsInstall'

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`

export function BbsInstallPanel({ state }: { state: ReturnType<typeof useBbsInstall> }) {
  const vi = useStudioLocale() === 'vi'
  const count = (status: 'install' | 'skip' | 'conflict') => state.plan?.files.filter((file) => file.status === status).length ?? 0
  return (
    <section className="wb-film-export" aria-labelledby="wb-bbs-install-title">
      <h2 id="wb-bbs-install-title">{vi ? 'Cài vào BBS FS' : 'Install into BBS FS'}</h2>
      <div className="wb-film-export-controls">
        <label>{vi ? 'Thư mục game' : 'Game folder'}
          <input value={state.gameDir} onChange={(event) => state.setGameDir(event.target.value)} placeholder="C:\\...\\BBS" disabled={state.busy} />
        </label>
        <div className="wb-scene-render-actions">
          <button type="button" onClick={() => void state.loadWorlds()} disabled={state.busy || !state.gameDir.trim()}>{vi ? 'Đọc world' : 'Load worlds'}</button>
          <label>{vi ? 'World' : 'World'}
            <select value={state.worldName} onChange={(event) => state.setWorldName(event.target.value)} disabled={state.busy || !state.worlds.length}>
              {state.worlds.map((world) => <option key={world.name} value={world.name}>{world.name}</option>)}
            </select>
          </label>
        </div>
        <label>{vi ? 'Gói ZIP đã xuất' : 'Exported ZIP package'}
          <input type="file" accept=".zip,application/zip" onChange={(event) => { state.setPackageFile(event.target.files?.[0] ?? null) }} disabled={state.busy} />
        </label>
        <small>{vi ? 'Xem trước chỉ đọc ZIP. Chỉ nút Cài mới ghi file vào game.' : 'Preview only reads the ZIP. Files are written only after you choose Install.'}</small>
        <div className="wb-scene-render-actions">
          <button type="button" onClick={() => void state.preview()} disabled={state.busy || !state.packageFile || !state.worldName}>{state.busy ? (vi ? 'Đang xử lý…' : 'Working…') : (vi ? 'Xem trước' : 'Preview')}</button>
          {state.plan && <button type="button" onClick={() => void state.apply()} disabled={state.busy || count('install') === 0}>{vi ? `Cài ${count('install')} file` : `Install ${count('install')} files`}</button>}
          {state.status && <span role="status" aria-live="polite">{state.status}</span>}
        </div>
        {state.error && <p className="wb-scene-render-error" role="alert">{state.error}</p>}
        {state.plan && <div aria-label={vi ? 'Danh sách xem trước' : 'Install preview'}>
          <p>{state.plan.packageName} · {state.plan.gameDir} · {vi ? 'world' : 'world'} {state.plan.worldName}</p>
          <p>{vi ? `Sẽ cài ${count('install')}, bỏ qua ${count('skip')} giống hệt, xung đột ${count('conflict')}.` : `${count('install')} new, ${count('skip')} identical, ${count('conflict')} conflicts.`}</p>
          <ul>{state.plan.files.map((file) => <li key={file.target}>
            <code>{file.source}</code> → <code>{file.target}</code> · {formatBytes(file.sizeBytes)} · {file.status === 'install' ? (vi ? 'Mới' : 'New') : file.status === 'skip' ? (vi ? 'Giống hệt' : 'Identical') : (vi ? 'Xung đột · giữ nguyên file' : 'Conflict · keep existing file')}
          </li>)}</ul>
        </div>}
        {!!state.installs.length && <div>
          <h3>{vi ? 'Đã cài theo nhật ký' : 'Recorded installs'}</h3>
          <ul>{state.installs.map((item) => <li key={item.installId}>
            {item.packageName} · {item.files} {vi ? 'file' : 'files'} · {new Date(item.installedAt).toLocaleString()}
            <button type="button" onClick={() => void state.uninstall(item.installId)} disabled={state.busy}>{vi ? 'Gỡ theo nhật ký' : 'Uninstall recorded files'}</button>
          </li>)}</ul>
        </div>}
      </div>
    </section>
  )
}
