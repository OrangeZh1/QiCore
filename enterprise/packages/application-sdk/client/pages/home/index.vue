<script setup lang="ts">
import {ref} from 'vue'
import {onLoad} from '@dcloudio/uni-app'
import {clientThemeStyle} from '../../lib/client-theme'
import DecorationPage from '../../components/DecorationPage.vue'
import ClientDecorationState from '../../components/ClientDecorationState.vue'
import {useDecorationPage} from '../../lib/use-decoration-page'
import {useMiniAds} from '../../lib/use-mini-ads'
const initialQuery=ref(''),focusCollection=ref(false)
onLoad(query=>{initialQuery.value=typeof query?.query==='string'?query.query.slice(0,64):'';focusCollection.value=query?.section==='templates'})
const {bannerId}=useMiniAds('home')
import {onShareAppMessage,onShareTimeline} from '@dcloudio/uni-app'
const {data,title,error,action,needsLogin,load,navigate,share,login}=useDecorationPage('home')
onShareAppMessage(()=>({...share(),path:'/pages/home/index'}));onShareTimeline(share)
</script>
<template><page-meta :page-style="clientThemeStyle"/><DecorationPage v-if="data" :customer-service="data.customerService" :default-avatar="data.defaultAvatar" :scheme="data.scheme" :targets="data.targets" :initial-query="initialQuery" :focus-collection="focusCollection" :components="data.components" page="home" :images="data.images" :member="data.member" :profile="data.profile" :native-ad-unit-id="bannerId" @navigate="navigate"/><ClientDecorationState :title="title" :error="error" :action="action" :has-content="!!data" :needs-login="needsLogin" :navigation="!!data?.scheme.navigation.enabled" @retry="load('retry')" @login="login"/></template>
