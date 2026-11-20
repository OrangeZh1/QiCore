<script setup lang="ts">
import {clientThemeStyle} from '../../lib/client-theme'
import ConsumerOrderList from '../../components/ConsumerOrderList.vue'
import {useConsumerOrders} from '../../lib/use-consumer-orders'
const model=useConsumerOrders()
</script>
<template><page-meta :page-style="clientThemeStyle"/><ConsumerOrderList :model="model"/></template>
