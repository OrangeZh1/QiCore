<script setup lang="ts">
import {clientThemeStyle} from '../../lib/client-theme'
import DecorationPage from '../../components/DecorationPage.vue'
import ClientDecorationState from '../../components/ClientDecorationState.vue'
import {useDecorationPage} from '../../lib/use-decoration-page'
import {useMiniAds} from '../../lib/use-mini-ads'
const {bannerId}=useMiniAds('profile')
import {onShareAppMessage,onShareTimeline} from '@dcloudio/uni-app'
const {data,title,error,action,needsLogin,load,navigate,share,login}=useDecorationPage('profile')
onShareAppMessage(()=>({...share(),path:'/pages/profile/index'}));onShareTimeline(share)
</script>
<template><page-meta :page-style="clientThemeStyle"/><DecorationPage v-if="data" :customer-service="data.customerService" :default-avatar="data.defaultAvatar" :scheme="data.scheme" :components="data.components" page="profile" :images="data.images" :member="data.member" :profile="data.profile" :native-ad-unit-id="bannerId" @navigate="navigate"/><ClientDecorationState :title="title" :show-header="false" :error="error" :action="action" :has-content="!!data" :needs-login="needsLogin" :navigation="!!data?.scheme.navigation.enabled" @retry="load('retry')" @login="login"/></template>
