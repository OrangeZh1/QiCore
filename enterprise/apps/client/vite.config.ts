import {defineConfig} from 'vite'
import uniPlugin from '@dcloudio/vite-plugin-uni'
export default defineConfig(()=>{
 const uni=typeof uniPlugin==='function'?uniPlugin:(uniPlugin as any).default
 return{envDir:false,resolve:{alias:{'/src':process.env.UNI_INPUT_DIR!}},plugins:[uni()],define:{__QICORE_APPLICATION_KEY__:JSON.stringify('system'),'import.meta.env.UNI_PLATFORM':JSON.stringify('h5'),'import.meta.env.VITE_CLIENT_PREVIEW':JSON.stringify('false')},build:{sourcemap:false}}
})
