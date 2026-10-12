window.__ModuleLoader__.load({
  id: 'dsh-desktop-system3-settings',
  factory: (require) => {
    const React = require('react')
    const { Button, SettingsSecretField, IconLoadingOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const NS = 'desktop-system3'
    const ENTRY = 'dsh-desktop-system3-settings'
    const STATUS_PATH = '/api/desktop-system3.status'
    const en = {
      statusDisabled: 'Collaboration is off', statusStarting: 'Starting local collaboration services…', statusReady: 'Local collaboration services are ready. A real task is still needed to verify the remote connection.',
      statusError: 'Collaboration services could not start. Correct the configuration or turn collaboration off, then save.', statusConflict: 'Another profile already supplies Jev or System3. Disable that profile before enabling this page.',
      statusUnavailable: 'Could not read collaboration service status.', retryStatus: 'Refresh status',
      title: 'System3', intro: 'Let Jev route each task to a model configured in Models. Collaboration is off until you enable it and save.',
      enabled: 'Enable collaboration', endpoint: 'Jev endpoint', model: 'Jev model ID', protocol: 'Jev protocol',
      credentialRef: 'Credential reference', referenceHint: 'Use a dedicated reference for this Jev service. Leave it empty only for a service without authentication.',
      key: 'Jev API key', keyHint: 'Stored in the local credential store. Leave blank to keep the current key. To replace it, choose a new dedicated credential reference.', keySet: 'Key configured', keyUnset: 'Key not configured',
      candidates: 'Routing candidates', candidatesHint: 'Use the Provider ID and Model ID already configured in Settings → Models. Describe when Jev should choose each model.',
      routeId: 'Candidate ID', provider: 'Provider ID', routeModel: 'Model ID', description: 'When to choose this model', add: 'Add candidate', remove: 'Remove candidate',
      data: 'Data sent to configured services', public: 'Public', workspace: 'Workspace', sensitive: 'Sensitive', secret: 'Secret',
      consent: 'I approve sending the selected data classes to my Jev endpoint, candidate providers and the conversation’s current model provider.',
      dataHint: 'Jev receives task and conversation context for routing. Select every data class your conversations may contain. Local addresses and tunnels are treated as network services.',
      timeoutMs: 'Decision timeout (ms)', minConfidence: 'Minimum routing confidence', maxInputBytes: 'Maximum routing input (bytes)',
      save: 'Save configuration', saving: 'Saving…', saved: 'Configuration saved. Start a new conversation and send a small task to verify routing; saving does not test the connection.',
      invalidEndpoint: 'Enter an HTTP(S) endpoint without credentials, query parameters or a fragment.',
      invalidModel: 'Enter a Jev model ID.', invalidApproval: 'Select the data classes and approve sending them before enabling.',
      invalidCandidate: 'Add 1–254 candidates with unique lowercase IDs and complete provider, model and description fields. jev, baseline, abstain and unknown are reserved IDs.',
      invalidReference: 'Use letters, digits and underscores for the credential reference; it cannot start with a digit.',
      invalidLimits: 'Use positive integer timeout and input limits, and a confidence between 0 and 1.',
      referenceInUse: 'This credential reference already has a key. Choose a new dedicated reference before saving a replacement key.',
      missingKey: 'Enter a key for this credential reference, or clear the reference if your service does not require authentication.',
      credentialFailed: 'The credential could not be read or saved. Configuration was not changed.',
      settingsFailed: 'Configuration was not saved. Your draft is retained; any successfully saved API key remains in the credential store.',
      unavailable: 'System3 settings are unavailable for this connection.', reload: 'Discard draft and load saved configuration',
    }
    const zh = {
      statusDisabled: '协同已关闭', statusStarting: '正在启动本地协同服务…', statusReady: '本地协同服务已就绪，仍需通过真实任务验证远端连接',
      statusError: '协同服务未能启动，请修改配置或关闭协同后保存', statusConflict: '其他 Profile 已提供 Jev 或 System3，请先关闭其协同配置',
      statusUnavailable: '无法读取协同服务状态', retryStatus: '刷新状态',
      title: 'System3', intro: '由 Jev 为每个任务选择已在模型设置中配置的模型。启用并保存后才会进行协同。',
      enabled: '启用协同', endpoint: 'Jev 服务地址', model: 'Jev 模型 ID', protocol: 'Jev 协议',
      credentialRef: '凭证引用名', referenceHint: '为此 Jev 服务使用独立的引用名。仅当服务不需要认证时留空。',
      key: 'Jev API Key', keyHint: '保存到本地凭证存储。留空保留已有密钥；更换密钥时请填写新的专用凭证引用名。', keySet: '已配置密钥', keyUnset: '未配置密钥',
      candidates: '候选模型', candidatesHint: '填写设置 → 模型中已有的 Provider ID 和模型 ID，并描述 Jev 应在什么情况下选择该模型。',
      routeId: '候选 ID', provider: 'Provider ID', routeModel: '模型 ID', description: '何时选择此模型', add: '添加候选模型', remove: '移除候选模型',
      data: '发送到所配置服务的数据', public: '公开数据', workspace: '工作目录数据', sensitive: '敏感数据', secret: '机密数据',
      consent: '我同意将所选类别的数据发送到我配置的 Jev 服务、候选模型提供商和对话当前模型的提供商。',
      dataHint: 'Jev 会接收用于选路的任务和对话上下文。请选择对话可能包含的全部数据类别；本地地址和隧道也按网络服务处理。',
      timeoutMs: '决策超时（毫秒）', minConfidence: '最低选路置信度', maxInputBytes: '最大选路输入（字节）',
      save: '保存配置', saving: '正在保存…', saved: '配置已保存。请在新对话发送简单任务验证选路；保存不代表连接已通过测试。',
      invalidEndpoint: '请输入 HTTP(S) 地址，不要包含用户名、密码、查询参数或 fragment',
      invalidModel: '请填写 Jev 模型 ID', invalidApproval: '启用前请选择数据类别并确认发送授权',
      invalidCandidate: '请填写 1–254 个候选模型，ID 必须小写且唯一，提供商、模型与描述不能为空；jev、baseline、abstain、unknown 为保留 ID',
      invalidReference: '凭证引用名只允许字母、数字和下划线，不能以数字开头',
      invalidLimits: '超时和输入上限须为正整数，置信度须在 0 到 1 之间',
      referenceInUse: '此凭证引用已有密钥，请使用新的专用引用名保存新密钥',
      missingKey: '请填写此凭证引用的密钥；若服务无需认证，请清空凭证引用名',
      credentialFailed: '无法读取或保存凭证，配置未更改',
      settingsFailed: '配置未保存，草稿已保留；已成功保存的 API Key 仍在凭证存储中',
      unavailable: '当前连接无法使用 System3 设置', reload: '丢弃草稿并载入已保存配置',
    }
    const css = `
      .apusSystem3{display:flex;flex-direction:column;gap:16px;max-width:720px;color:var(--dsw-alias-label-primary)}
      .apusSystem3 h2{font-size:20px;font-weight:500;margin:0}
      .apusSystem3 h3{font-size:14px;font-weight:500;margin:0}
      .apusSystem3 p{font-size:13px;line-height:20px;margin:0;color:var(--dsw-alias-label-secondary)}
      .apusSystem3 label{display:flex;flex-direction:column;gap:6px;font-size:13px}
      .apusSystem3 input:not([type=checkbox]),.apusSystem3 select,.apusSystem3 textarea{box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-secondary);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
      .apusSystem3 .apusSystem3Check{flex-direction:row;align-items:flex-start;gap:8px}
      .apusSystem3 input:focus-visible,.apusSystem3 select:focus-visible,.apusSystem3 textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .apusSystem3Candidate{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-secondary);border-radius:8px}
      .apusSystem3Classes{display:flex;flex-wrap:wrap;gap:12px}
      .apusSystem3Loading svg{animation:apusSystem3Spin 1s linear infinite}
      @keyframes apusSystem3Spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.apusSystem3Loading svg{animation:none}}
      .apusSystem3Loading{display:flex;justify-content:center;align-items:center;min-height:200px}
    `

    function draftError(draft) {
      if (!draft.enabled) return null
      let url
      try { url = new URL(draft.endpoint) } catch (_error) { return 'invalidEndpoint' }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return 'invalidEndpoint'
      if (!draft.model.trim()) return 'invalidModel'
      if (!draft.remoteApproved || !draft.dataClasses.length) return 'invalidApproval'
      if (!draft.candidates.length || draft.candidates.length > 254) return 'invalidCandidate'
      if (!/^(?:[A-Za-z_][A-Za-z0-9_]*|)$/.test(draft.credentialRef)) return 'invalidReference'
      const ids = new Set()
      for (const row of draft.candidates) {
        if (!/^[a-z][a-z0-9-]*$/.test(row.id) || ['jev', 'baseline', 'abstain', 'unknown'].includes(row.id) || ids.has(row.id)) return 'invalidCandidate'
        ids.add(row.id)
        if (![row.provider, row.model, row.description].every(value => value.trim())) return 'invalidCandidate'
      }
      return Number.isInteger(draft.timeoutMs) && draft.timeoutMs > 0 && draft.timeoutMs <= 2147483647 &&
        Number.isSafeInteger(draft.maxInputBytes) && draft.maxInputBytes > 0 && Number.isFinite(draft.minConfidence) && draft.minConfidence >= 0 && draft.minConfidence <= 1 ? null : 'invalidLimits'
    }

    function validDraft(draft) { return draftError(draft) === null }

    /** Credentials are committed separately; a failed key write never enables the config. */
    async function saveSettings(form, credentials, draft, key, revision) {
      const invalid = draftError(draft)
      if (invalid) return { ok: false, error: invalid, keySaved: false }
      let keySaved = false
      try {
        if (key && draft.credentialRef) {
          const existing = await credentials.describe([draft.credentialRef])
          if (!existing.ok) return { ok: false, error: 'credentialFailed', keySaved }
          if (existing.value[draft.credentialRef]?.configured) return { ok: false, error: 'referenceInUse', keySaved }
          const result = await credentials.set(draft.credentialRef, key)
          if (!result.ok) return { ok: false, error: 'credentialFailed', keySaved }
          keySaved = true
        }
        if (draft.enabled && draft.credentialRef) {
          const result = await credentials.describe([draft.credentialRef])
          if (!result.ok) return { ok: false, error: 'credentialFailed', keySaved }
          if (!result.value[draft.credentialRef]?.configured) return { ok: false, error: 'missingKey', keySaved }
        }
      } catch (_error) { return { ok: false, error: 'credentialFailed', keySaved } }
      try {
        const ok = await form.mutate([{ op: 'set', path: ['settings'], value: draft }], revision)
        return { ok, error: ok ? null : 'settingsFailed', keySaved }
      } catch (_error) { return { ok: false, error: 'settingsFailed', keySaved } }
    }

    /** Read only the local activation state over the authenticated Harness API. */
    async function readStatus(signal) {
      const response = await fetch(STATUS_PATH, { credentials: 'same-origin', cache: 'no-store', signal })
      if (!response.ok) throw new Error('status unavailable')
      const value = await response.json()
      if (!value || !['disabled', 'starting', 'ready', 'error'].includes(value.state)) throw new Error('invalid status')
      return value
    }

    function System3Settings({ t, form, credentials }) {
      const snapshot = React.useSyncExternalStore(React.useCallback(callback => form.subscribe(callback), [form]), () => form.getSnapshot())
      const [draft, setDraft] = React.useState(null)
      const [revision, setRevision] = React.useState(undefined)
      const [key, setKey] = React.useState('')
      const [credential, setCredential] = React.useState({ configured: false, writable: true })
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [runtime, setRuntime] = React.useState(null)
      const [statusRefresh, setStatusRefresh] = React.useState(0)
      const mounted = React.useRef(true)
      React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
      React.useEffect(() => {
        if (!draft && snapshot.status === 'ready' && snapshot.value?.settings) {
          setDraft(structuredClone(snapshot.value.settings))
          setRevision(snapshot.revision)
        }
      }, [snapshot, draft])
      React.useEffect(() => {
        const abort = new AbortController()
        readStatus(abort.signal).then(value => { if (!abort.signal.aborted) setRuntime(value) }).catch(() => {
          if (!abort.signal.aborted) setRuntime({ state: 'unavailable' })
        })
        return () => abort.abort()
      }, [snapshot.revision, statusRefresh])
      const ref = draft?.credentialRef ?? ''
      React.useEffect(() => {
        let live = true
        setKey('')
        setCredential({ configured: false, writable: false })
        if (!ref) return () => { live = false }
        Promise.resolve(credentials.describe([ref])).then(result => {
          if (!live) return
          if (!result.ok) { setNotice('credentialFailed'); return }
          setCredential({ configured: result.value[ref]?.configured ?? false, writable: result.value[ref]?.writable ?? true })
        }).catch(() => { if (live) setNotice('credentialFailed') })
        return () => { live = false }
      }, [credentials, ref])
      if (snapshot.status === 'loading' || snapshot.status === 'ready' && !draft) return h('div', { className: 'apusSystem3Loading' }, h(IconLoadingOutlineRegular, { size: 20, 'aria-hidden': true }))
      if (!draft || snapshot.status !== 'ready') return h('p', { role: 'status' }, t('unavailable'))
      const blocked = busy || !snapshot.writable
      const edit = (field, value) => { setDraft(previous => ({ ...previous, [field]: value })); setNotice(null) }
      const field = (name, value, onEdit, options = {}) => h('label', { key: name }, t(name), h('input', { value, disabled: blocked, onChange: event => onEdit(event.target.value), ...options }))
      const check = (name, checked, onChange) => h('label', { className: 'apusSystem3Check', key: name }, h('input', { type: 'checkbox', checked, disabled: blocked, onChange: event => onChange(event.target.checked) }), t(name))
      const save = async () => {
        if (busy) return
        setBusy(true); setNotice(null)
        const result = await saveSettings(form, credentials, draft, key, revision)
        if (!mounted.current) return
        if (result.keySaved) {
          setKey('')
          setCredential(previous => ({ ...previous, configured: true }))
        }
        setBusy(false)
        setNotice(result.ok ? 'saved' : result.error)
        if (result.ok) { setDraft(null); setStatusRefresh(value => value + 1) }
      }
      return h('div', { className: 'apusSystem3' },
        h('h2', null, t('title')), h('p', null, t('intro')),
        h('p', { role: 'status' }, t(runtime?.error === 'service-conflict' ? 'statusConflict' : ({ disabled: 'statusDisabled', starting: 'statusStarting', ready: 'statusReady', error: 'statusError', unavailable: 'statusUnavailable' })[runtime?.state] ?? 'statusStarting')),
        h(Button, { variant: 'outline', disabled: busy, onClick: () => setStatusRefresh(value => value + 1) }, t('retryStatus')),
        check('enabled', draft.enabled, value => edit('enabled', value)),
        field('endpoint', draft.endpoint, value => edit('endpoint', value), { type: 'url' }),
        field('model', draft.model, value => edit('model', value)),
        h('label', null, t('protocol'), h('select', { value: draft.protocol, disabled: blocked, onChange: event => edit('protocol', event.target.value) }, ['openjev', 'typesafe'].map(value => h('option', { key: value, value }, value)))),
        field('credentialRef', draft.credentialRef, value => edit('credentialRef', value)), h('p', null, t('referenceHint')),
        h(SettingsSecretField, { id: 'apus-system3-key', label: t('key'), hint: t('keyHint'), text: key, configured: credential.configured,
          stateLabel: t(credential.configured ? 'keySet' : 'keyUnset'), disabled: blocked || !ref || !credential.writable, onEdit: setKey }),
        h('h3', null, t('candidates')), h('p', null, t('candidatesHint')),
        draft.candidates.map((row, index) => h('div', { className: 'apusSystem3Candidate', key: index },
          ...[['routeId', 'id'], ['provider', 'provider'], ['routeModel', 'model'], ['description', 'description']].map(([label, name]) =>
            field(label, row[name], value => edit('candidates', draft.candidates.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, [name]: value } : candidate)))),
          h(Button, { variant: 'outline', disabled: blocked, onClick: () => edit('candidates', draft.candidates.filter((_row, candidateIndex) => candidateIndex !== index)) }, t('remove')))),
        h(Button, { variant: 'outline', disabled: blocked || draft.candidates.length >= 254, onClick: () => edit('candidates', [...draft.candidates, { id: '', provider: '', model: '', description: '' }]) }, t('add')),
        h('h3', null, t('data')), h('p', null, t('dataHint')),
        h('div', { className: 'apusSystem3Classes' }, ['public', 'workspace', 'sensitive', 'secret'].map(value => check(value, draft.dataClasses.includes(value), checked => edit('dataClasses', checked ? [...draft.dataClasses, value] : draft.dataClasses.filter(item => item !== value))))),
        check('consent', draft.remoteApproved, value => edit('remoteApproved', value)),
        ...['timeoutMs', 'minConfidence', 'maxInputBytes'].map(name => field(name, draft[name], value => edit(name, Number(value)), { type: 'number', step: name === 'minConfidence' ? 0.05 : 1 })),
        notice ? h('p', { role: 'status' }, t(notice)) : null,
        notice === 'settingsFailed' ? h(Button, { variant: 'outline', disabled: blocked, onClick: () => { setDraft(null); setNotice(null); setKey('') } }, t('reload')) : null,
        h(Button, { variant: 'primary', disabled: blocked, onClick: save }, t(busy ? 'saving' : 'save')))
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = ENTRY
        style.textContent = css
        document.head.appendChild(style)
        return () => style.remove()
      })
      const t = ctx.locale.bind(NS)
      const form = ctx.configForms.get(ENTRY)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'system3', order: 35, label: () => t('title'),
        inject: () => ({ t, form, credentials: ctx.remote.credentials }),
      }, System3Settings))
    }
    return { apply, inject: ['slots', 'locale', 'configForms', 'remote', 'remote.credentials'], saveSettings, validDraft, readStatus }
  },
})
