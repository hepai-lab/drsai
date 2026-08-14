/**
 * SshRemotePanel — interactive overlay for managing remote SSH connections.
 *
 * Triggered by `/remote` (no args) or `ui_action: "remote.panel"`.
 *
 * Views:
 *   - list:    Show saved SSH configs + connect/disconnect/test/delete
 *   - edit:    Add/edit an SSH config (host, port, user, key, workdir, etc.)
 *   - dirs:    Browse remote directories to select a working directory
 *   - status:  Show current connection status
 *
 * Keyboard:
 *   ↑↓ navigate · Enter select · e edit · t test · d delete
 *   n new · c connect · x disconnect · s status · q quit
 */

import { Box, Text, useInput } from 'ink'
import { useCallback, useEffect, useState } from 'react'

import type { GatewayClient } from '../gatewayClient.js'
import type {
  RemoteConnectionResult,
  RemoteDirEntry,
  RemoteStatusResult,
  SSHConfigEntry,
} from '../gatewayTypes.js'
import { theme } from '../theme.js'

type View = 'list' | 'edit' | 'dirs' | 'status' | 'connecting'

interface Props {
  gw: GatewayClient
  onDismiss: () => void
  /** Called when a remote connection is established — TUI should switch gateway mode. */
  onRemoteConnect?: (result: RemoteConnectionResult) => void
  /** Called when disconnecting — TUI should switch back to local gateway. */
  onRemoteDisconnect?: () => void
}

// ── Edit form state ──────────────────────────────────────────────────
interface EditForm {
  name: string
  host: string
  port: string
  username: string
  password: string
  private_key_path: string
  remote_python: string
  remote_python_src_root: string
  remote_workdir: string
}

const EMPTY_FORM: EditForm = {
  name: '', host: '', port: '22', username: '', password: '',
  private_key_path: '', remote_python: 'python3',
  remote_python_src_root: '', remote_workdir: '',
}

const EDIT_FIELDS: { key: keyof EditForm; label: string; hint?: string }[] = [
  { key: 'name', label: 'Name', hint: 'unique identifier' },
  { key: 'host', label: 'Host', hint: 'IP or hostname' },
  { key: 'port', label: 'Port', hint: 'default 22' },
  { key: 'username', label: 'Username' },
  { key: 'password', label: 'Password', hint: 'or use private key below' },
  { key: 'private_key_path', label: 'Private Key Path', hint: '~/.ssh/id_rsa' },
  { key: 'remote_python', label: 'Remote Python', hint: 'python3' },
  { key: 'remote_python_src_root', label: 'Remote PYTHONPATH', hint: 'drsai src dir (optional)' },
  { key: 'remote_workdir', label: 'Remote Workdir', hint: 'working directory on remote' },
]

