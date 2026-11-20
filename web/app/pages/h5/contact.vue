<script setup lang="ts">
definePageMeta({ publicLanding: true, colorMode: 'light' })
type Contact = { phone: string; wechat: string; avatar: string | null; qrCode: string | null; description: string }
const { data, error, refresh, status } = await useFetch<Contact>('/api/public/customer-service', { key: 'h5-contact' })
const copying = ref(false), feedback = ref(''), qrOpen = ref(false)
async function copy() {
  if (copying.value || !data.value?.wechat) return
  copying.value = true; feedback.value = ''
  try {
    await navigator.clipboard.writeText(data.value.wechat)
    feedback.value = '微信号已复制'
  } catch { feedback.value = '复制未完成，可以长按微信号复制。' }
  finally { copying.value = false }
}
</script>
<template>
  <H5PublicPage class="contact-page" title="联系客服" back="/h5">
    <div v-if="error" role="alert" class="h5-error">联系方式暂时无法加载。
      <button class="h5-action" :disabled="status === 'pending'" :aria-busy="status === 'pending'" @click="refresh()">重新加载</button>
    </div>
    <div v-else-if="data" class="contact-body">
      <div v-if="data.avatar || data.description" class="contact-intro"><img v-if="data.avatar" :src="data.avatar" class="contact-avatar" alt="客服头像"><div class="contact-description">{{ data.description }}</div></div>
      <div v-if="data.phone" class="contact-row"><img src="/h5-assets/icons/phone-blue.svg" alt=""><div class="contact-copy"><span>联系电话</span><span class="contact-value">{{ data.phone }}</span></div>
        <a class="h5-action" aria-label="拨打客服电话" :href="'tel:' + data.phone.replace(/[ -]/g, '')">拨打</a></div>
      <div v-if="data.wechat" class="contact-row"><img src="/h5-assets/icons/message-circle-blue.svg" alt=""><div class="contact-copy"><span>客服微信</span><span class="contact-value">{{ data.wechat }}</span></div>
        <button aria-label="复制客服微信号" :disabled="copying" :aria-busy="copying" @click="copy">复制</button></div>
      <p v-if="feedback" role="status">{{ feedback }}</p>
      <div v-if="data.qrCode" class="contact-qr"><span class="contact-qr-title">客服二维码</span>
        <button class="contact-qr-image" aria-label="查看客服二维码大图" @click="qrOpen = true"><img :src="data.qrCode" alt="客服二维码"></button>
        <span class="contact-qr-hint">点击查看大图</span>
        <UModal v-model:open="qrOpen" title="客服二维码"><template #body><img :src="data.qrCode" class="mx-auto h-auto w-full max-w-96" alt="客服二维码大图"></template></UModal>
      </div>
      <p v-if="!data.phone && !data.wechat && !data.qrCode" class="contact-empty">暂未设置联系方式，请稍后再来查看。</p>
    </div>
  </H5PublicPage>
</template>
<style scoped>
.contact-body { padding:var(--client-content-top, 16px) var(--client-page-gutter, 10px) 20px }
.contact-description { white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:20px;color:var(--client-muted,#718198) }
.contact-row { display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:18px 16px;background:var(--client-surface,#fff);border-radius:14px }
.contact-row img,.contact-official img { width:24px;height:24px;flex-shrink:0 }
.contact-copy { display:flex;flex-direction:column;flex:1;min-width:0;color:var(--client-muted,#718198);font-size:12px }
.contact-value { font-size:16px;font-weight:600;color:var(--client-text,#203450);overflow-wrap:anywhere;margin-top:3px }
.contact-row button { margin:0;padding:8px 12px;border:0;border-radius:8px;background:var(--client-primary-soft,#edf3ff);color:var(--client-primary,#3264f5);font:inherit;flex-shrink:0;min-height:40px }
.contact-page button::after { border:0 }
.contact-empty { padding:64px 20px;text-align:center;color:var(--client-muted,#718198) }
.contact-intro { display:flex;align-items:center;justify-content:center;gap:16px;padding:8px 4px 24px }
.contact-avatar { display:block;width:64px;height:64px;border-radius:50%;flex-shrink:0;background:var(--client-primary-soft,#edf3ff);box-shadow:0 4px 18px #2034500a }
.contact-intro .contact-description { flex:1;min-width:0;margin:0;font-size:14px;line-height:1.8 }
.contact-qr { display:flex;flex-direction:column;align-items:center;gap:16px;margin-top:18px;padding:24px 20px;background:var(--client-surface,#fff);border-radius:16px }
.contact-qr-title { font-size:16px;font-weight:600 }
.contact-page .contact-qr-image { display:block;margin:0;padding:10px;width:220px;max-width:100%;height:220px;box-sizing:border-box;border:1px solid #e8edf5;border-radius:12px;background:white }
.contact-qr-image img { display:block;width:100%;height:100% }
.contact-qr-hint { font-size:12px;color:var(--client-muted,#718198) }
</style>
