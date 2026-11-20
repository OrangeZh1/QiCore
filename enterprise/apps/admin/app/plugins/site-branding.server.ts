export default defineNuxtPlugin(()=>{
 if(useRequestURL().pathname.replace(/\/+$/,'')==='/install')return
 // Public presentation data can load alongside authentication and tenant entry.
 // app.vue still awaits load() before rendering the final title and favicon.
 void useSiteBranding().load().catch(()=>{})
})
