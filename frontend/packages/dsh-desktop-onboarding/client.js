window.__ModuleLoader__.load({
  id: 'dsh-desktop-onboarding',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    const { Button, Modal, IconGlobeOutline14, FishLogo } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'desktop-onboarding'
    // Retained as the acknowledgement payload for settings compatibility.
    // Eligibility is install-scoped; changing this value never re-prompts.
    const WIZARD_VERSION = '2026-09-21.1'
    // Settings section the "configure a model" action opens.
    const MODELS_SECTION_ID = 'models'

    // Settings owned by the notice. The host half (index.js) registered the
    // schema; the value object the mirror hands back has exactly this shape.
    const WIZARD_ACK_FIELD = 'wizardVersion'

    // GitHub mark (Octicons mark-github, 16px grid), drawn in currentColor.
    const GITHUB_MARK_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z'

    const STYLE_ID = 'dsh-desktop-onboarding-style'
    // Same dialog chrome as the stock welcome notice it replaces: a bounded
    // card whose body scrolls while the brand row and actions stay put.
    const STYLE = `
      .dshDeskOnbDialog{width:min(600px,100%);padding:0}
      .dshDeskOnbContent{box-sizing:border-box;display:flex;flex-direction:column;max-height:calc(100vh - 48px);padding:24px 28px}
      .dshDeskOnbHeader{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
      .dshDeskOnbBrandMark{display:inline-flex;align-items:center;color:var(--dsw-alias-label-primary)}
      .dshDeskOnbBrandName{font-size:15px;font-weight:500;color:var(--dsw-alias-label-primary);line-height:22px}
      .dshDeskOnbBrandBy{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px}
      .dshDeskOnbHeading{flex:none;color:var(--dsw-alias-label-primary);outline:none;margin:16px 0 0;font-size:20px;font-weight:500;line-height:28px}
      .dshDeskOnbBody{flex:1;min-height:0;margin-top:12px;overflow-y:auto}
      .dshDeskOnbParagraph{margin:0 0 10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshDeskOnbSubheading{margin:14px 0 6px;font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary);line-height:20px}
      .dshDeskOnbLinkList{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 12px}
      .dshDeskOnbLinkChip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px 5px 10px;border:1px solid var(--dsw-alias-border-secondary);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;text-decoration:none;transition:background .15s ease,border-color .15s ease}
      .dshDeskOnbLinkChip:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-primary,var(--dsw-alias-border-secondary))}
      .dshDeskOnbLinkChip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .dshDeskOnbLinkIcon{flex:none;display:inline-flex;color:var(--dsw-alias-label-secondary)}
      @media (prefers-reduced-motion:reduce){.dshDeskOnbLinkChip{transition:none}}
      .dshDeskOnbHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
      .dshDeskOnbActions{flex:none;display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
      @media (width<=560px){.dshDeskOnbContent{padding:20px}}
    `

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'dsh-desktop-onboarding'
      style.textContent = STYLE
      document.head.appendChild(style)
    }

    // ---------- locale dictionaries ----------

    const en = {
      brandName: 'APUS Reflex Harness',
      brandBy: 'Model-as-a-Harness',
      step0Title: 'Start your first task',
      declarationBody: '1. Open Settings → Models and add your provider, API key and model. For a custom provider, enter its Base URL.\n\n2. Choose a workspace folder and select the configured model in a new conversation.\n\n3. Send a small task to check that the model responds.',
      desktopIntroTitle: 'Your model, your configuration',
      desktopIntroBody: 'Requests go to the model provider you select. System3 collaboration is off by default and can be enabled in Settings → System3 after you configure your services.',
      officialSite: 'Configuration guide',
      officialSiteUrl: 'https://github.com/cryptoSUN2049/APUS-Reflex-Harness#readme',
      desktopIntroFeedback: 'You can return to Settings → Models at any time. Report problems through GitHub Issues.',
      configureModel: 'Configure a model',
      later: 'Explore first'
    }

    const zh = {
      brandName: 'APUS Reflex Harness',
      brandBy: 'Model-as-a-Harness',
      step0Title: '开始第一个任务',
      declarationBody: '1. 打开设置 → 模型，添加服务商、API Key 和模型；自定义服务商还需填写 Base URL。\n\n2. 选择工作目录，在新对话中选用已配置的模型。\n\n3. 发送一个简单任务，确认模型能够正常回复。',
      desktopIntroTitle: '使用你自己的模型配置',
      desktopIntroBody: '请求会发送到你选择的模型服务商。System3 协同默认关闭，可在设置 → System3 中配置自己的服务后启用。',
      officialSite: '配置教程',
      officialSiteUrl: 'https://github.com/cryptoSUN2049/APUS-Reflex-Harness#readme',
      desktopIntroFeedback: '随时可回到设置 → 模型修改配置。遇到问题请通过 GitHub Issues 反馈。',
      configureModel: '去配置模型',
      later: '先看看'
    }

    // ---------- components ----------

    function BrandHeader({ t }) {
      const height = 18
      return React.createElement(
        'div',
        { className: 'dshDeskOnbHeader' },
        React.createElement(
          'span',
          { className: 'dshDeskOnbBrandMark', 'aria-hidden': 'true' },
          React.createElement(FishLogo, { size: height })
        ),
        React.createElement('span', { className: 'dshDeskOnbBrandName' }, t('brandName')),
        React.createElement('span', { className: 'dshDeskOnbBrandBy' }, t('brandBy'))
      )
    }

    function GitHubMark({ size = 14 }) {
      return React.createElement(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none' },
        React.createElement('path', { d: GITHUB_MARK_PATH, fill: 'currentColor' })
      )
    }

    // External links open in the system browser through the desktop host.
    function NoticeBody({ t }) {
      const paragraphs = t('declarationBody').split('\n\n')
      const links = [
        { label: 'GitHub', href: 'https://github.com/cryptoSUN2049/APUS-Reflex-Harness/issues', icon: GitHubMark },
        { label: t('officialSite'), href: t('officialSiteUrl'), icon: IconGlobeOutline14 }
      ]
      return React.createElement(
        'div',
        { className: 'dshDeskOnbBody' },
        paragraphs.map((paragraph, idx) =>
          React.createElement('p', { key: idx, className: 'dshDeskOnbParagraph' }, paragraph)
        ),
        React.createElement('h3', { className: 'dshDeskOnbSubheading' }, t('desktopIntroTitle')),
        React.createElement('p', { className: 'dshDeskOnbParagraph' }, t('desktopIntroBody')),
        React.createElement(
          'div',
          { className: 'dshDeskOnbLinkList' },
          links.map((link) =>
            React.createElement(
              'a',
              { key: link.href, className: 'dshDeskOnbLinkChip', href: link.href, target: '_blank', rel: 'noreferrer' },
              React.createElement(
                'span',
                { className: 'dshDeskOnbLinkIcon', 'aria-hidden': 'true' },
                React.createElement(link.icon, { size: 14 })
              ),
              React.createElement('span', null, link.label)
            )
          )
        ),
        React.createElement('p', { className: 'dshDeskOnbHint' }, t('desktopIntroFeedback'))
      )
    }

    function onboardingDecision(value) {
      const acknowledged = typeof value?.wizardVersion === 'string' && value.wizardVersion.length > 0
      return value?.eligible === true && !acknowledged ? 'show' : 'complete'
    }

    // ---------- the first-run notice ----------

    function DesktopOnboardingNotice(props) {
      const { complete, openSection, t } = props
      const wizardScope = props.controller.scope
      const [decision, setDecision] = useState('loading')
      const titleRef = useRef(null)
      const finishedRef = useRef(false)

      // Persist the acknowledgement, then hand the onboarding slot back. The
      // optional follow-up runs after the slot is released (e.g. opening the
      // models settings section).
      const finish = useCallback((followUp) => {
        if (finishedRef.current) return
        finishedRef.current = true
        const scope = wizardScope.getSnapshot()
        const persist = scope.mode === 'memory'
          ? Promise.resolve()
          : wizardScope.set(WIZARD_ACK_FIELD, WIZARD_VERSION).catch(() => undefined)
        Promise.resolve(persist).finally(() => {
          complete()
          if (followUp) followUp()
        })
      }, [complete, wizardScope])

      useEffect(() => {
        const read = () => {
          const snap = wizardScope.getSnapshot()
          // Wait for the Host section so returning users never see a flash.
          if (snap.mode !== 'memory' && snap.status === 'loading') return
          const value = snap.value ?? {}
          setDecision(onboardingDecision(value))
        }
        let unsubscribe
        try {
          unsubscribe = wizardScope.subscribe(read)
          read()
        } catch {
          // Scope errors are non-fatal: a failing scope must not block boot.
        }
        return () => { if (unsubscribe) unsubscribe() }
      }, [wizardScope])

      // Ineligible installs and every prior acknowledgement skip straight on.
      useEffect(() => {
        if (decision === 'complete' && !finishedRef.current) {
          finishedRef.current = true
          complete()
        }
      }, [decision, complete])

      const visible = decision === 'show'

      // Keep the application behind the dialog inert, like the stock notice.
      useEffect(() => {
        if (!visible) return
        const appRoot = document.getElementById('root')
        if (appRoot === null) return
        const previous = appRoot.inert
        appRoot.inert = true
        return () => { appRoot.inert = previous }
      }, [visible])

      useEffect(() => {
        if (visible) titleRef.current?.focus()
      }, [visible])

      if (!visible) return null

      return React.createElement(
        Modal,
        {
          open: true,
          title: t('step0Title'),
          onClose: () => finish(),
          headless: true,
          className: 'dshDeskOnbDialog'
        },
        React.createElement(
          'div',
          { className: 'dshDeskOnbContent' },
          React.createElement(BrandHeader, { t }),
          React.createElement(
            'h2',
            { ref: titleRef, className: 'dshDeskOnbHeading', tabIndex: -1 },
            t('step0Title')
          ),
          React.createElement(NoticeBody, { t }),
          React.createElement(
            'div',
            { className: 'dshDeskOnbActions' },
            React.createElement(
              Button,
              { variant: 'outline', onClick: () => finish() },
              t('later')
            ),
            React.createElement(
              Button,
              {
                variant: 'primary',
                onClick: () => finish(() => {
                  if (typeof openSection === 'function') openSection(MODELS_SECTION_ID)
                })
              },
              t('configureModel')
            )
          )
        )
      )
    }

    // ---------- composition ----------

    function apply(ctx) {
      ctx.inject(['slots', 'locale', 'settingsScope'], (scope) => {
        installStyles()
        const t = scope.locale.bind(NS)

        const wizardScope = scope.settingsScope.bind({
          namespace: NS,
          decode: (value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {})
        })

        scope.locale.register(NS, { zh, en })

        const controller = { scope: wizardScope }

        // The stock welcome-notice / official-DeepSeek onboarding entries are
        // removed upstream by the settings-models patch (the desktop notice owns
        // first-run), so this notice registers under its own id — no shadowing.
        scope.slots.inject('settings.onboarding', () => scope.slots.register({
          name: 'settings.onboarding',
          id: 'dsh-desktop-onboarding',
          order: 0,
          inject: () => ({ controller, t })
        }, DesktopOnboardingNotice))
      })
    }

    const inject = []

    exports.apply = apply
    exports.inject = inject
    exports.onboardingDecision = onboardingDecision
    return module.exports
  }
})