export function SshRemotePanel({ gw, onDismiss, onRemoteConnect, onRemoteDisconnect }: Props) {
  const [configs, setConfigs] = useState<SSHConfigEntry[]>([])
  const [cursor, setCursor] = useState(0)
  const [view, setView] = useState<View>('list')
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState(theme.text)
  const [status, setStatus] = useState<RemoteStatusResult | null>(null)

  // Edit form state
  const [form, setForm] = useState<EditForm>(EMPTY_FORM)
  const [formFieldIdx, setFormFieldIdx] = useState(0)
  const [isEditing, setIsEditing] = useState(false)  // true = editing existing

  // Dir browser state
  const [dirEntries, setDirEntries] = useState<RemoteDirEntry[]>([])
  const [dirCursor, setDirCursor] = useState(0)
  const [dirPath, setDirPath] = useState('~')

  // ── Refresh configs ────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const res = await gw.request<{ configs: SSHConfigEntry[] }>('remote.config.list', {})
      setConfigs(res.configs || [])
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
      setMessageColor(theme.error)
    }
  }, [gw])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await gw.request<RemoteStatusResult>('remote.status', {})
      setStatus(res)
    } catch {
      setStatus(null)
    }
  }, [gw])

  useEffect(() => {
    refresh()
    refreshStatus()
  }, [refresh, refreshStatus])

  // ── Show message helper ───────────────────────────────────────────
  function showMsg(text: string, color: string = theme.text) {
    setMessage(text)
    setMessageColor(color)
  }

  // ── Actions ───────────────────────────────────────────────────────

  const testConnection = async (cfg: SSHConfigEntry) => {
    showMsg('⏳ Testing connection...', theme.muted)
    try {
      const res = await gw.request<{ ok: boolean; info: string }>('remote.test', {
        name: cfg.name,
      })
      if (res.ok) {
        showMsg(`✅ ${res.info}`, theme.good)
      } else {
        showMsg(`❌ ${res.info}`, theme.error)
      }
    } catch (e) {
      showMsg(`❌ ${(e as Error).message}`, theme.error)
    }
  }

  const connect = async (cfg: SSHConfigEntry) => {
    setView('connecting')
    showMsg(`⏳ Connecting to ${cfg.host}...`, theme.muted)
    try {
      const res = await gw.request<RemoteConnectionResult>('remote.connect', {
        name: cfg.name,
      })
      if (res.connected) {
        showMsg(
          `✅ Connected to ${res.remote_hostname} (port ${res.remote_port}→${res.local_port})`,
          theme.good,
        )
        setStatus(res)
        onRemoteConnect?.(res)
        setView('status')
      } else {
        showMsg('❌ Connection failed', theme.error)
        setView('list')
      }
    } catch (e) {
      showMsg(`❌ ${(e as Error).message}`, theme.error)
      setView('list')
    }
  }

  const disconnect = async () => {
    showMsg('⏳ Disconnecting...', theme.muted)
    try {
      await gw.request('remote.disconnect', {})
      showMsg('✅ Disconnected', theme.good)
      setStatus(null)
      onRemoteDisconnect?.()
      refresh()
    } catch (e) {
      showMsg(`❌ ${(e as Error).message}`, theme.error)
    }
  }

  const deleteConfig = async (cfg: SSHConfigEntry) => {
    try {
      await gw.request('remote.config.delete', { name: cfg.name })
      showMsg(`✓ Deleted '${cfg.name}'`, theme.good)
      refresh()
    } catch (e) {
      showMsg(`❌ ${(e as Error).message}`, theme.error)
    }
  }

  const startEdit = (cfg?: SSHConfigEntry) => {
    if (cfg) {
      setForm({
        name: cfg.name,
        host: cfg.host,
        port: String(cfg.port || 22),
        username: cfg.username,
        password: '',  // don't prefill masked password
        private_key_path: cfg.private_key_path || '',
        remote_python: cfg.remote_python || 'python3',
        remote_python_src_root: cfg.remote_python_src_root || '',
        remote_workdir: cfg.remote_workdir || '',
      })
      setIsEditing(true)
    } else {
      setForm(EMPTY_FORM)
      setIsEditing(false)
    }
    setFormFieldIdx(0)
    setView('edit')
  }

  const saveForm = async () => {
    try {
      const params: Record<string, unknown> = {
        name: form.name,
        host: form.host,
        port: parseInt(form.port) || 22,
        username: form.username,
        remote_python: form.remote_python,
        remote_python_src_root: form.remote_python_src_root,
        remote_workdir: form.remote_workdir,
      }
      if (form.password) params.password = form.password
      if (form.private_key_path) params.private_key_path = form.private_key_path

      await gw.request('remote.config.save', params)
      showMsg(`✓ Saved '${form.name}'`, theme.good)
      setView('list')
      refresh()
    } catch (e) {
      showMsg(`❌ ${(e as Error).message}`, theme.error)
    }
  }

  const browseDirs = async (path: string) => {
    try {
      const res = await gw.request<{ entries: RemoteDirEntry[] }>('remote.list_files', { path })
      setDirEntries(res.entries || [])
      setDirPath(path)
      setDirCursor(0)
      setView('dirs')
    } catch (e) {
      showMsg(`❌ ${(e as Error).message}`, theme.error)
    }
  }

  // ── Input handling ────────────────────────────────────────────────

  useInput((input, key) => {
    // Global: Escape/q to go back or quit
    if (key.escape) {
      if (view === 'list') { onDismiss(); return }
      setView('list')
      return
    }

    if (view === 'list') {
      if (input === 'q') { onDismiss(); return }
      if (key.upArrow) setCursor(c => Math.max(0, c - 1))
      if (key.downArrow) setCursor(c => Math.min(configs.length - 1, c + 1))
      if (input === 'n') startEdit()
      if (input === 'r') refresh()
      if (input === 's') { refreshStatus(); setView('status') }
      if (input === 'x' && status?.connected) disconnect()

      if (configs[cursor]) {
        const cfg = configs[cursor]
        if (key.return) connect(cfg)
        if (input === 'e') startEdit(cfg)
        if (input === 't') testConnection(cfg)
        if (input === 'd') deleteConfig(cfg)
        if (input === 'b' && status?.connected) browseDirs(cfg.remote_workdir || '~')
      }
    }

    if (view === 'status') {
      if (input === 'q' || key.return) setView('list')
      if (input === 'x' && status?.connected) disconnect()
    }

    if (view === 'edit') {
      if (input === 'q') { setView('list'); return }
      if (key.upArrow) setFormFieldIdx(i => Math.max(0, i - 1))
      if (key.downArrow) setFormFieldIdx(i => Math.min(EDIT_FIELDS.length - 1, i + 1))
      if (key.return) {
        if (formFieldIdx === EDIT_FIELDS.length - 1) {
          saveForm()
        } else {
          setFormFieldIdx(i => i + 1)
        }
      }
      // Tab to cycle fields
      if (key.tab) {
        setFormFieldIdx(i => (i + 1) % EDIT_FIELDS.length)
      }
    }

    if (view === 'dirs') {
      if (input === 'q') { setView('edit'); return }
      if (key.upArrow) setDirCursor(c => Math.max(0, c - 1))
      if (key.downArrow) setDirCursor(c => Math.min(dirEntries.length - 1, c + 1))
      if (key.return && dirEntries[dirCursor]) {
        const entry = dirEntries[dirCursor]
        if (entry.is_dir) {
          browseDirs(entry.path)
        } else {
          // Select as workdir (parent dir)
          const parent = entry.path.replace(/\/[^/]+$/, '')
          setForm(f => ({ ...f, remote_workdir: parent }))
          showMsg(`✓ Workdir set to: ${parent}`, theme.good)
          setView('edit')
        }
      }
      if (input === 's' && dirEntries[dirCursor]) {
        // Select current dir as workdir
        setForm(f => ({ ...f, remote_workdir: dirPath }))
        showMsg(`✓ Workdir set to: ${dirPath}`, theme.good)
        setView('edit')
      }
    }
  })

  // ── Render: List view ─────────────────────────────────────────────
  if (view === 'list') {
    const isConnected = status?.connected
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>🔌 SSH Remote Manager</Text>
          {isConnected && (
            <Text color={theme.good}>  ● {status?.remote_hostname}</Text>
          )}
        </Box>

        {configs.length === 0 ? (
          <Text color={theme.muted}>  No SSH configs saved. Press 'n' to create one.</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={theme.muted} dimColor>
              {'  Name'.padEnd(16)} {'Host'.padEnd(22)} {'User'.padEnd(12)} {'Port'.padEnd(6)} {'Workdir'}
            </Text>
            {configs.map((c, i) => {
              const isCursor = i === cursor
              const prefix = isCursor ? '▶ ' : '  '
              const nameStr = (prefix + c.name).slice(0, 14).padEnd(16)
              const hostStr = c.host.slice(0, 20).padEnd(22)
              const userStr = c.username.slice(0, 10).padEnd(12)
              const portStr = String(c.port || 22).padEnd(6)
              const workStr = c.remote_workdir || '~'
              return (
                <Text key={c.name} color={isCursor ? theme.accent : theme.text} bold={isCursor}>
                  {nameStr} {hostStr} {userStr} {portStr} {workStr}
                </Text>
              )
            })}
          </Box>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={messageColor}>{message}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            ↑↓ nav · Enter connect · e edit · t test · d delete · n new · s status
            {isConnected ? ' · x disconnect' : ''} · q quit
          </Text>
        </Box>
      </Box>
    )
  }

  // ── Render: Edit view ─────────────────────────────────────────────
  if (view === 'edit') {
    const field = EDIT_FIELDS[formFieldIdx]
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>
            {isEditing ? 'Edit SSH Config' : 'New SSH Config'}
          </Text>
        </Box>

        <Box flexDirection="column">
          {EDIT_FIELDS.map((f, i) => {
            const isCursor = i === formFieldIdx
            const val = form[f.key]
            const displayVal = f.key === 'password' && val ? '•'.repeat(val.length) : val
            return (
              <Text key={f.key} color={isCursor ? theme.accent : theme.text} bold={isCursor}>
                {isCursor ? '▶ ' : '  '}{f.label.padEnd(20)}: {displayVal || '(empty)'}
              </Text>
            )
          })}
        </Box>

        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            Field: {field.label} {field.hint ? `(${field.hint})` : ''}
          </Text>
        </Box>

        {message && (
          <Box marginTop={1}>
            <Text color={messageColor}>{message}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            ↑↓ fields · Tab next · Enter save/next · q cancel
          </Text>
        </Box>
      </Box>
    )
  }

  // ── Render: Status view ───────────────────────────────────────────
  if (view === 'status') {
    if (!status || !status.connected) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
          <Text bold color={theme.primary}>Remote Status</Text>
          <Text color={theme.muted}>  Not connected to any remote server.</Text>
          <Box marginTop={1}>
            <Text color={theme.muted} dimColor>q back</Text>
          </Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>Remote Connection Status</Text>
        </Box>
        <Text color={theme.good}>  ● Connected</Text>
        <Text color={theme.text}>  Host:          {status.remote_hostname}</Text>
        <Text color={theme.text}>  Remote CWD:    {status.remote_cwd}</Text>
        <Text color={theme.text}>  Remote Port:   {status.remote_port}</Text>
        <Text color={theme.text}>  Local Port:    {status.local_port}</Text>
        <Text color={theme.text}>  Remote PID:    {status.remote_pid}</Text>
        {status.remote_python_version && (
          <Text color={theme.text}>  Python:        {status.remote_python_version}</Text>
        )}
        <Text color={theme.muted} dimColor>  WS URL:        {status.ws_attach_url}</Text>

        {message && (
          <Box marginTop={1}>
            <Text color={messageColor}>{message}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            x disconnect · q back
          </Text>
        </Box>
      </Box>
    )
  }

  // ── Render: Connecting view ───────────────────────────────────────
  if (view === 'connecting') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Text bold color={theme.primary}>🔌 Connecting...</Text>
        <Box marginTop={1}>
          <Text color={theme.muted}>{message || 'Establishing SSH tunnel...'}</Text>
        </Box>
      </Box>
    )
  }

  // ── Render: Dir browser view ─────────────────────────────────────
  if (view === 'dirs') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>📁 Remote Directory: {dirPath}</Text>
        </Box>
        <Box flexDirection="column">
          {dirEntries.length === 0 ? (
            <Text color={theme.muted}>  (empty)</Text>
          ) : (
            dirEntries.map((e, i) => {
              const isCursor = i === dirCursor
              const icon = e.is_dir ? '📁' : '📄'
              return (
                <Text key={e.path} color={isCursor ? theme.accent : theme.text} bold={isCursor}>
                  {isCursor ? '▶ ' : '  '}{icon} {e.name}
                </Text>
              )
            })
          )}
        </Box>

        {message && (
          <Box marginTop={1}>
            <Text color={messageColor}>{message}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            ↑↓ nav · Enter open dir · s select as workdir · q back
          </Text>
        </Box>
      </Box>
    )
  }

  return null
}
