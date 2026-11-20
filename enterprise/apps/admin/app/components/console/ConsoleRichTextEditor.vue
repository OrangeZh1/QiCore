<!-- Adapted from school-shop ConsoleRichTextEditor: toolbar, layout, lifecycle and local Lucide icons. -->
<script setup lang="ts">
import '@wangeditor/editor/dist/css/style.css'
import type {IDomEditor,IEditorConfig,IToolbarConfig} from '@wangeditor/editor'
import MaterialPicker from './MaterialPicker.vue'
import ConsoleAsyncState from './ConsoleAsyncState.vue'
import { styleEditorIcons } from '~/utils/editor-icons'

type ImageInsert = (url: string, alt: string, href: string) => void
type PickerFile = {id:string;value?:string}

const props = withDefaults(defineProps<{
  endpoint: string
  disabled?: boolean
  maxlength?: number
  placeholder?: string
  label?: string
  purpose?: 'policy'|'library'
  imageSource?: (id:string)=>string
  displayHtml?: (html:string)=>string
  storeHtml?: (html:string)=>string
}>(), {
  disabled: false,
  maxlength: 30000,
  placeholder: '请输入内容',
  label: '协议正文',
  purpose: 'policy',
})

const emit=defineEmits<{busy:[value:boolean]}>()
const model = defineModel<string>({ default: '' })
const toast = useToast()
const toolbarHost = shallowRef<HTMLElement | null>(null)
const editorHost = shallowRef<HTMLElement | null>(null)
const pickerOpen = ref(false)
watch(pickerOpen,value=>emit('busy',value))
const pendingFile = ref<PickerFile | null>(null)
let editor: IDomEditor | null = null
let toolbar: {destroy:()=>void} | null = null
let toolbarObserver: MutationObserver | null = null
let imageInsert: ImageInsert | null = null
let syncing = false
let lastHtml = ''

let disposed = false
const initializing=ref(false),initializationError=ref(false)

const toolbarKeys: IToolbarConfig['toolbarKeys'] = [
  'headerSelect', 'blockquote', '|',
  'bold', 'underline', 'italic', 'through', 'code', 'sup', 'sub', 'clearStyle',
  'color', 'bgColor', '|', 'fontSize', 'fontFamily', 'lineHeight', '|',
  'bulletedList', 'numberedList', 'todo',
  'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyJustify',
  'indent', 'delIndent', '|', 'emotion', 'insertLink',
  'uploadImage', 'insertTable', 'codeBlock', 'divider', '|',
  'undo', 'redo',
]

function normalizedHtml(instance: IDomEditor) {
  const html=instance.isEmpty() ? '' : instance.getHtml()
  return props.storeHtml?props.storeHtml(html):html
}

function openPicker() {
  pendingFile.value = null
  pickerOpen.value = true
}

function selectMedia(file: PickerFile) {
  pendingFile.value = file
}

async function initialize(){
  if(disposed||initializing.value||editor)return
  initializing.value=true;initializationError.value=false
  try{
  const {createEditor,createToolbar,i18nChangeLanguage}=await import('@wangeditor/editor')
  if(disposed)return
  i18nChangeLanguage('zh-CN')
  if (!toolbarHost.value || !editorHost.value) return

  const config: Partial<IEditorConfig> = {
    autoFocus: !props.disabled,
    readOnly: props.disabled,
    scroll: true,
    maxLength: props.maxlength,
    placeholder: props.placeholder,
    customAlert(info, type) {
      toast.add({ title: info, color: type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'neutral' })
    },
    onMaxLength() {
      toast.add({ title: `内容不能超过 ${props.maxlength} 个字符`, color: 'warning' })
    },
    onChange(instance) {
      if (syncing || !editor) return
      const value = normalizedHtml(instance)
      if (value === lastHtml) return
      lastHtml = value
      if (value !== model.value) model.value = value
    },
    MENU_CONF: {
      uploadImage: {
        customBrowseAndUpload(insert: ImageInsert) {
          imageInsert = insert
          openPicker()
        },
      },
    },
  }

  editor = createEditor({ selector: editorHost.value, html: props.displayHtml?props.displayHtml(model.value):model.value, config, mode: 'default' })
  lastHtml=normalizedHtml(editor)
  const input=editorHost.value.querySelector('[contenteditable]');input?.setAttribute('aria-label',props.label);input?.setAttribute('role','textbox')
  toolbar = createToolbar({
    editor,
    selector: toolbarHost.value,
    config: { toolbarKeys, modalAppendToBody: false },
    mode: 'default',
  })
  const host = toolbarHost.value
  const applyIcons = () => {
    if (!host.querySelector('button[data-menu-key]')) return
    styleEditorIcons(host)
    toolbarObserver?.disconnect()
    toolbarObserver = null
  }
  // wangEditor mounts toolbar buttons asynchronously after createToolbar returns.
  toolbarObserver = new MutationObserver(applyIcons)
  toolbarObserver.observe(host, { childList: true, subtree: true })
  applyIcons()
  if (props.disabled) editor.disable()
  }catch{
    toolbarObserver?.disconnect();toolbarObserver=null
    toolbar?.destroy();toolbar=null;editor?.destroy();editor=null
    if(!disposed)initializationError.value=true
  }finally{if(!disposed)initializing.value=false}
}
onMounted(initialize)

