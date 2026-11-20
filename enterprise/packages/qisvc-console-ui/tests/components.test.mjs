import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const colorMode = vue.reactive({ value: 'light' })
const components = new Map()

function loadComponent(name) {
  const filename = name.endsWith('.vue') ? name : resolve(root, 'components', `${name}.vue`)
  if (components.has(filename)) return components.get(filename)
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const content = descriptor.script || descriptor.scriptSetup
    ? compileScript(descriptor, { id: filename, inlineTemplate: true }).content
    : compileTemplate({ source: descriptor.template.content, filename, id: filename }).code + '\nexport default { render }'
  const result = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.equal(result.diagnostics?.length ?? 0, 0)
  const module = { exports: {} }
  function localRequire(id) {
    if (id === '#imports') return { useColorMode: () => colorMode }
    if (id.endsWith('.vue')) return { default: loadComponent(resolve(dirname(filename), id)) }
    return require(id)
  }
  // Only local, checked-in SFCs are evaluated; no application code or network is involved.
  new Function('require', 'module', 'exports', result.outputText)(localRequire, module, module.exports)
  components.set(filename, module.exports.default)
  return module.exports.default
}

function element(type, text = '') { return { type, text, props: {}, children: [], parent: null } }
function remove(node) {
  if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
  node.parent = null
}
function insert(node, parent, anchor = null) {
  if (node.parent) remove(node)
  const index = anchor ? parent.children.indexOf(anchor) : -1
  parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  node.parent = parent
}
const renderer = vue.createRenderer({
  createElement: element,
  createText: text => element('#text', text),
  createComment: text => element('#comment', text),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text; node.children = [] },
  patchProp: (node, key, _previous, value) => { node.props[key] = value },
  insert,
  remove,
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insertStaticContent(content, parent, anchor) {
    const node = element('#static', content)
    insert(node, parent, anchor)
    return [node, node]
  },
})

function mount(t, name, initialProps = {}, slots = {}) {
  const state = vue.reactive({ ...initialProps })
  const calls = {}
  const app = renderer.createApp({ setup: () => () => vue.h(loadComponent(name), state, slots) })
  const definitions = {
    UInput: ['modelValue', 'size', 'type', 'disabled', 'min', 'max', 'placeholder', 'maxlength', 'icon'],
    UAvatar: ['src', 'icon', 'alt', 'size'],
    UDropdownMenu: ['items', 'disabled', 'content'],
    UButton: ['disabled'],
    UColorModeButton: [],
    UBadge: ['color','variant','size'],
    UAlert: ['title','color','variant'],
    UIcon: ['name'],
  }
  for (const [componentName, props] of Object.entries(definitions)) {
    app.component(componentName, vue.defineComponent({
      name: componentName,
      inheritAttrs: false,
      props,
      emits: componentName === 'UInput' ? ['update:modelValue'] : [],
      setup(props, context) {
        const call = { props, ...context }
        ;(calls[componentName] ??= []).push(call)
        return () => vue.h(componentName, context.attrs, [
          context.slots.leading?.({ ui: {} }),
          context.slots.default?.({ ui: {} }),
          context.slots.trailing?.({ ui: {} }),
        ])
      },
    }))
  }
  const container = element('root')
  app.mount(container)
  t.after(() => app.unmount())
  return { state, calls, container }
}

function find(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children) {
    const result = find(child, predicate)
    if (result) return result
  }
}
function text(node) { return node.text + node.children.map(text).join('') }

test('all SFCs compile and every component has a resolvable public export and declaration', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  for (const name of readdirSync(resolve(root, 'components')).filter(name => name.endsWith('.vue'))) {
    const filename = resolve(root, 'components', name)
    const entry = manifest.exports[`./components/${name.replace('.vue', '')}`]
    assert.ok(entry, `${name} must have a public export`)
    assert.equal(resolve(root, entry.import), filename)
    assert.ok(readFileSync(resolve(root, entry.types), 'utf8').includes('export default component'))
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
    assert.deepEqual(errors, [], name)
    const id = name.replace('.vue', '')
    const script = descriptor.script || descriptor.scriptSetup ? compileScript(descriptor, { id }) : null
    const template = compileTemplate({
      source: descriptor.template.content,
      filename,
      id,
      compilerOptions: { bindingMetadata: script?.bindings },
    })
    assert.deepEqual(template.errors, [], name)
    for (const style of descriptor.styles) {
      const compiled = compileStyle({ source: style.content, filename, id, scoped: style.scoped })
      assert.deepEqual(compiled.errors, [], `${name} styles`)
    }
  }
})

test('input forwards attrs and slots and preserves string/number models and modifiers', async t => {
  const updates = []
  const { state, calls } = mount(t, 'ConsoleInput', {
    modelValue: '7', modelModifiers: { number: true }, type: 'number', disabled: true,
    maxlength: 12, 'aria-label': '数量', 'onUpdate:modelValue': value => updates.push(value),
  }, { trailing: () => [vue.h('span', '件')] })
  const input = calls.UInput[0]
  assert.equal(input.props.size, 'md')
  assert.equal(input.props.disabled, true)
  assert.equal(input.props.type, 'number')
  assert.equal(input.props.maxlength, 12)
  assert.equal(input.attrs['aria-label'], '数量')
  assert.ok(input.slots.trailing)
  input.emit('update:modelValue', '12')
  assert.deepEqual(updates, [12])
  state.modelValue = 18
  state.size = 'lg'
  await vue.nextTick()
  assert.equal(input.props.modelValue, 18)
  assert.equal(input.props.size, 'lg')
  state.modelModifiers = { trim: true }
  await vue.nextTick()
  input.emit('update:modelValue', '  标题  ')
  assert.deepEqual(updates, [12, '标题'])
})

test('search keeps accessible defaults, allows label override, and forwards edits', async t => {
  const updates = []
  const { state, calls } = mount(t, 'ConsoleListSearch', { 'onUpdate:modelValue': value => updates.push(value) })
  const input = calls.UInput[0]
  assert.equal(input.props.modelValue, '')
  assert.equal(input.props.placeholder, '搜索')
  assert.equal(input.props.maxlength, 100)
  assert.equal(input.props.icon, 'i-lucide-search')
  assert.equal(input.attrs['aria-label'], '搜索')
  input.emit('update:modelValue', '记录')
  assert.deepEqual(updates, ['记录'])
  state.placeholder = '搜索记录'
  state['aria-label'] = '按作品编号搜索'
  state.disabled = true
  await vue.nextTick()
  assert.equal(input.attrs['aria-label'], '按作品编号搜索')
  assert.equal(input.props.disabled, true)
})

test('date range exposes independent models, bounds, empty values, and disabled state', async t => {
  const updates = []
  const { state, calls, container } = mount(t, 'ConsoleListDateRange', {
    label: '制作日期', start: '2026-10-01', end: '2026-10-07', disabled: true,
    'onUpdate:start': value => updates.push(['start', value]),
    'onUpdate:end': value => updates.push(['end', value]),
  })
  const [start, end] = calls.UInput
  assert.equal(start.props.max, '2026-10-07')
  assert.equal(end.props.min, '2026-10-01')
  assert.equal(start.props.disabled, true)
  assert.equal(end.props.disabled, true)
  assert.equal(find(container, node => node.props.role === 'group').props['aria-label'], '制作日期')
  state.disabled = false
  await vue.nextTick()
  assert.equal(start.props.disabled, false)
  assert.equal(end.props.disabled, false)
  start.emit('update:modelValue', '2026-10-02')
  end.emit('update:modelValue', '')
  assert.deepEqual(updates, [['start', '2026-10-02'], ['end', '']])
  state.start = ''
  state.end = ''
  await vue.nextTick()
  assert.equal(start.props.max, undefined)
  assert.equal(end.props.min, undefined)
})

test('settings field links the real input and switches to non-label text when unlinked', async t => {
  const { state, container } = mount(t, 'ConsoleSettingsField', { label: '名称', inputId: 'name-input' }, {
    default: () => [vue.h('input', { id: 'name-input' })],
  })
  assert.equal(find(container, node => node.type === 'label').props.for, 'name-input')
  assert.ok(find(container, node => node.type === 'input'))
  state.inputId = undefined
  await vue.nextTick()
  assert.equal(find(container, node => node.type === 'label'), undefined)
  assert.ok(text(container).includes('名称'))
})

test('filter and form-action layouts preserve their slots and DOM attributes', t => {
  const filters = mount(t, 'ConsoleListFilters', { 'aria-label': '筛选条件' }, {
    default: () => [vue.h('span', '状态')], search: () => [vue.h('input', { name: 'search' })],
  })
  assert.ok(text(filters.container).includes('状态'))
  assert.ok(find(filters.container, node => node.props.name === 'search'))
  assert.ok(find(filters.container, node => node.props['aria-label'] === '筛选条件'))
  const actions = mount(t, 'ConsoleFormActions', {}, { default: () => [vue.h('button', { type: 'submit' }, '保存')] })
  assert.equal(find(actions.container, node => node.type === 'button').props.type, 'submit')
})