watch(model, value => {
  if (!editor || syncing || normalizedHtml(editor) === value) return
  syncing = true
  editor.setHtml(props.displayHtml?props.displayHtml(value||''):value||'')
  lastHtml=normalizedHtml(editor)
  syncing = false
}, { flush: 'sync' })

watch(() => props.disabled, value => {
  if (!editor) return
  if (value) editor.disable()
  else editor.enable()
})

watch(pickerOpen, async value => {
  if (value || !pendingFile.value || !editor) return
  const file = pendingFile.value
  pendingFile.value = null
  const url = props.imageSource?props.imageSource(file.id):file.value || ''
  if (!url) {
    toast.add({ title: '该资源地址不可用', color: 'warning' })
    return
  }
  await nextTick()
  editor.restoreSelection()
  if (imageInsert) imageInsert(url, '正文图片', '')

  imageInsert = null
  editor.focus()
})

onBeforeUnmount(() => {
  disposed = true
  emit('busy',false)
  toolbarObserver?.disconnect()
  toolbarObserver = null
  toolbar?.destroy()
  toolbar = null
  editor?.destroy()
  editor = null
})
</script>

<template>
  <div>
    <ConsoleAsyncState v-if="initializing||initializationError" label="富文本编辑器" :failed="initializationError"/>
    <div class="school-rich-editor" :class="{ 'is-disabled': disabled }">
      <div ref="toolbarHost" class="school-rich-toolbar" />
      <div ref="editorHost" class="school-rich-content" />
    </div>
    <MaterialPicker v-model:open="pickerOpen" portal="tenant" :endpoint="endpoint" :purpose="purpose" kind="image" @select="selectMedia" />
  </div>
</template>

<style scoped>
.school-rich-editor {
  --w-e-textarea-bg-color: var(--ui-bg);
  --w-e-textarea-color: var(--ui-text);
  --w-e-textarea-border-color: var(--ui-border);
  --w-e-textarea-slight-border-color: var(--ui-border);
  --w-e-textarea-slight-color: var(--ui-text-muted);
  --w-e-textarea-slight-bg-color: var(--ui-bg-elevated);
  --w-e-textarea-selected-border-color: var(--ui-primary);
  --w-e-textarea-handler-bg-color: var(--ui-primary);
  --w-e-toolbar-color: var(--ui-text);
  --w-e-toolbar-bg-color: var(--ui-bg-elevated);
  --w-e-toolbar-active-color: var(--ui-primary);
  --w-e-toolbar-active-bg-color: var(--ui-bg-accented);
  --w-e-toolbar-disabled-color: var(--ui-text-dimmed);
  --w-e-toolbar-border-color: var(--ui-border);
  --w-e-modal-button-bg-color: var(--ui-bg);
  --w-e-modal-button-border-color: var(--ui-border);
  display: flex;
  min-width: 0;
  height: min(34rem, 52dvh);
  min-height: 22rem;
  flex-direction: column;
  overflow: visible;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}
.school-rich-editor.is-disabled { opacity: .65; }
.school-rich-editor:focus-within { outline: 2px solid var(--ui-primary); outline-offset: -1px; }
.school-rich-toolbar { position: relative; z-index: 3; flex: none; border-bottom: 1px solid var(--ui-border); }
.school-rich-content { min-width: 0; min-height: 0; flex: 1; overflow: hidden; border-radius: 0 0 var(--ui-radius) var(--ui-radius); }
.school-rich-editor :deep(.w-e-toolbar) { align-items: center; padding: 4px 8px; border-radius: var(--ui-radius) var(--ui-radius) 0 0; }
.school-rich-editor :deep(.w-e-select-list),
.school-rich-editor :deep(.w-e-drop-panel),
.school-rich-editor :deep(.w-e-modal),
.school-rich-editor :deep(.w-e-bar-item-menus-container) { z-index: 5; }
.school-rich-editor :deep(.w-e-bar-item) { height: 36px; padding: 2px; }
.school-rich-editor :deep(.w-e-bar-item button) { width: 32px; min-width: 32px; height: 32px; padding: 6px; border-radius: var(--radius-sm); }
.school-rich-editor :deep(.w-e-bar-item button .title) { display: none; }
.school-rich-editor :deep(.w-e-bar-item svg) { width: 20px; height: 20px; }
.school-rich-editor :deep(.w-e-bar-divider) { height: 20px; margin: 7px 4px; }
.school-rich-editor :deep(.w-e-text-container) { height: 100% !important; }
.school-rich-editor :deep(.w-e-scroll) { min-height: 0; overflow-y: auto; }
.school-rich-editor :deep(.w-e-text-placeholder) { top: 14px; left: 16px; color: var(--ui-text-muted); font-style: normal; }
.school-rich-editor :deep(.w-e-text-container [data-slate-editor]) { min-height: 100%; padding: 0 16px 32px; font-family: inherit; font-size: .9375rem; line-height: 1.75; }
.school-rich-editor :deep(.w-e-text-container [data-slate-editor] :is(ul, ol)) { padding-left: 1.5rem; }
@media (max-width: 640px) {
  .school-rich-editor { height: min(30rem, 56dvh); min-height: 20rem; }
}
@media (prefers-reduced-motion: reduce) {
  .school-rich-editor,
  .school-rich-editor :deep(*) { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
</style>