test('avatar uses explicit host fallback, forwards attrs, and contains no fixed asset path', async t => {
  const { state, calls } = mount(t, 'ConsoleAvatar', { src: null, alt: '管理员', size: 'sm' })
  const avatar = calls.UAvatar[0]
  assert.equal(avatar.props.src, undefined)
  assert.equal(avatar.props.icon, 'i-lucide-user-round')
  assert.equal(avatar.props.alt, '管理员')
  state.fallbackSrc = '/host-avatar.png'
  await vue.nextTick()
  assert.equal(avatar.props.src, '/host-avatar.png')
  state.src = '/current-avatar.png'
  await vue.nextTick()
  assert.equal(avatar.props.src, '/current-avatar.png')
})

test('user menu injects only host-visible items/actions and disables its trigger', async t => {
  let logoutCount = 0
  const allowedItems = [[{ label: '退出登录', onSelect: () => { logoutCount++ } }]]
  const { state, calls, container } = mount(t, 'ConsoleUserMenu', {
    name: '管理员', avatarUrl: '/avatar.png', items: allowedItems,
  })
  assert.deepEqual(calls.UDropdownMenu[0].props.items, allowedItems)
  assert.equal(calls.UAvatar[0].props.src, '/avatar.png')
  assert.equal(calls.UButton[0].attrs['aria-label'], '管理员用户菜单')
  calls.UDropdownMenu[0].props.items[0][0].onSelect(new Event('select'))
  assert.equal(logoutCount, 1)
  state.items = []
  state.disabled = true
  state.name = '租户管理员'
  await vue.nextTick()
  assert.deepEqual(calls.UDropdownMenu[0].props.items, [])
  assert.equal(calls.UButton[0].props.disabled, true)
  assert.ok(text(container).includes('租户管理员'))
  const customAvatar = mount(t, 'ConsoleUserMenu', { name: '租户', avatarUrl: null, items: [] }, {
    avatar: ({ name, avatarUrl }) => [vue.h('span', `${name}:${avatarUrl}`)],
  })
  assert.equal(customAvatar.calls.UAvatar, undefined)
  assert.ok(text(customAvatar.container).includes('租户:null'))
})

test('theme labels react to the host color mode and forward disabled', async t => {
  colorMode.value = 'light'
  const { calls } = mount(t, 'ConsoleThemeToggle', { disabled: true })
  const button = calls.UColorModeButton[0]
  assert.equal(button.attrs['aria-label'], '切换颜色模式')
  await vue.nextTick()
  assert.equal(button.attrs['aria-label'], '切换深色模式')
  assert.equal(button.attrs.disabled, true)
  colorMode.value = 'dark'
  await vue.nextTick()
  assert.equal(button.attrs['aria-label'], '切换浅色模式')
  assert.equal(button.attrs.title, '切换浅色模式')
})


test('authorization notices separate unlicensed, expired, suspended and verified states', async t => {
  const {state,container,calls}=mount(t,'ConsoleAuthorizationState',{state:'unlicensed',expiresAt:null,checkedAt:null})
  assert.ok(text(container).includes('未授权'))
  assert.ok(text(container).includes('暂未获取'))
  assert.ok(!text(container).includes('永久'))
  state.state='expired';state.expiresAt='2026-10-07T00:00:00.000Z'
  await vue.nextTick()
  assert.ok(text(container).includes('授权到期'))
  assert.ok(text(container).includes('2026/10/07'))
  state.state='suspended';state.message='<b>custom notice</b>'
  await vue.nextTick()
  assert.ok(text(container).includes('授权封禁'))
  assert.ok(text(container).includes('<b>custom notice</b>'))
  assert.equal(find(container,node=>node.type==='b'),undefined)
  state.loading=true
  await vue.nextTick()
  assert.equal(calls.UButton[0].props.disabled,true)
  state.state='active';state.expiresAt=null
  await vue.nextTick()
  assert.ok(text(container).includes('授权正常'))
  assert.ok(text(container).includes('未提供到期时间'))
  assert.ok(!text(container).includes('永久'))
})
